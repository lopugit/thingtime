# PR #984 — Show a page and its related Things in one Timeline history

- Branch: `codex/timeline-related-history`, based on `main` at
  `34afa2c777d0aa29c17c5d41d96c39263cd2e457`.
- PR: https://github.com/lopugit/thingtime/pull/984
- Continues the scope × look design from Fable 5.1's PR #947 and shared browser
  implementation in PR #983. This is an increment of the active unified Timeline
  goal, not completion of the broad acceptance ledger.

## Behavior and boundaries

An owned saved page offers **Page + related** in History. The existing composition
resolver authorizes the current bounded graph; only the account's owned source
Things enter the merged history. This includes literal Component → Action → Data
→ Schema references. Shared authors' private events stay absent, even when the
shared definition grants inherited read access to its private dependencies.

The same canonical local/remote events, receipts and relational links feed all
four looks, previews and sync. There is no new embedded history document. The
membership response is a disposable projection of at most 128 Things / 32 KiB;
event pages retain the existing size budget and 40-row limit. Selected event
headers, payloads and links are batched; composition traversal keeps its existing
bounded reference lookups. No new collection, index or migration is introduced.

Cursor requests carry a membership revision. Changed saved references restart
paging so a newly linked Thing's older history is not skipped. Removed members
leave the displayed scope while retaining their own independent history. The
local metadata cache holds eight account/origin/database-scoped membership hints;
canonical events remain in the existing bounded IndexedDB cache. Missing or
unauthorized roots clear the view. Pending events are never acknowledged by a
read. Page branch controls accept only selected versions of that page.

The scope follows the current saved composition, not every historical or runtime
reference. Filters/density still describe the loaded window. Other remaining
features are tracked in `docs/unified-timeline.md` and the design integration note.

## Validation — 2026-09-30

- 141 Timeline tests plus 57 capability tests passed. Coverage includes exact
  shared records, union paging, membership revisions/resets, malformed server
  responses, scoped bounded cache, URL state and real IndexedDB reload/pruning.
- Guarded `test:timeline:related` passed against the disposable replica set at
  `127.0.0.1:20337`, using HTTP-only synthetic account and Thing creation. Five
  kinds, foreign authors, canonical record equality, pagination, API edits,
  older/new/removed membership and auth/account/database/query gates passed.
- Full `test:unit` suite and production `build` passed. Typecheck has exactly the
  existing 91 diagnostics, identical to the prior reviewed baseline. Targeted
  lint: zero errors, nine warnings (including mixed-operator style warnings).
- Headed browser checked List/Cards/Line/Frames at 1280×900 and 390×844; document
  width and scope bounds matched the viewport. Reload retained scope, blocked
  refresh retained rows, API edits appeared on the visible poll, and removed
  dependencies disappeared. Component selection could not create a page
  variation; page selection could. Logout removed private cards/details.
- No browser page errors. In-app CUA control timed out; validation used the repo's
  standalone Playwright fallback in a fresh test browser with synthetic login.
- Screenshots: [desktop Cards](assets/timeline-related-history/related-desktop-cards.png),
  [desktop List](assets/timeline-related-history/related-1280.png),
  [mobile List](assets/timeline-related-history/related-390.png).
- Graphify structural refresh accompanies this PR. Semantic document/image
  extraction is not claimed; the preceding delivery recorded the local Codex
  semantic proxy's `codex_execution_failed` failure.

## Review

Reviewed ownership at the root, every resolved member and event query; no shared
read authority leaks into foreign Timeline access. Strict query selectors reject
ambiguous/mixed modes. Client validation precedes cache mutation; in-flight page
keys include related scope/revision. Membership changes invalidate both paging
directions and selected details. Account/source cancellation and outbox handling
continue through the existing session. Exact-head hosted checks and deployment
verification are recorded in the PR conversation after this source note.
