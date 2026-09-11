// **The original as a table, as is** — no values are picked out. Every leaf of the JSON is one row, and
// nesting is written as a path:
//   kind › CanReadAs › value › party   alice::1220…  Copy
// So it carries the same information as raw — nothing drops out when the shape changes (a new kind, a new
// field). It does not interpret, only notates: a string that looks like a party is left whole and given a
// link and Copy (never truncated).
import { CopyButton, Inline, Mono, Muted, Table } from "@canton-lens/design-system";
import { Fragment, type ReactNode } from "react";
import { href } from "../route/hash.ts";

type Row = { path: string[]; value: ReactNode };

const isPartyId = (s: string) => /^[^:\s]+::[0-9a-f]{20,}$/i.test(s);
const isHexId = (s: string) => /^[0-9a-f]{32,}$/i.test(s);

function leaf(v: unknown): ReactNode {
  if (v === null) return <Muted>null</Muted>;
  if (typeof v === "string") {
    if (v === "") return <Muted>""</Muted>;
    if (isPartyId(v))
      return (
        <Inline>
          <a className="clds-mono" href={href.party(v)} style={{ whiteSpace: "normal" }}>
            {v}
          </a>
          <CopyButton value={v} />
        </Inline>
      );
    if (isHexId(v))
      return (
        <Inline>
          <Mono style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{v}</Mono>
          <CopyButton value={v} />
        </Inline>
      );
    return <span style={{ overflowWrap: "anywhere" }}>{v}</span>;
  }
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint")
    return <Mono>{String(v)}</Mono>;
  return <Mono>{JSON.stringify(v)}</Mono>;
}

// Collect the leaves depth first. An empty object or an empty array is a row too ("nothing" is information).
function collect(v: unknown, path: string[], out: Row[]): void {
  if (Array.isArray(v)) {
    if (v.length === 0) out.push({ path, value: <Muted>[]</Muted> });
    else
      v.forEach((x, i) => {
        collect(x, [...path, String(i)], out);
      });
    return;
  }
  if (typeof v === "object" && v !== null) {
    const keys = Object.keys(v);
    if (keys.length === 0) out.push({ path, value: <Muted>{"{}"}</Muted> });
    else for (const k of keys) collect((v as Record<string, unknown>)[k], [...path, k], out);
    return;
  }
  out.push({ path, value: leaf(v) });
}

// When the top level is an array, each element gets a group head (its number), and the paths inside are
// written relative to that element.
export function JsonTable({ value }: { value: unknown }) {
  const groups: { head: string | null; rows: Row[] }[] = [];
  if (Array.isArray(value) && value.length > 0) {
    value.forEach((item, i) => {
      const rows: Row[] = [];
      collect(item, [], rows);
      groups.push({ head: String(i + 1), rows });
    });
  } else {
    const rows: Row[] = [];
    collect(value, [], rows);
    groups.push({ head: null, rows });
  }
  return (
    <Table variant="fields" className="json-table">
      <tbody>
        {groups.map((g, gi) => (
          // A group is identified by its position (an array element).
          // biome-ignore lint/suspicious/noArrayIndexKey: an element is identified by its position
          <Fragment key={gi}>
            {g.head !== null ? (
              <tr className="json-table__head">
                <td colSpan={2}>
                  <Muted>{g.head}</Muted>
                </td>
              </tr>
            ) : null}
            {g.rows.map((r) => (
              // A row is identified by its path — within one group a leaf's path is unique.
              <tr key={r.path.join("/") || "value"}>
                <td className="json-table__path">
                  {r.path.length === 0 ? (
                    <Muted>value</Muted>
                  ) : (
                    r.path.map((seg, si) => (
                      <span key={r.path.slice(0, si + 1).join("/")}>
                        {si > 0 ? <span className="json-table__sep">›</span> : null}
                        {seg}
                      </span>
                    ))
                  )}
                </td>
                <td>{r.value}</td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </Table>
  );
}
