// The route documentation of this server (apps/backend). A .ts module holds it as a value, and the boot file (live/build-app.mjs)
// exports it as /openapi.json. No file I/O, network, clock calls — it is a pure object literal.
//
// **It is split into two layers.** The **shape** of response bodies is held by openapi-schemas.generated.ts, generated from the
// TypeScript types of responses.ts (core types + the fields the router lays on), and referenced here via $ref — there is no place
// for code and docs to diverge (`pnpm openapi:check`). Routes, parameters, status codes and **the explanation of “why this shape”**
// are written here by hand — context such as how “recent” is bounded does not come out of the types.
// This is OpenAPI 3.1. 3.1 schemas are JSON Schema 2020-12, so a description can sit next to a $ref.
import { responseSchemas } from "./openapi-schemas.generated.ts";

type SchemaName = keyof typeof responseSchemas;

// The deployed profile changes credential input and operational failures, not successful schemas.
// Keep the caller-bearer document unchanged; /openapi.json itself never acquires a token.
export function sharedIdentityOpenApi(document: typeof openApiDocument) {
  return {
    ...document,
    security: [],
    info: {
      ...document.info,
      description:
        "Shared Identity Mode does not authenticate individual users. Every request is executed using one configured Canton service identity. The operator is responsible for controlling access to the Explorer. Incoming Authorization headers are rejected. Successful response schemas are shared with caller-bearer mode.",
    },
    paths: Object.fromEntries(
      Object.entries(document.paths).map(([path, item]) => {
        const responses: Record<string, unknown> = { ...item.get.responses };
        delete responses["401"];
        responses["409"] = failure(
          "The gateway must consume or strip its Authorization header before forwarding to Explorer.",
          ["shared_identity_authorization_not_allowed"],
        );
        responses["503"] = failure(
          "The configured service credential is unavailable or Canton rejected it. Contact the operator; no user login or automatic retry.",
          ["shared_identity_unavailable"],
        );
        responses["403"] = failure(
          "The configured Canton service identity has insufficient rights.",
          ["shared_identity_forbidden"],
        );
        return [path, { ...item, get: { ...item.get, responses } }];
      }),
    ),
  };
}

// 200 body — points at one generated schema. If the name is not in the generated file, it is a compile error.
function ok(name: SchemaName, description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${name}` },
      },
    },
  };
}

// The body of a non-200 answer always names a reason. A boot adapter may add an optional recovery
// address to 401; the router remains independent of deployment addresses.
function failure(
  description: string,
  reasons: readonly string[],
  properties: Record<string, object> = {},
) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: { reason: { type: "string", enum: [...reasons] }, ...properties },
          required: ["reason"],
        },
      },
    },
  };
}

const unauthenticatedResponse = failure(
  "Without a ledger token it is 401. reason is unauthenticated. If PUBLIC_ENTRY_URL is configured, entryUrl offers that public service entry without redirecting automatically.",
  ["unauthenticated"],
  {
    entryUrl: {
      type: "string",
      format: "uri",
      description:
        "Optional public service entry supplied by deployment configuration. It is not assumed to be a login route.",
    },
  },
);

// Failures every ledger-calling route can produce — the router only maps ledger failure names to status codes
// (ledger-failure-to-http.ts) and does not invent new names. If the response shape is off (envelope failure) it is node_error.
const ledgerFailureResponses = {
  "403": failure(
    "forbidden — the participant answered that the token has no right to make this query.",
    ["forbidden"],
  ),
  "502": failure(
    "node_error — the participant answered with an error, or the response shape differs from what this layer knows. " +
      "too_many_elements — the list is larger than this path will serve: the participant's JSON API refuses to " +
      "return more than `http-list-max-elements-limit` elements in one response. No parameter of the request " +
      "changes this; the remedy is that limit on the node.",
    ["node_error", "too_many_elements"],
  ),
  "504": failure("unreachable — the participant could not be reached.", ["unreachable"]),
};

// Routes that query the ledger with the viewer's party filter. A ledger user with neither CanReadAs nor
// CanActAs has no filter to send, so these routes answer before the participant is asked. One status code
// carries one response object, so the shared 403 is restated here with both reasons rather than added
// beside it. /api/session and /api/home are not in this set: they report the zero-party viewer inside a 200.
const partyScopedFailureResponses = {
  ...ledgerFailureResponses,
  "403": failure(
    "forbidden — the participant answered that the token has no right to make this query. " +
      "no_party_rights — the viewer's ledger user holds no CanReadAs or CanActAs right, so this route " +
      "has no party filter to query with and the participant is not asked.",
    ["forbidden", "no_party_rights"],
  ),
};

const offsetParameter = {
  name: "offset",
  in: "query",
  required: false,
  schema: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 15 },
  description:
    "A non-negative integer string. The snapshot at this offset. If absent, the router obtains the ledger " +
    "end offset and uses it. A negative value is 400 (invalid_offset), and **a value past the ledger end is " +
    "400 (offset_after_ledger_end)**. The latter may become valid as the ledger end advances " +
    "(the mirror image of pruned/410 — " +
    'that one means "it existed but is not retained").',
};

export const openApiDocument = {
  openapi: "3.1.0",
  // The value when served at the root. When under a sub-path (BASE_PATH), the boot file replaces this entry with that path on export.
  servers: [{ url: "/" }],
  // Caller-bearer document: Browser PKCE or an institution front supplies the per-request Bearer;
  // Canton validates it. sharedIdentityOpenApi adapts this contract for Backend-owned service credentials.
  security: [{ ledgerToken: [] }],
  info: {
    title: "Canton Lens API",
    version: "0.1.0",
    description:
      "The HTTP surface of the explorer that reads a Canton participant's private ledger. Read-only. Visibility is enforced not by " +
      "this server but by the participant — the ledger token carried in the request is passed to the ledger as is, so the answer is by definition Canton's answer. " +
      "Every 200 body has readAt (RFC 3339, the time this server built the response) — the response schemas\n" +
      "enforce that shape with a pattern, not merely describe it.",
  },
  paths: {
    "/api/session": {
      get: {
        operationId: "getSession",
        summary: "The viewer's own party list",
        responses: {
          "200": ok(
            "SessionResponse",
            "The value built by buildViewerParties(core). If outcome is view, each party comes with its raw rights (ListUserRights items) — " +
              "they are the viewer's own, so no new permission is needed and it is copying, not judgment. Even if outcome is unavailable it is 200.",
          ),
          "401": unauthenticatedResponse,
          ...ledgerFailureResponses,
        },
      },
    },
    "/api/contracts": {
      get: {
        operationId: "listContracts",
        summary: "My active contract list",
        parameters: [
          offsetParameter,
          {
            name: "pageSize",
            in: "query",
            required: false,
            // 1 or greater. 0 or an empty value is 400 (invalid_page_size) — it used to silently become the default.
            schema: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 15 },
          },
          {
            name: "template",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Exact match against one of entity, module:entity, pkg:module:entity. The response's matched shrinks and total stays the same.",
          },
          {
            name: "party",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Comma-separated party ids. A contract matches when any listed party is a signatory or observer (OR).",
          },
          {
            name: "cursorOffset",
            in: "query",
            required: false,
            schema: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 15 },
            description:
              "nextCursor.offset — together with cursorCreatedAt, cursorContractId it forms the keyset cursor (newest first).",
          },
          {
            name: "cursorCreatedAt",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Must be present together with cursorContractId to be used for querying past the page.",
          },
          {
            name: "cursorContractId",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Must be present together with cursorCreatedAt to be used for querying past the page.",
          },
        ],
        responses: {
          "200": ok(
            "ContractsResponse",
            "The page result of buildContractList(core) spread out, plus offset (the value the router laid on via resolveOffset, " +
              "not buildContractList's page itself).",
          ),
          "400": failure(
            "invalid_offset · offset_after_ledger_end · invalid_page_size (0 or empty) · " +
              "invalid_cursor (cursorOffset is not a canonical integer string).",
            ["invalid_offset", "offset_after_ledger_end", "invalid_page_size", "invalid_cursor"],
          ),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/updates": {
      get: {
        operationId: "listUpdates",
        summary:
          "What happened recently in my scope (created, archived) — template, multi-party filters, keyset pages",
        parameters: [
          {
            name: "template",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Exact match against one of entity, module:entity, pkg:module:entity. Passes if any one of the update's events matches.",
          },
          {
            name: "party",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Comma-separated party ids. An update matches when any listed party appears in any event (OR).",
          },
          {
            name: "before",
            in: "query",
            required: false,
            schema: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 15 },
            description:
              "Keyset page — starting from those smaller than this offset. Put in the response's nextBefore as is.",
          },
          {
            name: "offset",
            in: "query",
            required: false,
            schema: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 15 },
            description:
              "The end of the range (endInclusive). If absent, the router obtains the ledger end offset and uses it.",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            // 1 or greater. 0 has no meaning, so it is a 400 (invalid_limit).
            schema: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 15 },
            description:
              "Upper bound on the number of rows, newest on top (1 or greater). Default 25.",
          },
        ],
        responses: {
          "200": ok(
            "UpdatesResponse",
            "The rows of buildRecentUpdates(core) (a list of created/archived events per update), filtered, paged, plus " +
              "offset, beginExclusive. " +
              "“Recent” is a window that starts 500 offsets back and widens in steps (×4, up to 128,000 offsets) until it holds 500 of the viewer's transactions, reaches the ledger's start, or reaches that bound — not the full history; older history is not served. A pruned past ends the widening, not the read. " +
              "beginExclusive says “how far back did we look for recent”. An empty ledger (offset 0) " +
              "answers with an empty page without calling the ledger.",
          ),
          "400": failure(
            "invalid_offset · invalid_before · invalid_limit — not an integer string, or limit is 0 or less.",
            ["invalid_offset", "offset_after_ledger_end", "invalid_before", "invalid_limit"],
          ),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/timeline": {
      get: {
        operationId: "getTimeline",
        summary:
          "Contract lifetimes in the recent window — one span per contract, on the offset axis",
        parameters: [
          {
            name: "template",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Exact match against one of entity, module:entity, pkg:module:entity — the same rule the two lists use.",
          },
          {
            name: "party",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Comma-separated party ids. A lifetime is kept when any listed party appears (OR), judged by the same core filters as /api/updates and /api/contracts.",
          },
          {
            name: "from",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 0 },
            description:
              "The first offset drawn. The window is [from, offset] — both ends included, so from == offset draws that one point rather than an empty range. Absent means the latest 100 offsets - narrower than the 500 the lists call recent, because a timeline lays a whole span out at once instead of paging it. It may not exceed offset, and the span may not exceed 5000: a wider one is refused rather than quietly narrowed, because a drawn window that differs from the requested one misreads as fact.",
          },
          offsetParameter,
        ],
        responses: {
          "200": ok(
            "TimelineResponse",
            "buildLifelines(core) over two reads taken at the one offset: the [from, offset] update window and the " +
              "active contracts. A lifetime carries where it started and ended as ledger offsets plus a state — archived (an " +
              "archive was seen in the window), alive (no archive, and it is in the active contracts) or unknown (no archive " +
              "seen and not active). unknown is not alive: an archived event carries no signatories or observers, so a " +
              "party-filtered window can miss an end, and saying alive there would invent a fact. startKnown is false for a " +
              "contract created before the window — its start is clamped to the window edge. A contract archived before the " +
              "window is in neither source and does not appear at all. An empty ledger " +
              "(offset 0) answers with no groups without calling the ledger.",
          ),
          "400": failure(
            "invalid_offset (from or offset is not a non-negative integer string) · offset_after_ledger_end · " +
              "invalid_window (from is after offset) · window_too_wide (the span exceeds 5000 offsets).",
            ["invalid_offset", "offset_after_ledger_end", "invalid_window", "window_too_wide"],
          ),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/home": {
      get: {
        operationId: "getHome",
        summary:
          "Home — a summary of my workspace at one offset (cards, sparkline, recent transactions)",
        parameters: [
          {
            name: "asOf",
            in: "query",
            required: true,
            schema: { type: "string", format: "date-time" },
            description:
              "The reference time for judging expiry of pending offers. The caller measures it and passes it in — the server does not read the clock.",
          },
          {
            name: "interfaceId",
            in: "query",
            required: false,
            // Three segments, `<package>:<Module>:<Entity>`. An empty string, or one without colons, is 400 (invalid_interface_id).
            schema: {
              type: "string",
              pattern:
                "^(#[A-Za-z0-9_-]+|[0-9a-f]{64}):[A-Za-z_][A-Za-z0-9_$.]*:[A-Za-z_][A-Za-z0-9_$]*$",
            },
            description:
              "The standard TransferInstruction interface id. If absent, the pendingOffers card is " +
              "unavailable(interface_id_not_provided) and the rest come as usual.",
          },
          {
            name: "holdingInterfaceId",
            in: "query",
            required: false,
            // Three segments, `<package>:<Module>:<Entity>`. An empty string, or one without colons, is 400 (invalid_interface_id).
            schema: {
              type: "string",
              pattern:
                "^(#[A-Za-z0-9_-]+|[0-9a-f]{64}):[A-Za-z_][A-Za-z0-9_$.]*:[A-Za-z_][A-Za-z0-9_$]*$",
            },
            description:
              "The standard Holding interface id. If absent, the tokens card is " +
              "unavailable(holding_interface_id_not_provided) and the rest come as usual.",
          },
          offsetParameter,
        ],
        responses: {
          "200": ok(
            "HomeResponse",
            "buildHomeSummary(core). Everything on the home screen is taken at the offset of this one response: the cards, the sparkline and the " +
              "list share one snapshot, and the sparkline is computed from the same update array the list was read from. If the offset, the user or the " +
              "rights cannot be obtained, the request fails with a status code (the home does not render without them); if a later source fails, only " +
              "that card becomes {status:unavailable, reason}. cards: with no parties, a single {status:no_party_rights}; otherwise activeContracts, " +
              "pendingOffers (my turn, unexpired, up to 5 previewed in order of nearest expiry) and tokens (based on the standard Holding interface; tokens " +
              "from apps that do not implement the standard are not included). recent: " +
              "“Recent” is a window that starts 500 offsets back and widens in steps (×4, up to 128,000 offsets) until it holds 500 of the viewer's transactions, reaches the ledger's start, or reaches that bound — not the full history; older history is not served. A pruned past ends the widening, not the read.",
          ),
          "400": failure(
            "invalid_as_of (absent, or not an instant) · invalid_offset · offset_after_ledger_end · " +
              "invalid_interface_id (interfaceId·holdingInterfaceId is an empty string — different from absent).",
            ["invalid_as_of", "invalid_offset", "offset_after_ledger_end", "invalid_interface_id"],
          ),
          "401": unauthenticatedResponse,
          ...ledgerFailureResponses,
        },
      },
    },
    "/api/updates/{updateId}": {
      get: {
        operationId: "getUpdate",
        summary:
          "Update detail — point lookup (LEDGER_EFFECTS: choice, arguments, result), “why I see this”",
        parameters: [
          {
            name: "updateId",
            in: "path",
            required: true,
            // A sha256 (32 bytes) prefixed by the multihash `1220`, so 68 hex characters (verified across
            // every update on a real node). A malformed one is 400 (invalid_path), rejected here rather
            // than passed on to the ledger.
            schema: { type: "string", pattern: "^1220[0-9a-f]{64}$" },
            description:
              "The multihash prefix `1220` (sha2-256) + 64 hex characters = 68 characters. A malformed one is " +
              "400 (invalid_path); a well-formed one that does not exist or is not visible is 404. Even outside " +
              "the list range it opens as long as the participant retains it.",
          },
        ],
        responses: {
          "200": ok(
            "UpdateDetailResponse",
            "The view of buildUpdateDetail(core). If kind is transaction, each event carries the " +
              "choice, template definitions read from the package schema (choiceSchema, templateSchema) and schemaStatus — if the schema " +
              "cannot be read, only that event is null and Raw stays as is. Events keep the node order the participant sent and each " +
              "carries its place in the transaction tree (tree.depth · tree.ancestorIndex · tree.descendantCount, derived from nodeId and " +
              "lastDescendantNodeId); a client that ignores tree reads the same flat list. If kind is not transaction (reassignment etc.), " +
              "header only — the screen says “not in this version”.",
          ),
          "400": failure(
            "invalid_path — if the updateId path segment does not decode (non-hex after a percent) it is 400.",
            ["invalid_path"],
          ),
          "404": failure("not_found — absent or not visible (the two are not distinguished).", [
            "not_found",
          ]),
          "410": failure("pruned — history the participant has already pruned.", ["pruned"]),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/updates/by-offset/{offset}": {
      get: {
        operationId: "getUpdateByOffset",
        summary:
          "Update detail — point lookup by offset (where the “creating update” link from Contracts lands)",
        parameters: [
          {
            name: "offset",
            in: "path",
            required: true,
            // **Must be greater than 0.** The ledger answers NON_POSITIVE_OFFSET for this point lookup.
            schema: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 15 },
            description:
              "The contract's createdEvent.offset (1 or greater). The ACS does not give an update id, so it is opened by offset.",
          },
        ],
        responses: {
          "200": ok("UpdateDetailResponse", "Same shape as /api/updates/{updateId}."),
          "400": failure(
            "invalid_offset — 0 or less, or beyond the safe-integer range. This point lookup accepts only offsets greater than 0.",
            ["invalid_offset"],
          ),
          "404": failure("not_found", ["not_found"]),
          "410": failure("pruned", ["pruned"]),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/packages/{packageId}/schema": {
      get: {
        operationId: "getPackageSchema",
        summary:
          "Reading the contract blueprint — package schema (Daml-LF 2.x surface: templates, field types, choices, interfaces). Direct parsing, cached (content-addressed).",
        parameters: [
          {
            name: "packageId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[0-9a-f]{64}$" },
            description: "Package id (sha256). Reads the ArchivePayload of GET /v2/packages/{id}.",
          },
        ],
        responses: {
          "200": ok(
            "PackageSchemaResponse",
            "status ok + the schema of buildPackageSchema(core) (name, version, lfVersion, modules[templates, interfaces, dataTypes], counts). " +
              "Unsupported LF (1.x, 2.dev, 2.4+) or a decode failure is not a node error but status unavailable + reason inside a 200.",
          ),
          "404": failure("not_found — no such package.", ["not_found"]),
          "401": unauthenticatedResponse,
          ...ledgerFailureResponses,
        },
      },
    },
    "/api/holdings": {
      get: {
        operationId: "listHoldings",
        summary:
          "Token balances visible to me — aggregated by instrument × owner (standard Holding interface view or semantic adapter)",
        parameters: [
          {
            name: "holdingInterfaceId",
            in: "query",
            required: false,
            // Three segments, `<package>:<Module>:<Entity>`. An empty string, or one without colons, is 400 (invalid_interface_id).
            schema: {
              type: "string",
              pattern:
                "^(#[A-Za-z0-9_-]+|[0-9a-f]{64}):[A-Za-z_][A-Za-z0-9_$.]*:[A-Za-z_][A-Za-z0-9_$]*$",
            },
            description:
              "The standard Holding interface id. If present, queries with an InterfaceFilter and aggregates by the view (owner, instrumentId, amount) — the same technique as the home card. If omitted, the template adapter is used.",
          },
          offsetParameter,
        ],
        responses: {
          "200": ok(
            "HoldingsResponse",
            "The value of buildTokenHoldings(core) plus offset. A balance is the sum of several Holding contracts, like UTXOs, and " +
              "since the input is already the visible scope, “all holders” is not here. If kind is available, view.groups — instrumentId, owner, " +
              "ownerIsViewer, total (decimal string sum), contractCount, contracts (per contract: contractId, amount, issuer). " +
              "view.problems are Holdings whose shape is off. Even if kind is unavailable it is 200.",
          ),
          "400": failure(
            "invalid_offset · offset_after_ledger_end · " +
              "invalid_interface_id (holdingInterfaceId is an empty string — different from absent).",
            ["invalid_offset", "offset_after_ledger_end", "invalid_interface_id"],
          ),
          "404": failure(
            "not_found — the package of the named interface is not on this participant. The shape was " +
              "valid, so it is not a 400 (the ledger answers 404). /api/home degrades per card and stays 200.",
            ["not_found"],
          ),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/preapprovals": {
      get: {
        operationId: "listPreapprovals",
        summary:
          "Incoming transfer preapprovals (TransferPreapproval) visible to me (semantic adapter)",
        parameters: [
          {
            name: "asOf",
            in: "query",
            required: true,
            schema: { type: "string", format: "date-time" },
            description:
              "The reference time for judging expiry. The caller measures it and passes it in — the server does not read the clock.",
          },
          offsetParameter,
        ],
        responses: {
          "200": ok(
            "PreapprovalsResponse",
            "The value of buildTransferPreapprovals(core) plus offset. Contracts in which a receiver has pre-approved receiving " +
              "this instrument — the sending side does not need the offer-accept round trip. If kind is available, view.rows — contractId, " +
              "receiver, receiverIsViewer, issuer, instrumentId, expiresAt, expiry (whether passed, and ms).",
          ),
          "400": failure("invalid_as_of — if asOf is absent it is 400. invalid_offset.", [
            "invalid_as_of",
            "invalid_offset",
            "offset_after_ledger_end",
          ]),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/contracts/{contractId}": {
      get: {
        operationId: "getContract",
        summary: "Contract detail",
        parameters: [
          {
            name: "contractId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description:
              "Must be sent percent-encoded — for an original containing special characters such as colons, put in the encodeURIComponent result.",
          },
          offsetParameter,
        ],
        responses: {
          "200": ok(
            "ContractDetailResponse",
            "The view of buildContractDetail(core) + schema. schema is the definition of this contract's template" +
              " (field types, choices, implements) and the typed payload — if the package schema cannot be read it is {status:unavailable, reason} and " +
              "the Raw JSON stays as is.",
          ),
          "400": failure(
            "invalid_path — if the contractId path segment does not decode (non-hex after a percent) it is 400. invalid_offset.",
            ["invalid_path", "invalid_offset", "offset_after_ledger_end"],
          ),
          "404": failure(
            "not_found — a contractId that was not found is answered with the single 404.",
            ["not_found"],
          ),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/offers": {
      get: {
        operationId: "listOffers",
        summary: "Transfer offer list",
        parameters: [
          {
            name: "interfaceId",
            in: "query",
            required: true,
            // Three segments, `<package>:<Module>:<Entity>`. An empty string, or one without colons, is a
            // 400 (invalid_interface_id).
            schema: {
              type: "string",
              pattern:
                "^(#[A-Za-z0-9_-]+|[0-9a-f]{64}):[A-Za-z_][A-Za-z0-9_$.]*:[A-Za-z_][A-Za-z0-9_$]*$",
            },
            description:
              "The standard TransferInstruction interface id. Queried with an InterfaceFilter.",
          },
          {
            name: "asOf",
            in: "query",
            required: true,
            schema: { type: "string", format: "date-time" },
            description:
              "The reference time for judging expiry. The caller measures it and passes it in — the server does not read the clock.",
          },
          offsetParameter,
        ],
        responses: {
          "200": ok(
            "OffersResponse",
            'The return value of buildTransferOffers(core). Even when kind is "unavailable" it is returned as is in a 200. The response does not include an offset.',
          ),
          "400": failure(
            "If interfaceId is absent, invalid_interface_id; if asOf is absent, invalid_as_of. invalid_offset.",
            ["invalid_interface_id", "invalid_as_of", "invalid_offset", "offset_after_ledger_end"],
          ),
          "404": failure(
            "not_found — the package of the named interface is not on this participant. The shape was valid, " +
              "so it is not a 400 (the ledger answers 404). /api/home degrades per card and stays 200.",
            ["not_found"],
          ),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/catalog/templates": {
      get: {
        operationId: "listTemplates",
        summary: "The template catalog I can see",
        parameters: [offsetParameter],
        responses: {
          "200": ok(
            "TemplatesResponse",
            "The return value of buildTemplateCatalog(core). Each row has definition — the fields, choices, implements read from " +
              "that template's package schema. If it cannot be read, only {status:unavailable, reason}.",
          ),
          "400": failure("invalid_offset · offset_after_ledger_end", [
            "invalid_offset",
            "offset_after_ledger_end",
          ]),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/catalog/packages": {
      get: {
        operationId: "listPackages",
        summary: "Package catalog of the whole instance",
        parameters: [offsetParameter],
        responses: {
          "200": ok(
            "PackagesResponse",
            "The return value of buildPackageCatalog(core). The router assembles the myPackageIds aggregate and passes it as input, and the value the core function builds is " +
              "this function's return value itself. Each row gets the installed package's name, version, table of contents (templates, interfaces) read from the schema — " +
              "downloaded, decoded sequentially once at first, then cached. Packages that could not be read (LF 1.x etc.) keep the reason in schemaStatus and have an empty table of contents. " +
              "This is an instance value.",
          ),
          "400": failure("invalid_offset · offset_after_ledger_end", [
            "invalid_offset",
            "offset_after_ledger_end",
          ]),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/node": {
      get: {
        operationId: "getNode",
        summary: "The ledger progress state of this instance",
        parameters: [
          {
            name: "currentObservedAtMs",
            in: "query",
            required: true,
            schema: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 15 },
            description:
              'The caller measures "now" and passes it in — this layer does not read the time.',
          },
          {
            name: "priorOffset",
            in: "query",
            required: false,
            schema: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 15 },
            description:
              "Must be present together with priorObservedAtMs, or both absent. If only one is present it is 400 (invalid_prior).",
          },
          {
            name: "priorObservedAtMs",
            in: "query",
            required: false,
            schema: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 15 },
            description:
              "Must be present together with priorOffset, or both absent. If only one is present it is 400 (invalid_prior).",
          },
        ],
        responses: {
          "200": ok(
            "NodeResponse",
            "The return value of buildNodeStatusSnapshot(core) + ledgerEnd (the ledger end this call read: {status:'ok', offset} | " +
              "{status:'unavailable', reason}). The screen's Ledger end row and the prior for the progress judgment use this value — another " +
              "read's offset is not used in its place. This route reports “what it does not know” as a 200 — ledger failures are not " +
              "promoted to a status code but left as names inside the body.",
          ),
          "400": failure(
            "If currentObservedAtMs is absent or not an integer string, invalid_observed_at. If only one of priorOffset/priorObservedAtMs is present, invalid_prior.",
            ["invalid_observed_at", "invalid_prior"],
          ),
          "401": unauthenticatedResponse,
        },
      },
    },
    "/api/search": {
      get: {
        operationId: "search",
        summary:
          "Search — type classification + result sections (Updates, Contracts, Parties, Templates, Packages). Id-like inputs match exactly, name-like inputs match partially within my catalog",
        parameters: [
          {
            name: "q",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
          offsetParameter,
        ],
        responses: {
          "200": ok(
            "SearchResponse",
            "The return value of classifySearchInput(core) + results (buildSearchResults) + offset. Empty input does not call the ledger, so " +
              "there is no offset. Partial failures are exposed by name on that section — if the ACS fails, only Contracts, Parties, Templates are " +
              "unavailable and Updates, Packages still answer.",
          ),
          "400": failure("invalid_offset · offset_after_ledger_end", [
            "invalid_offset",
            "offset_after_ledger_end",
          ]),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
    "/api/party/{partyId}": {
      get: {
        operationId: "getParty",
        summary: "Search within my active contracts by party id",
        parameters: [
          {
            name: "partyId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description:
              "A Canton party id, which contains two colons, must be sent percent-encoded.",
          },
          offsetParameter,
        ],
        responses: {
          "200": ok(
            "PartyResponse",
            "The result of searchPartyInActiveContracts(core) spread out, plus offset (the value the router laid on, same as contracts).",
          ),
          "400": failure(
            "invalid_path — if the partyId path segment does not decode (non-hex after a percent) it is 400. invalid_offset.",
            ["invalid_path", "invalid_offset", "offset_after_ledger_end"],
          ),
          "401": unauthenticatedResponse,
          ...partyScopedFailureResponses,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ledgerToken: {
        type: "http",
        scheme: "bearer",
        description:
          "The ledger token the Canton participant accepts. This server neither verifies nor exchanges it and passes it to the ledger as is — " +
          "it is supplied by the browser-oidc Browser or an institution-owned BFF — see docs/security.md. This document (/openapi.json) itself is readable without a token.",
      },
    },
    schemas: responseSchemas,
  },
};
