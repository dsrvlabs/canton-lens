# check/fixtures

**These are the answers a real, running participant gave. They are not invented examples.** One thing in
them was edited and it is named below: the package list, from which the standard libraries were removed along
with their bytes.

CI has no Canton node. So `run-check.test.ts` stands these files up in the ledger's place and runs
**the same check code** as `make check` (a real node) — the only thing that diverges is `send`.

## What they were recorded from

| | |
|---|---|
| Recorded at | 2026-09-18T08:07:19.441Z |
| Ledger | `http://localhost:7575` (a local dev stack, outside this repo) |
| Canton version | 3.5.15 |
| People | alice · bob · carol · nobody · idp · padmin · actor · super* · superplus* · dual · mixed · dave |
| Ledger end | 161 — the point every answer here was read at |
| Addresses asked | 193 (everything the check actually asks) |

**Recorded with user tokens.** Recorded with an admin token, the files would hold everything rather than the
boundary Canton enforces, and then they would be material unrelated to the statement this product exists to
prove — that different people see different things.

**No token is in these files.** Only a person's name goes into the key, and a test scans every file here for
credential-shaped content.

**What each person was given was asked of the node, not read off our own answers.** The party classification
in `meta.json` is the participant's own rights answer, read the way the product reads it, and a test in the
repository derives it again from the recorded answer and requires the two to agree. Whether the seed left a
person anything to see was asked directly with their token — a wildcard question the explorer never sends —
because reading that from our own list would let an application that drops rows agree with itself.

## The files

| | |
|---|---|
| `ledger.jsonl` | 429 ledger questions and their answers. One pair per line |
| `packages/*.bin` | The raw bytes of 32 packages (358 KB) — the input to blueprint reading |
| `meta.json` | The manifest the test reads — the instant recorded, the Canton version, and per person the party classification their rights imply and whether the seed left them anything to see |

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

```bash
make -C infra record        # in the local dev stack. It deletes this directory and writes it again
```

It needs a live participant and user tokens. **It only records when the check passes** — recording failing
answers would make CI believe the same wrong thing. It also replays what it wrote and refuses to leave a file
behind that does not reproduce.

When to re-record: when what we ask the ledger changes (the tape fails with "this question is not on the
tape"), when Canton is upgraded, or when the seed changes.
