# PR 1025 — Prevent local API fallback from creating production data

A compiled acceptance server with Mongo configured but no JWT signing key silently
proxied a registration POST to production. Vite had a separate automatic
production proxy for missing configuration. Both paths are removed for ordinary
web servers. API dispatch and Mongo warmup fail closed; the installed desktop
bridge requires its explicit desktop flag, loopback host and selected HTTPS
origin and is disabled in test mode.

The fixture runner accepts only a literal loopback HTTP origin, disallows
cross-origin upload URLs and refuses redirects. These guards do not turn a
production Mongo connection into an isolated backend: acceptance must still use
separate credentials/data and an enforced browser/backend network boundary.

The exact accidental `catalog-check` account (2026-10-18T04:11:04.533Z) is handled
by one registered admin migration, not a general user-deletion endpoint. It
refuses altered identity, administrator/verified accounts, live sessions,
nonempty ledgers and unexpected content. Account/bootstrap/auth records are
removed in one home-database transaction using complete BSON preimages. Other
users and shared roster entries remain; delivery and migration audit records
remain. The existing destructive-migration confirmation applies. Admin status
and run manifests advertise 1.4.0, and the UI negotiates before use.

Validation before deployment:

- Root/fallback suite: 39 passed; migration suite: 62 passed; capability suite:
  96 passed; fixture runner: 5 passed.
- Focused ESLint, Vite client build and built Nitro server passed.
- Actual compiled Nitro and Vite ran with a clean environment under macOS
  sandbox-exec. Direct IP and redirected outbound traffic failed with EPERM.
  Both servers rejected registration, Thing writes, migration writes and root
  data with 503, no fallback headers and no cookies. Test processes were stopped.
- Typecheck ratchet reported 91 diagnostics vs baseline 89 (non-blocking);
  full diagnostics contained none in the changed implementation files.

After production deployment, dry-run the exact migration, verify its bounded
record counts, execute the user-authorized cleanup, search the account list to
confirm absence, and dry-run again to confirm zero work. Record the live outcome
on the PR; do not treat mocks or a deployed commit alone as cleanup evidence.
