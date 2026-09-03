import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('the motion switch reaches the pet pre-paint, like every other decorative surface', () => {
  // The pet's animations are gated by a var for the same reason its visibility
  // is: general.motion is Tier 2, so a motion-off user would otherwise animate
  // for one frame per load. `initial` makes the property guaranteed-invalid, so
  // each element's var(--tt-pet-anim, <its own spec>) falls back to its own
  // animation — one var gating three different shorthands.
  assert.equal(themeToCssVars(THINGTIME_THEME)['--tt-pet-anim'], 'initial')
  assert.equal(themeToCssVars(resolveTheme(THINGTIME_THEME, { general: { motion: false } }))['--tt-pet-anim'], 'none')
  // and it is the motion switch that owns it, not the pet switch: a hidden pet
  // still animates if it is ever shown again
  assert.equal(themeToCssVars(resolveTheme(THINGTIME_THEME, { general: { pet: false } }))['--tt-pet-anim'], 'initial')
})

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

test('every published var has a :root default, so skipping the write loses nothing', async () => {
  // The pre-paint snapshot is applied INLINE on <html>, so it outranks this
  // rule and a hydrated theme still wins. But it is what keeps a first-ever
  // visit (no snapshot) and the getComputedStyle readers — eggs.ts,
  // ConfettiCanvas — resolving every token while ThemeHost is still waiting.
  const source = await readFile(new URL('../globals/GlobalStyles.tsx', import.meta.url), 'utf8');

  assert.match(source, /':root':\s*\{\s*\.\.\.ttThemeDefaults/u);
  assert.match(source, /const ttThemeDefaults = themeToCssVars\(THINGTIME_THEME\)/u);
});

test('ThemeHost waits for hydration before overwriting the pre-paint snapshot', async () => {
  // The other half of the two-tier contract the pet vars above rely on.
  // tt-boot.js applies the stored snapshot inline pre-paint; ThemeHost then
  // re-applies vars from `theme`, which is the built-in DEFAULT until the
  // localforage blob resolves. Writing during that window overwrites the
  // snapshot at inline priority, so a pet-off (or custom-theme) user paints
  // correctly, flips to the defaults for the length of hydration, then flips
  // back — precisely the flash --tt-pet-display exists to prevent. Worse, the
  // debounced snapshot write would persist those defaults and carry the flash
  // into the next load.
  const source = await readFile(new URL('../components/ThemeSettings/ThemeHost.tsx', import.meta.url), 'utf8');
  const effect = source.slice(source.indexOf('const vars = React.useMemo'));

  const guard = effect.indexOf('if (loading) return;');

  assert.ok(guard >= 0, 'the var-writing effect must bail out while thingtime is still hydrating');
  // and the guard has to be a dependency, or the write never lands once
  // hydration finishes on an otherwise unchanged theme
  assert.match(effect, /\}, \[vars, loading\]\);/u);
  // ...ahead of both the inline write and the debounced snapshot write, since
  // either one alone is enough to reintroduce the flash
  assert.ok(guard < effect.indexOf('root.style.setProperty'), 'the guard must precede the inline var write');
  assert.ok(guard < effect.indexOf('TT_THEME_SNAPSHOT_KEY'), 'the guard must precede the snapshot write');
});
