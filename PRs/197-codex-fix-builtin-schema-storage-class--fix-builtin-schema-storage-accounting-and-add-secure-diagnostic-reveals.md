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
- Credential labels are normalized across camelCase, separators, plurals,
  spaced labels, and CLI options, including Thingtime's canonical `secure`
  field. Random internal capture markers preserve reveal provenance until the
  final scrub completes; forged public placeholders cannot authorize a value.
- Redaction examines a bounded lookahead before truncation, uses hexadecimal
  boundaries for ObjectIds, avoids invoking thrown-object accessors, and
  preserves safe native stack frames without copying a credential-bearing
  message back into the stack.
- `/api/v1/things/reveal` is a closed provider registry rather than a generic
  secure-field reader. It requires a live current admin session, the exact
  diagnostic owner, fresh current-password verification on every request,
  same-origin JSON, and a non-configurable fail-closed five-request/15-minute
  limit. Every response is private and no-store.
- `/thing/:id` holds password and revealed values only in component memory.
  Hide, cancel, account/Thing changes, navigation, request aborts, and tab
  backgrounding clear transient state.
- Reveal failures use fixed client-authored copy, so unexpected server error
  prose cannot reach the modal or toast. Password, expired-session,
  permission, missing-value, rate-limit, transport, and outage paths have
  distinct recovery behavior and keyboard-focus handling.

## Verification

- Full Remix unit suite: 223 passed, including 11 focused password/provider/
  endpoint reveal tests and the builtin-schema storage regressions.
- Read-only API suite: 297 passed. Mutating API cases were intentionally skipped
  against the connected database. One explicit local migration exercise created
  a private diagnostic Thing in the local development database; no production
  migration or production data mutation was run.
- App-storage regression suite: 6 passed.
- Typecheck ratchet passes at 138 findings, down from the 143-finding baseline.
- Touched-file ESLint reports no errors; one unchanged `no-loop-func` warning
  remains in the large migrations file. `git diff --check` passes.
- The production build and Vercel output verifier pass.
- Desktop browser QA exercised the diagnostic page and password-confirmation
  modal with a synthetic intercepted diagnostic, including top-to-bottom
  scrolling and horizontal-overflow checks. The password-manager overlay and a
  locked browser host prevented completing the live synthetic reveal/Hide and
  mobile-viewport passes. Fixed-copy response mapping has focused automated
  coverage; those live transient-UI paths remain explicitly unverified in this
  pass, and no real password or raw sensitive value was submitted.
- Graphify semantic output, report, manifest, and tracked content-addressed
  cache were refreshed from the final source tree.
