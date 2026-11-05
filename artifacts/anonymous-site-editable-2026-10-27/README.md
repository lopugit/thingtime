# Global/site nested Builder fixture — 27 October 2026

**Native acceptance is pending.** The runtime preflight refused an existing
other-task container, and one ten-minute deterministic capacity observer ended
with `deadline-no-headroom`. Run count was **zero**. No browser, backend,
allocator, account or lease was created. No other runtime, shared proxy service,
key or VM setting was changed. [Observed result](capacity-result.json).

The prepared opt-in fixture is
[`siteEditableBlocks.browser.test.ts`](../../remix/app/local-workspace/siteEditableBlocks.browser.test.ts).
It creates a column with separate text, button, icon and input blocks in both
global and site canvases using normal Builder controls. It independently edits
text/button/icon siblings, saves and cold-reloads offline twice, compares exact
stored block identities/content, then checks the composed `/ode` route at
1440×1000, 390×844 and 320×844. It checks keyboard navigation, focus hit targets,
full scrolling, horizontal overflow, page errors and unexpected account requests.
No Action behavior or persisted input-value behavior is inferred from live inputs.

## Readiness, not acceptance

- Source/selector review compared the existing site and ordinary-page tests.
- Targeted lint passes; compiled test discovery reports one opt-in skip.
- `prepared-fixture.mjs` is compiled source, **not an executed browser fixture**.
- No new screenshots, canonical save readbacks or native result are claimed.
- Plan source checks pass with unchanged 65 done / 22 partial / 2 planned counts
  and valid local links/script syntax. Browser control refused the local file
  protocol; the copy update was not visually rechecked through another surface.
- Earlier `siteBuilder.browser.test.ts` proves global/site text/media persistence;
  `editableBlocks.browser.test.ts` proves ordinary-page nested editing. Neither
  establishes this combined global/site nested-control acceptance.

## Run in an isolated runtime

Follow the [agent browser runbook](../../docs/agent-browsers.md) to reserve one
task-owned runtime with the verified network-none boundary for browser and
backend, private database/profile, loopback app and normal sandboxed Chromium.
Keep the existing memory/headroom preflight. Do not reclaim another task's runtime
or change shared services to obtain capacity.

Copy the compiled fixture into that runtime. Set these variables to its verified
local resources, then run `node --test /tmp/site-editable.test.mjs` there:

- `TT_SITE_EDITABLE_ORIGIN`: runtime loopback app origin.
- `TT_SITE_EDITABLE_SESSION`: that runtime's non-secret test session identifier.
- `TT_SITE_EDITABLE_ARTIFACTS`: private output directory.
- `TT_SHARED_PLAYWRIGHT_PATH`: installed Playwright module path inside the runtime.
- `TT_SHARED_CHROME_PATH`: sandboxed Chromium executable inside the runtime.

The prepared app package was SHA-256
`e5ca5891e959085e7add481841f21f662bdce8da8dfa9649d11aba227a88ba12`,
with 19 reviewed source-map matches. Revalidate source/package parity before any
future run; package existence is not evidence that this fixture ran.
Retain the exact executed source, package proof, boundary checks, screenshots,
results and cleanup. Any OOM or boundary failure invalidates acceptance.
