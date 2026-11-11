# PR #129 — /branding brand-resources redesign

Branch: `claude/todo08-branding-svg-png-s1` · Base: `develop`

Started as the claude-todo/08 §3 logo exporter (shared voxel matrix +
SVG→PNG). Round 2 turned the page into a full brand-resources centre in the
style of the big-league brand pages (meta.com/brand), per the owner's
2026-08-22 request.

## What shipped in round 2

- **Asset library removed.** The Thingtime-JSON dump section and
  `remix/app/routes/branding/assets/all.ts` are gone; `tt.assets` /
  `tt.branding` defaults now read plain-data records from
  `brandingAssetsData.ts` (derived from the generated manifest — no more
  inline `exec` renderers).
- **Full-width page** (`remix/app/routes/branding/_index.tsx`): hero with
  animated rainbow gradient word, anchor chips, one section per variant
  (wordmark / tree icon / both hotpink cuts), press kit, palette (click to
  copy hex), usage rules, rainbow bookend bar. Prism design language: Space
  Grotesk headings, mono eyebrows, soft `--tt-surface-alt` panels — **no
  borders, cards, or transparency checkerboards**. Content column is
  max-width 1240px, centred; verified at 1280px and 375px with no horizontal
  scroll.
- **Whitespace trimming** (`logoMatrix.ts` → `trimLogoCells`): every preview
  and export strips fully-transparent outer rows/cols. `buildLogoSvg` gained
  `trim` (default on), per-side `padding` in cell units, and `pixelWidth`
  (emits width/height attrs). Unit tests: `npm run test:branding` (wired into
  `test:unit`).
- **Custom exporter** (`BrandAssetSection.tsx` + `brandingExport.ts`):
  per-section collapse form — PNG/SVG, any width, padding all/per-side (px),
  background transparent/white/ink. SVG and PNG share `buildLogoSvg`, so the
  padded SVG is rasterised 1:1 (filename `thingtime-<slug>-<W>x<H>.<ext>`
  includes padding). Success/error via Lopu toasts.
- **Pre-generated static assets** (`remix/scripts/generate-branding-assets.mjs`,
  `npm run branding-assets`): zero-native-dep RGBA compositor + PNG encoder
  (node zlib, adaptive None/Sub/Up filters). Renders each variant at
  10/16/32/50/64/100/128/200/256/500/512/1000/1024/2000/2048/4096/5000/8192/10000px
  (horizontal variants keep the trimmed 27:5 aspect) + one scalable SVG →
  committed under `remix/public/branding/generated/<slug>/`, ~2.3 MB total.
  Manifest: `brandingAssets.generated.json`. Page renders one lazy `<img>`
  per file (real URLs → Google-image indexable). Deterministic output: seeded
  PRNG, no timestamps — reruns are byte-stable.
- **Press kit** (`remix/public/branding/presskit/`, ~208 KB): OG cards
  (light/dark), X banner, LinkedIn banner, pastel social square, desktop
  wallpapers (1080p/4K), phone wallpaper, app tiles (light/dark), confetti
  pattern — all composed from the same matrices + DESIGN_LANGUAGE rainbow.
- `/branding` gets a document title (`root.tsx` route-title chain).

## Gotchas hit while validating

- Browser-pane screenshots go blank when scrolled while the pane is hidden;
  used the tall-viewport + `translateY` shift workaround (see memory note).
- Lazy-load verification: `translateY` does NOT trigger IntersectionObserver
  loads (transforms don't move the viewport) — proof lazy loading works;
  force `loading='eager'` via console to load everything for visual checks.
- The ~900px gap under the rainbow bookend is `.thingtimeFooter`'s own
  `padding-top: 900px` (site-wide chrome, present on every page) — not a page
  defect.
- Portrait press-kit images must preview as a centre crop
  (`object-fit: cover`, capped height) or one tall tile stretches its whole
  `SimpleGrid` row.

## Validation

- `npm --prefix remix run test:branding` — 7/7 pass.
- `pnpm --dir remix run lint:files -- <changed files>` — clean.
- Live browser (worktree trio 18370/18371/18372): TESTING.md → "Branding
  page" checklist, desktop 1280 + mobile 375, full scroll, custom export
  fired end-to-end (Lopu toast `thingtime-logo-1024x190.png`), 95 images
  loaded / 0 broken.
