// Generative ready-to-post imagery for the /branding page.
//
// A scene is a logo cut on a backdrop with a voxel pattern around it, described
// by a handful of options (size, logo, backdrop, pattern, seed, …) and resolved
// into a flat list of axis-aligned, integer-pixel rectangles. Rectangles are
// the one primitive every target shares, so the same list paints the studio's
// <canvas>, the committed PNGs (scripts/generate-branding-assets.mjs) and a
// downloadable SVG — pixel for pixel, with no antialiasing to disagree about.
//
// Everything is deterministic: the same options always give the same picture.
// Like logoVariants.ts this file is imported by the node generator under type
// stripping, hence the explicit `.ts` specifiers and erasable-only syntax.

import {
  BAYER_4,
  BRAND_LOGO_VARIANTS,
  CONFETTI_PALETTE,
  brandLogoVariant,
  gradientColour,
  logoPixels,
  mixColours,
  seededRandom
} from './logoVariants.ts';
import { RAINBOW_PALETTE } from '../../theme/tokens.ts';

const WHITE = '#ffffff';
const INK = '#16161a';
const GRASS = '#a8e61d';
const SOIL = '#9c5a3c';

// ---------------------------------------------------------------------------
// Options

export type BrandScenePlate = 'auto' | 'none' | 'light' | 'dark';

export type BrandSceneOptions = {
  width: number;
  height: number;
  /** A slug from BRAND_LOGO_VARIANTS. */
  logo: string;
  /** A key from BRAND_BACKDROPS. */
  backdrop: string;
  /** A key from BRAND_PATTERNS. */
  pattern: string;
  /** Any integer — a different seed reshuffles the pattern. */
  seed: number;
  /** 0.2–1.6: how much of the safe area the logo fills (above 1 it spills past it). */
  logoSize: number;
  /** 0–1: how busy the pattern is. */
  density: number;
  /** Pattern cells across the shorter side — smaller numbers, chunkier voxels. */
  grain: number;
  /** A solid panel behind the logo; `auto` adds one where the backdrop needs it. */
  plate: BrandScenePlate;
};

export const DEFAULT_SCENE: BrandSceneOptions = {
  width: 1080,
  height: 1080,
  logo: 'logo-square',
  backdrop: 'paper',
  pattern: 'confetti',
  seed: 1,
  logoSize: 0.75,
  density: 0.5,
  grain: 36,
  plate: 'auto'
};

export const SCENE_LIMITS = {
  logoSize: { min: 0.2, max: 1.6 },
  density: { min: 0, max: 1 },
  grain: { min: 12, max: 96 }
} as const;

// ---------------------------------------------------------------------------
// Backdrops: one colour per pattern cell, so gradients step in voxels

type CellColour = (cx: number, cy: number, cols: number, rows: number) => string;

export type BrandBackdrop = {
  key: string;
  label: string;
  /** Decides whether quiet patterns darken or lighten the backdrop. */
  tone: 'light' | 'dark';
  /** The panel `plate: 'auto'` puts behind the logo to keep it legible. */
  plate: 'none' | 'light' | 'dark';
  /** CSS background for the picker chip. */
  swatch: string;
  colourAt: CellColour;
};

const solid = (colour: string): CellColour => () => colour;
const vertical = (stops: readonly string[]): CellColour => (_cx, cy, _cols, rows) => gradientColour(stops, rows > 1 ? cy / (rows - 1) : 0);
const diagonal = (stops: readonly string[]): CellColour => (cx, cy, cols, rows) =>
  gradientColour(stops, cols + rows > 2 ? (cx + cy) / (cols + rows - 2) : 0);
const cssGradient = (angle: number, stops: readonly string[]) => `linear-gradient(${angle}deg, ${stops.join(', ')})`;

const PASTEL_STOPS = RAINBOW_PALETTE.map((colour) => mixColours(colour, WHITE, 0.62));
const DUSK_STOPS = RAINBOW_PALETTE.map((colour) => mixColours(colour, INK, 0.3));
const SUNSET_STOPS = ['#6f3198', '#ff69b4', '#ff7e00', '#ffc20e'];
const SKY_STOPS = ['#59bdff', '#bfe6ff', '#f2fbff'];
const NIGHT_STOPS = [INK, '#241a3f', '#4a2a7a'];

export const BRAND_BACKDROPS: BrandBackdrop[] = [
  { key: 'paper', label: 'Light', tone: 'light', plate: 'none', swatch: WHITE, colourAt: solid(WHITE) },
  { key: 'ink', label: 'Dark', tone: 'dark', plate: 'none', swatch: INK, colourAt: solid(INK) },
  { key: 'pastel', label: 'Pastel rainbow', tone: 'light', plate: 'light', swatch: cssGradient(135, PASTEL_STOPS), colourAt: diagonal(PASTEL_STOPS) },
  { key: 'dusk', label: 'Dusk rainbow', tone: 'dark', plate: 'dark', swatch: cssGradient(135, DUSK_STOPS), colourAt: diagonal(DUSK_STOPS) },
  { key: 'prism', label: 'Prism', tone: 'dark', plate: 'light', swatch: cssGradient(135, RAINBOW_PALETTE), colourAt: diagonal(RAINBOW_PALETTE) },
  { key: 'sunset', label: 'Sunset', tone: 'dark', plate: 'light', swatch: cssGradient(180, SUNSET_STOPS), colourAt: vertical(SUNSET_STOPS) },
  { key: 'sky', label: 'Sky', tone: 'light', plate: 'light', swatch: cssGradient(180, SKY_STOPS), colourAt: vertical(SKY_STOPS) },
  { key: 'night', label: 'Night', tone: 'dark', plate: 'none', swatch: cssGradient(180, NIGHT_STOPS), colourAt: vertical(NIGHT_STOPS) },
  { key: 'mint', label: 'Mint', tone: 'light', plate: 'light', swatch: '#59ff9c', colourAt: solid('#59ff9c') },
  { key: 'sunshine', label: 'Sunshine', tone: 'light', plate: 'light', swatch: '#ffc20e', colourAt: solid('#ffc20e') },
  { key: 'bubblegum', label: 'Bubblegum', tone: 'light', plate: 'light', swatch: '#ffa9dd', colourAt: solid('#ffa9dd') },
  { key: 'grape', label: 'Grape', tone: 'dark', plate: 'light', swatch: '#6f3198', colourAt: solid('#6f3198') }
];

export const brandBackdrop = (key: string): BrandBackdrop => BRAND_BACKDROPS.find((entry) => entry.key === key) ?? BRAND_BACKDROPS[0];

// ---------------------------------------------------------------------------
// Patterns

export const BRAND_PATTERNS: Array<{ key: string; label: string }> = [
  { key: 'none', label: 'Clean' },
  { key: 'confetti', label: 'Confetti' },
  { key: 'stars', label: 'Stars' },
  { key: 'dots', label: 'Dots' },
  { key: 'checker', label: 'Checker' },
  { key: 'mosaic', label: 'Mosaic' },
  { key: 'tiles', label: 'Tree tiles' },
  { key: 'frame', label: 'Pixel frame' },
  { key: 'stairs', label: 'Rainbow stairs' },
  { key: 'dust', label: 'Pixel dust' },
  { key: 'rain', label: 'Pixel rain' },
  { key: 'blocks', label: 'Skyline' },
  { key: 'hills', label: 'Rolling hills' },
  { key: 'forest', label: 'Forest' }
];

export const brandPattern = (key: string) => BRAND_PATTERNS.find((entry) => entry.key === key) ?? BRAND_PATTERNS[0];

// These fill the bottom of the picture, so the logo rides a little higher.
const BOTTOM_HEAVY = new Set(['dust', 'blocks', 'hills', 'forest']);

const LEAF_COLOURS = [GRASS, '#58ca70', '#ffa9dd', '#ff7e00', '#ffc20e', '#59bdff', '#ff69b4'];

// ---------------------------------------------------------------------------
// Ready-made canvas sizes

export type BrandImageryFormat = { key: string; label: string; hint: string; width: number; height: number };

export const IMAGERY_FORMATS: BrandImageryFormat[] = [
  { key: 'square-post', label: 'Square post', hint: 'Feeds · 1:1', width: 1080, height: 1080 },
  { key: 'portrait-post', label: 'Portrait post', hint: 'Feeds · 4:5', width: 1080, height: 1350 },
  { key: 'story', label: 'Story', hint: 'Stories and reels · 9:16', width: 1080, height: 1920 },
  { key: 'link-card', label: 'Link card', hint: 'Link previews · 1.91:1', width: 1200, height: 630 },
  { key: 'banner', label: 'Banner', hint: 'Profile headers · 3:1', width: 1500, height: 500 },
  { key: 'slide', label: 'Slide', hint: 'Decks and video · 16:9', width: 1920, height: 1080 },
  { key: 'desktop', label: 'Desktop wallpaper', hint: 'Screens · 16:9', width: 2560, height: 1440 },
  { key: 'phone', label: 'Phone wallpaper', hint: 'Lock screens', width: 1290, height: 2796 }
];

export const imageryFormat = (key: string): BrandImageryFormat | undefined => IMAGERY_FORMATS.find((entry) => entry.key === key);

// ---------------------------------------------------------------------------
// Building a scene

/** [x, y, width, height, colour] in whole pixels, painted in order. */
export type SceneRect = [number, number, number, number, string];

export type BrandScene = {
  width: number;
  height: number;
  rects: SceneRect[];
  /** Pattern cell size in px. */
  cell: number;
  /** Where the logo artwork landed. */
  logoBox: { x: number; y: number; width: number; height: number };
  options: BrandSceneOptions;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Fill in defaults and pull every number into its working range. */
export const normaliseSceneOptions = (input: Partial<BrandSceneOptions> = {}): BrandSceneOptions => ({
  width: Math.max(16, Math.round(finite(input.width, DEFAULT_SCENE.width))),
  height: Math.max(16, Math.round(finite(input.height, DEFAULT_SCENE.height))),
  logo: brandLogoVariant(input.logo ?? '') ? (input.logo as string) : DEFAULT_SCENE.logo,
  backdrop: brandBackdrop(input.backdrop ?? DEFAULT_SCENE.backdrop).key,
  pattern: brandPattern(input.pattern ?? DEFAULT_SCENE.pattern).key,
  seed: Math.round(finite(input.seed, DEFAULT_SCENE.seed)) >>> 0,
  logoSize: clamp(finite(input.logoSize, DEFAULT_SCENE.logoSize), SCENE_LIMITS.logoSize.min, SCENE_LIMITS.logoSize.max),
  density: clamp(finite(input.density, DEFAULT_SCENE.density), SCENE_LIMITS.density.min, SCENE_LIMITS.density.max),
  grain: Math.round(clamp(finite(input.grain, DEFAULT_SCENE.grain), SCENE_LIMITS.grain.min, SCENE_LIMITS.grain.max)),
  plate: input.plate === 'none' || input.plate === 'light' || input.plate === 'dark' ? input.plate : 'auto'
});

export const buildBrandScene = (input: Partial<BrandSceneOptions> = {}): BrandScene => {
  const options = normaliseSceneOptions(input);
  const { width: w, height: h, density } = options;
  const backdrop = brandBackdrop(options.backdrop);
  const variant = brandLogoVariant(options.logo) ?? BRAND_LOGO_VARIANTS[0];
  const rand = seededRandom(options.seed);
  const rects: SceneRect[] = [];

  // The pattern grid: centred, except bottom-heavy patterns sit on the bottom edge.
  const minDim = Math.min(w, h);
  const g = Math.max(2, Math.round(minDim / options.grain));
  const cols = Math.ceil(w / g);
  const rows = Math.ceil(h / g);
  const grounded = BOTTOM_HEAVY.has(options.pattern);
  const ox = Math.floor((w - cols * g) / 2);
  const oy = grounded ? h - rows * g : Math.floor((h - rows * g) / 2);

  const push = (x: number, y: number, rw: number, rh: number, colour: string) => {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(w, x + rw);
    const y1 = Math.min(h, y + rh);
    if (x1 > x0 && y1 > y0) rects.push([x0, y0, x1 - x0, y1 - y0, colour]);
  };
  const cell = (cx: number, cy: number, colour: string, wide = 1, tall = 1) => push(ox + cx * g, oy + cy * g, wide * g, tall * g, colour);

  // Backdrop, with equal neighbours merged into bigger rectangles.
  const base = Array.from({ length: rows }, (_, cy) => Array.from({ length: cols }, (_, cx) => backdrop.colourAt(cx, cy, cols, rows)));
  for (let cy = 0; cy < rows; ) {
    const signature = base[cy].join();
    let tall = 1;
    while (cy + tall < rows && base[cy + tall].join() === signature) tall += 1;
    for (let cx = 0; cx < cols; ) {
      let wide = 1;
      while (cx + wide < cols && base[cy][cx + wide] === base[cy][cx]) wide += 1;
      cell(cx, cy, base[cy][cx], wide, tall);
      cx += wide;
    }
    cy += tall;
  }
  const baseAt = (cx: number, cy: number) => base[clamp(cy, 0, rows - 1)][clamp(cx, 0, cols - 1)];
  const tint = (cx: number, cy: number, amount: number) => mixColours(baseAt(cx, cy), backdrop.tone === 'dark' ? WHITE : INK, amount);

  // Logo layout first: the patterns need to know what to keep clear.
  const pixels = logoPixels(variant.matrix, variant.colourMap, true);
  const subCols = Math.max(1, ...pixels.map((row) => row.length));
  const subRows = Math.max(1, pixels.length);
  const u = Math.max(
    1,
    Math.floor(
      Math.min(
        (w * 0.84 * options.logoSize) / subCols,
        (h * (grounded ? 0.44 : 0.56) * options.logoSize) / subRows,
        // however large the ask, the artwork stays inside the picture
        (w * 0.94) / subCols,
        (h * 0.94) / subRows
      )
    )
  );
  const logoWidth = subCols * u;
  const logoHeight = subRows * u;
  const logoX = Math.round((w - logoWidth) / 2);
  const logoY = Math.round(h * (grounded ? 0.38 : 0.5) - logoHeight / 2);
  const voxel = u * variant.unit;
  const plate = options.plate === 'auto' ? backdrop.plate : options.plate;
  const pad = plate === 'none' ? 0 : Math.round(clamp(voxel * 0.9, minDim * 0.035, minDim * 0.07));
  const box = { x0: logoX - pad, y0: logoY - pad, x1: logoX + logoWidth + pad, y1: logoY + logoHeight + pad };
  const margin = Math.max(g, Math.round(voxel * 0.5));
  const blocked = (x: number, y: number, rw: number, rh: number) =>
    x < box.x1 + margin && x + rw > box.x0 - margin && y < box.y1 + margin && y + rh > box.y0 - margin;
  const cellBlocked = (cx: number, cy: number, wide = 1, tall = 1) => blocked(ox + cx * g, oy + cy * g, wide * g, tall * g);

  // Accent colours, minus any the backdrop would swallow.
  const used = new Set(base.flat());
  const palette = CONFETTI_PALETTE.filter((colour) => !used.has(colour));
  const pick = <T,>(from: readonly T[]): T => from[Math.floor(rand() * from.length)];
  const pickUnlike = (from: readonly string[], previous: string) => {
    const options = from.filter((colour) => colour !== previous);
    return pick(options.length ? options : from);
  };

  switch (options.pattern) {
    case 'confetti': {
      const count = Math.round(cols * rows * (0.015 + 0.09 * density));
      const small = Math.max(1, Math.round(g / 2));
      const inset = Math.floor((g - small) / 2);
      for (let i = 0; i < count; i += 1) {
        const cx = Math.floor(rand() * cols);
        const cy = Math.floor(rand() * rows);
        const half = rand() < 0.35;
        const colour = pick(palette);
        if (cellBlocked(cx, cy)) continue;
        if (half) push(ox + cx * g + inset, oy + cy * g + inset, small, small, colour);
        else cell(cx, cy, colour);
      }
      break;
    }
    case 'stars': {
      const colours = backdrop.tone === 'dark' ? [WHITE, WHITE, '#ffc20e', '#59bdff', '#ffa9dd'] : palette;
      const count = Math.round(cols * rows * (0.01 + 0.05 * density));
      for (let i = 0; i < count; i += 1) {
        const cx = Math.floor(rand() * cols);
        const cy = Math.floor(rand() * rows);
        const size = Math.max(1, Math.round(g * pick([0.2, 0.3, 0.45])));
        const sparkle = rand() < 0.18;
        const x = ox + cx * g + Math.floor(rand() * Math.max(1, g - size));
        const y = oy + cy * g + Math.floor(rand() * Math.max(1, g - size));
        const colour = pick(colours);
        if (blocked(x - size, y - size, size * 3, size * 3)) continue;
        if (sparkle) {
          push(x - size, y, size * 3, size, colour);
          push(x, y - size, size, size * 3, colour);
        } else {
          push(x, y, size, size, colour);
        }
      }
      break;
    }
    case 'dots': {
      const step = Math.max(2, Math.round(5 - 3 * density));
      const size = Math.max(1, Math.round(g * 0.3));
      const inset = Math.floor((g - size) / 2);
      for (let cy = Math.floor(((rows - 1) % step) / 2); cy < rows; cy += step) {
        for (let cx = Math.floor(((cols - 1) % step) / 2); cx < cols; cx += step) {
          if (!cellBlocked(cx, cy)) push(ox + cx * g + inset, oy + cy * g + inset, size, size, tint(cx, cy, 0.18));
        }
      }
      break;
    }
    case 'checker': {
      const block = 2;
      const amount = 0.04 + 0.08 * density;
      for (let by = 0; by * block < rows; by += 1) {
        for (let bx = by % 2; bx * block < cols; bx += 2) cell(bx * block, by * block, tint(bx * block, by * block, amount), block, block);
      }
      break;
    }
    case 'mosaic': {
      const strength = 0.1 + 0.3 * density;
      for (let cy = 0; cy < rows; cy += 1) {
        for (let cx = 0; cx < cols; cx += 1) {
          const colour = pick(palette);
          const amount = strength * (0.35 + rand() * 0.65);
          if (rand() < 0.6) cell(cx, cy, mixColours(base[cy][cx], colour, amount));
        }
      }
      break;
    }
    case 'tiles': {
      const step = Math.max(4, 7 - Math.round(density * 3));
      const amount = 0.09 + 0.09 * density;
      for (let cy = 1, row = 0; cy + 3 <= rows; cy += step, row += 1) {
        for (let cx = 1 + (row % 2 ? Math.floor(step / 2) : 0); cx + 3 <= cols; cx += step) {
          if (cellBlocked(cx, cy, 3, 3)) continue;
          const leaf = tint(cx + 1, cy + 1, amount);
          cell(cx + 1, cy, leaf);
          cell(cx, cy + 1, leaf);
          cell(cx + 2, cy + 1, leaf);
          cell(cx + 1, cy + 2, tint(cx + 1, cy + 1, amount * 1.7));
        }
      }
      break;
    }
    case 'frame': {
      const ring: Array<[number, number]> = [];
      for (let cx = 1; cx <= cols - 2; cx += 1) ring.push([cx, 1]);
      for (let cy = 2; cy <= rows - 2; cy += 1) ring.push([cols - 2, cy]);
      for (let cx = cols - 3; cx >= 1; cx -= 1) ring.push([cx, rows - 2]);
      for (let cy = rows - 3; cy >= 2; cy -= 1) ring.push([1, cy]);
      const keep = 0.5 + density;
      let previous = '';
      for (const [cx, cy] of ring) {
        const colour = pickUnlike(palette, previous);
        if (rand() >= keep) continue;
        previous = colour;
        cell(cx, cy, colour);
      }
      break;
    }
    case 'stairs': {
      const thick = density < 0.34 ? 1 : density < 0.67 ? 2 : 3;
      const depth = RAINBOW_PALETTE.length * thick;
      for (let dy = 0; dy < depth; dy += 1) {
        for (let dx = 0; dx + dy < depth; dx += 1) {
          const colour = RAINBOW_PALETTE[Math.floor((dx + dy) / thick)];
          if (!cellBlocked(dx, dy)) cell(dx, dy, colour);
          if (!cellBlocked(cols - 1 - dx, rows - 1 - dy)) cell(cols - 1 - dx, rows - 1 - dy, colour);
        }
      }
      break;
    }
    case 'dust': {
      const top = Math.floor(rows * (1 - (0.28 + 0.4 * density)));
      for (let cy = top; cy < rows; cy += 1) {
        const fill = Math.pow((cy - top + 1) / (rows - top), 1.3);
        for (let cx = 0; cx < cols; cx += 1) {
          if ((BAYER_4[cy % 4][cx % 4] + 0.5) / 16 >= fill || cellBlocked(cx, cy)) continue;
          cell(cx, cy, gradientColour(RAINBOW_PALETTE, cols > 1 ? cx / (cols - 1) : 0));
        }
      }
      break;
    }
    case 'rain': {
      const count = Math.round(cols * (0.3 + 0.9 * density));
      for (let i = 0; i < count; i += 1) {
        const cx = Math.floor(rand() * cols);
        const length = 3 + Math.floor(rand() * 7);
        const head = Math.floor(rand() * (rows + length));
        const colour = pick(palette);
        for (let step = 0; step < length; step += 1) {
          const cy = head - step;
          if (cy < 0 || cy >= rows || cellBlocked(cx, cy)) continue;
          cell(cx, cy, mixColours(colour, base[cy][cx], step / length));
        }
      }
      break;
    }
    case 'blocks': {
      const wide = cols > 40 ? 2 : 1;
      const tallest = Math.max(2, Math.round(rows * (0.1 + 0.28 * density)));
      let previous = '';
      for (let cx = 0; cx < cols; cx += wide) {
        const tall = 1 + Math.floor(rand() * tallest);
        const colour = pickUnlike(palette, previous);
        previous = colour;
        cell(cx, rows - tall, colour, wide, tall);
      }
      break;
    }
    case 'hills': {
      const dark = backdrop.tone === 'dark';
      const shade = (colour: string) => (dark ? mixColours(colour, INK, 0.35) : colour);
      const layers = [
        { colour: shade(mixColours(baseAt(0, rows - 1), '#58ca70', 0.5)), height: 0.2 + 0.16 * density, swing: 0.06 },
        { colour: shade(GRASS), height: 0.13 + 0.1 * density, swing: 0.05 },
        { colour: shade('#58ca70'), height: 0.06 + 0.06 * density, swing: 0.035 }
      ];
      const leaves = LEAF_COLOURS.filter((colour) => colour !== GRASS && colour !== '#58ca70' && !used.has(colour));
      layers.forEach((layer, index) => {
        const phase = rand() * Math.PI * 2;
        const ripple = rand() * Math.PI * 2;
        const wave = (Math.PI * 2 * (0.8 + rand() * 0.9)) / cols;
        const crest = Array.from({ length: cols }, (_, cx) =>
          Math.max(1, Math.round(rows * (layer.height + layer.swing * Math.sin(cx * wave + phase) + layer.swing * 0.5 * Math.sin(cx * wave * 2.3 + ripple))))
        );
        for (let cx = 0; cx < cols; ) {
          let wide = 1;
          while (cx + wide < cols && crest[cx + wide] === crest[cx]) wide += 1;
          cell(cx, rows - crest[cx], layer.colour, wide, crest[cx]);
          cx += wide;
        }
        if (index !== 1) return;
        // a few trees along the middle ridge; the front hill overlaps their feet
        const taken: Array<[number, number]> = [];
        const attempts = Math.round(cols * (0.12 + 0.25 * density));
        for (let i = 0; i < attempts; i += 1) {
          const size = rand() < 0.6 ? 1 : 2;
          const wide = size * 3;
          const cx = Math.floor(rand() * Math.max(1, cols - wide + 1));
          const leaf = pick(leaves);
          if (taken.some(([from, to]) => cx < to + 1 && cx + wide > from - 1)) continue;
          taken.push([cx, cx + wide]);
          const cy = rows - crest[Math.min(cols - 1, cx + size)] - wide;
          cell(cx + size, cy, leaf, size, size);
          cell(cx, cy + size, leaf, size, size);
          cell(cx + size * 2, cy + size, leaf, size, size);
          cell(cx + size, cy + size * 2, shade(SOIL), size, size);
        }
      });
      break;
    }
    case 'forest': {
      const dark = backdrop.tone === 'dark';
      const ground = Math.max(2, Math.round(rows * 0.07));
      const horizon = rows - ground;

      // sun or moon, top right
      const disc = Math.max(3, Math.round(rows * 0.12));
      const discX = cols - disc - 3;
      const discY = 2;
      const discColour = dark ? '#f4f1de' : used.has('#ffc20e') ? WHITE : '#ffc20e';
      cell(discX + 1, discY, discColour, disc - 2, disc);
      cell(discX, discY + 1, discColour, disc, disc - 2);

      // a few clouds by day
      if (!dark) {
        const clouds = 2 + Math.floor(rand() * 2);
        for (let i = 0; i < clouds; i += 1) {
          const wide = 4 + Math.floor(rand() * 4);
          const cx = Math.floor(rand() * Math.max(1, cols - wide - disc - 5));
          const cy = 2 + Math.floor(rand() * Math.max(1, Math.round(rows * 0.2)));
          if (cellBlocked(cx, cy, wide, 2)) continue;
          const colour = baseAt(cx, cy) === WHITE ? tint(cx, cy, 0.06) : WHITE;
          cell(cx + 1, cy, colour, wide - 2, 1);
          cell(cx, cy + 1, colour, wide, 1);
        }
      }

      cell(0, horizon, dark ? mixColours(GRASS, INK, 0.3) : GRASS, cols, 1);
      cell(0, horizon + 1, dark ? mixColours(SOIL, INK, 0.3) : SOIL, cols, ground - 1);

      // trees of three sizes, never touching
      const leaves = LEAF_COLOURS.filter((colour) => !used.has(colour));
      const biggest = Math.max(1, Math.min(3, Math.floor((rows * 0.3) / 3)));
      const taken: Array<[number, number]> = [];
      const attempts = Math.round(cols * (0.25 + 0.5 * density));
      for (let i = 0; i < attempts; i += 1) {
        const roll = rand();
        const size = Math.min(biggest, roll < 0.45 ? 1 : roll < 0.8 ? 2 : 3);
        const wide = size * 3;
        const cx = Math.floor(rand() * Math.max(1, cols - wide + 1));
        const leaf = pick(leaves);
        if (taken.some(([from, to]) => cx < to + 1 && cx + wide > from - 1)) continue;
        taken.push([cx, cx + wide]);
        const cy = horizon - wide;
        cell(cx + size, cy, leaf, size, size);
        cell(cx, cy + size, leaf, size, size);
        cell(cx + size * 2, cy + size, leaf, size, size);
        cell(cx + size, cy + size * 2, dark ? mixColours(SOIL, INK, 0.15) : SOIL, size, size);
      }
      break;
    }
    default:
      break;
  }

  // The plate: a notched panel with a hard drop shadow, sticker style.
  if (plate !== 'none') {
    const fill = plate === 'light' ? WHITE : INK;
    const shadow = mixColours(baseAt(Math.floor(cols / 2), Math.floor(rows / 2)), '#000000', 0.38);
    const notch = Math.max(1, Math.round(pad * 0.4));
    const drop = Math.max(1, Math.round(pad * 0.4));
    const wide = box.x1 - box.x0;
    const tall = box.y1 - box.y0;
    const slab = (dx: number, dy: number, colour: string) => {
      push(box.x0 + notch + dx, box.y0 + dy, wide - notch * 2, tall, colour);
      push(box.x0 + dx, box.y0 + notch + dy, wide, tall - notch * 2, colour);
    };
    slab(drop, drop, shadow);
    slab(0, 0, fill);
  }

  // The logo, one rectangle per same-colour run.
  pixels.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const colour = row[x];
      let run = 1;
      while (x + run < row.length && row[x + run] === colour) run += 1;
      if (colour) push(logoX + x * u, logoY + y * u, run * u, u, colour);
      x += run;
    }
  });

  return { width: w, height: h, rects, cell: g, logoBox: { x: logoX, y: logoY, width: logoWidth, height: logoHeight }, options };
};

// ---------------------------------------------------------------------------
// Targets

/** The scene as a standalone SVG — scales to any size without blurring. */
export const sceneToSvg = (scene: BrandScene): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" ` +
  `viewBox="0 0 ${scene.width} ${scene.height}" shape-rendering="crispEdges">` +
  scene.rects.map(([x, y, w, h, colour]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${colour}"/>`).join('') +
  '</svg>';

/** The slice of CanvasRenderingContext2D a scene needs. */
export type ScenePainter = { fillStyle: string | CanvasGradient | CanvasPattern; fillRect: (x: number, y: number, w: number, h: number) => void };

/**
 * Paint onto a 2D context, optionally scaled down for a preview. Edges are
 * rounded to whole device pixels, so neighbours that share an edge in the
 * scene still share it after scaling — no seams, no overlaps.
 */
export const paintScene = (scene: BrandScene, context: ScenePainter, scale = 1) => {
  for (const [x, y, w, h, colour] of scene.rects) {
    const x0 = Math.round(x * scale);
    const y0 = Math.round(y * scale);
    const x1 = Math.round((x + w) * scale);
    const y1 = Math.round((y + h) * scale);
    if (x1 <= x0 || y1 <= y0) continue;
    context.fillStyle = colour;
    context.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
};

/** What a cut is called in a picture's name: the icon is "the tree" to everyone who meets it. */
export const sceneLogoName = (logo: string): string => (brandLogoVariant(logo)?.name ?? 'Logo').replace(/^Icon\b/, 'Tree');

/** Words for a scene: "Square · Dark · Confetti". */
export const describeScene = (options: Pick<BrandSceneOptions, 'logo' | 'backdrop' | 'pattern'>): string =>
  [sceneLogoName(options.logo), brandBackdrop(options.backdrop).label, options.pattern === 'none' ? null : brandPattern(options.pattern).label]
    .filter(Boolean)
    .join(' · ');

/** Filename stem shared by the committed files and studio downloads. */
export const sceneSlug = (options: Pick<BrandSceneOptions, 'logo' | 'backdrop' | 'pattern'>): string =>
  [options.logo, options.backdrop, options.pattern === 'none' ? 'clean' : options.pattern].join('-');
