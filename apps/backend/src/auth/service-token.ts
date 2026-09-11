import * as oauth from "oauth4webapi";
import { type LedgerAuthConfig, safeServiceEndpoint } from "./config.ts";

export const SHARED_IDENTITY_UNAVAILABLE = "shared_identity_unavailable";
export const EXPIRY_MARGIN_MS = 10_000;
type Token = { value: string; usableUntil: number };

// One instance per Backend process. Neither OAuth responses nor errors escape this boundary.
export class ServiceTokenProvider {
  #config: Extract<LedgerAuthConfig, { mode: "shared-identity" }>;
  #fetch: typeof fetch;
  #now: () => number;
  #cached: Token | null = null;
  #pending: Promise<Token> | null = null;
  #server: oauth.AuthorizationServer | null = null;

  constructor(
    config: Extract<LedgerAuthConfig, { mode: "shared-identity" }>,
    options: { fetch?: typeof fetch; now?: () => number } = {},
  ) {
    safeServiceEndpoint(config.issuer, true, config.insecureHttpHosts);
    this.#config = config;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async get(): Promise<Token> {
    if (this.#cached && this.#now() < this.#cached.usableUntil) return this.#cached;
    this.#cached = null;
    if (this.#pending) return this.#pending;
    this.#pending = this.#acquire();
    try {
      return await this.#pending;
    } finally {
      this.#pending = null;
    }
  }

  // A late 401 from an older request must not evict a newer credential.
  invalidate(token: Token): void {
    if (this.#cached === token) this.#cached = null;
  }

  async #acquire(): Promise<Token> {
    try {
      const config = this.#config;
      const issuer = new URL(config.issuer);
      // The issuer was already accepted as plaintext by the configuration boundary — a loopback
      // host, or one named in SHARED_IDENTITY_INSECURE_HTTP_HOSTS. Everything Discovery then points
      // at is held to the same rule below, so an HTTP issuer cannot hand out an HTTP token endpoint
      // on some other host.
      const issuerIsHttp = issuer.protocol === "http:";
      const options = {
        [oauth.allowInsecureRequests]: issuerIsHttp,
        [oauth.customFetch]: (
          url: string,
          init: {
            method: string;
            headers: Record<string, string>;
            body?: URLSearchParams | undefined;
          },
        ) => {
          safeServiceEndpoint(String(url), issuerIsHttp, config.insecureHttpHosts);
          return this.#fetch(url, {
            method: init.method,
            headers: init.headers,
            ...(init.body === undefined ? {} : { body: init.body }),
            redirect: "error",
            cache: "no-store",
            credentials: "omit",
            signal: AbortSignal.timeout(15_000),
          });
        },
      };
      if (!this.#server) {
        const metadata = await oauth.processDiscoveryResponse(
          issuer,
          await oauth.discoveryRequest(issuer, options),
        );
        if (typeof metadata.token_endpoint !== "string") throw new Error();
        safeServiceEndpoint(metadata.token_endpoint, issuerIsHttp, config.insecureHttpHosts);
        if (
          metadata.token_endpoint_auth_methods_supported &&
          !metadata.token_endpoint_auth_methods_supported.includes("client_secret_basic")
        )
          throw new Error();
        if (
          metadata.grant_types_supported &&
          !metadata.grant_types_supported.includes("client_credentials")
        )
          throw new Error();
        this.#server = metadata;
      }
      const server = this.#server;
      const client: oauth.Client = { client_id: config.clientId };
      const parameters = new URLSearchParams({ scope: config.scopes });
      if (config.audience !== undefined) parameters.set("audience", config.audience);
      const startedAt = this.#now();
      const response = await oauth.clientCredentialsGrantRequest(
        server,
        client,
        oauth.ClientSecretBasic(config.clientSecret),
        parameters,
        options,
      );
      const result = await oauth.processClientCredentialsResponse(server, client, response);
      const lifetime = result.expires_in;
      if (
        result.token_type !== "bearer" ||
        !/^[A-Za-z0-9\-._~+/]+=*$/.test(result.access_token) ||
        typeof lifetime !== "number" ||
        !Number.isFinite(lifetime) ||
        lifetime <= 0
      )
        throw new Error();
      // Count from BEFORE the request: endpoint latency cannot extend credential use.
      const usableUntil = startedAt + lifetime * 1000 - EXPIRY_MARGIN_MS;
      if (!Number.isSafeInteger(usableUntil) || usableUntil <= this.#now()) throw new Error();
      // Unsolicited refresh/ID tokens are discarded along with the response. Never decode the JWT.
      const token = { value: result.access_token, usableUntil };
      this.#cached = token;
      return token;
    } catch {
      throw new Error(SHARED_IDENTITY_UNAVAILABLE);
    }
  }
}
