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

- The initial fresh QA account was invite-gated. Later authenticated preview
  QA signed in through normal federated authentication, reached a durable Vercel
  Workflow and the selected GPT-5.6 Sol High provider,
  which rejected native tools plus reasoning on Chat Completions. The compatible
  reply 1.14.1 correction uses Responses without lowering effort; successful
  repaired-path live execution and continuation remain pending. Vercel Workflow
  must be enabled for the chosen project; no new provider credential is required.
- Physical lock-screen/Dynamic Island updates and APNs while suspended require a
  signed device build and the existing private APNs configuration. No TestFlight
  upload is included.
- Full TypeScript verification reports 89 diagnostics, matching clean base
  `2cb1eff7a` with the same compiler and dependencies. Matching file, error code,
  message, column and source line found zero introduced errors. The checked-in
  typecheck ratchet is also 89 and passes.
- Local QA uses http://localhost:19940, HMR 19941, Nitro 19942 and the isolated
  `tt-wt-continuity-19940` PM2 entry. No Funnel URL is available: the installed
  Tailscale launcher references a missing application executable.

CI, the exact branch preview and the final build result are recorded on the PR.
The owner explicitly authorized merging this PR into `main` after pre-merge verification on 2026-09-21. Production acceptance is recorded on the PR after merge.

## Pre-merge review (2026-09-21)

Integrated `main` through `f5e3b0cd38`, retaining service workspaces, Vault environments, the remote integration
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
passed 19 cases. These historical checks did not establish real-device or
provider-backed acceptance; current limits and subsequent live findings are
recorded above and in the dated updates below.

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

Final combined validation after the pre-merge fixes: Lopu 300, Lopu UI 202,
chat streaming 29, Things 277, feed 56, webpages 104 (three optional integration
checks skipped), and capability suites 75 all passed. Independent lifecycle
review passed 37 core cases with no remaining finding; the full failure/recovery
regression set passed 52 cases. Production build and Vercel output verification
passed. Full TypeScript comparison remains 115 current versus 116 in clean main
with zero introduced diagnostics. Changed-source lint has zero errors after the
renderer import-order correction.

Main now publishes the prior Things/comment version numbers for workspaces, so
this release advances `api.things` to 1.24.0 and `api.things-comment` to 1.8.0,
with matching client requirements and tests that reject the prior versions. Both
built manifests also preserve main's workspace, Vault and attachment contracts.

Workspace integration preserves contextual discussion descriptions and gates
workspace controls behind the native interactive context. Linked post projections
reuse a request-local viewer for membership caching while authorizing every
source separately. Chrome at 1440×1000 and 390×844 confirmed the static hint in
both inert catalog panes, usable mobile settings, and aligned page bottoms.
All 18 QA fixtures are retained privately, with owner access and anonymous
access denial verified. No permanent fixture deletion was performed.

The later develop promotion was integrated through `2cb1eff7a`. Merge resolution
keeps external posts, inherited audience rules, archive improvements, local
attachment storage and new navigation alongside the continuity/Things work. The
external-source regression confirms one membership lookup for multiple linked
comments, private/protected-source isolation and access revocation after unlink.
The new feature maps now describe the added routes, services, controls and tests.

Final promotion-integrated validation: the complete canonical unit suite passed
3,552 tests with zero failures and six explicit skips across 84 reported groups.
The production/Workflow build and Vercel output verification passed. Changed-source
lint passed with zero errors; full TypeScript matches the 89-diagnostic clean-main
baseline exactly. The 63-pass native simulator result remains applicable because
the native implementation did not change during these web integrations. Exact
head CI, preview and production verification are recorded on the PR.

Main integration through `31bbf2779` preserves PR #875's integration builder
index, provider/example pages, private initial audience and bootstrap capacity
repair. The unified Commander modal retains its compact navigation trigger;
main's long-account-name truncation and builder library links remain in place.
The refreshed production build, Vercel-output verification and TypeScript ratchet
passed (89 existing diagnostics). The complete canonical unit suite passed
3,554 tests with zero failures and six explicit skips after this integration.

The subsequent main release `9672862e4` adds service media refresh after comments
and authorized media on target comment lists. Integration preserves those paths
through the shared post discussion component and retains the Places diagnostic
fixes and visit filtering. Things advances to 1.25.0 so the separately added media
and discussion/reference contracts have distinct negotiated versions. Final
combined-source checks and deployed acceptance are recorded on the PR.

Main integration through `4094a9a15` preserves PR #879's shared list controls,
including paginated and filtered Thing discussions. Authorized older comment
pages retain rich post rows, reactions, nested replies and attached Things through
an optional batched projection; the Things capability advances to 1.27.0.
Acceptance checks cover searching beyond the initial twenty comments, bounded
cursor loading, denied rows, page-size changes and empty filters. The shared
acceptance callback still refreshes service galleries only after a committed
comment. Final combined-source and deployment evidence is recorded on the PR.

Discussion pagination QA: private twenty-five-comment fixture returned twenty plus five unique rows, found an older-page search match, and loaded its nested reply only on expansion. Chrome desktop and 390px checks passed all fixed page sizes, Author filters, empty search, infinite completion and page-bottom layout. The bounded projection omits unloaded replies and unknown totals, preserves bounded legacy comments, and encrypts target/viewer/token-scoped cursor positions so denied hidden IDs never appear in pagination tokens. Canonical Things tests passed 293 cases. Final integrated build and security evidence is recorded on the PR.

The final integration also retains main PRs #880 (library maps/platforms and its isolated SDK CSP) and #878 (remote device file browser). All discussion QA read grants were revoked and read denial was rechecked. Graphify covers the new production paths; its installed detector does not index `.mts` test modules, which are exercised by the canonical test suite.

Integration security review also checks the remote-file byte boundary: generic Thing readers must not expose device-command input or results in place of the dedicated, expiring device result endpoint. A focused regression accompanies this boundary fix.

Main integration through `a410951b9` retains PR #881’s macOS heartbeat fix for unnamed applications; its focused native tests passed 8 cases. The discussion pager’s seven synthetic cursor fixtures now use clearly labelled `test-page` values, preserving punctuation, ordering and opaque forwarding coverage; all 10 focused pager tests passed. GitGuardian incident 37494924 was confirmed to concern the exact historical synthetic literal and classified as a false positive, not a secret. Final-head CI and deployment verification are recorded on the PR.

Authenticated provider QA (2026-09-22): a harmless Vercel-managed reply on preview head `632b9a7cb` reached GPT-5.6 Sol High and failed with the provider’s explicit unsupported-tools/reasoning response. This is a transport compatibility failure, not evidence of invalid credentials or exhausted credits. Reply capability 1.14.1 corrects the exact native-tool model path using Responses while preserving effort, speed, tool permissions and checkpoint rules; provider conversation storage remains disabled. Existing 1.14.0 client minimums remain valid because the public request/event contract is unchanged. Repeat a live read-only tool hop and server-managed reload on the repaired preview before claiming end-to-end acceptance.

Provider repair validation: the complete canonical unit suite passed 3,659 tests with zero failures and six explicit skips; production/Workflow build, Vercel output verification and both built manifests (27 contracts) passed. The TypeScript ratchet remains at 89 existing diagnostics; provider/contract source lint has zero errors. Independent review also reproduced a streamed-versus-completed tool identity mismatch; the adapter rejects inconsistent identities before dispatch and preserves earlier receipts across later-hop failures. Final focused regression counts, exact-head CI and repaired-path live acceptance are recorded on the PR.
