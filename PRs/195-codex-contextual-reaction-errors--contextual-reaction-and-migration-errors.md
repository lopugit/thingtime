# PR 195 — Contextual reaction and migration errors

## Why

Reaction and migration failures could reach Lopu as Nitro's boolean
`error: true`, leaving only the generic 🌧️ status decoration. The first pass
made those failures contextual and repaired the Mongo upsert shape blocking the
three storage migrations. This follow-up makes administrator-only runtime
detail readable without publishing secrets or coupling diagnostics to the
failing migration transaction.

## Private migration diagnostics

- A thrown migration failure retains its source as a non-enumerable server
  value until `runMigration()` has released the global lease. Only then does
  the route capture a bounded, closed field set: error name, message, stack,
  standard codes/status, Mongo labels, and a short cause chain.
- The capture redacts credentials and authorization values, env-style secrets,
  JWTs, database connection strings, private keys, email addresses, common
  private identifiers, and user-home paths. It never enumerates arbitrary
  exception properties or invokes accessors.
- A real run attempts to persist that snapshot as a protected
  `migration-diagnostic` Thing in the home data plane with owner-only ACL,
  `storageClass: "control"`, binary root `secure` detail, and a 30-day
  home-only TTL. A soft five-per-minute gate and asynchronous newest-25 cleanup
  limit operational noise without delaying the original failure response.
- The response exposes only a validated diagnostic Thing id. Lopu constructs a
  same-origin `/thing/:id` link itself; arbitrary server-provided URLs are never
  accepted. The dedicated reader requires that the caller is still an admin
  and is the exact owner, and uses the same 404 for missing, expired, or
  inaccessible ids.
- Failed dry runs never create a diagnostic Thing and return the bounded
  redacted detail in the private response. A diagnostic-store failure on a real
  run uses the same inline fallback while preserving the original HTTP status,
  safe summary, and mutation outcome.
- Long inline details are scrollable in Lopu but excluded from the toast's live
  announcement; the focusable region has an accessible label. Diagnostic
  toasts close when the migrations screen unmounts or the authenticated account
  changes. `/thing/:id` also keys and aborts its private fetches by account.

## Verification

- The full Remix unit suite passes, including focused coverage for redaction,
  hostile payload allowlisting, lazy non-enumerable diagnostic capture,
  protected schema/storage policy, and the persisted envelope.
- The typecheck ratchet passes with 138 findings against a baseline of 143;
  targeted lint has no errors (six pre-existing warnings in touched legacy
  files), `git diff --check` passes, and the Vercel build/output verification
  passes.
- The read-only admin API smoke group passes 12/12 against the built Nitro
  server, including an exact anonymous `401 Unauthorized` assertion for the
  newly registered diagnostic route.
- Production-client browser QA exercised both failure paths at 1440×900 and
  390×844 with intercepted admin responses: the inline detail is a 460px
  scroll region (`pre-wrap`, no viewport overflow), the real-run link opens the
  full diagnostic, the new page resets to the top, and top-to-bottom scrolling
  has no horizontal overflow or runtime errors.
- This machine's local Mongo reports that it is a standalone server, so
  transaction-backed storage migrations are expected to fail locally with
  `IllegalOperation`; that environment was left unchanged. The persistence
  path is verified by focused tests rather than mutating the local database.
