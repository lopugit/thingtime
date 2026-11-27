import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildExportSvg } from './brandingExport';
import {
  LOGO_ICON_MATRIX,
  LOGO_SQUARE_MATRIX,
  LOGO_SQUARE_SIZE,
  LOGO_STACKED_MATRIX,
  LOGO_THEMES,
  buildLogoSvg,
  logoMatrixToCells,
  trimLogoCells
} from './logoMatrix';
import {
  BRAND_BACKDROP_VOXELS,
  BRAND_LOGO_VARIANTS,
  BRAND_SURFACES,
  backdropPadding,
  bouncePixels,
  brandPngUrl,
  brandSvgUrl,
  buildVariantSvg,
  confettiPixels,
  dissolvePixels,
  extrudePixels,
  glitchPixels,
  logoPixels,
  mixColours,
  outlinePixels,
  pixelsToLogo,
  sweepColumns
} from './logoVariants';
import type { LogoPixels } from './logoVariants';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', '..', '..', 'public');
const readJson = (name: string) => JSON.parse(readFileSync(path.join(HERE, name), 'utf8'));

const defaultMap = LOGO_THEMES.default;
const filled = (pixels: LogoPixels) => pixels.flat().filter(Boolean).length;
const solid = (width: number, height: number, colour = '#59ff9c'): LogoPixels =>
  Array.from({ length: height }, () => Array.from({ length: width }, () => colour));

// Rasterise an SVG's <rect>s back onto a cell grid, so two builds can be
// compared pixel for pixel regardless of how their rects are grouped.
const rasterise = (svg: string) => {
  const cells = new Map<string, string>();
  for (const match of svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"\/>/g)) {
    const [, x, y, width, height, fill] = match;
    for (let dy = 0; dy < Number(height); dy += 1) {
      for (let dx = 0; dx < Number(width); dx += 1) cells.set(`${Number(x) + dx},${Number(y) + dy}`, fill);
    }
  }
  return cells;
};

test('the stacked lock-up is the owner’s two-line artwork, voxel for voxel', () => {
  const pixels = logoPixels(LOGO_STACKED_MATRIX, defaultMap);
  const key: Record<string, string> = {
    '#59ff9c': 'T',
    '#59bdff': 'h',
    '#ed1c24': 'r',
    '#00b7ef': 'c',
    '#ffa9dd': 'n',
    '#6f3198': 'g',
    '#a8e61d': 'l',
    '#9c5a3c': 'b',
    '#ffc20e': 'm',
    '#ff7e00': 'e'
  };
  assert.deepEqual(
    pixels.map((row) => row.map((colour) => (colour ? key[colour] : '.')).join('')),
    [
      'TTT.h..r......', // the first i wears its dots red over cyan…
      '.T..hh...nn.gg',
      '.T..hh.c.nn.gg',
      '.............g',
      '............gg',
      '..l..c........', // …the second cyan over red
      '.l.l...mmm.ee.',
      '..b..r.mmm.ee.'
    ]
  );
});

test('the stacked lock-up carries no baked-in whitespace', () => {
  const cells = logoMatrixToCells(LOGO_STACKED_MATRIX);
  assert.deepEqual(trimLogoCells(cells, defaultMap), cells);
});

test('the square logo centres the stacked lock-up on a 24×24 canvas', () => {
  const square = logoMatrixToCells(LOGO_SQUARE_MATRIX);
  assert.equal(square.length, LOGO_SQUARE_SIZE);
  assert.ok(square.every((row) => row.length === LOGO_SQUARE_SIZE));
  // trimming the frame away gives the stacked lock-up back
  assert.deepEqual(trimLogoCells(square, defaultMap), logoMatrixToCells(LOGO_STACKED_MATRIX));
  // 14×8 artwork → 5 clear columns either side, 8 clear rows above and below
  const untrimmed = buildLogoSvg({ matrix: LOGO_SQUARE_MATRIX, colourMap: defaultMap, trim: false });
  assert.equal(untrimmed.columns, 24);
  assert.equal(untrimmed.rows, 24);
  const xs = [...rasterise(untrimmed.svg).keys()].map((cell) => Number(cell.split(',')[0]));
  const ys = [...rasterise(untrimmed.svg).keys()].map((cell) => Number(cell.split(',')[1]));
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [5, 18, 8, 15]);
});

test('the registry ships three lock-ups, their pink cuts and ten fun cuts', () => {
  const slugs = BRAND_LOGO_VARIANTS.map((variant) => variant.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'slugs are unique');
  const byGroup = (group: string) => BRAND_LOGO_VARIANTS.filter((variant) => variant.group === group).map((variant) => variant.slug);
  assert.deepEqual(byGroup('core'), ['logo', 'logo-square', 'icon']);
  assert.deepEqual(byGroup('pink'), ['logo-pink', 'logo-square-pink', 'icon-pink']);
  assert.equal(byGroup('fun').length, 10);
  // the square lock-up exists in every family
  for (const group of ['core', 'pink', 'fun']) assert.ok(byGroup(group).some((slug) => slug.includes('square')), `${group} has a square cut`);
});

test('every cut is a non-empty rectangular grid; framed cuts are exact squares', () => {
  for (const variant of BRAND_LOGO_VARIANTS) {
    const pixels = logoPixels(variant.matrix, variant.colourMap, variant.trim);
    assert.ok(filled(pixels) > 0, `${variant.slug} draws something`);
    assert.ok(pixels.every((row) => row.length === pixels[0].length), `${variant.slug} is rectangular`);
    if (!variant.trim) {
      assert.equal(pixels.length, LOGO_SQUARE_SIZE * variant.unit, `${variant.slug} height`);
      assert.equal(pixels[0].length, LOGO_SQUARE_SIZE * variant.unit, `${variant.slug} width`);
    } else {
      // trimmed cuts hug their artwork on every side
      const cells = logoMatrixToCells(variant.matrix);
      assert.deepEqual(trimLogoCells(cells, variant.colourMap).length, pixels.length, `${variant.slug} has no spare rows`);
    }
  }
});

test('every cut builds a transparent, a light and a dark file', () => {
  assert.deepEqual(BRAND_SURFACES.map((surface) => surface.key), ['transparent', 'light', 'dark']);
  for (const variant of BRAND_LOGO_VARIANTS) {
    const bare = buildVariantSvg(variant, 'transparent');
    assert.equal(bare.totalColumns, bare.columns, `${variant.slug} transparent has no padding`);
    assert.doesNotMatch(bare.svg, /fill="#ffffff"\/><rect/);
    for (const surface of ['light', 'dark'] as const) {
      const colour = BRAND_SURFACES.find((entry) => entry.key === surface)?.colour;
      const pad = backdropPadding(variant, surface);
      // trimmed cuts gain two voxels of breathing room; framed squares already have theirs
      assert.equal(pad, variant.trim ? variant.unit * BRAND_BACKDROP_VOXELS : 0, `${variant.slug} ${surface} padding`);
      const backed = buildVariantSvg(variant, surface);
      assert.equal(backed.totalColumns, bare.columns + pad * 2);
      assert.equal(backed.totalRows, bare.rows + pad * 2);
      assert.ok(
        backed.svg.includes(`<rect x="${-pad}" y="${-pad}" width="${backed.totalColumns}" height="${backed.totalRows}" fill="${colour}"/>`),
        `${variant.slug} ${surface} backdrop covers the whole file`
      );
    }
  }
});

test('mergeRuns draws the same pixels with fewer rects', () => {
  for (const variant of BRAND_LOGO_VARIANTS) {
    const options = { matrix: variant.matrix, colourMap: variant.colourMap, trim: variant.trim };
    const each = buildLogoSvg(options).svg;
    const merged = buildLogoSvg({ ...options, mergeRuns: true }).svg;
    assert.deepEqual(rasterise(merged), rasterise(each), `${variant.slug} pixels`);
    assert.ok(merged.length <= each.length, `${variant.slug} is no larger merged`);
  }
});

test('file names follow one scheme shared by the generator and the page', () => {
  assert.equal(brandSvgUrl('logo'), '/branding/generated/logo/thingtime-logo.svg');
  assert.equal(brandSvgUrl('logo', 'dark'), '/branding/generated/logo/thingtime-logo-dark.svg');
  assert.equal(brandPngUrl('icon', 'transparent', 1024, 1024), '/branding/generated/icon/thingtime-icon-1024x1024.png');
  assert.equal(brandPngUrl('logo-square', 'light', 512, 512), '/branding/generated/logo-square/thingtime-logo-square-light-512x512.png');
});

test('pixelsToLogo round-trips through the matrix + colour-map form', () => {
  const pixels = logoPixels(LOGO_ICON_MATRIX, defaultMap);
  const { matrix, colourMap } = pixelsToLogo(pixels);
  assert.deepEqual(logoPixels(matrix, colourMap), pixels);
});

test('sweepColumns runs the gradient end to end', () => {
  const swept = sweepColumns(solid(5, 1), ['#000000', '#ffffff']);
  assert.deepEqual(swept[0], ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff']);
});

test('outlinePixels keeps a one-sub-cell edge and hollows the rest', () => {
  const outlined = outlinePixels(solid(3, 3), 4);
  assert.equal(outlined.length, 12);
  assert.equal(filled(outlined), 12 * 12 - 10 * 10);
  assert.equal(outlined[0][0], '#59ff9c');
  assert.equal(outlined[5][5], null);
});

test('extrudePixels adds a shaded diagonal extrusion without moving the face', () => {
  const extruded = extrudePixels(solid(1, 1), 2, 1, '#16161a');
  const shade = mixColours('#59ff9c', '#16161a', 0.45);
  assert.equal(shade, '#3b9662');
  assert.deepEqual(extruded, [
    ['#59ff9c', '#59ff9c', null],
    ['#59ff9c', '#59ff9c', shade],
    [null, shade, shade]
  ]);
});

test('glitchPixels slips only the named bands and fringes both sides', () => {
  const glitched = glitchPixels(solid(1, 2), 2, [[1, 1, 2]]);
  // margin = 1 + largest slip, so nothing is ever clipped
  assert.equal(glitched[0].length, 2 + 3 * 2);
  assert.deepEqual(glitched[0], [null, null, '#00e5ff', '#59ff9c', '#59ff9c', '#ff3df0', null, null]);
  assert.deepEqual(glitched[1], [null, null, null, null, '#00e5ff', '#59ff9c', '#59ff9c', '#ff3df0']);
});

test('dissolvePixels stays solid on the left and thins towards the right', () => {
  const dissolved = dissolvePixels(solid(10, 1), 4);
  const density = (from: number, to: number) => filled(dissolved.map((row) => row.slice(from, to))) / ((to - from) * dissolved.length);
  assert.equal(density(0, 12), 1);
  assert.ok(density(28, 40) < density(16, 28), 'thins out');
  assert.ok(density(28, 40) > 0.2, 'never vanishes');
});

test('bouncePixels moves whole glyphs and loses no voxels', () => {
  const pixels = logoPixels(['110011', '110011'], defaultMap, false);
  const bounced = bouncePixels(pixels, 2, [0, 1, 2]);
  assert.equal(bounced.length, 4);
  assert.equal(filled(bounced), filled(pixels));
  assert.equal(bounced[0][0], '#59ff9c');
  assert.equal(bounced[0][4], null);
  assert.equal(bounced[3][4], '#59ff9c');
});

test('confettiPixels is deterministic and keeps the lettering where it was', () => {
  const stacked = logoPixels(LOGO_STACKED_MATRIX, defaultMap);
  const first = confettiPixels(stacked, 2, LOGO_SQUARE_SIZE, 7);
  assert.deepEqual(confettiPixels(stacked, 2, LOGO_SQUARE_SIZE, 7), first);
  assert.notDeepEqual(confettiPixels(stacked, 2, LOGO_SQUARE_SIZE, 8), first);
  assert.equal(first.length, 48);
  stacked.forEach((row, y) =>
    row.forEach((colour, x) => {
      // artwork sits at (5, 8) voxels; each voxel is a 2×2 block
      assert.equal(Boolean(first[(y + 8) * 2][(x + 5) * 2]), Boolean(colour), `voxel ${x},${y}`);
    })
  );
});

test('the custom exporter honours the square frame and can trim it away', () => {
  const options = { matrix: LOGO_SQUARE_MATRIX, colourMap: defaultMap, width: 480, padding: { top: 0, right: 0, bottom: 0, left: 0 } };
  const framed = buildExportSvg({ ...options, trim: false });
  assert.deepEqual([framed.width, framed.height], [480, 480]);
  const tight = buildExportSvg({ ...options, trim: true });
  assert.deepEqual([tight.width, tight.height], [480, Math.round((480 / 14) * 8)]);
});

// ---------------------------------------------------------------------------
// The committed manifests + files must match the registry. If one of these
// fails, re-run `npm --prefix remix run branding-assets` and commit the result.

test('the committed manifest lists every cut in registry order', () => {
  const manifest = readJson('brandingAssets.generated.json');
  assert.deepEqual(
    manifest.variants.map((variant: { slug: string }) => variant.slug),
    BRAND_LOGO_VARIANTS.map((variant) => variant.slug)
  );
  for (const variant of BRAND_LOGO_VARIANTS) {
    const entry = manifest.variants.find((candidate: { slug: string }) => candidate.slug === variant.slug);
    const { totalColumns, totalRows } = buildVariantSvg(variant);
    assert.deepEqual(entry.aspect, { cols: totalColumns, rows: totalRows }, `${variant.slug} aspect`);
    assert.equal(entry.name, variant.name);
    assert.equal(entry.svg.url, brandSvgUrl(variant.slug));
    assert.equal(entry.pngs.length, manifest.sizes.length);
  }
});

test('every ready-made file the manifests promise exists on disk', () => {
  const manifest = readJson('brandingAssets.generated.json');
  const surfaces = readJson('brandingSurfaces.generated.json');
  const missing: string[] = [];
  const need = (url: string) => {
    if (!existsSync(path.join(PUBLIC_DIR, url))) missing.push(url);
  };
  for (const variant of BRAND_LOGO_VARIANTS) {
    const entry = manifest.variants.find((candidate: { slug: string }) => candidate.slug === variant.slug);
    need(entry.svg.url);
    entry.pngs.forEach((png: { url: string }) => need(png.url));
    for (const surface of ['light', 'dark'] as const) {
      const ladder = surfaces[variant.slug]?.[surface];
      assert.ok(ladder, `${variant.slug} has a ${surface} ladder`);
      const { totalColumns, totalRows } = buildVariantSvg(variant, surface);
      assert.deepEqual(ladder.aspect, { cols: totalColumns, rows: totalRows }, `${variant.slug} ${surface} aspect`);
      assert.equal(ladder.pngs.length, manifest.sizes.length);
      need(brandSvgUrl(variant.slug, surface));
      ladder.pngs.forEach(([w, h]: number[]) => need(brandPngUrl(variant.slug, surface, w, h)));
    }
  }
  manifest.presskit.forEach((item: { url: string }) => need(item.url));
  assert.deepEqual(missing, []);
});

test('every press-kit format ships each logo on light and on dark', () => {
  const { presskit } = readJson('brandingAssets.generated.json') as {
    presskit: Array<{ slug: string; kind: string; logo: string | null; surface: string; url: string }>;
  };
  assert.equal(new Set(presskit.map((item) => item.slug)).size, presskit.length, 'slugs are unique');
  for (const kind of new Set(presskit.map((item) => item.kind))) {
    const combos = presskit.filter((item) => item.kind === kind).map((item) => `${item.logo ?? 'none'}/${item.surface}`).sort();
    const expected =
      kind === 'confetti-pattern'
        ? ['none/dark', 'none/light']
        : ['icon/dark', 'icon/light', 'square/dark', 'square/light', 'wordmark/dark', 'wordmark/light'];
    assert.deepEqual(combos, expected, `${kind} combinations`);
  }
  // filenames published before the logo × background matrix stay put
  const urlOf = (slug: string) => presskit.find((item) => item.slug === slug)?.url;
  assert.equal(urlOf('og-card'), '/branding/presskit/thingtime-og-card-1200x630.png');
  assert.equal(urlOf('wallpaper-phone'), '/branding/presskit/thingtime-wallpaper-phone-1170x2532.png');
  assert.equal(urlOf('app-tile-dark'), '/branding/presskit/thingtime-app-tile-dark-1024x1024.png');
});
