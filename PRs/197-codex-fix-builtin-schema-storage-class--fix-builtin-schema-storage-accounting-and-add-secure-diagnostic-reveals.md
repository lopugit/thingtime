# PR 197 — Fix builtin schema storage accounting and add secure diagnostic reveals

## Why

The whole-account storage migration correctly treats ordinary schema Things as
billable user content, but the reserved builtin schema seeds were missing their
server-owned `storageClass: "control"` marker. Their `system` owner is not a
current user, so storage accounting stopped at the first seed with
`orphan_billable_thing` and kept account ledgers fenced.

The resulting private admin diagnostic also needed a safe way to identify the
specific orphan without putting raw identifiers into an ordinary toast, URL,
public response, searchable field, or browser cache.

## Builtin schema storage repair

- `seed-builtin-schemas` now writes every reserved builtin schema with root
  `storageClass: "control"` and treats a missing or incorrect marker as
  repairable seed drift.
- `backfill-user-storage-accounting` declares the seed migration as a
  prerequisite, so existing builtin schemas are repaired before billable
  ownership is evaluated.
- The policy is deliberately narrow: user/community-created schema Things stay
  ordinary billable content.
- Regression coverage proves both the repair predicate and the prerequisite
  ordering.

## Password-confirmed diagnostic reveal

- Migration diagnostic v2 envelopes may retain at most 32 MongoDB ObjectIds,
  but only when a typed, explicitly authored server-side error context approves
  them. Error prose alone never grants reveal access.
- The ordinary diagnostic projection contains numbered placeholders and
  value-free descriptors only. Raw values remain inside the protected binary
  `secure` envelope, with owner-only ACL, `storageClass: "control"`, home-plane
  reads, and the existing expiry boundary.
- Credentials, cookies, authorization values, tokens, password/hash fields,
  connection strings, private keys, sensitive URL query values, and ambiguous
  24-hex strings are irreversibly redacted. Stored JSON diagnostics are
  re-parsed through a bounded field allowlist before projection.
- `/api/v1/things/reveal` is a closed provider registry rather than a generic
  secure-field reader. It requires a live current admin session, the exact
  diagnostic owner, fresh current-password verification on every request,
  same-origin JSON, and a non-configurable fail-closed five-request/15-minute
  limit. Every response is private and no-store.
- `/thing/:id` holds password and revealed values only in component memory.
  Hide, cancel, account/Thing changes, navigation, request aborts, and tab
  backgrounding clear transient state.

## Verification

- Full Remix unit suite: 208 passed, including 11 focused password/provider/
  endpoint reveal tests and the builtin-schema storage regressions.
- Read-only API suite: 297 passed. Mutating API cases were intentionally skipped
  against the connected database; no production migration or database mutation
  was run during validation.
- App-storage regression suite: 6 passed.
- Typecheck ratchet passes at 138 findings, down from the 143-finding baseline.
- Touched-file ESLint reports no errors; one unchanged `no-loop-func` warning
  remains in the large migrations file. `git diff --check` passes.
- The production build and Vercel output verifier pass.
- Desktop and 390×844 browser QA exercised the diagnostic page, required
  password guard, one-time reveal, Hide, cancel/reopen clearing, modal bounds,
  and top-to-bottom scrolling using synthetic intercepted responses. No real
  password, diagnostic, or database record was used.
- Graphify semantic output, report, manifest, and tracked content-addressed
  cache were refreshed from the final source tree.
