// **API screen** — renders the `/openapi.json` the server publishes so a human can read it.
//
// **There is no documentation here.** The source for paths, parameters and responses is
// apps/backend/src/openapi.ts, and the response schemas are generated from responses.ts and pinned by
// CI. The moment this screen writes descriptions of its own there are two copies and they drift — so
// this file only lays out the document it fetched. Not one line is written here.
//
// The document is the same for everyone and needs no token (the backend serves it publicly and the
// institutional BFF passes it through unauthenticated). So it is not re-read per generation, only once
// per screen.
import {
  Badge,
  Disclosure,
  Mono,
  Muted,
  Scroll,
  Section,
  SectionBody,
  Table,
} from "@canton-lens/design-system";
import { type ReactNode, useEffect, useState } from "react";
import { messageOf, under } from "../api/client.ts";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");

// The descriptions in openapi.ts use only two marks: `code` and **emphasis**. Only those two are
// carried over and the rest stays literal — pulling in a markdown renderer would add a dependency for
// the sake of this one screen.
function rich(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    const key = `${index}:${part}`;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`"))
      return <Mono key={key}>{part.slice(1, -1)}</Mono>;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**"))
      return <b key={key}>{part.slice(2, -2)}</b>;
    return part;
  });
}

// Swaps `#/components/schemas/X` for that schema. In 3.1 a description can sit next to a $ref, so the
// siblings are laid over the target to keep the description that was beside it.
function resolve(schema: Rec, schemas: Rec): Rec {
  const ref = str(schema.$ref);
  if (ref === undefined) return schema;
  const name = ref.replace("#/components/schemas/", "");
  const target = rec(schemas[name]);
  const { $ref: _dropped, ...siblings } = schema;
  return { ...target, ...siblings };
}

const refName = (schema: Rec): string | undefined =>
  str(schema.$ref)?.replace("#/components/schemas/", "");

// The type name for one cell. A named schema is called by its name (expanding it only lengthens the
// screen); the rest are called by their shape.
function typeLabel(schema: Rec, depth = 0): string {
  const named = refName(schema);
  if (named !== undefined) return named;
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (depth > 3) return "…";
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const list = arr(schema[key]);
    if (list.length > 0)
      return list
        .map((one) => typeLabel(rec(one), depth + 1))
        .join(key === "allOf" ? " & " : " | ");
  }
  if (schema.type === "array") return `${typeLabel(rec(schema.items), depth + 1)}[]`;
  const enumValues = arr(schema.enum);
  if (enumValues.length > 0) {
    const shown = enumValues
      .slice(0, 4)
      .map((v) => JSON.stringify(v))
      .join(" | ");
    return enumValues.length > 4 ? `${shown} | …` : shown;
  }
  if (typeof schema.type === "string") return schema.type;
  const union = strings(schema.type);
  if (union.length > 0) return union.join(" | ");
  return "object";
}

// Only the body's first level of fields is unfolded. Below that the type name points the way — unfold
// everything and this screen becomes a copy of the generated file.
function PropertyTable({ schema }: { schema: Rec }): ReactNode {
  const properties = rec(schema.properties);
  const names = Object.keys(properties);
  const required = new Set(strings(schema.required));
  if (names.length === 0) return <Muted>{typeLabel(schema)}</Muted>;
  return (
    <Scroll>
      <Table variant="fields">
        <tbody>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Meaning</th>
          </tr>
          {names.map((name) => {
            const field = rec(properties[name]);
            const description = str(field.description);
            return (
              <tr key={name}>
                <td>
                  <Mono>{name}</Mono>
                  {required.has(name) ? null : (
                    <>
                      {" "}
                      <Muted>optional</Muted>
                    </>
                  )}
                </td>
                <td>
                  <Muted>{typeLabel(field)}</Muted>
                </td>
                <td>{description === undefined ? null : rich(description)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Scroll>
  );
}

// The field that separates the branches — a property nailed to a value, like `kind: "available"`. One
// value is written as const, several as enum, so both are looked at. Without it as a name the branches
// become "case 1 · case 2" and the caller cannot tell which response has which shape. const comes
// first when present — enum also sits on fields that are not discriminators, such as reason.
function discriminatorOf(schema: Rec): string | undefined {
  const properties = rec(schema.properties);
  const names = Object.keys(properties);
  for (const name of names) {
    const value = rec(properties[name]).const;
    if (typeof value === "string") return `${name}: ${JSON.stringify(value)}`;
  }
  for (const name of names) {
    const values = strings(rec(properties[name]).enum);
    if (values.length > 0 && values.length === arr(rec(properties[name]).enum).length)
      return `${name}: ${values.map((v) => JSON.stringify(v)).join(" | ")}`;
  }
  return undefined;
}

// More than half the 200 bodies are branching unions (read / could not read / nothing to see). Drawn
// as one lump a union shows no fields at all, so each branch gets its discriminator as a heading and
// its own fields unfolded.
function Fields({ schema, schemas }: { schema: Rec; schemas: Rec }): ReactNode {
  const resolved = resolve(schema, schemas);
  const anyOf = arr(resolved.anyOf);
  const branches = anyOf.length > 0 ? anyOf : arr(resolved.oneOf);
  if (branches.length === 0) return <PropertyTable schema={resolved} />;
  return (
    <>
      {branches.map((branch, index) => {
        const one = resolve(rec(branch), schemas);
        const discriminator = discriminatorOf(one);
        return (
          <div key={discriminator ?? `${index}`}>
            <p className="api__case">
              <Muted>when</Muted>{" "}
              <Mono>{discriminator ?? `case ${index + 1} of ${branches.length}`}</Mono>
            </p>
            <PropertyTable schema={one} />
          </div>
        );
      })}
    </>
  );
}

function Parameters({ parameters }: { parameters: Rec[] }): ReactNode {
  if (parameters.length === 0) return null;
  return (
    <>
      <p className="api__label">
        <Muted>Parameters</Muted>
      </p>
      <Scroll>
        <Table variant="fields">
          <tbody>
            <tr>
              <th>Name</th>
              <th>In</th>
              <th>Type</th>
              <th>Meaning</th>
            </tr>
            {parameters.map((parameter) => {
              const name = str(parameter.name) ?? "";
              const schema = rec(parameter.schema);
              const pattern = str(schema.pattern);
              const description = str(parameter.description);
              return (
                <tr key={`${str(parameter.in) ?? ""}:${name}`}>
                  <td>
                    <Mono>{name}</Mono>
                    {parameter.required === true ? null : (
                      <>
                        {" "}
                        <Muted>optional</Muted>
                      </>
                    )}
                  </td>
                  <td>
                    <Muted>{str(parameter.in) ?? ""}</Muted>
                  </td>
                  <td>
                    <Muted>{typeLabel(schema)}</Muted>
                    {pattern === undefined ? null : (
                      <>
                        {" "}
                        <Mono>{pattern}</Mono>
                      </>
                    )}
                  </td>
                  <td>{description === undefined ? null : rich(description)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Scroll>
    </>
  );
}

// The reason on a failure response is in the body schema's enum. With only the status code and no
// names, the caller cannot tell what it has to branch on.
const reasonsOf = (schema: Rec): string[] => strings(rec(rec(schema.properties).reason).enum);

function Responses({ responses, schemas }: { responses: Rec; schemas: Rec }): ReactNode {
  const codes = Object.keys(responses).sort();
  return (
    <>
      <p className="api__label">
        <Muted>Responses</Muted>
      </p>
      {codes.map((code) => {
        const response = rec(responses[code]);
        const schema = rec(rec(rec(response.content)["application/json"]).schema);
        const description = str(response.description);
        const reasons = reasonsOf(schema);
        const named = refName(schema);
        return (
          <div className="api__response" key={code}>
            <p>
              <Badge mono strong tone={code === "200" ? "positive" : "negative"}>
                {code}
              </Badge>{" "}
              {named === undefined ? null : <Mono>{named}</Mono>}
              {reasons.length === 0
                ? null
                : reasons.map((reason) => (
                    <span key={reason}>
                      {" "}
                      <Badge mono>{reason}</Badge>
                    </span>
                  ))}
            </p>
            {description === undefined ? null : <p>{rich(description)}</p>}
            {code === "200" ? <Fields schema={schema} schemas={schemas} /> : null}
          </div>
        );
      })}
    </>
  );
}

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

type Operation = {
  method: string;
  path: string;
  summary: string | undefined;
  operationId: string | undefined;
  parameters: Rec[];
  responses: Rec;
};

// Counts **operations**, not paths. The day a path carries more than one method, counting paths alone
// would silently drop one.
function operationsOf(document: Rec): Operation[] {
  const paths = rec(document.paths);
  const out: Operation[] = [];
  for (const path of Object.keys(paths)) {
    const item = rec(paths[path]);
    for (const method of METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      const o = rec(operation);
      out.push({
        method,
        path,
        summary: str(o.summary),
        operationId: str(o.operationId),
        parameters: arr(o.parameters).map(rec),
        responses: rec(o.responses),
      });
    }
  }
  return out;
}

export function Api(): ReactNode {
  const [document, setDocument] = useState<Rec | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(under("openapi.json"))
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not fetch the API document (${response.status})`);
        return (await response.json()) as unknown;
      })
      .then((body) => {
        if (!cancelled) setDocument(rec(body));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null)
    return (
      <div id="view-api">
        <Section id="api-box" title="API">
          <Table>
            <tbody>
              <tr>
                <td className="clds-banner">{error}</td>
              </tr>
            </tbody>
          </Table>
        </Section>
      </div>
    );
  if (document === null) return <div id="view-api" />;

  const info = rec(document.info);
  const schemas = rec(rec(document.components).schemas);
  const security = str(rec(rec(rec(document.components).securitySchemes).ledgerToken).description);
  const operations = operationsOf(document);
  const raw = under("openapi.json");

  return (
    <div id="view-api">
      <Section
        id="api-box"
        title={str(info.title) ?? "API"}
        subtitle={<Badge label>{str(info.version) ?? ""}</Badge>}
        note={`${operations.length} operations`}
        foot={
          <>
            <p>
              The document itself is at <a href={raw}>openapi.json</a> — that is what a client
              generator reads. This screen only lays it out.
            </p>
            {security === undefined ? null : <p>{rich(security)}</p>}
          </>
        }
      >
        <SectionBody className="api">
          {str(info.description) === undefined ? null : (
            <p className="api__lede">{rich(str(info.description) as string)}</p>
          )}
          {operations.map((operation) => (
            <Disclosure
              className="api__op"
              key={`${operation.method} ${operation.path}`}
              summary={
                <>
                  <Badge mono strong tone="accent">
                    {operation.method.toUpperCase()}
                  </Badge>
                  <Mono className="api__path">{operation.path}</Mono>
                  {operation.summary === undefined ? null : (
                    <Muted className="api__summary">{operation.summary}</Muted>
                  )}
                </>
              }
            >
              <div className="api__detail">
                {operation.operationId === undefined ? null : (
                  <p>
                    <Muted>operationId</Muted> <Mono>{operation.operationId}</Mono>
                  </p>
                )}
                <Parameters parameters={operation.parameters} />
                <Responses responses={operation.responses} schemas={schemas} />
              </div>
            </Disclosure>
          ))}
        </SectionBody>
      </Section>
    </div>
  );
}
