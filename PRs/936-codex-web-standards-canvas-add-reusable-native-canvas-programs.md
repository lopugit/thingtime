# PR #936 — Add reusable native Canvas programs

2026-09-27. Branch `codex/web-standards-canvas`, base `main`.
The user explicitly requested ongoing main merges and production @lopu delivery.

## Delivered behavior

145 ordinary editable Canvas programs replace missing-context entries. Coverage
becomes 3,418/18,798: HTML 302, CSS 1,059, JavaScript 890, Web APIs 1,167.
They exercise native 2D state, compositing, transforms, paths, text/metrics,
gradients, patterns, local bitmap copies and ImageData. Inputs and the full
program persist through existing Component/Action contracts; native backing
has no catalogue IDs or per-demo source escape.

The worker DOM bridge gains an owned `surface` context and closed `construct`
actions for Path2D/ImageData. Surface and detached document contexts cannot mix.
The active surface matters: detached-document Canvas font writes were ignored
by the tested browser. Active native fonts, metrics and pixels now agree.

Boundaries cover four canvases, 512px edges, 32px pixel windows, 4,096 pixel
values, path-copy/self-addition cost, local filters and absolute fonts. Surface
reads cannot expose the runtime Document or parent nodes; general surface tree
mutations are refused. Initial and live attribute writes enforce bitmap limits
before native allocation. Native context output projects known fields while
input dictionaries remain strict. Unsupported native members stay explicit.
Both capability manifests and the client negotiate actions-run 1.23.0; CSP is
unchanged. Offscreen, capture, asynchronous blob and GPU contexts remain future work.

## Validation

- 119 platform tests pass; one opt-in integration test skipped by that command.
  Separate real disposable API audit round-trips all 145 edited programs,
  canonical suite install creates seven records then zero on retry, authored
  save-draft passes, and anonymous reads return 404.
- 184 local browser checks: 182 pass, two explicitly unavailable text metrics,
  zero failures. Includes Canvas pixels, state restore, width reset, matrices,
  24px font readback/native metric scaling, evenodd clipping, native range
  errors, allocation bounds, surface escape and existing DOM/form regressions.
- Local authored gradient edit/save/reopen/full-reload/run preserves colour,
  text, stop and endColour. Pixel output is [207,0,47,255]. Owner API confirms
  exact defaults and anonymous 404. Eight disposable suite/UI records removed.
- Desktop rendering and 390px viewport checked; frame width/scrollWidth 356/356.
  Caption placement corrected after screenshot review. Completed drawings stay
  visible, repeated runs start fresh, and Stop clears the iframe.
- 83 capability tests pass; targeted lint clean; typecheck remains at 89 existing
  diagnostics. Full build and Vercel output verifier pass.
- Local stale orphan processes belonged to this worktree; stopped those exact
  groups then used the blessed PM2 lifecycle. Mongo host 127.0.0.1:18733 verified
  before mutations. No other checkout or production data used for local tests.

Structural graph refreshed and every new source verified in graph/manifest.
Semantic extraction was attempted through the local Codex proxy: all six chunks
failed with 502 codex_execution_failed. No semantic freshness is claimed.

Exact hosted head, checks, preview/deployment, production save/reload/privacy and
cleanup receipts are recorded in the PR body after acceptance. The full standards
goal remains active.
