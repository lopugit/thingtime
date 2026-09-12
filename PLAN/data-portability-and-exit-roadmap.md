# Data portability and graceful-exit roadmap

**Status:** Proposed

**Prepared:** 2026-09-01, Australia/Melbourne

**Evidence:** [Data portability and graceful-exit baseline](../NOTES/data-portability-and-exit-baseline.md)

**Execution epic:** [TODO 23 — Data portability and graceful exit](../TODO/claude-todo/23-data-portability-and-exit.md)

## Outcome

Turn Thingtime's “open data, no lock-in” promise into a repeatable proof that a
normal account owner can run: inventory, export, verify locally, restore into a
compatible clean environment, and delete selected data or close the account
with honest receipts and no privilege or privacy leak.

## Non-goals

- Shipping a database dump, MongoDB credentials, S3 internals, or private
  server envelopes as a shortcut.
- Exporting sessions, password hashes, tokens, passkeys, private keys, or other
  material that could take over an account.
- Copying other people's private data because it was visible to the exporter.
- Treating custom-endpoint switching as whole-account migration.
- Building a second direct-Mongo path for export, import, testing, or deletion.
- Making baseline export, selective deletion, or account closure a paid-only
  feature.
- Promising recovery after a user has crossed an explicitly irreversible
  deletion boundary.

## Principles

1. **Inventory before mutation.** The user sees categories, locations, counts,
   sizes, inclusions, exclusions, and external boundaries first.
2. **Open, versioned, verifiable.** The archive has a documented format,
   semantic capability version, deterministic digests, and a local verifier.
3. **Data is not authority.** Import may recreate user content and portable
   preferences but never sessions, privileges, app grants, admin state, or
   action authority.
4. **The real API is the only path.** Export and import use dedicated API
   utilities and the same validation/authorization rules as live behavior.
5. **Deletion is exact and resumable.** Every destructive step is idempotent,
   ordered, observable, and honest about partial or externally controlled data.
6. **Exit quality is a trust metric.** A successful signup never compensates
   for an incomplete archive, secret leak, broken restore, or misleading
   deletion receipt.

## Success measures

| Measure | Proposed definition | Required guardrail |
| --- | --- | --- |
| Inventory coverage | Approved data classes represented in the preflight inventory ÷ all approved classes | Unknown classes fail closed and cannot silently disappear. |
| Export completeness | Manifest records/bytes/digests that match the chosen export cut ÷ expected totals | Must equal 100%; retries and concurrent writes cannot create false completeness. |
| Local verification | Valid archives accepted and seeded corruptions rejected by the offline verifier | Verification sends no archive content or identifiers to a service. |
| Semantic round trip | Approved fields/relationships equivalent after clean import ÷ fields/relationships eligible for import | No imported field grants auth, privilege, visibility, capability, or ownership it did not earn. |
| Deletion completeness | Categories reaching their declared terminal state ÷ categories approved for deletion | Partial work stays visible and retryable; external/custom-endpoint exceptions are named. |
| Exit effort | Median active user time to inventory, export, verify, and start closure | No accessibility regression, coercive delay, forced support contact, or tier gate. |

## Milestone P0 — Approve the contract

**Outcome:** one owner-approved classification replaces ambiguous “all data”
language.

- Inventory every user-facing and user-related data class across ordinary
  Things, protected Things, Messenger, attachments, profiles, preferences,
  app namespaces, auth/security state, email/support/operational satellites,
  and custom endpoints.
- Mark each class include, redacted inventory, separately requested, external,
  retention-only, or excluded, with a reason and accountable owner.
- Decide the v1 archive format, semantic versioning policy, consistent-cut
  model, encryption posture, job retention, link expiry, and recent-auth rule.
- Decide whether a verified open archive is enough for v1 or whether clean
  restore is a release gate.
- Record architectural and retention decisions in `DECISIONS.md` only after
  owner approval.

**Gate:** product, privacy/security, data, accessibility, and operations owners
approve the same inclusion matrix and deletion meaning.

## Milestone P1 — Build inventory and export proof

**Outcome:** a user can request one bounded, resumable, account-scoped archive
whose completeness is machine-verifiable.

- Define semantic API capabilities for inventory and export; update the
  canonical registry, route map, API docs, requirement map, and manifest tests
  together.
- Reuse the app-data summary pattern: enumerate categories from authoritative
  storage, not stale client caches or grants alone.
- Choose a durable job representation only after P0. Keep payload generation
  API-only, bounded, rate-limited, audited, and isolated from public projections.
- Stream or chunk ordinary records and attachment bytes; never construct a
  whole-account archive in memory.
- Produce per-class counts, byte totals, cryptographic digests, format and
  capability versions, declared exclusions, and a stable export-cut identity.
- Store generated archives privately for a short declared window; use
  short-lived download authorization and remove expired artifacts completely.
- Notify the owner of archive creation without placing private identifiers or
  archive links in third-party message content.

**Gate:** a comprehensive fixture exports twice to equivalent manifests;
interruption/resume does not duplicate or omit data; secret/foreign-owner scans
remain empty.

## Milestone P2 — Make verification local and understandable

**Outcome:** the owner can prove archive integrity without trusting the server
that produced it.

- Ship a small open-source verifier that checks format version, manifest,
  paths, counts, sizes, digests, duplicate ids, references, and truncation
  offline.
- Give the UI accessible progress, pause/resume, expiry, retry, and failure
  explanations; preserve last-known status optimistically.
- Report included, redacted, excluded, external, and failed categories
  separately rather than collapsing them into one green state.
- Add deterministic corruption fixtures covering altered JSON, removed rows,
  extra rows, path traversal, archive bombs, duplicate names, digest mismatch,
  malformed Unicode, and truncated attachments.

**Gate:** every seeded corruption is rejected with a safe reason; a valid
archive verifies on supported desktop platforms with no network access.

## Milestone P3 — Prove a safe semantic restore

**Outcome:** portable user data can be reconstructed through real APIs without
turning archive fields into authority.

- Import only approved portable fields through dedicated utilities that reuse
  live schema, size, storage, ACL, attachment, and rate-limit rules.
- Strip/regenerate server-owned ids and envelopes as decided; map stable
  portable ids deterministically and report collisions or unsupported schemas.
- Reauthorize every external/foreign relationship at import time. Missing or
  forbidden references become explicit unresolved entries, never broadened
  visibility.
- Make the import idempotent by archive identity and item identity, including
  interruption after any chunk.
- Compare source and restored accounts semantically using the approved matrix,
  not raw database-document equality.
- Exercise an empty hosted test account and, if approved, an empty compatible
  custom data endpoint while keeping home identity/control-plane boundaries
  explicit.

**Gate:** two imports of the same archive converge; the semantic comparator
passes all eligible categories; auth/privilege/capability escalation tests stay
at zero.

## Milestone P4 — Add selective deletion and account closure

**Outcome:** a user can remove one category or close the account without hidden
lock-in or an unobservable half-delete.

- Start with an authoritative preview: categories, locations, counts, bytes,
  irreversible effects, retained legal/operational records, and externally
  controlled data.
- Reuse exact category-level deletion paths where they are already correct,
  such as app namespace deletion, and add dedicated orchestration rather than
  bypassing their invariants.
- Require recent authentication, revoke active credentials at the declared
  boundary, and preserve only the minimum retry anchor needed to complete work.
- Delete dependent/private object bytes before removing the source row or
  refunding quota, consistent with attachment and storage fundamentals.
- Make every phase idempotent and resumable; repeated closure requests return
  current progress rather than starting another destructive workflow.
- Produce a bounded receipt with per-category terminal state and explicit
  exceptions. Keep it content-free and expire it under the approved policy.
- Explain that external custom-endpoint data requires a separate user-directed
  operation and cannot be certified deleted by the home service.

**Gate:** failure injection after every destructive phase recovers to the same
terminal result; live sessions stop at the declared point; a second request is
safe; inaccessible attachment bytes and reconciled ledgers are verified.

## Milestone P5 — Make the promise continuously true

**Outcome:** portability and closure cannot silently regress as new data types
and endpoints ship.

- Require every new user-related kind or storage surface to declare export,
  import, retention, and deletion treatment before registration.
- Add a coverage test that fails when a registered kind/route lacks a
  portability classification.
- Run scheduled fixture export/verify/restore/delete drills in a dedicated
  non-production environment and retain only bounded, non-sensitive results.
- Add the journey to release/manual QA at desktop and mobile sizes, including
  keyboard, screen reader, reduced motion, expired links, interruption, and
  partial failure.
- Keep landing copy, settings UI, API docs, capability manifest, support docs,
  and live behavior on one versioned contract.

**Gate:** two consecutive release drills pass, the public promise matches the
current capability version, and there are no unresolved critical privacy,
security, completeness, or deletion findings.

## Dependency map

- [Trustworthy adoption roadmap](./trustworthy-adoption-roadmap.md): export and
  deletion are gates for durable creation, repeat use, and sustainable trust.
- [TODO 22](../TODO/claude-todo/22-trustworthy-adoption-loop.md): owns the
  adoption outcome and measurement contract; this plan owns exit proof.
- [Versioned experience history](../TODO/claude-todo/20-versioned-experience-history.md):
  owns non-destructive experience replay, not account backup or closure.
- [`FUNDAMENTALS.md`](../FUNDAMENTALS.md): governs API-only data access,
  protected kinds, relational children, storage transactions, private state,
  custom endpoints, and secret handling.
- Current Things, attachment, app-data, profile, auth, Messenger, email, and
  storage APIs are implementation evidence to re-verify, not blanket approval
  to reuse their projections in an archive.

## Stop conditions

Pause release and preserve evidence if any of these occurs:

- an archive contains a credential, token, private server locator, S3 key,
  presigned URL, another person's unauthorized data, or an undeclared class;
- concurrent writes can make an incomplete export report complete;
- import can broaden ACLs, ownership, admin state, app grants, or action
  capability;
- a deletion flow removes its retry anchor before dependent bytes/data are
  inaccessible or falsely certifies external data;
- large-account work exceeds bounded runtime/memory without a resumable path;
- the experience requires support contact, payment, inaccessible controls, or
  misleading friction to export or close an account;
- docs, manifest, UI, and live behavior disagree about inclusion, deletion, or
  compatibility.

## First decision packet

The next owner session should decide:

1. the v1 class-inclusion matrix;
2. whether restore is a v1 release gate;
3. the open archive shape and versioning policy;
4. consistent-cut and resume semantics;
5. recent-auth, notification, retention, and expiry rules;
6. the meaning of account closure for home and custom endpoints; and
7. accountable product, privacy/security, data, accessibility, and operations
   owners.

No export job, import endpoint, or account-deletion workflow should be
implemented until that packet is approved.
