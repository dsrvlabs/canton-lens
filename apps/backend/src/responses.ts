// **The shape of each route's 200 body — the source of the contract.** The types of values whose judgment is finished are
// taken from packages/core as **types only** (no runtime code is mixed in), and the fields the router (router.ts) lays on top of
// them (offset, schema, definition …) and the readAt the boot file (live/build-app.mjs) stamps are written here.
//
// The response schemas of openapi.ts are **generated** from this file — `pnpm openapi:generate` extracts every type exported
// here into JSON Schema and writes it to openapi-schemas.generated.ts, and CI checks that “freshly extracted == committed”
// (`pnpm openapi:check`). So when a core type is changed the contract follows by itself, and when a field the router lays on
// is changed, this file must be changed with it for the docs to be right — a mismatch is caught by a person in this file, not by the generator.
//
// Only the shape comes from here. The context of “why this field is like this” is held by hand in the descriptions of openapi.ts. The
// JSDoc (`/** */`) in this file states only the meaning of that one field, and the generator moves it into the schema's description.
import type {
  BuildPackageCatalogResult,
  BuildTemplateCatalogResult,
  BuildTokenHoldingsResult,
  BuildTransferOffersResult,
  BuildTransferPreapprovalsResult,
  ContractDetailView,
  ContractListPage,
  HomeSummary,
  InstanceNodeStatusSnapshot,
  LifelineGroup,
  LivePackageCatalogRow,
  LiveTemplateCatalogRow,
  NodeOffsetReading,
  PackageSchema,
  RecentUpdateRow,
  SchemaRef,
  SearchInputClassification,
  SearchPartyInActiveContractsFound,
  SearchPartyInActiveContractsOutOfScope,
  SearchResults,
  TokenClaims,
  TypedField,
  UpdateDetailEvent,
  UpdateDetailView,
  UpdateFilter,
  ViewerPartiesUnavailable,
  ViewerPartiesView,
  ViewerPartyEntry,
} from "@canton-lens/core";

// ── Common to every 200 response ────────────────────────────────────────────────

// Not exported — it is a fragment spread inside each response, so it does not stand as a separate component.
// `@pattern` is what makes the contract **enforce** the instant format rather than merely claim it. The document
// said "ISO 8601" while the generated schema was only `{ type: "string" }`, so `readAt: "definitely-not-ISO-8601"`
// validated cleanly. It is a pattern rather than `format: date-time` because
// ajv does not validate `format` unless ajv-formats is installed — a pattern means the same thing to every reader.
// `[0-9]` rather than `\d` for the same portability reason as the router's regexes.
//
// This explanation is a `//` comment on purpose: the generator moves `/** */` into the schema's `description`,
// and the published contract should describe the field, not the reasoning behind it.
type Stamped = {
  /**
   * The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the
   * boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.
   *
   * @pattern ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$
   */
  readAt: string;
};
/** The offset the router lays on — the ledger point this response read. If received via the query, that value; otherwise the ledger end the router obtained. */
type WithOffset = { offset: number };

// ── GET /api/session ─────────────────────────────────────────────────────────────

export type SessionParty = ViewerPartyEntry & {
  /** The **raw** user rights corresponding to this party (items of the ListUserRights response). They are the viewer's own, so they are copied over without judgment. */
  rights: unknown[];
};
/**
 * What the received ledger token says about itself — issuer host, audience, expiry.
 * Decoded only, never verified here (the participant already did that), and the token
 * itself is never carried in the response. null when it cannot be decoded.
 */
export type SessionTokenClaims = TokenClaims | null;

export type SessionResponse =
  | (Omit<ViewerPartiesView, "parties"> &
      Stamped & { parties: SessionParty[]; token: SessionTokenClaims })
  | (ViewerPartiesUnavailable & Stamped & { token: SessionTokenClaims });

// ── POST /api/exercise ───────────────────────────────────────────────────────────

/**
 * A command the participant committed. Its security design is docs/ledger-writes.md.
 *
 * There is no "accepted" or "pending" shape here on purpose: this route answers only once the
 * participant has returned a completion, so a 200 means the transaction committed. A response
 * carrying no update id is reported as a 502 rather than shaped into a success with a blank field.
 */
export type SubmittedCommandResponse = Stamped & {
  /** The participant's update id — what the Transactions screen can be opened on. */
  updateId: string;
  /** null when the participant returned a completion without one; never 0 standing in for absent. */
  completionOffset: number | null;
};

// ── GET /api/contracts ───────────────────────────────────────────────────────────

export type ContractsResponse = ContractListPage & Stamped & WithOffset;

// ── GET /api/updates ─────────────────────────────────────────────────────────────

export type UpdatesResponse = Stamped &
  WithOffset & {
    rows: RecentUpdateRow[];
    /** “How far back did we look for recent” — the query range is (beginExclusive, offset]. */
    beginExclusive: number;
    /** Total count within the range (before filtering). */
    total: number;
    /** Count that passed the filter (independent of the page). */
    matched: number;
    /** The before value for the next page. null if none. */
    nextBefore: number | null;
    filter: UpdateFilter;
  };

// ── GET /api/timeline ────────────────────────────────────────────────────────────

export type TimelineResponse = Stamped &
  WithOffset & {
    /** Contract lifetimes grouped by template, biggest group first (buildLifelines · groupLifelines of core). */
    groups: LifelineGroup[];
    /** How many lifelines there are across every group. */
    total: number;
    /** The first offset drawn. The window is [from, offset] — both ends included, so from == offset is one point, not an empty range. A contract that died before it is in neither source and cannot be drawn. */
    from: number;
    filter: UpdateFilter;
  };

// ── GET /api/home ────────────────────────────────────────────────────────────────

export type HomeResponse = HomeSummary & Stamped;

// ── GET /api/updates/{updateId}, GET /api/updates/by-offset/{offset} ────────────

export type SchemaFieldLite = { name: string; type: string };
export type ChoiceLite = {
  name: string;
  consuming: boolean;
  argType: string | null;
  argFields: SchemaFieldLite[] | null;
  returnType: string | null;
};

export type UpdateDetailEventWithSchema = UpdateDetailEvent & {
  /** The choice definition of an exercised event (from the package schema). The name is already in the event's choice. null if it could not be read. */
  choiceSchema: Omit<ChoiceLite, "name"> | null;
  /** The field definitions of this event's template. For created, the typed payload as well. null if it could not be read. */
  templateSchema: { fields: SchemaFieldLite[]; typedPayload?: TypedField[] } | null;
  /** "ok" if the schema was read, otherwise the reason it could not be. */
  schemaStatus: string;
};
type UpdateDetailTransaction = Extract<UpdateDetailView, { kind: "transaction" }>;
type UpdateDetailOther = Exclude<UpdateDetailView, { kind: "transaction" }>;
export type UpdateDetailResponse = Stamped &
  (
    | (Omit<UpdateDetailTransaction, "events"> & { events: UpdateDetailEventWithSchema[] })
    | UpdateDetailOther
  );

// ── GET /api/packages/{packageId}/schema ─────────────────────────────────────────

export type PackageSchemaResponse =
  | ({ status: "ok" } & PackageSchema & Stamped)
  | ({
      status: "unavailable";
      /** unsupported_lf_version:…, decode_failed:… etc. — not a node error but a circumstance in which this layer could not read it. */
      reason: string;
      packageId: string;
    } & Stamped);

// ── GET /api/holdings, GET /api/preapprovals, GET /api/offers ──────────────────

export type HoldingsResponse = BuildTokenHoldingsResult & Stamped & WithOffset;
export type PreapprovalsResponse = BuildTransferPreapprovalsResult & Stamped & WithOffset;
export type OffersResponse = BuildTransferOffersResult & Stamped;

// ── GET /api/contracts/{contractId} ──────────────────────────────────────────────

export type ContractSchema =
  | {
      status: "ok";
      lfVersion: string;
      packageName: string | null;
      packageVersion: string | null;
      fields: SchemaFieldLite[];
      choices: ChoiceLite[];
      key: string | null;
      implements: SchemaRef[];
      typedPayload: TypedField[];
    }
  | {
      status: "unavailable";
      /** The reason the package could not be read, or template_not_in_package. */
      reason: string;
    };
export type ContractDetailResponse = ContractDetailView & Stamped & { schema: ContractSchema };

// ── GET /api/catalog/templates ───────────────────────────────────────────────────

export type TemplateDefinition =
  | { status: "unavailable"; reason: string }
  | {
      status: "ok";
      packageVersion: string | null;
      fields: SchemaFieldLite[];
      choices: ChoiceLite[];
      key: string | null;
      implements: SchemaRef[];
    };
export type TemplateRow = LiveTemplateCatalogRow & { definition: TemplateDefinition };
export type TemplatesResponse = Omit<Extract<BuildTemplateCatalogResult, { ok: true }>, "rows"> &
  Stamped & { rows: TemplateRow[] };

// ── GET /api/catalog/packages ────────────────────────────────────────────────────

export type PackageRow = LivePackageCatalogRow & {
  /** Present only when the schema was read. */
  lfVersion?: string;
  /** "ok" if the schema was read, otherwise the reason it could not be (unsupported_lf_version:1.x etc.). */
  schemaStatus: string;
  /** Empty array if the schema could not be read. */
  templates: { module: string; name: string; choices: number }[];
  interfaces: { module: string; name: string }[];
};
export type PackagesResponse = Omit<Extract<BuildPackageCatalogResult, { ok: true }>, "rows"> &
  Stamped & { rows: PackageRow[] };

// ── GET /api/node ────────────────────────────────────────────────────────────────

export type NodeResponse = InstanceNodeStatusSnapshot &
  Stamped & {
    /** The ledger end this call read. The screen's Ledger end row and the next call's prior use this value. */
    ledgerEnd: NodeOffsetReading;
  };

// ── GET /api/search ──────────────────────────────────────────────────────────────

type SearchEmpty = Extract<SearchInputClassification, { kind: "empty" }>;
type SearchNonEmpty = Exclude<SearchInputClassification, { kind: "empty" }>;
export type SearchResponse =
  // Empty input does not call the ledger — there is no offset.
  | (SearchEmpty & Stamped & { results: SearchResults })
  | (SearchNonEmpty & Stamped & WithOffset & { results: SearchResults });

// ── GET /api/party/{partyId} ─────────────────────────────────────────────────────

export type PartyResponse = (
  | SearchPartyInActiveContractsFound
  | SearchPartyInActiveContractsOutOfScope
) &
  Stamped &
  WithOffset;

// The `{reason}` body of non-200 answers is written directly by failure() in openapi.ts, per route, status code, together with the list of reasons.
