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

test('focus preferences round-trip through shared-theme normalization and CSS tokens', () => {
  const custom = resolveTheme(THINGTIME_THEME, {
    colors: { focusBorder: '#26724d', focusGlowStart: '#55ffaa', focusGlowEnd: '#4488ff' },
    general: { focusGlowBlur: 20, focusGlowOpacity: 0.4 }
  });
  const restored = resolveTheme(THINGTIME_THEME, JSON.parse(JSON.stringify(custom)));
  assert.deepEqual(restored, custom);
  const vars = themeToCssVars(restored);
  assert.equal(vars['--tt-focus-border'], '#26724d');
  assert.equal(vars['--tt-focus-glow-start'], '#55ffaa');
  assert.equal(vars['--tt-focus-glow-end'], '#4488ff');
  assert.equal(vars['--tt-focus-glow-blur'], '20px');
  assert.equal(vars['--tt-focus-glow-opacity'], '0.4');
  assert.match(vars['--tt-focus-shadow'], /color-mix\(in srgb, var\(--tt-focus-glow-start\)/);
  assert.match(vars['--tt-focus-shadow'], /var\(--tt-focus-glow-end\)/);
});

test('old saved themes gain focus defaults while preserving existing preferences', () => {
  const old = JSON.parse(JSON.stringify(THINGTIME_THEME));
  for (const key of ['focusBorder', 'focusGlowStart', 'focusGlowEnd']) delete old.colors[key];
  for (const key of ['focusGlowBlur', 'focusGlowOpacity']) delete old.general[key];
  old.colors.accent = '#112233';
  old.general.radiusScale = 0.5;
  const migrated = resolveTheme(old, null);
  assert.equal(migrated.colors.accent, '#112233');
  assert.equal(migrated.general.radiusScale, 0.5);
  assert.equal(migrated.colors.focusBorder, '#d63384');
  assert.equal(migrated.general.focusGlowBlur, 14);
  assert.equal(migrated.general.focusGlowOpacity, 0.24);
  assert.equal(themeToCssVars(old)['--tt-focus-glow-blur'], '14px');
});

test('unsafe focus colors and non-finite effect settings cannot enter CSS', () => {
  const theme = resolveTheme(THINGTIME_THEME, {
    colors: { focusBorder: 'red;position:fixed', focusGlowStart: 'url(https://example.test)' },
    general: { focusGlowBlur: NaN, focusGlowOpacity: Infinity }
  });
  assert.equal(theme.colors.focusBorder, THINGTIME_THEME.colors.focusBorder);
  assert.equal(theme.colors.focusGlowStart, THINGTIME_THEME.colors.focusGlowStart);
  assert.equal(theme.general.focusGlowBlur, 14);
  assert.equal(theme.general.focusGlowOpacity, 0.24);
  assert.equal(resolveTheme(theme, { general: { focusGlowOpacity: 0 } }).general.focusGlowOpacity, 0);
});

test('default pink focus border contrasts with both light and dark canonical cards', () => {
  const luminance = (hex: string) => {
    const values = hex.match(/[a-f\d]{2}/gi)!.map(value => {
      const n = parseInt(value, 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const focus = luminance(THINGTIME_THEME.colors.focusBorder);
  for (const card of ['#ffffff', '#131318']) {
    const background = luminance(card);
    assert.ok((Math.max(focus, background) + 0.05) / (Math.min(focus, background) + 0.05) >= 3, card);
  }
});


test('focus glow blur supports nonnegative finite sizes without an arbitrary maximum', () => {
  for (const blur of [0, 100, 256.5]) {
    const theme = resolveTheme(THINGTIME_THEME, { general: { focusGlowBlur: blur } });
    assert.equal(theme.general.focusGlowBlur, blur);
    assert.equal(themeToCssVars(theme)['--tt-focus-glow-blur'], `${blur}px`);
  }
  assert.equal(resolveTheme(THINGTIME_THEME, { general: { focusGlowBlur: -1 } }).general.focusGlowBlur, 0);
});
