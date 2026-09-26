# PR #909 — Add reusable DOM receivers to Web standards programs

Branch: `codex/web-standards-dom-receivers`
PR: https://github.com/lopugit/thingtime/pull/909
Base: `main`, initially `111062f1abe96936e989ae2ca8245f5e4a02bc06`
Delivery state on 26 September 2026: draft PR; not merged or deployed.

## Problem and behavior

The catalogue previously marked document-dependent APIs as needing context.
Saved JavaScript programs ran in workers without DOM receivers. This change
adds 158 editable native DOM examples and a generic asynchronous `dom`
expression in the existing program compiler. The worker requests a detached
Document, calls registered members using run-local handles, and composes their
results with the existing JavaScript operations. Native mutations are projected
into the preview.

`domFixtures.ts` contains authored program data, not runtime feature dispatch.
The app remains the existing suite of Component, Action and Webpage Things.
The save-draft Action keeps the complete current program and edited parameter
defaults. No new persistence model, collection or native app block is added.

The fixtures cover Node, Element, Document, DocumentFragment, Text, Comment,
CharacterData, Attr, DOMTokenList, NodeList, HTMLCollection, NamedNodeMap and
applicable mixins. Factory calls are not labelled as constructor examples.
The catalogue has 2,437 interactive examples among 18,798 entries: HTML 227,
CSS 1,059, JavaScript 601, Web APIs 550. The remaining inventory includes
internal clauses, drafts and unfinished contexts; full coverage is not claimed.

Source: [WHATWG DOM Living Standard](https://dom.spec.whatwg.org/), checked
26 September 2026; the published page was last updated 24 September 2026.

## Runtime boundaries and semantics

`domBridge.ts` captures registered native prototype methods and accessors.
Its detached document owns every node; the visible surface never supplies a
handle. Script/resource elements, event/URL writes, raw markup setters and
unregistered properties are refused. Each run has request, handle, allocation,
depth, selector and text-work budgets. Detached clones spend the allocation
budget. The existing worker deadline is not extended by bridge requests.
Completion, cancellation and failure release the worker and its handle map.

Repeated handles preserve identity inside the worker. Native undefined returns
stay undefined. DOM exceptions remain catchable; a registered member missing
from this browser reports unsupported. A real handle from an earlier run fails.
The existing opaque frame CSP and account/network boundaries are unchanged.

This receiver is a detached document. The visible result is a projection;
window/layout state and coordinated live events are not implemented by this
batch. Existing visible `dom` event bindings are a separate context.

The catalogue Action contract advances `api.actions-run` to 1.13.0 in both
manifests, with the frontend requirement and exact-version regressions aligned.
Other storage, suite and browser Action grammar versions do not change.

## Validation completed locally

- All 158 authored DOM recipes ran successfully through the actual opaque
  iframe and worker in the Codex in-app browser. Inspected native results for
  insertion, reordering, text replacement/splitting, token toggles, attribute
  mutation and factory-created elements.
- Real-browser boundary checks refused window/defaultView and constructor
  access, script creation, event/resource attributes, markup setters, oversized
  text and a real previous-run handle. Detached cloning reached the allocation
  limit. Invalid selectors produced a catchable native SyntaxError.
- Workbench inputs changed to `Reusable DOM 🌈` and
  `{name} $input.other <b>literal</b>`. Run rendered the latter as literal text.
  Save created one private Component; exact authenticated API readback retained
  every program node/default. Anonymous GET returned 404. The saved Thing
  reopened, reloaded and executed correctly, then ran by Component ID in a
  separate page's Builder View mode.
- `test:web-platform`: 42 passed, including the opt-in real API suite/install,
  DOM catalogue/update/read, private ACL and JSON Action checks.
- `test:api-capabilities`: 83 passed. Both manifest assertions were updated
  after the version increase.
- Full build and Vercel output verifier passed. The temporary browser audit
  HTML was removed before the final build and is absent from output.
- Changed-file lint passes. Typecheck ratchet reports 89 existing baseline
  errors, with no increase; this is not a clean typecheck.
- All nine persistent task-owned local fixture Things were freshly checked
  and deleted through the canonical API. Temporary test tabs were closed.

## Remaining delivery work

Review the final PR diff and exact-head checks, verify the hosted preview,
merge with a normal merge commit under the user's existing main authorization,
then verify the production source and native DOM behavior on @lopu. The
production suite should not need a data migration for catalogue/runtime changes.

Graph structural extraction and the atomic graph/manifest snapshot were
refreshed; the new source files are present in both. A fresh semantic extraction
of changed documentation through the local LLM proxy remains to be completed.
No fresh documentation-semantic coverage is claimed yet.
