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

test('the pet switch is on by default and survives a stored theme that predates it', () => {
  assert.equal(THINGTIME_THEME.general.pet, true);
  assert.equal(resolveTheme(THINGTIME_THEME, { general: { motion: false } }).general.pet, true);
  assert.equal(resolveTheme(THINGTIME_THEME, {}).general.pet, true);
});

test('the pet switch is independent of the motion switch', () => {
  const petOff = resolveTheme(THINGTIME_THEME, { general: { pet: false } });
  assert.equal(petOff.general.pet, false);
  // turning the pet off must not silently stop the rest of the app animating
  assert.equal(petOff.general.motion, true);

  const motionOff = resolveTheme(THINGTIME_THEME, { general: { motion: false } });
  assert.equal(motionOff.general.motion, false);
  assert.equal(motionOff.general.pet, true);
});

test('the pet switch is published as a var so it can gate the first paint', () => {
  // ThemeHost mirrors themeToCssVars() to localStorage and tt-boot.js reapplies
  // it render-blocking before React loads. Emitting the switch here is what
  // lets a pet-off user's first paint already be correct — reading
  // theme.general in the component cannot, because the localforage blob that
  // backs it has not resolved yet.
  assert.equal(themeToCssVars(THINGTIME_THEME)['--tt-pet-display'], 'block');
  assert.equal(themeToCssVars(resolveTheme(THINGTIME_THEME, { general: { pet: false } }))['--tt-pet-display'], 'none');
});

test('the pet var survives the pre-paint script’s key filter', () => {
  // tt-boot.js only replays keys matching /^--tt-[\w-]+$/ — a name outside that
  // shape would be silently dropped and the pet would flash back on
  assert.match('--tt-pet-display', /^--tt-[\w-]+$/u);
  assert.ok(Object.keys(themeToCssVars(THINGTIME_THEME)).every((key) => /^--tt-[\w-]+$/u.test(key)));
});

test('a non-boolean pet override is ignored rather than coerced', () => {
  for (const junk of ['false', 0, null, {}] as unknown[]) {
    const theme = resolveTheme(THINGTIME_THEME, { general: { pet: junk } } as never);
    assert.equal(theme.general.pet, true, String(junk));
  }
});
