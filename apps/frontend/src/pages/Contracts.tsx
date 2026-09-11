// **Contracts list** — four columns (template · contract id · my role · created at),
// newest first, filters for template + party (kept in the address), the offset read in the header
// (pinned while paging), and two kinds of empty message.
// Paging is a keyset cursor (the server's nextCursor as given), and the offset read is pinned to the
// first page's (home's "one offset" rule — without pinning, contracts leak in or repeat between pages).
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
import type { ContractListRow, ContractsResponse } from "../api/types.ts";
import { PartyChip } from "../format/chips.tsx";
import { fmtOffset } from "../format/format.ts";
import { ContractHead, ContractRow } from "../format/rows.tsx";
import {
  hashQuery,
  hashWith,
  normalizePartyFilter,
  parsePartyFilter,
  setHashParams,
} from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";
import { pickedTemplate, TEMPLATE_PINNED } from "./template-filter.ts";

type Cursor = NonNullable<ContractsResponse["nextCursor"]>;
type Page = {
  rows: ContractListRow[];
  cursor: Cursor | null;
  total: number;
  matched: number;
  offset: number;
  filter: { template?: string; parties?: string[] };
};

export function Contracts({ hash }: { hash: string }) {
  const { api, lastOffset, loading, generation, fail, templates } = useSession();
  // Suggestion material for the filter field — module:entity from my catalog. Typing help, not judgement.
  const templateOptions = (templates?.rows ?? []).map((r) => `${r.module}:${r.entity}`);
  const q = hashQuery(hash);
  const template = q.get("template") ?? "";
  const party = q.get("party") ?? "";

  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templateInput, setTemplateInput] = useState(template);
  const [partyInput, setPartyInput] = useState(party);
  // The fields mirror the address — when the address changed and when everything was re-read.
  const applied = useMemo(() => ({ template, party, generation }), [template, party, generation]);
  useEffect(() => {
    setTemplateInput(applied.template);
    setPartyInput(applied.party);
  }, [applied]);

  const params = (offset: number, extra: Record<string, string | number | null> = {}) => {
    const p = new URLSearchParams({ pageSize: "25", offset: String(offset) });
    if (template) p.set("template", template);
    if (party) p.set("party", party);
    for (const [k, v] of Object.entries(extra))
      if (v !== null && v !== undefined) p.set(k, String(v));
    return p;
  };

  // Read once per (generation · offset · filter).
  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (loading || lastOffset === null) return;
    const key = `${generation}|${lastOffset}|${template}|${party}`;
    if (ran.current === key) return;
    ran.current = key;
    let cancelled = false;
    const p = new URLSearchParams({ pageSize: "25", offset: String(lastOffset) });
    if (template) p.set("template", template);
    if (party) p.set("party", party);
    setError(null);
    api<ContractsResponse>(`/api/contracts?${p}`).then(
      (res) => {
        if (cancelled) return;
        setPage({
          rows: res.rows ?? [],
          cursor: res.nextCursor ?? null,
          total: res.total ?? (res.rows ?? []).length,
          matched: res.matched ?? (res.rows ?? []).length,
          offset: res.offset ?? lastOffset,
          filter: res.filter ?? {},
        });
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
  }, [api, loading, generation, lastOffset, template, party]);

  // Older — hands the server's nextCursor triple straight back. The offset stays pinned to the first
  // page's (the rule above).
  const older = async () => {
    if (!page?.cursor) return;
    try {
      const res = await api<ContractsResponse>(
        `/api/contracts?${params(page.offset, {
          cursorOffset: page.cursor.offset,
          cursorCreatedAt: page.cursor.createdAt,
          cursorContractId: page.cursor.contractId,
        })}`,
      );
      setPage({ ...page, rows: page.rows.concat(res.rows ?? []), cursor: res.nextCursor ?? null });
    } catch (e) {
      fail(messageOf(e));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setHashParams({
      template: templateInput.trim() || null,
      party: normalizePartyFilter(partyInput) || null,
    });
  };
  const clear = () => setHashParams({ template: null, party: null });
  const clearedHref = hashWith({ template: null, party: null }, hash);

  const rows = page?.rows ?? [];
  // The label comes from the filter the response states — even in the gap between address and answer,
  // table and heading say the same thing.
  const filtered = page !== null && Boolean(page.filter.template || page.filter.parties?.length);
  return (
    <div id="view-contracts">
      <Section
        id="list-box"
        title="Contracts"
        note={
          page
            ? `${filtered ? `${page.matched} of ${page.total}` : `${page.total}`} active ${page.total === 1 ? "contract" : "contracts"} visible to you · read at offset ${fmtOffset(page.offset ?? 0)}`
            : "active contracts visible to you"
        }
      >
        <ToolbarForm id="c-filters" onSubmit={submit}>
          <label htmlFor="c-template">
            Template{" "}
            <SuggestInput
              id="c-template"
              options={templateOptions}
              pinned={TEMPLATE_PINNED}
              onPick={(v) => setTemplateInput(pickedTemplate(v))}
              placeholder="Entity or Module:Entity"
              value={templateInput}
              onChange={(e) => setTemplateInput(e.target.value)}
            />
          </label>
          <label htmlFor="c-party">
            Parties <Muted>any match</Muted>{" "}
            <TextInput
              id="c-party"
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
          <Button id="c-clear" onClick={clear}>
            Clear
          </Button>
          <span id="c-filter-state">{filtered ? <ToolbarFlag>filtered</ToolbarFlag> : null}</span>
        </ToolbarForm>
        <Scroll>
          <Table id="list">
            <tbody>
              {error !== null ? (
                <MessageRow tone="problem">Could not fetch — {error}</MessageRow>
              ) : page === null ? (
                // Leaving "no answer yet" blank looks the same as "none" — say what is being waited for.
                <MessageRow>Reading contracts…</MessageRow>
              ) : rows.length > 0 ? (
                <>
                  <ContractHead />
                  {rows.map((r) => (
                    <ContractRow key={r.contractId} r={r} />
                  ))}
                </>
              ) : page.total === 0 ? (
                // Two kinds of empty: "no active contracts are visible" ≠ "nothing matches the filters".
                <MessageRow>No active contracts are visible to you</MessageRow>
              ) : (
                <MessageRow>
                  None of your {page.total} active contracts match these filters.{" "}
                  <a href={clearedHref}>Clear filters</a>
                </MessageRow>
              )}
            </tbody>
          </Table>
        </Scroll>
        <Pager>
          {page?.cursor ? (
            <Button size="xs" id="more" onClick={() => void older()}>
              Older
            </Button>
          ) : null}
          <span id="list-page-note">
            {page && rows.length > 0
              ? `${rows.length} of ${page.matched} shown · newest first${page.cursor ? "" : " · end of list"}`
              : ""}
          </span>
        </Pager>
      </Section>
    </div>
  );
}
