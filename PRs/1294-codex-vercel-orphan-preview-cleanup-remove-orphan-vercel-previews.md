# PR #1294 — Remove orphan Vercel previews and reject pre-gateway source

- PR: https://github.com/lopugit/thingtime/pull/1294
- Branch: `codex/vercel-orphan-preview-cleanup`
- Controller base: freshly fetched `origin/github-actions`,
  `603ebea637688770de18fdc6322efe581d5be6fe`.
- Worktree: `/Users/lopu/.codex-2/worktrees/vercel-preview-cleanup/thingtime`.
- Date: 30 October 2026, Australia/Melbourne.

## Delivered controller behavior

The existing PR-close and six-hour preview lifecycle now inventories actual
Vercel deployment objects across old and current policy versions. An orphan
requires exact project/repository/source ownership and no open same-repository
PR using its branch. Numbered PR metadata is independently checked against the
live PR. Native Git provenance includes `githubCommitRepoId` and `gitSource`;
prebuilt provenance uses the protected publisher marker and exact source fields.

Deletion is separate from alias-only cleanup: remove the exact deployment ID,
then require a provider 404 readback. Active builds are canceled first; a build
still canceling waits for another sweep. Full inventories complete before
candidate mutations. Repeated or missing pagination cursors, malformed metadata,
provider errors and changed ownership preserve resources and fail closed.

Production targets, declared gateway owners, production/custom stable target
pointers, current project domains and arbitrary custom aliases remain protected.
`targets.preview` is last-deployment bookkeeping and does not retain an orphan.
Untagged main/develop/staging/controller/fallback branches are protected; an
explicit PR-tagged snapshot of a closed promotion is eligible, subject to fresh
PR, owner and alias checks. A reopened or replacement PR protects the branch.

Closed cleanup still inactivates GitHub deployment records after a fresh
closed-state and same-repository branch fence. A reopened PR skips that write.
The normal current-policy draft/ineligibility lifecycle remains separate.

Ordinary prebuilt feature publication requires an open PR before build planning,
upload, immutable acceptance, alias publication and final success. A late upload
after close is removed through the same exact-ID cleanup. Stable publication
remains exempt from that feature-branch PR requirement.

All three preview publishers admit the exact immutable source only when it
contains Mongo's pre-connect authority fence, gateway ingress middleware,
authority implementation and explicit connection policy. Uploading gateway
metadata cannot make an older source bundle compatible. This is a compatibility
check, not a security sandbox for hostile source or a live pool measurement.
The existing explicit `dedicated` branch opt-in remains supported; missing source
never falls back to dedicated access.

## Verification and evidence boundaries

- The full Node suite passed 266 tests before the final published-alias guard;
  the final guard and affected retention/deployment boundaries passed 57 tests.
- Develop publisher self-test: 318/318; admin publisher self-test passed.
- Routing, workflow, branch build, Feature Stack plan/progress, sync merger,
  credential classifier, Electron release and archive extractor self-tests passed.
- JavaScript syntax, workflow YAML parsing and diff hygiene passed.
- Current `origin/main` source passed gateway compatibility admission.
- Graphify was semantically refreshed through the local Codex proxy. Changed
  source and docs appear in the graph and manifest. The upstream extractor
  reported one edge missing a relation; generated outputs remain usable.
- Older generated snapshots were pruned through the repository wrapper's normal
  single-active-snapshot policy; the large generated deletion count is unrelated
  to application source removal.
- Local fixtures and source checks do not prove live controller cleanup,
  production acceptance or Mongo connection reduction. No live Vercel mutation
  was performed by this controller worktree. Parent-run cleanup is separate.

## Saved retention policy

The user's added admin-settings scope is consumed through the product's
`api.integration-ci-preview-retention` 1.0.0 POST operation. The selected origin
(default `https://thingtime.com`) receives only repository, protected
`github-actions` ref and ISO request time, signed with the existing CI router
secret. The product owns defaults and persistence; the controller rejects absent,
invalid or unavailable policy rather than creating a parallel policy source.

Disabled/grace-retained previews are not marked removed/inactive. Optional
superseded pruning waits for replacement age and preserves newest READY live-head
previews. Inactivity is an explicit opt-in using fresh `updated_at`: previews may
expire without closing the PR, recovery/publication stop until activity resumes,
and expiration avoids comments/labels that would reset its own activity clock.
Policy is refreshed at destructive and publication activity fences. All automatic
deployment cleanup, including disabled admin lanes and superseded publication,
uses the shared guarded policy path. The only publisher alias deletions left
are existing rollback operations scoped to their own attempted alias binding.

## Activation and remaining acceptance

Deploy and verify the product policy endpoint/capability first, then merge only
into `github-actions`. Stable production/develop/staging publication remains
independent of policy API availability. The existing default-branch thin listener calls
`lopugit/thingtime/.github/workflows/develop-pr-preview.yml@github-actions`,
including PR `closed` events and `17 */6 * * *`. No new main listener, secret,
cron job or product deployment is needed. Existing already-running controller
jobs can still execute their previous checked-out implementation.

For on-demand acceptance, run
`gh workflow run develop-pr-preview.yml --repo lopugit/thingtime --ref main -f pr_number=0`.
This existing-listener mode requires the allowlisted triggering actor's current
write/admin permission, performs no build and reads the signed canonical policy.
No local retrieval of CI secrets is needed or permitted by this workflow.

After activation, run the existing controller, check each removed deployment's
provider 404 and immutable URL, repeat for idempotence, confirm unchanged
production/develop/staging/master aliases, and exercise PR closure during upload.
Preserve unknown resources rather than weakening guards to obtain a clean run.
The provider checks cannot form a cross-provider atomic transaction; subsequent
sweeps reconcile a concurrent late upload.

## Parent-reported one-time operational cleanup

The task's separately authorized one-time removal and final independent provider
readback are recorded in [the sanitized operational evidence](evidence/1294-preview-cleanup-2026-10-30.json).
Parent-reported final readback records 399 unique deleted deployments, a fresh
inventory reduction from 688 to 289, unchanged stable aliases and four
representative immutable URLs returning 404. All 67 retained ordinary open-PR
manifests still advertise gateway descriptors: 52 at 1.1.0, 12 at 1.2.0 and
three at 1.0.1. Production, develop and preview-master health reported connected
at 21:06:10 UTC. Atlas global connection totals and alert state remain unknown
because the signed-in account lacks project membership.

That evidence describes the parent-run operation; it does not establish that
this new controller or the not-yet-deployed saved-policy endpoint ran in
production. No credential, raw provider response or private connection material
belongs in this evidence.
