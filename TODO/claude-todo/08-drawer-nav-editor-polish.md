# 08 — Drawer nav & editor UX follow-ups

Quick punch-list items called out during the drawer-nav / docs-route merge review
(2026-07-05). Lighter-weight than the numbered features above — each can be
fixed/refined independently rather than needing a full plan doc.

## 1. Groups in drawer: click *and* draggable

- Status: ✅ done 2026-07-21. Group sections are drag-reorderable via their
  headers (hold-to-drag, same `ReorderableList` primitive with a new
  `shouldStartDrag` handle predicate so nested per-item lists keep their own
  drags); ordering persists through the existing per-top-item
  `userDrawerOrdering` flat list (section order = first-appearance order).
  Header click still toggles collapse; live-verified incl. reload persistence.
- What exists: group headers (`Modes`, `Vercel`, `Database`, etc. defined in
  `drawerMenu.tsx`) already toggle collapse/expand on click
  (`DrawerContent.tsx` `toggleGroupCollapsed`, ~L399-427). Items *within* a
  group are already drag-reorderable via `ReorderableList` (~L428-436).
- What's missing: the groups themselves aren't draggable relative to each
  other — a group's position among its sibling groups is fixed by
  `drawerMenuItems` order, not reorderable by drag the way leaf items are.
- Action: wrap the group headers (not just their child `ReorderableList`) in a
  reorderable container so a whole group section can be dragged above/below
  sibling groups, and persist that ordering the same way sub-item ordering
  already persists via `userDrawerOrdering`.

## 2. "Thingtime" brand name in drawer → link home

- Status: ✅ already shipped on main (verified 2026-07-21): the brand row is a
  button (`title="Home"`, `onBrandClick` → navigate('/') + close).
- What exists: the brand row in `DrawerContent.tsx` (~L303-317) is a static
  `Flex`/`Text` ("Thingtime" + unicorn icon), not a link.
- Action: wrap it in the router `Link` (as used elsewhere in the drawer)
  pointing to `/`, closing the drawer on click like other nav items do.

## 3. Fix/finish `/branding` page + SVG → PNG rendering concept

- Status: ✅ SVG → PNG export shipped (2026-07-21, session 1): `/branding` now
  has a "Logo exports" section — four variants rendered as SVG from a shared
  voxel-matrix module (`components/Branding/logoMatrix.ts`, also consumed by
  `Logo.tsx`) with client-side PNG export at 256–2048px. Reviving the removed
  displacement-map prototype remains an open owner decision.
- Previous status: not started / prototype removed.
- What exists: `remix/app/components/Branding/Branding.tsx` is currently a
  bare 15-line placeholder (heading + a few `<Logo>` variants). A related SVG
  displacement-map rendering prototype
  (`remix/app/routes/scratchpads/svg-displacement-map.tsx`) was built and then
  removed (commit `d73df40`, "Remove SVG displacement scratchpad").
- Action: decide whether to revive/finish the displacement-map idea as part of
  `/branding`, and build out an actual SVG → PNG export/render path for brand
  assets (logo variants etc.) rather than leaving it as a removed scratchpad.

## 4. Refine API tests

- Status: not started.
- What exists: `remix/app/routes/tests.tsx` (~396 lines) +
  `remix/app/tests/api/apiTests.ts` (~326 lines) +
  `remix/app/tests/api/apiTestRunner.ts` (~221 lines) — a working `/tests`
  page with payload controls (recently enhanced, commit `816e5a4`).
- Action: no specific gaps identified yet — revisit coverage/UX (payload
  editing ergonomics, assertions, error/result display) and refine as needed.

## 5. Improve hover context window on "things" property names/key paths

- Status: ✅ done 2026-07-21. Hovering a property key (`thingPathDom-raw`)
  shows the full dotted path after a 450ms hover intent, in the same style as
  the seedling row's context window; long paths ellipsize
  (`min(80vw, 560px)`), hides on leave. Live-verified on /edit.
- What exists: `Thingtime.tsx` already renders a hover tooltip with the full
  dotted path (`safeJoin(fullPath)`, ~L1203-1216) — but only on the "add new
  child" seedling row (`showFullPathContext` state, ~L1193-1199), not when
  hovering the property name/key itself (`thingPathDom`, ~L1100-1164).
- Action: extend/fix the hover context window so hovering a property name or
  key path (not just the add-child affordance) reliably shows the full path,
  and review positioning/behavior for nested or long paths.

## Notes

- Origin: follow-ups noted alongside the `origin/main` docs-route merge into
  the drawer-nav branch.
