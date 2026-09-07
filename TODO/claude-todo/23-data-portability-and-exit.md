# 23 — Data portability and graceful exit 🧳

**Status:** 🟣 Proposed · planning only · added 2026-09-01

**Owner:** Unassigned; product owner coordinates privacy/security, data,
accessibility, and operations decisions

**Plan:** [`PLAN/data-portability-and-exit-roadmap.md`](../../PLAN/data-portability-and-exit-roadmap.md)

**Evidence:** [`NOTES/data-portability-and-exit-baseline.md`](../../NOTES/data-portability-and-exit-baseline.md)

## Goal

Make Thingtime's “open data, no lock-in” promise independently provable: a
normal account owner can inventory their data, export a versioned archive,
verify it offline, restore approved portable data through the real API, delete
selected scopes, and close the account with exact, non-sensitive receipts.

## Problem

The current product has valuable primitives—paginated owned-Thing reads,
per-Thing deletion, private attachment downloads, app namespace inventory and
delete-all, and custom data endpoints—but no one account-wide portability and
closure contract. The generic Things list excludes protected and Messenger
kinds, attachment bytes are fetched one at a time, and endpoint switching does
not move home identity/control-plane state.

This TODO turns the gap into an implementation-sized epic. It does not approve
an archive schema, job store, deletion retention rule, or new endpoint by
itself.

## Dependencies and boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative.
- [TODO 22](./22-trustworthy-adoption-loop.md) owns the adoption outcome and
  privacy-safe measurement contract. This TODO owns portability and exit proof.
- [TODO 20](./20-versioned-experience-history.md) owns reversible experience
  history. Restoring a search/feed snapshot is not account backup.
- The current API registry, runtime route map, capability manifest, and each
  data-owning subsystem must be re-audited immediately before implementation.
- All reads, writes, imports, tests, fixtures, and deletion drills go through
  the Thingtime API and dedicated utilities. No direct database or object-store
  shortcuts.
- Baseline export, selective deletion, and account closure apply to every
  account tier.

## Phase 0 — Approve the data-class matrix

- [ ] Enumerate ordinary/protected Things, attachments, Messenger, profiles,
      preferences, app namespaces, relationships, auth/security state,
      email/support/operational satellites, and custom endpoints.
- [ ] For every class choose: include, redacted inventory, separately
      requested, external, retention-only, or excluded—with reason and owner.
- [ ] Decide v1 archive format, semantic capability version, consistent-cut
      model, resume identity, digest algorithm, encryption posture, job
      retention, download expiry, and recent-auth requirement.
- [ ] Decide whether a clean semantic restore is required before v1 is called
      shipped.
- [ ] Record approved architectural/retention decisions in `DECISIONS.md`.

**Gate:** the product, privacy/security, data, accessibility, and operations
owners approve one shared matrix. Unknown classes fail closed.

## Phase 1 — Inventory and export

- [ ] Add versioned capability features and an explicit client requirement map
      for the approved inventory/export contract.
- [ ] Register every endpoint in the route file, Nitro import map, API docs
      registry, capability registry, and automated manifest coverage together.
- [ ] Return an authoritative preflight inventory with per-class counts, bytes,
      locations, inclusions, exclusions, and external boundaries.
- [ ] Generate one private, bounded, resumable archive from a stable export cut;
      stream/chunk large records and attachments instead of buffering the whole
      account.
- [ ] Write a manifest containing format/capability versions, export-cut id,
      per-class counts and sizes, file digests, declared exclusions, and safe
      provenance required for import.
- [ ] Use dedicated deny-by-default projections. Exclude credentials, tokens,
      sessions, password hashes, passkey secrets, private server/object fields,
      presigned URLs, and unauthorized foreign content.
- [ ] Make retries idempotent by account, export-cut, and request id; rate-limit
      creation and keep archive downloads short-lived, private, and audited.

## Phase 2 — Offline verification and accessible UX

- [ ] Ship an offline verifier for format, counts, sizes, digests, duplicate ids,
      relationships, unsafe paths, truncation, and unsupported versions.
- [ ] Add deterministic corruption fixtures for altered/removed/extra records,
      archive bombs, path traversal, malformed Unicode, duplicate names, wrong
      digests, and truncated attachment bytes.
- [ ] Build a user surface that shows last-known progress immediately and makes
      create, pause/resume, verify, download, expiry, retry, and cancel states
      usable with keyboard, screen reader, touch, reduced motion, and narrow
      viewports.
- [ ] Report included, redacted, excluded, external, and failed categories
      separately. Never hide a partial export behind one success badge.

## Phase 3 — Import and semantic round trip

- [ ] Import only approved portable fields through dedicated real API paths;
      re-run current validation, quotas, storage accounting, attachment checks,
      and ACL authorization.
- [ ] Strip or regenerate server-owned envelope fields. Imported content never
      grants authentication, ownership, admin, moderation, app, token, or
      action authority.
- [ ] Map stable portable ids deterministically and report collisions,
      unsupported schemas, unavailable foreign references, and ACL changes.
- [ ] Make every chunk idempotent so interruption and whole-archive replay
      converge without duplicate content or charges.
- [ ] Compare source and restored accounts semantically against the approved
      matrix using fixture accounts created through the real API.

## Phase 4 — Selective deletion and account closure

- [ ] Show a preflight preview with categories, locations, counts, bytes,
      irreversible effects, declared retention, and custom/external boundaries.
- [ ] Require recent authentication and revoke active credentials at the
      approved irreversible boundary.
- [ ] Orchestrate existing exact deletion primitives where possible; never
      bypass attachment/object deletion, relational cascades, or transactional
      storage-ledger refunds.
- [ ] Persist bounded, idempotent progress and keep a retry anchor until every
      dependent category reaches its declared terminal state.
- [ ] Treat repeated closure requests as status/resume, not new destructive
      jobs.
- [ ] Generate a content-free, expiring receipt with job id, timestamps,
      per-category terminal state, counts, and explicit external/retention
      exceptions.
- [ ] Explain that closing the home account cannot certify deletion from a
      user-controlled custom MongoDB endpoint; provide the approved separate
      action/checklist.

## Security, privacy, and abuse checklist

- [ ] Archive creation and closure require current authorization plus the
      approved recent-auth proof; stolen-session and confused-deputy tests fail.
- [ ] Download URLs are short-lived, unguessable, non-loggable, and scoped to
      one owner/job; expiry and revocation are verified.
- [ ] Secret scanners and foreign-owner fixtures cover archive files, manifest,
      logs, errors, notifications, receipts, and support/debug surfaces.
- [ ] Import rejects authority-bearing fields and never broadens visibility to
      “make restore work.”
- [ ] Export/import/closure routes have body caps, rate limits, audit events,
      bounded concurrency, cancellation rules, and fail-closed storage errors.
- [ ] Large-account and high-cardinality fixtures prove bounded memory/runtime
      and resumability.
- [ ] Baseline exit is not paywalled, delayed to improve retention, or hidden
      behind support contact.

## Acceptance criteria

- The owner-approved class matrix and archive format are documented, versioned,
  and understandable without reading implementation code.
- Every active data class and registered user-data route has explicit export,
  import, retention, and deletion treatment; coverage fails on an unclassified
  addition.
- A fixture account containing every approved category exports through the real
  authenticated API with 100% expected counts/bytes/digests.
- The offline verifier accepts the valid archive and rejects every seeded
  corruption without sending archive contents over the network.
- Two imports of the same archive converge; the semantic comparison passes all
  eligible classes; no authority or ACL escalation is possible.
- Failure injection after each destructive phase resumes to the same terminal
  state; attachment bytes are inaccessible before rows/charges disappear;
  ledgers reconcile; a repeated closure request is safe.
- UI walkthroughs pass desktop/mobile, keyboard, screen reader, reduced motion,
  expired-link, interruption, cancellation, and partial-failure scenarios.
- API docs, capability manifest, client requirements, settings/help copy, and
  the live landing promise describe the same verified contract.
- Current CI and the actual deployed behavior are rechecked before status moves
  from planned to shipped.

## Concrete next action

Prepare one owner decision packet containing:

1. the proposed data-class matrix;
2. the recommended open archive shape;
3. consistent-cut and resume semantics;
4. whether restore is a v1 release gate;
5. recent-auth, retention, expiry, and notification rules;
6. home-account versus custom-endpoint deletion meaning; and
7. accountable owners for product, privacy/security, data, accessibility, and
   operations.

Do not implement jobs or destructive routes until that packet is approved.
