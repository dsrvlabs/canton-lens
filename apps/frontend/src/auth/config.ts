export type BrowserOidcConfig = {
  mode: "browser-oidc";
  issuer: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scopes: string;
  audience?: string;
};

export type AuthConfig = BrowserOidcConfig | { mode: "institution-bff" | "shared-identity" };

// Browser configuration is public. Only these fields are passed to the OIDC client.
export function readAuthConfig(env: Record<string, unknown>, pageUrl: string): AuthConfig {
  const required = (key: string): string => {
    const value = env[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${key}`);
    return value.trim();
  };
  const mode = required("VITE_AUTH_MODE");
  if (mode === "institution-bff" || mode === "shared-identity") return { mode };
  if (mode !== "browser-oidc") throw new Error("Invalid VITE_AUTH_MODE");
  const issuer = endpointUrl(required("VITE_OIDC_ISSUER"));
  if (issuer.search || issuer.hash) throw new Error("Invalid OIDC issuer URL");
  const page = new URL(pageUrl);
  const redirect = endpointUrl(required("VITE_OIDC_REDIRECT_URI"));
  const logout = endpointUrl(required("VITE_OIDC_POST_LOGOUT_REDIRECT_URI"));
  for (const url of [redirect, logout]) {
    // Hash routing and document-relative assets/API paths must share one application directory.
    if (
      url.origin !== page.origin ||
      new URL(".", url).pathname !== new URL(".", page).pathname ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "OIDC redirects must be query-free app URLs in the same origin and directory",
      );
    }
  }
  const scopes = required("VITE_OIDC_SCOPES").split(/\s+/);
  if (!scopes.includes("openid") || scopes.includes("offline_access")) {
    throw new Error("OIDC scopes must include openid and must not include offline_access");
  }
  const audience = env.VITE_OIDC_AUDIENCE;
  return {
    mode,
    issuer: issuer.href,
    clientId: required("VITE_OIDC_CLIENT_ID"),
    redirectUri: redirect.href,
    postLogoutRedirectUri: logout.href,
    scopes: scopes.join(" "),
    ...(typeof audience === "string" && audience.trim() ? { audience: audience.trim() } : {}),
  };
}

export function endpointUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password
  ) {
    throw new Error("OIDC URLs require HTTPS (HTTP is allowed only on loopback)");
  }
  return url;
}
