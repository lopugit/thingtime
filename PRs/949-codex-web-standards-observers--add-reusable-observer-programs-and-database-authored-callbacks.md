# PR 949: reusable observer programs and authored callbacks

Adds 81 indexed MutationObserver, ResizeObserver and IntersectionObserver programs. Callback functions, projections, DOM mutations and options are ordinary editable data in reusable Component Things. Coverage reaches 4,639 of 18,798 entries; 14,159 remain.

The existing worker/DOM bridge registers authored `dom-callback` functions and bounded synchronous member batches. Batches preserve native MutationObserver queue semantics, use the same receiver/member checks and reject asynchronous operations before invocation. Errors stop subsequent commands without rolling back earlier changes.

Targets and roots belong to the current run. Native observer/record handles retain identity. Completion, Stop, errors and the unchanged two-second deadline disconnect resources. These examples capture observations during a run, without persistent background subscriptions. Missing browser fields/constructors report unsupported, including errors originating inside callbacks. Both capability manifests and the client negotiate actions-run 1.30.0.

Validation on 2026-09-27:

- 144 platform tests passed, with one opt-in integration skipped. 86 capability tests passed.
- Full app build and Vercel output verification passed; targeted lint passed. Fresh baseline/branch TypeScript comparison: 91 existing diagnostics each, none introduced.
- 2,199 local native browser checks: 2,001 passed, 198 unsupported, zero failures. Includes all 81 default/edited observer programs, 19 semantic/isolation boundaries and existing DOM/form/Canvas/SVG/filter/CSS/Typed OM/CSSOM/layout regressions.
- 24 edited programs round-tripped through catalogue Action and private Thing APIs. Installation was idempotent; anonymous reads returned 404.
- Actual Builder workbench: size changed to 130, native callback reported 130, saved as a private Component, reopened and fully reloaded with the same result. Referenced that exact Component from a second private webpage and observed 130 again. Stop removed the frame; fresh Run succeeded. Desktop and 390px views have no document overflow; mobile frame is 375px including the scrollbar layout.
- Structural graph regenerated. Existing semantic extraction availability remains unverified.

Synchronized with main's Mac voice retry/silence changes; preserved their source and testing/changelog entries. Generated graph conflicts are resolved as one complete snapshot set before refreshing the combined tree.

Primary references: [DOM Living Standard](https://dom.spec.whatwg.org/#interface-mutationobserver), [Resize Observer](https://www.w3.org/TR/resize-observer/) and [Intersection Observer](https://www.w3.org/TR/intersection-observer/).

Preview/production delivery receipts will be added to the PR after verification.
