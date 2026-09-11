// **Typed value rendering** — draws the TypedValue the server (core typeValue) decided against the schema.
// Links are hung off kind alone; raw gets Raw JSON + why, for that field only. No value is interpreted here.
import { Badge, Disclosure, Mono, Muted, Scroll, Table } from "@canton-lens/design-system";
import { type CSSProperties, Fragment } from "react";
import type { ChoiceLite, TypedField, TypedValue as TypedValueT } from "../api/types.ts";
import { ContractLink, PartyChip } from "./chips.tsx";
import { trimZeros } from "./format.ts";

// A cell with no type in the schema — say so instead of an unexplained dash (the same attitude as the
// absent grammar).
export const NoType = () => <Muted>not in the schema</Muted>;

export function TypedValue({ tv }: { tv: TypedValueT | null | undefined }) {
  if (!tv) return <Muted>–</Muted>;
  switch (tv.kind) {
    case "party":
      return <PartyChip value={tv.value} />;
    case "contractId":
      return <ContractLink id={tv.value} n={12} />;
    case "text":
      return <span>{tv.value}</span>;
    case "numeric":
      return <Mono title={tv.value}>{trimZeros(tv.value)}</Mono>;
    case "int64":
    case "date":
    case "timestamp":
    case "enum":
      return <Mono>{tv.value}</Mono>;
    case "bool":
      return <Mono>{tv.value ? "True" : "False"}</Mono>;
    case "unit":
      return <Muted>()</Muted>;
    case "none":
      return <Muted>None</Muted>;
    case "list":
      return tv.items.length === 0 ? (
        <Muted>[]</Muted>
      ) : (
        <div className="nested">
          {tv.items.map((x, i) => (
            // Position is the name — a list element has no other key.
            // biome-ignore lint/suspicious/noArrayIndexKey: a list element is identified by its position
            <div key={i}>
              <Muted>{i}</Muted> <TypedValue tv={x} />
            </div>
          ))}
        </div>
      );
    case "record":
      return (
        <div className="nested">
          <TypedFields fields={tv.fields} />
        </div>
      );
    case "variant":
      return (
        <>
          <Mono>{tv.tag}</Mono> <TypedValue tv={tv.value} />
        </>
      );
    case "map":
      return tv.entries.length === 0 ? (
        <Muted>{"{}"}</Muted>
      ) : (
        <div className="nested">
          {tv.entries.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a map entry is identified by position (its key is a value)
            <div key={i}>
              <TypedValue tv={e.key} /> <Muted>→</Muted> <TypedValue tv={e.value} />
            </div>
          ))}
        </div>
      );
    default:
      return (
        <>
          <Mono>{JSON.stringify(tv.value)}</Mono>{" "}
          <span className="why" title={tv.why ?? ""}>
            raw — {tv.why ?? "shape did not match the schema"}
          </span>
        </>
      );
  }
}

// Typed payload (reading a contract's blueprint) — a type notation per field, links for parties and
// contracts, indentation for nesting. No prose summary.
// **Nesting (record · list · map) unfolds full width under the key row, not inside the value cell** — nesting
// a table inside the value cell pushes it right at every level, so three levels break out of the section and
// numbers wrap character by character in the narrowed cell (as seen on transaction detail).
const isNested = (tv: TypedValueT | null | undefined): boolean =>
  !!tv &&
  ((tv.kind === "record" && tv.fields.length > 0) ||
    (tv.kind === "list" && tv.items.length > 0) ||
    (tv.kind === "map" && tv.entries.length > 0));

export function TypedFields({ fields }: { fields: readonly TypedField[] }) {
  return (
    <Table variant="fields">
      <tbody>
        {fields.map((f) =>
          isNested(f.value) ? (
            <Fragment key={f.name}>
              <tr>
                <td className="typed-key">{f.name}</td>
                <td className="typed-type" colSpan={2}>
                  {f.value?.type ?? ""}
                </td>
              </tr>
              <tr className="typed-nested">
                <td colSpan={3}>
                  <TypedValue tv={f.value} />
                </td>
              </tr>
            </Fragment>
          ) : (
            <tr key={f.name}>
              <td className="typed-key">{f.name}</td>
              <td className="typed-type">{f.value?.type ?? ""}</td>
              <td>
                <TypedValue tv={f.value} />
              </td>
            </tr>
          ),
        )}
      </tbody>
    </Table>
  );
}

// The choices table — name · consuming · argument (field name: type, or just the type name for a record from
// another package) · return type. Read only.
// There is no exercise button and no link that leads to one — this app has no write path at all
// (docs/development.md, Backend core rules 4).
export function Choices({ choices }: { choices: readonly ChoiceLite[] | null | undefined }) {
  if (!choices || choices.length === 0) return <Muted>This template has no choices</Muted>;
  return (
    <Scroll>
      <Table variant="loose">
        <tbody>
          <tr>
            <th>Choice</th>
            <th>Consuming</th>
            <th>Argument</th>
            <th>Returns</th>
          </tr>
          {choices.map((c) => (
            <tr key={c.name}>
              <td>
                <Mono>
                  <b>{c.name}</b>
                </Mono>
              </td>
              <td>
                {c.consuming ? (
                  <Badge tone="negative" shape="rounded" mono>
                    consuming
                  </Badge>
                ) : (
                  <Badge tone="positive" shape="rounded" mono>
                    non-consuming
                  </Badge>
                )}
              </td>
              <td>
                {c.argFields === null || c.argFields === undefined ? (
                  c.argType ? (
                    <Mono>{c.argType}</Mono>
                  ) : (
                    <NoType />
                  )
                ) : c.argFields.length === 0 ? (
                  <>
                    <Mono>{c.argType ?? ""}</Mono> <Muted>(no fields)</Muted>
                  </>
                ) : (
                  <>
                    <Mono>{c.argType ?? ""}</Mono>
                    <div className="nested">
                      {c.argFields.map((f) => (
                        <div key={f.name}>
                          <span className="typed-key">{f.name}</span> <Muted>{f.type}</Muted>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </td>
              <td>{c.returnType ? <Mono>{c.returnType}</Mono> : <NoType />}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Scroll>
  );
}

// Raw JSON disclosure — arguments are Raw JSON from here on (the decoder is "more human words", not a
// precondition for showing them).
export function RawJson({
  label,
  value,
  open = false,
  style,
}: {
  label: string;
  value: unknown;
  open?: boolean;
  style?: CSSProperties;
}) {
  if (value === undefined || value === null) return null;
  return (
    <Disclosure summary={label} open={open} style={style}>
      <pre className="clds-mono clds-scroll">{JSON.stringify(value, null, 1)}</pre>
    </Disclosure>
  );
}
