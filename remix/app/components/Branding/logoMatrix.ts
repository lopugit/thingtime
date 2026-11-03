// Single source of truth for the voxel logo (claude-todo/08 §3): the matrices
// and colour themes previously private to Logo.tsx, plus a pure SVG builder so
// the same data drives the live DOM logo, the /branding SVG previews, and the
// PNG export path.

export type LogoMatrix = Array<string | Array<string | number>>;
export type LogoColourMap = Record<string | number, string>;

export const LOGO_ICON_MATRIX: LogoMatrix = [
  [0, 7, 0],
  [7, 0, 7],
  [0, 8, 0]
];

export const LOGO_FULL_MATRIX: LogoMatrix = [
  '111,020,030,000,000,070,030',
  '010,022,000,550,660,707,000,999,0xx',
  '010,022,040,550,660,080,040,999,0xx',
  '00000000000006',
  '00000000000066'
];

export const LOGO_DEFAULT_COLOURS: LogoColourMap = {
  0: 'transparent',
  1: '#59ff9c',
  2: '#59bdff',
  3: '#00b7ef',
  4: '#ed1c24',
  5: '#ffa3b1',
  6: '#6f3198',
  7: '#a8e61d',
  8: '#9c5a3c',
  9: '#ffc20e',
  x: '#ff7e00'
};

export const LOGO_THEMES: Record<string, LogoColourMap> = {
  default: LOGO_DEFAULT_COLOURS,
  nature: LOGO_DEFAULT_COLOURS,
  tt: LOGO_DEFAULT_COLOURS,
  thingtime: LOGO_DEFAULT_COLOURS,
  pink: {
    0: 'transparent',
    1: 'hotpink',
    2: 'hotpink'
  }
};

// Mirror Logo.tsx exactly: commas are glyph separators that render nothing and
// advance nothing; unknown keys fall back to colourMap[1].
export const logoMatrixToCells = (matrix: LogoMatrix): string[][] =>
  matrix.map((row) => {
    const iterator = row instanceof Array ? row : Array.from(String(row));
    return iterator.map((col) => String(col)).filter((col) => col !== ',');
  });

export const resolveLogoColour = (col: string, colourMap: LogoColourMap): string | undefined => {
  const colour = colourMap[col] ?? colourMap[1];
  return !colour || colour === 'transparent' ? undefined : colour;
};

// Per-side padding, expressed in cell units (fractional values are fine — the
// exporter converts px → cells before calling in here).
export type LogoPadding = { top: number; right: number; bottom: number; left: number };

export const ZERO_LOGO_PADDING: LogoPadding = { top: 0, right: 0, bottom: 0, left: 0 };

// Strip fully-transparent outer rows/columns so every preview and export hugs
// the artwork exactly (branding-page rule: assets ship with zero whitespace).
export const trimLogoCells = (cells: string[][], colourMap: LogoColourMap): string[][] => {
  const filled = (col: string) => Boolean(resolveLogoColour(col, colourMap));
  let top = 0;
  let bottom = cells.length;
  while (top < bottom && !cells[top].some(filled)) top += 1;
  while (bottom > top && !cells[bottom - 1].some(filled)) bottom -= 1;
  const sliced = cells.slice(top, bottom);
  let left = Number.POSITIVE_INFINITY;
  let right = 0;
  sliced.forEach((row) => {
    row.forEach((col, x) => {
      if (filled(col)) {
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
      }
    });
  });
  if (!sliced.length || right <= left) return [];
  return sliced.map((row) => row.slice(left, right));
};

// Compact number formatting so fractional padding doesn't bloat the SVG.
const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

export const buildLogoSvg = ({
  matrix,
  colourMap,
  background,
  trim = true,
  padding,
  pixelWidth
}: {
  matrix: LogoMatrix;
  colourMap: LogoColourMap;
  // optional solid backdrop (e.g. white) baked into exports; omit = transparent
  background?: string;
  // trim transparent outer rows/cols first (on by default — see trimLogoCells)
  trim?: boolean;
  // extra breathing room around the artwork, in cell units
  padding?: Partial<LogoPadding>;
  // when set, the <svg> gets explicit width/height attrs at this pixel width
  pixelWidth?: number;
}): { svg: string; columns: number; rows: number; totalColumns: number; totalRows: number; pixelHeight?: number } => {
  let cells = logoMatrixToCells(matrix);
  if (trim) cells = trimLogoCells(cells, colourMap);
  const rows = cells.length;
  const columns = Math.max(0, ...cells.map((row) => row.length));
  const pad: LogoPadding = { ...ZERO_LOGO_PADDING, ...padding };
  const totalColumns = columns + pad.left + pad.right;
  const totalRows = rows + pad.top + pad.bottom;

  const rects: string[] = [];
  if (background) {
    rects.push(`<rect x="${fmt(-pad.left)}" y="${fmt(-pad.top)}" width="${fmt(totalColumns)}" height="${fmt(totalRows)}" fill="${background}"/>`);
  }
  cells.forEach((row, y) => {
    row.forEach((col, x) => {
      const fill = resolveLogoColour(col, colourMap);
      if (fill) {
        rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
      }
    });
  });

  const pixelHeight = pixelWidth === undefined ? undefined : Math.max(1, Math.round((pixelWidth / totalColumns) * totalRows));
  const sizeAttrs = pixelWidth === undefined ? '' : `width="${Math.max(1, Math.round(pixelWidth))}" height="${pixelHeight}" `;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" ${sizeAttrs}` +
    `viewBox="${fmt(-pad.left)} ${fmt(-pad.top)} ${fmt(totalColumns)} ${fmt(totalRows)}" ` +
    `shape-rendering="crispEdges">${rects.join('')}</svg>`;

  return { svg, columns, rows, totalColumns, totalRows, pixelHeight };
};
