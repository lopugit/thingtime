# Vault queue status and identity verification — 27 October 2026

Pending device changes were labelled as empty before their asynchronous reads completed, and a failed read could silently preserve that false-clean message. The status now distinguishes unknown and unavailable queue reads, retains previously known rows, and offers the existing refresh action for retry. A different vault or canonical account scope clears the previous presentation before commit; equivalent scope objects preserve the child form. Generation fences reject late results and errors. Authentication and synchronization permissions are unchanged.

## Verification

- Fresh sanitized complete client/server build passed; configuration files restored. `package-and-source-parity.json` records archive SHA `06813fecb5d3948e25170bcacb86cc88264085fd9698ae085dc7b3b0eeb2094a` and thirteen exact packaged source matches.
- Normal Passwords UI with real disposable isolated accounts/API: **1 passed**, no failures/skips. Held root identity clearing, retired encrypted save, cold offline edit, canonical revision 1→2, unchanged other account, globally-owned ID refusal, masked fields and dialog keyboard behavior passed at 1440×1000, 390×844 and 320×844.
- Actual ReactDOM/Chakra component with synthetic local queue promises: **1 passed**, no failures/skips. Delayed initial read, initial failure, button retry, preserved rows, equivalent-scope form state, identity reset, late results/errors and unmount retirement passed. Full scrolling/screenshots at 1440/390/320 and zero network requests/page errors. This component regression is separate from the normal API workflow above.
- Focused queue/vault/reconciliation/file-sync/pump regression: **70 passed**. Normal `test:passwords` command (now includes the five queue regressions): **61 passed**. These suites overlap; counts are not additive.
- Focused lint passed. TypeScript remains at the same **91 baseline diagnostics**, none added or removed; not a clean typecheck.
- Installed browser-manager protocol, read-only Docker runtime, no mounts/published ports, network-none browser/backend egress refusal and Chromium sandbox verified. No OOM. Session `fa6c173d-61a6-4d8e-a292-59a7f2d6a681` released; zero owned containers remain.

## Replay and scope

Build the component fixture with `node remix/scripts/build-password-queue-status-fixture.cjs`. The executed native runner is retained here; its original location is `tmp/continuation/vault-status/run.cjs`, and its relative paths assume that layout. It pins the fresh package above. The canonical identity fixture is copied as `executed-identity-test.mjs`; browser fixture/test sources and the reproducible build script are tracked under `remix`. Generated bundles and the application archive remain ignored temporary artifacts. `source-hashes.json` identifies the tested source. The normal test logs and screenshots are in `vault-identity/`; component evidence uses the `queue-status-` prefix.

The prior baseline and failed setup chronology remain in the separate `anonymous-local-first-2026-10-27-vault-identity*` artifacts. Premature readback did not establish server reversion. This run proves one loopback origin/default data plane, not all origin/plane/provider/device transitions, matching local IDs, attachment races, installed macOS, or AutoFill. CI and public preview checks must identify their own pushed head. No merge, manual deployment, public publishing, existing account mutation, shared LLM proxy or VM changes occurred.

The progress-plan browser check initially caught stale summary counters (65/20/4 versus the actual 65/21/3). The counters were corrected without changing task states or weakening assertions. The repeated check passed full scrolling, filters/search and no overflow at 1440/390/320; both plan runtimes were released. See `plan/verification.json` and the retained `plan-initial-count-failure/` evidence.
