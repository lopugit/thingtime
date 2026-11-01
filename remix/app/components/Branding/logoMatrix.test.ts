import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LOGO_FULL_MATRIX,
  LOGO_ICON_MATRIX,
  LOGO_THEMES,
  buildLogoSvg,
  logoMatrixToCells,
  trimLogoCells
} from './logoMatrix';

const defaultMap = LOGO_THEMES.default;

test('trimLogoCells strips fully-transparent outer rows and columns', () => {
  const padded = logoMatrixToCells(['00000', '00700', '07070', '00800', '00000']);
  const trimmed = trimLogoCells(padded, defaultMap);
  assert.deepEqual(trimmed, [
    ['0', '7', '0'],
    ['7', '0', '7'],
    ['0', '8', '0']
  ]);
});

test('trimLogoCells leaves an already-tight matrix untouched', () => {
  const tight = logoMatrixToCells(LOGO_ICON_MATRIX);
  assert.deepEqual(trimLogoCells(tight, defaultMap), tight);
});

test('the shipped matrices carry no baked-in whitespace', () => {
  for (const matrix of [LOGO_FULL_MATRIX, LOGO_ICON_MATRIX]) {
    const cells = logoMatrixToCells(matrix);
    assert.deepEqual(trimLogoCells(cells, defaultMap), cells);
  }
});

test('buildLogoSvg trims by default and reports trimmed dimensions', () => {
  const padded = buildLogoSvg({ matrix: ['000', '070', '000'], colourMap: defaultMap });
  assert.equal(padded.columns, 1);
  assert.equal(padded.rows, 1);
  assert.match(padded.svg, /viewBox="0 0 1 1"/);
});

test('padding extends the viewBox on the right sides', () => {
  const { svg, totalColumns, totalRows } = buildLogoSvg({
    matrix: LOGO_ICON_MATRIX,
    colourMap: defaultMap,
    padding: { top: 1, right: 2, bottom: 3, left: 4 }
  });
  assert.equal(totalColumns, 3 + 2 + 4);
  assert.equal(totalRows, 3 + 1 + 3);
  assert.match(svg, /viewBox="-4 -1 9 7"/);
});

test('background covers the padded area', () => {
  const { svg } = buildLogoSvg({
    matrix: LOGO_ICON_MATRIX,
    colourMap: defaultMap,
    background: '#ffffff',
    padding: { top: 1, right: 1, bottom: 1, left: 1 }
  });
  assert.match(svg, /<rect x="-1" y="-1" width="5" height="5" fill="#ffffff"\/>/);
});

test('pixelWidth emits proportional width/height attributes', () => {
  const { svg, pixelHeight } = buildLogoSvg({ matrix: LOGO_FULL_MATRIX, colourMap: defaultMap, pixelWidth: 1024 });
  assert.equal(pixelHeight, Math.round((1024 / 27) * 5));
  assert.match(svg, new RegExp(`width="1024" height="${pixelHeight}"`));
});
