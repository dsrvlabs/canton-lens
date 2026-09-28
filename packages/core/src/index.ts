// The public surface of packages/core. Anything not re-exported here is not used outside the package.
//
// The core rules are in docs/development.md, Backend core rules. In summary:
//   1. Zero runtime dependencies — nothing is imported beyond the `node:` builtins
//   2. A failed lookup is never returned as 0·[]·null
//   3. Visibility judgment happens in a single chokepoint, in one place only
//   4. No write path is created
//
// Relative imports keep the extension as is: `export * from "./identifier.ts";`

export { buildPackageCatalog } from "./catalog-live/build-package-catalog.ts";
export { buildTemplateCatalog } from "./catalog-live/build-template-catalog.ts";
export type {
  BuildPackageCatalogResult,
  BuildTemplateCatalogResult,
  InMyContractsFlag,
  LivePackageCatalogRow,
  LiveTemplateCatalogRow,
  UnavailableInThisLayer,
} from "./catalog-live/types.ts";
export type {
  BuildContractDetailFailure,
  BuildContractDetailResult,
  BuildContractDetailSuccess,
  ContractDetailUnavailable,
  ContractDetailView,
  ContractRenderMode,
  LedgerAcsEntry,
} from "./contract-detail/build-contract-detail.ts";
export { buildContractDetail } from "./contract-detail/build-contract-detail.ts";
export type {
  BuildContractListResult,
  ContractListCursor,
  ContractListEntry,
  ContractListPage,
  ContractListRow,
  ContractListUnavailable,
  ViewerPartyInput,
} from "./contract-list/build-contract-list.ts";
// **Two constraints handed to the next run that touches apps/.** This layer has finished the
// judgment, so the layers above only read it as is.
//   ① The second argument of buildContractList receives **all** of the viewer's parties. If only one
//      is passed, a person with several parties sees their own party shown as the “counterparty” — that is the reason for this change.
//   ② The screen reads directionInfo as is and **does not recompute it.** Direction judgment lives in
//      exactly one place in this layer (classifyTransferDirection). Code that compared sender·receiver against
//      its own party actually existed on the screen, and that was placing judgment in the screen.
export { buildContractList } from "./contract-list/build-contract-list.ts";
// Reading the contract blueprint — DAR decoder (LF 2.x surface, parsed directly). ArchivePayload bytes → package schema → typed payload.
export type { ArchivePayloadResult } from "./daml-lf/archive-payload.ts";
export { readArchivePayload, SUPPORTED_LF2_MINORS } from "./daml-lf/archive-payload.ts";
export type {
  BuildPackageSchemaResult,
  PackageSchema,
  SchemaChoice,
  SchemaDataType,
  SchemaField,
  SchemaInterface,
  SchemaRef,
  SchemaTemplate,
} from "./daml-lf/build-package-schema.ts";
export {
  buildPackageSchema,
  findDataType,
  findInterface,
  findTemplate,
} from "./daml-lf/build-package-schema.ts";
export type {
  BuiltinName,
  Lf2Package,
  LfChoice,
  LfDataType,
  LfField,
  LfInterface,
  LfModule,
  LfTemplate,
  LfType,
  LfTypeConRef,
  PackageRef,
} from "./daml-lf/lf2-package.ts";
export { LfDecodeError, readLf2Package } from "./daml-lf/lf2-package.ts";
export { typeHead, typeText } from "./daml-lf/type-text.ts";
export type { SchemaLookup, TypedField, TypedValue } from "./daml-lf/typed-payload.ts";
export { typeRecordFields, typeValue } from "./daml-lf/typed-payload.ts";
export type {
  TimeBucketSource,
  UpdateTimeDistribution,
} from "./home-summary/bucket-updates-by-time.ts";
export { bucketUpdatesByTime } from "./home-summary/bucket-updates-by-time.ts";
export type {
  BuildHomeSummaryInput,
  BuildHomeSummaryResult,
  HomeCards,
  HomeCountCard,
  HomeOfferPreview,
  HomePendingOffersCard,
  HomeRecent,
  HomeSource,
  HomeSummary,
  HomeTokensCard,
  HomeUnavailable,
} from "./home-summary/build-home-summary.ts";
export {
  buildHomeSummary,
  IMMINENT_EXPIRY_MS,
  PREVIEW_LIMIT,
} from "./home-summary/build-home-summary.ts";
export type {
  BuildTokenKindsResult,
  TokenKindEntry,
  TokenKindProblem,
  TokenKindsView,
} from "./home-summary/build-token-kinds.ts";
export { buildTokenKinds } from "./home-summary/build-token-kinds.ts";
export {
  interfaceIdsMatch,
  isWellFormedInterfaceId,
} from "./ledger-request/interface-id-equivalence.ts";
// **build*Request is exported together with call* as a pair.** Nothing in this repository calls build* on its
// own, so it looks removable; it is not. Its consumer is a script run against a live node to check the
// **request shape**, which no test here can reach — unit tests see only captured responses. Drop build* and
// that check breaks with nothing in this repository going red.
export { interpretLedgerResponse } from "./ledger-request/interpret.ts";
export {
  buildGetActiveContractsRequest,
  callGetActiveContracts,
} from "./ledger-request/request-active-contracts.ts";
export {
  buildGetAuthenticatedUserRequest,
  callGetAuthenticatedUser,
} from "./ledger-request/request-authenticated-user.ts";
export type { LedgerVersionResponse } from "./ledger-request/request-get-version.ts";
export { buildGetVersionRequest, callGetVersion } from "./ledger-request/request-get-version.ts";
export { buildGetLedgerEndRequest, callGetLedgerEnd } from "./ledger-request/request-ledger-end.ts";
export { buildGetPackageRequest, callGetPackage } from "./ledger-request/request-package.ts";
export { buildListPackagesRequest, callListPackages } from "./ledger-request/request-packages.ts";
export type { RecentUpdatesRead } from "./ledger-request/request-recent-updates.ts";
export {
  callGetRecentUpdates,
  countTransactions,
  RECENT_UPDATES_LOOKBACK,
  RECENT_UPDATES_MAX_LOOKBACK,
  RECENT_UPDATES_TARGET,
  RECENT_UPDATES_WIDEN_FACTOR,
  widenLookback,
} from "./ledger-request/request-recent-updates.ts";
export {
  buildGetUpdateByIdRequest,
  callGetUpdateById,
  updateFormatLedgerEffects,
} from "./ledger-request/request-update-by-id.ts";
export {
  buildGetUpdateByOffsetRequest,
  callGetUpdateByOffset,
} from "./ledger-request/request-update-by-offset.ts";
export { buildGetUpdatesRequest, callGetUpdates } from "./ledger-request/request-updates.ts";
export {
  buildListUserRightsRequest,
  callListUserRights,
} from "./ledger-request/request-user-rights.ts";
export type {
  LedgerCallFailure,
  LedgerCallOk,
  LedgerCallResult,
  LedgerFailureReason,
  LedgerPartyFilter,
  LedgerRequest,
  LedgerSend,
} from "./ledger-request/types.ts";
export type {
  NodeLiveStatusResult,
  NodeOffsetReading,
} from "./node-live-status/compute-node-live-status.ts";
export { computeInstanceLedgerEndProgress } from "./node-live-status/compute-node-live-status.ts";
export type {
  InstanceNodeStatusSnapshot,
  NodeElapsed,
  NodeVersionFact,
  ObservedAtMs,
} from "./node-status/build-node-status-snapshot.ts";
export { buildNodeStatusSnapshot } from "./node-status/build-node-status-snapshot.ts";
export type {
  RecentUpdateEventRow,
  RecentUpdateRow,
  UpdateEntry,
  UpdateEventEntry,
} from "./recent-updates/build-recent-updates.ts";
export {
  buildRecentUpdates,
  RECENT_UPDATES_DEFAULT_LIMIT,
} from "./recent-updates/build-recent-updates.ts";
export type {
  FilterUpdatesResult,
  UpdateFilter,
  UpdatesPage,
} from "./recent-updates/filter-recent-updates.ts";
export {
  eventMatchesFilter,
  filterAndPageUpdates,
  UPDATES_PAGE_SIZE,
  updateMatchesFilter,
} from "./recent-updates/filter-recent-updates.ts";
export type {
  BuildSearchResultsInput,
  SearchContractHit,
  SearchContractSource,
  SearchPackageHit,
  SearchPartyHit,
  SearchResults,
  SearchSection,
  SearchUpdateSource,
} from "./search/build-search-results.ts";
export { buildSearchResults } from "./search/build-search-results.ts";
export type { SearchInputClassification } from "./search/classify-search-input.ts";
export { classifySearchInput } from "./search/classify-search-input.ts";
export type {
  ActiveContractEntry,
  SearchPartyInActiveContractsFound,
  SearchPartyInActiveContractsInvalidInput,
  SearchPartyInActiveContractsOutOfScope,
  SearchPartyInActiveContractsResult,
} from "./search/search-party-in-active-contracts.ts";
export { searchPartyInActiveContracts } from "./search/search-party-in-active-contracts.ts";
export type {
  ParsedTemplateIdentifier,
  ParseTemplateIdentifierFailure,
  ParseTemplateIdentifierFailureReason,
  ParseTemplateIdentifierResult,
} from "./template-identifier/parse-template-identifier.ts";
export { parseTemplateFqn } from "./template-identifier/parse-template-identifier.ts";
export type {
  Lifeline,
  LifelineGroup,
  LifelineState,
  LifelineWindow,
} from "./timeline/build-lifelines.ts";
export { buildLifelines, groupLifelines } from "./timeline/build-lifelines.ts";
export { readTokenClaims, type TokenClaims } from "./token-claims/read-token-claims.ts";
export type {
  BuildTokenHoldingsResult,
  HoldingSourceEntry,
  TokenHoldingContract,
  TokenHoldingGroup,
  TokenHoldingProblem,
  TokenHoldingsView,
} from "./token-holdings/build-token-holdings.ts";
export {
  buildTokenHoldings,
  DECAYING_HOLDING_TEMPLATES,
  isDecayingHoldingTemplate,
} from "./token-holdings/build-token-holdings.ts";
export type {
  BuildTransferPreapprovalsResult,
  TransferPreapprovalExpiry,
  TransferPreapprovalRow,
  TransferPreapprovalsView,
} from "./token-holdings/build-transfer-preapprovals.ts";
export { buildTransferPreapprovals } from "./token-holdings/build-transfer-preapprovals.ts";
export type {
  BuildTransferOffersResult,
  TransferDirection,
  TransferDirectionInfo,
  TransferOfferExpiry,
  TransferOfferProblem,
  TransferOfferRow,
  TransferOffersView,
} from "./transfer-offers/build-transfer-offers.ts";
export { buildTransferOffers } from "./transfer-offers/build-transfer-offers.ts";
export type {
  BuildUpdateDetailResult,
  UpdateDetailEvent,
  UpdateDetailHeader,
  UpdateDetailView,
  UpdateVisibilityReason,
} from "./update-detail/build-update-detail.ts";
export { buildUpdateDetail } from "./update-detail/build-update-detail.ts";
export type {
  GroupableEvent,
  UpdateViewGroup,
} from "./update-detail/group-update-views.ts";
export { groupUpdateViews } from "./update-detail/group-update-views.ts";
export type {
  NestableEvent,
  UpdateEventPlacement,
} from "./update-detail/nest-update-events.ts";
export { nestUpdateEvents } from "./update-detail/nest-update-events.ts";
export type {
  BuildViewerPartiesResult,
  ViewerPartiesUnavailable,
  ViewerPartiesView,
  ViewerPartyEntry,
  ViewerScope,
} from "./viewer-parties/build-viewer-parties.ts";
export { buildViewerParties } from "./viewer-parties/build-viewer-parties.ts";
export type {
  VisibilityExplanation,
  VisibilityReason,
  VisibilityRole,
} from "./visibility/explain-visibility.ts";
export { explainVisibility } from "./visibility/explain-visibility.ts";
