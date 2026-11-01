#!/usr/bin/env node
// Deterministic branding asset generator for the /branding page.
//
// Renders the shared voxel matrices (app/components/Branding/logoMatrix.ts —
// node 24 strips the types on import) into committed static files under
// remix/public/branding/, so every logo variant exists as real PNG/SVG URLs
// that Google Images can index and people can grab without the exporter:
//   generated/<variant>/thingtime-<variant>-<w>x<h>.png  (+ one scalable .svg)
//   presskit/thingtime-<name>-<w>x<h>.png                (marketing suite)
// plus a manifest the page reads: app/components/Branding/brandingAssets.generated.json
//
// Zero native deps: pixels are composed in raw RGBA buffers and encoded as PNG
// through node's zlib. Output is byte-stable run to run (no timestamps, seeded
// PRNG) so re-running produces no git churn.

import { deflateSync } from 'node:zlib';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOGO_FULL_MATRIX,
  LOGO_ICON_MATRIX,
  LOGO_THEMES,
  buildLogoSvg,
  logoMatrixToCells,
  resolveLogoColour,
  trimLogoCells
} from '../app/components/Branding/logoMatrix.ts';
import { RAINBOW_PALETTE } from '../app/theme/tokens.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_BRANDING = path.join(HERE, '..', 'public', 'branding');
const GENERATED_DIR = path.join(PUBLIC_BRANDING, 'generated');
const PRESSKIT_DIR = path.join(PUBLIC_BRANDING, 'presskit');
const MANIFEST_PATH = path.join(HERE, '..', 'app', 'components', 'Branding', 'brandingAssets.generated.json');

// The requested ready-made ladder: 10px thumbnails up to 10k wall prints.
const SIZES = [10, 16, 32, 50, 64, 100, 128, 200, 256, 500, 512, 1000, 1024, 2000, 2048, 4096, 5000, 8192, 10000];

const INK = '#16161a';

const VARIANTS = [
  {
    slug: 'logo',
    name: 'Wordmark',
    matrix: LOGO_FULL_MATRIX,
    colourMap: LOGO_THEMES.default
  },
  {
    slug: 'icon',
    name: 'Icon',
    matrix: LOGO_ICON_MATRIX,
    colourMap: LOGO_THEMES.default
  },
  {
    slug: 'logo-pink',
    name: 'Wordmark · Pink',
    matrix: LOGO_FULL_MATRIX,
    colourMap: LOGO_THEMES.pink
  },
  {
    slug: 'icon-pink',
    name: 'Icon · Pink',
    matrix: LOGO_ICON_MATRIX,
    colourMap: LOGO_THEMES.pink
  }
];

// ---------------------------------------------------------------------------
// Colours

const NAMED_COLOURS = { hotpink: '#ff69b4', white: '#ffffff', black: '#000000' };

const parseColour = (value) => {
  if (!value || value === 'transparent') return [0, 0, 0, 0];
  let hex = NAMED_COLOURS[value] ?? value;
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255];
};

const mix = (a, b, t) => a.map((av, i) => Math.round(av + (b[i] - av) * t));
const pastel = (rgba, amount = 0.62) => {
  const soft = mix(rgba, [255, 255, 255, 255], amount);
  soft[3] = 255;
  return soft;
};

// ---------------------------------------------------------------------------
// PNG encoding (8-bit RGBA, adaptive None/Sub/Up filters, zlib level 9)

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

const crc32 = (...buffers) => {
  let c = 0xffffffff;
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeBuf, data), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
};

const encodePng = (width, height, rgba) => {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const filtered = { none: Buffer.alloc(stride), sub: Buffer.alloc(stride), up: Buffer.alloc(stride) };
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    let sums = { none: 0, sub: 0, up: 0 };
    for (let i = 0; i < stride; i += 1) {
      const cur = rgba[rowStart + i];
      const left = i >= 4 ? rgba[rowStart + i - 4] : 0;
      const above = y > 0 ? rgba[rowStart - stride + i] : 0;
      const none = cur;
      const sub = (cur - left) & 0xff;
      const up = (cur - above) & 0xff;
      filtered.none[i] = none;
      filtered.sub[i] = sub;
      filtered.up[i] = up;
      sums.none += none < 128 ? none : 256 - none;
      sums.sub += sub < 128 ? sub : 256 - sub;
      sums.up += up < 128 ? up : 256 - up;
    }
    const pick = sums.up <= sums.sub && sums.up <= sums.none ? 'up' : sums.sub <= sums.none ? 'sub' : 'none';
    raw[y * (stride + 1)] = pick === 'none' ? 0 : pick === 'sub' ? 1 : 2;
    filtered[pick].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
};

// ---------------------------------------------------------------------------
// Raw RGBA canvas helpers

const makeCanvas = (w, h) => ({ w, h, data: Buffer.alloc(w * h * 4) });

const fillRect = (canvas, x0, y0, w, h, rgba) => {
  const [r, g, b, a] = rgba;
  const xEnd = Math.min(canvas.w, Math.round(x0 + w));
  const yEnd = Math.min(canvas.h, Math.round(y0 + h));
  for (let y = Math.max(0, Math.round(y0)); y < yEnd; y += 1) {
    let idx = (y * canvas.w + Math.max(0, Math.round(x0))) * 4;
    for (let x = Math.max(0, Math.round(x0)); x < xEnd; x += 1) {
      canvas.data[idx] = r;
      canvas.data[idx + 1] = g;
      canvas.data[idx + 2] = b;
      canvas.data[idx + 3] = a;
      idx += 4;
    }
  }
};

// CSS-ish linear gradient across a region: stops evenly spaced, angle in deg.
const fillLinearGradient = (canvas, x0, y0, w, h, stops, angleDeg = 90) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const span = (Math.abs(w * dx) + Math.abs(h * dy)) / 2 || 1;
  const xEnd = Math.min(canvas.w, Math.round(x0 + w));
  const yEnd = Math.min(canvas.h, Math.round(y0 + h));
  for (let y = Math.max(0, Math.round(y0)); y < yEnd; y += 1) {
    for (let x = Math.max(0, Math.round(x0)); x < xEnd; x += 1) {
      let t = (((x - cx) * dx + (y - cy) * dy) / span + 1) / 2;
      t = Math.min(1, Math.max(0, t));
      const seg = t * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(seg));
      const rgba = mix(stops[i], stops[i + 1], seg - i);
      const idx = (y * canvas.w + x) * 4;
      canvas.data[idx] = rgba[0];
      canvas.data[idx + 1] = rgba[1];
      canvas.data[idx + 2] = rgba[2];
      canvas.data[idx + 3] = 255;
    }
  }
};

// Source-over blit of one canvas onto another.
const blit = (dest, src, atX, atY) => {
  for (let y = 0; y < src.h; y += 1) {
    const dy = atY + y;
    if (dy < 0 || dy >= dest.h) continue;
    for (let x = 0; x < src.w; x += 1) {
      const dx = atX + x;
      if (dx < 0 || dx >= dest.w) continue;
      const si = (y * src.w + x) * 4;
      const sa = src.data[si + 3] / 255;
      if (sa === 0) continue;
      const di = (dy * dest.w + dx) * 4;
      const da = dest.data[di + 3] / 255;
      const outA = sa + da * (1 - sa);
      for (let c = 0; c < 3; c += 1) {
        dest.data[di + c] = Math.round((src.data[si + c] * sa + dest.data[di + c] * da * (1 - sa)) / (outA || 1));
      }
      dest.data[di + 3] = Math.round(outA * 255);
    }
  }
};

// ---------------------------------------------------------------------------
// Voxel matrix → RGBA at an arbitrary size (coverage-weighted box sampling, so
// integer scales stay perfectly crisp and fractional/downscales antialias the
// voxel edges exactly like a browser would).

const cellColours = (cells, colourMap) =>
  cells.map((row) => row.map((col) => parseColour(resolveLogoColour(col, colourMap) ?? 'transparent')));

// For each output index along one axis: which cells it overlaps and by how much.
const coverageMap = (outSize, cellCount) => {
  const map = [];
  const scale = cellCount / outSize;
  for (let i = 0; i < outSize; i += 1) {
    const start = i * scale;
    const end = (i + 1) * scale;
    const spans = [];
    for (let cell = Math.floor(start); cell < Math.min(cellCount, Math.ceil(end)); cell += 1) {
      const overlap = Math.min(end, cell + 1) - Math.max(start, cell);
      if (overlap > 1e-9) spans.push([cell, overlap / (end - start)]);
    }
    map.push(spans);
  }
  return map;
};

const renderCells = (cells, colourMap, outW, outH) => {
  const colours = cellColours(cells, colourMap);
  const rows = cells.length;
  const cols = Math.max(0, ...cells.map((row) => row.length));
  const xMap = coverageMap(outW, cols);
  const yMap = coverageMap(outH, rows);
  const canvas = makeCanvas(outW, outH);
  for (let y = 0; y < outH; y += 1) {
    const ySpans = yMap[y];
    for (let x = 0; x < outW; x += 1) {
      const xSpans = xMap[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [cy, wy] of ySpans) {
        const colourRow = colours[cy];
        for (const [cx, wx] of xSpans) {
          const c = colourRow[cx];
          if (!c || c[3] === 0) continue;
          const weight = wy * wx * (c[3] / 255);
          r += c[0] * weight;
          g += c[1] * weight;
          b += c[2] * weight;
          a += weight;
        }
      }
      const idx = (y * outW + x) * 4;
      if (a > 0) {
        canvas.data[idx] = Math.round(r / a);
        canvas.data[idx + 1] = Math.round(g / a);
        canvas.data[idx + 2] = Math.round(b / a);
        canvas.data[idx + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
  }
  return canvas;
};

// ---------------------------------------------------------------------------
// Press-kit composition helpers

const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Extended accent dots from docs/design/DESIGN_LANGUAGE.md (the confetti set).
const CONFETTI_COLOURS = ['#59ff9c', '#59bdff', '#00b7ef', '#ed1c24', '#ffa3b1', '#6f3198', '#a8e61d', '#ffc20e', '#ff7e00', '#ff69b4'].map(parseColour);

const RAINBOW_STOPS = RAINBOW_PALETTE.map(parseColour);

const scatterConfetti = (canvas, { seed, count, minSize, maxSize, avoid }) => {
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i += 1) {
    const size = Math.round(minSize + rand() * (maxSize - minSize));
    const x = Math.round(rand() * (canvas.w - size));
    const y = Math.round(rand() * (canvas.h - size));
    if (avoid && x + size > avoid.x0 && x < avoid.x1 && y + size > avoid.y0 && y < avoid.y1) continue;
    const colour = CONFETTI_COLOURS[Math.floor(rand() * CONFETTI_COLOURS.length)];
    fillRect(canvas, x, y, size, size, colour);
  }
};

const placeLogo = (canvas, cells, colourMap, widthFraction, { offsetY = 0 } = {}) => {
  const rows = cells.length;
  const cols = Math.max(0, ...cells.map((row) => row.length));
  const w = Math.round(canvas.w * widthFraction);
  const h = Math.max(1, Math.round((w / cols) * rows));
  const x = Math.round((canvas.w - w) / 2);
  const y = Math.round((canvas.h - h) / 2 + offsetY);
  blit(canvas, renderCells(cells, colourMap, w, h), x, y);
  return { x0: x, y0: y, x1: x + w, y1: y + h };
};

const rainbowBar = (canvas, height) => {
  fillLinearGradient(canvas, 0, canvas.h - height, canvas.w, height, RAINBOW_STOPS, 90);
};

// ---------------------------------------------------------------------------
// Build

const wordmarkCells = trimLogoCells(logoMatrixToCells(LOGO_FULL_MATRIX), LOGO_THEMES.default);
const iconCells = trimLogoCells(logoMatrixToCells(LOGO_ICON_MATRIX), LOGO_THEMES.default);

rmSync(GENERATED_DIR, { recursive: true, force: true });
rmSync(PRESSKIT_DIR, { recursive: true, force: true });
mkdirSync(GENERATED_DIR, { recursive: true });
mkdirSync(PRESSKIT_DIR, { recursive: true });

const manifest = { sizes: SIZES, variants: [], presskit: [] };

for (const variant of VARIANTS) {
  const cells = trimLogoCells(logoMatrixToCells(variant.matrix), variant.colourMap);
  const rows = cells.length;
  const cols = Math.max(0, ...cells.map((row) => row.length));
  const dir = path.join(GENERATED_DIR, variant.slug);
  mkdirSync(dir, { recursive: true });

  const { svg } = buildLogoSvg({ matrix: variant.matrix, colourMap: variant.colourMap, pixelWidth: 1024 });
  const svgName = `thingtime-${variant.slug}.svg`;
  writeFileSync(path.join(dir, svgName), svg);

  const entry = {
    slug: variant.slug,
    name: variant.name,
    aspect: { cols, rows },
    svg: { url: `/branding/generated/${variant.slug}/${svgName}`, bytes: Buffer.byteLength(svg) },
    pngs: []
  };

  for (const size of SIZES) {
    const w = size;
    const h = cols === rows ? size : Math.max(1, Math.round((size / cols) * rows));
    const png = encodePng(w, h, renderCells(cells, variant.colourMap, w, h).data);
    const fileName = `thingtime-${variant.slug}-${w}x${h}.png`;
    writeFileSync(path.join(dir, fileName), png);
    entry.pngs.push({ w, h, url: `/branding/generated/${variant.slug}/${fileName}`, bytes: png.length });
    console.log(`generated ${variant.slug} ${w}x${h} (${png.length} bytes)`);
  }

  manifest.variants.push(entry);
}

const WHITE = parseColour('#ffffff');
const INK_RGBA = parseColour(INK);
const PASTEL_STOPS = RAINBOW_STOPS.map((stop) => pastel(stop));

const pressKit = [
  {
    slug: 'og-card',
    name: 'Open Graph card',
    description: 'Link-preview card — wordmark on white with the Thingtime rainbow.',
    w: 1200,
    h: 630,
    surface: 'light',
    draw: (canvas) => {
      fillRect(canvas, 0, 0, canvas.w, canvas.h, WHITE);
      placeLogo(canvas, wordmarkCells, LOGO_THEMES.default, 0.58, { offsetY: -12 });
      rainbowBar(canvas, 14);
    }
  },
  {
    slug: 'og-card-dark',
    name: 'Open Graph card · Dark',
    description: 'The same link-preview card on Thingtime ink.',
    w: 1200,
    h: 630,
    surface: 'dark',
    draw: (canvas) => {
      fillRect(canvas, 0, 0, canvas.w, canvas.h, INK_RGBA);
      placeLogo(canvas, wordmarkCells, LOGO_THEMES.default, 0.58, { offsetY: -12 });
      rainbowBar(canvas, 14);
    }
  },
  {
    slug: 'banner',
    name: 'Social banner',
    description: 'Wide header for X/Twitter and community pages.',
    w: 1500,
    h: 500,
    surface: 'light',
    draw: (canvas) => {
      fillRect(canvas, 0, 0, canvas.w, canvas.h, WHITE);
      placeLogo(canvas, wordmarkCells, LOGO_THEMES.default, 0.46, { offsetY: -8 });
      rainbowBar(canvas, 12);
    }
  },
  {
    slug: 'linkedin-banner',
    name: 'LinkedIn banner',
    description: 'Company-page cover at LinkedIn’s exact ratio.',
    w: 1584,
    h: 396,
    surface: 'light',
    draw: (canvas) => {
      fillRect(canvas, 0, 0, canvas.w, canvas.h, WHITE);
      placeLogo(canvas, wordmarkCells, LOGO_THEMES.default, 0.34, { offsetY: -6 });
      rainbowBar(canvas, 10);
    }
  },
  {
    slug: 'social-square',
    name: 'Social square',
    description: 'Pastel rainbow square for feeds and profile posts.',
    w: 1080,
    h: 1080,
    surface: 'gradient',
    draw: (canvas) => {
      fillLinearGradient(canvas, 0, 0, canvas.w, canvas.h, PASTEL_STOPS, 120);
      fillRect(canvas, 96, 96, canvas.w - 192, canvas.h - 192, WHITE);
      placeLogo(canvas, wordmarkCells, LOGO_THEMES.default, 0.62);
    }
  },
  {
    slug: 'wallpaper',
    name: 'Desktop wallpaper',
    description: 'Ink wallpaper with voxel confetti, 1080p.',
    w: 1920,
    h: 1080,
    surface: 'dark',
    draw: (canvas) => {
      fillRect(canvas, 0, 0, canvas.w, canvas.h, INK_RGBA);
      const box = placeLogo(canvas, wordmarkCells, LOGO_THEMES.default, 0.38);
      scatterConfetti(canvas, {
        seed: 20260822,
        count: 90,
        minSize: 8,
        maxSize: 22,
        avoid: { x0: box.x0 - 80, y0: box.y0 - 80, x1: box.x1 + 80, y1: box.y1 + 80 }
      });
    }
  },
  {
    slug: 'wallpaper-4k',
    name: 'Desktop wallpaper · 4K',
    description: 'The same ink + confetti wallpaper at 4K.',
    w: 3840,
    h: 2160,
    surface: 'dark',
    draw: (canvas) => {
      fillRect(canvas, 0, 0, canvas.w, canvas.h, INK_RGBA);
      const box = placeLogo(canvas, wordmarkCells, LOGO_THEMES.default, 0.38);
      scatterConfetti(canvas, {
        seed: 20260822,
        count: 90,
        minSize: 16,
        maxSize: 44,
        avoid: { x0: box.x0 - 160, y0: box.y0 - 160, x1: box.x1 + 160, y1: box.y1 + 160 }
      });
    }
  },
  {
    slug: 'wallpaper-phone',
    name: 'Phone wallpaper',
    description: 'Icon-centred ink wallpaper for phones.',
    w: 1170,
    h: 2532,
    surface: 'dark',
    draw: (canvas) => {
      fillRect(canvas, 0, 0, canvas.w, canvas.h, INK_RGBA);
      const box = placeLogo(canvas, iconCells, LOGO_THEMES.default, 0.3);
      scatterConfetti(canvas, {
        seed: 42,
        count: 110,
        minSize: 8,
        maxSize: 24,
        avoid: { x0: box.x0 - 120, y0: box.y0 - 120, x1: box.x1 + 120, y1: box.y1 + 120 }
      });
    }
  },
  {
    slug: 'app-tile',
    name: 'App tile',
    description: 'Icon on white — ready for app grids and avatars.',
    w: 1024,
    h: 1024,
    surface: 'light',
    draw: (canvas) => {
      fillRect(canvas, 0, 0, canvas.w, canvas.h, WHITE);
      placeLogo(canvas, iconCells, LOGO_THEMES.default, 0.56);
    }
  },
  {
    slug: 'app-tile-dark',
    name: 'App tile · Dark',
    description: 'Icon on Thingtime ink for dark surfaces.',
    w: 1024,
    h: 1024,
    surface: 'dark',
    draw: (canvas) => {
      fillRect(canvas, 0, 0, canvas.w, canvas.h, INK_RGBA);
      placeLogo(canvas, iconCells, LOGO_THEMES.default, 0.56);
    }
  },
  {
    slug: 'confetti-pattern',
    name: 'Confetti pattern',
    description: 'Voxel confetti field — backgrounds, slides, wrapping paper.',
    w: 2048,
    h: 2048,
    surface: 'light',
    draw: (canvas) => {
      fillRect(canvas, 0, 0, canvas.w, canvas.h, WHITE);
      scatterConfetti(canvas, { seed: 7, count: 420, minSize: 10, maxSize: 30 });
    }
  }
];

for (const item of pressKit) {
  const canvas = makeCanvas(item.w, item.h);
  item.draw(canvas);
  const png = encodePng(item.w, item.h, canvas.data);
  const fileName = `thingtime-${item.slug}-${item.w}x${item.h}.png`;
  writeFileSync(path.join(PRESSKIT_DIR, fileName), png);
  manifest.presskit.push({
    slug: item.slug,
    name: item.name,
    description: item.description,
    surface: item.surface,
    w: item.w,
    h: item.h,
    url: `/branding/presskit/${fileName}`,
    bytes: png.length
  });
  console.log(`presskit ${item.slug} ${item.w}x${item.h} (${png.length} bytes)`);
}

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest → ${path.relative(process.cwd(), MANIFEST_PATH)}`);
