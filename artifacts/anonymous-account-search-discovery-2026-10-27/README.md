# Account Search cached discovery — 2026-10-27

Final scoped native result: attempt 6 PASS against fresh canonical pre-review package `audio-search-pre-review-app.tar.gz`, SHA `bd61db37b2765d68b817dfdc649dd30b62f39a67fd015441bceaac2519e4e425`. Exact five relevant client sourcemap modules match final Search source (`fresh-source-equivalence.json`). This package is valid scoped Search proof, not final audio, installed-app, deployed or whole-goal acceptance. Server-source/whole-package equivalence is not established.

## Delivered behavior

Search preserves the query that produced displayed results. Cache-restored or failed-refresh results show an atomic status identifying a cached, partial snapshot and possible changed people/subspace/account data. Edited or failed different text/filters explicitly identify a previous search that may not match current input. Successful first-page searches clear stale provenance. Empty results do not imply a retained snapshot. Existing account/origin/data-plane/source fences remain in SearchWorkspace.

Source: `remix/app/components/Search/SearchPage.tsx`, pure `searchResultSnapshot.ts` and its focused regression. Native case/helper: `remix/app/local-workspace/accountSearchDiscovery.browser.test.ts` and `.fixture.ts`.

## Actual checks

Actual synthetic isolated account registration and root-data verified non-temporary owner/home data plane before fixtures. Normal authenticated Search returned its exact synthetic profile, public subspace and private Thing through real API/database. Cold offline reload retained all three sections and displayed truthful cached/partial status. A different failed offline query retained the original sections and identified them as previous-search results. Real logout and cold offline guest reload exposed none of the prior sections. No offline write requests or page errors occurred.

At 1440/390/320 pixels the test scrolled actual roots top-to-bottom with no horizontal overflow, retained normal controls, checked each notice text line stays in the viewport, and captured top/bottom/notice screenshots. Computed foreground `rgb(90,90,102)` on effective background `rgb(250,250,251)` gives contrast 6.517:1 at every width. Inspected 320 and 1440 notice screenshots; status wraps legibly and normal toasts/floating controls are retained. Full screenshots and values live in `account-search/verification.json`.

Native boundary: shipped browser-manager CLI and documented test-host allocator; one 4 GiB disposable runtime; Docker network-none/read-only root, no shared mounts or host ports; Chromium sandbox. Browser and backend IPv4/mapped IPv6/IPv6/DNS/redirect egress denial verified. Final OOM counters stayed zero and cleanup has no session-owned containers. Synthetic cookies stayed in memory in their own browser context. No production requests, existing accounts, real credentials, VM changes or shared proxy were used. Private Character/overview auth unavailable; parent-relayed local evidence only.

Two focused query-provenance regression tests pass; scoped source/test/helper lint and diff check pass. Parent owns typecheck, docs, graph, integration and publishing. UI/UX Pro Max guidance selected a contextual atomic role=status without moving focus, using the existing body-text token. Inspo schema was discovered/read; its explicit exclusion for established design systems/copy/logic fixes applied, so no external reference-site lookup or redesign occurred.

## Failure history and evidence boundaries

Attempt 1: generated subspace slug invalid (400). Attempt 2: harness used wrong direct profile-check route after online sections rendered; corrected to actual `/api/v1/users/search`. Attempt 3: OOM invalidated acceptance and full-page failure screenshot obscured original error; replaced with compact diagnostics and viewport capture. Attempt 4: OOM0 but normal shell-readiness predicate timed out before offline; online only. Static archive audit found all 265/265 old manifest assets intact, and exact failed-stage was initially unknown. Passive stage/network telemetry was added without forcing registration, populating caches or raising timeout. Attempt 5: normal shell readiness and functional cached sections/identity/layout passed, but deliberate final assertion proved generic offline error did not identify cached/partial results. That finding led to the product status fix. Attempt 6: fresh repaired package passes the whole retained case.

Earlier old archive `post-draft-app.tar.gz` SHA `0a847337609cd760c3188d784375f57a2d1eadb495ccad86b1c2799429d3a0d5` is historical pre-fix evidence only. Old source equivalence is explicitly separate from fresh proof. Original attempt 4 source/bundle and attempt 5 execution hashes are retained. Exact executed test/helper/product/archive/bundle hashes live in `execution-hashes.json`; final executed bundle bytes are `executed-test.mjs`. The exact attempt 6 test source is retained in `native-6.executed-source.ts`. After native execution, its synthetic username construction changed from `replaceAll` to the equivalent global-regex `replace` to fit the repository TypeScript target. `test-source-compatibility.json` records both source hashes and a byte-identical reverse-transform check; this test-only compatibility change was not rerun natively.

## Direct rerun

Host prerequisites: installed `/Users/lopu/Applications/Thingtime.app/Contents/Resources/agent-browser.mjs`, existing Docker socket `/Users/lopu/.colima/thingtime-agents/docker.sock`, image `sha256:5c17ff3d0158b726b014ea37d18286ed6bf9187db9f650ff51e17b35f4a315be`, one exclusive 4 GiB runtime allocation, checkout MCP esbuild dependencies, and the exact fresh package above. Do not change VM settings or substitute an unfenced host API. The runner allocates, claims, launches and releases through the shipped CLI/test host. Preserve current `account-search/` evidence before rerunning, since the runner writes there.

From `/Users/lopu/.codex-2/worktrees/anonymous-cloud-continuation/thingtime`:

```sh
python3 artifacts/anonymous-account-search-discovery-2026-10-27/verify-package.py tmp/continuation/audio-search-pre-review-app.tar.gz artifacts/anonymous-account-search-discovery-2026-10-27/fresh-source-equivalence.json
node artifacts/anonymous-account-search-discovery-2026-10-27/prepare.cjs
TT_SEARCH_ARCHIVE=/Users/lopu/.codex-2/worktrees/anonymous-cloud-continuation/thingtime/tmp/continuation/audio-search-pre-review-app.tar.gz node artifacts/anonymous-account-search-discovery-2026-10-27/run.cjs
corepack pnpm --dir remix run lint:files -- app/components/Search/SearchPage.tsx app/components/Search/searchResultSnapshot.ts app/components/Search/searchResultSnapshot.test.ts app/local-workspace/accountSearchDiscovery.browser.test.ts app/local-workspace/accountSearchDiscovery.browser.fixture.ts
node --import ./remix/node_modules/tsx/dist/loader.mjs --test remix/app/components/Search/searchResultSnapshot.test.ts
```

Text normalization: retained `.log` files have trailing whitespace stripped and one final newline before final hashes. These are labeled normalized evidence copies; PNG/JSON/executed bundle bytes are unchanged. No graph refresh, commits or pushes were performed by this worker.
