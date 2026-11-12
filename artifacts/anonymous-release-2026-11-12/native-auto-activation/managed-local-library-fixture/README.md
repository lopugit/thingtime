# Library idle-leg correction: frozen, not launched

The first managed-local Home failure remains unchanged and open in
../managed-local-account/verification.json (receipt SHA
aa8f4b8852f299ec66bc6d313a1d3d68e0a6933b22c1b177bb4556ebe74c6ce7).
No runtime/source safety gate was changed. Successful API/draft/active-HTTP
checkpoints from that run remain distinct from unverified automatic replacement.

This fixture-only correction records blocker tag, role, aria-busy and
contenteditable (no private labels/text/values). A passive bounded observer
retains only event kind/trusted/tag and mutation type/allowlisted attribute/tag;
unknown attribute names become 'other', and 512 entries are retained per document.
It writes no DOM, dispatches no event, and never changes idle/persistence state.

For managed-local idle/retention only, ordinary navigation goes to /things.
The actual visible Things settings control must appear, then the complete
read-only unknown-control/media scan must clear before held HTTP work or minimize.
The original Home page is still observed and its automatic-activation acceptance
remains open even if the account-library run passes. Dirty input, Enter,
account-scoped persistence, real active HTTP work, auth/ACL/revision retention,
automatic fresh app/Mongo PID, signature, helper emptiness and cleanup checks remain.

49 focused tests pass, including selector-specific metadata/no-value projection
and passive bounded observer tests. These synthetic controls do not establish
new app acceptance. Syntax and scoped diff checks pass. Exact source and unchanged
ef8123 web payload hashes are in source-freeze.json. No new build, app or helper
operation was run. The previous stopped failed QA profile and verified dev app
were preserved.

Only after the parent says iOS has finished, revalidate source/payload hashes and
run ONCE from the repository root:

```sh
THINGTIME_NATIVE_BUNDLE_QA=1 THINGTIME_NATIVE_LOCAL_BUILD_READY=1 node electron/scripts/verify-web-bundle-auto-activation.mjs --local-api --workspace=native-bundle-qa-auto-local-library-pr1000 --output=artifacts/anonymous-release-2026-11-12/native-auto-activation/managed-local-library '--password-helper-app=/Users/lopu/Applications/Thingtime Dev native-auto-pr1000 Helpers/Thingtime Passwords.app' '--password-fixture-app=/Users/lopu/Applications/Thingtime Dev native-auto-pr1000 Helpers/Thingtime Password Fixture.app' --password-helper-host=com.thingtime.passwords.dev.nativeautopr1000 --password-helper-team=6DQQ9V7C84 '--password-helper-signing-identity=Apple Development: lopudesigns@gmail.com (9BTZ4XB356)'
```

The new workspace/output preserve all prior receipts and profiles. An unresolved
blocker/refusal ends the finite run; no automatic fallback, forced checkpoint,
idle-state mutation or unchanged repeat is allowed.
