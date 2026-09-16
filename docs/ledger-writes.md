# Ledger writes

`docs/development.md` states the rule this document answers: *do not add ledger writes without an
explicit security design.* Until this change the Explorer had no write path at all, and that
absence was enforced in four places — the contributing rule, core rule 4 in
`packages/core/src/index.ts`, the `405` every non-`GET` method received in `router.ts`, and a
`RouterRequest` with no body to carry a command in.

This document is the design those four places were waiting for. It covers one write and no others:
exercising a choice on a contract the caller can already see.

## What a write is here

A read asks the participant a question. A write asks it to commit a transaction, and a committed
transaction cannot be taken back by the Explorer, the deployer, or Canton. Every boundary below
exists because that difference is permanent.

The Explorer submits exactly one kind of command:

```text
POST /api/exercise
  { contractId, templateId, choice, argument, actAs }
     ↓
  /v2/commands/submit-and-wait   (JSON Ledger API)
```

It does not create contracts, does not archive them directly, does not submit multi-command
transactions, and does not retry. A choice the caller cannot see, cannot control, or supplies a
malformed argument for is refused before any request reaches the participant.

## Canton still decides

The Explorer's position has not changed: Canton is the authority. A caller holding `CanActAs` for a
party could submit the same command with `curl` and the same token. The Explorer adds a form and a
schema check; it adds no permission.

What that means concretely:

- The token is the caller's, relayed unchanged, exactly as on every read path.
- `actAs` names parties the caller must already hold `CanActAs` for. The Explorer does not check
  this and must not — the participant answers `403` and that answer is shown as it is.
- A `CanReadAs`-only deployment stays read-only without configuring anything. There is no command
  the Explorer can submit that such a token would be allowed to run.

`docs/security.md` already says to prefer `CanReadAs` for view-only deployments. That advice is now
load-bearing rather than advisory, and the section below adds the second half of it.

## Shared Identity refuses writes

This is the boundary that matters most, and it is not configurable.

In `shared-identity` mode every caller of the Backend API shares one Canton identity. For reads
that is a documented visibility trade-off: everyone sees the same ledger scope. For writes it is
something else entirely — **anyone who can reach the Backend could commit transactions as the
shared party**, with no record of which caller did it. The Backend holds the credential, so the
participant's audit trail names the service identity and stops there.

So `POST /api/exercise` answers `403 writes_not_available` whenever `LEDGER_AUTH_MODE` is
`shared-identity`, regardless of any other setting. The route is reachable only under
`caller-bearer`, where the token is the individual caller's and the participant's record names the
party that actually acted.

| `LEDGER_AUTH_MODE` | `LEDGER_WRITES` | `POST /api/exercise` |
|---|---|---|
| `caller-bearer` | `enabled` | Submits |
| `caller-bearer` | unset or anything else | `403 writes_not_available` |
| `shared-identity` | `enabled` | `403 writes_not_available` — refused, and startup fails |
| `shared-identity` | unset | `403 writes_not_available` |

Setting `LEDGER_WRITES=enabled` together with `shared-identity` fails at startup rather than
starting in a state whose name contradicts its behaviour. The repository's existing configuration
stance — explicit profiles, no inference, no fallback — is why this is a startup failure and not a
warning.

## Off by default

`LEDGER_WRITES` is unset in every existing deployment, and unset means refused. Upgrading to this
version changes no deployment's behaviour. A deployer who wants the write path has to name it,
after reading this page.

The variable takes one value, `enabled`. Any other value — including `true`, `1`, and `yes` — is
refused at startup, so a half-remembered spelling cannot quietly open a write path.

## What is checked before submitting

The Explorer validates the command against the package schema it already decodes for the Contracts
detail screen. This is not a security control — the participant re-checks everything and is the
only authority — but a malformed argument that reaches the participant produces a transaction
failure whose cause is hard to read back. Checking first turns those into a `400` naming the field.

Checked in `packages/core/src/exercise/`:

- The template has the named choice.
- Every field the choice's argument record declares is present, and no field it does not declare is.
- Each value matches the declared Daml-LF type for the primitives the form can produce — `Party`,
  `Text`, `Int64`, `Numeric`, `Bool`, `Date`, `Timestamp`, `ContractId`, `Unit`, and `Optional` of
  those.
- `actAs` is a non-empty list of syntactically well-formed party identifiers.

Not checked, deliberately: whether the caller controls the choice, whether the contract is still
active, whether the argument satisfies the template's `ensure` clause, and whether a nested record
type from another package is well-formed. The first three are the participant's to answer and its
answers are more accurate than a guess. The fourth is a gap named below.

## Errors stay errors

A refused write is shown as a refusal. The existing rule — *preserve unavailable and denied states;
do not turn failures into `0`, `[]`, or `null`* — applies to command submission unchanged:

| Situation | Answer |
|---|---|
| Mode or flag forbids writes | `403 writes_not_available` |
| Argument does not match the schema | `400 invalid_argument`, naming the field |
| Caller lacks `CanActAs` | `403` from the participant, relayed |
| Contract already archived | The participant's error name, relayed |
| Choice body failed | The participant's error name, relayed |

The Explorer never reports a submitted command as successful on its own. Success means the
participant returned a completion, and the response carries the update id it returned.

## Audit

Command submission is logged by the Backend with the choice name, template id, contract id, and
`actAs` parties — and without the argument, which can carry private ledger data that
`docs/security.md` forbids logging. The participant's own record is the authoritative one; this log
exists so an operator can see that the Explorer was the submission path.

## Known gaps

Named here rather than left to be discovered:

1. **Nested records from other packages are not validated.** The schema decoder expands records
   within the same package only. A choice whose argument references a record from a different
   package is submitted with its argument passed through, and the participant judges it.
2. **External parties are not supported.** A party whose key the participant does not hold needs
   the interactive submission `prepare`/`execute` flow and a wallet to sign the prepared hash.
   `submit-and-wait` cannot serve it. Such a submission fails at the participant.
3. **No dry run.** Canton has no equivalent of `eth_call`: there is no way to execute a choice and
   discard the result. Interactive submission's `prepare` step computes a transaction without
   committing it and is the closest thing available; it is not used here.
4. **No command deduplication id is supplied.** A repeated submission is a new command. The screen
   does not resubmit on its own, but a caller of the API can.

Gaps 2 and 3 are the ones that decide whether this path is useful beyond local participants, and
both are better answered by interactive submission than by widening this route.
