// Registry of every logo cut the /branding page ships: the three lock-ups
// (wordmark, square, icon), their hotpink cuts, and the fun variations.
//
// One list drives the page sections, the committed file generator
// (scripts/generate-branding-assets.mjs — node strips the types on import,
// hence the explicit `.ts` specifiers and erasable-only syntax) and the tests,
// so a cut can never exist in one place and be missing from another.
//
// Every cut is plain voxel data: a matrix plus a colour map, exactly what
// buildLogoSvg / the DOM <Logo> already render. The fun cuts are derived from
// the canonical matrices by small pure transforms, so they follow any future
// change to the source artwork.

import {
  LOGO_FULL_MATRIX,
  LOGO_ICON_MATRIX,
  LOGO_SQUARE_MATRIX,
  LOGO_SQUARE_SIZE,
  LOGO_STACKED_MATRIX,
  LOGO_THEMES,
  buildLogoSvg,
  logoMatrixToCells,
  resolveLogoColour,
  trimLogoCells
} from './logoMatrix.ts';
import type { LogoColourMap, LogoMatrix } from './logoMatrix.ts';
import { RAINBOW_PALETTE } from '../../theme/tokens.ts';

// ---------------------------------------------------------------------------
// Colour helpers (hex in, hex out — the generator only parses hex)

const NAMED_COLOURS: Record<string, string> = { hotpink: '#ff69b4', white: '#ffffff', black: '#000000' };

const toRgb = (colour: string): [number, number, number] => {
  let hex = (NAMED_COLOURS[colour] ?? colour).replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

const toHex = (rgb: number[]): string => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export const mixColours = (from: string, to: string, amount: number): string => {
  const a = toRgb(from);
  const b = toRgb(to);
  return toHex(a.map((value, i) => value + (b[i] - value) * amount));
};

/** Evenly spaced stops; `t` runs 0 → 1. */
export const gradientColour = (stops: readonly string[], t: number): string => {
  const clamped = Math.min(1, Math.max(0, t));
  const segment = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(segment));
  return mixColours(stops[index], stops[index + 1], segment - index);
};

/** Deterministic PRNG (mulberry32) — the generated files must be byte-stable. */
export const seededRandom = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------
// Pixel grids: resolved colours (null = empty), the working form for transforms

export type LogoPixels = Array<Array<string | null>>;

export const logoPixels = (matrix: LogoMatrix, colourMap: LogoColourMap, trim = true): LogoPixels => {
  const cells = logoMatrixToCells(matrix);
  const used = trim ? trimLogoCells(cells, colourMap) : cells;
  const width = Math.max(0, ...used.map((row) => row.length));
  return used.map((row) => Array.from({ length: width }, (_, x) => resolveLogoColour(row[x] ?? '0', colourMap) ?? null));
};

/** Back to the matrix + colour-map form every renderer takes (colour = key). */
export const pixelsToLogo = (pixels: LogoPixels): { matrix: LogoMatrix; colourMap: LogoColourMap } => {
  const colourMap: LogoColourMap = { 0: 'transparent' };
  const matrix = pixels.map((row) =>
    row.map((colour) => {
      if (!colour) return '0';
      colourMap[colour] = colour;
      return colour;
    })
  );
  return { matrix, colourMap };
};

const blankPixels = (width: number, height: number): LogoPixels =>
  Array.from({ length: height }, () => Array.from({ length: width }, () => null));

const widthOf = (pixels: LogoPixels) => Math.max(0, ...pixels.map((row) => row.length));

/** Every voxel becomes an n×n block of sub-cells. */
export const scalePixels = (pixels: LogoPixels, n: number): LogoPixels =>
  pixels.flatMap((row) => {
    const wide = row.flatMap((colour) => Array.from({ length: n }, () => colour));
    return Array.from({ length: n }, () => [...wide]);
  });

/** Centre on a larger empty canvas (odd leftovers go right / bottom). */
export const framePixels = (pixels: LogoPixels, columns: number, rows: number): LogoPixels => {
  const left = Math.max(0, Math.floor((columns - widthOf(pixels)) / 2));
  const top = Math.max(0, Math.floor((rows - pixels.length) / 2));
  const out = blankPixels(Math.max(columns, widthOf(pixels)), Math.max(rows, pixels.length));
  pixels.forEach((row, y) => row.forEach((colour, x) => (out[y + top][x + left] = colour)));
  return out;
};

// ---------------------------------------------------------------------------
// Fun transforms

/** Left-to-right dip through a gradient. */
export const sweepColumns = (pixels: LogoPixels, stops: readonly string[]): LogoPixels => {
  const width = widthOf(pixels);
  return pixels.map((row) => row.map((colour, x) => (colour ? gradientColour(stops, width > 1 ? x / (width - 1) : 0) : null)));
};

/** Top-to-bottom fade through a gradient. */
export const sweepRows = (pixels: LogoPixels, stops: readonly string[]): LogoPixels => {
  const height = pixels.length;
  return pixels.map((row, y) => row.map((colour) => (colour ? gradientColour(stops, height > 1 ? y / (height - 1) : 0) : null)));
};

/** Hollow voxels: keep only the one-sub-cell edge of each same-colour shape. */
export const outlinePixels = (pixels: LogoPixels, unit: number): LogoPixels => {
  const big = scalePixels(pixels, unit);
  return big.map((row, y) =>
    row.map((colour, x) => {
      if (!colour) return null;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dy || dx) && (big[y + dy]?.[x + dx] ?? null) !== colour) return colour;
        }
      }
      return null;
    })
  );
};

/** Chunky 3D: a hard diagonal extrusion in a deeper shade of each voxel. */
export const extrudePixels = (pixels: LogoPixels, unit: number, depth: number, shadeTowards: string): LogoPixels => {
  const big = scalePixels(pixels, unit);
  const out = blankPixels(widthOf(big) + depth, big.length + depth);
  for (let d = depth; d >= 1; d -= 1) {
    big.forEach((row, y) =>
      row.forEach((colour, x) => {
        if (colour) out[y + d][x + d] = mixColours(colour, shadeTowards, 0.45);
      })
    );
  }
  big.forEach((row, y) =>
    row.forEach((colour, x) => {
      if (colour) out[y][x] = colour;
    })
  );
  return out;
};

/**
 * Split colour channels plus slipped scanline bands. `bands` are
 * [firstSubRow, lastSubRow, shift] slices — keep them inside a voxel row so
 * the lettering is cut cleanly rather than stair-stepped.
 */
export const glitchPixels = (pixels: LogoPixels, unit: number, bands: ReadonlyArray<readonly [number, number, number]>): LogoPixels => {
  const big = scalePixels(pixels, unit);
  const height = big.length;
  const margin = 1 + Math.max(0, ...bands.map(([, , shift]) => Math.abs(shift)));
  const out = blankPixels(widthOf(big) + margin * 2, height);
  const slip = (y: number) => bands.find(([first, last]) => y >= first && y <= last)?.[2] ?? 0;
  const layers: Array<[number, string | null]> = [
    [-1, '#00e5ff'],
    [1, '#ff3df0'],
    [0, null]
  ];
  for (const [dx, tint] of layers) {
    big.forEach((row, y) =>
      row.forEach((colour, x) => {
        if (colour) out[y][x + margin + slip(y) + dx] = tint ?? colour;
      })
    );
  }
  return out;
};

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

/** Solid on the left, ordered-dither dust on the right. */
export const dissolvePixels = (pixels: LogoPixels, unit: number, solidUntil = 0.35, floor = 0.28): LogoPixels => {
  const big = scalePixels(pixels, unit);
  const width = widthOf(big);
  return big.map((row, y) =>
    row.map((colour, x) => {
      if (!colour) return null;
      const t = width > 1 ? x / (width - 1) : 0;
      const density = t <= solidUntil ? 1 : 1 - (1 - floor) * ((t - solidUntil) / (1 - solidUntil));
      return (BAYER_4[y % 4][x % 4] + 0.5) / 16 < density ? colour : null;
    })
  );
};

/** Each glyph (a fixed-width column group) rides a vertical wave. */
export const bouncePixels = (pixels: LogoPixels, glyphWidth: number, offsets: readonly number[]): LogoPixels => {
  const lift = Math.max(...offsets);
  const out = blankPixels(widthOf(pixels), pixels.length + lift);
  pixels.forEach((row, y) =>
    row.forEach((colour, x) => {
      if (colour) out[y + offsets[Math.floor(x / glyphWidth) % offsets.length]][x] = colour;
    })
  );
  return out;
};

export const CONFETTI_PALETTE = ['#59ff9c', '#59bdff', '#00b7ef', '#ed1c24', '#ffa3b1', '#6f3198', '#a8e61d', '#ffc20e', '#ff7e00', '#ff69b4'];

/**
 * Party cut: every voxel takes a random confetti colour (never matching the
 * voxel to its left or above), framed in a square with loose sprinkles kept
 * clear of the lettering.
 */
export const confettiPixels = (pixels: LogoPixels, unit: number, frame: number, seed: number): LogoPixels => {
  const rand = seededRandom(seed);
  const pick = (avoid: Array<string | null>) => {
    const options = CONFETTI_PALETTE.filter((colour) => !avoid.includes(colour));
    return options[Math.floor(rand() * options.length)];
  };
  const recoloured: LogoPixels = [];
  pixels.forEach((row, y) => {
    recoloured.push(row.map(() => null));
    row.forEach((colour, x) => {
      if (colour) recoloured[y][x] = pick([recoloured[y][x - 1] ?? null, recoloured[y - 1]?.[x] ?? null]);
    });
  });

  const size = frame * unit;
  const art = scalePixels(recoloured, unit);
  const out = framePixels(art, size, size);
  const left = Math.floor((size - widthOf(art)) / 2);
  const top = Math.floor((size - art.length) / 2);
  const clear = unit * 2;
  const box = { x0: left - clear, y0: top - clear, x1: left + widthOf(art) + clear, y1: top + art.length + clear };
  for (let i = 0; i < 90; i += 1) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const colour = CONFETTI_PALETTE[Math.floor(rand() * CONFETTI_PALETTE.length)];
    if (x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) continue;
    let crowded = false;
    for (let dy = -1; dy <= 1 && !crowded; dy += 1) {
      for (let dx = -1; dx <= 1 && !crowded; dx += 1) crowded = Boolean(out[y + dy]?.[x + dx]);
    }
    if (!crowded) out[y][x] = colour;
  }
  return out;
};

// ---------------------------------------------------------------------------
// The registry

export type BrandLogoGroup = 'core' | 'pink' | 'fun';

export type BrandLogoVariant = {
  /** Folder + filename stem under /branding/generated, and the section anchor. */
  slug: string;
  /** Short label for manifests, sitemap titles and the tt.assets tree. */
  name: string;
  group: BrandLogoGroup;
  title: string;
  description: string;
  /** Descriptive alt text for image search. */
  alt: string;
  matrix: LogoMatrix;
  colourMap: LogoColourMap;
  /** false = the transparent frame is part of the mark (the square lock-ups). */
  trim: boolean;
  /** Sub-cells per voxel: the fine-grained cuts draw smaller than one voxel. */
  unit: number;
};

const INK = '#16161a';
const SUNSET_STOPS = ['#6f3198', '#ff69b4', '#ff7e00', '#ffc20e'];

const wordmark = logoPixels(LOGO_FULL_MATRIX, LOGO_THEMES.default);
const stacked = logoPixels(LOGO_STACKED_MATRIX, LOGO_THEMES.default);

const fun = (pixels: LogoPixels) => pixelsToLogo(pixels);

export const BRAND_LOGO_VARIANTS: BrandLogoVariant[] = [
  {
    slug: 'logo',
    name: 'Wordmark',
    group: 'core',
    title: 'The wordmark',
    description:
      'Nine voxel glyphs spelling Thingtime — the full lock-up for headers, docs, decks and anywhere the brand introduces itself. It ships trimmed to the pixel: no baked-in whitespace, ever.',
    alt: 'Thingtime logo — the full-colour voxel wordmark spelling Thingtime',
    matrix: LOGO_FULL_MATRIX,
    colourMap: LOGO_THEMES.default,
    trim: true,
    unit: 1
  },
  {
    slug: 'logo-square',
    name: 'Square',
    group: 'core',
    title: 'The square',
    description:
      'Thing over time — the wordmark stacked on two lines and centred in a perfect square. Made for avatars, app icons, stickers and anywhere a wide logo won’t fit.',
    alt: 'Thingtime logo — the square two-line voxel wordmark with Thing stacked over time',
    matrix: LOGO_SQUARE_MATRIX,
    colourMap: LOGO_THEMES.default,
    trim: false,
    unit: 1
  },
  {
    slug: 'icon',
    name: 'Icon',
    group: 'core',
    title: 'The tree',
    description:
      'Thingtime distilled to five voxels — a leafy little tree. Reach for it when space is tight: avatars, favicons, app grids, pixel jewellery.',
    alt: 'Thingtime icon — the five-voxel tree logo mark',
    matrix: LOGO_ICON_MATRIX,
    colourMap: LOGO_THEMES.default,
    trim: true,
    unit: 1
  },
  {
    slug: 'logo-pink',
    name: 'Wordmark · Pink',
    group: 'pink',
    title: 'Wordmark in hotpink',
    description:
      'The single-colour cut for stickers, stamps, embroidery and moments that call for maximum 🩷. Same voxels, one colour.',
    alt: 'Thingtime logo — single-colour hotpink voxel wordmark',
    matrix: LOGO_FULL_MATRIX,
    colourMap: LOGO_THEMES.pink,
    trim: true,
    unit: 1
  },
  {
    slug: 'logo-square-pink',
    name: 'Square · Pink',
    group: 'pink',
    title: 'The square in hotpink',
    description: 'The two-line square in one colour — profile pictures, rubber stamps and single-ink merch.',
    alt: 'Thingtime logo — single-colour hotpink square two-line voxel wordmark',
    matrix: LOGO_SQUARE_MATRIX,
    colourMap: LOGO_THEMES.pink,
    trim: false,
    unit: 1
  },
  {
    slug: 'icon-pink',
    name: 'Icon · Pink',
    group: 'pink',
    title: 'The tree in hotpink',
    description: 'The five-voxel tree in one colour — engraving, laser cutting, single-ink print, tiny UI moments.',
    alt: 'Thingtime icon — single-colour hotpink voxel tree logo mark',
    matrix: LOGO_ICON_MATRIX,
    colourMap: LOGO_THEMES.pink,
    trim: true,
    unit: 1
  },
  {
    slug: 'logo-rainbow',
    name: 'Rainbow sweep',
    group: 'fun',
    title: 'Rainbow sweep',
    description: 'The wordmark dipped left to right through the five-stop Thingtime rainbow.',
    alt: 'Thingtime logo — voxel wordmark in a left-to-right rainbow gradient',
    ...fun(sweepColumns(wordmark, RAINBOW_PALETTE)),
    trim: true,
    unit: 1
  },
  {
    slug: 'logo-square-sunset',
    name: 'Sunset square',
    group: 'fun',
    title: 'Sunset square',
    description: 'The square stack fading from dusk purple through hotpink to golden hour.',
    alt: 'Thingtime logo — square two-line voxel wordmark in a purple-to-gold sunset gradient',
    ...fun(framePixels(sweepRows(stacked, SUNSET_STOPS), LOGO_SQUARE_SIZE, LOGO_SQUARE_SIZE)),
    trim: false,
    unit: 1
  },
  {
    slug: 'logo-outline',
    name: 'Outline',
    group: 'fun',
    title: 'Outline',
    description: 'Hollow voxels — just the edges, for line work, pen plotters and colouring in.',
    alt: 'Thingtime logo — voxel wordmark drawn as coloured outlines',
    ...fun(outlinePixels(wordmark, 4)),
    trim: true,
    unit: 4
  },
  {
    slug: 'logo-square-arcade',
    name: 'Arcade square',
    group: 'fun',
    title: 'Arcade square',
    description: 'Chunky 3D extrusion, straight off a cabinet marquee.',
    alt: 'Thingtime logo — square two-line voxel wordmark with a chunky 3D arcade extrusion',
    ...fun(framePixels(extrudePixels(stacked, 2, 1, INK), LOGO_SQUARE_SIZE * 2, LOGO_SQUARE_SIZE * 2)),
    trim: false,
    unit: 2
  },
  {
    slug: 'logo-glitch',
    name: 'Glitch',
    group: 'fun',
    title: 'Glitch',
    description: 'Split channels and slipped scanlines. Do not adjust your set.',
    alt: 'Thingtime logo — glitched voxel wordmark with cyan and magenta channel split',
    // two slices through the body of the lettering, one nudge in the descender
    ...fun(
      glitchPixels(wordmark, 4, [
        [5, 6, 2],
        [10, 10, -2],
        [17, 17, 1]
      ])
    ),
    trim: true,
    unit: 4
  },
  {
    slug: 'logo-square-confetti',
    name: 'Confetti square',
    group: 'fun',
    title: 'Confetti square',
    description: 'Every voxel grabs a random party colour, then the sprinkles arrive.',
    alt: 'Thingtime logo — square two-line voxel wordmark in random confetti colours with sprinkles',
    ...fun(confettiPixels(stacked, 2, LOGO_SQUARE_SIZE, 20261115)),
    trim: false,
    unit: 2
  },
  {
    slug: 'logo-dissolve',
    name: 'Pixel dust',
    group: 'fun',
    title: 'Pixel dust',
    description: 'Thing stays solid while time drifts away into dither.',
    alt: 'Thingtime logo — voxel wordmark dissolving into dithered pixels',
    ...fun(dissolvePixels(wordmark, 4)),
    trim: true,
    unit: 4
  },
  {
    slug: 'logo-bounce',
    name: 'Bounce',
    group: 'fun',
    title: 'Bounce',
    description: 'The glyphs ride a wave — for when the brand is in a very good mood.',
    alt: 'Thingtime logo — voxel wordmark with glyphs bouncing along a wave',
    ...fun(bouncePixels(wordmark, 3, [0, 1, 2, 1, 0, 1, 2, 1, 0])),
    trim: true,
    unit: 1
  },
  {
    slug: 'icon-seasons',
    name: 'Four seasons',
    group: 'fun',
    title: 'Four seasons',
    description: 'One tree, four moods: blossom, summer, autumn and frost.',
    alt: 'Thingtime icon — four voxel trees in blossom pink, summer green, autumn orange and frost blue',
    matrix: ['0a000b000c000d0', 'a0a0b0b0c0c0d0d', '0t000t000t000t0'],
    colourMap: { 0: 'transparent', a: '#ffa3b1', b: '#a8e61d', c: '#ff7e00', d: '#59bdff', t: '#9c5a3c' },
    trim: true,
    unit: 1
  },
  {
    slug: 'monogram',
    name: 'Monogram',
    group: 'fun',
    title: 'The tt monogram',
    description: 'The T and the tree, side by side — the shortest way to say Thingtime.',
    alt: 'Thingtime monogram — the voxel T beside the voxel tree',
    matrix: ['1110070', '0100707', '0100080'],
    colourMap: LOGO_THEMES.default,
    trim: true,
    unit: 1
  }
];

export const brandLogoVariant = (slug: string): BrandLogoVariant | undefined =>
  BRAND_LOGO_VARIANTS.find((variant) => variant.slug === slug);

// ---------------------------------------------------------------------------
// Background surfaces: every cut ships transparent, on light and on dark

export type BrandSurfaceKey = 'transparent' | 'light' | 'dark';

export const BRAND_SURFACES: Array<{ key: BrandSurfaceKey; label: string; colour?: string }> = [
  { key: 'transparent', label: 'Transparent' },
  { key: 'light', label: 'Light', colour: '#ffffff' },
  { key: 'dark', label: 'Dark', colour: INK }
];

export const brandSurfaceColour = (surface: BrandSurfaceKey): string | undefined =>
  BRAND_SURFACES.find((entry) => entry.key === surface)?.colour;

/** Breathing room a solid background adds around a trimmed cut, in voxels. */
export const BRAND_BACKDROP_VOXELS = 2;

/** …and in that cut's own cell units. Framed squares already carry their room. */
export const backdropPadding = (variant: Pick<BrandLogoVariant, 'trim' | 'unit'>, surface: BrandSurfaceKey): number =>
  surface === 'transparent' || !variant.trim ? 0 : variant.unit * BRAND_BACKDROP_VOXELS;

/** The exact SVG a ready-made file contains (and the preview draws). */
export const buildVariantSvg = (variant: BrandLogoVariant, surface: BrandSurfaceKey = 'transparent', pixelWidth?: number) => {
  const pad = backdropPadding(variant, surface);
  return buildLogoSvg({
    matrix: variant.matrix,
    colourMap: variant.colourMap,
    trim: variant.trim,
    mergeRuns: variant.unit > 1,
    background: brandSurfaceColour(surface),
    padding: { top: pad, right: pad, bottom: pad, left: pad },
    pixelWidth
  });
};

// File naming — shared by the generator (writes) and the page (links).
const baseName = (slug: string, surface: BrandSurfaceKey) => (surface === 'transparent' ? `thingtime-${slug}` : `thingtime-${slug}-${surface}`);

export const brandSvgUrl = (slug: string, surface: BrandSurfaceKey = 'transparent') =>
  `/branding/generated/${slug}/${baseName(slug, surface)}.svg`;

export const brandPngUrl = (slug: string, surface: BrandSurfaceKey, width: number, height: number) =>
  `/branding/generated/${slug}/${baseName(slug, surface)}-${width}x${height}.png`;
