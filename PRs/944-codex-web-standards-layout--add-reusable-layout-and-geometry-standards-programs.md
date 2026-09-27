# PR 944: reusable layout and Geometry programs

Adds 149 ordinary editable programs: all 130 CSSOM View entries and 19 remaining Geometry entries. Coverage reaches 4,558 of 18,798 inventory entries; 14,240 remain. This is incremental coverage, not a claim of complete web-platform support.

The existing worker bridge gains closed layout dictionaries, read-only Window metrics, document scrolling metrics, owned hit tests, Range/caret/quad/rect-list receivers and native matrix parsing. Runtime document and Window receiver handles stay unavailable. Owned shadow roots can replace their content for caret tests. Native prototype-chain capture supports WebIDL mixin accessor layers without reading shadowing instance properties.

Element and Window scroll operations await native completion and project only supported ScrollResult fields. Saved event bindings support native media-query/visual-viewport targets, legacy add/removeListener cleanup, IDL handlers, and explicitly synthetic bounded native event descriptors. Mouse receipts include real coordinate fields. Stop/deadline fences remain shared. Both actions-run capability manifests and the client gate require 1.29.0.

Validation on 2026-09-27:

- 139 platform unit tests passed; one opt-in integration test skipped. The disposable API integration passed separately and cleaned its own fixtures.
- 85 capability tests passed; 24 edited programs round-tripped through the catalogue Action and private Thing APIs with anonymous 404.
- Full app build and Vercel output verification passed. Targeted lint passed. Fresh TypeScript baseline and branch both have 91 existing diagnostics, with none introduced.
- Opaque local browser audit: 2,018 checks, 1,840 passed, 178 unsupported, zero failures. Includes existing CSSOM, Typed OM, CSS, SVG/filter, Canvas, DOM/form regressions and 16 new isolation/geometry boundaries.
- Saved Element.scrollTo with left=60/top=90, reopened, fully reloaded, ran and observed native 60/90. Reused its ordinary Component reference on a second private webpage. Verified anonymous 404, Stop removes iframe, fresh Run, and 390px layout (343px frame, no document overflow).
- Native mousemove and VisualViewport resize receipts are isTrusted=true. Synthetic media-query change is isTrusted=false; removing the exact legacy callback prevents further receipts.
- Structural graph refreshed. Semantic extraction was attempted through the configured local proxy; all six chunks failed with 502 codex_execution_failed. No semantic freshness claim.

Primary references: https://drafts.csswg.org/cssom-view/ and https://www.w3.org/TR/geometry-1/. Screen values and iframe move/resize behavior remain browser-controlled; absent APIs are explicitly unsupported.

Preview/production delivery receipts will be added to the PR after verification.

Synchronized with main after PR #945 landed. Preserved its voice-input source and both changelog/testing entries; resolved generated graph conflicts by selecting one complete snapshot set and regenerating the structural graph for the combined tree.
