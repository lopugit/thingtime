# Unified MCP crop options and protocol completion — 26 October 2026

The normal installed `thingtime` MCP now exports valid downloadable artifacts
with card cropping either enabled or disabled. Explicit `cropEnabled` metadata
separates the requested artifact from measured geometry. Duplicate viewport
pairs fail before launch. A truncated worker protocol tail withholds artifacts,
including when an earlier response looked successful.

## Actual native output

- [Canonical editable Thingtime JSON](unified-cli-host/thingtime-draft.json)
- [Desktop 1440×1000](unified-cli-host/viewport-1440x1000.png)
- [Mobile 390×844](unified-cli-host/viewport-390x844.png)
- [Narrow 320×844](unified-cli-host/viewport-320x844.png)
- [Card-only 400×560](unified-sdk/card.png), from the crop-enabled SDK call
- [Actual CLI-host delivery proof](unified-cli-host/host-proof.json)
- [Crop-disabled extraction metadata](unified-cli-host/verification.json)
- [Crop-enabled native metadata](unified-sdk/verification.json)

All three actual render results have canonical JSON SHA-256
`a251642fe58ef5b1a2f32f8414591e02d6d52ebd2a50293f6b14c12464d4a06c`
and renderer SHA-256
`779bbe76a39123cd9578c3325ecfbf47e4c5d4c4e3802feb299c77d407abf0f3`.
The native tests verify exact affirmation wording, line breaks, dependency
closure, dimensions, phone margins and lack of overflow. The card and mobile
PNG were also visually inspected. The real CLI host returned four files when
cropping was disabled; the native crop-enabled call returned five. Crop
geometry remains present in both results.

## Verification

- MCP build/typecheck passed. The default MCP suite now includes extractor
  regressions: **60 passed, 3 explicit environment-gated skips**.
  [Unit output](checks/mcp-unit.log).
- Native unified SDK acceptance: **1 passed** in 81.6 seconds. This covers enabled
  and disabled crops, repeat canonical export, concurrency, invalid content,
  unsupported assets, invisible output, invalid crop/viewport and overflow.
  [Native output](checks/native-sdk.log), [run](unified-sdk/run.json).
- Actual ephemeral Codex CLI agent: capabilities and crop-disabled render passed;
  malformed input was refused without artifacts. The first invocation stopped
  before any tool call because its helper still disabled a removed legacy
  connection. Removing that invocation override fixed the run; installed host
  approval policy and credentials were unchanged. [Failure record](checks/cli-retired-server-override.json).
- Read-only preview serving at pre-follow-up revision `16984b13` returned HTTP
  200, matching branch/SHA, and canonical sandbox/no-store headers on normal
  and encoded draft-preview paths. [Serving evidence](checks/preview-serving-16984.json).
  This is not deployed browser or new-revision CI acceptance.
- [Earlier exact-head CI audit](checks/ci-baseline-16984.json) recorded Web CI and
  CodeQL still running; its exact observation time was unavailable. New pushed
  revision checks must be reported separately.

The HTML progress plan passed all filters, search, complete scroll traversal and
viewport checks at 1440/390/320px: 61 completed checkpoints, 14 partial and 12
remaining. [Plan evidence](plan/verification.json). No private coordination
update was made: this session has no authenticated Character/workspace access.

The unchanged normal importer and individual Builder editing have earlier
native evidence; they were not rerun for metadata/framing-only changes. The
renderer continues to use caller-provided content in a bounded network-none
container, without account data or publication. The installed desktop chat's
unified tool namespace remains a separate incomplete host check.

Usage: call `thingtime_render_and_export` on `thingtime` with the canonical
fixture as `content`, `root: "affirmation-page"`, the requested unique
`viewports`, and `crop: { enabled: false }` (or `true` with `blockId: "card"`).
Use `MCP/scripts/save-render-artifacts.mjs EVENTS.jsonl NEW_DIRECTORY thingtime`
for the actual CLI event result; resource URIs are embedded artifacts, not
public download URLs. See [the MCP connection instructions](../../MCP/README.md).
