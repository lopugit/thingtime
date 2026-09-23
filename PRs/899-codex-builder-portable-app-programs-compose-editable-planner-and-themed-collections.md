# PR #899: Compose editable planner and themed collections

The editable HQ migration still depended on fixed row rendering and lacked the original planner controls. This change makes collection rows, inherited appearance, field changes and drag/drop configurable in saved Component Things, with ordinary saved Actions for date and ordering updates.

## Implementation

- Deferred collection templates preserve row data, nested rendering budgets, action references and authored media when shared or copied.
- Scoped CSS uses inherited theme variables and the browser cascade. Components and separate app instances can override appearance independently.
- Change controls debounce configured scalar values and cancel stale bindings. Drag/drop controls exchange bounded scalar inputs only within the matching group and viewer context.
- Bounded `indexBy` and `groupBy` expressions avoid repeating large planner templates. The planner controls and board are separate saved Components; signed definition previews remain within the existing limit.
- The authoring factory restores relationship labels, form selection behavior, planner date/order controls and the original 5/10/15/20/infinite page sizes.
- Action execution protocol 1.11 and Things 1.32/update 1.9 distinguish these additions from the Web standards release. Existing clients retain their supported contracts.

## Validation

Before the latest develop merge: client, library and embed builds passed; typechecking matched the existing 89-error baseline; changed-file lint and whitespace checks passed. Focused suites passed after correcting stale capability expectations. A wall-clock split-performance assertion is sensitive to load on this workstation.

After merging develop: all 204 focused tests pass in one serial run. Real local API checks saved 53 definitions, copied all 54 page/definition Things, denied foreign Action execution, denied reads after team revocation and restored the synthetic membership. Chrome verified copied-app planner ordering, date changes, drag/drop between days, status filtering, visit creation, job-title defaults, preservation of typed titles and dialog completion. Desktop and 390px checks cover overview, planner, customers and the visit form. Production HQ has not been changed by this PR.

## Platform rollout

The source change enables reusable primitives; it does not migrate saved Things. Apply and verify the saved definitions separately, preserve the existing HQ page identity and access rules, retain the eight-item gear register, and compare against the existing original-reference page before completing rollout.
