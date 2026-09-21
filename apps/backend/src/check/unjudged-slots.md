# Slots nothing judged

**Generated — `apps/backend/src/check/coverage.test.ts` writes it and requires it to match.**

Every slot of every schema a mapped answer can reach has a rule (that is `coverage()`'s business). This
is the other half: whether anything ever *ran* that rule. A rule under a union branch no ledger here
produces has never been read against anything, and mutation cannot find it — there is nothing to break.

A line leaving this list is good news. A line arriving is a question: which branch stopped being
reached, and was that the seed or the product?

370 slots · 308 judged · 62 not

| slot | what its rule says |
| --- | --- |
| `ContractDetailUnavailable.reason` | why, by name |
| `ContractKeyView.value` | the key the node sent, copied untouched |
| `HoldingsResponse.reason` | which shape, in this application's own words |
| `HomeUnavailable.reason` | why, by name — never a zero standing in for a failed lookup |
| `HomeUnavailable.status` | unavailable — this one piece could not be had, while the rest of the snapshot stands |
| `InMyContractsFlag.reason` | my_package_ids_not_provided — the only way this branch is reached, and this address always says which are mine |
| `LiveTemplateCatalogRow.contractCount` | how many of my active contracts carry it |
| `LiveTemplateCatalogRow.entity` | the third of the three parts |
| `LiveTemplateCatalogRow.module` | the second of the three parts |
| `LiveTemplateCatalogRow.packageId` | the first of the three colon-separated parts of the templateId |
| `LiveTemplateCatalogRow.packageName` | packageName |
| `LiveTemplateCatalogRow.templateId` | templateId |
| `NodeElapsed.case` | the offset moved forward, and this is how long that took |
| `NodeElapsed.ms` | the observed instant of this call less the observed instant of the prior one |
| `NodeLiveStatusResult.case` | both readings are numbers and the later one is bigger |
| `NodeLiveStatusResult.delta` | the current offset less the prior one |
| `NodeOffsetReading.reason` | why, in the same words every other ledger failure uses |
| `NodeVersionFact.reason` | why, in the same words every other ledger failure uses |
| `OffersResponse.reason` | which of the two, in this application's own words |
| `PackageSchemaResponse.reason` | which of the two, in this application's own words |
| `PreapprovalsResponse.reason` | which shape, in this application's own words |
| `SearchPackageHit.inMyContracts` | whether a template of mine comes from it |
| `SearchPackageHit.name` | the name my own contracts carry for it, or null when none of them do |
| `SearchPackageHit.packageId` | packageId |
| `SearchPartyHit.contractCount` | how many of my contracts that party is a signatory or observer of — what we have between us, not what that party holds |
| `SearchPartyHit.party` | party |
| `SearchResponse.entity_name` | the third |
| `SearchResponse.module_name` | the second |
| `SearchResponse.package_name` | the first of the three colon-separated pieces |
| `SearchResponse.packageId` | the text that was typed |
| `SearchResponse.party` | the text that was typed |
| `SearchResponse.reason` | the text that was typed |
| `SearchResponse.updateId` | the text that was typed |
| `SearchSection.LiveTemplateCatalogRow.reason` | why, by name |
| `SearchSection.LiveTemplateCatalogRow.rows` | the templates of mine whose name matches |
| `SearchSection.LiveTemplateCatalogRow.status` | ok — the lookup answered, and these are its rows. No rows is a real answer |
| `SearchSection.SearchContractHit.reason` | why, by name |
| `SearchSection.SearchPackageHit.reason` | why, by name |
| `SearchSection.SearchPackageHit.rows` | the installed packages whose id or name matches |
| `SearchSection.SearchPartyHit.reason` | why, by name |
| `SearchSection.SearchPartyHit.rows` | that party, when it appears in any contract of mine |
| `SearchSection.SearchPartyHit.status` | ok — the lookup answered, and these are its rows. No rows is a real answer |
| `SearchSection.SearchUpdateHit.reason` | why, by name |
| `SearchSection.SearchUpdateHit.rows` | the one update that id names, or none |
| `SearchSection.SearchUpdateHit.status` | ok — the lookup answered, and these are its rows. No rows is a real answer |
| `SearchUpdateHit.effectiveAt` | effectiveAt |
| `SearchUpdateHit.kind` | what the point lookup found this update to be |
| `SearchUpdateHit.offset` | offset |
| `SearchUpdateHit.updateId` | updateId |
| `SessionResponse.reason` | which of the two answers was not the shape, in this application's own words |
| `TokenClaims.audience` | the token's aud as a list: one string becomes a list of one, a list keeps its strings, anything else is empty |
| `TokenClaims.expiresAt` | the token's exp read as seconds since the epoch and written as an instant, or null when there is none — so that an unknown expiry is not drawn as zero |
| `TokenClaims.issuerHost` | the host of the token's iss when iss is a URL, else iss itself cut to eighty characters, else null — the path inside an issuer is not the browser's business |
| `TransferOfferProblem.code` | the node's view status code, or -1 when it sent none that is a number |
| `TransferOfferProblem.contractId` | contractId |
| `TransferOfferProblem.details` | the node's view status details, or an empty list |
| `TransferOfferProblem.interfaceId` | interfaceId |
| `TransferOfferProblem.message` | the node's view status message, the empty string when it sent none, or this application's own words when the status was success but the fields were not there |
| `UnavailableInThisLayer.status` | unavailable_in_this_layer — the node's package list carries ids and nothing else, so a name it does not carry is said to be missing rather than guessed |
| `UpdateDetailResponse.offset` | its offset, or null |
| `UpdateDetailResponse.updateId` | the id of that thing, or null when it carries none |
| `VisibilityExplanation.reason` | which of them, in this application's own words |
