// The header's search row — while you are typing, it shows ahead what is "already known".
//
// This product has no index (there is no full-text search — the head of
// core/search/build-search-results.ts). So search has only two grades: **an id only on an exact match**,
// **a name on a partial match inside my catalog (the ACS)**. The preview rests on that fact — it helps while
// a name is being typed, and there is nothing it can do while an id is. So an id that is not fully typed is
// **not asked about** (worthAsking in preview-hits.ts), because asking once is not cheap: for every query the
// server reads the whole ACS visible to me (the isSearch branch in api/router.ts).
//
// The server still makes the results. The judgment that turns the server's sections into rows lives in
// preview-hits.ts; what remains here is drawing and wiring.
import { SearchBar, SearchButton, SearchInput } from "@canton-lens/design-system";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { messageOf } from "../api/client.ts";
import type { SearchResponse } from "../api/types.ts";
import { hashQuery, href } from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";
import { hitsOf, unavailableOf, worthAsking } from "./preview-hits.ts";

export function SearchPreview({ hash }: { hash: string }) {
  const { api, loading, generation, clearError } = useSession();
  const [q, setQ] = useState(() =>
    hash.startsWith("#/search") ? (hashQuery(hash).get("q") ?? "") : "",
  );
  const [open, setOpen] = useState(false);
  // The selected row is remembered by **its key, not its index** — if the list refreshes underneath, the
  // index comes to point at a different row and what the user picked stops matching what Enter opens.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [result, setResult] = useState<{
    q: string;
    generation: number;
    response?: SearchResponse;
    error?: string;
  } | null>(null);
  const root = useRef<HTMLElement>(null);
  const query = q.trim();
  const visible = open && query.length > 0;
  const asking = worthAsking(query);
  // Do we already hold the answer for this query (and this generation)? If so, do not ask again — that keeps
  // merely taking focus away and giving it back from re-reading the ACS.
  const current = result?.q === query && result.generation === generation ? result : null;
  const hits = current?.response ? hitsOf(current.response) : [];
  const activeIndex = activeKey === null ? -1 : hits.findIndex((hit) => hit.key === activeKey);
  const busy = visible && asking && (loading || current === null);
  const unavailable = current?.response ? unavailableOf(current.response) : [];

  useEffect(() => {
    if (hash.startsWith("#/search")) setQ(hashQuery(hash).get("q") ?? "");
    setOpen(false);
    setActiveKey(null);
  }, [hash]);

  // `/` jumps into the search field — the same habit as Etherscan. While typing it is just a character.
  // The shortcut belongs to this component, the one that draws the search field, rather than to the Header
  // reaching for someone else's field by id.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      event.preventDefault();
      document.getElementById("q")?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!visible || loading || !asking || current !== null) return;
    let cancelled = false;
    // Go to the server only after typing stops. An answer already held was filtered out above, so one query
    // goes out exactly once.
    const timer = setTimeout(() => {
      api<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`).then(
        (response) => {
          if (!cancelled) setResult({ q: query, generation, response });
        },
        (error) => {
          if (!cancelled) setResult({ q: query, generation, error: messageOf(error) });
        },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query, generation, loading, visible, asking, current]);

  useEffect(() => {
    if (!visible) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [visible]);

  useEffect(() => {
    if (activeIndex >= 0)
      document.getElementById(`search-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const dismiss = () => {
    setOpen(false);
    setActiveKey(null);
  };
  const navigate = (to: string) => {
    clearError();
    dismiss();
    location.hash = to;
  };
  const search = () => {
    if (query) navigate(href.search(query));
  };
  const move = (delta: number) => {
    if (hits.length === 0) return;
    const next =
      activeIndex < 0
        ? delta > 0
          ? 0
          : hits.length - 1
        : (activeIndex + delta + hits.length) % hits.length;
    setActiveKey(hits[next]?.key ?? null);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      move(event.key === "ArrowDown" ? 1 : -1);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = visible && activeIndex >= 0 ? hits[activeIndex] : undefined;
      if (hit) navigate(hit.to);
      else search();
    }
  };

  return (
    <search
      className="search-preview"
      ref={root}
      // Esc is caught by the whole panel — with the panel open, tabbing onto Clear, the magnifier or
      // "View all results" must still close it (the panel says as much in its own footer).
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
      }}
    >
      <SearchBar>
        <SearchInput
          id="q"
          role="combobox"
          aria-label="Search ledger"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={visible ? "search-suggestions" : undefined}
          aria-activedescendant={
            visible && activeIndex >= 0 ? `search-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          placeholder="Search by update ID, contract ID, party ID, template or interface  ( / )"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQ(event.target.value);
            setOpen(true);
            setActiveKey(null);
          }}
          onKeyDown={onKey}
        />
        {/* Say it in words — the only pictures in this product are the magnifier and the hamburger, and
          Clear is not a place worth widening that exception for. */}
        {q ? (
          <button
            className="search-preview__clear"
            type="button"
            onClick={() => {
              setQ("");
              setResult(null);
              setActiveKey(null);
              document.getElementById("q")?.focus();
            }}
          >
            Clear
          </button>
        ) : null}
        <SearchButton id="go" onClick={search} />
      </SearchBar>
      {visible ? (
        <div className="search-preview__panel">
          <div className="search-preview__heading">Search your visible ledger</div>
          <div role="status" className="search-preview__status">
            {!asking
              ? "Keep typing — an ID is found only when it is complete."
              : busy
                ? "Searching…"
                : current?.error
                  ? `Could not search — ${current.error}`
                  : hits.length
                    ? `${hits.length} ${hits.length === 1 ? "suggestion" : "suggestions"}`
                    : "No matching results in your visible ledger."}
          </div>
          {unavailable.map((line) => (
            <div className="search-preview__status" key={line}>
              Could not fetch {line}
            </div>
          ))}
          <div
            id="search-suggestions"
            role="listbox"
            aria-label="Search suggestions"
            aria-busy={busy}
            className="search-preview__list"
          >
            {hits.map((hit, index) => (
              <button
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                id={`search-option-${index}`}
                key={hit.key}
                tabIndex={-1}
                className="search-preview__option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => navigate(hit.to)}
              >
                <span className="search-preview__kind">{hit.group}</span>
                <span className="search-preview__text">
                  <span className="search-preview__label" title={hit.label}>
                    {hit.label}
                  </span>
                  <span className="search-preview__detail" title={hit.detail}>
                    {hit.detail}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="search-preview__hint">
            Use a full transaction, contract or party ID. Template and package names support partial
            matches.
          </div>
          <div className="search-preview__footer">
            <span>↑ ↓ Navigate · Enter Open · Esc Close</span>
            <a href={href.search(query)} onClick={() => setOpen(false)}>
              View all results →
            </a>
          </div>
        </div>
      ) : null}
    </search>
  );
}
