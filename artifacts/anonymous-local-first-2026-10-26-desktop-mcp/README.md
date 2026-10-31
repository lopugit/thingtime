# Actual Codex desktop MCP acceptance — 26 October 2026

This chat called the installed unified **Thingtime MCP** through
`mcp__thingtime__thingtime_render_and_export`. The files below were extracted
from that real tool response's embedded resources, not a second SDK or HTTP
render. No conversation import, account write or publishing tool was called.

## Download the native output

- [Canonical editable Thingtime JSON](thingtime-draft.json)
- [Desktop, 1440 × 1000 CSS pixels](viewport-1440x1000.png)
- [Mobile, 390 × 844 CSS pixels](viewport-390x844.png)
- [Narrow mobile, 320 × 844 CSS pixels](viewport-320x844.png)
- [Card only, 400 × 560 pixels](card.png)
- [Exact tool arguments](request.json)
- [Host results, diagnostics, viewport metadata and artifact hashes](host-verification.json)
- [Current canonical validator and serializer checks](canonical-verification.json)
- [Post-call resource observation](cleanup-observation.json)

All PNGs use device scale factor 1. The reported text exactly matches every
requested line and blank line. Desktop card width is 400px; both phone widths
retain 24px margins. The actual desktop, mobile, narrow and crop images were
visually inspected. Every viewport reports no overflow.

Canonical JSON SHA-256:
`a251642fe58ef5b1a2f32f8414591e02d6d52ebd2a50293f6b14c12464d4a06c`.

Renderer bundle SHA-256:
`d56b0a8f26925ff24f7f6df4253a50dbdffc22a471b5eae363ee9ab897275467`.
The configured default renderer asset has the same digest. Checkout provenance
was `5c689057bf03804cfcb3d21738d3a4a095b18c67`; that identifies the source
checkpoint, not a claim that every application suite passed at that revision.

## Checks performed

- The real desktop host returned five embedded file resources and four image
  blocks. Saved PNG signatures, dimensions, byte lengths and SHA-256 hashes
  were checked independently.
- The exported file passed current `parseTransfer`, byte-identical
  `serializeTransfer`, and `prepareDraft` validation. Its component reference
  resolves to the included component. Exported Things contain portable fields
  only, with no invented account ownership or authorization.
- A real malformed-JSON tool call returned `isError: true`, an explicit invalid
  JSON diagnostic, and zero artifacts.
- A real missing-crop-target call returned `isError: true`, an explicit crop
  diagnostic, and zero artifacts. It did not return a partial screenshot set.
- After the calls, the configured isolated-render daemon had no containers and
  no asset volumes created since the source commit. Three older asset volumes
  predated these calls and were left untouched. This does not claim that all
  historical daemon resources were cleaned.

The normal importer and individually editable Builder checks have separate
[25 October native evidence](../anonymous-local-first-2026-10-25/render/import-verification.json).
The canonical JSON hash matches that fixture. Those checks were not rerun for
this host-connection and documentation milestone.

The updated HTML plan also passes its isolated 1440px, 390px and 320px browser
checks: full-page scrolling, filters, case-insensitive and empty searches,
footer access and no horizontal overflow. It shows 62 completed historical
checkpoints, 13 partial and 12 planned items; all 48 local links resolve.
[Plan results](plan/verification.json), [link checks](plan-links.json).
Graph refresh is structural; changed-document semantic indexing remains
unverified.

## Use from an agent host

Connect the existing `thingtime` stdio server as documented in
[MCP/README.md](../../MCP/README.md). Pass the contents of [request.json](request.json)
as arguments to `thingtime_render_and_export`. The `content` field contains the
full portable bundle; it is not a URL or a private-account reference.

The host receives embedded `application/json` and `image/png` resources plus
image blocks, metadata, diagnostics and the content hash. Resource URIs such as
`thingtime-draft://…/card.png` identify embedded payloads; they are not public
URLs and require no arbitrary HTTP access. Save the returned resource bytes to
make ordinary downloadable files, as done here. The fixture remains editable.

This proves the unified connection in this Codex desktop chat as well as the
earlier CLI-host proof. It does not prove another host's installation, installed
Thingtime app acceptance, current CI, a deployed preview, or the remaining
large-catalogue, instruction-editor, provider and device matrix. See the
[progress plan](../../docs/progress/anonymous-local-first.html).
