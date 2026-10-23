import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveTheme,
  sanitizePaddingCssValue,
  THINGS_BADGE_PADDING_PRESETS,
  THINGTIME_THEME,
  themeToCssVars
} from './tokens';

test('Things badges use the smaller padding preset by default', () => {
  assert.equal(THINGTIME_THEME.general.thingsBadgePadding, 'small');
  assert.equal(themeToCssVars(THINGTIME_THEME)['--tt-things-badge-padding'], '3px 8px');
});

test('Things badge padding presets resolve to stable CSS tokens', () => {
  for (const [size, expected] of Object.entries(THINGS_BADGE_PADDING_PRESETS)) {
    const theme = resolveTheme(THINGTIME_THEME, { general: { thingsBadgePadding: size as 'small' | 'medium' | 'large' } });
    assert.equal(themeToCssVars(theme)['--tt-things-badge-padding'], expected, size);
  }
});

test('custom Things badge padding accepts one to four CSS lengths', () => {
  assert.equal(sanitizePaddingCssValue('  2px   0.75rem  4px  5% '), '2px 0.75rem 4px 5%');
  const theme = resolveTheme(THINGTIME_THEME, {
    general: { thingsBadgePadding: 'custom', thingsBadgeCustomPadding: '2px 10px 4px' }
  });
  assert.equal(theme.general.thingsBadgeCustomPadding, '2px 10px 4px');
  assert.equal(themeToCssVars(theme)['--tt-things-badge-padding'], '2px 10px 4px');
});

test('unsafe or invalid custom padding falls back without leaking declarations', () => {
  for (const value of ['4px; position: fixed', '-2px 8px', 'red', '1px 2px 3px 4px 5px', 'url(example.test)']) {
    assert.equal(sanitizePaddingCssValue(value), null, value);
    const theme = resolveTheme(THINGTIME_THEME, {
      general: { thingsBadgePadding: 'custom', thingsBadgeCustomPadding: value }
    });
    assert.equal(themeToCssVars(theme)['--tt-things-badge-padding'], THINGS_BADGE_PADDING_PRESETS.small, value);
  }
});

test('an empty custom padding intentionally uses the Small fallback', () => {
  const theme = resolveTheme(THINGTIME_THEME, {
    general: { thingsBadgePadding: 'custom', thingsBadgeCustomPadding: '' }
  });
  assert.equal(theme.general.thingsBadgeCustomPadding, '');
  assert.equal(themeToCssVars(theme)['--tt-things-badge-padding'], THINGS_BADGE_PADDING_PRESETS.small);
});
