# Commander Thingtime login callback registration

PR: https://github.com/lopugit/thingtime/pull/1044

## Problem and correction

The production app rejects Commander's native callback but accepts its existing
loopback callback. The client now negotiates the selected origin's OAuth features
and exact callback registration before opening authorization. It uses loopback
only after an explicit unregistered-native response and successful loopback check.
Transport failures, suspension and incompatible features fail closed.

Pending PKCE state binds the original origin, client and callback and rejects
expiry, replay and settings changes. Token requests reject redirects. No server
allowlist is broadened and no production registration is changed.

Commander also exposes a capability manifest generated from its HTTP dispatch
registry. The UI negotiates the verified-login contract before the login POST.
The registry includes native, callback, health and static operations.

## Verification

- Canonical `Commander/script/build_and_run.sh --prepare`: TypeScript checks,
  JavaScript suites, Rust suites, 43 Swift tests and release build passed.
- Regression coverage includes native preference, registered loopback fallback,
  denied/failed registration, origin/client/callback mismatch, replay and expiry,
  manifest route coverage, and incompatible manifests preventing login POSTs.
- Developer ID signed/notarized installed candidate completed real production
  authorization; the browser success page and Commander both reported `@lopu`.
  The account remained active after quitting and relaunching the installed app.
- The final contract-inclusive signed package and installed-manifest smoke are
  recorded in the PR delivery checks. No privacy permissions or app data reset.

Graph refresh uses the repo's immutable snapshot workflow. Existing semantic
cache warnings and hollow extraction responses limit non-code indexing; these
are not represented as a fully clean semantic analysis.
