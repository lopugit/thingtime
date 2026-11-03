# PR 893: Reusable record controls and browser Action composition

This framework increment lets an ordinary saved Component retain its source Action and compose record forms, reference pickers, maps, and attachment workflows. The opt-in local authoring fixture produces 45 editable Action/Component Things. It is not a production page migration.

## Changes

- Component sources survive create and update validation; page overrides retain precedence.
- Browser Action protocol 1.9 adds bounded `each` and configurable expression budgets shared with child Actions. Protocol 1.8 clients fail before executing these programs.
- Reusable `tt-form` captures operation identity and the original revision. `tt-select` searches/pages already-authorized source choices. `tt-map` renders supplied coordinates. `tt-attachments` and `tt-media` reuse the existing attachment lifecycle and gallery.
- Internal template links use client navigation. Drawers close on followed links. Populated textareas no longer crash from conflicting value/children props.
- The Action composer exposes each/expression-limit shortcuts; `/docs/builder` documents the controls and contracts. Existing native workspace rendering remains a compatibility path while conversion is unfinished.

## Validation

- Focused renderer, Actions, Builder, schemas, and capability suite: 457 passed, one opt-in integration test skipped. Actions suite: 141 passed, one opt-in test skipped. Capability suite: 82 passed.
- Live Action verification: 99 passed, including owner/private boundaries and foreign delegated refusal. GUI-created browser loop executed its child and returned the selected reference.
- Typecheck ratchet: 89 existing errors, at baseline; no changed-surface errors. Changed-file lint: no errors; existing compatibility-map/registry warnings and explicit map callback/URL guards reviewed.
- Full Vercel/Nitro build and output verification passed. Built Nitro handler returned JSON, the selected origin, and `api.actions-run` 1.9.0 / `api.things` 1.30.0 / `api.things-update` 1.7.0.
- Disposable local replica-set API: all 45 definitions persisted, source binding read back, new customer retries retained one ID, stale edit and retry returned 409 without overwriting the concurrent edit. Protocol 1.8 preparation returned 409; 1.9 returned 200.
- Chrome desktop and 375px: forms, populated textarea, drawer navigation, planner scroll, 181-choice search and paging, selection beyond the visible page, and upload/save/reload. The downloaded test attachment matched the source bytes. All fixture records and upload bytes are synthetic.

## Remaining conversion work

No live page, production record, or ACL has been changed. Before replacing the old workspace block, complete team/collaborator execution without borrowing author authority; address selection; image/banner selection; full planner and linked-record flows; scalable server-side data selection; media grouping; and a staged migration preserving the HQ page and separate eight-item equipment register. Google Maps provider-positive browser checks require the owner's configured key and are not claimed by coordinate/mock tests.

Local URL: http://localhost:17120/p/qa-editable-builder-page. Reference picker: http://localhost:17120/p/qa-reference-page. Tailscale/Funnel is unavailable because the installed shim targets a missing application binary. Preview and exact-head CI evidence will be recorded after publishing.

Graphify incremental structural and semantic extraction completed. It reported a cross-document ID collision for the historical PR 68 node shared by the changelog and PR note; one duplicate graph node was dropped. Product code is unaffected.
