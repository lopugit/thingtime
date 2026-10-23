# 🌈 Design refactor + runtime theming (branch `claude/vigilant-moser-3704e0`)

Full-app adoption of the Claude Design mockups, a runtime theming system with
shareable themes, and a rebuilt landing page. ~90 files, 4.4k insertions.

## Design sources

- `docs/design/claude-design-mockup-v2-fable` — the **landing page** (neo-brutalist
  "Fable": 3px ink borders, hard offset shadows, hotpink CTAs, animated rainbow
  headlines, confetti). The front page matches it section-for-section.
- `docs/design/claude-design-mockup-v1` — the **product UI** ("Prism": Space
  Grotesk / Hanken Grotesk / JetBrains Mono, soft radii, hairline borders,
  rainbow accents, gradient-border Lopu toasts).
- Canonical token spec extracted to `docs/design/DESIGN_LANGUAGE.md`.

## Theming system

- `remix/app/theme/tokens.ts` — `TtTheme` document (colors incl. the 5-stop
  rainbow, fonts, general: radiusScale/borderWidth/shadow/motion/animSpeed),
  presets **Thingtime** (default hybrid), **Fable**, **Prism**, **Midnight**
  (dark), `resolveTheme` sanitizer (CSS-safe values only), `themeToCssVars`.
- `ThemeHost` (sibling of `VisualSettingsHost`) writes `--tt-*` vars onto
  `<html>`, mirrors a snapshot to `localStorage['tt-theme-vars']` (applied by a
  pre-paint script in `index.html` — no theme flash), loads curated Google
  fonts on demand, dispatches `thingtime:theme-change`, and picks up the
  user's server-side active theme once per load when local state is pristine.
- `useTtTheme` mirrors the `useDrawer` settings pattern
  (`settings.theme.*`, `ignoreUndoRedo`, namespace `theme`); defaults ride the
  ThingtimeDefaults version mechanism (v26).
- Chakra bridge: `fonts` + legacy `greys.*`/`grey` tokens re-pointed at vars,
  default Button colorScheme `ttInk` (solid ink), Switch checked → rainbow
  green. The module-level defaultProps mutations are preserved verbatim.
- **Chakra v2 gotcha discovered:** `bgGradient`/`backgroundImage` style props
  silently DROP `var()` values — use `background={...}` (and declare
  `backgroundSize` after it). All rainbow gradients now come from
  `~/theme/rainbow` (`RAINBOW`, `RAINBOW_TEXT`, `RAINBOW_CONIC`,
  `RAINBOW_PALETTE`) — previously the 5 hexes were duplicated in ~12 files in
  3 conflicting orders.

## Shareable themes + waitlist API (FUNDAMENTALS-compliant)

- Collections `themes` + `waitlist` (indexes in `collections.ts`;
  FUNDAMENTALS §3 table updated).
- Routes (registered in `nitro.config.ts` + `server/routes/api/[...].ts`):
  - `GET/POST /api/v1/themes` — list mine / save (401 guard; sanitized via
    `resolveTheme`; only `shareId` ever exposed, never `_id`/`ownerId`).
  - `GET /api/v1/themes/shared?id=` — public read (private themes 404).
  - `POST /api/v1/themes/active` — cross-device active theme
    (`users.meta.activeThemeId`, exposed as `PublicUser.activeThemeId`).
  - `POST /api/v1/themes/delete`, `POST /api/v1/waitlist` (idempotent).
- Client: `useApi().v1.themes.*` / `v1.waitlist.join`; browser API tests added
  to `apiTests.ts` (`themes` + `waitlist` groups).

## UI

- **Landing** (`components/Landing/*`): sticky sub-nav (clears the 54px global
  nav), hero + real waitlist, live demo card powered by the actual
  `<Thingtime path="Content">` editor (the old front-page mount, relocated) +
  add-a-thing input, use cases, ecosystem (voxel `Logo`), dark developers
  section, back-the-launch card, FAQ accordion, footer, `ConfettiCanvas`
  (respects reduced-motion + theme motion toggle).
- **Theme Studio** (`/themes`, also in drawer → Account): preset gallery with
  live preview cards, colour/rainbow editors, curated font selects, general
  controls, save-as-theme (public/private), My themes (apply/share/delete),
  `?apply=<shareId>` deep links.
- **Settings modal**: new Theming section (presets, accent, shadows, motion,
  Studio link, reset).
- Restyle sweep (7 parallel agents, style-only, behavior-preserving): nav +
  drawer, auth pages, Thingtime tree + commanders, Lopu toasts + DevKit,
  status/ops pages, docs suite (green accent kept via `--tt-docs-accent`
  fallbacks), misc routes.

## Verification

- Live-browser pass (desktop + mobile 375px): landing all sections + zero
  horizontal overflow, waitlist end-to-end (real API write + Lopu toast +
  joined card), FAQ accordion, theme presets applied live (Fable brutal /
  Midnight dark re-skin everything), save→share→apply-by-link flow, active
  theme ⭐, logout/login flows, drawer/settings modal, docs/status/raw pages.
- API e2e via curl: register (real endpoint), theme save/list/shared/active/
  delete, CSS-injection rejected (`url(...)` → sanitized), waitlist idempotency.
- Fixes made during verification: nav stacking clearance, Chakra `var()`
  gradient drops (above), ThemeHost active-theme race (sync once per load),
  `container.lg` → `container` token regression.

## Known notes

- The worktree's eslint was broken (pre-existing pnpm hoisting issue with
  `@remix-run/eslint-config` → `eslint-scope`); agents verified with scoped
  `tsc --noEmit` (0 errors in changed files) + Vite compile checks, and one
  cross-checked against the main checkout's eslint (no new findings).
- Side-by-side worktree dev originally shipped here as `THINGTIME_VITE_PORT` /
  `THINGTIME_VITE_HMR_PORT` / `THINGTIME_API_PROXY_TARGET` env overrides in
  `vite.config.ts`; unified on merge with main's shared
  `remix/scripts/worktree-ports.cjs` module (worktree-derived defaults,
  `TT_WEB_PORT` / `TT_HMR_PORT` / `TT_API_PORT` overrides).
- Invalid-credential login shows the pre-existing "Network error" toast (the
  fetcher throws on 401 before the `resp.ok` branch) — behavior preserved, not
  introduced here.
