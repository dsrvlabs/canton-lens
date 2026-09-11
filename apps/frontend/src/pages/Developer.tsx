import {
  Badge,
  Disclosure,
  MessageRow,
  Mono,
  Muted,
  Scroll,
  Section,
  Table,
} from "@canton-lens/design-system";
import { said, saidSchema } from "../api/said.ts";
import { Chip } from "../format/chips.tsx";
import { short } from "../format/format.ts";
import { Choices } from "../format/typed.tsx";
import { href } from "../route/hash.ts";
import { useSession } from "../session/SessionContext.tsx";
import { Status } from "./Status.tsx";

export function Developer({ show }: { show: "instance" | "catalog" | "packages" }) {
  const all = show === "instance";
  return (
    <div id="instance">
      {all || show === "packages" ? <Packages /> : null}
      {all || show === "catalog" ? <Catalog /> : null}
      {all ? <Status /> : null}
    </div>
  );
}

// Templates under Catalog — templates counted from my active contracts. My own scope, so no badge.
function Catalog() {
  const { templates } = useSession();
  // The box (heading and footnote) stands even without data. Only the table fills in — if the heading
  // vanished too it would feel like the wrong screen had been opened.
  const t = templates?.rows ?? [];
  return (
    <Section
      id="catalog-box"
      title="Templates"
      note={<span id="catalog-note">templates behind the contracts visible to you</span>}
      foot={
        <>
          Counted from your active contracts, not from what is installed — installed packages are
          under <a href="#/packages">Packages</a>.
        </>
      }
    >
      <Scroll>
        <Table id="templates">
          <tbody>
            {!templates ? null : t.length === 0 ? (
              <MessageRow>
                No active contracts are visible to you, so no templates to count
              </MessageRow>
            ) : (
              <>
                <tr>
                  <th>Template</th>
                  <th>Package</th>
                  <th>Contracts</th>
                </tr>
                {t.map((r) => (
                  <tr key={r.templateId}>
                    <td>
                      <a href={href.contractsOfTemplate(r.module, r.entity)}>
                        <b>{r.entity}</b>
                      </a>{" "}
                      <Muted>{r.module}</Muted>
                      {r.definition.status === "ok" ? (
                        <Disclosure summary="definition">
                          <div className="clds-muted" style={{ margin: "4px 0" }}>
                            Fields
                          </div>
                          {r.definition.fields.length === 0 ? (
                            <Muted>none</Muted>
                          ) : (
                            <div className="nested">
                              {r.definition.fields.map((f) => (
                                <div key={f.name}>
                                  <span className="typed-key">{f.name}</span>{" "}
                                  <Muted>{f.type}</Muted>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="clds-muted" style={{ margin: "6px 0 4px" }}>
                            Choices
                          </div>
                          <Choices choices={r.definition.choices} />
                          {(r.definition.implements ?? []).length > 0 ? (
                            <div className="clds-muted" style={{ margin: "6px 0 0" }}>
                              Implements{" "}
                              {r.definition.implements.map((i, k) => (
                                <span key={`${i.module}:${i.name}`}>
                                  {k > 0 ? ", " : ""}
                                  <Mono>
                                    {i.module}:{i.name}
                                  </Mono>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </Disclosure>
                      ) : (
                        <div className="clds-muted">
                          definition unavailable — {said(r.definition.reason, "no schema")}
                        </div>
                      )}
                    </td>
                    <td className="clds-mono">
                      {r.packageName}
                      {r.definition.status === "ok" && r.definition.packageVersion ? (
                        <>
                          {" "}
                          <Muted>{r.definition.packageVersion}</Muted>
                        </>
                      ) : null}{" "}
                      <Muted title={r.packageId}>{short(r.packageId, 8)}</Muted>
                    </td>
                    <td className="clds-mono">{r.contractCount}</td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </Table>
      </Scroll>
    </Section>
  );
}

// Packages under Catalog — everything installed on the participant. Instance-wide, so it takes a badge.
// "Used by my contracts" is exactly as the server (buildPackageCatalog) judged it.
function Packages() {
  const { packages } = useSession();
  const p = packages?.rows ?? [];
  const mine = p.filter((r) => r.inMyContracts?.status === "in_set").length;
  const read = p.filter((r) => r.schemaStatus === "ok").length;
  // What my contracts use goes on top — arrangement, not judgement.
  const sorted = p.slice().sort((a, b) => {
    const am = a.inMyContracts?.status === "in_set" ? 0 : 1;
    const bm = b.inMyContracts?.status === "in_set" ? 0 : 1;
    return am !== bm ? am - bm : a.packageId < b.packageId ? -1 : 1;
  });
  return (
    <Section
      id="packages-box"
      title={
        <>
          Packages
          <Badge label style={{ marginLeft: "var(--clds-space-4)" }}>
            whole instance
          </Badge>
        </>
      }
      note={
        <span id="packages-note">
          {packages
            ? `${p.length} installed · ${mine} used by my contracts · ${read} schemas read`
            : ""}
        </span>
      }
      foot='Everything installed on this participant — not just what your contracts use. Names, versions and contents are read from each package on the participant (Daml-LF); a package whose schema could not be read keeps "name not in this layer".'
    >
      <Scroll>
        <Table id="packages-table">
          <tbody>
            {!packages ? null : p.length === 0 ? (
              <MessageRow>The participant lists no packages</MessageRow>
            ) : (
              <>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Package ID</th>
                  <th>Contents</th>
                  <th>In my contracts</th>
                </tr>
                {sorted.map((r) => {
                  const templates = r.templates ?? [];
                  const interfaces = r.interfaces ?? [];
                  return (
                    <tr key={r.packageId}>
                      <td>
                        {typeof r.name === "string" ? (
                          <b>{r.name}</b>
                        ) : (
                          <Muted>name not in this layer</Muted>
                        )}
                        {r.schemaStatus && r.schemaStatus !== "ok" ? (
                          <div className="clds-muted" title={r.schemaStatus}>
                            schema not read — {saidSchema(r.schemaStatus)}
                          </div>
                        ) : null}
                      </td>
                      <td className="clds-mono">
                        {typeof r.version === "string" ? r.version : <Muted>–</Muted>}
                      </td>
                      <td>
                        <Chip value={r.packageId} n={16} />
                      </td>
                      <td>
                        {r.schemaStatus === "ok" ? (
                          templates.length + interfaces.length === 0 ? (
                            <Muted>no templates or interfaces</Muted>
                          ) : (
                            <Disclosure
                              summary={
                                <>
                                  {templates.length}{" "}
                                  {templates.length === 1 ? "template" : "templates"}
                                  {interfaces.length > 0
                                    ? ` · ${interfaces.length} ${interfaces.length === 1 ? "interface" : "interfaces"}`
                                    : ""}
                                </>
                              }
                            >
                              <div className="nested">
                                {templates.map((t) => (
                                  <div key={`${t.module}:${t.name}`}>
                                    <a
                                      className="clds-mono"
                                      href={href.contractsOfTemplate(t.module, t.name)}
                                    >
                                      {t.module}:{t.name}
                                    </a>{" "}
                                    <Muted>
                                      {t.choices} {t.choices === 1 ? "choice" : "choices"}
                                    </Muted>
                                  </div>
                                ))}
                                {interfaces.map((i) => (
                                  <div key={`${i.module}:${i.name}`}>
                                    <Mono>
                                      {i.module}:{i.name}
                                    </Mono>{" "}
                                    <Muted>interface</Muted>
                                  </div>
                                ))}
                              </div>
                            </Disclosure>
                          )
                        ) : (
                          <Muted>–</Muted>
                        )}
                      </td>
                      <td>
                        {r.inMyContracts?.status === "in_set" ? (
                          <Badge>yes</Badge>
                        ) : r.inMyContracts?.status === "not_in_set" ? (
                          <Muted>no</Muted>
                        ) : (
                          <Muted>{r.inMyContracts?.status ?? "unknown"}</Muted>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </Table>
      </Scroll>
    </Section>
  );
}
