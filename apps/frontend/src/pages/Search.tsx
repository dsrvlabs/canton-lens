// Search results — ids match only exactly, names are looked up inside the catalog. One section per
// kind; a partial failure says "could not fetch + reason" in that section. The server (/api/search)
// makes the results — here we draw them. **The screen never judges the kind itself.**
import {
  Badge,
  Banner,
  Mono,
  Muted,
  Section,
  SectionBody,
  Table,
} from "@canton-lens/design-system";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { messageOf } from "../api/client.ts";
import { SAID_KIND, said } from "../api/said.ts";
import type { SearchResponse } from "../api/types.ts";
import { Chip, PartyChip, RowLink } from "../format/chips.tsx";
import { short, ts } from "../format/format.ts";
import { hashQuery, href } from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";

type ResultGroup<T> =
  | { status: "ok"; rows: T[] }
  | { status: "unavailable"; reason: string }
  | { status: "not_applicable" };

export function Search({ hash }: { hash: string }) {
  const { api, loading, generation } = useSession();
  const q = hashQuery(hash).get("q") ?? "";
  const [r, setR] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(true);

  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const key = `${generation}|${q}`;
    if (ran.current === key) return;
    ran.current = key;
    let cancelled = false;
    setSearching(true);
    setError(null);
    api<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`).then(
      (res) => {
        if (cancelled) return;
        setR(res);
        setSearching(false);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(messageOf(e));
        setSearching(false);
      },
    );
    return () => {
      cancelled = true;
      // An abandoned run clears its own marker (ran) — left behind, a re-entering run with the same key turns
      // back saying "already read", and the discarded response and unsent request leave the screen blank.
      if (ran.current === key) ran.current = null;
    };
  }, [api, loading, generation, q]);

  const kind = r ? (SAID_KIND[r.kind] ?? r.kind) : "";
  const res = r?.results;

  // Four result sections plus one line on the absence of full-text search. Failures speak in their section.
  const section = <T,>(
    title: string,
    sec: ResultGroup<T> | undefined,
    body: (rows: T[]) => ReactNode,
  ): ReactNode => {
    if (!sec || sec.status === "not_applicable") return null;
    if (sec.status === "unavailable") {
      return (
        <div key={title}>
          <h3 style={{ margin: "14px 0 6px", fontSize: 13 }}>{title}</h3>
          <Banner>Could not fetch — {said(sec.reason)}</Banner>
        </div>
      );
    }
    const partial = title === "Templates" || title === "Packages";
    return (
      <div key={title}>
        <h3 style={{ margin: "14px 0 6px", fontSize: 13 }}>
          {title} <Muted>{sec.rows.length}</Muted>
        </h3>
        {sec.rows.length === 0 ? (
          <p className="clds-muted">{partial ? "No match in your catalog" : "No exact match"}</p>
        ) : (
          body(sec.rows)
        )}
      </div>
    );
  };

  const sections = res
    ? [
        section("Updates", res.updates, (rows) => (
          <Table>
            <tbody>
              {rows.map((u) => (
                <RowLink key={u.updateId} to={href.tx(u.updateId)}>
                  <td>
                    <a className="clds-mono" href={href.tx(u.updateId)}>
                      {short(u.updateId, 12)}
                    </a>
                  </td>
                  <td>
                    <Mono className="clds-muted">offset {u.offset ?? "–"}</Mono>
                  </td>
                  <td>
                    <Mono className="clds-muted">{ts(u.effectiveAt)}</Mono>
                  </td>
                  <td>
                    <Muted>{u.kind}</Muted>
                  </td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )),
        section("Contracts", res.contracts, (rows) => (
          <Table>
            <tbody>
              {rows.map((c) => (
                <RowLink key={c.contractId} to={href.contract(c.contractId)}>
                  <td>
                    <b>{c.entity}</b>{" "}
                    <Muted>
                      {c.module} · {c.packageName}
                    </Muted>
                  </td>
                  <td>
                    <Chip value={c.contractId} n={12} />
                  </td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )),
        section("Parties", res.parties, (rows) => (
          <Table>
            <tbody>
              {rows.map((p) => (
                <RowLink key={p.party} to={href.party(p.party)}>
                  <td>
                    <PartyChip value={p.party} />
                  </td>
                  <td>
                    <Muted>
                      {p.contractCount} {p.contractCount === 1 ? "contract" : "contracts"} together
                      with you
                    </Muted>
                  </td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )),
        section("Templates", res.templates, (rows) => (
          <Table>
            <tbody>
              {rows.map((t) => (
                <RowLink key={t.templateId} to={href.contractsOfTemplate(t.module, t.entity)}>
                  <td>
                    <b>{t.entity}</b> <Muted>{t.module}</Muted>
                  </td>
                  <td>
                    <Mono className="clds-muted">{t.packageName}</Mono>
                  </td>
                  <td>
                    <Mono>
                      {t.contractCount} {t.contractCount === 1 ? "contract" : "contracts"}
                    </Mono>
                  </td>
                </RowLink>
              ))}
            </tbody>
          </Table>
        )),
        section("Packages", res.packages, (rows) => (
          <Table>
            <tbody>
              {rows.map((p) => (
                <tr key={p.packageId}>
                  <td>{p.name ? <b>{p.name}</b> : <Muted>name not in this layer</Muted>}</td>
                  <td>
                    <Chip value={p.packageId} n={16} />
                  </td>
                  <td>
                    {p.inMyContracts ? (
                      <Badge>in my contracts</Badge>
                    ) : (
                      <Muted>installed, not used by my contracts</Muted>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )),
      ].filter((x) => x !== null)
    : [];

  return (
    <div id="view-search">
      <Section
        id="search-box"
        title="Search results"
        note={<span id="search-note">{r ? `"${r.results.q}" read as ${kind}` : ""}</span>}
        foot={`Ids (update · contract · party) match exactly — there is no index, so "similar ids" is not a promise this screen can keep. Names (templates · packages) match partially, inside your own catalog. There is no full-text search.`}
      >
        <SectionBody id="search-results">
          {searching ? (
            <p className="clds-muted">Searching…</p>
          ) : error !== null ? (
            <Banner>{error}</Banner>
          ) : sections.length === 0 ? (
            <p className="clds-muted">Nothing to look up for this input.</p>
          ) : (
            sections
          )}
        </SectionBody>
      </Section>
    </div>
  );
}
