import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { brandImagesFor } from '../../api/utils/seo/sitemapCore';
import { BRAND_IMAGERY, brandImageryUrl } from './brandImagery';
import {
  BRAND_BACKDROPS,
  BRAND_PATTERNS,
  DEFAULT_SCENE,
  IMAGERY_FORMATS,
  SCENE_LIMITS,
  buildBrandScene,
  describeScene,
  normaliseSceneOptions,
  paintScene,
  sceneSlug,
  sceneToSvg
} from './brandScenes';
import type { BrandScene, SceneRect } from './brandScenes';
import { LOGO_FULL_MATRIX, LOGO_THEMES } from './logoMatrix';
import { BRAND_LOGO_VARIANTS, logoPixels } from './logoVariants';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', '..', '..', 'public');
const readJson = (name: string) => JSON.parse(readFileSync(path.join(HERE, name), 'utf8'));

const overlaps = ([x, y, w, h]: SceneRect, box: BrandScene['logoBox']) =>
  x < box.x + box.width && x + w > box.x && y < box.y + box.height && y + h > box.y;

// ---------------------------------------------------------------------------
// The wordmark the scenes are built from

test('the wordmark is the owner’s horizontal artwork, voxel for voxel', () => {
  // public/branding/thingtime-horizontal.svg: one 31px square <path> per voxel.
  const svg = readFileSync(path.join(PUBLIC_DIR, 'branding', 'thingtime-horizontal.svg'), 'utf8');
  const artwork = new Map<string, string>();
  for (const [, x1, y, x2, fill] of svg.matchAll(/<path d="M(\d+) (\d+)H(\d+)V\d+H\d+V\d+Z" fill="(#[0-9A-Fa-f]{6})"\/>/g)) {
    artwork.set(`${Math.min(Number(x1), Number(x2)) / 31},${Number(y) / 31}`, fill.toLowerCase());
  }
  assert.equal(artwork.size, 39, 'every artwork voxel was read');

  const pixels = logoPixels(LOGO_FULL_MATRIX, LOGO_THEMES.default);
  const drawn = new Map<string, string>();
  pixels.forEach((row, y) => row.forEach((colour, x) => colour && drawn.set(`${x},${y}`, colour)));
  assert.deepEqual([...drawn.keys()].sort(), [...artwork.keys()].sort(), 'same voxels in the same places');

  // Same colours too, give or take the export's ±1 rounding per channel.
  const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  for (const [at, colour] of drawn) {
    const want = channels(artwork.get(at) as string);
    channels(colour).forEach((value, index) => assert.ok(Math.abs(value - want[index]) <= 2, `${at}: ${colour} vs ${artwork.get(at)}`));
  }

  // The detail this guards: the two i's mirror each other, and the n is the artwork's pink.
  assert.equal(drawn.get('7,0'), '#ed1c24', 'first i: red on top');
  assert.equal(drawn.get('7,2'), '#00b7ef', 'first i: cyan below');
  assert.equal(drawn.get('19,0'), '#00b7ef', 'second i: cyan on top');
  assert.equal(drawn.get('19,2'), '#ed1c24', 'second i: red below');
  assert.equal(LOGO_THEMES.default[5], '#ffa9dd');
});

// ---------------------------------------------------------------------------
// The scene engine

test('a scene is deterministic, and a new seed deals a new arrangement', () => {
  const options = { ...DEFAULT_SCENE, pattern: 'confetti', seed: 42 };
  assert.deepEqual(buildBrandScene(options), buildBrandScene(options));
  assert.notDeepEqual(buildBrandScene(options).rects, buildBrandScene({ ...options, seed: 43 }).rects);
});

test('every backdrop × pattern builds whole-pixel rectangles inside the canvas', () => {
  const sizes = [
    [1080, 1080],
    [1500, 500],
    [1290, 2796],
    [333, 201]
  ];
  for (const backdrop of BRAND_BACKDROPS) {
    for (const pattern of BRAND_PATTERNS) {
      for (const [width, height] of sizes) {
        const scene = buildBrandScene({ width, height, backdrop: backdrop.key, pattern: pattern.key, logo: 'logo', seed: 9 });
        const label = `${backdrop.key}/${pattern.key}/${width}x${height}`;
        assert.ok(scene.rects.length > 0, label);
        for (const [x, y, w, h, colour] of scene.rects) {
          assert.ok([x, y, w, h].every(Number.isInteger), `${label}: integers`);
          assert.ok(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= width && y + h <= height, `${label}: inside the canvas`);
          assert.match(colour, /^#[0-9a-f]{6}$|^hotpink$/, `${label}: ${colour}`);
        }
      }
    }
  }
});

test('the backdrop covers every pixel, so no picture has holes', () => {
  for (const backdrop of BRAND_BACKDROPS) {
    const scene = buildBrandScene({ width: 97, height: 61, backdrop: backdrop.key, pattern: 'none', logo: 'icon' });
    const covered = new Uint8Array(97 * 61);
    for (const [x, y, w, h] of scene.rects) {
      for (let yy = y; yy < y + h; yy += 1) covered.fill(1, yy * 97 + x, yy * 97 + x + w);
    }
    assert.ok(covered.every(Boolean), backdrop.key);
  }
});

test('every logo cut fits inside the picture at any size setting', () => {
  for (const variant of BRAND_LOGO_VARIANTS) {
    for (const logoSize of [SCENE_LIMITS.logoSize.min, 0.75, SCENE_LIMITS.logoSize.max]) {
      for (const [width, height] of [
        [1080, 1080],
        [1500, 500],
        [1080, 1920]
      ]) {
        const { logoBox } = buildBrandScene({ width, height, logo: variant.slug, logoSize, backdrop: 'ink', pattern: 'none' });
        assert.ok(
          logoBox.x >= 0 && logoBox.y >= 0 && logoBox.x + logoBox.width <= width && logoBox.y + logoBox.height <= height,
          `${variant.slug} at ${logoSize} on ${width}x${height}`
        );
      }
    }
  }
});

test('scattered patterns keep clear of the logo', () => {
  // On plain paper the backdrop is one rectangle and there is no plate, so
  // everything between it and the logo's own rectangles is the pattern.
  const clean = buildBrandScene({ ...DEFAULT_SCENE, pattern: 'none' });
  const logoRects = clean.rects.length - 1;
  for (const pattern of ['confetti', 'stars', 'dots', 'tiles', 'rain', 'frame', 'stairs']) {
    const scene = buildBrandScene({ ...DEFAULT_SCENE, pattern, density: 1, seed: 3 });
    const scattered = scene.rects.slice(1, scene.rects.length - logoRects);
    assert.ok(scattered.length > 0, `${pattern} draws something`);
    assert.equal(scattered.filter((rect) => overlaps(rect, scene.logoBox)).length, 0, `${pattern} stays off the logo`);
  }
});

test('plate: auto adds a panel only where the backdrop needs one', () => {
  const rectsFor = (backdrop: string, plate: 'auto' | 'none' | 'light' | 'dark') =>
    buildBrandScene({ ...DEFAULT_SCENE, backdrop, pattern: 'none', plate }).rects.length;
  assert.equal(rectsFor('paper', 'auto'), rectsFor('paper', 'none'));
  assert.equal(rectsFor('ink', 'auto'), rectsFor('ink', 'none'));
  // shadow + panel, two rectangles each
  assert.equal(rectsFor('sunshine', 'auto'), rectsFor('sunshine', 'none') + 4);
  assert.equal(rectsFor('sunshine', 'auto'), rectsFor('sunshine', 'light'));
  assert.equal(rectsFor('paper', 'dark'), rectsFor('paper', 'none') + 4);
});

test('options are normalised: unknown keys fall back, numbers are clamped', () => {
  const tidy = normaliseSceneOptions({
    width: 12.4,
    height: Number.NaN,
    logo: 'nope',
    backdrop: 'nope',
    pattern: 'nope',
    seed: -3.2,
    logoSize: 99,
    density: -1,
    grain: 1000,
    plate: 'sideways' as never
  });
  assert.deepEqual(tidy, {
    width: 16,
    height: DEFAULT_SCENE.height,
    logo: DEFAULT_SCENE.logo,
    backdrop: BRAND_BACKDROPS[0].key,
    pattern: BRAND_PATTERNS[0].key,
    seed: 4294967293,
    logoSize: SCENE_LIMITS.logoSize.max,
    density: 0,
    grain: SCENE_LIMITS.grain.max,
    plate: 'auto'
  });
  assert.deepEqual(normaliseSceneOptions(), DEFAULT_SCENE);
});

test('the SVG carries one rect per rectangle at the scene size', () => {
  const scene = buildBrandScene({ ...DEFAULT_SCENE, width: 640, height: 360, backdrop: 'sunset', pattern: 'hills' });
  const svg = sceneToSvg(scene);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="640" height="360" viewBox="0 0 640 360" shape-rendering="crispEdges">/);
  assert.equal(svg.match(/<rect /g)?.length, scene.rects.length);
  assert.ok(svg.endsWith('</svg>'));
});

test('a scaled preview keeps shared edges shared and stays on the canvas', () => {
  const scene = buildBrandScene({ ...DEFAULT_SCENE, width: 1080, height: 1920, backdrop: 'prism', pattern: 'checker' });
  const scale = 0.37;
  const width = Math.round(1080 * scale);
  const height = Math.round(1920 * scale);
  const covered = new Uint8Array(width * height);
  const painted: number[][] = [];
  const context = {
    fillStyle: '' as string | CanvasGradient | CanvasPattern,
    fillRect: (x: number, y: number, w: number, h: number) => {
      painted.push([x, y, w, h]);
      for (let yy = y; yy < y + h; yy += 1) covered.fill(1, yy * width + x, yy * width + x + w);
    }
  };
  paintScene(scene, context, scale);
  assert.ok(painted.every(([x, y, w, h]) => [x, y, w, h].every(Number.isInteger) && x >= 0 && y >= 0 && x + w <= width && y + h <= height));
  assert.ok(covered.every(Boolean), 'no seams between neighbouring cells');

  // unscaled, the painter replays the scene exactly
  const exact: number[][] = [];
  paintScene(scene, { fillStyle: '', fillRect: (x, y, w, h) => exact.push([x, y, w, h]) });
  assert.deepEqual(exact, scene.rects.map(([x, y, w, h]) => [x, y, w, h]));
});

test('scene names and file stems', () => {
  assert.equal(describeScene({ logo: 'logo-square', backdrop: 'ink', pattern: 'confetti' }), 'Square · Dark · Confetti');
  assert.equal(describeScene({ logo: 'icon', backdrop: 'sky', pattern: 'none' }), 'Tree · Sky');
  assert.equal(describeScene({ logo: 'icon-pink', backdrop: 'grape', pattern: 'tiles' }), 'Tree · Pink · Grape · Tree tiles');
  assert.equal(sceneSlug({ logo: 'icon', backdrop: 'sky', pattern: 'none' }), 'icon-sky-clean');
  assert.equal(sceneSlug({ logo: 'logo-rainbow', backdrop: 'ink', pattern: 'dust' }), 'logo-rainbow-ink-dust');
});

// ---------------------------------------------------------------------------
// The curated set

test('the curated set is 50–100 scenes with unique names', () => {
  assert.ok(BRAND_IMAGERY.length >= 50 && BRAND_IMAGERY.length <= 100, `${BRAND_IMAGERY.length} scenes`);
  assert.equal(new Set(BRAND_IMAGERY.map((item) => item.id)).size, BRAND_IMAGERY.length);
  assert.equal(new Set(BRAND_IMAGERY.map((item) => item.name)).size, BRAND_IMAGERY.length);
  for (const item of BRAND_IMAGERY) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.deepEqual(item.scene, normaliseSceneOptions(item.scene), `${item.id} is already normalised`);
    assert.equal(item.scene.width, item.format.width);
    assert.equal(item.scene.height, item.format.height);
  }
});

test('the curated set uses every format, logo cut, backdrop and pattern', () => {
  const seen = (pick: (item: (typeof BRAND_IMAGERY)[number]) => string) => new Set(BRAND_IMAGERY.map(pick));
  assert.deepEqual([...seen((item) => item.format.key)].sort(), IMAGERY_FORMATS.map((format) => format.key).sort());
  assert.deepEqual([...seen((item) => item.scene.logo)].sort(), BRAND_LOGO_VARIANTS.map((variant) => variant.slug).sort());
  assert.deepEqual([...seen((item) => item.scene.backdrop)].sort(), BRAND_BACKDROPS.map((backdrop) => backdrop.key).sort());
  assert.deepEqual([...seen((item) => item.scene.pattern)].sort(), BRAND_PATTERNS.map((pattern) => pattern.key).sort());
});

test('the square, the tree and the ways to play are all well represented', () => {
  const count = (test: (item: (typeof BRAND_IMAGERY)[number]) => boolean) => BRAND_IMAGERY.filter(test).length;
  assert.ok(count((item) => item.shape === 'square') >= 20, 'square');
  assert.ok(count((item) => item.shape === 'tree') >= 20, 'tree');
  assert.ok(count((item) => item.shape === 'wordmark') >= 20, 'wordmark');
  assert.ok(count((item) => item.fun) >= 30, 'ways to play');
  // …and the gallery opens on a mix rather than a wall of one lock-up
  const firstPage = BRAND_IMAGERY.slice(0, 12);
  assert.deepEqual([...new Set(firstPage.map((item) => item.shape))].sort(), ['square', 'tree', 'wordmark']);
  assert.ok(firstPage.some((item) => item.fun));
  assert.ok(new Set(firstPage.map((item) => item.format.key)).size >= 6);
});

test('the committed imagery manifest matches the registry and every file is on disk', () => {
  const { items } = readJson('brandingImagery.generated.json') as {
    items: Array<{ id: string; name: string; w: number; h: number; url: string; bytes: number }>;
  };
  assert.deepEqual(
    items.map((item) => [item.id, item.name, item.w, item.h, item.url]),
    BRAND_IMAGERY.map((item) => [item.id, item.name, item.format.width, item.format.height, brandImageryUrl(item)])
  );
  for (const item of items) {
    const file = path.join(PUBLIC_DIR, item.url);
    assert.ok(existsSync(file), item.url);
    const png = readFileSync(file);
    assert.equal(png.length, item.bytes, `${item.url} size`);
    assert.equal(png.toString('latin1', 1, 4), 'PNG');
    assert.equal(png.readUInt32BE(16), item.w, `${item.url} width`);
    assert.equal(png.readUInt32BE(20), item.h, `${item.url} height`);
  }
});

// Minimal reader for the generator's own PNGs: palette colour, filters None/Up.
const decodePalettePng = (png: Buffer): { width: number; height: number; pixel: (x: number, y: number) => string } => {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const depth = png[24];
  assert.equal(png[25], 3, 'palette PNG');
  let palette: Buffer = Buffer.alloc(0);
  const data: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'PLTE') palette = body;
    if (type === 'IDAT') data.push(body);
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = Math.ceil((width * depth) / 8);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const filter = raw[y * (stride + 1)];
    assert.ok(filter === 0 || filter === 2, `filter ${filter}`);
    rows.push(filter === 0 ? line : Buffer.from(line.map((value, i) => (value + rows[y - 1][i]) & 0xff)));
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const bit = x * depth;
      const index = (rows[y][bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      return `#${palette.subarray(index * 3, index * 3 + 3).toString('hex')}`;
    }
  };
};

test('a committed picture is exactly what the scene engine draws', () => {
  const named: Record<string, string> = { hotpink: '#ff69b4' };
  for (const item of [BRAND_IMAGERY[0], BRAND_IMAGERY[7], BRAND_IMAGERY[BRAND_IMAGERY.length - 1]]) {
    const file = decodePalettePng(readFileSync(path.join(PUBLIC_DIR, brandImageryUrl(item))));
    const scene = buildBrandScene(item.scene);
    assert.deepEqual([file.width, file.height], [scene.width, scene.height]);
    // paint the rectangles in order, as the studio's canvas does
    const expected = new Array<string>(scene.width * scene.height);
    for (const [x, y, w, h, colour] of scene.rects) {
      for (let yy = y; yy < y + h; yy += 1) expected.fill(named[colour] ?? colour, yy * scene.width + x, yy * scene.width + x + w);
    }
    let different = 0;
    for (let y = 0; y < scene.height; y += 1) {
      for (let x = 0; x < scene.width; x += 1) if (file.pixel(x, y) !== expected[y * scene.width + x]) different += 1;
    }
    assert.equal(different, 0, `${item.id}: every pixel matches`);
  }
});

test('the sitemap lists the curated imagery beside the logos and press kit', () => {
  const assets = readJson('brandingAssets.generated.json');
  const { items } = readJson('brandingImagery.generated.json');
  const without = brandImagesFor('https://thingtime.com', '/branding', assets);
  const withImagery = brandImagesFor('https://thingtime.com', '/branding', { ...assets, imagery: items });
  assert.equal(withImagery.length, without.length + BRAND_IMAGERY.length);
  assert.ok(
    withImagery.some(
      (image) =>
        image.loc === 'https://thingtime.com/branding/imagery/thingtime-square-post-logo-square-paper-confetti-1080x1080.png' &&
        image.title === 'Thingtime Square post · Square · Light · Confetti'
    )
  );
  assert.equal(brandImagesFor('https://thingtime.com', '/feed', { ...assets, imagery: items }).length, 0);
});
