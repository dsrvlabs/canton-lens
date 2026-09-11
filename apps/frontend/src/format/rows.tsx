// Table rows — one line for a contract, one for a transaction. The contract list and the list on the party
// page have to look the same to read as the same thing, and so do Home's Latest transactions and the
// Transactions screen.
import { Badge, Faint, Inline, Mono, Muted } from "@canton-lens/design-system";
import type { ContractListRow, RecentUpdateRow, VisibilityReason } from "../api/types.ts";
import { href } from "../route/hash.ts";
import { ContractLink, Copy, RowLink } from "./chips.tsx";
import { short, shortParty, ts } from "./format.ts";

// "My role" is what the server (explainVisibility) decided as signatories · observers ∩ my parties
// (myRoles) — here, chips only.
export function RoleChips({ myRoles }: { myRoles: readonly VisibilityReason[] | undefined }) {
  const roles = myRoles ?? [];
  if (roles.length === 0) return <Muted>–</Muted>;
  return (
    <>
      {roles.map((m, i) => (
        <span key={m.party}>
          {i > 0 ? " " : ""}
          <Badge title={m.party}>
            {shortParty(m.party)} · {m.roles.join("+")}
          </Badge>
        </span>
      ))}
    </>
  );
}

export type ContractRowData = Pick<
  ContractListRow,
  "contractId" | "entity" | "module" | "package" | "packageName" | "createdAt"
> & { myRoles: readonly VisibilityReason[] };

// One contract line — four columns: template · contract id · my role · created at. The template is
// Entity + packageName and the package hash goes in title (the same name with a different hash does occur —
// versions are not in layer 1).
export function ContractRow({ r }: { r: ContractRowData }) {
  return (
    <RowLink to={href.contract(r.contractId)}>
      <td>
        <b>{r.entity}</b> <Muted>{r.module}</Muted>
        <br />
        <Mono className="clds-muted" title={`package id ${r.package}`}>
          {r.packageName ?? short(r.package, 8)}
        </Mono>
      </td>
      <td>
        <ContractLink id={r.contractId} />
      </td>
      <td>
        <RoleChips myRoles={r.myRoles} />
      </td>
      <td>
        <Mono className="clds-muted">{ts(r.createdAt)}</Mono>
      </td>
    </RowLink>
  );
}

export const ContractHead = () => (
  <tr>
    <th>Template</th>
    <th>Contract ID</th>
    <th>My role</th>
    <th>Created</th>
  </tr>
);

// **Transaction row** — four columns: time · summary · update id · offset (for developers, hidden on narrow
// screens). There is no amount column — not every update is a token movement. The summary stays at the level
// of the events' template names.
// No link is made for an archived contract — contract detail is read from the ACS (active), so clicking it
// would only give a 404.
const SUMMARY_CHIPS = 2;
export const UpdateHead = () => (
  <tr>
    <th>Time</th>
    <th>Summary</th>
    <th>Update ID</th>
    <th className="clds-hide-narrow">Offset</th>
  </tr>
);

// With offsetHref the offset cell becomes a link — the party page hangs "see it as of this point" there.
// Without it, the number alone (Transactions and Home have no point in time to move to).
export function UpdateRows({
  rows,
  offsetHref,
}: {
  rows: readonly RecentUpdateRow[];
  offsetHref?: (offset: number) => string;
}) {
  return (
    <>
      <UpdateHead />
      {rows.map((r) => (
        <RowLink key={r.updateId} to={href.tx(r.updateId)}>
          <td>
            <Mono className="clds-muted">{ts(r.effectiveAt)}</Mono>
          </td>
          <td>
            {r.events.slice(0, SUMMARY_CHIPS).map((e, i) => (
              <span key={`${e.kind}-${e.contractId}`}>
                {i > 0 ? " " : ""}
                {e.kind === "created" ? (
                  <Badge
                    tone="positive"
                    shape="rounded"
                    mono
                    href={href.contract(e.contractId)}
                    title={e.contractId}
                  >
                    created {e.entity}
                  </Badge>
                ) : (
                  <Badge
                    tone="negative"
                    shape="rounded"
                    mono
                    title={`${e.contractId} — archived, no detail page in this mode`}
                  >
                    archived {e.entity}
                  </Badge>
                )}
              </span>
            ))}
            {r.events.length > SUMMARY_CHIPS ? (
              <>
                {" "}
                <Faint>and {r.events.length - SUMMARY_CHIPS} more</Faint>
              </>
            ) : null}
            {/* "Submitted by you" — commandId is a field that reaches only the submitting party. The
              decision (submittedByYou) is the server's; here, the chip only. */}
            {r.submittedByYou ? (
              <>
                {" "}
                <Badge>Submitted by you</Badge>
              </>
            ) : null}
          </td>
          <td>
            <Inline>
              <a className="clds-mono" href={href.tx(r.updateId)} title={r.updateId}>
                {short(r.updateId, 8)}
              </a>
              <Copy value={r.updateId} />
            </Inline>
          </td>
          <td className="clds-hide-narrow">
            {offsetHref === undefined ? (
              <Mono>{r.offset}</Mono>
            ) : (
              <a
                className="clds-mono"
                href={offsetHref(r.offset)}
                title={`See the state as of offset ${r.offset}`}
              >
                {r.offset}
              </a>
            )}
          </td>
        </RowLink>
      ))}
    </>
  );
}
