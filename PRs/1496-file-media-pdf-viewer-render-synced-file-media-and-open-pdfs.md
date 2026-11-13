# PR 1496 — Render synced file media and open PDFs inside Thingtime

13 November 2026 · `codex/file-media-pdf-viewer` · [PR](https://github.com/lopugit/thingtime/pull/1496)

## Problem and result

Synced File Things retain a versioned `content.attachmentId`; their attachment list is empty. Library grids and generic Thing detail previously missed this reference and displayed an icon or raw data. The original attachment bytes remained readable. The shared file adapter now resolves the authorized exact attachment, checks its parent and size, and supplies an explicit embedded media Component. Both Names and Previews show thumbnails; file detail and quick look render media.

PDF attachments now open inside Thingtime with page navigation, zoom, fit width, selectable page text and download. Detection uses canonical MIME metadata, including verified PDFs stored as `application/octet-stream`. The PDF.js worker, fonts and decoders are self-hosted. Documents load near the viewport using the canonical fingerprint and version-pinned range API. Encrypted PDFs and failed reads retain an error/retry/download path; this feature does not promise PDF editing, forms or search.

## Boundaries and review fixes

- Preserve explicit authored renderers, archived metadata-only rows, authorization, selected Character, identity teardown and shared-media access.
- Ordinary Builder elements own each PDF control. `api.things` 1.65.0 and `api.things-update` 1.29.0 advertise the additive element grammar; both manifests and client negotiation agree.
- A canonical local `src` is the sole PDF byte identity. Dependency discovery and private copying rewrite that same source; stale metadata IDs cannot override it. Missing/external/ambiguous sources are refused, and independently composed viewers have unique block IDs.
- Regression checks caught and fixed array bindings that produced blank full previews, filtered-out toolbar attributes, missing Character headers, stale page errors and a Vite-specific worker import rejected by Nitro.
- Original user files and attachment bytes are unchanged. No native app or sync implementation changes are included.

## Verification

- Things suite: 356 tests plus 35 projection tests passed.
- API capability suite: 182 tests passed; focused media/presentation suite: 9 passed.
- Final TypeScript check passed with no diagnostics. Targeted lint had zero errors and existing `useApi` warnings.
- Client and server builds passed. A real HTTP smoke of the compiled server verified both manifests and endpoint docs at the declared versions, without database writes or production credentials.
- Actual PDF.js/React browser fixture passed at 1280×900 and 390×844: Names/Previews thumbnails, full image pixels, page/zoom/fit/text controls, range reads for a document over 256 KiB, Character header/query identity, refusal and retry, individual Builder selection/edit/save/reload, full-page scrolling and overflow checks.
- Browser API data was synthetic and isolated. This is browser viewport coverage, not physical iPhone acceptance. Real production image/PDF acceptance remains a release step and is recorded in the PR delivery status.

Private lifecycle reporting could not initialize: the workspace ACL reached its 64-entry limit and the partial binding then refused Character access. No alternate public reporting identity or duplicate task was created.

Graphify semantic extraction was attempted through the local proxy but expanded to 120 chunks for the existing large documentation. It was stopped as a slow indexing step; the final structural graph, report, manifest and HTML were refreshed. Changed Markdown semantic coverage is not claimed.
