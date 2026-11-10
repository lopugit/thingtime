# Responsive UI and device feed acceptance

The final native full-app fixture passed on immutable Linux package `e7427480e802ad274df4f1167443702e7e9534f2f05bc340a79691b513e9970c` in a fresh isolated workspace: 1 pass, zero failures or skips. See `acceptance.log`, `build.json`, `isolation-verification.json`, and `final/verification.json`. This is Linux full-app evidence; the installed Mac app was unavailable.

- 1440, 390, and 320 px: recovery notice below navigation; real failed Retry and recovery after the resolver returns; active composer button hit targets; private/inherited/public generic Thing labels; post/comment/nested/public permalinks; cold offline device feed with explicit partial-coverage notice.
- Both phone widths exercised a real assistant/active-composer collision and hid the shortcut while the Send target remained reachable. The collapsed composer trigger also exercised a real collision at 320 px and remained reachable with the shortcut hidden.
- Three private reads each from guest and foreign accounts stayed 404; public control stayed readable. No page errors or crashes.
- `finalMemory.events` contains `oom_kill 0`; these cgroup counters cover the managed workspace, not just this fixture.

Visual review of the previous passing package found that the collapsed feed composer trigger still shared the launcher area at 320 px. The follow-up adds the same clearance marker to that trigger and expands the native fixture assertion. `before-collapsed-trigger-fix` retains that package's verification, matching screenshot, log and fingerprints; the final screenshot shows the corrected trigger.

`earlier-attempts/classification.json` classifies provisional environment and fixture failures. Each browser failure retains its matching run-ID JSON and screenshot; the registration-rate-limit failure happened before browser product checks and has only a log. Limits were not changed or bypassed. The failure screenshot SHA-256 values match their corresponding reports.

The device feed is explicitly partial: local/retained root posts, chronological pages with local algorithm ranking and supported local filters. Membership-scoped, community/trending/nearby requests require a connection. Online cursors never silently become local cursors, authentication/authorization/not-found failures do not fall back, and account reads recheck known refusals immediately before returning.
