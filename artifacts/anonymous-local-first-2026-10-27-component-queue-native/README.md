# Component dependency queue native acceptance — 2026-10-27

Final result: **r5 passed (1 test, 0 failures, 0 skips)** in 46.74 seconds. This is bounded local browser acceptance of the normal application worker using real IndexedDB and the real replica API in an installed-manager task-owned container. Product code was unchanged. Existing b23 app output was packaged without rebuilding; the checkout checkpoint was `b23917ea92e7e6d9ef5dbc7c3792a0289fecfb10`. The fixture/test were bundled separately as opt-in test code.

## Verified behavior

- A scoped Component POST refusal holds its nested dependent page, while unrelated Data reaches the real API.
- After retry, Component acknowledgment precedes page upload. Exact saved IDs, nested blocks, actual `/p/<id>` rendering and reload match.
- A page create commits with HTTP 200 but its response is withheld from the app. Its full frozen operation (operationId, version, method and body) survives a newer local edit referencing a second unavailable Component and cold navigation.
- The normal worker replays the exact original create, receives HTTP 409 because it already committed, then confirms the original through an authenticated same-content GET. It adopts that exact committed revision while preserving the newer local edit as pending.
- No newer page PATCH occurs until the second Component is acknowledged. The final PATCH uses the recovered `expectedUpdatedAt`; exact API readback, native rendering and reload show the newer content.

The fixture seeds/retries only through the canonical local queue. It never drives `sync()` or substitutes a mock transport. The normal app worker performs remote mutations. A separate neutral control page within the same disposable context performs independent same-origin authenticated readback. All identities/data are synthetic.

## Evidence index

| Attempt | Result | Finding |
| --- | --- | --- |
| [r1](../anonymous-local-first-2026-10-27-component-queue-native-r1/component/test.log) | Failed before sync | Loopback-only Chromium reported offline; authenticated app correctly left all records pending. |
| [r2](../anonymous-local-first-2026-10-27-component-queue-native-r2/component/test.log) | Harness failed | Actual root actor/home plane verified despite offline navigator signal. Existing CDP online simulation enabled normal sync, but fault matching incorrectly used `id`; canonical creates use `shareId`. |
| [r3](../anonymous-local-first-2026-10-27-component-queue-native-r3/component/test.log) | Partial acceptance; harness failed | Dependency gate, unrelated Data, ordered acknowledgment, exact readback/render/reload and viewport screenshots passed. APIRequestContext read returned 409. |
| [r4](../anonymous-local-first-2026-10-27-component-queue-native-r4/component/test.log) | Partial acceptance; harness failed | Independent normal browser read succeeded. Diagnostic APIRequestContext correctly refused mismatched request identity with `ACTOR_CHANGED`. Actual replay409 + canonical GET recovery succeeded, but test incorrectly demanded replay200. |
| [r5](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/test.log) | **Passed** | All scenarios verified against canonical create409→GET200 recovery contract. |

Every attempt retained boundary/resources/cleanup evidence. All task containers were released with `remaining: ""`; no OOM occurred. Failed attempts are not counted as passes. Earlier APIRequestContext `ACTOR_CHANGED` was not bypassed or claimed fixed; normal same-origin browser identity/readback is the accepted path, with the diagnostic preserved.

Final [verification.json](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/verification.json) retains untouched request bodies, normalized IDs, delivery/refusal/drop markers, actual app readback receipt, complete frozen operation/cold equality, recovered revision, final Thing and viewport bounds. See [acceptance metadata](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/acceptance-metadata.json), [committed readback](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/committed-readback.json), [connectivity preflight](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/connectivity-preflight.json), [request identity diagnostic](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/request-context-diagnostic.json), [boundary](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/boundary.json), [network proof](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/network-proof.json), [resources](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/resources.json) and [cleanup](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/cleanup.json).

## Rendering and source scope

Both acknowledged and recovered pages were captured at 1440×1000, 390×844 and 320×844, with top/bottom screenshots. Each capture awaits exact content and `document.fonts.ready`, traverses scrollable document/nested panes in bounded half-height increments, and asserts document scrollWidth equals viewport width. Content is deliberately short. Font status strings, element bounds and scroll distances were not separately retained. Final recovered screenshots were visually inspected at all three widths: content is visible without overflow/overlap. No broader complex-page/layout claim is made.

- [Desktop recovered](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/recovered-1440.png)
- [Mobile recovered](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/recovered-390.png)
- [Narrow recovered](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/recovered-320-bottom.png)

The runner negotiated the installed manager's v1 browser/network capabilities and owned a distinct claim/profile. The container remained network-none, read-only, with no mounts or published ports, 4096 MiB and 1 CPU. Browser and backend external IPv4, IPv6 and redirect attempts were denied; Chromium sandbox stayed enabled. The CDP override simulates the browser's online signal solely for the loopback test runtime; it does not grant external networking.

Targeted ESLint passed for both final owned source files (exit 0; existing Remix ESLint deprecation warning only), with [lint output](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/lint.log).

The parent ran TypeScript comparison: raw exit 2, 91 existing diagnostics, added `[]`, removed `[]`. This is unchanged baseline evidence, **not a clean typecheck**. [TypeScript log](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/typecheck.log) and [baseline comparison](../anonymous-local-first-2026-10-27-component-queue-native-r5/component/typecheck-comparison.json) are retained. Final owned source formatting was checked to preserve identical esbuild executable transforms. Executed pre-format source is retained with r5 artifacts.

This acceptance does not establish production/provider/existing-account delivery or close the broader plan. Parent owns checklist, PR, Graphify and integration.
