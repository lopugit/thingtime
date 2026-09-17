# PR 843 — Seamless live builder and standalone pages

`LiveWebpage` is the shared host for `/builder?page=<id>`, `/p/<id>` and
`/t/<id>`. Its editor is lazy-loaded; Run and standalone reads mount no editor.
The page resolver, ownership checks, shared runtime, media handling and block
renderer remain common to every presentation.

- Edit maps contenteditable leaf text to authored block text, preserved rich
  markup, an unambiguous declared argument, or a block-local literal-label
  argument. Literal replacements resolve once as data, so typed braces cannot
  become template expressions. Dynamic source results are not turned into
  authored labels. Button spaces, Escape, plain-text paste and React DOM
  reconciliation are handled explicitly.
- View keeps normal page interactions and an optional inspector. Layout
  exposes insertion/move/selection controls. Builder and Container disable
  live source results; Container adds the classic bounded frame. Switching
  Edit/View/Layout preserves the rendered form DOM and source runtime.
- Full width, desktop, tablet, mobile, device presets and bounded custom sizes
  use an iframe React portal. Media queries see the requested CSS viewport.
  Runtime context stays in the host; no second app or API runtime boots.
  Context menus translate scaled frame coordinates and dismiss across frames.
- Run finishes the active edit, saves, then navigates to `/p/<id>?mode=run`.
  Save failure keeps the draft open. Standalone uses `/t/<id>` with the same
  persisted page and access rules, hiding Thingtime chrome except a small
  white credit bar that returns to `/p/` (including the supplied link key).
- Page output fills available space. Dedicated component/thing live output
  has no imposed card, padding or width cap; supporting metadata stays readable.
  View hides Transfer, and the old Edit in builder button is removed from `/p/`.
  The top My pages and Go to page links sit beside responsive controls.

Validation on 2026-09-17:

- Production client and single-file embed builds passed; embed size budget passed.
- Webpage suite: 99 passed, 2 optional real-API integration tests skipped.
- Changed-file ESLint passed. The nonblocking typecheck ratchet reports 116
  errors against baseline 108; diagnostics are outside the changed files.
- Chrome desktop and 390px checks covered plain/rich/argument/literal-button
  edits, keyboard spaces, mode/form preservation, device media queries,
  custom sizing, insertion/context menus, inspector and page scrolling,
  failed-save retention, and real private-page save/reload/Run/Standalone.
  Dedicated component/thing live widths were measured without padding/borders.
- Fixed overflow from selection outlines and preview borders, measured toolbar
  clearance for wrapped mobile controls, and kept global launchers clear of it.
- PM2 worktree stack: localhost 11060, HMR 11061, Nitro 11062; online with zero
  restarts and autorestart disabled. Tailscale/Funnel unavailable because the
  installed CLI target is missing. No deployment or main merge is claimed.

Limits: saves remain explicit. Changing between full-width and iframe viewport
presentations remounts form DOM; switching editing modes preserves it. Global
site blocks retain their existing specialized editor. Existing native-site
sections still render when opened from the builder. No API endpoints or
permission contracts were changed.
