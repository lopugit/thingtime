# Native iOS LiDAR scans

The iOS drawer's **Scan — Open LiDAR Scanner** entry and an editable Thingtime
UI action open the same native scanner. A compatible iPhone or iPad with LiDAR
is required. Opening the controls does not start the camera: the person taps
Start and grants the normal camera permission. Finish seals the local archive
and automatically saves it as a private File Thing in the verified Home account.

The capture is an original-data archive, not only a rendered or simplified
model. Apple exposes processed scene depth through ARKit; unpublished hardware
laser returns and sensor firmware data are not available to applications.
The archive records the public data available to the configured ARSession,
including raw and smoothed scene-depth/confidence buffers, captured camera image
planes, calibration and poses, frame timing, feature points with identifiers,
mesh geometry and classifications, anchor changes, and the final world map when
ARKit can produce one. Dense points are derived from depth and calibrated camera
poses. The archive manifest describes its format, units, coordinate conventions,
availability, and interruptions. Missing data is not synthesized.

Capture streams to device storage. It does not impose a scan duration, point
count or archive size cap. Device capacity and ARKit delivery remain physical
constraints; a write failure or interruption must preserve an explicitly partial
capture. Raw imagery makes these archives large. No deliberate frame decimation
or lossy image compression is applied by the scanner.

## Ownership and recovery

A scan ID, selected origin and verified owner are reserved before recording.
The native multipart uploader sends the archive through the existing attachment
and Files APIs. JavaScript receives only status and identifiers, never file
paths, image/depth bytes or credentials. The local original is retained after
successful cloud saving and when offline. A pending save resumes with its
original request identity; receipt-first retries must return the same File Thing.
Changing account, origin, data plane, or leaving the foreground stops dependent
work. It never reassigns an existing scan to the new account.

Status refreshes only inspect the retained scan; a pending upload resumes from
the explicit Retry control. Confirmed discard writes independent durable
no-upload markers before deletion. If deletion fails, the remaining bytes stay
excluded from recovery and upload, and the scanner offers Retry Delete.

Recovery never truncates the original `scan.tar`. It validates archive headers
and committed frame records, then seals a separate copy-on-write APFS clone,
`scan-recovered.tar`, for a valid interrupted capture. Corrupt headers and scans
with no complete frames remain local and cannot be published as successful
scans. If safe cloning is unavailable, recovery fails with the original intact.
Pending status selects the newest usable capture; an explicit Retry stays bound
to its selected scan ID. Previously published empty Files are not deleted.

The scanner currently publishes to the signed-in account's Home data plane.
A selected external database is not silently used. A scanner button in Safari
opens `thingtime://scan/lidar?origin=<origin>` in the installed app. The origin
must match the app's selected destination. The handoff cannot set an account,
callback URL, upload target, or start recording. The native app verifies its own
signed-in account before capture; Safari and the app may have different sessions.
There is no remote command that silently opens another device's camera.

## Native bridge

Negotiate `window.thingtimeNativeBridge.lidarVersion` major 1 (minimum 1.0.0).
The general bridge's presence does not prove scanner or hardware support.
`lidar-scan` accepts an explicit action (`status`, `start`, `retry`, `suspend`),
a UUID `requestId`, `ownerId`, and exact `origin`; retry can identify `scanId`.
The main-frame bridge checks the loaded and selected origins before processing.
`lidar-scan-result` returns the same request/owner/origin with `supported` and
`state`: `idle`, `capturing`, `saving`, `saved`, `pending`, `cancelled`, or `error`.
`capturing` means the scanner is open; recording still requires Start. Progress
and terminal results retain request identity. A saved result includes `scanId`
and `fileThingId`. Pending/error results carry a user-facing explanation.
The native drawer also emits a scoped `lidar-scan-changed` hint containing only
owner and origin. The web client responds with a fresh status request and
accepts only its verified reply. Returning to the foreground supersedes stale
observations without issuing another recording or save request.

The upload negotiates the selected server's actual auth, attachment and Files
capabilities, verifies the pinned session before effects, and uses existing
storage accounting and approval. No separate scanner HTTP API or MCP is added.

## Reading the archive

The attachment is an uncompressed POSIX TAR. Open it with a standard TAR
reader. `capture.json` identifies format `thingtime.lidar.capture`, version 1,
scan UUID, start time, camera format, and enabled ARKit features. The final
`manifest.json` reports complete or partial status, world-map availability,
counts of each output, and the interpretation of each binary format. A zero
count means the corresponding output is absent. These are observed output
counts, independent of whether the session requested the feature.

- `frames/<index>/frame.json` describes one committed frame and references its
  sibling files. Frame time is `ARFrame.timestamp` (monotonic seconds); start
  and finish are ISO 8601 UTC wall times. Camera intrinsics, camera-to-world,
  and the default projection matrix are flattened by column. The metadata
  also includes tracking and mapping state, exposure, and active anchor IDs.
  `frame-gap.json`, when present, gives adjacent timestamps and the nominal
  interval. A timestamp gap is evidence of a possible missed frame, not an
  exact hardware frame-drop count.
- `camera-plane-*.bin`, `scene-depth-plane-*.bin`,
  `scene-confidence-plane-*.bin`, `smoothed-depth-plane-*.bin` and
  `smoothed-confidence-plane-*.bin` contain uncompressed Core Video bytes,
  including native row stride. Use the associated width, height, stride,
  pixel format number and FourCC in `frame.json`. Camera planes often contain
  Y and interleaved CbCr, rather than packed RGB. Preserve the matching
  camera color range and matrix from the pixel format and optional binary
  attachment plist when converting to RGB. Available attachment metadata,
  EXIF and light estimates are separate files, referenced by `frame.json`;
  an unsupported attachment value is identified by type in its plist.
- `scene-points.ply` and `smoothed-points.ply` are per-frame binary
  little-endian PLY files in ARKit world space (meters). Every finite positive
  depth sample contributes one point. Invalid values remain in the original
  depth bytes. Matching confidence is an optional unsigned byte
  (0 low, 1 medium, 2 high). The point files contain geometry; the aligned
  native image planes retain color. To reconstruct a depth pixel `(u, v)`,
  scale the native image intrinsics to the depth dimensions and transform
  `((u-cx)*d/fx, -(v-cy)*d/fy, -d, 1)` by `cameraToWorld`. This uses the
  unrotated image, right-handed camera coordinates, and depth `d` in meters
  from the camera plane.
- `feature-points.bin`, when available, contains little-endian records of
  three float32 world coordinates followed by the uint64 ARKit point ID.
- `events/<index>/event.json` records anchor adds, updates and removals in
  callback order, with the anchor ID, pose and most recent saved frame time.
  For mesh anchors, its sibling files contain vertices, normals, face indices
  and optional classification bytes. Vertex, normal and classification file
  offsets start at zero; the source record retains Metal format, native
  stride and the original buffer offset. The face file uses the specified
  index width and indices per face. Apply `anchorToWorld` to local positions.
- `world-map.arexperience`, when available, is a secure-keyed `ARWorldMap`
  archive. The map request can fail if tracking or mapping is insufficient.

The archive contains the rear LiDAR world-tracking session's public outputs.
Front-camera TrueDepth, person segmentation and the synthesized camera grain
texture are outside this capture; camera grain intensity is recorded. The
scanner does not sample or compress the delivered frames. It stops on sustained
capture backpressure or write errors. On process interruption, recovery scans
the TAR headers, retains the last complete frame and anchor records, and seals
a separate recovery archive as partial. The local original is protected in application storage and
can be shared from the native result controls.

## Verification boundaries

Native tests cover archive data, handoff validation, lifecycle and durable upload
behavior. Browser tests cover the editable control, bridge negotiation, state
updates and account changes. Simulator execution cannot produce LiDAR data.
The camera-buffer regression exercises real Core Video attachments through the
writer, TAR archive and decoded plist. Scalar metadata must retain its type and
value; only an object with the Core Foundation color-space type ID may enter
Core Graphics color-space APIs. This guards the first-frame crash caused by an
opaque Swift cast accepting ordinary camera metadata as a color space.
Physical acceptance requires a compatible device: scan an object, finish, reopen
the saved Thing, download the archive and compare original bytes and a sample
frame's depth/calibration/point data. Exercise offline retry, cancellation,
permission denial, account change and process interruption separately.

Apple references: [scene depth](https://developer.apple.com/documentation/arkit/arframe/scenedepth),
[frame data](https://developer.apple.com/documentation/arkit/arframe),
[feature points](https://developer.apple.com/documentation/arkit/arframe/rawfeaturepoints),
[mesh geometry](https://developer.apple.com/documentation/arkit/armeshgeometry),
[depth point clouds](https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth),
and [world maps](https://developer.apple.com/documentation/arkit/saving-and-loading-world-data).
