# Native post deletion and narrow-layout acceptance — 27 October 2026

Status: scoped native deletion and quote-layout acceptance passed on the final built package. This does not close the wider local-workspace goal.

## Behavior and fixes

The normal PostCard Delete control already uses the canonical anonymous/account writers. No deletion endpoint or replacement UI was added. Anonymous deletion removes its post, comments, media records and bytes locally. Account deletion commits a local tombstone and synchronizes independently; a never-sent post/media creation is cancelled without a server create.

A real gap remained: a stale online feed response could show a locally deleted post before the server acknowledged deletion. Account projections now consult the existing scoped deletion snapshot and prune deleted conversation descendants. Raw Thing shapes are preserved. Review also found duplicate shallow/rich projections could hide descendant IDs from the snapshot. Object traversal now visits each projection independently while deduplicating IDs; regressions preserve raw shapes and reject empty/nonempty replies arriving after account retirement.

Native visual review found a closed quote popover contributing a 260px invisible absolute box to the action row. At 320px, the hidden ancestor could scroll horizontally and clip the post while the header stayed fixed. The existing quote PopoverContent now uses Chakra Portal. The gallery itself already shrank correctly; no gallery workaround was added. A separate reopen failure exposed stale absolute menu placement after document scrolling; the Repost menu now uses fixed positioning in a Portal while retaining normal viewport flip/overflow handling. The unchanged click sequence passes at 1440/390/320px, including fully settled screenshots and control hit tests. The exact scroll caller in earlier failures remains unproven; fixed positioning removes the stale absolute placement observed around that scroll.

## Retained attempts

All browser attempts use private synthetic fixtures, the real built application and MongoDB, sandboxed Chromium and a task-owned network-none runtime. Network and cleanup records accompany each run. No real account, shared service, VM setting or production persistence is used.

| Attempt | Result / evidence boundary |
| --- | --- |
| r1–r4 | Fixture corrections: actual submit label, post-route selection, duplicate text selector and transient toast after navigation. These failed attempts do not establish product failures. |
| r5–r6 | Account fixture read before normal post/comment synchronization completed. |
| r7 | The initial 40-second observation expired before queue recovery. No persistent scheduler defect was proven. |
| [r8](../anonymous-post-delete-2026-10-27-r8/post-delete/verification.json) | One test passed in 107.48 seconds: anonymous removal, account lost-reply recovery and never-sent cancellation. Predates the native held-feed regression. |
| r9 | The second browser tab had not been explicitly brought online through its own CDP session. It showed cached offline Feed; the fixture was corrected. |
| [r10](../anonymous-post-delete-2026-10-27-r10/post-delete/verification.json) | One test passed in 67.87 seconds. The actual HTTP 200 Feed still contained the deleted parent while DELETE was held before execution, but only the unrelated retained post rendered. Parent/comment server reads then returned 404 and both tombstones settled. Nine desktop/390/320 menu checks passed. Subsequent visual review found hidden inner horizontal scrolling; this run is not final layout acceptance. |
| visual-r1–r3 | Diagnosis isolated the closed quote popover. [Measured inner widths and forced hidden scrolling](../anonymous-post-delete-2026-10-27-visual-r3/post-delete/layout-measurements.json) reproduce the clipping independently of page scrollWidth. |
| r11–r12 | Invalid for final acceptance: shared-VM OOM killed the browser before account quote checks. Cgroup max/oom counters stayed zero but oom_kill increased. Both owned runtimes were released. No shared runtime or VM settings were changed. |
| [r13-anonymous](../anonymous-post-delete-2026-10-27-r13-anonymous/post-delete/verification.json) | Fresh anonymous-only runtime passed, one test/no skips in 9.48 seconds, exact record/byte removal and cold reload, zero HTTP mutations and zero OOM. |
| r14-account | Fresh account-only runtime had no OOM. First quote open, focus and Escape passed at 1440px; second open timed out with the Repost menu still visible. Transition/fixture versus product cause remains under investigation. Narrow open/closed quote acceptance is pending. |
| r15-account | Reviewed package `77c59e73` reproduces the second-open failure without OOM. Pointer-down/focus reached Quote post but its click was not captured; full pointer-up/target geometry diagnosis follows. The exact executed MJS and hash are retained. |
| r16-account | Full pointer telemetry shows a 132px menu placement flip between pointer-down/up, causing the click to land underneath. Document scroll is unchanged during that short interval; preceding scroll is a separate part of the diagnosis. |
| r17-account | Portaling the menu alone does not resolve the failure. Earlier events show document scroll changes before pointer-down; stale absolute bottom placement then recomputes to top before release. The precise scroll caller remains unproven. The next candidate uses supported fixed positioning with normal viewport flip/overflow handling. |
| r18-account | Fixed Repost positioning passes all desktop/390/320 quote open/Escape/focus/reopen/outside-close and inner-width/mutation checks. The later deletion assertion fails because the fixture went offline while its child CREATE was still syncing and before the parent basis refreshed. Child creation changes the canonical parent version; the stale parent DELETE correctly conflicts. Screenshot capture is also refined to await the complete JS-driven entry/exit presentation before visual acceptance. |
| [r19-account](../anonymous-post-delete-2026-10-27-r19-account/post-delete/acceptance-summary.json) | Final package: one pass, zero skips in 38.85 seconds. Exact canonical parent basis is retained before offline work. Both saved and pending-media quote controls pass all three sizes; held-feed masking, lost-reply recovery, exact parent/comment server absence, settled tombstones and never-sent media cancellation all pass. |
| [r20-anonymous](../anonymous-post-delete-2026-10-27-r20-anonymous/post-delete/verification.json) | Same final package: one pass, zero skips in 9.36 seconds. Exact post/comment/media-record/byte removal survives cold reload, with zero HTTP mutations. |

Final runs have zero page errors/OOM and no owned runtime remaining. Their exact executed fixture MJS, fixture hash and 19-module package/source-map proofs are retained. Parent review inspected desktop and 390px open quotes plus 320px pending-media open/closed screenshots: opaque settled content, no left clipping or ghost menu text. The fixture records twelve settled quote opens across the saved/pending cases, control center hit targets, vertical/horizontal viewport fit and zero hidden scroll offsets. No quote is submitted.

- [Desktop quote](../anonymous-post-delete-2026-10-27-r19-account/post-delete/account-quote-open-1440.png)
- [390px quote](../anonymous-post-delete-2026-10-27-r19-account/post-delete/account-quote-open-390.png)
- [320px pending-media quote](../anonymous-post-delete-2026-10-27-r19-account/post-delete/pending-quote-open-320.png)
- [320px closed presentation](../anonymous-post-delete-2026-10-27-r19-account/post-delete/pending-quote-closed-320.png)
- [Canonical readiness basis](../anonymous-post-delete-2026-10-27-r19-account/post-delete/pre-offline-canonical-basis.json)

Each attempt retains its own logs, screenshots and cleanup result in the sibling directory bearing that attempt suffix. Separate phase runs retain every assertion; the runner does not automatically weaken isolation or retry a crashed runtime.

## Verification boundary

The last complete client/template/server build passed and restored worktree dotenv files. Current package SHA-256 `e5ca5891e959085e7add481841f21f662bdce8da8dfa9649d11aba227a88ba12` contains 19 exact reviewed source-map matches. It includes portaled quote/menu content, fixed Repost menu positioning, duplicate-projection traversal and empty-response retirement. Earlier r13/r14 used `6ab7c417831116718c2c36627beaf0d675d46ceba8f85bed3d284710e32bf506`; the final account and anonymous runs both use the current `e5ca5891` package. Typecheck exits 2 with exactly the same 91 normalized baseline diagnostics, none added/removed; this is not a clean typecheck. Account API tests passed 11/11 after both review fixes, and targeted lint passed. Their retained logs are [tests](accountApi-tests.log) and [lint](accountApi-lint.log). The earlier first-pass worker checks did not retain raw logs. A separate [account synchronization regression suite](accountSync-tests.log) passes 26/26: a stale parent basis conflicts, explicit normal refresh permits child/parent deletion, and a genuine later parent edit still conflicts. No queue source, rebase rule or API contract was changed for the r18 fixture correction.

Prior pushed `5c6d6df8d1760b8102cfbc68d57363022101b230` passed [Web CI](https://github.com/lopugit/thingtime/actions/runs/40423330932) and [CodeQL](https://github.com/lopugit/thingtime/actions/runs/40423920655). Its [immutable preview](https://thingtime-c6t70dcoz-lopugits-projects.vercel.app) and PR alias serve the shell/assets/origin-scoped manifest; deployment metadata establishes source association. Those public HTTP checks do not prove deployed functional behavior or this uncommitted follow-up.

Remaining scope: linked-Thing surfaces, wider bound-file reconciliation, origin/plane/Character and cross-account/device coverage, installed-app acceptance and deployed functional acceptance. The original no-login native MCP render/export evidence and post/draft independence evidence remain separate.

## Reproduction entry point

`remix/app/local-workspace/postDelete.browser.test.ts` is opt-in. Run it only inside the documented disposable agent-test runtime with a loopback `TT_POST_DELETE_ORIGIN`, its matching `TT_POST_DELETE_SESSION`, a writable `TT_POST_DELETE_ARTIFACTS` directory and the runtime-provided `TT_SHARED_PLAYWRIGHT_PATH` / `TT_SHARED_CHROME_PATH`. It checks the server health session and launches sandboxed Chromium. `TT_POST_DELETE_PHASE` accepts `anonymous`, `account` or `combined`; separate fresh runtimes are useful under constrained memory. These inputs do not replace the allocator's enforced browser/backend network boundary. Missing required fixture inputs skip the test; a skip is not acceptance.

Graph refresh for this follow-up is structural only. The shared LLM proxy/key/service and VM configuration remain unchanged; prose was not semantically reindexed. Hosted head checks are tracked in PR #1000 separately from this local evidence.
