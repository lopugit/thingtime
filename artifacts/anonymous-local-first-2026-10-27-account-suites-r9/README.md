# Complete native account-suite acceptance — 27 October 2026

The normal browser flow passed against the real built Thingtime application and
a disposable account in a real Mongo replica set. This is local native-browser
acceptance; CI, deployed gateway and installed-device results remain separate.
`source.json` pins the application package and every changed source file.

The test installs a bundled suite in two concurrent offline tabs on a device
that has not cached its existing customized account definitions. Both Install
controls converge on one durable local graph and request. Run example, normal
editing/save, rename and cold reload work offline without account mutations.

After reconnect, the graph adopts canonical IDs without duplicate definitions.
Unrelated account customization survives. Overlapping edits require an explicit
comparison; the reviewed device version syncs, and the old provisional Component
URL remains editable after cold reload.

A separately authenticated browser context then changes the same account
version while the original context's actual transport remains offline. The
second real conditional-write conflict can restore the preserved original
device version with its exact private audience. The saved example still runs,
and the original provisional page URL renders after reload.

All five captured states pass at 1440×1000, 390×844 and 320×844 CSS pixels.
Visible page and comparison-pane scroll endpoints are measured; there is no
horizontal overflow. Narrow conflict rows stack their button below readable
text. The phone conflict captures retain the application's transient rename
notification; they are actual application screenshots, not cleaned mockups.

Evidence is in `suites-ui/verification.json`, `independent-control.json`,
`canonical-edit-ready-online.json`, `canonical-edit-ready-offline.json`, the
scroll/view-ready records, PNGs and `test.log`.
The original runtime retained network-none enforcement, read-only filesystem,
no host mounts/published ports and unchanged 4 GiB / one-CPU limits. Browser and
backend egress probes failed as expected. No page errors or OOM events occurred;
`cleanup.json` reports no remaining task runtime.

Two real defects found during earlier attempts are fixed with regressions:

1. Component catalogue reads now resolve the old family ID through this
   workspace's canonical alias before local and remote lookup.
2. Explicit preserved-version recovery may supersede a settled 409's retained
   frozen request after fresh remote/local revision and journal checks. Active
   claims and uncertain retries remain protected; automatic retries keep their
   original operation and body.

The earlier retries are retained as failures. Retry8 disconnected before the
menu's asynchronous ownership read settled; retry9 requires exact canonical
ownership, synced local state and a stable enabled menu before disconnection,
then independently requires normal editing to work while genuinely offline.
It does not bypass disabled controls or retry an uncertain mutation.

The final sanitized client/server build passes. TypeScript retains the same 91
baseline diagnostics, with no additions or removals. The latest focused
sync/reconciliation regression run passes 39 tests; capability registry coverage
passes 82. The earlier broader local-workspace run passed 886 with 101 explicit
skips, plus four offline-shell tests. Server acceptance is documented in the
[suite API evidence](../anonymous-local-first-2026-10-27-account-suites/README.md).

No existing account, public content, shared proxy/key, deployment or primary
branch was changed by this acceptance run. Wider Character, account/origin/plane,
managed-adapter and installed-device matrices remain open.
