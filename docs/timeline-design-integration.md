# Timeline design integration — 2026-09-29

Source: Fable 5.1's [PR #947](https://github.com/lopugit/thingtime/pull/947),
`claude/thingtime-timeline-browser-5173ff` at
`71df35a634807ca583c37219b7118df3bd2b32a5`. The two interactive concepts and
their follow-up notes were inspected. This implementation builds on `main`;
it does not merge the concept's older `develop` baseline or fictional records.

## Working design mapped to the existing core

| Design | Implementation |
| --- | --- |
| One History browser | `/history`, the Timeline folder and Thing History use `TimelinePanel`, `TimelineEventBrowser`, `useThingTimeline` and the existing scoped connection pool. Things navigation links to History. |
| Scope × Look | Everything and This Thing; List, Cards, Line and Frames share selection and detail. Global route filters are in the URL; the contextual modal keeps its state locally. |
| Historical cards | Titles, kinds, field summaries and change chips derive only from retained snapshots. Deleted events show the previous content. Unknown/compact/split content is not replaced with today's Thing. |
| Horizontal evolution | Oldest accepted event first; alternating Cards/Line labels, Frames summaries, bounded time/even spacing, dashed variation rows, progress spine, viewport minimap, scrub slider, explicit Play/Pause and arrow/Home/End navigation. |
| Contextual details | Desktop side panel and mobile bottom sheet use the existing Chakra modal/layer primitives. Before/after data, ancestry, inert recorded page preview, restore and merge remain the same actions in all looks. |
| Compare any two | Read-only snapshot comparison for the same owner/Thing, including variations. Unsupported compact/split or mismatched adapters explain that reconstruction is needed. |
| Property changes | Stable page block IDs expose component argument edits and order changes for presentation; ordinary arrays remain atomic in the merge contract. Ambiguous/large trees fall back to bounded structural summaries. |
| Friendly variations | Try a variation, Get latest changes, Send selected version and Review and combine wrap the existing durable branch commands, conflict handling and Builder editing. |
| Honest sync | Row badges distinguish local pending events from server-receipted events. Existing account/origin/database partitioning, local outbox and remote paging/polling are unchanged. |
| Restore the rendered version | Recorded direct components are copied privately for the restored page in the same transaction as the page revision; current shared components are an explicit alternative. Preview/apply fingerprints reject standalone component changes and conflicts preserve both histories. |

The shared canonical event and relationship record formats are unchanged.
Nothing appends an accumulating array to the target Thing. All presentation
maps are bounded, transient projections of the existing relational graph.

## Remaining design work, not claimed as delivered

- Page + related requires an authorized, batched relationship-history query;
  it must include relevant source Things rather than treat private render
  captures as the source owner's history.
- Search, kind/source/change/sync filters and the 30-day density strip currently
  describe the **loaded window**, explicitly labelled in the UI. Remote full
  history search and date seeking need server pagination/index support.
- Frames currently show recorded field summaries. Full filmstrip rendering
  should batch visible-frame dependencies and keep Actions/live sources inert;
  selected page details already render retained component definitions.
- Named branch labels, branch elbows, actual device/session groups, notes and
  Lopu explanations need corresponding trusted metadata. Do not invent these
  from operation IDs, source enums or client clocks.
- Pin/name, version export, selective undo, retention/clear/pause and sync
  settings require their canonical relational records, authority checks,
  dependency retention and transactional commands. The concept's simulated
  controls are not copied into the product.
- Compare with the live present, compact ancestry reconstruction, nested
  dependencies and per-entry recovery remain on the unified Timeline ledger.

These are extensions of the same system, not separate histories or queues.
The broader acceptance ledger remains in [unified-timeline.md](unified-timeline.md).
