# PR 1164 — Local images and immediate media controls

[Pull request](https://github.com/lopugit/thingtime/pull/1164) ·
`codex/general-media-compressor` → `develop` · 2026-10-22

The previous compressor was an executable Web Platform example: no file UI was
mounted until Run example created a preview job. Media programs now mount on
load and read current settings at Start. The upgraded media-tools suite uses
ordinary editable Page elements around a reusable `tt-media-pipeline` adapter;
legacy saved programs keep their sandbox and save Action.

Images run in the fixed, network-disabled worker through pinned local
ImageMagick/resvg WASM. Public engine assets load from the same origin, with no
selected bytes in requests. Outputs are WebP, JPEG, PNG, AVIF and GIF. Real HEIC,
TIFF, PNG/JPEG and GIF inputs were exercised in Chrome; BMP/ICO/TGA/orientation
and static SVG paths were additionally covered by real engine tests. Unsupported
APNG, multipage/layered files and unsupported SVG content fail explicitly.
Transparent JPEG needs a selected background; transparent GIF output is refused.

The animation regression came from comparing encoded update rectangles with the
full animation canvas. Verification now composites redecoded frames before
checking dimensions/alpha, while preserving strict frame count, timing and loop
checks. A generated four-state patch animation covers it. Installed intrinsic
blocks now enable their adapter only in interactive view mode, and instance IDs
keep duplicated native file labels independent. Mobile download instructions and
buttons have independent layout bounds.

## Verification

- Web Platform suite: 184 passed, one environment-gated real-API test skipped.
- API capability coverage/negotiation: 113 passed.
- Vercel policy/output configuration: 17 passed.
- Targeted lint: passed. Full TypeScript: 92 diagnostics, all in unchanged files;
  no diagnostic in changed files. No baseline was changed.
- Canonical production build/output verification passed; a final source rebuild
  is recorded in the PR validation status before handoff.
- Built Vercel handler manifest returned HTTP 200 and the requested origin with
  Things 1.41.0, Things update 1.12.0, webpages resolve 1.8.0, suite install 1.7.0.
- Isolated Chrome: enforced OS denial of external direct-IP and redirect traffic;
  fresh profile, no account/backend/database. Real encodes, independent Sharp/
  ffprobe checks, image alpha and animation, cancellation, errors, current
  settings, legacy immediate loading, duplicate labels, desktop and 390px mobile
  scrolling/layout passed. Screenshots/traces are task-local ignored evidence.
- Example PNG: 1,439,062 → 95,002 bytes, 640×480, alpha preserved. Video:
  3,910,557 → 198,455-byte H.264/AAC MP4 and 149,632-byte muted VP9 WebM.
  Small GIF/HEIC results were larger and reported that truthfully.

## Release acceptance still open

No primary-branch merge or production deployment was authorized. The live saved
page and installed app remain unchanged. Verify the intended account's actual
saved Page/Component in Builder: independently edit nested text/controls/preview,
save, reload, then exercise the live data/action path. The isolated runtime and
schema/block roundtrip tests do not prove that persisted production acceptance.

Public Character and Agent Overview capability negotiation succeeded. The
assigned Chrome profile's signed-in email was verified, but native address
navigation repeatedly failed to apply the exact reporting Page URL, including
through a fresh handle. No extension surface was connected. This is a control
failure, not evidence that the app or private workspace is broken. No Character,
coordination post or overview record is claimed. The task-created tab was closed;
pre-existing tabs and sessions were preserved. Child implementation/review
results above are parent-reported; no reporting IDs or usage estimates were
invented.
