# PR 1024: reusable local video compression

The `media-tools` suite installs ordinary owned Page, Component and Action Things.
The Component's `tt-web-platform` program keeps document, CSS, parameters, media
control selectors and encoding settings editable as data. The existing save-draft
Action saves that program and current defaults; file and output bytes are transient.

## Runtime and review

`mediaPipeline.ts` validates declarative controls and settings. `liveMediaPipeline.ts`
binds the opaque frame's local picker, progress, cancel and preview. The
`hostMediaPipeline.ts` bridge accepts only the active frame/run, resolves settings
from the host's validated snapshot, and owns one terminable worker. The fixed
`mediaWorker.ts` uses pinned Mediabunny 1.61.6 and WebCodecs to decode, resize,
encode and mux a selected Blob. No arbitrary source, URL, account authority or
codec download crosses the bridge. `mediaExport.ts` validates output MIME and
filename before a user-clicked Blob download; cleanup revokes local URLs.

The first real browser run exposed that WebCodecs is unavailable in opaque
iframes. Moving only the trusted worker to the secure host fixed the failure;
the editable frame never gained same-origin permission. Its worker response CSP
denies network and child workers. Both Vite and Vercel supply that CSP; the built
output verifier asserts header ordering and the emitted worker asset. Browser
layout checks also caught a clipped preview, fixed with run-scoped frame sizing.

Only primary video and audio survive conversion; metadata, extra tracks and
subtitles are omitted. Unsupported codec/audio paths fail explicitly. Memory
and codecs depend on the device; smaller output is not guaranteed. Cancellation,
source replacement, run replacement, navigation and account remount fence late
results and terminate work. No artificial media size/duration quota is added.

The suite capability is `api.webpages-suites-install` 1.4.0 on both manifests,
with a matching client requirement. Shared Builder docs and all Lopu base-prompt
paths instruct capability discovery before claiming support or impossibility.

The first CI run exposed a documentation test that treated the first guide
section as a schema. It now selects the actual getting-started section by its
stable ID and still validates that example through the real saved-Thing grammar.

## Verification before merge

- Full production build and Vercel output verification passed after updating to
  main 038cd7bae. Web Platform: 168 pass, one existing opt-in skip; suite shape,
  binding and controls: 8 pass; capabilities: 95 pass; deployment/CSP: 17 pass;
  Lopu prompt: 5 pass.
- The durable `remix/scripts/media-acceptance/` flow uses a fresh Chrome for Testing
  profile and static fixture containing the actual WebPlatformSurface. OS egress
  allows only its loopback port; backend direct-IP, redirect and browser probes
  fail closed before acceptance. It has no API server, account or database.
- Synthetic 4-second 1280x720 input: 3,910,557 bytes. At 640x360 and 350 kbps,
  actual output was 200,267-byte VP9/Opus WebM, 198,455-byte H.264/AAC MP4,
  and 149,632-byte VP9 WebM with audio explicitly removed. Independent ffprobe
  verified codec, dimensions, duration and track presence. Playback advanced.
- Invalid input clears downloads; cancellation and Stop prevent late output;
  reruns preserve edited defaults in the saved JSON. Desktop and 390px views,
  full-page scrolling and the opened JSON editor passed with screenshots/trace
  retained in ignored `remix/tmp/media-acceptance/`.
- Repository-wide TypeScript checking reports 91 errors outside changed files;
  no changed-file diagnostics. This is not represented as a clean typecheck.
- Production session identity was verified as @lopu. Deployment/install,
  save/reopen and production encoding results are recorded in the PR description
  after deployment. Local fixture success alone does not establish those results.

The earlier standards traversal PR 962 was already merged. This PR completes
only the compressor and capability-discovery scope; the broad standards backlog
and progress plan remain paused.
