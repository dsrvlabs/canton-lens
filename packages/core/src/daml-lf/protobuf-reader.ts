// protobuf wire cursor — only as much as needed, with no library (design decision: parse directly, zero dependencies).
//
// Four wire types are read: 0 varint · 1 fixed64 · 2 length-delimited · 5 fixed32. Groups (3·4) do not exist in proto3, so they are rejected.
// A message is read as a flat list of “field number → value”; the meaning (which field is what) is supplied by lf2-package.ts. Here we look only at the shape.
//
// Three pitfalls (confirmed by probing real archives):
//   ① proto3 **omits** default values (0·false·"") — interned index 0 arrives as an absent field. `varintOr(fields, n, 0)`.
//   ② repeated int32 may arrive **packed** (varints listed inside a length-delimited byte run) or as individual entries. Both are accepted.
//   ③ Depth guard — recursive messages (Type inside Type) count depth and cut off with a failure name once MAX_DEPTH is exceeded.

export const MAX_DEPTH = 64;

export class LfDecodeError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export type WireField =
  | { number: number; wire: 0; value: bigint }
  | { number: number; wire: 1; value: Uint8Array }
  | { number: number; wire: 2; value: Uint8Array }
  | { number: number; wire: 5; value: Uint8Array };

// A single varint. Fails if it exceeds 10 bytes or the buffer ends — never silently returns 0.
export function readVarint(bytes: Uint8Array, at: number): { value: bigint; next: number } {
  let result = 0n;
  let shift = 0n;
  let i = at;
  for (let n = 0; n < 10; n++) {
    if (i >= bytes.length) throw new LfDecodeError("truncated_varint");
    const byte = bytes[i] as number;
    i += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result, next: i };
    shift += 7n;
  }
  throw new LfDecodeError("varint_too_long");
}

export function readMessage(bytes: Uint8Array, depth = 0): WireField[] {
  if (depth > MAX_DEPTH) throw new LfDecodeError("depth_exceeded");
  const fields: WireField[] = [];
  let i = 0;
  while (i < bytes.length) {
    const tag = readVarint(bytes, i);
    i = tag.next;
    const number = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    if (number === 0) throw new LfDecodeError("field_number_zero");
    if (wire === 0) {
      const v = readVarint(bytes, i);
      i = v.next;
      fields.push({ number, wire: 0, value: v.value });
    } else if (wire === 2) {
      const len = readVarint(bytes, i);
      i = len.next;
      const length = Number(len.value);
      if (i + length > bytes.length) throw new LfDecodeError("truncated_length_delimited");
      fields.push({ number, wire: 2, value: bytes.subarray(i, i + length) });
      i += length;
    } else if (wire === 1) {
      if (i + 8 > bytes.length) throw new LfDecodeError("truncated_fixed64");
      fields.push({ number, wire: 1, value: bytes.subarray(i, i + 8) });
      i += 8;
    } else if (wire === 5) {
      if (i + 4 > bytes.length) throw new LfDecodeError("truncated_fixed32");
      fields.push({ number, wire: 5, value: bytes.subarray(i, i + 4) });
      i += 4;
    } else {
      throw new LfDecodeError(`unsupported_wire_type:${wire}`);
    }
  }
  return fields;
}

// A single varint field. Absent means default (proto3 default-omission rule ①). Fails if it exceeds the integer range.
export function varintOr(fields: readonly WireField[], number: number, fallback: number): number {
  const found = fields.find((f) => f.number === number);
  if (found === undefined) return fallback;
  if (found.wire !== 0) throw new LfDecodeError(`wire_mismatch:${number}`);
  if (found.value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new LfDecodeError(`varint_overflow:${number}`);
  return Number(found.value);
}

export function boolOr(fields: readonly WireField[], number: number, fallback: boolean): boolean {
  const found = fields.find((f) => f.number === number);
  if (found === undefined) return fallback;
  if (found.wire !== 0) throw new LfDecodeError(`wire_mismatch:${number}`);
  return found.value !== 0n;
}

// sint64 (zigzag) — Type.nat is this.
export function sint64Or(fields: readonly WireField[], number: number, fallback: number): number {
  const found = fields.find((f) => f.number === number);
  if (found === undefined) return fallback;
  if (found.wire !== 0) throw new LfDecodeError(`wire_mismatch:${number}`);
  const raw = found.value;
  const decoded = (raw >> 1n) ^ -(raw & 1n);
  if (decoded > BigInt(Number.MAX_SAFE_INTEGER) || decoded < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new LfDecodeError(`sint64_overflow:${number}`);
  }
  return Number(decoded);
}

export function bytesOf(fields: readonly WireField[], number: number): Uint8Array | null {
  const found = fields.find((f) => f.number === number);
  if (found === undefined) return null;
  if (found.wire !== 2) throw new LfDecodeError(`wire_mismatch:${number}`);
  return found.value;
}

export function bytesAll(fields: readonly WireField[], number: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const f of fields) {
    if (f.number !== number) continue;
    if (f.wire !== 2) throw new LfDecodeError(`wire_mismatch:${number}`);
    out.push(f.value);
  }
  return out;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
export function stringOf(fields: readonly WireField[], number: number, fallback: string): string {
  const b = bytesOf(fields, number);
  if (b === null) return fallback;
  try {
    return utf8.decode(b);
  } catch {
    throw new LfDecodeError(`invalid_utf8:${number}`);
  }
}

// repeated int32 — accepts both packed (varints listed inside wire 2) and individual (wire 0) (pitfall ②).
export function repeatedVarints(fields: readonly WireField[], number: number): number[] {
  const out: number[] = [];
  for (const f of fields) {
    if (f.number !== number) continue;
    if (f.wire === 0) {
      out.push(Number(f.value));
    } else if (f.wire === 2) {
      let i = 0;
      while (i < f.value.length) {
        const v = readVarint(f.value, i);
        i = v.next;
        out.push(Number(v.value));
      }
    } else {
      throw new LfDecodeError(`wire_mismatch:${number}`);
    }
  }
  return out;
}

export function hasField(fields: readonly WireField[], number: number): boolean {
  return fields.some((f) => f.number === number);
}
