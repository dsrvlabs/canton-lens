// Hash and party chips. **A hash is shown cut short but its full value is never taken away** — title shows
// it whole and the Copy button copies it.
// The look of the pieces (Inline · CopyButton · Badge · truncate) belongs to the design system; what remains
// here is "what has a page of its own" and "which party is me" — the domain.
import {
  Badge,
  CopyButton,
  RowLink as DsRowLink,
  Inline,
  Mono,
  Muted,
  truncate,
} from "@canton-lens/design-system";
import type { ReactNode } from "react";
import { href } from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";
import { shortParty } from "./format.ts";

export function Copy({ value }: { value: string }) {
  return <CopyButton value={value} />;
}

// tail — when the distinguishing value sits at the end (a fingerprint, a hash tail), show it as
// "first 4 … last 6" rather than from the head.
export function Chip({
  value,
  n = 10,
  tail = false,
}: {
  value: string | null | undefined;
  n?: number;
  tail?: boolean;
}) {
  if (typeof value !== "string" || value === "") return <Muted>none</Muted>;
  const shown =
    tail && value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-6)}` : truncate(value, n);
  return (
    <Inline>
      <Mono title={value}>{shown}</Mono>
      <CopyButton value={value} />
    </Inline>
  );
}

// Contract id link + copy — a contract has a detail page of its own.
export function ContractLink({ id, n = 10 }: { id: string; n?: number }) {
  return (
    <Inline>
      <a className="clds-mono" href={href.contract(id)} title={id}>
        {truncate(id, n)}
      </a>
      <CopyButton value={id} />
    </Inline>
  );
}

// A party has a page of its own. My own party gets a different chip color — in a list "me" and "the other
// side" split at a glance.
export function PartyChip({ value }: { value: string | null | undefined }) {
  const { myParties } = useSession();
  if (typeof value !== "string" || value === "") return <Muted>none</Muted>;
  const mine = myParties.includes(value);
  return (
    <Badge tone={mine ? "accent" : "solid"} shape="rounded">
      <Inline>
        <a className="clds-mono" href={href.party(value)} title={value}>
          {shortParty(value)}
        </a>
        <CopyButton value={value} />
      </Inline>
    </Badge>
  );
}

export function PartyList({ values }: { values: readonly string[] | null | undefined }) {
  const list = values ?? [];
  if (list.length === 0) return <Muted>none</Muted>;
  return (
    <>
      {list.map((p, i) => (
        <span key={p}>
          {i > 0 ? " " : ""}
          <PartyChip value={p} />
        </span>
      ))}
    </>
  );
}

// A thin layer tying an address to "the whole row is a link" — this app knows where it goes, and the design
// system does the delegating.
export function RowLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DsRowLink
      onActivate={() => {
        location.hash = to;
      }}
      className={className}
    >
      {children}
    </DsRowLink>
  );
}
