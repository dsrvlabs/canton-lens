# Security boundaries

Canton Lens relays credentials to a participant and displays private ledger data.
Canton remains the authority for token validity and ledger visibility; the deployer owns every
boundary before the request reaches Canton.

## Token boundaries

| Profile | Credential location | Consequence |
|---|---|---|
| Browser OIDC | Browser memory | Each user keeps their Canton permissions; XSS can expose the token |
| Shared Identity | Backend memory | Every caller shares one Canton identity and visibility scope |

When using the Backend API without the UI, the same boundaries apply: the API caller supplies
the token in `caller-bearer` mode, while the Backend holds the token in `shared-identity` mode.

Profiles are explicit and never fall back to another credential source. Configuration failures,
expired credentials, and Canton denials must remain errors rather than empty data or a different
identity.

## Browser OIDC

The access token stays in Browser memory and is not retained by the Backend. Reloading requires
another login. Memory-only storage does not protect against XSS; use HTTPS, a Content Security
Policy, and avoid logging tokens.

The Backend refuses to relay a caller Bearer token to a remote participant over plaintext HTTP.
HTTPS is required for remote ledger addresses; loopback HTTP remains available for local
development.

## Shared Identity

Shared Identity uses one Backend-held credential for every request. It does not authenticate
individual users, so all callers share the same Canton permissions and require operator-managed
access control. Keep the client secret in Backend-only configuration.

The credential and the token it obtains open the whole configured Canton scope, so this profile
refuses to start unless the ledger and the issuer are reached over HTTPS. Loopback addresses are
exempt, being unable to leave the machine. `SHARED_IDENTITY_INSECURE_HTTP_HOSTS` names additional
hosts whose plaintext HTTP is accepted — a development allowance for a Backend in a container,
which cannot reach its host through a loopback name. Every other host still requires HTTPS, so a
value left behind does not cover a production ledger; startup prints a warning naming the hosts.

## Canton permissions

Both `CanReadAs` and `CanActAs` allow ledger reads for a party. `CanActAs` also permits command
submission on that party's behalf. Prefer `CanReadAs` for view-only deployments and grant
`CanActAs` only when another workflow requires it.

## Repository rules

- Do not commit or log secrets, tokens, private ledger data, or real private endpoints.
- Keep server credentials out of `VITE_*` variables and Frontend artifacts.
- Use least-privilege Canton rights for user and shared identities.
- Preserve `401`, `403`, and availability failures; do not replace them with empty results.
- Review security separately before adding writes, party or rights management, DAR operations,
  choice execution, or transaction submission.

## Deployment checklist

- Protect the Backend from direct public access.
- Restrict Shared Identity deployments with operator-managed access control.
- Grant Canton identities only the required rights.
- Leave `SHARED_IDENTITY_INSECURE_HTTP_HOSTS` unset. It is a local development allowance.
