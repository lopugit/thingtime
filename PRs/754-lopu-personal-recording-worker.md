# PR 754 — Personally paired recording worker

Branch: `codex/lopu-personal-recording-worker`, base: `develop`.

## Implemented

- Outbound-only origin-negotiated transport around the native local runtime.
- Local audio transcription followed by text-only native Claude Code input.
- Credential-free job projections, bounded audio and leases, heartbeat loss
  cancellation and identical completion retries without repeating inference.
- API-layer broker with exact paired-session/device ownership, current consent
  checks and transaction write fences against revocation and source changes.
- The canonical content writer creates quota-billed relational transcript
  comments and private notes/todos; client results cannot supply IDs or ACLs.
- Accepted transcripts, insight IDs and comment IDs survive interrupted work.
  Done receipts bind owner, device, session, lease and exact submitted content.
- Personal jobs never enter the cloud-provider worker, including after expiry.

## HTTP and settings integration — 2026-09-10

Registered the broker, docs and manifest together. Recording settings 1.4.0
adds an owned eligible device selector and explicit processor reassignment on
retry; personal protocol 1.0.0 accepts only paired device credentials. Default
settings preserve provider processing. Device metadata is bounded and contains
no credentials; an offline worker can queue without claiming inference health.
Cloud jobs recheck processor selection before provider sends and transactional
content writes. All broker errors, including oversized bodies, are private and
uncacheable. Product rate limits follow the account subscription.

Real local HTTP smoke passed signup, signed Ed25519 pairing, owned selection,
empty queue polling, cookie rejection and opt-out revocation. Synthetic account
`recqamtv9n4hr` remains local with processing disabled. No audio/provider calls
were made. New tests cover device projections, malformed requests, authority
failures and changing processors during a content transaction.

Still pending: signed-in pairing UI acceptance, real audio/results and transaction-race
acceptance, deployed and physical Watch proof. Browser automation returned
`Debugger unattached`, so desktop/mobile selector validation is not yet proven.
Do not bypass consent by seeding internal database fields. This PR is not a
claim of physical-device acceptance.

## Interactive Mac launcher — 2026-09-10

Added configure/pair/resume/status/run commands, private per-origin path config
and process locks. Signed pairing persists the credential and server proof in
Keychain before transmission, so a lost completion receipt resumes the exact
claim. Keychain writes use stdin, never argv, and require read-back verification.
Native Claude sign-in remains separate; pairing does not enable processing.
Eight pairing tests and three mocked Keychain tests pass. Real local HTTP smoke
now drops a successful pairing response and proves recovery before selection,
queue polling and opt-out. Synthetic account `recqamtva5kc3` remains local with
processing disabled. No real Keychain write, audio processing or AI invocation
was performed in this acceptance slice. Expired-challenge reset and the visual
pairing button were still unfinished at this checkpoint; this is not yet a turnkey installed service.

## Setup panel and develop reconciliation — 2026-09-10

Added the expandable recording-settings setup panel with masked one-time
secrets, explicit copy/reveal controls, expiry/account-switch cleanup, CLI
instructions and separate recording consent. Device-pairing contract 1.1.0 adds
the authenticated owner ID and private/no-store response headers; the setup
client negotiates that exact minimum before creating a challenge. Five client
tests and three route tests cover mismatched owners, expiration, manifest gates,
aborts, unauthorized callers and rate-limit headers. The real HTTP smoke now
uses this same setup client before proving lost-receipt launcher recovery.
Synthetic account `recqamtvai7z7` remains local with processing disabled.

Merged develop source `77ee7f337` locally, retaining its shared-component
audience-boundary fixes. Resolved changelog and generated-snapshot conflicts;
reconciled the newly bumped sharing capabilities in the second manifest suite.
Capability tests: 38 pass; Lopu UI tests: 137 pass; Lopu broker suites: 137 + 78
pass; sharing slice: 13 pass and one opt-in integration test skipped. Full
production build, Vercel output verification and compiled-handler manifest /
anonymous-private-401 smoke pass. Typecheck remains at the 108-error baseline;
targeted lint has no errors and one existing effect-cleanup warning.

Fresh Chrome tab control recovered. The signed-out recording page renders on
desktop and at a 487-CSS-pixel narrow viewport with no horizontal overflow.
The tab is left at local sign-in for user-owned test registration; signed-in
setup interactions and true phone-width visual acceptance remain unproven.

## Verification

`test:ai-models` covers local runtime and transport. `test:lopu` covers the
bounded request/receipt contract, authority filters, broker lifecycle and shared
recording content writer. Broker fixtures are in-memory collaborators; they do
not access MongoDB or serve as evidence that deployment/pairing is complete.
Targeted ESLint and the typecheck ratchet also apply. Existing full-project
type errors must remain distinguished from new failures.
