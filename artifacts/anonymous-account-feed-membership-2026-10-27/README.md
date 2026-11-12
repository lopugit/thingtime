# Normal account feed partial membership — 2026-10-27

Final retained native case: `accountFeedMembership.browser.test.ts`; execution is attempt 6. Native test and targeted lint pass. Actual loopback API/database and sandboxed Chromium ran inside one disposable 4 GiB network-none runtime, through the installed browser-manager CLI/test-host allocator. This is local package/browser acceptance, not installed-app or deployment acceptance.

A verified non-temporary synthetic reader on the home data plane reads 20 of 25 private posts shared by a separate synthetic author. Before offline, exactly one feed page is visited, with a server next cursor. Cold offline reload retains the same 20 and shows the normal explicit partial-view notice. All five unvisited IDs remain absent through full scrolling at 1440/390/320 pixels. No offline mutation requests occur. Reconnect reloads a server first page, then its real cursor fetches the five remaining posts; all 25 IDs match. Real logout plus offline reload exposes none of the protected projections. Zero page errors and horizontal overflow; normal controls stay present. Top/bottom screenshots retained and the 320-pixel top capture inspected.

`account-feed/verification.json`, `boundary.json`, `network-proof.json`, `resources.json`, `cleanup.json` retain the final evidence. Boundary: read-only root, no mounts/ports, network none, Chromium sandbox. Browser/backend IPv4, mapped IPv6, IPv6, DNS and redirect egress denied. OOM counters stay zero. Final cleanup has no session-owned containers. Runtime/browser/profile/database and private temporary manager state were removed.

`source-equivalence.json` establishes exact sourcemap contents for six relevant client modules only. Server chunks do not contain corresponding source maps; current server-source or whole-package equivalence is not established. The archive SHA is independently recorded in `execution-hashes.json`; the test uses its real packaged API. No provider, production, existing account or installed-app data was used. Private Character/overview reporting auth was unavailable; parent reports this local result without invented IDs.

Failures are retained: attempt 1 direct API jar mutation 401; attempt 2 owned fixture invalidated the unvisited expectation because normal owned-library sync already retained all 25; attempt 3 independent author's direct API mutation also 401; attempt 4 reached all core assertions but redundant test-only cookie deletion failed after successful logout. Attempt 5 passed. Attempt 6 adds affected-view top screenshots and passes unchanged behavior. Fixture setup now uses separate verified browser contexts and same-origin API fetch, with synthetic cookies kept only in memory. No product fix was needed. Broad remote list membership, cross-device coverage and other discovery surfaces remain outside this one case.


## Reproduce on the configured isolated test host

From the repository root:

```sh
node artifacts/anonymous-account-feed-membership-2026-10-27/prepare.cjs
node artifacts/anonymous-account-feed-membership-2026-10-27/run.cjs
```

This is a host-specific acceptance runner, not a portable app launcher. It requires
`MCP/node_modules/esbuild`, the existing sanitized package at
`tmp/continuation/post-draft-app.tar.gz` with the archive hash recorded in
`execution-hashes.json`, the installed Thingtime browser-manager CLI, the configured
Colima socket and the exact runtime image recorded in `run.cjs`. It creates only
its own disposable manager/runtime/database. The runner verifies the negotiated
manager capabilities, enforced boundary, isolated session health and cleanup.
Do not redirect it to an account service or reuse personal browser state. Rebuild
and re-establish source provenance before using a different application archive.

## Parent integration checks

The TypeScript comparison preserves the same 91 normalized baseline diagnostics,
with no additions/removals; it is not a clean typecheck. Six-client-module parity
and the native test's package scope remain distinct from that source check.
`delivery-2366/` contains public HTTP inspection of the preceding pushed commit's
preview/alias and a read-only source-marker audit. These are not deployed
functional or account acceptance. The shared proxy/key and VM configuration were
left unchanged.

The preceding `2366c088` passed [Web CI](https://github.com/lopugit/thingtime/actions/runs/40390728996) and [CodeQL](https://github.com/lopugit/thingtime/actions/runs/40391484620). Its [immutable preview](https://thingtime-8ry23fcvp-lopugits-projects.vercel.app) and PR alias pass the recorded public HTTP checks. These do not establish CI or deployment acceptance of the new feed test commit.

Integration normalized trailing whitespace in saved text logs only; executed test/bundle bytes and JSON/PNG evidence are unchanged.
