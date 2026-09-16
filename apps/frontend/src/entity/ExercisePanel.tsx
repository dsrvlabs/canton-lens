// **The one screen that asks the participant to commit something.** Its security design is
// docs/ledger-writes.md; this file is the form in front of it and holds none of the judgment.
//
// Two things are deliberately not done here. It does not decide whether the viewer may exercise a
// choice — the participant answers that, and guessing would either hide a choice that would have
// worked or offer one that never will. And it does not report a submission as successful on its own:
// what is shown is the update id the participant returned.
import { Badge, Banner, Button, Mono, Muted, TextInput } from "@canton-lens/design-system";
import { useState } from "react";
import { apiSubmit, messageOf } from "../api/client.ts";
import type { ChoiceLite, SchemaFieldLite, SubmittedCommandResponse } from "../api/types.ts";
import { useSession } from "../session/SessionContext.tsx";

// What a field's editor should put in the JSON body. Int64 and Numeric stay text all the way to the
// node: a Daml `Numeric` carries more precision than a double, so parsing it into a JavaScript
// number would round the value being committed. Bool is the one that has to leave the text world,
// because `"false"` is a true string.
function coerce(raw: string, field: SchemaFieldLite): unknown {
  const head = field.type.replace(/^Optional\s+/, "").trim();
  if (raw === "") return null;
  if (head === "Bool") return raw === "true";
  return raw;
}

const isOptional = (field: SchemaFieldLite): boolean => /^Optional\b/.test(field.type);

export function ExercisePanel({
  contractId,
  templateId,
  choices,
  signatories,
}: {
  contractId: string;
  templateId: string;
  choices: readonly ChoiceLite[];
  signatories: readonly string[];
}) {
  const { myParties } = useSession();
  const [choiceName, setChoiceName] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  // Defaults to the viewer's parties that are signatories of this contract — the common case, and
  // still editable, because a controller need not be a signatory.
  const [actAs, setActAs] = useState<string[]>(myParties.filter((p) => signatories.includes(p)));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<SubmittedCommandResponse | null>(null);

  const choice = choices.find((c) => c.name === choiceName) ?? null;
  const fields = choice?.argFields ?? null;

  const pick = (name: string) => {
    setChoiceName(name);
    setValues({});
    setProblem(null);
    setDone(null);
  };

  const submit = async () => {
    if (choice === null) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const argument: Record<string, unknown> = {};
      for (const field of fields ?? []) {
        const raw = values[field.name] ?? "";
        // An Optional left blank is omitted rather than sent as null — the node treats an absent
        // Optional and an explicit None as the same record, and omitting keeps the body honest
        // about what the person actually filled in.
        if (raw === "" && isOptional(field)) continue;
        argument[field.name] = coerce(raw, field);
      }
      setDone(
        await apiSubmit<SubmittedCommandResponse>("/api/exercise", {
          contractId,
          templateId,
          choice: choice.name,
          argument,
          actAs,
        }),
      );
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  if (myParties.length === 0) {
    return (
      <Muted>
        Exercising needs a party to act as, and this viewer holds none. A `CanReadAs`-only token can
        read this contract but cannot submit a command on it.
      </Muted>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {choices.map((c) => (
          <Button
            key={c.name}
            variant={c.name === choiceName ? "primary" : "secondary"}
            onClick={() => pick(c.name)}
          >
            {c.name}
          </Button>
        ))}
      </div>

      {choice === null ? (
        <Muted>Pick a choice to fill in its argument.</Muted>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Badge tone={choice.consuming ? "negative" : "neutral"}>
              {choice.consuming ? "consuming — archives this contract" : "nonconsuming"}
            </Badge>
            {choice.returnType ? <Muted>returns {choice.returnType}</Muted> : null}
          </div>

          {fields === null ? (
            <Muted>
              This choice's argument is a record this package does not expand, so it cannot be
              filled in here. See docs/ledger-writes.md, gap 1.
            </Muted>
          ) : fields.length === 0 ? (
            <Muted>No argument.</Muted>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {fields.map((field) => (
                <div key={field.name} style={{ display: "grid", gap: 2 }}>
                  <label htmlFor={`exercise-${choice.name}-${field.name}`}>
                    <Mono>{field.name}</Mono> <Muted>{field.type}</Muted>
                  </label>
                  <TextInput
                    block
                    mono
                    id={`exercise-${choice.name}-${field.name}`}
                    value={values[field.name] ?? ""}
                    placeholder={isOptional(field) ? "leave blank for None" : field.type}
                    // **Read the event before the updater runs.** A lazy updater is called after the
                    // handler has returned, and by then `currentTarget` is null — the value has to be
                    // taken out here, while the event is still the one being handled.
                    onChange={(e) => {
                      const next = e.currentTarget.value;
                      setValues((prev) => ({ ...prev, [field.name]: next }));
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 4 }}>
            <legend style={{ padding: 0 }}>
              Act as <Muted>— the participant refuses parties this token cannot act as</Muted>
            </legend>
            {myParties.map((party) => (
              <div key={party} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  id={`exercise-actas-${party}`}
                  checked={actAs.includes(party)}
                  // Same as the field editor above: `currentTarget` is null by the time a lazy
                  // updater runs, so the checked state is read here and closed over.
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setActAs((prev) =>
                      on ? [...new Set([...prev, party])] : prev.filter((p) => p !== party),
                    );
                  }}
                />
                <label htmlFor={`exercise-actas-${party}`}>
                  <Mono>{party}</Mono>
                </label>
                {signatories.includes(party) ? <Badge tone="neutral">signatory</Badge> : null}
              </div>
            ))}
          </fieldset>

          <div>
            <Button
              variant="primary"
              disabled={busy || actAs.length === 0}
              onClick={() => void submit()}
            >
              {busy ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </>
      )}

      {problem === null ? null : <Banner tone="problem">{problem}</Banner>}
      {done === null ? null : (
        <Banner tone="info">
          Committed. Update <Mono>{done.updateId}</Mono>
          {done.completionOffset === null ? null : <> at offset {done.completionOffset}</>}.
        </Banner>
      )}
    </div>
  );
}
