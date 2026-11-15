# PR #1537 — Branding: artwork-matched wordmark, 96 ready-to-post pictures, imagery studio

Branch `codex/branding-artwork-wordmark-imagery-studio` → `main`.
<https://github.com/lopugit/thingtime/pull/1537>

Follow-up to [PR #1534](1534-claude-thingtime-branding-resources-349adb--branding-square-logo-light-dark-backgrounds-ten-fun-cuts.md).

## Requests

> Yes, match artwork

(the answer to "Change the site wordmark to match your artwork (pink n, first i)?")

> Can you also update the ready to post imagery so it includes the square and
> tree variations and mix in a bunch of those AMAZING "ways to play"
> variations in the ready to post imagery resources too
>
> Feel free to generate like 50-100 sick ready to post imagery's with custom
> configurable generative options

## What shipped

| Area | Change |
| --- | --- |
| Wordmark | `LOGO_FULL_MATRIX`: first i red over cyan (was cyan over red). `LOGO_DEFAULT_COLOURS[5]`: `#ffa9dd` (was `#ffa3b1`). Both now equal `public/branding/thingtime-horizontal.svg`. |
| Curated imagery | 96 scenes in `brandImagery.ts`, rendered to `remix/public/branding/imagery/`. |
| Gallery | `#press-kit` shows the curated set, then the classic kit, with Logo / Format / Background filters and Show more. |
| Studio | `#studio`: size, logo, background, pattern, shuffle, fine-tune, PNG and SVG download. Remix opens a gallery picture in it. |
| Sitemap | `/branding` lists the 96 new pictures (178 images on that entry). |

## The scene engine

`remix/app/components/Branding/brandScenes.ts`. A scene is described by ten
options and resolved by `buildBrandScene` into a flat, ordered list of
`[x, y, width, height, colour]` rectangles in whole pixels.

- **Why rectangles.** They are the one primitive a `<canvas>`, a raw pixel
  buffer and an SVG all draw identically, with no antialiasing to disagree
  about. The generator, the studio and the SVG download share the list, and
  `brandScenes.test.ts` decodes committed PNGs and compares every pixel with
  the engine.
- **Layout.** A pattern grid of `grain` cells across the shorter side, centred
  on the canvas (bottom-anchored for the patterns that fill the bottom). The
  logo is sized in whole pixels per sub-cell so it stays crisp, placed first,
  and scattered patterns keep a margin around it.
- **Backdrops** give one colour per grid cell, so gradients step in voxels:
  paper, ink, pastel, dusk, prism, sunset, sky, night, mint, sunshine,
  bubblegum, grape.
- **Patterns**: clean, confetti, stars, dots, checker, mosaic, tree tiles,
  pixel frame, rainbow stairs, pixel dust, pixel rain, skyline, rolling hills,
  forest.
- **Plate.** On backdrops where the logo's own colours would get lost, `auto`
  puts a notched panel with a hard drop shadow behind it.
- `paintScene(scene, context, scale)` rounds each edge to a device pixel, so a
  scaled-down preview has no seams between neighbouring cells.

Like `logoVariants.ts`, the engine and the curated list are imported by the
node generator under type stripping: explicit `.ts` specifiers, erasable-only
syntax.

## The curated set

`RECIPES` in `brandImagery.ts` are `[format, logo, backdrop, pattern, tweaks?]`
rows, grouped by format for editing and published round-robin across formats so
the gallery opens on a mix. Each seed is an FNV-1a hash of the recipe's own
name; adding, removing or reordering recipes leaves every other file's bytes
untouched.

| Format | Size | Pictures |
| --- | --- | --- |
| Square post | 1080×1080 | 28 |
| Portrait post | 1080×1350 | 14 |
| Story | 1080×1920 | 14 |
| Link card | 1200×630 | 16 |
| Banner | 1500×500 | 10 |
| Slide | 1920×1080 | 6 |
| Desktop wallpaper | 2560×1440 | 4 |
| Phone wallpaper | 1290×2796 | 4 |

Files are named
`/branding/imagery/thingtime-<format>-<logo>-<backdrop>-<pattern>-<w>x<h>.png`.
They are palette PNGs with repeated rows collapsed: 0.6 MB for all 96.

`brandingImagery.generated.json` is a third manifest, kept apart from
`brandingAssets.generated.json` because that one rides in the main bundle
(`<Logo>`, the `tt.assets` tree). The imagery manifest is read only by the lazy
`/branding` route and the server-side sitemap.

## Page

- `BrandPressKit.tsx` is now the gallery. Entries are placed shortest column
  first, which is prefix-stable: "Show more" appends and never moves a picture
  already on screen. Three columns from 1280px, two from 768px, one below.
- `BrandImageryStudio.tsx` is controlled by the route, so Remix can hand it a
  scene. The preview canvas is capped at 1400px on its long side; downloads are
  painted at full size. A size the browser canvas cannot draw raises one Lopu
  error pointing at the SVG, which has no size limit.
- `BrandChips.tsx` is a wrapping pill group used by the gallery filters and the
  studio pickers; a dozen options fit a phone without sideways scroll.

## Decisions and open questions

- **The other uses of the old pink.** `#ffa3b1` also appeared as a decorative
  accent in the landing confetti, one landing dot, the incoming-share and
  context-toolbar pixel rows and the share-preview gradient. They restate the
  logo palette, so they moved to `#ffa9dd` with it. The static design mock-ups
  under `docs/design/*/` and `resources/svg/qrcode.svg` were left as they are.
- **"Tree".** The registry still calls the cut "Icon" (manifest names, sitemap
  titles); imagery names and the gallery filter say "Tree".
- **50–100.** 96 curated pictures, plus the 50 classic press-kit files, for
  146 in the gallery.
- **"Custom configurable generative options"** was read as the studio.
- The live site only renders the tree with `<Logo icon>`; the full wordmark
  appears in generated files (JSON-LD wordmark, link cards, press kit) and on
  `/branding`.

## Verification

- `npm --prefix remix run test:branding` — 44 tests (16 new): wordmark against
  the artwork, engine determinism, whole-pixel rectangles inside the canvas for
  every backdrop × pattern, full backdrop coverage, logo fit at every size
  setting, scattered patterns clear of the logo, plate rules, option
  normalisation, SVG, seam-free scaled painting, curated-set coverage,
  manifest and files on disk, committed pixels equal engine pixels, sitemap.
- `test:seo`, `test:social-previews`, `test:theme`, `test:passwords`,
  `typecheck:ratchet` (0), ESLint on the changed files, `build:client`.
- Generator run twice: identical bytes.
- `/branding` at 1440px and 375px against an isolated local stack: gallery
  filters and counts, empty state, Show more, Remix, Size and Logo selects,
  Background and Pattern chips, Shuffle, Surprise me, Fine-tune, custom
  2000×777 size, PNG and SVG downloads (decoded: 2000×777, correct corner and
  bottom colours, one `<rect>` per rectangle), no horizontal overflow, bottom
  of page. The served wordmark PNG was sampled in the browser: first i
  `#ed1c24` over `#00b7ef`, second the reverse, n `#ffa9dd`.

## Not done

- Semantic graph indexing of the changed Markdown: the local model proxy
  answers `/api/health` with 200 but returns HTTP 500 on a completion. The
  structural graph is refreshed.
