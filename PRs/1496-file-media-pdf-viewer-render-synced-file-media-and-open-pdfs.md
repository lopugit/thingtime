# PR 1496 — Render synced file media and open PDFs inside Thingtime

13 November 2026 · `codex/file-media-pdf-viewer` · [PR](https://github.com/lopugit/thingtime/pull/1496)

## Problem and result

Synced File Things retain a versioned `content.attachmentId`; their attachment list is empty. Library grids and generic Thing detail previously missed this reference and displayed an icon or raw data. The original attachment bytes remained readable. The shared file adapter now resolves the authorized exact attachment, checks its parent and size, and supplies an explicit embedded media Component. Both Names and Previews show thumbnails; file detail and quick look render media.

PDF attachments now open inside Thingtime with page navigation, zoom, fit width, selectable page text and download. Detection uses canonical MIME metadata, including verified PDFs stored as `application/octet-stream`. The PDF.js worker, fonts and decoders are self-hosted. Documents load near the viewport using the canonical fingerprint and version-pinned range API. Encrypted PDFs and failed reads retain an error/retry/download path; this feature does not promise PDF editing, forms or search.

## Boundaries and review fixes

- Preserve explicit authored renderers, archived metadata-only rows, authorization, selected Character, identity teardown and shared-media access.
- Ordinary Builder elements own each PDF control. `api.things` 1.66.0 and `api.things-update` 1.30.0 advertise the additive element grammar; both manifests and client negotiation agree.
- A canonical local `src` is the sole PDF byte identity. Dependency discovery and private copying rewrite that same source; stale metadata IDs cannot override it. Missing/external/ambiguous sources are refused, and independently composed viewers have unique block IDs.
- Regression checks caught and fixed array bindings that produced blank full previews, filtered-out toolbar attributes, missing Character headers, stale page errors and a Vite-specific worker import rejected by Nitro.
- Original user files and attachment bytes are unchanged. No native app or sync implementation changes are included.

## Main integration

The branch integrates main's agent-board update (`e640a5559`). Its saved-source
retention grammar remains at the independently published Things 1.65 / update
1.29 and Webpage resolution 1.20 contracts; agent overview remains 2.2. PDF
primitives advance Things to 1.66 / update 1.30 so PDF clients reject the earlier
board-only deployment. Both schema additions and their independent tests remain.

The release branch also integrates main's Commander fix (`451e79e72`) and MCP
result-card host initialization (`b530d760a`). The latter's independent
`api.chatgpt-mcp` 2.2.1 contract and regression tests are preserved alongside the
PDF contracts. Media and PDF implementation files are unchanged by these merges.

The final integration includes main `a9f0639bf` (parent-path pins and bounded
capability/gateway revalidation), together with the resolver-authored gateway
protection patch `1c91932fa`. Upstream gateway/capability implementations already
contain the protection behavior and remain intact; distinct original regression
tests are preserved. PDF write gates coexist with pin APIs and their tests.
The same actual-media/PDF browser fixture was rerun against this integrated tree.

Main subsequently advanced through retained-preview maintenance PR 1513
(`b3c82023a`). Its trusted caller inputs, immutable maintenance artifacts and
acceptance-script corrections are preserved. This merge changes no application
media/PDF, API or UI implementation, so the passing integrated runtime evidence
above remains applicable; its workflow caller contract is checked separately.

## Verification

- Final integrated Things suite: 378 tests plus 35 projection tests passed.
- Final integrated API capability suite: 201 tests passed; gateway discovery/relay suite: 24 passed. Earlier focused media, source-retention and schema suite: 29 passed.
- Merged-tree TypeScript check passed with no diagnostics. Targeted lint had zero errors and existing `useApi` warnings.
- Final integrated client and server builds passed. A real HTTP smoke of that compiled server verified Things 1.66.0 and update 1.30.0 on both manifests and endpoint docs, without database writes or production credentials.
- The merged-tree actual PDF.js/React browser fixture passed at 1280×900 and 390×844: Names/Previews thumbnails, full image pixels, page/zoom/fit/text controls, range reads for a document over 256 KiB, Character header/query identity, refusal and retry, individual Builder selection/edit/save/reload, full-page scrolling and overflow checks.
- Browser API data was synthetic and isolated. This is browser viewport coverage, not physical iPhone acceptance. Real production image/PDF acceptance remains a release step and is recorded in the PR delivery status.

The first merged server build hit `ENOSPC` while writing a Workflow bundle. A verified failed fixture build directory was removed; after free disk space recovered, one rebuild and compiled smoke retry passed. No source workaround or user-data cleanup was used.

Private lifecycle reporting could not initialize: the workspace ACL reached its 64-entry limit and the partial binding then refused Character access. No alternate public reporting identity or duplicate task was created.

Before main integration, Graphify semantic extraction was attempted through the local proxy but expanded to 120 chunks for the existing large documentation. It was stopped as a slow indexing step; structural graph, report, manifest and HTML outputs are refreshed after integration. Changed Markdown semantic coverage is not claimed.
