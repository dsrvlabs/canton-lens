// Notation functions — notation, not value transformation. The original is left in title (at each call site).
// Truncation belongs to the design system (two copies would cut differently in lists and in details) — here
// only the name is borrowed.
import { truncate } from "@canton-lens/design-system";

export const short = truncate;

// **A party id is `hint::fingerprint`.** The hint is a human-readable name, so it is not cut (only at 64
// characters, when it is abnormally long) — parties hosted by one participant share a namespace key and so
// share the fingerprint too, which leaves the hint as the only distinguishing value.
// Of the fingerprint (1220 + 64 hex) only the **last 6 characters** are kept — the leading "1220" is the same
// multihash prefix on every fingerprint and distinguishes nothing.
// Cutting unconditionally at 10 characters clips the name to "InvestorPe…" and loses the fingerprint whole.
// A value without "::" is not shaped like a party id, so it falls back to plain truncation. The original is
// left in title at the call site.
export const shortParty = (id: string, hintMax = 64): string => {
  const at = id.indexOf("::");
  if (at === -1) return truncate(id, 10);
  const hint = id.slice(0, at);
  const fp = id.slice(at + 2);
  const hintShown = hint.length > hintMax ? `${hint.slice(0, hintMax)}…` : hint;
  const fpShown = fp.length > 8 ? `…${fp.slice(-6)}` : fp;
  return `${hintShown}::${fpShown}`;
};

// Offsets get thousands separators — the values run long, so nobody has to count digits by eye.
export const fmtOffset = (n: number | string): string => Number(n).toLocaleString("en-US");
export const fmtTime = (iso: string | null | undefined): string | null =>
  iso ? new Date(iso).toLocaleTimeString("en-GB") : null;
// An ISO timestamp down to the second — the time column of a table.
export const ts = (iso: string | null | undefined): string =>
  (iso ?? "").slice(0, 19).replace("T", " ");

// Time remaining in human words. Minutes → hours → days.
export const dur = (ms: number): string => {
  const m = Math.round(ms / 60000);
  if (m < 120) return `${m}m`;
  const h = Math.round(ms / 3600000);
  if (h < 48) return `${h}h`;
  return `${Math.round(ms / 86400000)}d`;
};

// Drop only the trailing zeros after the decimal point — lossless notation, and the original stays in title.
export const trimZeros = (s: unknown): string =>
  String(s ?? "").includes(".") ? String(s).replace(/0+$/, "").replace(/\.$/, "") : String(s ?? "");

// Right kinds in the screen's words — CanActAs → actAs, CanReadAs → readAs. Only the name changes.
export const kindsLabel = (kinds: readonly string[] | undefined): string =>
  (kinds ?? [])
    .map((k) => (k === "CanActAs" ? "actAs" : k === "CanReadAs" ? "readAs" : k))
    .join(", ");

export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

// For writing an inaccessible value (unknown) into a table — a string as is, anything else as JSON.
export const text = (v: unknown): string =>
  typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v);

// Time left until expiry in human words — "expired" once it has passed. The absolute time goes alongside
// in title at the call site.
export const untilSaid = (iso: string, now = Date.now()): string => {
  const ms = new Date(iso).getTime() - now;
  return ms <= 0 ? "expired" : `in ${dur(ms)}`;
};
