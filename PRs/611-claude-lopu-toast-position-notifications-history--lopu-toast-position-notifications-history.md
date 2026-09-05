# PR #611 — Lopu toast position + `/notifications` history (`claude/lopu-toast-position-notifications-history`)

Rescued from the stranded Claude worktree `session-fd429c`: the feature was
authored on 2026-09-02 (24 edits + 12 new files) and never committed. This PR
publishes it unchanged apart from one stale test expectation and a merge of
`develop`.

## What this PR carries

- Lopu toast placement preference (`settings.lopu.position`, six corners,
  bottom-left default, mirrored into the synchronous `tt-lopu-position`
  cache so `useLopu` reads it at fire time) + the Settings → Appearance
  dropdown and the drawer's quick-settings modal control.
- `/notifications` history page (category chips, type dropdown, unread-only,
  debounced search, day window, mark-read, cursor paging, cached first page)
  linked from the bell, Settings → Notifications and the drawer.
- `action-run` system notifications from the action executor; category map
  in the registry; `GET /api/v1/notifications` 1.1.0 filters + row fields;
  `listQuery.ts` + `npm run test:notifications`.
- Rescue fix-up: `builtinSchemaProjection.test.ts` expects the notification
  schema's new `actorUsername` / `title` / `href` / `outcome` fields.
- Merge of `develop` (only `remix/CHANGELOG.md` conflicted; both entries kept).

## Verification (2026-09-05, worktree stack on 11540)

- Unit groups: notifications 18/18, client-errors 55/55, api-capabilities 5/5,
  schemas 112/112, nav, settings, lopu — green. `lint:files` clean on every
  changed file (pre-existing style warnings only).
- Browser (DOM-probed; the pane was hidden for part of the run):
  - `/notifications` renders for a fresh account (filters, search, date
    window, empty state) at desktop and 375px with no horizontal overflow.
  - Settings → Appearance "Lopu messages 🦄" select lists the six positions;
    changing it to top-right fires the confirmation toast in Chakra's
    top-right list (`translateY(70px)` nav clearance applied) and writes
    `"top-right"` to `tt-lopu-position`; changing back restores bottom-left.
    Note: measured with the browser pane hidden, the toast's 24px slide-in
    (Chakra's enter animation) had not completed — that is the frozen
    animation, not a layout offset.
- CI on the PR: CodeQL, GitGuardian, Build + typecheck ratchet + unit tests,
  API suite — green at the time of writing.

## Notes

- graphify snapshots were left untouched (source-only commits).

## Drawer-relative notification placement (2026-09-05)

Lopu's portal lists now follow the desktop page content inset, including live
resize and drawers opening from either side. All six positions align within
that content area; the card keeps its 8px edge gap. Existing streaming messages
move with the list. Mobile keeps the card readable across the viewport while
the temporary drawer shifts the page.

Validation: four placement tests pass; targeted ESLint has no errors (one
pre-existing display-name warning). Chrome checks at desktop and 390px cover
open/closed drawers, all six positions, both drawer edges, resize, and scrolling
the landing/settings pages to the bottom. Desktop measurements: content x=300,
left toast x=308; closed content x=0, toast x=8. With a right drawer, content
ends at x=1245 and the right toast at x=1237. Mobile has no horizontal overflow.

Local verification: http://localhost:15020 (Nitro 15022, HMR 15021), managed by
PM2 with autorestart disabled. Tailscale/Funnel is unavailable: the installed
CLI wrapper points to a missing /Applications/Tailscale.app executable.
Graphify's installed incremental command supports code extraction only; the
semantic backend option was rejected, so documentation changes were not
semantically re-indexed. The available structural graph was refreshed.
