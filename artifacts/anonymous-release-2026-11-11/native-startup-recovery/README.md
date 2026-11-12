# Actual native bundle startup and recovery — 11 November 2026

[verification.json](verification.json) records the actual retained development
app at `~/Applications/Thingtime Dev native-bundle-qa-pr1000.app`. The stable
Thingtime app, production data and credentials were not used or replaced.

A synthetic Ed25519 authority exists only for this test. The real built web/Nitro
payload was independently staged as release sequence 1. The app loaded that
candidate, served its real capability manifest and acknowledged a committed
React application before persisting confirmation. [Confirmed app](confirmed-update.png).

Sequence 2 contains an intentionally throwing server entry and a valid test
signature. The app exited and the development supervisor started a fresh process.
That process rejected the unconfirmed trial and loaded the retained working
release. The local origin stayed the same, the sequence floor stayed at 2 and
the bad release was recorded as failed. [Recovered app](recovered-update.png).
Both screenshots show the actual unlogged-in Thingtime application.

The real React Router error-boundary fixture runs in a separate isolated
Chromium process. Its healthy render acknowledges once; an actual render exception
acknowledges zero times even though recovery DOM exists and `router.state.errors`
is null. Electron itself refuses CDP browser-context creation, so these two
fixture cases are not mislabelled as separate Electron contexts.

The earlier [failed rollback receipt](../native-startup-final/verification.json)
exposed a real startup bug: recovery called the account-change restart path before
a page origin/password session existed. The fix gives same-authority bundle
recovery its own process relaunch while ordinary account changes still await
password disconnect and all launches retain existing before-quit cleanup.
The [missing-browser refusal](../native-startup-invalid-browser/verification.json)
proves explicit failed status and cleanup without changing the task's trust policy.

All seven recorded runtime source hashes still matched after acceptance. Cleanup
completed before the successful receipt was written: task processes stopped,
test cache removed and the original shipped trust policy restored. The separate
development app/profile are retained for continued testing. Temporary successful
payload copies were removed.

This does not prove release API delivery, production trust provisioning,
unsaved-work-aware activation, offline data parity, power-loss durability,
a frozen-process watchdog, stable signed distribution or iOS operation.
