import assert from "node:assert/strict";
import test from "node:test";
import {
  LfDecodeError,
  readMessage,
  readVarint,
  repeatedVarints,
  sint64Or,
  varintOr,
} from "./protobuf-reader.ts";

const bytes = (...xs: number[]) => new Uint8Array(xs);

test("varint: one byte, many bytes, truncated", () => {
  assert.deepEqual(readVarint(bytes(0x05), 0), { value: 5n, next: 1 });
  assert.deepEqual(readVarint(bytes(0xac, 0x02), 0), { value: 300n, next: 2 });
  assert.throws(
    () => readVarint(bytes(0x80), 0),
    (e: unknown) => e instanceof LfDecodeError && e.reason === "truncated_varint",
  );
});

test("message: varint·length-delimited·fixed32·fixed64 flatten by field number, and the group wire type is refused", () => {
  // field 1 varint 7, field 2 bytes "hi", field 3 fixed32, field 4 fixed64
  const m = bytes(
    0x08,
    0x07,
    0x12,
    0x02,
    0x68,
    0x69,
    0x1d,
    1,
    2,
    3,
    4,
    0x21,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
  );
  const f = readMessage(m);
  assert.deepEqual(
    f.map((x) => [x.number, x.wire]),
    [
      [1, 0],
      [2, 2],
      [3, 5],
      [4, 1],
    ],
  );
  assert.equal(varintOr(f, 1, 0), 7);
  assert.equal(
    varintOr(f, 9, 42),
    42,
    "an absent field takes the default — proto3 omits defaults (trap ①)",
  );
  assert.throws(
    () => readMessage(bytes(0x0b)),
    (e: unknown) => e instanceof LfDecodeError && e.reason === "unsupported_wire_type:3",
  );
  assert.throws(
    () => readMessage(bytes(0x12, 0x05, 0x01)),
    (e: unknown) => e instanceof LfDecodeError && e.reason === "truncated_length_delimited",
  );
});

test("repeated int32: packed (varints inside a length) and individual values are both accepted — trap ② of InternedDottedName.segments", () => {
  const packed = readMessage(bytes(0x0a, 0x03, 0x01, 0x02, 0x03));
  assert.deepEqual(repeatedVarints(packed, 1), [1, 2, 3]);
  const single = readMessage(bytes(0x08, 0x01, 0x08, 0x02));
  assert.deepEqual(repeatedVarints(single, 1), [1, 2]);
  const mixed = readMessage(bytes(0x08, 0x09, 0x0a, 0x02, 0x0a, 0x0b));
  assert.deepEqual(repeatedVarints(mixed, 1), [9, 10, 11]);
});

test("sint64 zigzag: this is what Type.nat is — 10 arrives as 20, -1 as 1", () => {
  assert.equal(sint64Or(readMessage(bytes(0x30, 0x14)), 6, 0), 10);
  assert.equal(sint64Or(readMessage(bytes(0x30, 0x01)), 6, 0), -1);
});

test("depth guard: nesting past MAX_DEPTH gives depth_exceeded", () => {
  assert.throws(
    () => readMessage(bytes(), 65),
    (e: unknown) => e instanceof LfDecodeError && e.reason === "depth_exceeded",
  );
});
