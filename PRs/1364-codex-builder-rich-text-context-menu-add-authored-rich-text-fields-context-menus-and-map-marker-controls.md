# PR 1364 — Authored rich fields, context menus and map marker controls

[Pull request](https://github.com/lopugit/thingtime/pull/1364) · branch
`codex/builder-rich-text-context-menu` · integrated base
`9afdc97ad`.

## Behavior and composition

- `tt-rich-text` uses the shared Editor.js editor and safe read renderer. A
  named JSON value and optional `plainTextName` come from the same awaited save
  snapshot. Legacy strings stay literal text; an explicit empty document clears
  both values. Authors must bind `resetKey` to changing record identity, while
  equivalent source refreshes preserve a dirty draft.
- Context-enabled `tt-menu` composes editable target/content slots and a sibling
  ordinary trigger. Pointer context menus, ContextMenu/ShiftF10, touch access,
  viewport positioning, focus and dismissal reuse native top-layer behavior.
  Content remains mounted during form capture; closed authored grid/flex slots
  cannot expose menu contents.
- `tt-mapbox` supports a base marker scale, optional actual SDK zoom adaptation,
  and explicit authored grouping keys. Groups retain original authorized member
  rows, IDs, roles, selection and commands. Geometry and fit points remain
  independent. Native colored faces scale inside transparent 44px targets.
  Route fallback ordinals count unresolved rows before filtering; temporary
  optimization fills the resolved itinerary slots, and explicit labels win.
- Actions retain typed validation while dropping the fixed 16-descriptor ceiling.

The framework contains no private application definitions. Private schemas,
Actions, menu commands and pages are composed and reviewed separately.

## Shared Builder document boundary

Actual BuilderViewport acceptance exposed two boundaries that ordinary page
fixtures missed. Editor.js internally uses realm globals, so foreign holders
load the same core and standard tools through a fixed bundled library entry in
that document. A persistent per-document factory and cached promise support
concurrent consumers, failure/reopen and timeout followed by late completion.
Selection, custom styles, panels and keyboard/scroll listeners follow their
owning document; remount fences and teardown remain active.

React portal Actions also crossed a document boundary that `DOM.contains`
cannot traverse. The shared ownership helper follows actual same-origin
frameElement ancestry and refuses unrelated, inaccessible or cyclic chains.
Server-side Action authorization and account/origin fences remain unchanged.

## Verification

- Client and Nitro node-server builds pass on the combined base. Raw TypeScript
  and its ratchet report 0 errors. Targeted lint reports 0 errors with 101 warnings
  across the existing large shared modules.
- Actions: 165 passed/1 skipped; schemas: 300 passed; webpages: 223 passed/4 skipped;
  editor: 104 passed/1 skipped; components: 52 passed; capabilities: 140 passed;
  maps: 33 passed. Skipped existing integration cases remain explicitly skipped.
- The disposable replica/API/browser fixture creates an 18-input saved Action
  and verifies 16 writes: desktop/mobile, page/actual Builder iframe, rich
  and ordinary menu forms. It covers hidden latest defaults without an SDK, required-field refusal, collapsed dirty draft retention, and types/formats and immediately saves, checks one
  write per click, independently reads exact JSON/plaintext/native values, and
  reports zero page errors. Test accounts, data, profiles and processes are
  isolated and cleaned up.
- Synthetic map SDK desktop/mobile checks cover native face centering and scale,
  44px targets, marker composition/editability, grouping, original ordinals,
  selection, local state and iframe ownership. They do not establish provider
  geocoding or navigation results.
- Fresh production-bundle warm-pagination checks on the private composition keep
  ten hidden SDKs deferred: 16 correct transitions, zero long tasks, desktop DOM
  median/max 22/25 ms and mobile 22/24 ms. Two-RAF rendering opportunities were
  31/71 ms and 27/72 ms; these are browser timing proxies, not provider or
  production database latency. The three changed rich-control file hashes match
  the measured source bytes.
- Editable rich fields reserve a visible control before their first intersection.
  Hidden untouched values submit the current default without an editor engine;
  once opened, the engine and dirty draft survive collapse until record reset.
  The mobile touch fixture explicitly closes its asserted required-validation
  toast before the next control; that toast had intercepted the earlier tap.

Capability contracts: `api.things 1.50.0`, `api.things-update 1.19.0`,
`api.actions-run 1.41.0`, `api.webpages-resolve 1.12.0`, `api.maps 1.2.0`.

## Publication and graph evidence

GitHub receive-pack repeatedly returned `fatal error in commit_refs_rules`,
including on source-only content, both SSH/HTTPS and an existing feature ref.
The effective feature-branch rules were empty; no policy violation was returned.
The supported Git Data API uploaded the exact source tree and commit and
advanced only the feature branch with an expected-head check and `force:false`.
Main protection, authorization scope and required checks were not changed.

For the final graph, base64 blob upload returned HTTP 401 (the object was absent
while the existing API session remained valid). Supported UTF-8 reduced the
request but returned HTTP 422 input-too-large with explicit guidance to push
from a local clone. One normal non-force push on the established feature ref
then published the exact source and active graph successfully. A subsequent
main attachment-range release required only a changelog conflict union; the
measured rich-control runtime bytes remained unchanged.

A scoped semantic attempt over the five changed large documents required 128
slices. It was interrupted when the independent base advanced; partial work was
never activated. The verified structural snapshot and HTML cover current source;
large changed documents are not claimed as fully semantically reindexed. The
small PR-note semantic attempt also stalled after AST extraction with no active
proxy request and was stopped before activation. The final structural update
retains portable graph/manifest/HTML output; no new semantic coverage is claimed.
