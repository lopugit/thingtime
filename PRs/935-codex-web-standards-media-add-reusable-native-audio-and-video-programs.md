# PR #935 — Add reusable native audio and video programs

2026-09-27. Branch `codex/web-standards-media`, base `main`.
The user explicitly requested ongoing merges into main and production @lopu delivery.

## Delivered behavior

95 ordinary saved media programs replace 89 missing-context entries and improve
six HTML attribute examples. Coverage becomes 3,273/18,798: HTML 301, CSS 1,059,
JavaScript 890, Web APIs 1,023. Program documents/styles/inputs/bindings include
original one-second PCM audio and four-second H.264 purple/teal video bytes.
No per-demo native component, source-code escape or external media request exists.

Closed property reads/writes operate on native media receivers and own typed
scalar inputs. Resource URLs are bounded local payloads. Native time ranges,
media errors, constants and video quality are projected; permission-dependent
capture, devices, DRM, text tracks and frame callbacks remain unfinished.

Dynamic muted content attributes do not set current mute; explicit saved setters
establish it before playback. Native playback promises show pending/fulfilled/
rejected state, remain visible through later events, and cannot overwrite newer
commands or stopped runs. Cleanup pauses media. Eight media elements, 200 DOM
operations and twenty recent events bound each run. Runtime CSP stays unchanged.

Both manifests and the client negotiate `api.actions-run` 1.22.0.

## Validation evidence

- Platform tests: 113 pass, one opt-in skipped. Capability tests: 83 pass.
- Separate real disposable API audit: all 95 edited programs survive exact
  private write/readback; suite install creates seven Things then zero on retry;
  authored save-draft passes; anonymous reads return 404. Temporary per-program
  and save-draft records removed; seven suite records retained for UI acceptance.
- Initial browser audit: 105/105 pass. Includes all media IDL handlers with real
  native triggers, decoded resources, seek, setters, native error bounds,
  rejected playback and stale-promise fencing. Four additional resource/receiver
  boundary checks are included for hosted acceptance.
- Real pointer Play produced fulfilled playback with muted=true and volume=0.2.
- Local Builder saved `81d001b5-5190-48dc-8c18-4672e94fdfce` with time=2.5,
  rate=1.25, volume=0, muted=false; reopen/reload/run preserved the values and native seek/speed readback.
  The exact eight disposable UI/suite Things were removed after owner readback
  and anonymous 404. Desktop frame 918/918 and mobile 356/356 have no horizontal
  overflow; the last mobile control was clicked successfully.
- Targeted lint clean. Typecheck at 89 existing errors, no new diagnostics.
  Full app build and Vercel output verifier passed.
- Local Nitro worker was terminal after a V8 native module-parser crash while
  its PM2 parent stayed online. Restarted only this checkout through `web-pms`,
  preserving its prior environment and ports. Health confirmed disposable Mongo
  host 127.0.0.1:18733 before any fixture mutation.

Additional local audit: 108 passes and one truthful unsupported fastSeek out of
109 checks, including external resources, wrong receivers, readonly properties
and the eight-media limit. Existing events: 163 passes plus one deliberate
unsupported result. A further race check reproduced a pending play overwriting
an immediately refused newer attribute command; command generation now advances
before argument resolution or permission checks. Hosted audit includes that case.

Structural graph refreshed. Semantic extraction was attempted through the healthy
local Codex proxy; all six chunks failed with 502 `codex_execution_failed`.
The structural snapshot remains usable; semantic freshness is not claimed.

Final hosted source SHA, required checks, graph evidence, deployment status,
production save/reload/privacy and exact fixture cleanup are recorded in the PR
body after verification. The full standards goal remains active.
