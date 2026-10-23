# PR #28 — Drawer-based nav revamp (branch `codex/service-account-api`)

Landing alongside the service-account API work already on this branch/PR.

## What changed

A Claude/Codex-desktop-style drawer nav system replaces the old (dead)
`ProfileDrawer` placeholder. All drawer preferences live under
`thingtime.settings.drawer.*` and persist through the normal thingtime →
localforage flow (stored values win, new defaults fill gaps).

### Settings paths

| Path | Default | Meaning |
| ---- | ------- | ------- |
| `settings.drawer.open` | `false` | pinned drawer open state |
| `settings.drawer.width` | `300` | drawer width px (clamped 220–520) |
| `settings.drawer.opens.direction` | `'left'` | which edge the drawer opens from (`'left'`/`'right'`) |
| `settings.drawer.toplevelitems.limit` | `5` | top-level items shown before the faint “More” reveal |
| `settings.drawer.searchClosesDrawer` | `true` | close drawer when the drawer search button opens the Commander |
| `settings.drawer.userDrawerOrdering` | `{}` | per-list drag-reorder ordering (`toplevel` + one key per top-level item id) |
| `settings.drawer.selectedItem` | `'home'` | selected top-level item driving the second-level menu |
| `settings.drawer.collapsedGroups` | `{}` | expand/collapse state per `topId:Group` key |

(The settings modal open state is deliberately ephemeral React state —
`AccountModalProvider` in `useDrawer.tsx` — so it never persists/restores.)

### Components (`remix/app/components/Nav/Drawer/`)

- `drawerMenu.tsx` — default menu model (top-level items + grouped/ungrouped
  children, auth/guest filters) and ordering helpers.
- `useDrawer.tsx` — one hook over the settings above (+ z-index ladder
  10000–10004, mobile matchMedia hook, live-resize width broadcast).
- `ReorderableList.tsx` — click-and-hold (280 ms) drag reorder, pointer-events
  based, touch-scroll safe, previews sibling displacement, commits id order.
- `DrawerContent.tsx` — shared surface: brand + search header, limited
  top-level list with faint caret “More”, dynamic second-level list with
  collapsible groups, sticky avatar footer (username shown on desktop only).
- `NavDrawer.tsx` — pinned panel flush top/bottom/edge, hover-reveal drag
  handle on the inner border, persists width on release only (live widths go
  out via a window event, not per-pixel localforage writes).
- `DrawerTrigger.tsx` — single fixed top-left button (mobile + desktop);
  desktop hover shows a floating popup preview of the full drawer contents.
- `UserSettingsModal.tsx` — avatar-opened settings: centred floating modal on
  desktop, full-width slide-up sheet on mobile; account actions (login /
  register / profile / logout via `useApi`) + drawer preferences (direction,
  search behaviour, top-level limit, ordering reset).
- `DrawerSystem.tsx` — hosts panel/trigger/modal/scrim; body scroll-lock and
  Escape-to-close on mobile; resets a persisted-open modal once per load.

### Layout integration

- `Layout/Main.tsx` — desktop split view pads the root by drawer width;
  mobile wraps children + footer in `.mainShiftContainer` and shifts it with
  `translateX(±width)` (content never resizes). Drawer system renders here.
- `Nav/Nav.tsx` — fixed nav follows the drawer (left/right offset on desktop,
  translateX on mobile); dead ProfileDrawer state removed; left section pads
  for the fixed trigger.
- `Commander/CommanderV2.tsx` — mobile input makes room for the trigger
  (52px left padding, width allowance now `100vw - 160px`).
- `routes/_index.tsx`, `routes/ode.tsx` — dead `ProfileDrawer` usage removed;
  `Nav/ProfileDrawer.tsx` deleted.

## Verified in live browser (desktop 1440px + mobile 390px)

Split view + resize drag persistence, hover popup preview, More/Less reveal,
group expand/collapse persistence, click-and-hold reorder persistence,
search button honouring `searchClosesDrawer`, direction left/right flip live
from the settings modal, mobile page shift with measured constant content
width (`translateX` only), scrim tap-close, sticky trigger during scroll,
slide-up settings sheet, sub-item navigation auto-closing the mobile drawer.
No console errors. Pre-existing localforage drawer settings from an earlier
session were adopted without clobbering (stored-wins merge confirmed live).

## Adversarial review (25-agent workflow) — fixes applied

21 confirmed findings, all addressed: pathname-sync no longer clobbers a
manual top-level pick for routes shared across items (ref + bail + only syncs
while open, which also stops per-route-change persists); resize handlers
filter `pointerId` (second touch can't warp/end the drag); live resize
broadcasts a `resizing` flag so Nav/Main disable transitions and track the
edge exactly (and Main overrides the global 0.2s padding rule with the
drawer-matched 0.28s ease-out); release keeps the live width until the queued
write settles (no snap-back frame); reorder holds the committed order locally
until the ordering prop catches up (no old-order flash); drawer widths render
through `min(width, 100vw - 56px)` everywhere so a wide persisted drawer
can't swallow a phone screen; closed drawer is `visibility: hidden` (not
tabbable) with a delay so the slide-out still animates; nav reserves trigger
space when the drawer pins right; Escape peels surfaces one at a time (sheet
first, then drawer); search always dismisses the mobile drawer (the
`searchClosesDrawer` setting remains the desktop preference) and
preventDefaults so the Commander's click-away can't race it; logout failures
toast instead of leaving the modal stuck; the settings modal state moved out
of persisted thingtime entirely.

Known pre-existing (not this PR): thingtime persistence is whole-tree
last-writer-wins across tabs — two open tabs overwrite each other's saved
state. Flagged as a follow-up task (cross-tab sync via BroadcastChannel).
