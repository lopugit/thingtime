# PR #974 — Review and merge versions into named Timeline branches

Named branches previously supported create, view, pull and descendant push, but
could not combine divergent versions without updating the published Thing.
**Merge selected version…** now previews the selected version against one exact
branch head. Independent edits combine; overlapping fields require a choice and
another result review. The target branch and concrete selected version remain
visible throughout. Published content is unchanged.

## Shared contracts and failure handling

- `api.timeline` 1.7.0 adds a read-only, full-account, data-plane and exact-head
  fenced comparison command. Existing private/no-store, request/response bounds
  and rate limits apply. No new endpoint or collection is introduced.
- The accepted review becomes an ordinary canonical client draft merge with two
  parent links. Persist that event, then persist an ordinary branch advance.
  The existing outbox uploads the event first and compares the branch revision
  transactionally; exact retries return the original receipt.
- Local and remote event/link/receipt/branch/head formats remain identical.
  There is no new IndexedDB schema, migration, index or configuration.
- An event captured before a command enqueue failure stays in History. Offline
  reload preserves pending work; a lost acknowledgment retains the same ids.
  Stale branch pushes keep the merged version and expose the existing refusal
  recovery controls. A branch merge never claims that a server Action executed.
- Comparisons are bound to account/source/target. A fresh request controller is
  created on review/reopen, including development effect replay. Late or aborted
  requests cannot populate a different review.

The shared materializer now retains intervening folder moves while reconstructing
compact page/definition drafts. It reads at most the nearest full snapshot plus
the latest replacement for each compact field, with bounded ancestry traversal
and batched payload reads. Missing, duplicate, foreign, cyclic, unsupported or
ambiguous ancestry refuses rather than borrowing live content.

## Validation

- Full unit suite: 4,235 passed, 8 skipped. Focused Timeline: 84 passed;
  capabilities: 92 passed. Targeted lint: no errors (3 existing warnings).
- Complete production build passed. Raw TypeScript: 91 existing diagnostics,
  identical to the preceding main-based check; none in changed modules.
- Guarded disposable replica-set HTTP: named-branch merge and conflicts,
  canonical event upload, immutable event/command retries, stale-push retention,
  actor/source/foreign-Thing refusal and unchanged published content.
- Existing Timeline integration passed ordinary restore/merge, Action provenance,
  named branches, concurrency/privacy and large retained versions. Folder
  integration passed draft-after-move reconstruction and existing folder races.
  Its managed-theme count now includes the creation event added by prior work.
- Browser: desktop and 390px conflict review; save with Timeline requests blocked;
  reload with both the event and branch push pending; reconnect/retry. Independent
  API readback confirmed one merge, branch revision 2 and published colour/layout
  still Original. The shared live restore review also rendered correctly.
- Mobile measured 375px client and scroll width with a 347.7px dialog. Network
  and viewport overrides were cleared; temporary test tabs and private synthetic
  fixture files were removed.
- Graph refresh is AST/structural; it does not claim new semantic Markdown
  extraction. The final graph/manifest pair is checked against its staged source
  fingerprint before readiness.

Screenshots: [desktop conflict](assets/timeline-branch-merge/conflict-desktop.png),
[mobile conflict](assets/timeline-branch-merge/conflict-mobile.png),
[offline reload](assets/timeline-branch-merge/offline-reload-mobile.png).

## Remaining scope

Direct branch checkout/editing, exact historical dependency rendering, protected
family restore adapters, remaining writer/outcome coverage, rich-text/unsaved
Thing drafts, deleted-Thing recovery, large streamed operations and cache/retention
controls remain in the broader [Timeline ledger](../docs/unified-timeline.md).
A merge preview needs connectivity and is capped at 4 MiB. This PR does not claim
universal history coverage is finished.
