// **The party page.** Above is "what this party is" (Details, always visible); below are the lists
// (tabs). With the details tucked into a tab you would have to come back and re-check the identity
// whichever list you were reading — so the details are fixed and only the branch changes.
//
// What it holds is not everything about that party but only **what you and that party appear on
// together**, and without that one line on the screen a user reads it as everything about the party.
//
// **Time travel (?offset=).** An ACS request has always taken an activeAtOffset (core's
// request-active-contracts) and every server route already takes ?offset= — the screen simply was not
// using that ability. When the address carries an offset, **every read on this screen is against that
// one point** (home's "one offset" rule — mixing a different point per field makes the screen
// contradict itself). The address value goes to the server **verbatim, unjudged**: what counts as an
// offset is the server's judgement (negative or non-integer is a 400 invalid_offset), and a screen
// that filtered it first and drew "now" instead would split the point the address states from the
// point the table states. Too far back is pruned (410), a point not yet reached is
// offset_after_ledger_end (400) — we only relay those words.
import {
  Badge,
  Banner,
  Button,
  DescriptionList,
  MessageRow,
  Mono,
  Muted,
  Pager,
  Scroll,
  Section,
  SectionBody,
  Tab,
  Table,
  Tabs,
  TextInput,
  ToolbarFlag,
  ToolbarForm,
} from "@canton-lens/design-system";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { messageOf } from "../api/client.ts";
import { said } from "../api/said.ts";
import type {
  ContractsResponse,
  HoldingsCache,
  HoldingsResponse,
  PartyResponse,
  PreapprovalsCache,
  PreapprovalsResponse,
  TimelineResponse,
  UpdatesResponse,
} from "../api/types.ts";
import { Chip, PartyChip, RowLink } from "../format/chips.tsx";
import { fmtOffset, trimZeros, ts } from "../format/format.ts";
import { ContractHead, ContractRow, UpdateRows } from "../format/rows.tsx";
import { LifelineChart } from "../pages/TimelineChart.tsx";
import { hashQuery, hashWith, href, setHashParams } from "../route/hash.ts";
import { KNOWN_HOLDING_INTERFACE, useSession } from "../session/SessionContext.tsx";

// How many contract rows are fetched at once. The list route (/api/contracts?party=) gives every row in
// one call, so no row is asked for a second time — walking a list of contract ids and fetching each
// detail would be 51 calls for 50 rows.
const CONTRACT_ROWS_MAX = 200;
// How many rows the table draws at once — the rest via "Show more". What was fetched is not re-asked.
const SHOW_STEP = 25;

const TABS = [
  { key: "contracts", label: "Contracts" },
  { key: "transactions", label: "Transactions" },
  { key: "tokens", label: "Tokens" },
  { key: "timeline", label: "Timeline" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// Everything read at one point. **Held as a single lump** — kept per field, one of them arriving late
// would let the heading and the table speak of different points in time.
type Read = {
  party: PartyResponse;
  contracts: ContractsResponse;
  updates: UpdatesResponse;
  holdings: HoldingsCache;
  preapprovals: PreapprovalsCache;
};

export function PartyDetail({ partyId, hash }: { partyId: string; hash: string }) {
  const { api, lastOffset, loading, generation, myParties, holdingsCache, preapprovalsCache } =
    useSession();
  const q = hashQuery(hash);
  const tabParam = q.get("tab") ?? "";
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "contracts";
  // The address offset is used **verbatim** (the server judges). Without one, the session's current offset.
  const asOfRaw = q.get("offset") ?? "";
  // The Timeline tab's window start. **The end is not chosen** — it is where this party last moved (below).
  const timelineFrom = q.get("from") ?? "";
  const travelling = asOfRaw !== "";
  const atParam = travelling ? asOfRaw : lastOffset === null ? "" : String(lastOffset);

  const [read, setRead] = useState<Read | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(SHOW_STEP);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offsetInput, setOffsetInput] = useState(asOfRaw);
  const [fromInput, setFromInput] = useState(timelineFrom);

  // What the session already read (balances, preapprovals) is **copied once at the moment of reading**
  // and bound to this screen's one point. Looking at the cache directly while drawing would mix new
  // balances with old contracts on one screen while the session re-reads.
  const cached = useRef<{ holdings: HoldingsCache; preapprovals: PreapprovalsCache }>({
    holdings: holdingsCache,
    preapprovals: preapprovalsCache,
  });
  useEffect(() => {
    cached.current = { holdings: holdingsCache, preapprovals: preapprovalsCache };
  }, [holdingsCache, preapprovalsCache]);

  // The Timeline tab's material is **the whole window** and the server does that counting
  // (/api/timeline). The Transactions tab reads 25 at a time in pages, so the same response cannot be
  // shared — hence one more request, only when that tab is opened.
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const wran = useRef<string | null>(null);
  useEffect(() => {
    if (tab !== "timeline" || loading || atParam === "" || read === null) return;
    // **The end is this party's last activity.** Left at the ledger end, a party that has been quiet
    // for a while turns the right half of the screen into empty margin — and that margin is not
    // something a screen about this party has to answer for.
    // With no activity in the window, the point read is used as is (there is nothing to draw then).
    const endParam = String(read.updates.rows[0]?.offset ?? atParam);
    const key = `${generation}|${partyId}|${endParam}|${timelineFrom}`;
    if (wran.current === key) return;
    wran.current = key;
    let cancelled = false;
    setTimeline(null);
    api<TimelineResponse>(
      `/api/timeline?offset=${encodeURIComponent(endParam)}&party=${encodeURIComponent(partyId)}` +
        // The start too is the address value verbatim — what makes a window is the server's judgement.
        (timelineFrom ? `&from=${encodeURIComponent(timelineFrom)}` : ""),
    ).then(
      (res) => {
        if (!cancelled) setTimeline(res);
      },
      (e: unknown) => {
        if (!cancelled) setError(messageOf(e));
      },
    );
    return () => {
      cancelled = true;
      if (wran.current === key) wran.current = null;
    };
  }, [api, tab, loading, generation, partyId, atParam, timelineFrom, read]);

  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (loading || atParam === "") return;
    const key = `${generation}|${partyId}|${atParam}`;
    if (ran.current === key) return;
    ran.current = key;
    let cancelled = false;
    setRead(null);
    setError(null);
    setShown(SHOW_STEP);
    const who = encodeURIComponent(partyId);
    const at = `offset=${encodeURIComponent(atParam)}`;
    (async () => {
      // Read together at one point — there is no reason to read in sequence, and the ledger does not
      // move between the lines (the same offset).
      const [party, contracts, updates, holdings, preapprovals] = await Promise.all([
        api<PartyResponse>(`/api/party/${who}?${at}`),
        api<ContractsResponse>(`/api/contracts?${at}&pageSize=${CONTRACT_ROWS_MAX}&party=${who}`),
        api<UpdatesResponse>(`/api/updates?${at}&party=${who}`),
        // Read separately only while time travelling — at now, what the session read is the same point.
        travelling
          ? api<HoldingsResponse>(
              `/api/holdings?${at}&holdingInterfaceId=${encodeURIComponent(KNOWN_HOLDING_INTERFACE)}`,
            )
          : null,
        travelling
          ? api<PreapprovalsResponse>(
              `/api/preapprovals?${at}&asOf=${encodeURIComponent(new Date().toISOString())}`,
            )
          : null,
      ]);
      if (cancelled) return;
      setRead({
        party,
        contracts,
        updates,
        holdings:
          holdings === null
            ? cached.current.holdings
            : holdings.kind === "available"
              ? { groups: holdings.view.groups }
              : { groups: [], failed: holdings.reason ?? "reason unknown" },
        preapprovals:
          preapprovals === null
            ? cached.current.preapprovals
            : preapprovals.kind === "available"
              ? { rows: preapprovals.view.rows }
              : { rows: [], failed: preapprovals.reason ?? "reason unknown" },
      });
    })().catch((e: unknown) => {
      // **The whole screen is not wiped** — wiping takes the offset field and Now with it, leaving no
      // way back but editing the address. Only the fact that it could not be read is written; the
      // toolbar stays standing.
      if (!cancelled) setError(messageOf(e));
    });
    return () => {
      cancelled = true;
      // An abandoned run clears its own marker (ran) — left behind, a re-entering run with the same key turns
      // back saying "already read", and the discarded response and unsent request leave the screen blank.
      if (ran.current === key) ran.current = null;
    };
  }, [api, loading, generation, partyId, atParam, travelling]);

  // When the address changes the fields mirror it — only at that moment (every draw would wipe typing).
  const lastAsOf = useRef(asOfRaw);
  useEffect(() => {
    if (lastAsOf.current === asOfRaw) return;
    lastAsOf.current = asOfRaw;
    setOffsetInput(asOfRaw);
  }, [asOfRaw]);
  const lastFrom = useRef(timelineFrom);
  useEffect(() => {
    if (lastFrom.current === timelineFrom) return;
    lastFrom.current = timelineFrom;
    setFromInput(timelineFrom);
  }, [timelineFrom]);

  // "Older" on the Transactions tab — hands the server's nextBefore straight back and appends the rows
  // that arrive. An answer that lands after the conditions changed is dropped (if ran differs from the
  // marker of that moment, the answer belongs to an older point).
  const older = async () => {
    const before = read?.updates.nextBefore;
    if (read === null || before === null || before === undefined || loadingMore) return;
    const key = ran.current;
    if (key === null) return;
    setLoadingMore(true);
    try {
      const more = await api<UpdatesResponse>(
        `/api/updates?offset=${encodeURIComponent(atParam)}&party=${encodeURIComponent(partyId)}&before=${before}`,
      );
      if (ran.current !== key) return;
      setRead((prev) =>
        prev === null
          ? prev
          : { ...prev, updates: { ...more, rows: prev.updates.rows.concat(more.rows ?? []) } },
      );
    } catch (e: unknown) {
      if (ran.current === key) setError(messageOf(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const applyFrom = (event: FormEvent) => {
    event.preventDefault();
    setHashParams({ from: fromInput.trim() || null });
  };
  const applyAsOf = (event: FormEvent) => {
    event.preventDefault();
    // An empty field returns to now. Any other value rides into the address unjudged — the server answers.
    setHashParams({ offset: offsetInput.trim() || null });
  };

  // The offset the heading states is **the value the response stated** — while the address changes
  // first and the answer follows, heading and table still speak of the same point.
  const readAt = read === null ? null : (read.contracts.offset ?? read.party.offset ?? null);

  const toolbar = (
    <>
      {/* Time travel — this row changes everything below it (details, contracts, transactions and
          tokens all look at the same point). */}
      <ToolbarForm id="party-as-of" onSubmit={applyAsOf}>
        <label htmlFor="party-offset">
          As of offset{" "}
          <TextInput
            id="party-offset"
            mono
            placeholder="ledger offset"
            value={offsetInput}
            onChange={(e) => setOffsetInput(e.target.value)}
          />
        </label>
        <Button type="submit" variant="primary">
          Apply
        </Button>
        {travelling ? (
          <>
            <Button id="party-now" onClick={() => setHashParams({ offset: null })}>
              Now
            </Button>
            <ToolbarFlag>time travel</ToolbarFlag>
          </>
        ) : null}
      </ToolbarForm>
      {error === null ? null : (
        <SectionBody>
          <Banner id="party-error">Could not read this party — {error}</Banner>
        </SectionBody>
      )}
    </>
  );

  if (read === null) {
    return (
      <div id="party">
        <Section id="party-box" title="Party details">
          {toolbar}
        </Section>
      </div>
    );
  }

  const { party, contracts, updates, holdings, preapprovals } = read;
  const mine = myParties.includes(partyId);
  const rows = contracts.rows ?? [];
  // The number of contracts caught together with this party is what the list stated (matched) — the
  // screen does not count rows.
  const withParty = contracts.matched ?? rows.length;
  const held = holdings.groups.filter((g) => g.owner === partyId);
  const heldContracts = held.reduce((n, g) => n + g.contractCount, 0);
  const pre = preapprovals.rows.filter((r) => r.receiver === partyId);
  // "My role" — only counts each row's myRoles (the server's explainVisibility judgement). When the
  // rows fetched are not all of them, that fact is written too (the 200-row limit).
  const signatoryIn = rows.filter((r) =>
    r.myRoles.some((m) => m.roles.includes("signatory")),
  ).length;
  const observerIn = rows.filter(
    (r) =>
      !r.myRoles.some((m) => m.roles.includes("signatory")) &&
      r.myRoles.some((m) => m.roles.includes("observer")),
  ).length;
  const partial = withParty > rows.length;
  // Last activity — the latest update in the window. Canton has no blocks, and the ledger offset takes
  // that place.
  const latest = updates.rows[0] ?? null;
  const windowFrom = fmtOffset(updates.beginExclusive ?? 0);
  const windowTo = fmtOffset(updates.offset ?? 0);

  return (
    <div id="party">
      <Section
        id="party-box"
        title="Party details"
        note={
          readAt === null
            ? undefined
            : travelling
              ? `as of offset ${fmtOffset(readAt)} — a past point, not now`
              : `read at offset ${fmtOffset(readAt)}`
        }
      >
        {toolbar}
        <SectionBody>
          <DescriptionList variant="rows">
            <dt>Party ID</dt>
            <dd>
              {/* On its own page the whole id shows — there is no reason to shorten it (with n larger
                  than half the length, truncate leaves it alone). */}
              <Chip value={partyId} n={256} />
            </dd>
            <dt>Relationship</dt>
            <dd>
              {party.status !== "found" ? (
                "Not a party you can look up on this instance"
              ) : mine ? (
                <>
                  <Badge>my party</Badge> I read the ledger as this party
                </>
              ) : (
                "counterparty — appears in contracts together with you"
              )}
            </dd>
            <dt>Contracts</dt>
            <dd>
              {party.status !== "found" ? (
                <Muted>none visible</Muted>
              ) : mine ? (
                `${withParty} visible to me`
              ) : (
                <>
                  only the {withParty} where you and this party both appear{" "}
                  <Muted>(not everything this party has)</Muted>
                </>
              )}
            </dd>
            {/* "Why these are visible to me" — the per-contract judgement (myRoles) is in the table;
                this is the count of it. */}
            <dt>My role in them</dt>
            <dd>
              {rows.length === 0 ? (
                <Muted>–</Muted>
              ) : (
                <>
                  signatory in <b>{signatoryIn}</b> · observer only in <b>{observerIn}</b>
                  {partial ? (
                    <Muted>
                      {" "}
                      (of the {rows.length} read — this party has {withParty})
                    </Muted>
                  ) : null}
                </>
              )}
            </dd>
            {/* Reuses the sums the server made (holdings) — nothing is recomputed here. The balances
                themselves are on the Tokens tab. */}
            <dt>Tokens</dt>
            <dd>
              {holdings.failed ? (
                <Banner as="span" style={{ display: "inline-block", padding: "2px 8px" }}>
                  Could not fetch — {said(holdings.failed)}
                </Banner>
              ) : held.length === 0 ? (
                <Muted>none visible to you</Muted>
              ) : (
                <>
                  <b>{held.length}</b> {held.length === 1 ? "instrument" : "instruments"} ·{" "}
                  {heldContracts} {heldContracts === 1 ? "contract" : "contracts"}{" "}
                  <a href={hashWith({ tab: "tokens" }, hash)}>see balances</a>
                  {mine ? null : <Muted> — only what is visible to you</Muted>}
                </>
              )}
            </dd>
            {/* Canton has no blocks. The offset is the mark that answers "in which block did it last
                move". */}
            <dt>Last activity</dt>
            <dd>
              {latest === null ? (
                <Muted>
                  nothing in the window read (offsets {windowFrom}–{windowTo}) — older history is
                  not in this view
                </Muted>
              ) : (
                <>
                  <a href={href.tx(latest.updateId)}>
                    <Mono>offset {fmtOffset(latest.offset)}</Mono>
                  </a>{" "}
                  <Muted>· {ts(latest.effectiveAt)}</Muted>{" "}
                  <Muted>(Canton has no blocks — the offset is that mark)</Muted>
                </>
              )}
            </dd>
            {/* Instruments this party has preapproved to receive. Exactly as the server judged the expiry. */}
            <dt>Preapproved to receive</dt>
            <dd>
              {preapprovals.failed ? (
                <Banner as="span" style={{ display: "inline-block", padding: "2px 8px" }}>
                  Could not fetch — {said(preapprovals.failed)}
                </Banner>
              ) : pre.length === 0 ? (
                <Muted>none visible to you</Muted>
              ) : (
                <>
                  {pre.map((r, i) => (
                    <span key={r.contractId}>
                      {i > 0 ? " · " : ""}
                      <b>{r.instrumentId}</b>{" "}
                      {r.expiry.passed ? (
                        <span className="expired">(expired)</span>
                      ) : (
                        <Muted>({Math.round((r.expiry.remainingMs ?? 0) / 60000)}m left)</Muted>
                      )}
                    </span>
                  ))}
                  {/* Expiry is a matter of clock time, so it is judged against the clock now even as
                      the offset moves — say so. */}
                  {travelling ? <Muted> — expiry judged against the clock now</Muted> : null}
                </>
              )}
            </dd>
          </DescriptionList>
        </SectionBody>
      </Section>

      {/* The branch lives in the address (?tab=) — reload, back and link sharing all just work. */}
      <Tabs id="party-tabs">
        {TABS.map((t) => (
          <Tab
            key={t.key}
            href={hashWith({ tab: t.key === "contracts" ? null : t.key }, hash)}
            current={t.key === tab}
          >
            {t.label}
          </Tab>
        ))}
      </Tabs>

      {tab === "contracts" ? (
        <Section
          id="party-contracts-box"
          title="Contracts"
          note={`${withParty} where you and this party both appear${readAt === null ? "" : ` · read at offset ${fmtOffset(readAt)}`}`}
        >
          <Scroll>
            <Table id="party-list">
              <tbody>
                {rows.length === 0 ? (
                  <MessageRow>No active contracts with this party are visible to you</MessageRow>
                ) : (
                  <>
                    <ContractHead />
                    {rows.slice(0, shown).map((r) => (
                      <ContractRow key={r.contractId} r={r} />
                    ))}
                    {partial ? (
                      <MessageRow colSpan={4}>
                        This screen reads the first {rows.length} of {withParty} — the rest are not
                        read here
                      </MessageRow>
                    ) : null}
                  </>
                )}
              </tbody>
            </Table>
          </Scroll>
          <Pager>
            {shown < rows.length ? (
              <Button size="xs" id="party-more" onClick={() => setShown(shown + SHOW_STEP)}>
                Show more
              </Button>
            ) : null}
            <span id="party-list-note">
              {rows.length === 0
                ? ""
                : `${Math.min(shown, rows.length)} of ${rows.length} read shown · newest first`}
            </span>
          </Pager>
        </Section>
      ) : null}

      {tab === "transactions" ? (
        <Section
          id="party-updates-box"
          title="Transactions"
          note={`${updates.matched ?? 0} of the ${updates.total ?? 0} updates in this window touch this party`}
          foot={`The window is the recent range the node still keeps (offsets ${windowFrom}–${windowTo}), not all history. An update carrying only an archive does not match on a counterparty's id — the ledger does not carry the parties on that event.`}
        >
          <Scroll>
            <Table id="party-updates">
              <tbody>
                {updates.rows.length === 0 ? (
                  <MessageRow>
                    Nothing in this window touches this party — older history is not in this view
                  </MessageRow>
                ) : (
                  // Clicking an offset moves to the state at that point — "what did I hold just before
                  // this transaction".
                  <UpdateRows
                    rows={updates.rows}
                    offsetHref={(o) => hashWith({ offset: String(o) }, hash)}
                  />
                )}
              </tbody>
            </Table>
          </Scroll>
          <Pager>
            {updates.nextBefore !== null && updates.nextBefore !== undefined ? (
              <Button
                size="xs"
                id="party-updates-more"
                disabled={loadingMore}
                onClick={() => void older()}
              >
                Older
              </Button>
            ) : null}
            <span id="party-updates-note">
              {updates.rows.length === 0
                ? ""
                : `${updates.rows.length} of ${updates.matched ?? updates.rows.length} shown · newest first`}
            </span>
          </Pager>
        </Section>
      ) : null}

      {tab === "timeline" ? (
        <Section
          id="party-timeline-box"
          title="Timeline"
          note={
            timeline === null
              ? "contract lifetimes on the ledger offset axis"
              : `${timeline.total} · offsets ${fmtOffset(timeline.from ?? 0)}–${fmtOffset(timeline.offset ?? 0)}`
          }
          foot="One bar is one contract you and this party both appear on, from the update that created it to the update that archived it. The window ends where this party last moved, not at the ledger end - a party that has been quiet for a while would otherwise get half a screen of empty. A contract alive through the whole window has no event in it: it comes from the active contracts at the same offset, so its bar runs the full width with a faded left edge. One archived before the window is in neither source and cannot be drawn."
        >
          {/* Only the start is chosen — the end is where this party last moved. Empty means the recent
              window back from there: widened until it holds the recent transactions. */}
          <ToolbarForm id="party-timeline-window" onSubmit={applyFrom}>
            <label htmlFor="party-timeline-from">
              Offsets from{" "}
              <TextInput
                id="party-timeline-from"
                mono
                narrow
                placeholder="recent"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
              />
            </label>
            <Button type="submit" variant="primary">
              Apply
            </Button>
            {timelineFrom === "" ? null : (
              <Button id="party-timeline-clear" onClick={() => setHashParams({ from: null })}>
                Clear
              </Button>
            )}
            <Muted>ends at this party's last activity</Muted>
          </ToolbarForm>
          {timeline === null ? (
            <Scroll>
              <Table id="party-timeline-waiting">
                <tbody>
                  <MessageRow>Reading the window…</MessageRow>
                </tbody>
              </Table>
            </Scroll>
          ) : timeline.total === 0 ? (
            <Scroll>
              <Table id="party-timeline-empty">
                <tbody>
                  <MessageRow>
                    Nothing with this party lived in this window — older history is not in this view
                  </MessageRow>
                </tbody>
              </Table>
            </Scroll>
          ) : (
            <LifelineChart
              groups={timeline.groups ?? []}
              total={timeline.total}
              window={{ from: timeline.from ?? 0, to: timeline.offset ?? 0 }}
            />
          )}
        </Section>
      ) : null}

      {tab === "tokens" ? (
        <Section
          id="party-tokens-box"
          title="Tokens"
          note="standard Holding interface only"
          foot="A balance is the sum of the Holding contracts visible to you — like UTXOs, one balance is made of several contracts. It is not the token's total supply."
        >
          <Scroll>
            <Table id="party-tokens">
              <tbody>
                {holdings.failed ? (
                  <MessageRow tone="problem">Could not fetch — {said(holdings.failed)}</MessageRow>
                ) : held.length === 0 ? (
                  <MessageRow>
                    No standard Holding contracts owned by this party are visible to you — app
                    tokens that do not implement the standard interface are not counted
                  </MessageRow>
                ) : (
                  <>
                    <tr>
                      <th>Instrument</th>
                      <th>Balance</th>
                      <th>Made of</th>
                    </tr>
                    {held.map((g) => (
                      <RowLink key={href.holding(g)} to={href.holding(g)}>
                        <td>
                          <a href={href.holding(g)}>
                            <b>{g.instrumentId}</b>
                          </a>
                        </td>
                        <td>
                          <Mono title={g.total}>
                            <b>{trimZeros(g.total)}</b>
                          </Mono>
                          {g.exactBalance === "unavailable_decay" ? (
                            <>
                              {" "}
                              <Muted>
                                face value — exact balance unavailable, this token decays per round
                              </Muted>
                            </>
                          ) : null}
                        </td>
                        <td>
                          <Muted>
                            made of {g.contractCount}{" "}
                            {g.contractCount === 1 ? "contract" : "contracts"}
                          </Muted>
                          {g.instrumentAdmin ? (
                            <Muted>
                              {" "}
                              · issued by <PartyChip value={g.instrumentAdmin} />
                            </Muted>
                          ) : null}
                        </td>
                      </RowLink>
                    ))}
                  </>
                )}
              </tbody>
            </Table>
          </Scroll>
        </Section>
      ) : null}
    </div>
  );
}
