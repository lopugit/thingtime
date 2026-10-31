# PR #985 — Recover deleted Things privately from Timeline history

Branch: `codex/timeline-deleted-recovery`, based on `main` at
`715a4022ad7a837e41f6a110dff447f8b61aa4af`.
PR: https://github.com/lopugit/thingtime/pull/985

## Behavior

History retained deletion events but version commands required a live Thing.
An ordinary deleted Thing can now be recovered from its deletion or an earlier
version. The preview shows absence, private recovery and the original identity;
a surviving owned folder is kept, otherwise the reviewed result uses Things root.
The shared desktop panel/mobile sheet offers **Recover Thing privately**. Page
components use the existing inert comparison and private-copy restoration.

Recovery appends `operation:create`, `before:null`, with the selected version and
latest deletion as parents. It preserves every prior event. It uses canonical
Thing create validation, ownership, quota and moderation, with content, component
copies, events/links, heads and accounting in one Mongo transaction. Exact retries
return the same receipt. Competing recoveries, occupied IDs, changed deletion
heads/folder placement/components and failed copies refuse without partial writes.

## Canonical records and authority

Trusted committed main revisions maintain `TimelineBranch` / `TimelineBranchHead`
records for `main` / `Published`. The JSON schemas and atomic record layout are the
same locally and remotely; one head per Thing survives deletion under Timeline.
There are no accumulating history arrays. Named branch command validation excludes
`main`, and the variations list hides Published. Browser drafts, branch effects,
captures and old event retries cannot advance it. The shared binary-envelope code
was extracted to avoid a repository/branch/version dependency cycle.

Recovery trusts the latest recorded deletion, verifies physical absence across all
owners and reads the deletion again inside the transaction. The private ACL is
reviewed and enforced. A recovery placement fingerprint complements existing
head/component preconditions. Legacy histories without a pointer use bounded
paged reads (2048 events / 16 MiB), refusing when incomplete. Deletion reuses saved
component-capture relationships without charging new captures at quota.

## Validation

- 147 Timeline tests and 92 API capability tests passed. Added canonical
  Published IndexedDB round-trip, draft/replay refusal, legacy recovery,
  protected/attached snapshot, private preview and quota rollback coverage.
- Full unit suite and full Vite/Nitro/Vercel output build passed.
- Full typecheck matches the existing 91 diagnostics exactly; it is not clean.
  Targeted lint reports no errors and one existing control-regex warning.
- Guarded real HTTP replica-set checks passed for private original-ID recovery,
  exact retry, concurrent/ABA refusal, foreign ID collision, folder fallback and
  stale placement, recorded component copies and second-copy rollback/accounting.
- Existing published-component and core API integration passed, including
  restore/merge, named branch CAS/paging, scope/auth, large snapshots and private
  relational records.
- Quota integration passed through actual registration/login, admin subscription
  and Thing APIs: full-account deletion retains history/captures at unchanged
  usage; ordinary/page recovery refuses atomically at quota; increasing allowance
  lets the same recovery commit once. Only a synthetic account on the dedicated
  loopback replica was temporarily allowlisted as admin.
- Fresh headed browser at 1280×900 and 390×844: private recovery preview, absent
  current page, inert recorded result, reachable controls, no horizontal overflow,
  same-ID apply and five retained versions after reload; zero page errors.
- Graphify AST snapshot refreshed as an atomic graph/manifest pair. Documentation
  semantic extraction remains the previously documented tooling limitation.

Screenshots: [desktop](assets/timeline-deleted-recovery/recover-1280.png),
[phone](assets/timeline-deleted-recovery/recover-390.png),
[retained history](assets/timeline-deleted-recovery/recovered-history.png).

Deployment/check/merge evidence is recorded in the PR body after final-head
verification. Local API/browser evidence uses disposable data only.

## Boundaries

Protected records and target-attached interactions need dedicated recovery writers.
Recovery does not recreate folder children, external files, credential grants or
external effects. Existing large preview/restore response limits still apply.
This increment does not complete the broader [Timeline acceptance ledger](../docs/unified-timeline.md).
