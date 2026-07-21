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

export const buildLogoSvg = ({
  matrix,
  colourMap,
  background
}: {
  matrix: LogoMatrix;
  colourMap: LogoColourMap;
  // optional solid backdrop (e.g. white) baked into exports; omit = transparent
  background?: string;
}): { svg: string; columns: number; rows: number } => {
  const cells = logoMatrixToCells(matrix);
  const rows = cells.length;
  const columns = Math.max(0, ...cells.map((row) => row.length));

  const rects: string[] = [];
  if (background) {
    rects.push(`<rect x="0" y="0" width="${columns}" height="${rows}" fill="${background}"/>`);
  }
  cells.forEach((row, y) => {
    row.forEach((col, x) => {
      const fill = resolveLogoColour(col, colourMap);
      if (fill) {
        rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
      }
    });
  });

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${columns} ${rows}" ` +
    `shape-rendering="crispEdges">${rects.join('')}</svg>`;

  return { svg, columns, rows };
};
