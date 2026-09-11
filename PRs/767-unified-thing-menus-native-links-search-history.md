# PR 767 — Unified Thing menus, native links and search history

Date: 2026-09-11. Branch: `codex/unified-thing-menus`. Target: `develop`.
PR: https://github.com/lopugit/thingtime/pull/767

## Shared foundation

`thingActions.ts` defines base Thing verbs; `buildThingEntityMenu` builds one
capability-driven model. Things grid/list/columns and right-click menus, post
and media cards, recording activity, generic Thing headers and message actions
use the shared menu renderer. Schema adapters contribute specialized actions
without changing their protected writers. The model refreshes while open,
preserves keyboard focus, and clamps tall menus inside mobile viewports.

Recording Send to Lopu uses the documented and registered
`POST /api/v1/things/actions`, feature `api.things-actions` 1.0.0. The server
derives ownership, rejects cross-origin and non-user credentials, applies the
existing subscription allowance, and rejects alternate Mongo data sources.
The legacy recording route delegates to the same dispatcher. No migration is
required and no unrestricted generic mutation path was introduced.

## Navigation and history

Drawer destinations and shared Thing-menu destinations render real anchors.
Plain clicks preserve SPA navigation; modifier and middle clicks retain native
browser behavior. Destructive actions and submenu toggles remain buttons.
Profile and settings links are siblings rather than nested interactive controls.

Things query, view, display, sort, group and kind live in URL parameters.
Explicit defaults make Back independent of later cached preferences; unrelated
folder/device parameters survive preference changes. Synchronous input drafts
and current-URL merging avoid stale Router transitions losing rapid typing or
paste. Folder navigation preserves the previous search history entry.

## Verification

- 351 focused tests: Things 64, feed 49, messenger 54, Lopu UI 146,
  API capabilities 38. All passed.
- Typecheck ratchet passes at the existing 108-error baseline; full typecheck
  is not clean.
- Production build and Vercel static/server output checks pass.
- Local capability discovery exposes the new origin-scoped action feature.
- Signed-in Chrome checks on desktop and CSS 390px mobile: shared menus,
  privacy submenu, folder edit dialog, Escape/focus, vertical menu clamping,
  full-page and drawer scrolling. Drawer footer remains inside the viewport
  and the mobile document has no horizontal overflow.
- Rapid search plus filter changes, name sorting, opening a Thing then Back,
  Back between view changes, and reload restore the query and view rules.
- Command-click on View Thing data and middle-click on a drawer destination
  opened correct separate tabs without changing the original search page.
- Graphify incremental code and semantic refresh completed with portable
  graph, manifest, report and HTML output.

## Scope and remaining acceptance

No production data or credentials were changed. The local recording activity
had no ready recording; a real positive Send/provider/physical Watch test is
not claimed. Existing domain-specific edit/privacy/delete/moderation writers
remain behind adapters, and specialized channel/member/draft controls are not
rewritten as unrestricted Thing actions.

Local QA: http://127.0.0.1:16250/things (disposable local account/data only).
Tailscale/Funnel is unavailable: its installed launcher points to a missing
Tailscale application; no mappings were changed. Local historical storage
migration health is unrelated and was not mutated.
