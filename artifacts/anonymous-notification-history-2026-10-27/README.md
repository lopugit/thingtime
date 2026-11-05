# Notification history acceptance — 27 October 2026

Status: scoped local native acceptance passed. This directory is the stable evidence index; it does not claim the full local-workspace goal is complete.

The changes retain exact account history queries and cursors, preserve device messages through reconnect failures, retry using the original immutable event identity, notify other tabs, and retire cached account projections when access is refused. A scoped refusal marker prevents cache reuse even when IndexedDB cleanup fails; it is not proof of physical erasure.

## Native attempts retained

All attempts use synthetic accounts and private fixtures in a task-owned network-none runtime, a real built app and MongoDB, and sandboxed Chromium. Each attempt records network checks and verified release with no owned runtime remaining. No existing account or shared service is used.

- `history/`: anonymous passed; account setup failed before acceptance because registration alone did not establish the fixture's authenticated requests.
- `../anonymous-notification-history-2026-10-27-r2/history/`: anonymous passed; account fixture still failed with APIRequestContext authentication. The fixture now signs in and uses ordinary same-origin browser fetch, without reading or injecting credentials/cookies.
- `../anonymous-notification-history-2026-10-27-r3/history/`: anonymous passed; native account acceptance exposed a real busy-state race when an invalidation replaces a pagination request. First-page refresh now clears the superseded pagination state.
- `../anonymous-notification-history-2026-10-27-r4/history/`: anonymous passed; the fixture incorrectly waited for a transient Reconnect control that normal account revalidation had already removed. It now observes completion of the automatic retry.
- `../anonymous-notification-history-2026-10-27-r5/history/`: anonymous passed; delayed-query acceptance failed because the newer query was not dispatched. Review found URL echo could overwrite newer search input. The failure screenshot was captured after teardown released a held 403 response and is not evidence of premature refusal.

- `../anonymous-notification-history-2026-10-27-r6/history/`: anonymous passed; delayed search, stale success/refusal and pagination invalidation passed before cold offline reload selected device history incorrectly. Account view availability now follows the selected scoped workspace; remote reads still require a verified login. Ten relevant source maps match archive `d86c5b492031e16573d680965c0121e9c10deac7974f228763ce8c57073b2f78`.

- `../anonymous-notification-history-2026-10-27-r7/history/`: both native tests passed, including exact saved pagination, cold offline account view, late response/refusal, failed cache deletion, cross-tab retirement and account switching. Desktop/390/320px full traversal passed; visual inspection found optional floating controls covering phone filters. The final clearance/hit-target follow-up is in progress.

Core native account and mobile-control acceptance pass. The accepted final run is [r9](../anonymous-notification-history-2026-10-27-r9/history/verification.json): two tests passed, zero skips, zero page errors, zero OOM, and no owned runtime remains. It adds full scrolling and visible-control hit tests at 1440×1000, 390×844 and 320×844, plus normal DevKit open/close/drag checks. The existing clearance behavior hides floating shortcuts over phone filters; the wrapper also suppresses a child icon transition that otherwise briefly remained visible. r8 passed functional/hit-target checks before that visual correction.

- [Desktop PNG](../anonymous-notification-history-2026-10-27-r9/history/account-history-1440.png)
- [390px PNG](../anonymous-notification-history-2026-10-27-r9/history/account-history-390.png)
- [320px PNG](../anonymous-notification-history-2026-10-27-r9/history/account-history-320.png)
- [Build/source parity](../anonymous-notification-history-2026-10-27-r9/history/source-parity.json)

The final archive SHA-256 is `e51db3c5a646432851e0687388f0d407b20119ad6d3483d620c6fe808750b3eb`; all twelve reviewed module sources match packaged source maps. Focused tests pass 27/27; notification suites pass 52/52 and 12/12. These overlap and are not a unique-test sum. Changed-source lint passes; full TypeScript diagnostics retain the same 91 normalized baseline errors. The final opacity-only adjustment was linted and exercised in the complete native run. Build configuration restoration is verified.

Canonical opt-in fixtures are `remix/app/local-workspace/notifications.browser.test.ts` and `accountNotificationHistory.browser.test.ts`. They require the documented isolated runtime URL, sandboxed browser path and matching session; they do not target a deployed account. Use the existing agent-browser test environment and a sanitized full build, as in prior PR evidence. No production account/data or shared proxy/key/service/VM was changed.

Graph refresh uses structural extraction only because this task may not use the shared semantic proxy. New prose/image contents are not claimed as semantically indexed. Unit tests, local native execution, CI and hosted functional acceptance are separate evidence scopes. Wider real social history and automation scenarios remain open.


The updated [progress plan](../../docs/progress/anonymous-local-first.html) passes its own isolated desktop/390/320px full-scroll, filter, search and overflow checks: 89 rows, 65 done, 22 partial and 2 planned. Its runtime was released. New branch CI/preview checks remain separate from these local results.
