# Real iOS local-runtime development app: incomplete UI acceptance

12 November2026 Melbourne. The opt-in lane builds the normal Thingtime SwiftUI
app, WebView and native bridges under `com.thingtime.localdevelopment`, embeds
the real final canonical Vite/Nitro payload plus verified Node24/bcrypt/Sharp
simulator binaries, and starts loopback HTTP before creating the WebView.
Hosted app code remains behind its existing build path; no stable app,
production account, TestFlight, signing credential or physical device changed.

The final canonical server entry SHA256 is
`45f073449493c2b9b72a9a161b760517f263ada4e10893fb2b127b962d64a657`.
Its `.output` inventory is1821files,270026924bytes, canonical digest
`4b6b215b6d4ba8abd3b2b4d294000e00b57d14d3a8fd8cf2b73a508c4a3e0e1c`.
See the independent [web build evidence](../native-integration-build/verification.json)
and [exact frozen web-source hashes](../native-integration-build/source-inventory.json).
The web source is6d96a6177 plus the documented dirty session/native/UI changes;
this is not an unchanged-HEAD build. iOS source hashes are separately recorded.

## What actually passed

The [corrective run](corrective-run/verification.json) built the real native app,
ad-hoc simulator signed it and verified its signature. All1821canonical payload
files match except the two explicit genuine iOS addon additions. Final signed
addon hashes, full runtime/app inventories and source hashes are recorded.
The installed complete app inventory equals the exact signed built app:
1839files,408573741bytes, digest
`b4c875cbb65836a9c23439dd4e5bb6c4f2fcc2b009bdcf231f3a399ad5471103`.

Inside the actual iOS app, Node24.22.1 served the selected loopback manifest with
HTTP200, exact origin `http://127.0.0.1:29741`,367features and729operations.
Actual Vite HTML and entry JS returned200. Native URLSession independently
received the local capability response. GET `/api/v1/auth/me` returned503
`LOCAL_API_NOT_CONFIGURED`; there was no Mongo/signing/account configuration or
cloud API fallback. The Undici external-request counter was0 during **startup
acceptance only**. It does not measure every native/Node request or later activity.

## What failed

The WebView remained white. Its main-frame provisional navigation timed out
with `NSURLErrorDomain -1001` after approximately67seconds. See the narrowly
filtered [native navigation events](corrective-run/navigation.safe.log) and
[actual rendered screenshot](corrective-run/rendered.png). No `ui-edit.json`
or `webview.json` receipt was produced. Consequently none of the declared
Things-heading, visible New-folder creation, shared Rename, same-ID reload or
external-fetch-rejection assertions ran. The source contains those tests;
their presence is not observed UI acceptance. `passed:false` remains accurate.
The next bounded investigation is the actual WKWebView document/navigation path
to `/things`, independently of the successful Node/native root/manifest requests.
No third simulator run or speculative product correction was attempted.

The earlier [native startup failure](initial-rule-failure/verification.json)
was a development content-rule regex rejected by WebKit before Node started.
The corrected exact loopback prefix compiled in a separate task-private native
WebKit store and its test rule was removed; see [rule compiler evidence](rule-compiler/verification.txt).
The corrective iOS run also passed that compilation gate before Node startup.
The development content rule blocks external HTTP(S) and permits only its exact
loopback prefix. Since document loading failed, actual enforcement in a rendered
page remains unverified. OS/Node networking was never disabled.

Both task-owned simulators were deleted; each actual run's terminate/shutdown/
delete operations returned0. Original preparation failures are retained too:
out-of-tree intermediate grouping was disabled and XcodeGen's required nonsecret
USER was restored through the supported OS username lookup. Raw build/process
logs, generated projects, binaries and simulator paths remain in private caches.
Published events contain only bounded task-specific diagnostic labels.

The imported runtime's archive integrity was verified against its pinned digest;
source-to-binary reproducibility, physical-device integration/distribution,
WebView persistence acceptance and complete SQLite account/service integration
remain unproven. Earlier isolated SQLite primitive/collection SIGKILL recovery
is separate evidence and does not resolve these app/UI requirements.
