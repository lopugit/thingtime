# PR 1164 — Reusable local-media and editable Builder primitives

[Pull request](https://github.com/lopugit/thingtime/pull/1164) · `codex/general-media-compressor` → `develop`

## Scope — 2026-10-23

The framework accepts `tt-media-pipeline` as a validated intrinsic container with individually editable authored child blocks. It binds file selection, current settings, progress, cancellation, image/video previews and transient downloads to the fixed network-disabled media worker. New compressor Pages and Components must be authored directly as private saved Things in Thingtime. No new compressor template or suite upgrade ships in the application. The existing media-tools suite and video program are preserved. Acceptance-only fixtures live under scripts/media-acceptance and are outside the application import graph.

Pinned ImageMagick/resvg WASM adds local image processing alongside WebCodecs video conversion. Image output verification covers dimensions, alpha, animation frames/timing/loops and explicit unsupported cases. Worker CSP permits only its required WASM compilation; selected bytes are never uploaded. Storage/resolve compatibility is Things 1.41.0, update 1.12.0 and resolve 1.8.0. Suite install remains 1.6.0.

## Current verification

- Focused Web Platform, Builder block roundtrip, file-sync configuration and capability suites: 308 passed, one environment-gated test skipped.
- Fixed the observed CI failure: file-sync discovery assertions now use compatible capability negotiation instead of pinning api.things exactly to 1.40.0.
- Canonical production build and Vercel configuration validation are recorded in the release handoff.
- Before this scope correction, isolated Chrome real-image/video acceptance passed desktop/mobile layouts, animation/alpha, independent Sharp/ffprobe output inspection, cancellation, duplicate instances and legacy immediate loading. These are local adapter results, not production saved-Things acceptance.
- Full TypeScript previously reported 92 diagnostics in unchanged files; that earlier result is historical, not a new measurement.

## Release boundary

The parent chat owns the authorized develop → main release, direct saved-Things authoring and installed/deployed Builder acceptance. This child only reconciles the feature branch and PR; it performs no primary-branch merge.
