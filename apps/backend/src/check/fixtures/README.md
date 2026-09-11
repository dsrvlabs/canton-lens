# check/fixtures

**These are the answers a real, running participant gave. They are not invented examples.**

CI has no Canton node. So `run-check.test.ts` stands these files up in the ledger's place and runs
**the same `runCheck`** that runs against a live participant — the only thing that diverges is `send`.

## What they were recorded from

| | |
|---|---|
| Recorded at | 2026-09-06T17:49:52.836Z |
| Ledger | `http://localhost:7575` (a local participant) |
| Canton version | 3.4.8 |
| People | alice · bob · carol |
| Addresses asked | 51 (everything the check actually asks) |

**Recorded with user tokens.** Recorded with an admin token, the files would hold everything rather than the
boundary Canton enforces, and then they would be material unrelated to the statement this product exists to
prove — that different people see different things.

**No token is in these files.** Only a person's name goes into the key, and a test scans every file here for
credential-shaped content.

## The files

| | |
|---|---|
| `ledger.jsonl` | 129 ledger questions and their answers. One pair per line |
| `packages/*.bin` | The raw bytes of 32 packages (358 KB) — the input to blueprint reading |
| `meta.json` | What the test reads — the instant recorded, the people, the Canton version |

**The test uses `meta.json`'s `recordedAt` as its "now".** Judging expiry hangs on that value, so using the
real clock would let the expiry times the seed planted slip into the past and the answers would change on
their own one day.

Why `.jsonl`: **the key is the question itself** (who · method · path · request body). In the old fixtures the
file name was the key (`active-contracts.sample.json`), so "what was asked, and how" was written down
nowhere — two paths and a body shape were once wrong while every test passed. Splitting per line is so that a
diff shows *which question's* answer changed.

## What was left out

6 packages were not included (2713 KB — 80% of the package bytes):

- `daml-stdlib` `3b25c9b08ac6d895…` 508 KB
- `daml-prim` `54f85ebfc7dfae18…` 280 KB
- `daml-prim` `590736e6f7bc0149…` 445 KB
- `daml-prim` `7cff38e34bd192d4…` 280 KB
- `daml-stdlib` `99ea07e101ed25cd…` 695 KB
- `daml-stdlib` `9d1a644e686435cf…` 506 KB

They are the standard libraries the Daml compiler ships automatically. **The grounds for leaving them out, and
when to put one back**, are in the `DROPPED_PACKAGE_NAMES` comment in `../ledger-tape.ts` — in short, both
contain zero templates, and every field type in our templates belongs to the language itself
(`Party`·`Text`·`Numeric 10`·`Timestamp`), so the contract detail's typedPayload was unchanged with them
left out.

They were removed from the ledger's package **list** too. Left in, the catalog comes asking for those bytes and
"blueprint could not be read" rows appear — removed, the result is indistinguishable from a node where those
packages were never uploaded.

## Re-recording

Recording replaces this directory. It needs a live participant, a user token per person, and a runner that
supplies `runCheck` with a `send` that goes out to the ledger and writes down every question and answer.
**This repository does not ship that runner** — `run-check.ts` is the check itself, not a command, and the
side that holds tokens is deliberately kept out of it.

Two rules the recording has to keep, or the tape is worth less than no tape at all. **Record only when the
check passes**: recording failing answers makes CI believe the same wrong thing. **Replay what was written**
before keeping it, and refuse to leave behind a file that does not reproduce.

When to re-record: when what we ask the ledger changes (the tape fails with "this question is not on the
tape"), when Canton is upgraded, or when the seed changes.
