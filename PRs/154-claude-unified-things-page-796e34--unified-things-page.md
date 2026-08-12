# PR #154 — Unified Things page

Branch: `claude/unified-things-page-796e34`

## Follow-up: search, browse controls, and auto-icons

The `/things` visual follow-up fixes three related rough edges:

- Pin absolute `Rainbow` overlays to `top: 0; left: 0` so the animated search
  border follows its padded wrapper on every side instead of inheriting a
  two-pixel static-position offset.
- Give View / Show / Arrange / Kind pills real outline-button padding and group
  each labelled control family so responsive wrapping never orphans a label.
- Replace the generic fallback-heavy icon switch with an ordered, deterministic
  registry for Thing kinds and file families. Screenshot-like names take
  precedence over image MIME data (`🖼️`), photos use `🏞️`, recognised file
  families receive distinct icons, and unknown files use `💾`.
- Make the browse-control pills more compact by default and expose their
  padding as a theme token with Small / Medium / Large presets plus a safe
  custom CSS-padding shorthand. The control is available in Theme Studio and
  both Appearance quick-settings surfaces, and saved themes carry the choice.

## Validation

- `corepack pnpm --dir remix exec node --import tsx --test app/components/Things/thingIcon.test.ts` — 5/5 passed.
- `corepack pnpm --dir remix exec node --import tsx --test app/theme/tokens.test.ts` — badge padding preset/custom sanitisation coverage.
- Targeted Remix ESLint — 0 errors; 8 pre-existing warnings in `Rainbow.tsx`
  and `ThingsPage.tsx`.
- `corepack pnpm --dir remix run build:client` — passed.
- Local `/things` desktop and mobile browser QA covered search input, every
  control family, sort/group menus, responsive wrapping, top-to-bottom scroll,
  and horizontal overflow. The search wrapper and rainbow overlay had matching
  bounds; every pill measured 12 px inline padding; app-origin console logs
  were empty.

## Follow-up: recoverable first-session Things space

- A fresh `/things` landing now creates a rate-limited temporary user through
  the canonical user-Thing, subscription, session, JWT, and account-roster
  paths before the route paints. The Things UI therefore has a real owner and
  all ordinary ACL/quota rules apply; there is no anonymous write bypass.
- The bootstrap is idempotent for an existing session, marks the public user
  as temporary, bounds it to a 64 MiB allowance, and keeps login/register
  reachable so another account can be added while the browser roster retains
  the temporary space.
- Temporary identities are labelled as browser-saved in the account switcher
  and do not show a misleading email-verification warning for their internal
  placeholder address.

### Validation

- `corepack pnpm --dir remix run test:temporary-user` — 3/3 passed, covering
  generated-account constraints, exact `/things` routing, proxy-aware
  same-origin acceptance, and foreign-origin rejection.
- Targeted Remix ESLint passed with 0 warnings/errors; the complete Vercel
  production build and static-shell verification passed.
- Direct runtime calls returned `201 reused:false` for the first bootstrap and
  `200 reused:true` with the same user id for the second, with `temporary:true`
  and the 64 MiB allowance in the public projection.
- A clean in-app browser session landed on `/things` as “Temporary space”,
  created a private folder through the real Things UI, retained it after
  reload, reached both `/login` and `/register` without redirecting, then
  deleted the QA folder. Desktop 1280×800 and mobile 390×844 top-to-bottom
  checks had no horizontal overflow, clipped controls, or console errors.
- The full typecheck ratchet remains warning-only at 152 diagnostics versus its
  stale 143 baseline; none of the reported diagnostics are in this change.

## Follow-up: anonymous session presentation

- Temporary users remain real, recoverable session owners underneath, but the
  global navigation presents the standard logged-out `Login` action instead
  of naming the temporary space.
- New and existing temporary profiles project as `Anonymous`. Account,
  profile, people, feed, messenger, sharing, schema, and app-data identity
  renderers use `Login to claim` instead of exposing the generated `guest-*`
  username or placeholder email.
- The OAuth authorisation surface treats a temporary session as signed out, so
  a third-party app cannot be authorised under an internal guest identity.

### Validation

- `corepack pnpm --dir remix run test:temporary-user` — 6/6 passed, including
  legacy temporary-record normalization and presentation-label coverage.
- `corepack pnpm --dir remix run test:unit` and
  `corepack pnpm --dir remix run typecheck:ratchet` — passed.
- Targeted Remix ESLint — 0 errors and one pre-existing Search hook dependency
  warning; the complete Vercel production build and output verification passed.
- Local desktop 1280×800 and mobile 390×844 browser QA verified the `Login`
  navigation, Anonymous profile, account switcher and settings rows, both
  `Login to claim` CTAs, login navigation, full-page scrolling, and zero
  horizontal overflow. No `Temporary space`, generated guest handle, or
  placeholder temporary email appeared; the console had only the existing
  React Router `HydrateFallback` development warning.

## Follow-up: populated kind-group runtime crash

- Fixed `groupThings()` using the removed `KIND_ICONS` local after the icon
  registry moved to `THING_KIND_ICONS`. Empty spaces never evaluated the
  section map, which is why the earlier clean-session QA did not expose the
  production-only crash seen in a populated space with Group by Kind active.
- Added the Things core/icon tests to the required unit suite. The regression
  fixture includes populated folder, post, and unknown-kind sections so both
  canonical icon lookup and the honest fallback execute at runtime.

### Validation

- `corepack pnpm --dir remix run test:things` — 6/6 passed, including the
  populated kind-group fixture; the complete unit suite and Vercel production
  build/output verification also passed.
- Local browser QA created one temporary folder, selected Arrange → Group by
  Kind, and verified `📁 Folders · 1` without an error boundary or app-console
  error at 1280×800 and 390×844. Both layouts had zero horizontal overflow,
  the mobile page reached its true bottom, and the QA folder was deleted after
  the check. The only console warning was the existing `HydrateFallback` note.
- The typecheck ratchet remains warning-only at 151 diagnostics versus its
  stale 143 baseline; none of the diagnostics are in Things core or its test.

## Follow-up: persistent browse toolbar during selection

- Selecting a Thing now adds the contextual Move / Share / Copy / Cut / Delete /
  Clear bar beneath the browse controls instead of replacing them.
- View, Show, Arrange, and Kind remain usable while a selection is active, so a
  user can change view or grouping without first clearing the selected Things.
- The permanent browse row and conditional action row both retain responsive
  wrapping on narrow screens.

### Validation

- Targeted Remix ESLint passed with 0 errors and the same 7 existing
  `ThingsPage.tsx` warnings; `corepack pnpm --dir remix run build:client`
  passed.
- The non-blocking typecheck ratchet still reports the existing 152 diagnostics
  against its stale 143 baseline; none are in `ThingsPage.tsx`.
- Local in-app browser QA at 1280×800 and 390×844 verified all View / Show /
  Arrange / Kind controls and all six selection actions remain visible together,
  changing Columns to List preserves the selection, Group opens while selected,
  Escape/Clear removes the contextual row, and both sizes scroll top-to-bottom
  without overlap or horizontal overflow. The console contained only the
  existing React Router `HydrateFallback` development warning. The temporary QA
  folder was deleted after verification.
