// **Transactions screen** — every update in the same window, **newest first,
// 25 at a time** (keyset `before`). Not "all history" but "everything recent the node still remembers".
// The filters (template and party) live in the address query and the server judges them — here we pass
// the input on and draw the result.
import {
  Button,
  MessageRow,
  Muted,
  Pager,
  Scroll,
  Section,
  SuggestInput,
  Table,
  TextInput,
  ToolbarFlag,
  ToolbarForm,
} from "@canton-lens/design-system";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { messageOf } from "../api/client.ts";
import type { UpdatesResponse } from "../api/types.ts";
import { PartyChip } from "../format/chips.tsx";
import { UpdateRows } from "../format/rows.tsx";
import {
  hashQuery,
  hashWith,
  normalizePartyFilter,
  parsePartyFilter,
  setHashParams,
} from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";
import { pickedTemplate, TEMPLATE_PINNED } from "./template-filter.ts";

const TX_KEYS = ["template", "party", "before"] as const;
// Newer rewinds the before values this screen has passed through (they come from the address, so this
// is no judgement). Session lifetime — it survives leaving the screen and coming back.
// Kept inside the component, a trip to a detail page alone would lose the place to rewind to.
// Apply, Clear and a filter change empty it.
const newerStack: string[] = [];

// **The fetching half.** It holds the session, the effect and the answer; it draws nothing.
export function Transactions({ hash }: { hash: string }) {
  const { api, lastOffset, loading, generation, templates } = useSession();
  // Suggestion material for the filter field — module:entity from my catalog. Typing help, not judgement.
  const templateOptions = (templates?.rows ?? []).map((r) => `${r.module}:${r.entity}`);
  const q = hashQuery(hash);
  const template = q.get("template") ?? "";
  const party = q.get("party") ?? "";
  const before = q.get("before") ?? "";

  const [u, setU] = useState<UpdatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When the filter changes, the rewind stack starts over.
  const filterKey = `${template}\u0000${party}`;
  const lastFilter = useRef(filterKey);

  // Read once per (generation · offset · query) — so a mid-change render does not go out on old conditions.
  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (loading || lastOffset === null) return;
    const key = `${generation}|${lastOffset}|${template}|${party}|${before}`;
    if (ran.current === key) return;
    ran.current = key;
    if (lastFilter.current !== filterKey) {
      lastFilter.current = filterKey;
      newerStack.length = 0;
    }
    let cancelled = false;
    const params = new URLSearchParams({ offset: String(lastOffset) });
    const values = { template, party, before };
    for (const k of TX_KEYS) if (values[k]) params.set(k, values[k]);
    setError(null);
    api<UpdatesResponse>(`/api/updates?${params}`).then(
      (res) => {
        if (cancelled) return;
        setU(res);
      },
      (e: unknown) => {
        if (!cancelled) setError(messageOf(e));
      },
    );
    return () => {
      cancelled = true;
      // An abandoned run clears its own marker (ran) — left behind, a re-entering run with the same key turns
      // back saying "already read", and the discarded response and unsent request leave the screen blank.
      if (ran.current === key) ran.current = null;
    };
  }, [api, loading, generation, lastOffset, template, party, before, filterKey]);

  return <TransactionsView u={u} error={error} hash={hash} templateOptions={templateOptions} />;
}

// **The drawing half — a function of one response and the address, and nothing else.** No session, no
// effect, no clock. That is what lets a test hand it the answer a real participant gave and count the rows
// that come out: joined to the fetching, a static render only ever reaches "Reading updates…" and the screen
// itself is never looked at (2026-09-18).
//
// The text fields keep their own state here because that is what they are — what is being typed, which is
// not an answer to anything. They start from the address, which is where the applied filter lives.
export function TransactionsView({
  u,
  error,
  hash,
  templateOptions = [],
}: {
  u: UpdatesResponse | null;
  error: string | null;
  hash: string;
  templateOptions?: readonly string[];
}) {
  const q = hashQuery(hash);
  const template = q.get("template") ?? "";
  const party = q.get("party") ?? "";
  const before = q.get("before") ?? "";
  const [templateInput, setTemplateInput] = useState(template);
  const [partyInput, setPartyInput] = useState(party);
  // The fields mirror the address — only when the address changed. Mirroring on every draw would wipe
  // what is being typed.
  const applied = useMemo(() => ({ template, party }), [template, party]);
  useEffect(() => {
    setTemplateInput(applied.template);
    setPartyInput(applied.party);
  }, [applied]);
  const clearedHref = hashWith({ template: null, party: null, before: null }, hash);

  const clear = () => {
    setTemplateInput("");
    setPartyInput("");
    newerStack.length = 0;
    setHashParams({ template: null, party: null, before: null });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    newerStack.length = 0;
    setHashParams({
      template: templateInput.trim() || null,
      party: normalizePartyFilter(partyInput) || null,
      before: null,
    });
  };

  const rows = u?.rows ?? [];
  // The label comes from the filter **the response states** — while the address changes first and the
  // answer follows, table and heading still say the same thing.
  const filtered = u !== null && Boolean(u.filter.template || u.filter.parties?.length);
  const older = u !== null && u.nextBefore !== null && u.nextBefore !== undefined;
  const first = rows[0];
  const last = rows[rows.length - 1];

  return (
    <div id="view-transactions">
      <Section
        id="tx-list-box"
        title="Transactions"
        note={
          u
            ? `${filtered ? `${u.matched} of ${u.total}` : `${u.total}`} ${u.total === 1 ? "update" : "updates"} visible to you · offsets (${u.beginExclusive}, ${u.offset}]`
            : ""
        }
        foot={
          // Footnote — the edges of the window, that failed commands are not in the list, and that
          // reassignments are "not in this version" (never skip silently).
          u && error === null ? (
            <>
              <p>
                Everything the node still remembers in this window — the most recent, not all
                history. Older history is not in this view.
              </p>
              <p>
                Failed submissions never reach the ledger, so they are not listed here — this is not
                "no failed transactions".
              </p>
              <p>
                Reassignments (contract moves between synchronizers) are not shown in this version —
                a contract's move count is its reassignmentCounter on the contract page.
              </p>
            </>
          ) : undefined
        }
      >
        {/* Two filters: template and party. The server judges (witnessParties · any one event matching).
            The state lives in the address (?template=&party=&before=). */}
        <ToolbarForm id="tx-filters" onSubmit={submit}>
          <label htmlFor="tx-template">
            Template{" "}
            <SuggestInput
              id="tx-template"
              options={templateOptions}
              pinned={TEMPLATE_PINNED}
              onPick={(v) => setTemplateInput(pickedTemplate(v))}
              placeholder="Entity or Module:Entity"
              value={templateInput}
              onChange={(e) => setTemplateInput(e.target.value)}
            />
          </label>
          <label htmlFor="tx-party">
            Parties <Muted>any match</Muted>{" "}
            <TextInput
              id="tx-party"
              mono
              wide
              placeholder="exact party IDs, separated by commas"
              value={partyInput}
              onChange={(e) => setPartyInput(e.target.value)}
            />
          </label>
          {/* The applied party filter — the address value as chips. Several of them is an OR (any match). */}
          {parsePartyFilter(party).map((p) => (
            <PartyChip key={p} value={p} />
          ))}
          <Button type="submit" variant="primary">
            Apply
          </Button>
          <Button id="tx-clear" onClick={clear}>
            Clear
          </Button>
          <span id="tx-filter-state">{filtered ? <ToolbarFlag>filtered</ToolbarFlag> : null}</span>
        </ToolbarForm>
        <Scroll>
          <Table id="tx-list">
            <tbody>
              {error !== null ? (
                <MessageRow tone="problem">Could not fetch — {error}</MessageRow>
              ) : u === null ? (
                // Leaving "no answer yet" blank looks the same as "none" — say what is being waited for.
                <MessageRow>Reading updates…</MessageRow>
              ) : rows.length > 0 ? (
                <UpdateRows rows={rows} />
              ) : u.total === 0 ? (
                <MessageRow>
                  Nothing visible to you happened in this window — older history is not in this view
                </MessageRow>
              ) : filtered ? (
                // Two kinds of empty result, told apart by the server's total and matched: the window
                // is empty vs nothing matches the filters.
                <MessageRow>
                  No update in this window (the last {u.total}) matches these filters — this search
                  covers the window only. <a href={clearedHref}>Clear filters</a>
                </MessageRow>
              ) : (
                <MessageRow>Nothing on this page</MessageRow>
              )}
            </tbody>
          </Table>
        </Scroll>
        {/* Paging — Older is the server's nextBefore, Newer rewinds the before values this screen passed. */}
        <Pager id="tx-pager">
          {u && error === null ? (
            <>
              {newerStack.length > 0 ? (
                <Button
                  size="xs"
                  id="tx-newer"
                  onClick={() => {
                    const prev = newerStack.pop();
                    setHashParams({ before: prev || null });
                  }}
                >
                  Newer
                </Button>
              ) : null}
              {older ? (
                <Button
                  size="xs"
                  id="tx-older"
                  onClick={() => {
                    newerStack.push(before);
                    setHashParams({ before: String(u.nextBefore) });
                  }}
                >
                  Older
                </Button>
              ) : null}
              <span>
                {first && last ? `offsets ${last.offset} to ${first.offset} on this page` : ""}
                {older ? " · more below" : rows.length > 0 ? " · start of the window" : ""}
              </span>
            </>
          ) : null}
        </Pager>
      </Section>
    </div>
  );
}
