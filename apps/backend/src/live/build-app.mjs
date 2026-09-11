// **The server before it has a socket.** Paths, status codes and headers are decided here, and everything
// that comes from outside — port, ledger address, clock — is received as an argument. So this file can run
// via `app.inject()` without opening a port — actually starting up is done by `serve.mjs`.
//
// **Fastify is used only for the socket, lifecycle and injection (inject). Path judgment is not handed to Fastify.**
// What each path under `/api/` means is decided by `../router.ts` (a pure function), and the public
// OpenAPI document is split from it by `handle` below on the **raw path**. The reason paths are not entrusted
// to Fastify's router (find-my-way) is that it forces its own URL interpretation:
//
//   · It decodes percent encoding before choosing a route → `/%61pi/holdings` would match `/api/holdings`.
//     This file compares `URL.pathname`, which does not decode. API classification must agree across the
//     Browser OIDC credential path, institution BFF/authentication front, shared-identity transport
//     and browser-facing host/gateway. An alias only Fastify recognises could turn a path treated as
//     non-API by an earlier boundary into a ledger request here. Explorer provides no authentication front.
//   · There are also paths whose **encoding is legitimate**, like `/api/party/alice%3A%3A1220ab` — the router
//     decodes them itself with `decodePathSegment`. So receiving a "decoded path" would decode twice.
//
// So there is exactly one route (catch-all), and what Fastify provides is the socket, reply, error handling and inject.
// Not using per-route schema validation is for the same reason — the contract is the single `../openapi.ts`,
// and whether to move it into a route table (= hand the source of truth for paths over to Fastify) has not been decided yet.
import Fastify from "fastify";
import { METHODS } from "node:http";
import { routeRequest } from "../router.ts";
import { openApiDocument as bundledOpenApiDocument, sharedIdentityOpenApi } from "../openapi.ts";
import { ServiceTokenProvider, SHARED_IDENTITY_UNAVAILABLE } from "../auth/service-token.ts";
import { serviceRequest } from "../auth/service-request.ts";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (status, body) => ({ status, headers: JSON_HEADERS, body: JSON.stringify(body) });

// `send` and an explicit `ledgerAuth` profile are required. `send` is the sole path out to the ledger, and who provides it decides whether this app
// is attached to the real thing or not. The rest are values inside the code, so they have defaults (values that
// decide **where it points**, like ledger address and port, are not in this file — `serve.mjs` receives those from env).
export function buildApp({
  send,
  ledgerAuth,
  serviceTokenOptions,
  now = () => new Date(),
  basePath = "",
  publicEntryUrl,
  openApiDocument = bundledOpenApiDocument,
} = {}) {
  if (typeof send !== "function") {
    throw new TypeError("buildApp: send is missing — it is the sole path out to the ledger.");
  }
  if (ledgerAuth?.mode !== "caller-bearer" && ledgerAuth?.mode !== "shared-identity") {
    throw new TypeError("buildApp: explicit ledgerAuth mode is required");
  }
  const service = ledgerAuth.mode === "shared-identity"
    ? new ServiceTokenProvider(ledgerAuth, serviceTokenOptions)
    : null;
  const document = service ? sharedIdentityOpenApi(openApiDocument) : openApiDocument;

  // ── Where the response is decided ────────────────────────────────────────────
  // Map method · raw path · query · authorization under the explicitly selected credential profile.
  // This boundary can acquire a service token; it is not a pure function. It does not touch the reply
  // object, so both the Fastify handler and `onBadUrl` (where there is no reply) use this.
  async function handle({ method, pathname, search, authorization }) {
    try {
      if (basePath) {
        if (!pathname.startsWith(`${basePath}/`)) return json(404, { reason: "no_such_route" });
        pathname = pathname.slice(basePath.length);
      }

      // This server's path document. The value is held by `../openapi.ts` and here it is only moved into JSON —
      // so the document is not written twice. No token is required: what can be asked is not a secret, and the
      // answer differing per person is because the ledger cuts it, not because of this document.
      // When under a sub-path, `servers` says so — paths are read relative to it.
      if (pathname === "/openapi.json") {
        return json(200, basePath ? { ...document, servers: [{ url: basePath }] } : document);
      }

      if (pathname.startsWith("/api/")) {
        // Even an empty Authorization header is a deployment conflict in shared-identity mode.
        if (service && authorization !== undefined) {
          return json(409, { reason: "shared_identity_authorization_not_allowed" });
        }
        const serviceCall = service ? serviceRequest(service, send) : null;
        // In caller mode, pass the credential through for this request only. In service mode the
        // transport owns the credential; the empty non-null marker admits routing without exposing
        // a service token (or its decoded claims) to the router and /api/session.
        // Non-GET requests are also sent through to the router — saying 405 is the router's job.
        const response = await routeRequest(
          {
            method,
            path: pathname,
            query: Object.fromEntries(new URLSearchParams(search)),
            ledgerToken: service ? "" : authorization?.startsWith("Bearer ") ? authorization.slice(7) : null,
          },
          { send: serviceCall?.send ?? send },
        );
        const failure = serviceCall?.failure();
        if (failure) return json(failure.status, failure.body);
        // The read time. The router is a pure function and does not call the clock — the same input must give the
        // same answer for tests to hold. So **the time is stamped here, where the socket is.**
        let body =
          response.status === 200 && response.body && typeof response.body === "object"
            ? { ...response.body, readAt: now().toISOString() }
            : response.body;
        // Caller-bearer may advertise the configured public entry as a recovery address. This is not
        // an invented `/login` route or a mode switch: login belongs to Browser PKCE or the institution
        // front. Service credential failures are operational and never receive a user sign-in link.
        if (!service && response.status === 401 && publicEntryUrl && body && typeof body === "object") {
          body = { ...body, entryUrl: publicEntryUrl };
        }
        // **A 405 is sent together with Allow.** The HTTP specification requires this header on a 405
        // response (RFC 9110 §15.5.6). This server is read-only, so the one allowed method is GET.
        // The router decides the 405 (being a pure function, it knows nothing about headers) and this
        // place adds the header.
        if (response.status === 405) {
          return { status: 405, headers: { ...JSON_HEADERS, allow: "GET" }, body: JSON.stringify(body) };
        }
        return json(response.status, body);
      }

      return json(404, { reason: "no_such_route" });
    } catch (error) {
      if (service) return json(503, { reason: SHARED_IDENTITY_UNAVAILABLE });
      return json(500, { reason: "server_error", detail: String(error?.message ?? error) });
    }
  }

  // Only the raw path is used. `URL.pathname` does not decode percent encoding — the string the router sees must
  // be the same as when it ran on node:http. The query must also be cut with `URL.search`: node accepts a `#`
  // in the request line, and using the raw string from the first `?` to the end would mix the fragment into the
  // query value (`?offset=1#x` → offset becomes `1#x`).
  const split = (rawUrl) => {
    const url = new URL(rawUrl, "http://localhost");
    return { pathname: url.pathname, search: url.search };
  };

  const app = Fastify({
    // **Request logging is not turned on.** This server's paths contain party ids and contract ids, and those are
    // private data scoped to the selected Canton identity (individual or shared service).
    // If production access logs are needed, choose redacted metadata at the browser-facing host,
    // institution BFF, operator gateway or reverse proxy. Never trace credential headers or ledger bodies.
    logger: false,
    // **Write down node:http's timeouts as they are.** Fastify's defaults are `requestTimeout: 0` (unlimited) and
    // `keepAliveTimeout: 72000`, so left alone it becomes looser than the old server (300000·5000). Since this server
    // answers without reading the request body, a client that sends the body very slowly while just holding the
    // connection could occupy a slot indefinitely — that becomes a real problem when opened outside loopback.
    // headersTimeout is the same on both sides (60000), so it is not written.
    requestTimeout: 300_000,
    keepAliveTimeout: 5_000,
    routerOptions: {
      // The top-level `querystringParser` is deprecated in fastify 5 (removed in 6) — put it here.
      // The value itself is re-parsed by `handle` from the raw query, so this is only Fastify's representation.
      querystringParser: (search) => Object.fromEntries(new URLSearchParams(search)),
      // **Malformed percent escapes** (`/api/contracts/%`) are answered directly by find-my-way before routes and
      // the error handler. The default response echoes the URL back and has no `cache-control`, so route it through
      // the same `handle` to apply the selected profile's rules (caller-bearer authentication or
      // shared-identity header rejection/credential handling), then the router's invalid_path response.
      // There is neither a Fastify reply nor error handling here — throwing here means no response goes out and the
      // socket hangs (targets that make even `new URL` fail, like `//%`, do that). So it closes on its own.
      onBadUrl: (path, req, res) => {
        const fail = (error) => {
          const { status, headers, body } = json(500, {
            reason: "server_error",
            ...(service ? {} : { detail: String(error?.message ?? error) }),
          });
          res.writeHead(status, headers);
          res.end(body);
        };
        try {
          const { pathname, search } = split(req.url ?? path);
          handle({
            method: req.method ?? "GET",
            pathname,
            search,
            authorization: req.headers.authorization,
          })
            .then(({ status, headers, body }) => {
              res.writeHead(status, headers);
              res.end(body);
            })
            .catch(fail);
        } catch (error) {
          fail(error);
        }
      },
    },
  });

  // **A broken request line or headers is left to node.** This is where the HTTP parser cuts it off before it ever
  // reaches the router. node performs its own default behavior only when nobody is listening on
  // `server.emit("clientError")` (status per error code, no body, nothing appended to a response in progress), but
  // Fastify always attaches one listener and intercepts it. Removing that listener makes **the same code** as the old server answer.
  //
  // This spot was implemented by hand and reverted. Fastify's default, a `bytesWritten` check, and a per-socket count of
  // responses in progress were tried in turn, and all three subtly diverged from node (respectively: body shape and
  // in-progress responses, a missing 400 after a finished response, a missing parser error before headers). The deciding
  // criterion is `headersSent` on the active `ServerResponse`, and there is no reason to reproduce that exactly outside
  // Fastify — calling the original is right.
  app.server.removeAllListeners("clientError");

  // Register every method node:http accepts — the old implementation sent all methods through to the router without
  // discrimination (the router answers 405), while Fastify routes only the methods it knows and turns the rest into 404.
  // All are `hasBody: false`: **this server does not read request bodies.** So Fastify's body and content-type checks
  // cannot intercept the router's 405 — without this, `content-type: ;` becomes a 500.
  for (const method of METHODS) {
    app.addHttpMethod(method, { hasBody: false, overrideExisting: true });
  }

  const dispatch = async (request, reply) => {
    const { pathname, search } = split(request.raw.url);
    const { status, headers, body } = await handle({
      method: request.method,
      pathname,
      search,
      authorization: request.headers.authorization,
    });
    return reply.code(status).headers(headers).send(body);
  };

  // These two are the only routes. What splits the paths is `handle`.
  app.all("/", dispatch);
  app.all("/*", dispatch);

  // The two above catch every path, so nothing arrives here — still, the shape is kept in line with `handle`.
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).headers(JSON_HEADERS);
    return { reason: "no_such_route" };
  });

  // `handle` already produces its own 500 internally. What arrives here is a failure outside it (reply serialization, etc.).
  app.setErrorHandler((error, _request, reply) => {
    reply.code(500).headers(JSON_HEADERS);
    return { reason: "server_error", ...(service ? {} : { detail: String(error?.message ?? error) }) };
  });

  return app;
}
