// **The format for writing the ledger's answers to a file and reading them back.** Writing and reading live
// together in this one file — kept apart, the format drifts quietly and nobody notices while it stays green.
//
// The key is **the question itself** (who · method · path · request body). In the old fixtures the file name
// was the key (`active-contracts.sample.json`), so "what was asked, and how" was written down nowhere. The
// result was that two paths and a body shape were wrong while every test passed. With the question as the key,
// our code asking something different **finds nothing and fails loudly.**
import type { LedgerSend } from "@canton-lens/core";

// One ledger request and its answer. One `.jsonl` line is one of these — split per line, a diff shows *which
// question's* answer changed (as a single JSON blob it collapses into one line).
export type TapeEntry = {
  /** Whose token asked. Some answers differ for the same path and body — identity lives in the header. */
  who: string;
  method: string;
  path: string;
  /** The request body. null for a GET. */
  body: unknown;
  status: number;
  /** The JSON answer. Package bytes do not go here (a separate file under packages/) — see `bytes` below. */
  response?: unknown;
  /** When the answer is bytes: the file name under packages/. It is protobuf, so base64 in JSON would grow it by 4/3. */
  bytes?: string;
};

// The key string. The request body is stringified with its **keys sorted** — so that the same question keys
// the same way even if the order our code builds objects in changes (putting order into the key would let a
// harmless refactor break the tape).
//
// **The person is always part of the key.** For a while package bytes, the ledger end and the version were
// excluded as "the same answer for everyone", which is true of the **body** and false of the **status**: the
// ledger can answer 403 based on the token (the package path's contract says so). If alice got a 200 and bob a
// 403, the two would collapse onto one key and replay would hand one person's authorization result to another.
//
// The reason for excluding the person back then was that the router cached packages, so the second and third
// person's fetches were never recorded. But that cache skipping authorization was itself the defect
// (router.ts loadSchema), and now that it is fixed every person really does ask the ledger — the reason to
// exclude them is gone.
export function tapeKey(who: string, method: string, path: string, body: unknown): string {
  return `${who} ${method} ${path} ${stableStringify(body)}`;
}

// **It mirrors exactly what goes on the wire.** The body is serialized with `JSON.stringify` before it leaves
// (the `send` in serve.mjs·record.mjs), so the key has to follow the same rules. Only key order is normalized.
//
// **Dropping keys whose value is `undefined`** is the point. `JSON.stringify({a:undefined})` is `{}`, so that
// and `{a:null}` are **different requests on the wire**, yet the earlier implementation collapsed both into
// `{"a":null}`. A collided key serves one answer to two questions — the kind of defect that quietly returns
// the wrong thing.
//
// Array **holes** and `toJSON` are aligned for the same reason:
//   · `Array(1)` (one hole) is `[null]` under `JSON.stringify`, but `.map` skips holes and produced `[]` —
//     colliding with `[]`. Hence the index loop.
//   · `new Date(0)` and `new Date(1)` give different strings from `toJSON`; ignoring it made both `{}`.
// NaN·Infinity·-0 become `null`·`0` just as `JSON.stringify` does (those are the values that go out).
function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined"; // top-level undefined — distinguished from “no body”
  // `JSON.stringify` calls `toJSON` before serializing. Ignoring it makes two objects with different values
  // share one key.
  if (value !== null && typeof value === "object") {
    const toJson = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJson === "function") {
      return stableStringify((toJson as () => unknown).call(value));
    }
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    // An index loop rather than `.map` — `.map` skips holes and would turn `Array(1)` into `[]`.
    const items: string[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      items.push(item === undefined ? "null" : stableStringify(item));
    }
    return `[${items.join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
  return `{${parts.join(",")}}`;
}

// ── Token ↔ person ──────────────────────────────────────────────────────────────
// The token used when running against the tape. **No real token goes into the tape** — only a person's name.
// This prefix is how replay works out who is asking (the recorder wraps `send` per person).
export const FAKE_TOKEN_PREFIX = "tape:";
export const fakeTokenFor = (who: string): string => `${FAKE_TOKEN_PREFIX}${who}`;

// ── Writing ─────────────────────────────────────────────────────────────────────
// Wraps the real `send` and records everything that passes through. The answer is passed straight along, so
// wrapping changes no behaviour.
export function recordingSend(
  real: LedgerSend,
  who: string,
  into: TapeEntry[],
  bytesInto: Map<string, Uint8Array>,
): LedgerSend {
  return async (request) => {
    const result = await real(request);
    const common = { who, method: request.method, path: request.path, body: request.body ?? null };
    if (result.body instanceof Uint8Array) {
      // Package bytes. The file name is the path's last segment (packageId) — being content-addressed, the
      // name *is* the hash of the content.
      const name = `${request.path.split("/").pop()}.bin`;
      bytesInto.set(name, result.body);
      into.push({ ...common, status: result.status, bytes: name });
    } else {
      into.push({ ...common, status: result.status, response: result.body ?? null });
    }
    return result;
  };
}

// ── Reading ─────────────────────────────────────────────────────────────────────
// Stands the tape up in the ledger's place. **A question that is not there throws** — answering a quiet 404
// would make "we asked the wrong thing" indistinguishable from "the ledger said it does not exist", and that
// distinction is why this tape exists.
export function replaySend(
  entries: readonly TapeEntry[],
  bytes: ReadonlyMap<string, Uint8Array>,
  /**
   * Questions that were not found collect here. This argument exists because throwing alone is not enough —
   * the router names a throwing `send` `unreachable` (504 "could not reach the node"). That is the router's
   * correct job, but with the tape standing in for the ledger it becomes exactly the false diagnosis of
   * **saying it could not reach something it reached.** So the real circumstance is surfaced in this list.
   */
  misses?: string[],
): LedgerSend {
  const byKey = new Map<string, TapeEntry>();
  for (const e of entries) byKey.set(tapeKey(e.who, e.method, e.path, e.body), e);

  return async (request) => {
    const authorization = (request as { authorization?: string }).authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : authorization;
    const who = token.startsWith(FAKE_TOKEN_PREFIX) ? token.slice(FAKE_TOKEN_PREFIX.length) : token;
    const key = tapeKey(who, request.method, request.path, request.body ?? null);
    const entry = byKey.get(key);
    if (entry === undefined) {
      misses?.push(key);
      throw new Error(
        `This question is not on the tape — ${key}\n` +
          `  our code is asking something different from when it was recorded. If the code is right, re-record against a live participant.`,
      );
    }
    if (entry.bytes !== undefined) {
      const raw = bytes.get(entry.bytes);
      if (raw === undefined) {
        throw new Error(`the tape points at ${entry.bytes} but that file is not there`);
      }
      return { status: entry.status, body: raw };
    }
    return { status: entry.status, body: entry.response ?? null };
  };
}

// ── To and from the file ────────────────────────────────────────────────────────
export const serializeTape = (entries: readonly TapeEntry[]): string =>
  `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;

export const parseTape = (text: string): TapeEntry[] =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as TapeEntry);

// ── Trimming ────────────────────────────────────────────────────────────────────
// **What is left out of the file is written down as a rule** — deleting by hand means a person repeats the
// same judgment on the next recording, and what was left out, and why, is never recorded.

/**
 * Collapses a question asked many times into one. Run as three people, the same question repeats dozens of times.
 *
 * **When one key has two different answers, it says so.** Quietly overwriting with the last one commits a
 * recording that does not hang together — and there is a real path to that: if the ledger advances mid-recording,
 * the same `ledger-end` question gets a different offset, and that offset is baked into other requests' bodies.
 */
export function dedupeTape(entries: readonly TapeEntry[]): {
  entries: TapeEntry[];
  conflicts: string[];
} {
  const byKey = new Map<string, TapeEntry>();
  const conflicts: string[] = [];
  for (const entry of entries) {
    const key = tapeKey(entry.who, entry.method, entry.path, entry.body);
    const seen = byKey.get(key);
    if (seen !== undefined) {
      if (JSON.stringify(seen) !== JSON.stringify(entry)) conflicts.push(key);
      continue; // keep the first one seen — which is right is for a person to decide
    }
    byKey.set(key, entry);
  }
  return { entries: [...byKey.values()], conflicts: [...new Set(conflicts)] };
}

/**
 * The names of the packages that are not put in the file.
 *
 * They are the standard libraries the Daml compiler ships automatically — `daml-stdlib` is 51 modules such as
 * `DA.List`·`DA.Set`·`DA.Math`, `daml-prim` is 11 modules such as `GHC.Base`·`GHC.Num`. The equivalent of
 * JavaScript's `Math`·`JSON`.
 *
 * **Two grounds for leaving them out** (both measured):
 *   1. Both contain **zero templates**. Contracts come from templates, so no contract on the ledger is defined
 *      inside them.
 *   2. Every field type in our four templates belongs to the language itself — `Party`·`Text`·`Numeric 10`·
 *      `Timestamp`. Not one type comes from stdlib.
 *   So with them left out, the contract detail's typedPayload stayed 4 → 4.
 *
 * **The saving**: 3,071 KB → 358 KB (those six were 80% of the package bytes).
 *
 * **When to put one back**: the day one of our templates takes a stdlib-typed field (`DA.Set.Set Text`, say).
 * The screen draws such a field as an unprocessed value, so it is visible — put back that one package.
 */
export const DROPPED_PACKAGE_NAMES: readonly string[] = ["daml-stdlib", "daml-prim"];

export type TrimResult = {
  entries: TapeEntry[];
  bytes: Map<string, Uint8Array>;
  /** What was left out — for the README to state. */
  dropped: { packageId: string; name: string; bytes: number }[];
};

/**
 * Leaves out the packages named above, and removes them from the ledger's package **list** as well.
 *
 * Why the list too: left in the list, the catalog comes asking for those bytes, and with them absent six
 * "blueprint could not be read" rows appear. Removed from the list, the result is a ledger that hangs together —
 * indistinguishable from a node where those packages were never uploaded.
 *
 * `nameOf` maps packageId → package name. A name only exists once the bytes are decoded, so the caller supplies it.
 */
export function trimTape(
  entries: readonly TapeEntry[],
  bytes: ReadonlyMap<string, Uint8Array>,
  nameOf: (packageId: string) => string | undefined,
): TrimResult {
  const dropIds = new Set<string>();
  const dropped: TrimResult["dropped"] = [];
  for (const e of entries) {
    const match = e.path.match(/^\/v2\/packages\/([0-9a-f]{64})$/);
    if (match === null) continue;
    const packageId = match[1] as string;
    const name = nameOf(packageId);
    if (name === undefined || !DROPPED_PACKAGE_NAMES.includes(name)) continue;
    if (dropIds.has(packageId)) continue;
    dropIds.add(packageId);
    dropped.push({
      packageId,
      name,
      bytes: (e.bytes !== undefined ? bytes.get(e.bytes)?.byteLength : undefined) ?? 0,
    });
  }

  const keptEntries = entries
    .filter((e) => {
      const match = e.path.match(/^\/v2\/packages\/([0-9a-f]{64})$/);
      return match === null || !dropIds.has(match[1] as string);
    })
    .map((e) => {
      // Remove them from the package list too.
      if (e.path !== "/v2/packages") return e;
      const list = (e.response as { packageIds?: unknown } | null)?.packageIds;
      if (!Array.isArray(list)) return e;
      return {
        ...e,
        response: { packageIds: list.filter((id) => typeof id === "string" && !dropIds.has(id)) },
      };
    });

  const keptBytes = new Map<string, Uint8Array>();
  for (const e of keptEntries) {
    if (e.bytes === undefined) continue;
    const raw = bytes.get(e.bytes);
    if (raw !== undefined) keptBytes.set(e.bytes, raw);
  }

  return { entries: keptEntries, bytes: keptBytes, dropped };
}
