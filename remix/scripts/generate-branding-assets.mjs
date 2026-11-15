#!/usr/bin/env node
// Deterministic branding asset generator for the /branding page.
//
// Renders the shared logo registry (app/components/Branding/logoVariants.ts —
// node 24 strips the types on import) into committed static files under
// remix/public/branding/, so every logo cut exists as real PNG/SVG URLs that
// Google Images can index and people can grab without the exporter:
//   generated/<cut>/thingtime-<cut>-<w>x<h>.png           transparent
//   generated/<cut>/thingtime-<cut>-light-<w>x<h>.png     on white
//   generated/<cut>/thingtime-<cut>-dark-<w>x<h>.png      on ink
//   (+ one scalable .svg per background)
//   presskit/thingtime-<name>-<w>x<h>.png                 marketing suite:
//                                                         every format × logo × background
//   imagery/thingtime-<format>-<logo>-<backdrop>-<pattern>-<w>x<h>.png
//                                                         the curated generative set
//                                                         (brandImagery.ts)
// plus the manifests the page reads, beside the registry in app/components/Branding/.
//
// Zero native deps: pixels are composed in raw buffers and encoded as PNG
// through node's zlib. Output is byte-stable run to run (no timestamps, seeded
// PRNG) so re-running produces no git churn.

import { deflateSync } from 'node:zlib';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOGO_FULL_MATRIX,
  LOGO_ICON_MATRIX,
  LOGO_STACKED_MATRIX,
  LOGO_THEMES,
  logoMatrixToCells,
  resolveLogoColour,
  trimLogoCells
} from '../app/components/Branding/logoMatrix.ts';
import {
  BRAND_LOGO_VARIANTS,
  BRAND_SURFACES,
  backdropPadding,
  brandPngUrl,
  brandSvgUrl,
  buildVariantSvg,
  logoPixels,
  seededRandom
} from '../app/components/Branding/logoVariants.ts';
import { BRAND_IMAGERY, brandImageryUrl } from '../app/components/Branding/brandImagery.ts';
import { buildBrandScene } from '../app/components/Branding/brandScenes.ts';
import { RAINBOW_PALETTE } from '../app/theme/tokens.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_BRANDING = path.join(HERE, '..', 'public', 'branding');
const GENERATED_DIR = path.join(PUBLIC_BRANDING, 'generated');
const PRESSKIT_DIR = path.join(PUBLIC_BRANDING, 'presskit');
const IMAGERY_DIR = path.join(PUBLIC_BRANDING, 'imagery');
const MANIFEST_PATH = path.join(HERE, '..', 'app', 'components', 'Branding', 'brandingAssets.generated.json');
const SURFACES_PATH = path.join(HERE, '..', 'app', 'components', 'Branding', 'brandingSurfaces.generated.json');
const IMAGERY_PATH = path.join(HERE, '..', 'app', 'components', 'Branding', 'brandingImagery.generated.json');

// The requested ready-made ladder: 10px thumbnails up to 10k wall prints.
const SIZES = [10, 16, 32, 50, 64, 100, 128, 200, 256, 500, 512, 1000, 1024, 2000, 2048, 4096, 5000, 8192, 10000];

const INK = '#16161a';

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

// Extended accent dots from docs/design/DESIGN_LANGUAGE.md (the confetti set).
const CONFETTI_COLOURS = ['#59ff9c', '#59bdff', '#00b7ef', '#ed1c24', '#ffa9dd', '#6f3198', '#a8e61d', '#ffc20e', '#ff7e00', '#ff69b4'].map(parseColour);

const RAINBOW_STOPS = RAINBOW_PALETTE.map(parseColour);

const scatterConfetti = (canvas, { seed, count, minSize, maxSize, avoid }) => {
  const rand = seededRandom(seed);
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
// Logo ladder renderer. A voxel logo scaled to N rows is mostly long runs of
// identical rows, so each distinct row is rendered once and the image is kept
// as (unique rows, row → index). That makes a 10000×10000 file cheap to build
// and lets the encoder below emit repeats as all-zero "Up" filter rows.

const renderLogoRows = (grid, outW, outH, backdrop) => {
  const rowCount = grid.length;
  const colCount = Math.max(0, ...grid.map((row) => row.length));
  const xMap = coverageMap(outW, colCount);
  const yMap = coverageMap(outH, rowCount);
  const bySpans = new Map();
  const byContent = new Map();
  const rows = [];
  const rowOf = new Int32Array(outH);
  for (let y = 0; y < outH; y += 1) {
    const ySpans = yMap[y];
    const spanKey = ySpans.map(([cell, weight]) => `${cell}:${weight}`).join('|');
    let id = bySpans.get(spanKey);
    if (id === undefined) {
      const line = Buffer.alloc(outW * 4);
      for (let x = 0; x < outW; x += 1) {
        const xSpans = xMap[x];
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (const [cy, wy] of ySpans) {
          const colourRow = grid[cy];
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
        const idx = x * 4;
        if (backdrop) {
          // exact area average of the artwork over the solid backdrop
          const rest = 1 - Math.min(1, a);
          line[idx] = Math.round(r + backdrop[0] * rest);
          line[idx + 1] = Math.round(g + backdrop[1] * rest);
          line[idx + 2] = Math.round(b + backdrop[2] * rest);
          line[idx + 3] = 255;
        } else if (a > 0) {
          line[idx] = Math.round(r / a);
          line[idx + 1] = Math.round(g / a);
          line[idx + 2] = Math.round(b / a);
          line[idx + 3] = Math.round(Math.min(1, a) * 255);
        }
      }
      const contentKey = line.toString('latin1');
      id = byContent.get(contentKey);
      if (id === undefined) {
        id = rows.length;
        rows.push(line);
        byContent.set(contentKey, id);
      }
      bySpans.set(spanKey, id);
    }
    rowOf[y] = id;
  }
  return { w: outW, h: outH, rows, rowOf };
};

// Flat voxel art rarely needs more than a handful of colours, so the ladder
// is written as palette PNGs at the smallest bit depth that fits (1/2/4/8),
// falling back to RGBA only when antialiased edges push past 256 colours.
// Same pixels as an RGBA file at a fraction of the bytes.
const encodeRowsPng = ({ w, h, rows, rowOf }) => {
  const colours = new Map();
  let indexed = true;
  scan: for (const line of rows) {
    for (let i = 0; i < line.length; i += 4) {
      const a = line[i + 3];
      const key = a === 0 ? 0 : ((line[i] << 24) | (line[i + 1] << 16) | (line[i + 2] << 8) | a) >>> 0;
      if (colours.has(key)) continue;
      if (colours.size === 256) {
        indexed = false;
        break scan;
      }
      colours.set(key, a === 0 ? [0, 0, 0, 0] : [line[i], line[i + 1], line[i + 2], a]);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  const chunks = [];
  let packed;

  if (indexed) {
    // translucent entries first so tRNS can stop at the last non-opaque one
    const keys = [...colours.keys()].sort((ka, kb) => colours.get(ka)[3] - colours.get(kb)[3] || ka - kb);
    const indexOf = new Map(keys.map((key, index) => [key, index]));
    const bitDepth = keys.length <= 2 ? 1 : keys.length <= 4 ? 2 : keys.length <= 16 ? 4 : 8;
    const stride = Math.ceil((w * bitDepth) / 8);
    packed = rows.map((line) => {
      const out = Buffer.alloc(stride);
      for (let x = 0; x < w; x += 1) {
        const i = x * 4;
        const a = line[i + 3];
        const key = a === 0 ? 0 : ((line[i] << 24) | (line[i + 1] << 16) | (line[i + 2] << 8) | a) >>> 0;
        const bit = x * bitDepth;
        out[bit >> 3] |= indexOf.get(key) << (8 - bitDepth - (bit & 7));
      }
      return out;
    });
    ihdr[8] = bitDepth;
    ihdr[9] = 3; // colour type: palette
    const plte = Buffer.alloc(keys.length * 3);
    keys.forEach((key, index) => {
      const [r, g, b] = colours.get(key);
      plte[index * 3] = r;
      plte[index * 3 + 1] = g;
      plte[index * 3 + 2] = b;
    });
    chunks.push(pngChunk('PLTE', plte));
    const translucent = keys.filter((key) => colours.get(key)[3] < 255);
    if (translucent.length) chunks.push(pngChunk('tRNS', Buffer.from(translucent.map((key) => colours.get(key)[3]))));
  } else {
    packed = rows;
    ihdr[8] = 8;
    ihdr[9] = 6; // colour type: RGBA
  }

  const stride = packed[0].length;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const pos = y * (stride + 1);
    if (y > 0 && rowOf[y - 1] === rowOf[y]) {
      raw[pos] = 2; // Up filter: identical to the row above, so the delta is all zeros
    } else {
      packed[rowOf[y]].copy(raw, pos + 1); // filter 0 (None)
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    ...chunks,
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
};

// ---------------------------------------------------------------------------
// Build

const WHITE = parseColour('#ffffff');
const INK_RGBA = parseColour(INK);
const EMPTY = [0, 0, 0, 0];

rmSync(GENERATED_DIR, { recursive: true, force: true });
rmSync(PRESSKIT_DIR, { recursive: true, force: true });
rmSync(IMAGERY_DIR, { recursive: true, force: true });
mkdirSync(GENERATED_DIR, { recursive: true });
mkdirSync(PRESSKIT_DIR, { recursive: true });
mkdirSync(IMAGERY_DIR, { recursive: true });

// Two manifests, split by who reads them. brandingAssets keeps the long-standing
// shape (transparent files + press kit) for the sitemap, <Logo> and the
// tt.assets tree, which ride in the main bundle. brandingSurfaces carries the
// light/dark ladders as compact [w, h, bytes] tuples for the lazy /branding
// route alone, which rebuilds each URL from brandSvgUrl/brandPngUrl.
const manifest = { sizes: SIZES, variants: [], presskit: [] };
const surfaceManifest = {};

for (const variant of BRAND_LOGO_VARIANTS) {
  const pixels = logoPixels(variant.matrix, variant.colourMap, variant.trim);
  const dir = path.join(GENERATED_DIR, variant.slug);
  mkdirSync(dir, { recursive: true });

  const entry = { slug: variant.slug, name: variant.name, group: variant.group };
  const surfaces = {};

  for (const surface of BRAND_SURFACES) {
    const pad = backdropPadding(variant, surface.key);
    const artCols = Math.max(0, ...pixels.map((row) => row.length));
    const cols = artCols + pad * 2;
    const rows = pixels.length + pad * 2;
    const grid = Array.from({ length: rows }, (_, y) =>
      Array.from({ length: cols }, (_, x) => {
        const colour = pixels[y - pad]?.[x - pad];
        return colour ? parseColour(colour) : EMPTY;
      })
    );
    const backdrop = surface.colour ? parseColour(surface.colour) : null;

    const { svg } = buildVariantSvg(variant, surface.key, 1024);
    const svgUrl = brandSvgUrl(variant.slug, surface.key);
    writeFileSync(path.join(PUBLIC_BRANDING, '..', svgUrl), svg);

    const pngs = [];
    for (const size of SIZES) {
      const w = size;
      const h = cols === rows ? size : Math.max(1, Math.round((size / cols) * rows));
      const png = encodeRowsPng(renderLogoRows(grid, w, h, backdrop));
      const url = brandPngUrl(variant.slug, surface.key, w, h);
      writeFileSync(path.join(PUBLIC_BRANDING, '..', url), png);
      pngs.push({ w, h, url, bytes: png.length });
    }
    console.log(`generated ${variant.slug} · ${surface.key} (${pngs.length} PNGs, ${pngs.reduce((sum, png) => sum + png.bytes, 0)} bytes)`);

    if (surface.key === 'transparent') {
      entry.aspect = { cols, rows };
      entry.svg = { url: svgUrl, bytes: Buffer.byteLength(svg) };
      entry.pngs = pngs;
    } else {
      surfaces[surface.key] = {
        aspect: { cols, rows },
        svgBytes: Buffer.byteLength(svg),
        pngs: pngs.map((png) => [png.w, png.h, png.bytes])
      };
    }
  }

  surfaceManifest[variant.slug] = surfaces;
  manifest.variants.push(entry);
}

// ---------------------------------------------------------------------------
// Press kit: every format × logo lock-up × background

const PASTEL_STOPS = RAINBOW_STOPS.map((stop) => pastel(stop));
const DUSK_STOPS = RAINBOW_STOPS.map((stop) => {
  const deep = mix(stop, INK_RGBA, 0.3);
  deep[3] = 255;
  return deep;
});

const PRESS_LOGOS = [
  { key: 'wordmark', name: 'Wordmark', cells: trimLogoCells(logoMatrixToCells(LOGO_FULL_MATRIX), LOGO_THEMES.default) },
  { key: 'square', name: 'Square', cells: trimLogoCells(logoMatrixToCells(LOGO_STACKED_MATRIX), LOGO_THEMES.default) },
  { key: 'icon', name: 'Icon', cells: trimLogoCells(logoMatrixToCells(LOGO_ICON_MATRIX), LOGO_THEMES.default) }
];

const PRESS_SURFACES = [
  { key: 'light', name: 'Light', fill: WHITE, frame: PASTEL_STOPS },
  { key: 'dark', name: 'Dark', fill: INK_RGBA, frame: DUSK_STOPS }
];

const paper = (canvas, surface) => fillRect(canvas, 0, 0, canvas.w, canvas.h, surface.fill);
const logoOn = (canvas, logo, widths, options) => placeLogo(canvas, logo.cells, LOGO_THEMES.default, widths[logo.key], options);

// `files` keeps the filenames published before the logo × background matrix
// existed, so those URLs stay stable; every other combination is named
// <format>-<logo>-<background>.
const PRESS_FORMATS = [
  {
    kind: 'og-card',
    name: 'Open Graph card',
    description: 'Link-preview card with the Thingtime rainbow underline.',
    w: 1200,
    h: 630,
    files: { 'wordmark/light': 'og-card', 'wordmark/dark': 'og-card-dark' },
    draw: (canvas, logo, surface) => {
      paper(canvas, surface);
      logoOn(canvas, logo, { wordmark: 0.58, square: 0.44, icon: 0.2 }, { offsetY: -12 });
      rainbowBar(canvas, 14);
    }
  },
  {
    kind: 'banner',
    name: 'Social banner',
    description: 'Wide header for X/Twitter and community pages.',
    w: 1500,
    h: 500,
    files: { 'wordmark/light': 'banner' },
    draw: (canvas, logo, surface) => {
      paper(canvas, surface);
      logoOn(canvas, logo, { wordmark: 0.46, square: 0.3, icon: 0.13 }, { offsetY: -8 });
      rainbowBar(canvas, 12);
    }
  },
  {
    kind: 'linkedin-banner',
    name: 'LinkedIn banner',
    description: 'Company-page cover at LinkedIn’s exact ratio.',
    w: 1584,
    h: 396,
    files: { 'wordmark/light': 'linkedin-banner' },
    draw: (canvas, logo, surface) => {
      paper(canvas, surface);
      logoOn(canvas, logo, { wordmark: 0.34, square: 0.22, icon: 0.1 }, { offsetY: -6 });
      rainbowBar(canvas, 10);
    }
  },
  {
    kind: 'social-square',
    name: 'Social square',
    description: 'Rainbow-framed square for feeds and profile posts.',
    w: 1080,
    h: 1080,
    files: { 'wordmark/light': 'social-square' },
    draw: (canvas, logo, surface) => {
      fillLinearGradient(canvas, 0, 0, canvas.w, canvas.h, surface.frame, 120);
      fillRect(canvas, 96, 96, canvas.w - 192, canvas.h - 192, surface.fill);
      logoOn(canvas, logo, { wordmark: 0.62, square: 0.5, icon: 0.26 });
    }
  },
  {
    kind: 'wallpaper',
    name: 'Desktop wallpaper',
    description: 'Voxel-confetti desktop wallpaper, 1080p.',
    w: 1920,
    h: 1080,
    files: { 'wordmark/dark': 'wallpaper' },
    draw: (canvas, logo, surface) => {
      paper(canvas, surface);
      const box = logoOn(canvas, logo, { wordmark: 0.38, square: 0.24, icon: 0.09 });
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
    kind: 'wallpaper-4k',
    name: 'Desktop wallpaper · 4K',
    description: 'The same confetti wallpaper at 4K.',
    w: 3840,
    h: 2160,
    files: { 'wordmark/dark': 'wallpaper-4k' },
    draw: (canvas, logo, surface) => {
      paper(canvas, surface);
      const box = logoOn(canvas, logo, { wordmark: 0.38, square: 0.24, icon: 0.09 });
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
    kind: 'wallpaper-phone',
    name: 'Phone wallpaper',
    description: 'Voxel-confetti wallpaper for phones.',
    w: 1170,
    h: 2532,
    files: { 'icon/dark': 'wallpaper-phone' },
    draw: (canvas, logo, surface) => {
      paper(canvas, surface);
      const box = logoOn(canvas, logo, { wordmark: 0.72, square: 0.56, icon: 0.3 });
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
    kind: 'app-tile',
    name: 'App tile',
    description: 'Square tile, ready for app grids and avatars.',
    w: 1024,
    h: 1024,
    files: { 'icon/light': 'app-tile', 'icon/dark': 'app-tile-dark' },
    draw: (canvas, logo, surface) => {
      paper(canvas, surface);
      logoOn(canvas, logo, { wordmark: 0.76, square: 0.58, icon: 0.56 });
    }
  },
  {
    kind: 'confetti-pattern',
    name: 'Confetti pattern',
    description: 'Voxel confetti field — backgrounds, slides, wrapping paper.',
    w: 2048,
    h: 2048,
    logoless: true,
    files: { 'light': 'confetti-pattern', 'dark': 'confetti-pattern-dark' },
    draw: (canvas, _logo, surface) => {
      paper(canvas, surface);
      scatterConfetti(canvas, { seed: 7, count: 420, minSize: 10, maxSize: 30 });
    }
  }
];

for (const format of PRESS_FORMATS) {
  for (const logo of format.logoless ? [null] : PRESS_LOGOS) {
    for (const surface of PRESS_SURFACES) {
      const combo = logo ? `${logo.key}/${surface.key}` : surface.key;
      const slug = format.files[combo] ?? `${format.kind}-${logo.key}-${surface.key}`;
      const canvas = makeCanvas(format.w, format.h);
      format.draw(canvas, logo, surface);
      const png = encodePng(format.w, format.h, canvas.data);
      const fileName = `thingtime-${slug}-${format.w}x${format.h}.png`;
      writeFileSync(path.join(PRESSKIT_DIR, fileName), png);
      manifest.presskit.push({
        slug,
        kind: format.kind,
        kindName: format.name,
        logo: logo ? logo.key : null,
        surface: surface.key,
        name: [format.name, logo?.name, surface.name].filter(Boolean).join(' · '),
        description: format.description,
        w: format.w,
        h: format.h,
        url: `/branding/presskit/${fileName}`,
        bytes: png.length
      });
      console.log(`presskit ${slug} ${format.w}x${format.h} (${png.length} bytes)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Generative imagery: the curated scenes, painted from the same rectangle list
// the studio draws. Scenes are flat colour on a voxel grid, so they go through
// the palette encoder with consecutive identical rows collapsed.

const colourCache = new Map();
const sceneColour = (value) => {
  let rgba = colourCache.get(value);
  if (!rgba) {
    rgba = parseColour(value);
    colourCache.set(value, rgba);
  }
  return rgba;
};

const sceneRows = (scene) => {
  const canvas = makeCanvas(scene.width, scene.height);
  for (const [x, y, w, h, colour] of scene.rects) fillRect(canvas, x, y, w, h, sceneColour(colour));
  const stride = scene.width * 4;
  const rows = [];
  const rowOf = new Int32Array(scene.height);
  for (let y = 0; y < scene.height; y += 1) {
    const line = canvas.data.subarray(y * stride, (y + 1) * stride);
    if (y > 0 && line.equals(rows[rows.length - 1])) {
      rowOf[y] = rows.length - 1;
    } else {
      rowOf[y] = rows.length;
      rows.push(line);
    }
  }
  return { w: scene.width, h: scene.height, rows, rowOf };
};

const imageryManifest = { items: [] };
for (const item of BRAND_IMAGERY) {
  const png = encodeRowsPng(sceneRows(buildBrandScene(item.scene)));
  const url = brandImageryUrl(item);
  writeFileSync(path.join(PUBLIC_BRANDING, '..', url), png);
  imageryManifest.items.push({ id: item.id, name: item.name, w: item.format.width, h: item.format.height, url, bytes: png.length });
  console.log(`imagery ${item.id} ${item.format.width}x${item.format.height} (${png.length} bytes)`);
}

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest → ${path.relative(process.cwd(), MANIFEST_PATH)}`);
// keep each [w, h, bytes] tuple on one line so the file stays reviewable
const surfaceJson = JSON.stringify(surfaceManifest, null, 2).replace(/\[\s+(\d+),\s+(\d+),\s+(\d+)\s+\]/g, '[$1, $2, $3]');
writeFileSync(SURFACES_PATH, `${surfaceJson}\n`);
console.log(`surfaces → ${path.relative(process.cwd(), SURFACES_PATH)}`);
// one item per line, same reason
const imageryJson = `{\n  "items": [\n${imageryManifest.items.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n')}\n  ]\n}\n`;
writeFileSync(IMAGERY_PATH, imageryJson);
console.log(`imagery → ${path.relative(process.cwd(), IMAGERY_PATH)}`);
