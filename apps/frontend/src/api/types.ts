// The shape of API responses — **the copy the screen reads.** The types of values whose judgment is finished are imported from packages/core as **types only** (no runtime
// code gets mixed in), and the fields the router (apps/backend/src/router.ts) layers on top (readAt·schema·definition …) are written here.
// The original of the contract is apps/backend/src/responses.ts — the response schemas of openapi.json are generated from there. This file is the same shape
// written again on the screen side (ui does not depend on the api package), so when the fields the router layers on change, fix both together.
import type {
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
  RecentUpdateRow,
  SchemaRef,
  SearchInputClassification,
  SearchPartyInActiveContractsFound,
  SearchPartyInActiveContractsOutOfScope,
  SearchResults,
  TokenClaims,
  TokenHoldingGroup,
  TransferPreapprovalRow,
  TypedField,
  UnavailableInThisLayer,
  UpdateDetailEvent,
  UpdateDetailView,
  UpdateFilter,
  ViewerPartiesUnavailable,
  ViewerPartiesView,
  ViewerPartyEntry,
} from "@canton-lens/core";

export type {
  ContractListRow,
  HomeOfferPreview,
  HomePendingOffersCard,
  Lifeline,
  LifelineGroup,
  RecentUpdateRow,
  SchemaRef,
  TokenHoldingGroup,
  TransferOfferRow,
  TransferPreapprovalRow,
  TypedField,
  TypedValue,
  UpdateDetailHeader,
  VisibilityReason,
} from "@canton-lens/core";

// The read time is stamped on every 200 response by the place that owns the socket (build-app.mjs).
export type Stamped = { readAt: string };
export type HomeResponse = HomeSummary & Stamped;

export type SessionParty = ViewerPartyEntry & { rights: unknown[] };
// token — what the received ledger token says about itself (issuer host · audience · expiry).
// The server only decodes it and attaches it.
export type SessionResponse =
  | (Omit<ViewerPartiesView, "parties"> &
      Stamped & { parties: SessionParty[]; token?: TokenClaims | null })
  | (ViewerPartiesUnavailable & Stamped & { token?: TokenClaims | null });

export type ContractsResponse = ContractListPage & Stamped & { offset: number };

export type UpdatesResponse = Stamped & {
  rows: RecentUpdateRow[];
  offset: number;
  beginExclusive: number;
  total: number;
  matched: number;
  nextBefore: number | null;
  filter: UpdateFilter;
};

export type SchemaFieldLite = { name: string; type: string };
export type ChoiceLite = {
  name: string;
  consuming: boolean;
  argType: string | null;
  argFields: SchemaFieldLite[] | null;
  returnType: string | null;
};

export type TxEvent = UpdateDetailEvent & {
  // The router already put the choice name on the event (e.choice), so it is not here.
  choiceSchema: Omit<ChoiceLite, "name"> | null;
  templateSchema: { fields: SchemaFieldLite[]; typedPayload?: TypedField[] } | null;
  schemaStatus: string;
};
type TxTransaction = Extract<UpdateDetailView, { kind: "transaction" }>;
type TxOther = Exclude<UpdateDetailView, { kind: "transaction" }>;
export type TxResponse = Stamped &
  ((Omit<TxTransaction, "events"> & { events: TxEvent[] }) | TxOther);

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
  | { status: "unavailable"; reason: string };
export type ContractResponse = ContractDetailView & Stamped & { schema: ContractSchema };

export type PartyResponse = (
  | SearchPartyInActiveContractsFound
  | SearchPartyInActiveContractsOutOfScope
) &
  Stamped & { offset: number };

export type TimelineResponse = Stamped & {
  groups: LifelineGroup[];
  total: number;
  offset: number;
  // The first offset drawn. The window is [from, offset] — both ends inclusive.
  from: number;
  filter: UpdateFilter;
};

export type OffersResponse = BuildTransferOffersResult & Stamped;
export type HoldingsResponse = BuildTokenHoldingsResult & Stamped & { offset: number };
export type PreapprovalsResponse = BuildTransferPreapprovalsResult & Stamped & { offset: number };

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
export type TemplatesResponse = Stamped & {
  ok: true;
  scope: "visible_to_requester";
  rows: TemplateRow[];
};

export type PackageRow = Omit<LivePackageCatalogRow, "name" | "version"> & {
  name: string | UnavailableInThisLayer;
  version: string | UnavailableInThisLayer;
  lfVersion?: string;
  schemaStatus: string;
  templates: { module: string; name: string; choices: number }[];
  interfaces: { module: string; name: string }[];
};
export type PackagesResponse = Stamped & { ok: true; scope: "instance_wide"; rows: PackageRow[] };

export type NodeResponse = InstanceNodeStatusSnapshot & Stamped & { ledgerEnd: NodeOffsetReading };

export type SearchResponse = SearchInputClassification &
  Stamped & { results: SearchResults; offset?: number };

// A cache reused by the party page·holding detail — failures are kept too (so it is not drawn with an old value or as "none").
export type HoldingsCache = { groups: TokenHoldingGroup[]; failed?: string };
export type PreapprovalsCache = { rows: TransferPreapprovalRow[]; failed?: string };
