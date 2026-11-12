# Proven notification popover owner and bounded lifecycle correction

The unmodified actual NotificationsBell, real Chakra Popover and unchanged
hasUnknownDesktopDraft guard were rendered in isolated Chromium149.0.7827.55.
Before source SHA45d20599ef37100d95d03f8e213235453c502e2b2e83ca0a645ab852f0c76996
produced exactly one hidden SECTION role=dialog, notificationPopover=true,
children0, guard=true while closed. Cold refresh performed list(limit1), not
markRead. This reproduces the authenticated-only blocker seen in both retained
native failure receipts. The historical receipts remain unchanged; no missing
activity trace or unobserved native restart has been invented.

Installed Chakra2.10.10's PopoverContent always renders PopoverTransition;
PopoverTransition uses motion.section; use-popover assigns role=dialog.
isLazy removes children while closed and hides the positioner, retaining that
dialog shell. NotificationsBell now mounts content only when open. The badge
and notification state remain in the parent. Open panels retain the existing
guard; closed panels leave no dialog. Escape returns focus before unmount,
except during IME composition; outside clicks retain their own focus target.

The actual component browser regression passes3/3 with synthetic account/API
and avatar dependency. The bell, Chakra, NotificationRow and native guard are
real. Desktop1440 and mobile390 opened/closed states, panel and page bottom
scroll/nooverflow, keyboard open/Escape, outside focus, deferred cached refresh
and identity withdrawal pass. Screenshots are in ../dialog-owner-after.
The focused native/helper/activation regression batch passes50/50 and focused
lint passes. The missing-root observer regression first failed against the
original helper, then passed after observing Document rather than its possibly
absent documentElement. Actual Chromium init-script observation now records
mutations. This observer remains diagnostic-only and performs no DOM writes.

UI/UX Pro Max focus guidance was applied. Inspo returned an inbox reference
(Novu), with no verified closed-popover lifecycle pattern; existing Thingtime
styling was retained. No visual redesign or new preference was introduced.

All six final inputs and the unchanged native draft guard hash are recorded in
source-freeze.json. No shared web build or native app run occurred in this
source batch. The existing real-account/profile/stable/helper boundaries remain.
A fresh combined build is required because NotificationsBell is a renderer input.
After the parent supplies that reviewed build and its exact hashes, one new
isolated task workspace/output can use:

```sh
THINGTIME_NATIVE_BUNDLE_QA=1 THINGTIME_NATIVE_LOCAL_BUILD_READY=1 node electron/scripts/verify-web-bundle-auto-activation.mjs --local-api --workspace=native-bundle-qa-auto-local-dialog-pr1000 --output=artifacts/anonymous-release-2026-11-12/native-auto-activation/managed-local-dialog '--password-helper-app=/Users/lopu/Applications/Thingtime Dev native-auto-pr1000 Helpers/Thingtime Passwords.app' '--password-fixture-app=/Users/lopu/Applications/Thingtime Dev native-auto-pr1000 Helpers/Thingtime Password Fixture.app' --password-helper-host=com.thingtime.passwords.dev.nativeautopr1000 --password-helper-team=6DQQ9V7C84 '--password-helper-signing-identity=Apple Development: lopudesigns@gmail.com (9BTZ4XB356)'
```
That future run must observe actual automatic close/relaunch, fresh app and
Mongo PIDs, same account/browser/API sessions/private Thing/revision/edit,
durable editor reload, dirty and real HTTP-work refusal, signed active release,
empty helper group and verified cleanup. It cannot substitute manual restart.
Both original failed profiles and receipts remain preserved. No retry budget
was reset by this isolated component reproduction or source correction.
