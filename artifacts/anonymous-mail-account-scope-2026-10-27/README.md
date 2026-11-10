# Anonymous/local-first mail account-scope acceptance — 27 October 2026

Latest full-app isolated Chromium/Nitro run: one test passed, zero skips, in `attempt-3-reader/verification.json` (~10.7 seconds). The original passing run remains in `attempt-2/`. Both disposable accounts had the same message ID with distinct subject/body in canonical encrypted local stores. The existing root identity channel retired A while the real root response was held; the old reader disappeared before B resolved. B then opened only its own reader; independent exact store readback retained A unchanged. No mail API requests or page errors. The latest run scrolls every actual scroll root top-to-bottom at 1440/390/320px and checks horizontal overflow throughout. It then centers the actual B reader with normal scrolling, checks subject/body bounds and nine visibility points per target against elementFromPoint, and captures `new-scope-WIDTH-reader.png` plus bottom screenshots. All three reader screenshots were visually inspected: actual subject/body remain visible above the normal fixed toast and controls; no controls were hidden. Network, resource and cleanup evidence confirms loopback-only network-none runtime, sandbox enabled, no OOM and zero remaining task runtimes.

`attempt-1/` retains the initial assertion mismatch: the higher-level production root boundary showed “Refreshing your session,” rather than MailPage's own pending text. It already hid the old message. Correcting that test expectation produced the successful second attempt. A review then identified that those viewport screenshots did not show the below-fold reader. Attempt 3 strengthens actual rendered-reader coverage and also passed; it changes test assertions only. No production change was needed.

## Sources and executable provenance

- `remix/app/mail/accountScope.browser.test.mjs` — opt-in test.
- `remix/app/mail/accountScope.browser.guard.mjs` and `accountScope.browser.guard.test.mjs` — pure destination validation and deterministic checks; no network/browser.
- `remix/app/mail/accountScope.browser.fixture.ts` — synthetic canonical encrypted-store data only, never imported by application code.
- `executed.test.mjs`, `executed.fixture.ts`, `executed.fixture.js` — exact executed source/bundle, retained for audit.
- `source-equivalence.json` — current retained test differs from the executed attempt 3 only by importing/calling the pure loopback-origin guard before the first health fetch and setting health redirects to error. Removing exactly those changes restores byte equality. The native flow was executed **before** this guard-only addition; no native rerun followed it. `source-equivalence-attempt-3.json` preserves the prior byte equality record, and `source-equivalence-attempt-2.json` preserves fixture relocation normalization. The fixture is unchanged.
- `provenance.json` — exact source-map sourcesContent equality for eight production mail/root modules inside the actual tested sanitized application archive. Its package SHA256 is recorded separately; module equality does not prove whole-package source identity.
- `lint.log` — attempt-3 scoped ESLint passed. `guard-test.log` and `guard-lint.log` verify the later guard-only addition: one deterministic test passed (two accepted and twenty-one rejected inputs), scoped ESLint passed with the existing config deprecation warning only. No network/browser/runtime was launched for guard checks.
- `skip.log` — standalone invocation without opt-in variables deliberately skipped (0 passed, 1 skipped); separate from native acceptance.

## Run in an explicitly isolated task namespace

Allocate the documented task-owned browser/backend fixture first. The browser and API must share an enforced network-none namespace with disposable independent database/authentication. Do not point this test at personal or production accounts. Package the app and test dependencies into that runtime as in `tmp/continuation/post-draft-native-run.cjs`; its test browser uses the runtime's installed Playwright and Chrome. Build the fixture and copy these outputs into the runtime:

```sh
esbuild remix/app/mail/accountScope.browser.fixture.ts --bundle --platform=browser --format=iife --global-name=MailScopeFixture --outfile=/tmp/check/mail-scope.fixture.js
cp remix/app/mail/accountScope.browser.test.mjs /tmp/check/mail-scope.test.mjs
cp remix/app/mail/accountScope.browser.guard.mjs /tmp/check/accountScope.browser.guard.mjs
```

Run this command **inside the verified network-none runtime** (replace SESSION_ID and Chrome path with its allocator-provided values; create the artifact directory first):

```sh
TT_MAIL_SCOPE_URL=http://127.0.0.1:18724 \
TT_RENDER_SESSION=SESSION_ID \
TT_MAIL_SCOPE_ARTIFACTS=/tmp/native-artifacts \
TT_MAIL_SCOPE_FIXTURE=/tmp/check/mail-scope.fixture.js \
TT_SHARED_PLAYWRIGHT_PATH=/tmp/check/MCP/node_modules/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/runtime/path/to/chrome \
node --test /tmp/check/mail-scope.test.mjs
```

The current test first rejects any destination except an exact canonical HTTP origin using literal `127.0.0.1` or `[::1]` and an explicit non-default port, with no credentials, trailing slash, path, query or fragment. The first health fetch refuses redirects. These guards were added after attempt 3; current-byte native execution is not claimed. The test requires matching isolated health/session evidence. Archive boundary/network/resource/cleanup proofs alongside its outputs, reject renderer/OOM failure, and release task-owned resources. Synthetic account credentials are generated only inside disposable test execution and never returned in evidence. `TT_MAIL_SCOPE_URL`, `TT_RENDER_SESSION`, and both browser path variables are mandatory; without them the opt-in test skips.

## Remaining acceptance gap

This proves an account transition on one loopback origin. Actual Electron selected-origin changes use `switchDesktopEndpointGuarded` in `electron/main.cjs`, stopping native/render work and restarting Electron with a different endpoint-derived BrowserWindow partition. The Chromium/Nitro fixture does not run Electron preload/IPC, BrowserWindow partitions or that restart lifecycle. Two loopback web navigations would not establish it. Selected-origin transition, installed-app behavior, providers and native mail transport remain unverified. No installed-app/bridge/lifecycle changes were made. Agent Overview authentication was unavailable; evidence is local and parent-reported only.


## Combined integration checks

The updated HTML plan passes full top-to-bottom layout/filter/search checks at
1440/390/320px: 89 checklist items, 65 complete, 15 partial and 9 planned; Remaining
includes all 24 unfinished items. Evidence is in `plan/`. `plan-count-failure/`
retains the caught stale header counters, corrected before the passing run.
The combined mail/recovery TypeScript check retains exactly the prior 91 normalized
diagnostics (none added/removed); see `typecheck-comparison.json`. This is not a
clean typecheck. Only structural graph indexing is used; the shared LLM proxy/key
and VM configuration remain unchanged.
