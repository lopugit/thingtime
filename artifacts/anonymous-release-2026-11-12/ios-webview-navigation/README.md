# Actual iOS WebView trace: cold-start identity bootstrap blocked

12 November2026 Melbourne. This bounded diagnostic freshly compiled the normal
native app from committed b3eba7dbf (including incoming shared Swift changes)
plus the exact guarded instrumentation hashes in `ios-trace/verification.json`.
It reused the unchanged frozen45f07344 canonical web payload after checking its
recorded source paths and complete payload inventory. That payload identifies
the earlier6d96/source-inventory checkpoint; it does **not** include concurrent
new users/identity work and is not the current combined dirty web source.

## Observed cause boundary

The actual WK main-document request `/things` reached embedded genuine Nitro
and completed HTTP200 in3ms. Middleware settled, response finished, and no
handler remained pending. WK subsequently recorded commit and finish on the
same loopback origin. The actual normal React renderer displayed **We couldn’t
load your session**, with Try again and Reload page. See the [actual screenshot](ios-trace/rendered.png)
and [native/server/UI receipt](ios-trace/summary.json).

The recorded UI acceptance reached its genuine script and refused to pass:
there was no Things-library heading and no create, edit or reload operation.
Source presence is not UI success. The earlier provisional timeout was not
reproduced in this trace; the new evidence does not establish its historical
root cause or claim that timing variability was fixed.

The demonstrated current boundary is canonical client identity bootstrap:
`routes.tsx` reads `/api/root-data`; the unconfigured local API returns503;
`createLocalRootFallback.read` deliberately requires a previously confirmed
anonymous/account workspace pointer. A fresh simulator has none. The native
host and renderer cannot invent a confirmed pointer or seed stored Things to
bypass this. Reaching first-launch local Things requires a canonical explicit
local-home bootstrap contract and a fresh web build containing that behavior.
No such shared web change or pointer mutation was made in this iOS diagnostic.

## Controls and provenance

The [host Nitro control](canonical-host-control.json) served `/things`200 in11ms,
plus genuine root/capabilities and account-unconfigured503 responses. A separate
task-private native macOS WKWebView using the identical content rules reached
`didFinish` and loaded actual assets from that same canonical Nitro; see its
[bounded summary](mac-webkit-control.json). These controls are not iOS app or
local persistence acceptance.

The actual iOS diagnostic also passed native URLSession `/things`200 before WK
creation, preserving application API/account/credential clearing and the narrow
OS-context whitelist. It did not broaden credential environment or blame XPC
launch policy without evidence. Node/network scopes remain separate: startup
Undici external count0 is not an OS or all-lifecycle network-off proof. Because
local editing did not run, rendered offline capability remains incomplete.

Full signed and installed app inventories match exactly,1839files, digest
`c7602583d3e2c7c031c4907615e052535fb458d57c9e5a38179c96ada249bb23`.
All1821canonical payload files match except two explicit genuine iOS addon
additions; final addon, runtime, app and executable source hashes are recorded.
The trace stores256safe events from692total, with an explicit truncation flag,
plus heartbeat and pending-state snapshot. It contains route classes, status,
method, timing and loopback/TLS booleans, never headers, bodies or query values.
The captured early document lifecycle is complete despite later asset-event
truncation. Raw process/build logs and executable caches remain private.

The task-owned simulator was terminated, shut down and deleted; each operation
returned0. Host controls closed their own servers and native process. No
production credentials, accounts, database, private pointer, stable app,
physical device or network/privacy settings were changed. Imported-runtime
source-to-binary reproducibility and physical-device distribution remain
unverified. No second app run was launched after the canonical bootstrap
boundary was established; repeating the same frozen payload would not repair it.

## Explicit device-home bootstrap and corrective actual-app attempt

The parent subsequently authorized a reusable explicit first-launch bootstrap.
The source adds ordinary **Work on this device** recovery UI only when a
compatible native host confirms a fresh owned profile. Existing, invalidated,
account and pending identity selections are refused. Status/version negotiation
precedes initialization. Exact native origin, main document token and live URL
are checked again after asynchronous cookie reads and before native mutation.
The canonical initializer records a distinct device-anonymous selection; its
client projection is explicitly device-only, unauthenticated and not remotely
confirmed. It does not replace `/api/root-data` or any server session response.
See [focused source and boundary checks](bootstrap-source-checks.json):39tests,
zero-error typecheck/ratchet, focused lint, and compiled native wrong-origin,
unsupported-major and stale same-origin document guards passed.

Foundation then built and verified the new [combined canonical payload](../bootstrap-identity-build/verification.json),
server entry `85ee59f2089f9b32c95e19428eba3f2bf24532c3c0e13ad6fefaf312d990a62d`.
The single corrective real-app attempt freshly compiled these native sources
with the recorded shared SessionStore source hash
`a8a11f60f2f3168a7d7e4f16bbbf62b794dcf5fad93ea310c88a7c691724ed1c`.
Its [receipt](bootstrap-acceptance/verification.json) records full canonical,
signed-addon and installed-app parity. Signed and installed1840-file app digest:
`9e3124d759382a18667e034bf85f5791f7045805423fb8c816662f23122c231b`.

**Actual UI acceptance remains incomplete.** Native Node/URLSession readiness
passed, but the intermittent WK provisional timeout recurred before renderer
commit. The actual `/things` request reached Nitro and emitted response-finish200
in4ms; this server observation does not prove WK receipt/commit. The pending
map was empty, while WK failed with `NSURLErrorDomain -1001` after144.516seconds.
The [screen remained white](bootstrap-acceptance/rendered.png). Neither UI
receipt existed and **zero** Work-on-device/New/Rename/reload operations ran.
The independent controlled browser fixture's post-click recovery symptom is
therefore neither confirmed nor refuted by this native attempt.

All exact-app termination, simulator shutdown and deletion operations returned0.
No automatic additional run, web rebuild, direct initializer call, pointer seed,
account/credential change or speculative transport fix followed this result.
The remaining native boundary is WK document consumption/commit despite the
observed server finish; the historical intermittent cause remains unproven.
