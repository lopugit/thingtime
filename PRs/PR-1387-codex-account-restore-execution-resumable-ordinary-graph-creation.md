# PR 1387 — Resumable ordinary graph creation and execution holds

Date: 6 November 2026. Branch: `codex/account-restore-execution`.
Base: `bd80571a88fed16b750d82f5adf9af9c3c634e11` (source closure PR 1386,
including streaming codec PR 1384). Runtime/UI source:
`cf69567d0dea7845e81e670c2b9a77c4447458ec`.

## Delivered primitive

Internal server utilities accept an explicitly reviewed ordinary graph into an
owned private folder. Fresh deterministic IDs, exact remapped composition
references, explicit hierarchy, schema/page ordering and immutable record hashes
are verified before content writes. Unsupported media, managed families,
unresolved/dynamic/alias references, browser HTTP payloads and outside local
relationships refuse. Pure browser compute/return remains supported.

The atomic path uses one canonical transaction. The large-graph path accepts a
durable review admission and complete intent chain before creating content one
record at a time. Canonical writes, accounted Timeline effects and scalar
progress commit together. Session fencing, owner/destination checks and root
revision CAS apply to every mutation; no token or server-local SQLite is durable
authority. Full browser/service owner sessions on the home data plane are the
first supported identity scope; delegated/scoped credentials need follow-up.

An exact completed replay reauthorizes the current caller and returns the
recorded result before opening source/scratch. Lost acknowledgements and later
owner edits cannot replay accepted writes. Partial progress remains readable
and editable, with protected execution holds until current content passes
closure/containment verification and the final epoch/count/chain/CAS fence.
Canonical mutation recording fences both old and new held provenance, including
ownership changes. Historic imported receipts cannot release a new operation.

Server Action admission covers IDs, keys, shared roots and children. Derived
holds survive Things, Component browse and Webpage resolve projections. Browser
boundaries suppress source loading, saved/inline/pseudo/local actions,
native/upload mounts, pending confirmations and captured delayed callbacks.
Ordinary data and drafts remain mounted. No new endpoint or MCP is introduced.

The manifests and client requirements negotiate Things 1.52.0, Actions run
1.43.0, Component browse 1.1.0 and Webpage resolve 1.13.0. A compatible manifest
on one origin does not prove that every host sharing a database has deployed
hold-aware readers and admission; restore activation requires that rollout.

## Verification

Verified on the runtime/UI source commit above, with synthetic disposable
identities and an owned replica; no personal account/app/files/sync changes:

- `test:backups`: 134 passing tests, no skips.
- `test:api-capabilities`: 150 passing tests.
- Raw TypeScript and typecheck ratchet: zero errors.
- Full Remix lint: zero errors, 423 warnings retained.
- Canonical Remix build and Vercel output verification passed.
- `test:content-execution:built`: compiled Vercel origin manifest, registry and
  all four docs routes agree; clean synthetic loopback database configuration.
  This is built-handler routing evidence, not deployed/installed acceptance.
- `test:backups:ordinary-restore`: eight captured records, independent copied
  sealed vault, deleted source content/first vault and revoked source session;
  exact content/geo/hierarchy/schema readback and Action cycles; intent
  interruption; real child-process death after a committed effect; review
  recovery through the Timeline Request handler; retries without duplicates;
  no-source completed replay; later edits retained; completion-race, wrong
  owner, revoked session, stale review/root/capability, containment, alias,
  unsupported dependency/family and HTTP-payload refusals. Content writes use
  canonical API utilities, with real signup/Timeline/Action Request handlers.
- Parent-performed isolated Chrome desktop/mobile checks cover actual grid and
  referenced Component hold retention, preview/source/action/native/upload
  callbacks, row-form grouping, stale confirmation, held/released rendering,
  scrolling and draft retention. Focused UI units: 14 passing. Evidence:
  `/tmp/thingtime-restore-hold-evidence/results.json` and eight screenshots.
  Browser API responses are synthetic and distinct from the real replica proof.
- Independent read-only final review found no actionable finding in the scoped
  auth/receipt/epoch/reference/containment invariants. It did not run tests.

Private local command logs are under `/tmp/thingtime-restore-*` and
`/tmp/thingtime-ordinary-restore-integrated.log`; these paths are local evidence,
not published artifacts or credential stores.

## Explicit remaining work

`wholeAccountReady` remains false. This is not a complete account-restore
workflow. No folder status badge or supervision UI is implemented; projected
`creationProgress` is durable phase/count information, not process liveness.
Managed/account/settings/security/device adapters, exact attachment bytes,
general relationship/HTTP remapping, additional credential/data-plane modes,
complete functional source closure and measured 100 GB–100 TB operation remain
required by the original goal.

The full GenericThingPage selected-origin route and cached read-refresh journey
remain an installed/real-app acceptance gate. Parent owns final signed native
build/install and real-app acceptance after merge; no current local install,
production rollout or provider durability is claimed here.

The wrapper refreshed the structural graph. Scoped semantic extraction covers
this note, the backup contract and the four changed feature maps. The very large
`TESTING.md` and changelog are not semantically refreshed in this phase: a prior
full-document attempt expanded into 77 slices and failed to finish, so that
unchanged expensive path is not repeated. Their source files remain present;
no incomplete extraction is activated as complete semantic coverage.
See [PR 1387](https://github.com/lopugit/thingtime/pull/1387) for the observed
protected-check, preview and merge outcomes. Source/CI, preview, installation
and real-account acceptance remain separate evidence layers.
