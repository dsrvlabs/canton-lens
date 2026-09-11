// What the received ledger token **says about itself** — who issued it (iss), to whom (aud), until when (exp).
// It is not verified: whether it is valid was judged by the participant (the ledger has already been read with
// this token). Here it is only decoded. Neither the token itself, nor sub, nor any other claim is handed back —
// only the three the screen needs to say "how long is it valid" and "whose issuer is it". Of the issuer only
// the host is kept (internal structure such as a realm path is not information for the browser to see).
export type TokenClaims = {
  // The issuer's host. If iss is not a URL, it is kept as it is (at most 80 characters).
  issuerHost: string | null;
  audience: string[];
  // ISO 8601. null when there is no exp — so that "the expiry is unknown" is not drawn as 0 or as a blank.
  expiresAt: string | null;
};

// Decodes the second piece of a JWT (the payload) from base64url. null if it is not a JWT or not JSON — the
// token's format is the layer in front's business.
export function readTokenClaims(token: string): TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[1] === undefined || parts[1] === "") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as { iss?: unknown; aud?: unknown; exp?: unknown };
  return {
    issuerHost: issuerHostOf(p.iss),
    audience:
      typeof p.aud === "string"
        ? [p.aud]
        : Array.isArray(p.aud)
          ? p.aud.filter((a): a is string => typeof a === "string")
          : [],
    expiresAt:
      typeof p.exp === "number" && Number.isFinite(p.exp)
        ? new Date(p.exp * 1000).toISOString()
        : null,
  };
}

function issuerHostOf(iss: unknown): string | null {
  if (typeof iss !== "string" || iss === "") return null;
  try {
    return new URL(iss).host;
  } catch {
    return iss.slice(0, 80);
  }
}

// No Buffer — this module has to give the same answer in a browser and in Node.
function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
