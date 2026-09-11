// ArchivePayload (daml_lf.proto) — these are the bytes that `GET /v2/packages/{id}` returns. The ZIP·Archive outer shells are not handled.
//
//   message ArchivePayload { string minor = 3; int32 patch = 5; oneof Sum { bytes daml_lf_1 = 2; bytes daml_lf_2 = 4; } }
//
// **Version gate** (design decision): only the stable 2.1–2.3 of LF 2.x is accepted. daml_lf_1 is `unsupported_lf_version:1.x`, any other minor ("dev"·"4"…) is
// `unsupported_lf_version:2.<minor>` — never silently half-read. Real data: daml-prim in the dev DAR is 2.1, user packages (SDK 3.4.11) are 2.2.

import { bytesOf, hasField, LfDecodeError, readMessage, stringOf } from "./protobuf-reader.ts";

export const SUPPORTED_LF2_MINORS: readonly string[] = ["1", "2", "3"];

export type ArchivePayloadResult =
  | { ok: true; lfVersion: string; minor: string; lf2: Uint8Array }
  | { ok: false; reason: string };

export function readArchivePayload(bytes: Uint8Array): ArchivePayloadResult {
  let fields: ReturnType<typeof readMessage>;
  try {
    fields = readMessage(bytes);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof LfDecodeError ? error.reason : "archive_payload_unreadable",
    };
  }
  const minor = stringOf(fields, 3, "");
  if (hasField(fields, 2)) return { ok: false, reason: `unsupported_lf_version:1.${minor || "x"}` };
  const lf2 = bytesOf(fields, 4);
  if (lf2 === null) return { ok: false, reason: "archive_payload_without_lf2" };
  if (!SUPPORTED_LF2_MINORS.includes(minor))
    return { ok: false, reason: `unsupported_lf_version:2.${minor || "?"}` };
  return { ok: true, lfVersion: `2.${minor}`, minor, lf2 };
}
