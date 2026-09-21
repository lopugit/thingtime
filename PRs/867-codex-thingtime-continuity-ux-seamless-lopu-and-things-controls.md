# PR 867 — Seamless Lopu and Things controls

PR: https://github.com/lopugit/thingtime/pull/867

Target: `main`. Branch: `codex/thingtime-continuity-ux`.

## Result

This change handles the 21 requested continuity, navigation, Builder and Things
improvements as one integrated release.

- Lopu manual/automatic continuation uses explicit hidden continuation metadata
  instead of visible synthetic user messages. Reload and periodic recovery only
  resume saved safe checkpoints. Stop, pending confirmations, unsaved edits and
  ambiguous tool completion remain hard boundaries.
- The send menu and chat settings choose local or Vercel management. The existing
  Workflow SDK runs server continuations with revocable session authority,
  deterministic part identities, bounded retries, one active root and aggregated
  task presentation. Custom MongoDB sessions retain local management.
- iOS presents one aggregate Live Activity for active chats, with generic status
  and counts. Session/origin/data-source fencing and APNs updates preserve privacy.
  Live Activities do not prevent iOS suspension; Vercel management keeps the work
  running independently of the app.
- Builder page/component lists and page controls reuse shared privacy, transfer,
  export/download, import, copy/cut, share, rename and private-duplicate actions.
  Public page views no longer expose floating editing controls. The redundant
  Go to page action is removed from the editor.
- One collapsed search icon opens a combined Commander for shortcuts, recents,
  remote search, paths/setters and commands. Admin sits directly beneath Dev and
  remains admin-only; paint controls appear only on relevant editor routes.
- Fresh action-run notification settings default off while saved choices remain.
  Anonymous exact-link previews retain authorized unlisted post context and
  noindex; private content remains generic.
- Things use the shared post discussion UI with the original relationship ID,
  nested replies, reactions and rich composer. Posts/comments can attach several
  existing Things through search and folders with Data/Interactive choices;
  every projection rechecks reader access.
- Explicit legacy data folders participate in navigation and safe moves. Plain
  click opens; modifiers/checkboxes select. Each folder column/tree depth ends in
  New folder +. The page cog contains view/options/error logs. Data starts folded,
  scalar previews preserve null/false/zero/empty strings, and Rename preserves
  payloads and permissions, including protected library kinds.

## Contracts and safeguards

Both capability manifests, route documentation and dependent client requirements
are updated. The new Live Activity endpoint is registered through the canonical
route map. Server continuation grants stay protected, expire with the live user
session, and are removed after terminal/admission failure. Uncertain tool work is
never replayed automatically. Protected library renames accept only display title
metadata and preserve owner, namespace, quota, transaction and stale-write checks.

The Nitro build now retains both client-shell and client asset registrations.
Graphify private working copies become writable without changing immutable
source snapshots, fixing refreshes that failed with permission denied.

## Validation

- Lopu: 273 tests; UI/store/presentation: 201 tests after the draft-management and
  popup-layering fixes. Focused Things/post/rename checks: 126 tests.
- Webpage suite: 102 passed, two optional integration checks skipped. Commander:
  26; social previews: 42; capability suites: 73; Graphify wrapper: 22.
- Native iPhone 17 Pro simulator build/run and tests: 63 passed, one ActivityKit
  request skipped by the unsigned simulator; seven deterministic lifecycle and
  privacy cases passed. Native/web activity API checks: 27 passed.
- Chrome at 1440×1000 and 390×844: Commander, Builder lists/editor dialogs,
  Things grid/columns/nested folders, scalar previews, shared rich comments and
  attachments, chat-management menus and background-task filters. Checked page
  bottoms and opened overlays. Browser QA caught and fixed draft settings,
  overlay stacking, component links and first-paint account isolation.
- Real local API: private rename and duplicate retain their ACL, nested folders
  reject cycles, protected rename preserves tokens and rejects stale/extra
  fields, shared replies retain parent identity, and revoked/private linked
  Things disappear from projections. A rich comment with multiple Thing modes
  was submitted through the real UI and read back.
- Anonymous unlisted fixture HTML exposes its title/excerpt with noindex; its
  generated 1200×630 PNG was downloaded and visually checked. Existing share-app
  caches were not claimed to have refreshed.
- Production build and Vercel output verification passed. Both built manifest
  handlers return the expected feature versions without a fallback proxy.
  Changed-surface lint reports zero errors (59 warnings, mainly existing hooks).
- Graphify refreshed code and semantic documentation through the local proxy,
  regenerated its report and portable HTML, and verified its hooks/merge driver.
  All new production paths are indexed; this Graphify release does not index
  `.mts` test files. The tests themselves ran through their canonical commands.
- QA cleanup retained all test objects privately: all 13 known fixtures reject
  anonymous reads; none were permanently deleted.

## Remaining acceptance limits

- The fresh QA account is invite-gated, so live provider execution and a real
  deployed Vercel continuation were not exercised. Mocked workflow/admission,
  stop/recovery and contract tests passed. Vercel Workflow must be enabled for
  the chosen project; there is no new provider credential requirement.
- Physical lock-screen/Dynamic Island updates and APNs while suspended require a
  signed device build and the existing private APNs configuration. No TestFlight
  upload is included.
- Full TypeScript verification reports 115 diagnostics versus 116 in a clean
  extraction of base `9c0f4ea17` using the same compiler and dependencies. Matching
  file, error code, message, column and source line found zero introduced errors;
  the removed error is Nitro's duplicate serverAssets property. The checked-in
  ratchet value of 108 is already stale on the base and was not changed.
- Local QA uses http://localhost:19940, HMR 19941, Nitro 19942 and the isolated
  `tt-wt-continuity-19940` PM2 entry. No Funnel URL is available: the installed
  Tailscale launcher references a missing application executable.

CI, the exact branch preview and the final build result are recorded on the PR.
The owner explicitly authorized merging this PR into `main` after pre-merge verification on 2026-09-21. Production acceptance is recorded on the PR after merge.

## Pre-merge review (2026-09-21)

Integrated `main` through `50dd31b7b`, retaining the new remote integration
catalog, functional native component controls, mobile sign-in clearance and
admin catalog importer. Preserved both sides of documentation and capability
coverage; regenerated the graph as one consistent snapshot.

A fresh continuation review identified abandoned child tasks that could remain
running after a workflow ended, and admission failures that could leave an
unstarted workflow claim. These paths now use explicit terminal reconciliation
without replaying uncertain tool work. Regression results and the final head
are recorded on the PR before the authorized merge.

The combined build and Vercel output verification passed. Fresh browser-independent
checks passed: webpage 104 (three optional integration tests skipped), library
nine, Commander 26, navigation 17, social previews 42, notifications 62. Native
simulator build/install/launch and 63 tests passed; one real ActivityKit request
remains skipped on the unsigned simulator. Activity/privacy and drawer checks
passed 19 cases. Real-device and provider-backed acceptance limits above remain.

Read-only attachment registration prevents viewed webpages from capturing Lopu's
build target while retaining interactive controls. Fresh Chrome proof at
1440×1000 and 390×844 covered a real post with an attached page/private contextual
component: its counter incremented, resizing preserved its value, page bottoms
stayed aligned, Thing data began collapsed, and the non-owner menu retained only
read-only actions. Prior private fixtures retained owner access and rejected all
13 anonymous reads. Temporary QA objects are retained privately, not deleted. All 16 retained QA
objects now allow owner reads and reject anonymous reads. The canonical Things
suite includes the protected-rename regressions (275 passed); the feed suite
includes the new attachment-target regression (56 passed).

Cancellation preserves the conversation claim until the executor acknowledges
completion and saves its last output. A timed-out heartbeat alone cannot prove
that an external side effect stopped. Unacknowledged work therefore needs
attention and remains fenced; it is never silently replayed or unlocked. The
local automatic retry budget also survives polling/reload instead of resetting
with each recovery invocation. Explicit manual Continue remains intentional.
