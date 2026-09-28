// **Generated file — do not edit by hand.** Extracted by `pnpm openapi:generate` from the types in apps/backend/src/responses.ts.
// To change the shape, edit responses.ts (the fields the router adds) or the types in packages/core and re-extract.
// CI's `pnpm openapi:check` verifies this file is up to date.

export const responseSchemas = {
  BuiltinName: {
    type: "string",
    enum: [
      "Unit",
      "Bool",
      "Int64",
      "Date",
      "Timestamp",
      "Numeric",
      "Party",
      "Text",
      "ContractId",
      "Optional",
      "List",
      "GenMap",
      "Any",
      "AnyException",
      "TypeRep",
      "Arrow",
      "Update",
      "FailureCategory",
      "TextMap",
      "BigNumeric",
      "RoundingMode",
    ],
  },
  ChoiceLite: {
    type: "object",
    properties: {
      name: {
        type: "string",
      },
      consuming: {
        type: "boolean",
      },
      argType: {
        type: ["string", "null"],
      },
      argFields: {
        anyOf: [
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/SchemaFieldLite",
            },
          },
          {
            type: "null",
          },
        ],
      },
      returnType: {
        type: ["string", "null"],
      },
    },
    required: ["name", "consuming", "argType", "argFields", "returnType"],
    additionalProperties: false,
  },
  ContractDetailResponse: {
    type: "object",
    additionalProperties: false,
    properties: {
      schema: {
        $ref: "#/components/schemas/ContractSchema",
      },
      readAt: {
        type: "string",
        description:
          "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
        pattern:
          "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
      },
      templateId: {
        type: "string",
      },
      packageId: {
        type: "string",
      },
      packageName: {
        type: "string",
      },
      module: {
        type: "string",
      },
      entity: {
        type: "string",
      },
      createArgument: {},
      signatories: {
        type: "array",
        items: {
          type: "string",
        },
      },
      observers: {
        type: "array",
        items: {
          type: "string",
        },
      },
      createdAt: {
        type: "string",
      },
      renderMode: {
        $ref: "#/components/schemas/ContractRenderMode",
      },
      interfaceViews: {
        type: "array",
        items: {},
      },
      choices: {
        $ref: "#/components/schemas/ContractDetailUnavailable",
      },
      history: {
        $ref: "#/components/schemas/ContractDetailUnavailable",
      },
      relatedContracts: {
        $ref: "#/components/schemas/ContractDetailUnavailable",
      },
      synchronizerId: {
        type: ["string", "null"],
      },
      reassignmentCounter: {
        type: ["number", "null"],
      },
      createdAtOffset: {
        type: ["number", "null"],
      },
      contractKey: {
        $ref: "#/components/schemas/ContractKeyView",
      },
      visibility: {
        anyOf: [
          {
            $ref: "#/components/schemas/VisibilityExplanation",
          },
          {
            type: "object",
            properties: {
              status: {
                type: "string",
                const: "not_asked",
              },
            },
            required: ["status"],
            additionalProperties: false,
          },
        ],
      },
    },
    required: [
      "choices",
      "contractKey",
      "createArgument",
      "createdAt",
      "createdAtOffset",
      "entity",
      "history",
      "interfaceViews",
      "module",
      "observers",
      "packageId",
      "packageName",
      "readAt",
      "reassignmentCounter",
      "relatedContracts",
      "renderMode",
      "schema",
      "signatories",
      "synchronizerId",
      "templateId",
      "visibility",
    ],
  },
  ContractDetailUnavailable: {
    anyOf: [
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "not_in_this_version",
          },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "fetch_failed",
          },
          reason: {
            type: "string",
          },
        },
        required: ["kind", "reason"],
        additionalProperties: false,
      },
    ],
  },
  ContractKeyView: {
    anyOf: [
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "none",
          },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "present",
          },
          value: {},
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
    ],
  },
  ContractListCursor: {
    type: "object",
    properties: {
      offset: {
        type: ["number", "null"],
      },
      createdAt: {
        type: "string",
      },
      contractId: {
        type: "string",
      },
    },
    required: ["offset", "createdAt", "contractId"],
    additionalProperties: false,
  },
  ContractListFilter: {
    type: "object",
    properties: {
      template: {
        type: "string",
      },
      parties: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    additionalProperties: false,
  },
  ContractListRow: {
    type: "object",
    properties: {
      contractId: {
        type: "string",
      },
      package: {
        type: "string",
      },
      packageName: {
        type: ["string", "null"],
      },
      module: {
        type: "string",
      },
      entity: {
        type: "string",
      },
      counterpartyParty: {
        type: "array",
        items: {
          type: "string",
        },
      },
      myRoles: {
        type: "array",
        items: {
          $ref: "#/components/schemas/VisibilityReason",
        },
      },
      createdAt: {
        type: "string",
      },
      offset: {
        type: ["number", "null"],
      },
    },
    required: [
      "contractId",
      "package",
      "packageName",
      "module",
      "entity",
      "counterpartyParty",
      "myRoles",
      "createdAt",
      "offset",
    ],
    additionalProperties: false,
  },
  ContractRenderMode: {
    type: "string",
    enum: ["generic", "interface"],
  },
  ContractSchema: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          lfVersion: {
            type: "string",
          },
          packageName: {
            type: ["string", "null"],
          },
          packageVersion: {
            type: ["string", "null"],
          },
          fields: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SchemaFieldLite",
            },
          },
          choices: {
            type: "array",
            items: {
              $ref: "#/components/schemas/ChoiceLite",
            },
          },
          key: {
            type: ["string", "null"],
          },
          implements: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SchemaRef",
            },
          },
          typedPayload: {
            type: "array",
            items: {
              $ref: "#/components/schemas/TypedField",
            },
          },
        },
        required: [
          "status",
          "lfVersion",
          "packageName",
          "packageVersion",
          "fields",
          "choices",
          "key",
          "implements",
          "typedPayload",
        ],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
            description: "The reason the package could not be read, or template_not_in_package.",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
    ],
  },
  ContractsResponse: {
    type: "object",
    additionalProperties: false,
    properties: {
      offset: {
        type: "number",
      },
      readAt: {
        type: "string",
        description:
          "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
        pattern:
          "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
      },
      rows: {
        type: "array",
        items: {
          $ref: "#/components/schemas/ContractListRow",
        },
      },
      nextCursor: {
        anyOf: [
          {
            $ref: "#/components/schemas/ContractListCursor",
          },
          {
            type: "null",
          },
        ],
      },
      total: {
        type: "number",
      },
      matched: {
        type: "number",
      },
      filter: {
        $ref: "#/components/schemas/ContractListFilter",
      },
    },
    required: ["filter", "matched", "nextCursor", "offset", "readAt", "rows", "total"],
  },
  HoldingsResponse: {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "available",
          },
          view: {
            $ref: "#/components/schemas/TokenHoldingsView",
          },
        },
        required: ["kind", "offset", "readAt", "view"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["kind", "offset", "readAt", "reason"],
      },
    ],
  },
  HomeCards: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "no_party_rights",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          activeContracts: {
            $ref: "#/components/schemas/HomeCountCard",
          },
          pendingOffers: {
            $ref: "#/components/schemas/HomePendingOffersCard",
          },
          tokens: {
            $ref: "#/components/schemas/HomeTokensCard",
          },
        },
        required: ["status", "activeContracts", "pendingOffers", "tokens"],
        additionalProperties: false,
      },
    ],
  },
  HomeCountCard: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          count: {
            type: "number",
          },
        },
        required: ["status", "count"],
        additionalProperties: false,
      },
      {
        $ref: "#/components/schemas/HomeUnavailable",
      },
    ],
  },
  HomeOfferPreview: {
    type: "object",
    properties: {
      contractId: {
        type: "string",
      },
      direction: {
        type: "string",
        enum: ["received", "internal"],
      },
      sender: {
        type: "string",
      },
      receiver: {
        type: "string",
      },
      amount: {
        type: "string",
      },
      instrumentId: {},
      executeBefore: {
        type: "string",
      },
      remainingMs: {
        type: "number",
      },
      imminent: {
        type: "boolean",
      },
    },
    required: [
      "contractId",
      "direction",
      "sender",
      "receiver",
      "amount",
      "instrumentId",
      "executeBefore",
      "remainingMs",
      "imminent",
    ],
    additionalProperties: false,
  },
  HomePendingOffersCard: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          pending: {
            type: "number",
          },
          preview: {
            type: "array",
            items: {
              $ref: "#/components/schemas/HomeOfferPreview",
            },
          },
          imminent: {
            type: "number",
          },
          soonestRemainingMs: {
            type: ["number", "null"],
          },
          expiredNotCounted: {
            type: "number",
          },
          problems: {
            type: "number",
          },
        },
        required: [
          "status",
          "pending",
          "preview",
          "imminent",
          "soonestRemainingMs",
          "expiredNotCounted",
          "problems",
        ],
        additionalProperties: false,
      },
      {
        $ref: "#/components/schemas/HomeUnavailable",
      },
    ],
  },
  HomeRecent: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          rows: {
            type: "array",
            items: {
              $ref: "#/components/schemas/RecentUpdateRow",
            },
          },
          totalInWindow: {
            type: "number",
          },
          beginExclusive: {
            type: "number",
          },
        },
        required: ["status", "rows", "totalInWindow", "beginExclusive"],
        additionalProperties: false,
      },
      {
        $ref: "#/components/schemas/HomeUnavailable",
      },
    ],
  },
  HomeResponse: {
    type: "object",
    additionalProperties: false,
    properties: {
      readAt: {
        type: "string",
        description:
          "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
        pattern:
          "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
      },
      offset: {
        type: "number",
      },
      viewer: {
        type: "object",
        properties: {
          userId: {
            type: "string",
          },
          partyCount: {
            type: "number",
          },
          scope: {
            $ref: "#/components/schemas/ViewerScope",
          },
        },
        required: ["userId", "partyCount", "scope"],
        additionalProperties: false,
      },
      cards: {
        $ref: "#/components/schemas/HomeCards",
      },
      sparkline: {
        $ref: "#/components/schemas/UpdateTimeDistribution",
      },
      recent: {
        $ref: "#/components/schemas/HomeRecent",
      },
    },
    required: ["cards", "offset", "readAt", "recent", "sparkline", "viewer"],
  },
  HomeTokensCard: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          kinds: {
            type: "number",
          },
          labels: {
            type: "array",
            items: {
              type: "string",
            },
          },
          problems: {
            type: "number",
          },
        },
        required: ["status", "kinds", "labels", "problems"],
        additionalProperties: false,
      },
      {
        $ref: "#/components/schemas/HomeUnavailable",
      },
    ],
  },
  HomeUnavailable: {
    type: "object",
    properties: {
      status: {
        type: "string",
        const: "unavailable",
      },
      reason: {
        type: "string",
      },
    },
    required: ["status", "reason"],
    additionalProperties: false,
  },
  InMyContractsFlag: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "in_set",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "not_in_set",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unknown",
          },
          reason: {
            type: "string",
            const: "my_package_ids_not_provided",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
    ],
  },
  LedgerFailureReason: {
    type: "string",
    enum: [
      "unauthenticated",
      "forbidden",
      "not_found",
      "node_error",
      "unreachable",
      "offset_after_ledger_end",
      "pruned",
      "too_many_elements",
    ],
  },
  LfField: {
    type: "object",
    properties: {
      name: {
        type: "string",
      },
      type: {
        $ref: "#/components/schemas/LfType",
      },
    },
    required: ["name", "type"],
    additionalProperties: false,
  },
  LfType: {
    anyOf: [
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "builtin",
          },
          name: {
            $ref: "#/components/schemas/BuiltinName",
          },
          args: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LfType",
            },
          },
        },
        required: ["kind", "name", "args"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "con",
          },
          pkg: {
            $ref: "#/components/schemas/PackageRef",
          },
          module: {
            type: "string",
          },
          name: {
            type: "string",
          },
          args: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LfType",
            },
          },
        },
        required: ["kind", "pkg", "module", "name", "args"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "var",
          },
          name: {
            type: "string",
          },
          args: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LfType",
            },
          },
        },
        required: ["kind", "name", "args"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "nat",
          },
          n: {
            type: "number",
          },
        },
        required: ["kind", "n"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "syn",
          },
          module: {
            type: "string",
          },
          name: {
            type: "string",
          },
          args: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LfType",
            },
          },
        },
        required: ["kind", "module", "name", "args"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "forall",
          },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "struct",
          },
          fields: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LfField",
            },
          },
        },
        required: ["kind", "fields"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "app",
          },
          lhs: {
            $ref: "#/components/schemas/LfType",
          },
          rhs: {
            $ref: "#/components/schemas/LfType",
          },
        },
        required: ["kind", "lhs", "rhs"],
        additionalProperties: false,
      },
    ],
  },
  Lifeline: {
    type: "object",
    properties: {
      contractId: {
        type: "string",
      },
      package: {
        type: "string",
      },
      packageName: {
        type: ["string", "null"],
      },
      module: {
        type: "string",
      },
      entity: {
        type: "string",
      },
      parties: {
        type: "array",
        items: {
          type: "string",
        },
        description:
          "Who the contract belongs to — signatories and observers together, the same material the list filters on. There is no single owner in Daml: a contract can carry several signatories, and observers on top, so this is a list rather than one party. Empty when the only thing seen was an archive: that event carries no signatories or observers (only witnessParties), and a witness is not a stakeholder.",
      },
      start: {
        type: "number",
      },
      startKnown: {
        type: "boolean",
      },
      end: {
        type: "number",
      },
      endKnown: {
        type: "boolean",
      },
      state: {
        $ref: "#/components/schemas/LifelineState",
      },
      archivedBy: {
        type: ["string", "null"],
        description:
          "The update that archived it — an archived contract has no detail page (the ACS no longer holds it), so this is where the screen can go instead.",
      },
      createdAt: {
        type: ["string", "null"],
      },
    },
    required: [
      "contractId",
      "package",
      "packageName",
      "module",
      "entity",
      "parties",
      "start",
      "startKnown",
      "end",
      "endKnown",
      "state",
      "archivedBy",
      "createdAt",
    ],
    additionalProperties: false,
  },
  LifelineGroup: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "`module:entity` — the key the screen groups bars under.",
      },
      module: {
        type: "string",
      },
      entity: {
        type: "string",
      },
      lines: {
        type: "array",
        items: {
          $ref: "#/components/schemas/Lifeline",
        },
      },
    },
    required: ["key", "module", "entity", "lines"],
    additionalProperties: false,
  },
  LifelineState: {
    type: "string",
    enum: ["alive", "archived", "unknown"],
  },
  LiveTemplateCatalogRow: {
    type: "object",
    properties: {
      templateId: {
        type: "string",
      },
      packageId: {
        type: "string",
      },
      packageName: {
        type: "string",
      },
      module: {
        type: "string",
      },
      entity: {
        type: "string",
      },
      contractCount: {
        type: "number",
      },
    },
    required: ["templateId", "packageId", "packageName", "module", "entity", "contractCount"],
    additionalProperties: false,
  },
  NodeElapsed: {
    anyOf: [
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "since-advance",
          },
          ms: {
            type: "number",
          },
        },
        required: ["case", "ms"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "since-stall",
          },
          ms: {
            type: "number",
          },
        },
        required: ["case", "ms"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "regressed-interval",
          },
          ms: {
            type: "number",
          },
        },
        required: ["case", "ms"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "clock-not-advanced",
          },
        },
        required: ["case"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "not-yet-known",
          },
        },
        required: ["case"],
        additionalProperties: false,
      },
    ],
  },
  NodeLiveStatusResult: {
    anyOf: [
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "advanced",
          },
          delta: {
            type: "number",
          },
        },
        required: ["case", "delta"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "stalled",
          },
        },
        required: ["case"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "regressed",
          },
          delta: {
            type: "number",
          },
        },
        required: ["case", "delta"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "prior-unavailable",
          },
        },
        required: ["case"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "current-unavailable",
          },
        },
        required: ["case"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          case: {
            type: "string",
            const: "both-unavailable",
          },
        },
        required: ["case"],
        additionalProperties: false,
      },
    ],
  },
  NodeOffsetReading: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          offset: {
            type: "number",
          },
        },
        required: ["status", "offset"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            $ref: "#/components/schemas/LedgerFailureReason",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
    ],
  },
  NodeResponse: {
    type: "object",
    additionalProperties: false,
    properties: {
      ledgerEnd: {
        $ref: "#/components/schemas/NodeOffsetReading",
        description:
          "The ledger end this call read. The screen's Ledger end row and the next call's prior use this value.",
      },
      readAt: {
        type: "string",
        description:
          "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
        pattern:
          "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
      },
      progress: {
        $ref: "#/components/schemas/NodeLiveStatusResult",
      },
      elapsed: {
        $ref: "#/components/schemas/NodeElapsed",
      },
      version: {
        $ref: "#/components/schemas/NodeVersionFact",
      },
    },
    required: ["elapsed", "ledgerEnd", "progress", "readAt", "version"],
  },
  NodeVersionFact: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          version: {
            type: "string",
          },
          features: {},
        },
        required: ["status", "version", "features"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            $ref: "#/components/schemas/LedgerFailureReason",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
    ],
  },
  OffersResponse: {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "available",
          },
          view: {
            $ref: "#/components/schemas/TransferOffersView",
          },
        },
        required: ["kind", "readAt", "view"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["kind", "readAt", "reason"],
      },
    ],
  },
  PackageRef: {
    anyOf: [
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "self",
          },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "imported",
          },
          packageId: {
            type: "string",
          },
        },
        required: ["kind", "packageId"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "import_index",
          },
          index: {
            type: "number",
          },
        },
        required: ["kind", "index"],
        additionalProperties: false,
      },
    ],
  },
  PackageRow: {
    type: "object",
    additionalProperties: false,
    properties: {
      lfVersion: {
        type: "string",
        description: "Present only when the schema was read.",
      },
      schemaStatus: {
        type: "string",
        description:
          '"ok" if the schema was read, otherwise the reason it could not be (unsupported_lf_version:1.x etc.).',
      },
      templates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            module: {
              type: "string",
            },
            name: {
              type: "string",
            },
            choices: {
              type: "number",
            },
          },
          required: ["module", "name", "choices"],
          additionalProperties: false,
        },
        description: "Empty array if the schema could not be read.",
      },
      interfaces: {
        type: "array",
        items: {
          type: "object",
          properties: {
            module: {
              type: "string",
            },
            name: {
              type: "string",
            },
          },
          required: ["module", "name"],
          additionalProperties: false,
        },
      },
      packageId: {
        type: "string",
      },
      name: {
        anyOf: [
          {
            type: "string",
          },
          {
            $ref: "#/components/schemas/UnavailableInThisLayer",
          },
        ],
      },
      version: {
        anyOf: [
          {
            type: "string",
          },
          {
            $ref: "#/components/schemas/UnavailableInThisLayer",
          },
        ],
      },
      inMyContracts: {
        $ref: "#/components/schemas/InMyContractsFlag",
      },
    },
    required: [
      "inMyContracts",
      "interfaces",
      "name",
      "packageId",
      "schemaStatus",
      "templates",
      "version",
    ],
  },
  PackageSchemaResponse: {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          packageId: {
            type: ["string", "null"],
          },
          lfVersion: {
            type: "string",
          },
          name: {
            type: ["string", "null"],
          },
          version: {
            type: ["string", "null"],
          },
          modules: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                },
                templates: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/SchemaTemplate",
                  },
                },
                interfaces: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/SchemaInterface",
                  },
                },
                dataTypes: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/SchemaDataType",
                  },
                },
              },
              required: ["name", "templates", "interfaces", "dataTypes"],
              additionalProperties: false,
            },
          },
          counts: {
            type: "object",
            properties: {
              templates: {
                type: "number",
              },
              interfaces: {
                type: "number",
              },
              dataTypes: {
                type: "number",
              },
              internedStrings: {
                type: "number",
              },
              internedTypes: {
                type: "number",
              },
            },
            required: ["templates", "interfaces", "dataTypes", "internedStrings", "internedTypes"],
            additionalProperties: false,
          },
          status: {
            type: "string",
            const: "ok",
          },
        },
        required: [
          "counts",
          "lfVersion",
          "modules",
          "name",
          "packageId",
          "readAt",
          "status",
          "version",
        ],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
            description:
              "unsupported_lf_version:…, decode_failed:… etc. — not a node error but a circumstance in which this layer could not read it.",
          },
          packageId: {
            type: "string",
          },
        },
        required: ["packageId", "readAt", "reason", "status"],
      },
    ],
  },
  PackagesResponse: {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        items: {
          $ref: "#/components/schemas/PackageRow",
        },
      },
      readAt: {
        type: "string",
        description:
          "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
        pattern:
          "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
      },
      ok: {
        type: "boolean",
        const: true,
      },
      scope: {
        type: "string",
        const: "instance_wide",
      },
    },
    required: ["ok", "readAt", "rows", "scope"],
  },
  PartyResponse: {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          status: {
            type: "string",
            const: "found",
          },
          scope: {
            type: "string",
            const: "counterparty",
          },
          party: {
            type: "string",
          },
          contractIds: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
        required: ["contractIds", "offset", "party", "readAt", "scope", "status"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          status: {
            type: "string",
            const: "out_of_scope",
          },
          party: {
            type: "string",
          },
        },
        required: ["offset", "party", "readAt", "status"],
      },
    ],
  },
  PreapprovalsResponse: {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "available",
          },
          view: {
            $ref: "#/components/schemas/TransferPreapprovalsView",
          },
        },
        required: ["kind", "offset", "readAt", "view"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["kind", "offset", "readAt", "reason"],
      },
    ],
  },
  RecentUpdateEventRow: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["created", "archived"],
      },
      contractId: {
        type: "string",
      },
      package: {
        type: "string",
      },
      module: {
        type: "string",
      },
      entity: {
        type: "string",
      },
      parties: {
        type: "array",
        items: {
          type: "string",
        },
      },
      witnessParties: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: ["kind", "contractId", "package", "module", "entity", "parties", "witnessParties"],
    additionalProperties: false,
  },
  RecentUpdateRow: {
    type: "object",
    properties: {
      updateId: {
        type: "string",
      },
      offset: {
        type: "number",
      },
      effectiveAt: {
        type: "string",
      },
      events: {
        type: "array",
        items: {
          $ref: "#/components/schemas/RecentUpdateEventRow",
        },
      },
      submittedByYou: {
        type: "boolean",
      },
    },
    required: ["updateId", "offset", "effectiveAt", "events", "submittedByYou"],
    additionalProperties: false,
  },
  SchemaChoice: {
    type: "object",
    properties: {
      name: {
        type: "string",
      },
      consuming: {
        type: "boolean",
      },
      argType: {
        type: ["string", "null"],
      },
      argFields: {
        anyOf: [
          {
            type: "array",
            items: {
              $ref: "#/components/schemas/SchemaField",
            },
          },
          {
            type: "null",
          },
        ],
      },
      returnType: {
        type: ["string", "null"],
      },
    },
    required: ["name", "consuming", "argType", "argFields", "returnType"],
    additionalProperties: false,
  },
  SchemaDataType: {
    type: "object",
    properties: {
      module: {
        type: "string",
      },
      name: {
        type: "string",
      },
      serializable: {
        type: "boolean",
      },
      paramCount: {
        type: "number",
      },
      cons: {
        anyOf: [
          {
            type: "object",
            properties: {
              kind: {
                type: "string",
                const: "record",
              },
              fields: {
                type: "array",
                items: {
                  $ref: "#/components/schemas/SchemaField",
                },
              },
            },
            required: ["kind", "fields"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: {
                type: "string",
                const: "variant",
              },
              fields: {
                type: "array",
                items: {
                  $ref: "#/components/schemas/SchemaField",
                },
              },
            },
            required: ["kind", "fields"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: {
                type: "string",
                const: "enum",
              },
              constructors: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
            required: ["kind", "constructors"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: {
                type: "string",
                const: "interface",
              },
            },
            required: ["kind"],
            additionalProperties: false,
          },
        ],
      },
    },
    required: ["module", "name", "serializable", "paramCount", "cons"],
    additionalProperties: false,
  },
  SchemaField: {
    type: "object",
    properties: {
      name: {
        type: "string",
      },
      type: {
        type: "string",
      },
      lfType: {
        $ref: "#/components/schemas/LfType",
      },
    },
    required: ["name", "type", "lfType"],
    additionalProperties: false,
  },
  SchemaFieldLite: {
    type: "object",
    properties: {
      name: {
        type: "string",
      },
      type: {
        type: "string",
      },
    },
    required: ["name", "type"],
    additionalProperties: false,
  },
  SchemaInterface: {
    type: "object",
    properties: {
      module: {
        type: "string",
      },
      name: {
        type: "string",
      },
      view: {
        type: ["string", "null"],
      },
      methods: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
            type: {
              type: ["string", "null"],
            },
          },
          required: ["name", "type"],
          additionalProperties: false,
        },
      },
      choices: {
        type: "array",
        items: {
          $ref: "#/components/schemas/SchemaChoice",
        },
      },
      requires: {
        type: "array",
        items: {
          $ref: "#/components/schemas/SchemaRef",
        },
      },
    },
    required: ["module", "name", "view", "methods", "choices", "requires"],
    additionalProperties: false,
  },
  SchemaRef: {
    type: "object",
    properties: {
      module: {
        type: "string",
      },
      name: {
        type: "string",
      },
      packageId: {
        type: ["string", "null"],
      },
    },
    required: ["module", "name", "packageId"],
    additionalProperties: false,
  },
  SchemaTemplate: {
    type: "object",
    properties: {
      module: {
        type: "string",
      },
      name: {
        type: "string",
      },
      fields: {
        type: "array",
        items: {
          $ref: "#/components/schemas/SchemaField",
        },
      },
      choices: {
        type: "array",
        items: {
          $ref: "#/components/schemas/SchemaChoice",
        },
      },
      key: {
        type: ["string", "null"],
      },
      implements: {
        type: "array",
        items: {
          $ref: "#/components/schemas/SchemaRef",
        },
      },
    },
    required: ["module", "name", "fields", "choices", "key", "implements"],
    additionalProperties: false,
  },
  SearchContractHit: {
    type: "object",
    properties: {
      contractId: {
        type: "string",
      },
      templateId: {
        type: "string",
      },
      package: {
        type: "string",
      },
      module: {
        type: "string",
      },
      entity: {
        type: "string",
      },
      packageName: {
        type: "string",
      },
    },
    required: ["contractId", "templateId", "package", "module", "entity", "packageName"],
    additionalProperties: false,
  },
  SearchPackageHit: {
    type: "object",
    properties: {
      packageId: {
        type: "string",
      },
      name: {
        type: ["string", "null"],
      },
      inMyContracts: {
        type: "boolean",
      },
    },
    required: ["packageId", "name", "inMyContracts"],
    additionalProperties: false,
  },
  SearchPartyHit: {
    type: "object",
    properties: {
      party: {
        type: "string",
      },
      contractCount: {
        type: "number",
      },
    },
    required: ["party", "contractCount"],
    additionalProperties: false,
  },
  SearchResponse: {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            $ref: "#/components/schemas/SearchResults",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "empty",
          },
        },
        required: ["kind", "readAt", "results"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            $ref: "#/components/schemas/SearchResults",
          },
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "contract_id",
          },
          contractId: {
            type: "string",
          },
        },
        required: ["contractId", "kind", "offset", "readAt", "results"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            $ref: "#/components/schemas/SearchResults",
          },
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "update_id",
          },
          updateId: {
            type: "string",
          },
        },
        required: ["kind", "offset", "readAt", "results", "updateId"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            $ref: "#/components/schemas/SearchResults",
          },
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "party",
          },
          party: {
            type: "string",
          },
        },
        required: ["kind", "offset", "party", "readAt", "results"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            $ref: "#/components/schemas/SearchResults",
          },
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "package_id",
          },
          packageId: {
            type: "string",
          },
        },
        required: ["kind", "offset", "packageId", "readAt", "results"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            $ref: "#/components/schemas/SearchResults",
          },
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "interface_id_confirmed",
          },
          package_name: {
            type: "string",
          },
          module_name: {
            type: "string",
          },
          entity_name: {
            type: "string",
          },
        },
        required: [
          "entity_name",
          "kind",
          "module_name",
          "offset",
          "package_name",
          "readAt",
          "results",
        ],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            $ref: "#/components/schemas/SearchResults",
          },
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "template_or_interface_fqn",
          },
          package_name: {
            type: "string",
          },
          module_name: {
            type: "string",
          },
          entity_name: {
            type: "string",
          },
        },
        required: [
          "entity_name",
          "kind",
          "module_name",
          "offset",
          "package_name",
          "readAt",
          "results",
        ],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            $ref: "#/components/schemas/SearchResults",
          },
          offset: {
            type: "number",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          kind: {
            type: "string",
            const: "unrecognized",
          },
          reason: {
            type: "string",
          },
        },
        required: ["kind", "offset", "readAt", "reason", "results"],
      },
    ],
  },
  SearchResults: {
    type: "object",
    properties: {
      q: {
        type: "string",
      },
      kind: {
        type: "string",
        enum: [
          "empty",
          "contract_id",
          "update_id",
          "party",
          "package_id",
          "interface_id_confirmed",
          "template_or_interface_fqn",
          "unrecognized",
        ],
      },
      updates: {
        $ref: "#/components/schemas/SearchSection.SearchUpdateHit",
      },
      contracts: {
        $ref: "#/components/schemas/SearchSection.SearchContractHit",
      },
      parties: {
        $ref: "#/components/schemas/SearchSection.SearchPartyHit",
      },
      templates: {
        $ref: "#/components/schemas/SearchSection.LiveTemplateCatalogRow",
      },
      packages: {
        $ref: "#/components/schemas/SearchSection.SearchPackageHit",
      },
      fullText: {
        type: "string",
        const: "not_available",
      },
    },
    required: ["q", "kind", "updates", "contracts", "parties", "templates", "packages", "fullText"],
    additionalProperties: false,
  },
  "SearchSection.LiveTemplateCatalogRow": {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          rows: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LiveTemplateCatalogRow",
            },
          },
        },
        required: ["status", "rows"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "not_applicable",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
    ],
  },
  "SearchSection.SearchContractHit": {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          rows: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SearchContractHit",
            },
          },
        },
        required: ["status", "rows"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "not_applicable",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
    ],
  },
  "SearchSection.SearchPackageHit": {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          rows: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SearchPackageHit",
            },
          },
        },
        required: ["status", "rows"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "not_applicable",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
    ],
  },
  "SearchSection.SearchPartyHit": {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          rows: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SearchPartyHit",
            },
          },
        },
        required: ["status", "rows"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "not_applicable",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
    ],
  },
  "SearchSection.SearchUpdateHit": {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          rows: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SearchUpdateHit",
            },
          },
        },
        required: ["status", "rows"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "not_applicable",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
    ],
  },
  SearchUpdateHit: {
    type: "object",
    properties: {
      updateId: {
        type: "string",
      },
      offset: {
        type: ["number", "null"],
      },
      effectiveAt: {
        type: ["string", "null"],
      },
      kind: {
        type: "string",
      },
    },
    required: ["updateId", "offset", "effectiveAt", "kind"],
    additionalProperties: false,
  },
  SessionParty: {
    type: "object",
    additionalProperties: false,
    properties: {
      rights: {
        type: "array",
        items: {},
        description:
          "The **raw** user rights corresponding to this party (items of the ListUserRights response). They are the viewer's own, so they are copied over without judgment.",
      },
      party: {
        type: "string",
      },
      kinds: {
        type: "array",
        items: {
          type: "string",
          enum: ["CanReadAs", "CanActAs"],
        },
      },
    },
    required: ["kinds", "party", "rights"],
  },
  SessionResponse: {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          parties: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SessionParty",
            },
          },
          token: {
            $ref: "#/components/schemas/SessionTokenClaims",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          outcome: {
            type: "string",
            const: "view",
          },
          userId: {
            type: "string",
          },
          primaryParty: {
            type: "string",
          },
          scope: {
            $ref: "#/components/schemas/ViewerScope",
          },
        },
        required: ["outcome", "parties", "primaryParty", "readAt", "scope", "token", "userId"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          token: {
            $ref: "#/components/schemas/SessionTokenClaims",
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
          outcome: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["outcome", "readAt", "reason", "token"],
      },
    ],
  },
  SessionTokenClaims: {
    anyOf: [
      {
        $ref: "#/components/schemas/TokenClaims",
      },
      {
        type: "null",
      },
    ],
    description:
      "What the received ledger token says about itself — issuer host, audience, expiry. Decoded only, never verified here (the participant already did that), and the token itself is never carried in the response. null when it cannot be decoded.",
  },
  TemplateDefinition: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          packageVersion: {
            type: ["string", "null"],
          },
          fields: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SchemaFieldLite",
            },
          },
          choices: {
            type: "array",
            items: {
              $ref: "#/components/schemas/ChoiceLite",
            },
          },
          key: {
            type: ["string", "null"],
          },
          implements: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SchemaRef",
            },
          },
        },
        required: ["status", "packageVersion", "fields", "choices", "key", "implements"],
        additionalProperties: false,
      },
    ],
  },
  TemplateRow: {
    type: "object",
    additionalProperties: false,
    properties: {
      definition: {
        $ref: "#/components/schemas/TemplateDefinition",
      },
      templateId: {
        type: "string",
      },
      packageId: {
        type: "string",
      },
      packageName: {
        type: "string",
      },
      module: {
        type: "string",
      },
      entity: {
        type: "string",
      },
      contractCount: {
        type: "number",
      },
    },
    required: [
      "contractCount",
      "definition",
      "entity",
      "module",
      "packageId",
      "packageName",
      "templateId",
    ],
  },
  TemplatesResponse: {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        items: {
          $ref: "#/components/schemas/TemplateRow",
        },
      },
      readAt: {
        type: "string",
        description:
          "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
        pattern:
          "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
      },
      ok: {
        type: "boolean",
        const: true,
      },
      scope: {
        type: "string",
        const: "visible_to_requester",
      },
    },
    required: ["ok", "readAt", "rows", "scope"],
  },
  TimelineResponse: {
    type: "object",
    additionalProperties: false,
    properties: {
      groups: {
        type: "array",
        items: {
          $ref: "#/components/schemas/LifelineGroup",
        },
        description:
          "Contract lifetimes grouped by template, biggest group first (buildLifelines · groupLifelines of core).",
      },
      total: {
        type: "number",
        description: "How many lifelines there are across every group.",
      },
      from: {
        type: "number",
        description:
          "The first offset drawn. The window is [from, offset] — both ends included, so from == offset is one point, not an empty range. A contract that died before it is in neither source and cannot be drawn.",
      },
      filter: {
        $ref: "#/components/schemas/UpdateFilter",
      },
      offset: {
        type: "number",
      },
      readAt: {
        type: "string",
        description:
          "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
        pattern:
          "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
      },
    },
    required: ["filter", "from", "groups", "offset", "readAt", "total"],
  },
  TokenClaims: {
    type: "object",
    properties: {
      issuerHost: {
        type: ["string", "null"],
      },
      audience: {
        type: "array",
        items: {
          type: "string",
        },
      },
      expiresAt: {
        type: ["string", "null"],
      },
    },
    required: ["issuerHost", "audience", "expiresAt"],
    additionalProperties: false,
  },
  TokenHoldingContract: {
    type: "object",
    properties: {
      contractId: {
        type: "string",
      },
      amount: {
        type: "string",
      },
      issuer: {
        type: "string",
      },
    },
    required: ["contractId", "amount", "issuer"],
    additionalProperties: false,
  },
  TokenHoldingGroup: {
    type: "object",
    properties: {
      instrumentId: {
        type: "string",
      },
      instrumentAdmin: {
        type: ["string", "null"],
      },
      owner: {
        type: "string",
      },
      ownerIsViewer: {
        type: "boolean",
      },
      exactBalance: {
        type: "string",
        enum: ["face_value", "unavailable_decay"],
      },
      total: {
        type: "string",
      },
      contractCount: {
        type: "number",
      },
      contracts: {
        type: "array",
        items: {
          $ref: "#/components/schemas/TokenHoldingContract",
        },
      },
    },
    required: [
      "instrumentId",
      "instrumentAdmin",
      "owner",
      "ownerIsViewer",
      "exactBalance",
      "total",
      "contractCount",
      "contracts",
    ],
    additionalProperties: false,
  },
  TokenHoldingProblem: {
    type: "object",
    properties: {
      contractId: {
        type: "string",
      },
      message: {
        type: "string",
      },
    },
    required: ["contractId", "message"],
    additionalProperties: false,
  },
  TokenHoldingsView: {
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          $ref: "#/components/schemas/TokenHoldingGroup",
        },
      },
      problems: {
        type: "array",
        items: {
          $ref: "#/components/schemas/TokenHoldingProblem",
        },
      },
    },
    required: ["groups", "problems"],
    additionalProperties: false,
  },
  TransferDirectionInfo: {
    anyOf: [
      {
        type: "object",
        properties: {
          direction: {
            type: "string",
            const: "unknown",
          },
          reason: {
            type: "string",
          },
        },
        required: ["direction", "reason"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["received", "sent", "internal", "third_party"],
          },
        },
        required: ["direction"],
        additionalProperties: false,
      },
    ],
  },
  TransferOfferExpiry: {
    anyOf: [
      {
        type: "object",
        properties: {
          passed: {
            type: "boolean",
            const: true,
          },
          passedByMs: {
            type: "number",
          },
        },
        required: ["passed", "passedByMs"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          passed: {
            type: "boolean",
            const: false,
          },
          remainingMs: {
            type: "number",
          },
        },
        required: ["passed", "remainingMs"],
        additionalProperties: false,
      },
    ],
  },
  TransferOfferProblem: {
    type: "object",
    properties: {
      contractId: {
        type: "string",
      },
      interfaceId: {
        type: "string",
      },
      code: {
        type: "number",
      },
      message: {
        type: "string",
      },
      details: {
        type: "array",
        items: {},
      },
    },
    required: ["contractId", "interfaceId", "code", "message", "details"],
    additionalProperties: false,
  },
  TransferOfferRow: {
    type: "object",
    properties: {
      contractId: {
        type: "string",
      },
      interfaceId: {
        type: "string",
      },
      sender: {
        type: "string",
      },
      receiver: {
        type: "string",
      },
      amount: {
        type: "string",
      },
      instrumentId: {},
      executeBefore: {
        type: "string",
      },
      expiry: {
        $ref: "#/components/schemas/TransferOfferExpiry",
      },
      directionInfo: {
        $ref: "#/components/schemas/TransferDirectionInfo",
      },
    },
    required: [
      "contractId",
      "interfaceId",
      "sender",
      "receiver",
      "amount",
      "instrumentId",
      "executeBefore",
      "expiry",
      "directionInfo",
    ],
    additionalProperties: false,
  },
  TransferOffersView: {
    type: "object",
    properties: {
      rows: {
        type: "array",
        items: {
          $ref: "#/components/schemas/TransferOfferRow",
        },
      },
      problems: {
        type: "array",
        items: {
          $ref: "#/components/schemas/TransferOfferProblem",
        },
      },
    },
    required: ["rows", "problems"],
    additionalProperties: false,
  },
  TransferPreapprovalExpiry: {
    anyOf: [
      {
        type: "object",
        properties: {
          passed: {
            type: "boolean",
            const: true,
          },
          passedByMs: {
            type: "number",
          },
        },
        required: ["passed", "passedByMs"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          passed: {
            type: "boolean",
            const: false,
          },
          remainingMs: {
            type: "number",
          },
        },
        required: ["passed", "remainingMs"],
        additionalProperties: false,
      },
    ],
  },
  TransferPreapprovalRow: {
    type: "object",
    properties: {
      contractId: {
        type: "string",
      },
      receiver: {
        type: "string",
      },
      receiverIsViewer: {
        type: "boolean",
      },
      issuer: {
        type: "string",
      },
      instrumentId: {
        type: "string",
      },
      expiresAt: {
        type: "string",
      },
      expiry: {
        $ref: "#/components/schemas/TransferPreapprovalExpiry",
      },
    },
    required: [
      "contractId",
      "receiver",
      "receiverIsViewer",
      "issuer",
      "instrumentId",
      "expiresAt",
      "expiry",
    ],
    additionalProperties: false,
  },
  TransferPreapprovalsView: {
    type: "object",
    properties: {
      rows: {
        type: "array",
        items: {
          $ref: "#/components/schemas/TransferPreapprovalRow",
        },
      },
      problems: {
        type: "array",
        items: {
          $ref: "#/components/schemas/TokenHoldingProblem",
        },
      },
    },
    required: ["rows", "problems"],
    additionalProperties: false,
  },
  TypedField: {
    type: "object",
    properties: {
      name: {
        type: "string",
      },
      value: {
        $ref: "#/components/schemas/TypedValue",
      },
    },
    required: ["name", "value"],
    additionalProperties: false,
  },
  TypedValue: {
    anyOf: [
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["party", "contractId", "text", "numeric", "int64", "date", "timestamp", "enum"],
          },
          type: {
            type: "string",
          },
          value: {
            type: "string",
          },
        },
        required: ["kind", "type", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "bool",
          },
          type: {
            type: "string",
          },
          value: {
            type: "boolean",
          },
        },
        required: ["kind", "type", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "unit",
          },
          type: {
            type: "string",
          },
        },
        required: ["kind", "type"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "none",
          },
          type: {
            type: "string",
          },
        },
        required: ["kind", "type"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "list",
          },
          type: {
            type: "string",
          },
          items: {
            type: "array",
            items: {
              $ref: "#/components/schemas/TypedValue",
            },
          },
        },
        required: ["kind", "type", "items"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "record",
          },
          type: {
            type: "string",
          },
          fields: {
            type: "array",
            items: {
              $ref: "#/components/schemas/TypedField",
            },
          },
        },
        required: ["kind", "type", "fields"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "variant",
          },
          type: {
            type: "string",
          },
          tag: {
            type: "string",
          },
          value: {
            $ref: "#/components/schemas/TypedValue",
          },
        },
        required: ["kind", "type", "tag", "value"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "map",
          },
          type: {
            type: "string",
          },
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: {
                  $ref: "#/components/schemas/TypedValue",
                },
                value: {
                  $ref: "#/components/schemas/TypedValue",
                },
              },
              required: ["key", "value"],
              additionalProperties: false,
            },
          },
        },
        required: ["kind", "type", "entries"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: {
            type: "string",
            const: "raw",
          },
          type: {
            type: "string",
          },
          value: {},
          why: {
            type: "string",
          },
        },
        required: ["kind", "type", "value", "why"],
        additionalProperties: false,
      },
    ],
  },
  UnavailableInThisLayer: {
    type: "object",
    properties: {
      status: {
        type: "string",
        const: "unavailable_in_this_layer",
      },
    },
    required: ["status"],
    additionalProperties: false,
  },
  UpdateDetailEventWithSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      choiceSchema: {
        anyOf: [
          {
            type: "object",
            properties: {
              consuming: {
                type: "boolean",
              },
              argType: {
                type: ["string", "null"],
              },
              argFields: {
                anyOf: [
                  {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/SchemaFieldLite",
                    },
                  },
                  {
                    type: "null",
                  },
                ],
              },
              returnType: {
                type: ["string", "null"],
              },
            },
            required: ["consuming", "argType", "argFields", "returnType"],
            additionalProperties: false,
          },
          {
            type: "null",
          },
        ],
        description:
          "The choice definition of an exercised event (from the package schema). The name is already in the event's choice. null if it could not be read.",
      },
      templateSchema: {
        anyOf: [
          {
            type: "object",
            properties: {
              fields: {
                type: "array",
                items: {
                  $ref: "#/components/schemas/SchemaFieldLite",
                },
              },
              typedPayload: {
                type: "array",
                items: {
                  $ref: "#/components/schemas/TypedField",
                },
              },
            },
            required: ["fields"],
            additionalProperties: false,
          },
          {
            type: "null",
          },
        ],
        description:
          "The field definitions of this event's template. For created, the typed payload as well. null if it could not be read.",
      },
      schemaStatus: {
        type: "string",
        description: '"ok" if the schema was read, otherwise the reason it could not be.',
      },
      kind: {
        type: "string",
        enum: ["created", "exercised"],
      },
      nodeId: {
        type: ["number", "null"],
      },
      lastDescendantNodeId: {
        type: ["number", "null"],
      },
      yours: {
        type: "array",
        items: {
          $ref: "#/components/schemas/VisibilityReason",
        },
      },
      tree: {
        $ref: "#/components/schemas/UpdateEventPlacement",
      },
      divulgedTo: {
        anyOf: [
          {
            type: "array",
            items: {
              type: "string",
            },
          },
          {
            type: "null",
          },
        ],
      },
      contractId: {
        type: "string",
      },
      templateId: {
        type: "string",
      },
      package: {
        type: "string",
      },
      module: {
        type: "string",
      },
      entity: {
        type: "string",
      },
      packageName: {
        type: ["string", "null"],
      },
      witnessParties: {
        type: "array",
        items: {
          type: "string",
        },
      },
      signatories: {
        anyOf: [
          {
            type: "array",
            items: {
              type: "string",
            },
          },
          {
            type: "null",
          },
        ],
      },
      observers: {
        anyOf: [
          {
            type: "array",
            items: {
              type: "string",
            },
          },
          {
            type: "null",
          },
        ],
      },
      createArgument: {},
      choice: {
        type: ["string", "null"],
      },
      consuming: {
        type: ["boolean", "null"],
      },
      choiceArgument: {},
      exerciseResult: {},
      actingParties: {
        anyOf: [
          {
            type: "array",
            items: {
              type: "string",
            },
          },
          {
            type: "null",
          },
        ],
      },
      interfaceId: {
        type: ["string", "null"],
      },
    },
    required: [
      "actingParties",
      "choice",
      "choiceSchema",
      "consuming",
      "contractId",
      "divulgedTo",
      "entity",
      "interfaceId",
      "kind",
      "lastDescendantNodeId",
      "module",
      "nodeId",
      "observers",
      "package",
      "packageName",
      "schemaStatus",
      "signatories",
      "templateId",
      "templateSchema",
      "tree",
      "witnessParties",
      "yours",
    ],
  },
  UpdateDetailHeader: {
    type: "object",
    properties: {
      updateId: {
        type: "string",
      },
      offset: {
        type: "number",
      },
      effectiveAt: {
        type: ["string", "null"],
      },
      recordTime: {
        type: ["string", "null"],
      },
      workflowId: {
        type: ["string", "null"],
      },
      synchronizerId: {
        type: ["string", "null"],
      },
      externalTransactionHash: {
        type: ["string", "null"],
      },
      submittedByYou: {
        type: "boolean",
      },
    },
    required: [
      "updateId",
      "offset",
      "effectiveAt",
      "recordTime",
      "workflowId",
      "synchronizerId",
      "externalTransactionHash",
      "submittedByYou",
    ],
    additionalProperties: false,
  },
  UpdateDetailResponse: {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          events: {
            type: "array",
            items: {
              $ref: "#/components/schemas/UpdateDetailEventWithSchema",
            },
          },
          kind: {
            type: "string",
            const: "transaction",
          },
          header: {
            $ref: "#/components/schemas/UpdateDetailHeader",
          },
          visibility: {
            anyOf: [
              {
                type: "object",
                properties: {
                  status: {
                    type: "string",
                    const: "ok",
                  },
                  reasons: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/UpdateVisibilityReason",
                    },
                  },
                },
                required: ["status", "reasons"],
                additionalProperties: false,
              },
              {
                type: "object",
                properties: {
                  status: {
                    type: "string",
                    const: "no_party_found",
                  },
                },
                required: ["status"],
                additionalProperties: false,
              },
              {
                type: "object",
                properties: {
                  status: {
                    type: "string",
                    const: "no_own_parties",
                  },
                },
                required: ["status"],
                additionalProperties: false,
              },
            ],
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
        },
        required: ["events", "header", "kind", "readAt", "visibility"],
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["reassignment", "topology", "checkpoint"],
          },
          updateId: {
            type: ["string", "null"],
          },
          offset: {
            type: ["number", "null"],
          },
          readAt: {
            type: "string",
            description:
              "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
            pattern:
              "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
          },
        },
        required: ["kind", "offset", "readAt", "updateId"],
      },
    ],
  },
  UpdateEventPlacement: {
    type: "object",
    properties: {
      depth: {
        type: "number",
      },
      ancestorIndex: {
        type: ["number", "null"],
      },
      descendantCount: {
        type: "number",
      },
    },
    required: ["depth", "ancestorIndex", "descendantCount"],
    additionalProperties: false,
  },
  UpdateFilter: {
    type: "object",
    properties: {
      template: {
        type: "string",
      },
      parties: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    additionalProperties: false,
  },
  UpdateTimeDistribution: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "empty",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          count: {
            type: "number",
          },
          from: {
            type: "string",
          },
          to: {
            type: "string",
          },
          buckets: {
            type: "array",
            items: {
              type: "number",
            },
          },
        },
        required: ["status", "count", "from", "to", "buckets"],
        additionalProperties: false,
      },
    ],
  },
  UpdateVisibilityReason: {
    type: "object",
    properties: {
      party: {
        type: "string",
      },
      roles: {
        type: "array",
        items: {
          $ref: "#/components/schemas/VisibilityRole",
        },
      },
      eventIndexes: {
        type: "array",
        items: {
          type: "number",
        },
      },
    },
    required: ["party", "roles", "eventIndexes"],
    additionalProperties: false,
  },
  UpdatesResponse: {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        items: {
          $ref: "#/components/schemas/RecentUpdateRow",
        },
      },
      beginExclusive: {
        type: "number",
        description:
          "“How far back did we look for recent” — the query range is (beginExclusive, offset].",
      },
      total: {
        type: "number",
        description: "Total count within the range (before filtering).",
      },
      matched: {
        type: "number",
        description: "Count that passed the filter (independent of the page).",
      },
      nextBefore: {
        type: ["number", "null"],
        description: "The before value for the next page. null if none.",
      },
      filter: {
        $ref: "#/components/schemas/UpdateFilter",
      },
      offset: {
        type: "number",
      },
      readAt: {
        type: "string",
        description:
          "The time this response was read (RFC 3339). Stamped on every 200 response not by the router (router.ts) but by the boot file (live/build-app.mjs) that owns the socket — the router does not call the clock.",
        pattern:
          "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
      },
    },
    required: [
      "beginExclusive",
      "filter",
      "matched",
      "nextBefore",
      "offset",
      "readAt",
      "rows",
      "total",
    ],
  },
  ViewerScope: {
    type: "string",
    enum: ["own", "instance-wide"],
  },
  VisibilityExplanation: {
    anyOf: [
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "ok",
          },
          reasons: {
            type: "array",
            items: {
              $ref: "#/components/schemas/VisibilityReason",
            },
          },
        },
        required: ["status", "reasons"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "no_party_found",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "no_own_parties",
          },
        },
        required: ["status"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          status: {
            type: "string",
            const: "unavailable",
          },
          reason: {
            type: "string",
          },
        },
        required: ["status", "reason"],
        additionalProperties: false,
      },
    ],
  },
  VisibilityReason: {
    type: "object",
    properties: {
      party: {
        type: "string",
      },
      roles: {
        type: "array",
        items: {
          $ref: "#/components/schemas/VisibilityRole",
        },
      },
    },
    required: ["party", "roles"],
    additionalProperties: false,
  },
  VisibilityRole: {
    type: "string",
    enum: ["signatory", "observer", "controller", "witness"],
  },
};
