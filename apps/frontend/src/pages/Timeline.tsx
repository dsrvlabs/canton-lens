// **Timeline** — one contract's lifetime as one bar. The horizontal axis is the ledger offset (Canton
// has no blocks, and the offset is the mark that counts "which one").
//
// **This is the first screen in the product where a picture takes the floor.** The notation rule is
// "say it in words", and the only exceptions so far were two icons. The grounds for an exception here:
// the question this screen answers is "what existed from when to when", and **bars on a shared axis**
// answer it faster than a table of two numbers, start and end, written side by side.
// In exchange, everything the picture cannot say (a cut end, an unknown end, the edges of the window)
// is written in words as well.
//
// The material is two calls that already exist — the server was not touched. The update window (what
// appeared and disappeared inside it) + the ACS (what is alive now). timeline-lifelines.ts does the
// counting; here we only give position and colour.
import {
  Button,
  MessageRow,
  Muted,
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
import type { TimelineResponse } from "../api/types.ts";
import { fmtOffset } from "../format/format.ts";
import { hashQuery, normalizePartyFilter, setHashParams } from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";
import { LifelineChart } from "./TimelineChart.tsx";
import { pickedTemplate, TEMPLATE_PINNED } from "./template-filter.ts";

// **The fetching half.** It holds the session, the effect and the answer; it draws nothing.
export function Timeline({ hash }: { hash: string }) {
  const { api, lastOffset, loading, generation, templates } = useSession();
  const templateOptions = (templates?.rows ?? []).map((r) => `${r.module}:${r.entity}`);
  const q = hashQuery(hash);
  const template = q.get("template") ?? "";
  const party = q.get("party") ?? "";
  // The end of the window. The address value goes out verbatim, unjudged — what counts as an offset is
  // the server's answer.
  const endRaw = q.get("offset") ?? "";
  const fromRaw = q.get("from") ?? "";
  const atParam = endRaw !== "" ? endRaw : lastOffset === null ? "" : String(lastOffset);

  const [data, setData] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (loading || atParam === "") return;
    const key = `${generation}|${atParam}|${fromRaw}|${template}|${party}`;
    if (ran.current === key) return;
    ran.current = key;
    let cancelled = false;
    setData(null);
    setError(null);
    const filters =
      `${template ? `&template=${encodeURIComponent(template)}` : ""}` +
      `${party ? `&party=${encodeURIComponent(party)}` : ""}` +
      // The start goes out verbatim from the address too — what makes a window is the server's
      // judgement (invalid_window · window_too_wide).
      `${fromRaw ? `&from=${encodeURIComponent(fromRaw)}` : ""}`;
    const at = `offset=${encodeURIComponent(atParam)}`;
    (async () => {
      // Reading the window (events) and the ACS (what is alive) at one point and binding them into
      // lifetimes is the server's work — the screen asks once.
      const res = await api<TimelineResponse>(`/api/timeline?${at}${filters}`);
      if (cancelled) return;
      setData(res);
    })().catch((e: unknown) => {
      if (!cancelled) setError(messageOf(e));
    });
    return () => {
      cancelled = true;
      // An abandoned run clears its marker — otherwise the next run turns back and the screen stays blank.
      if (ran.current === key) ran.current = null;
    };
  }, [api, loading, generation, atParam, fromRaw, template, party]);

  return <TimelineView data={data} error={error} hash={hash} templateOptions={templateOptions} />;
}

// **The drawing half — a function of one answer and the address, and nothing else.** No session, no effect,
// no clock, so a test can hand it the answer a real participant gave and look at the bars that come out.
export function TimelineView({
  data,
  error,
  hash,
  templateOptions = [],
}: {
  data: TimelineResponse | null;
  error: string | null;
  hash: string;
  templateOptions?: readonly string[];
}) {
  const q = hashQuery(hash);
  const template = q.get("template") ?? "";
  const party = q.get("party") ?? "";
  const endRaw = q.get("offset") ?? "";
  const fromRaw = q.get("from") ?? "";
  const [templateInput, setTemplateInput] = useState(template);
  const [partyInput, setPartyInput] = useState(party);
  const [endInput, setEndInput] = useState(endRaw);
  const [fromInput, setFromInput] = useState(fromRaw);
  const applied = useMemo(
    () => ({ template, party, endRaw, fromRaw }),
    [template, party, endRaw, fromRaw],
  );
  useEffect(() => {
    setTemplateInput(applied.template);
    setPartyInput(applied.party);
    setEndInput(applied.endRaw);
    setFromInput(applied.fromRaw);
  }, [applied]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setHashParams({
      template: templateInput.trim() || null,
      party: normalizePartyFilter(partyInput) || null,
      offset: endInput.trim() || null,
      from: fromInput.trim() || null,
    });
  };
  const clear = () => setHashParams({ template: null, party: null, offset: null, from: null });

  const window = data === null ? null : { from: data.from ?? 0, to: data.offset ?? 0 };
  const total = data?.total ?? 0;
  const filtered = Boolean(template || party);

  return (
    <div id="view-timeline">
      <Section
        id="timeline-box"
        title="Timeline"
        note={
          window === null
            ? "contract lifetimes on the ledger offset axis"
            : `${total} ${total === 1 ? "contract" : "contracts"} · offsets ${fmtOffset(window.from)}–${fmtOffset(window.to)}`
        }
        foot="One bar is one contract, from the update that created it to the update that archived it. The axis is the ledger offset, and the window is the latest 100 offsets unless you set one - what happened before it is not here. A bar with a faded left edge started before the window; a striped right end means the end is unknown, not that the contract is alive."
      >
        <ToolbarForm id="tl-filters" onSubmit={submit}>
          <label htmlFor="tl-template">
            Template{" "}
            <SuggestInput
              id="tl-template"
              options={templateOptions}
              pinned={TEMPLATE_PINNED}
              onPick={(v) => setTemplateInput(pickedTemplate(v))}
              placeholder="Entity or Module:Entity"
              value={templateInput}
              onChange={(e) => setTemplateInput(e.target.value)}
            />
          </label>
          <label htmlFor="tl-party">
            Parties <Muted>any</Muted>{" "}
            <TextInput
              id="tl-party"
              mono
              placeholder="party IDs, comma-separated"
              value={partyInput}
              onChange={(e) => setPartyInput(e.target.value)}
            />
          </label>
          {/* The window is a **range** and includes both ends — set them equal and it is that one point.
            Leave both empty and it is the latest 100 offsets. The words (from · to) were dropped for
            room: two fields side by side with a – between them read that way anyway. */}
          {/* The label says "offset" — inside the field it would be cut off at 120px, and without it
            there is no telling what the two numbers count. */}
          <label htmlFor="tl-from">
            Offsets{" "}
            <TextInput
              id="tl-from"
              mono
              narrow
              placeholder="latest 100"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
            />
          </label>
          <label htmlFor="tl-end">
            –{" "}
            <TextInput
              id="tl-end"
              mono
              narrow
              placeholder="now"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
            />
          </label>
          <Button type="submit" variant="primary">
            Apply
          </Button>
          <Button id="tl-clear" onClick={clear}>
            Clear
          </Button>
          {filtered ? <ToolbarFlag>filtered</ToolbarFlag> : null}
          {endRaw === "" && fromRaw === "" ? null : <ToolbarFlag>window set</ToolbarFlag>}
        </ToolbarForm>

        {error !== null ? (
          <Scroll>
            <Table id="timeline-error">
              <tbody>
                <MessageRow tone="problem">Could not read the window — {error}</MessageRow>
              </tbody>
            </Table>
          </Scroll>
        ) : data === null || window === null ? (
          <Scroll>
            <Table id="timeline-waiting">
              <tbody>
                <MessageRow>Reading the window…</MessageRow>
              </tbody>
            </Table>
          </Scroll>
        ) : total === 0 ? (
          <Scroll>
            <Table id="timeline-empty">
              <tbody>
                <MessageRow>
                  {filtered
                    ? "Nothing in this window matches these filters"
                    : "Nothing visible to you lived in this window"}
                </MessageRow>
              </tbody>
            </Table>
          </Scroll>
        ) : (
          <LifelineChart groups={data.groups ?? []} total={total} window={window} />
        )}
      </Section>
    </div>
  );
}
