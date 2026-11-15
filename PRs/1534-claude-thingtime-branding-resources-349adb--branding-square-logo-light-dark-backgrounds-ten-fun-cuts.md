# PR #1534 — Branding: square logo, light/dark backgrounds, ten fun cuts

Branch `claude/thingtime-branding-resources-349adb` → `main`.
<https://github.com/lopugit/thingtime/pull/1534>

## Request

> add the square multi line thingtime logo to all Thingtime branding page
> resource types … add both light and dark background options for all branding
> resources … add another 10 fun branding types with different logo variations

## What shipped

| Area | Change |
| --- | --- |
| Square logo | `LOGO_STACKED_MATRIX` (14×8, "Thing" over "time") centred on a 24×24 voxel canvas as `LOGO_SQUARE_MATRIX`. New cuts `logo-square` and `logo-square-pink`. |
| Backgrounds | Every cut ships transparent, on white (`light`) and on ink (`dark`): one SVG plus the full 19-size PNG ladder each. |
| Fun cuts | `logo-rainbow`, `logo-square-sunset`, `logo-outline`, `logo-square-arcade`, `logo-glitch`, `logo-square-confetti`, `logo-dissolve`, `logo-bounce`, `icon-seasons`, `monogram`. |
| Press kit | Every format × logo (wordmark, square, icon) × background (light, dark): 50 files. |
| Page | Background switch per cut, fun-cuts gallery, press-kit logo/background selectors, size ladder and custom export collapsed by default. |

## How it is put together

- `remix/app/components/Branding/logoVariants.ts` is the single registry. The
  page, `scripts/generate-branding-assets.mjs` and the tests all read it, so a
  cut cannot exist in one place and be missing from another. It uses explicit
  `.ts` import specifiers and erasable-only syntax because the generator imports
  it under node's type stripping.
- Fun cuts are plain voxel data derived from the canonical matrices by small
  pure transforms (`sweepColumns`, `outlinePixels`, `extrudePixels`,
  `glitchPixels`, `dissolvePixels`, `bouncePixels`, `confettiPixels`). A derived
  cut uses each colour as its own matrix key, so `buildLogoSvg` and the DOM
  `<Logo>` render it unchanged.
- `trim: false` marks cuts whose transparent frame is part of the mark (the
  squares). `unit` is sub-cells per voxel for the fine-grained cuts.
- A solid background adds two voxels of padding to trimmed cuts
  (`backdropPadding`); framed squares add none.
- Two manifests, split by who reads them:
  - `brandingAssets.generated.json` keeps its long-standing shape (transparent
    files + press kit) for the sitemap, `<Logo>` and the `tt.assets` tree, which
    ride in the main bundle.
  - `brandingSurfaces.generated.json` holds the light/dark ladders as
    `[w, h, bytes]` tuples for the lazy `/branding` route, which rebuilds URLs
    with `brandSvgUrl` / `brandPngUrl`.

## File naming

```
/branding/generated/<cut>/thingtime-<cut>[-light|-dark].svg
/branding/generated/<cut>/thingtime-<cut>[-light|-dark]-<w>x<h>.png
/branding/presskit/thingtime-<format>-<logo>-<background>-<w>x<h>.png
```

The 11 press-kit file names that existed before this PR are unchanged (for
example `thingtime-og-card-1200x630.png` is still the wordmark-on-light card),
as are all four original cut folders.

## PNG encoding

The ladder renderer now builds each distinct row once and writes palette PNGs
at the smallest bit depth that fits, falling back to RGBA above 256 colours.
The 76 pre-existing ladder PNGs were re-encoded this way; a decode-and-compare
of every one against `main` found identical pixels. `remix/public/branding`
grew from about 2.6 MB to 9.4 MB for roughly thirteen times as many files, and
the generator runs in about 20 s.

## Decisions and open questions

- **"10 fun branding types"** was read as ten new logo variations rather than
  ten new file formats.
- **Pink "n".** The supplied artwork (and `public/branding/thingtime-horizontal.svg`)
  uses `#FFA9DD`; `LOGO_DEFAULT_COLOURS[5]` is `#ffa3b1`. The square reuses the
  canonical key so it matches the wordmark beside it.
- **First "i".** The artwork draws the first i red over cyan and the second
  cyan over red; the square follows it. `LOGO_FULL_MATRIX` has cyan over red on
  both and was left alone.
- The preview's light/dark dots were replaced by the three-way background
  switch.
- Ladder chips above 128px borrow the 128px thumbnail, so opening a ladder no
  longer decodes 10000px bitmaps.

## Verification

- `npm --prefix remix run test:branding` (27 tests: artwork, registry,
  transforms, backgrounds, manifests match the registry, every promised file
  exists, press-kit matrix).
- `test:seo`, `test:social-previews`, `typecheck`, `typecheck:ratchet`, ESLint
  on the changed files.
- `/branding` in a browser at 1280px and 375px against an isolated local stack
  (disposable replica set, random signing secret): every section renders, the
  background switch changes preview and download links, the ladder and custom
  export open, the press-kit selectors swap all nine tiles, no horizontal
  overflow, bottom of page intact.

## Local preview note

`remix/.env` has no signing secret, so a plain `npm --prefix remix run dev`
answers `503 LOCAL_API_NOT_CONFIGURED` and the shell shows "We couldn't load
your session". The check above ran the dev stack with a disposable `mongod`
replica set, a random `JWT_SECRET` and `THINGTIME_DATA_ENV=development`, the
same recipe the acceptance scripts use.
