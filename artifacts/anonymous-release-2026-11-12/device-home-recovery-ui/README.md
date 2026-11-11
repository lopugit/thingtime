# Device-home recovery UI regression

Observed 12 November 2026. Actual `RootRecovery`, React Router, shared components, `rootIdentity` and `createLocalHomeBootstrap` are bundled from current source. Only the native host, workspace selection and delayed loopback root-check response are synthetic/controlled. This is responsive/state acceptance, **not native initialization or storage acceptance**.

Run from the repository root:

```sh
node --check artifacts/anonymous-release-2026-11-12/device-home-recovery-ui/run.mjs
node artifacts/anonymous-release-2026-11-12/device-home-recovery-ui/run.mjs
```

The driver uses installed Remix/esbuild/Playwright dependencies and the actual compiled platform document plugin. It creates one task-owned headless Chromium process with normal sandbox enabled, separate disposable contexts, an ephemeral loopback server and a temporary bundle outside the repository. No account API or saved credential is used. Browser/server/temp bundle are cleaned in `finally`.

All three widths passed: 1440, 390 and 320 pixels. Checks cover visible Work on this device, keyboard Tab/Enter/Space, disabled action with one inline busy mark and aria-busy, recoverable failure/alert, explicit retry clearing the old error, controlled success revalidation, hidden action for existing/no-capability/nonretryable states, and identity invalidation. Hidden-state checks await capability completion. Every rendered state is scrolled top-to-bottom and checked for document/button horizontal overflow and minimum44px control height. Ready/busy/error/hidden-state and keyboard-focus screenshots are retained. Inspected desktop busy,390error/focus and320ready/error screenshots show no clipping or overflow, including an unbroken diagnostic string.

`verification.json` contains exact production-source and fixture hashes, viewport checks and reviewed screenshots. `cleanup.json` records teardown. No app source or shared canonical build output was edited.

`fixture-setup-debug/` preserves an initial fixture-only failure: a synchronous mock root loader cleared router errors while leaving its error boundary painted in the same React batch. The final fixture performs an asynchronous delayed loopback root check, matching the real root loader's transport timing. This historical setup result is not asserted to be a production defect. Native iOS worker separately owns real host/storage and New/Rename/reload acceptance.
