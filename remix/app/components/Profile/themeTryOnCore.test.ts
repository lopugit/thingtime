import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { DEFAULT_THEME_SETTINGS, isWearingTryOn, nextTryOnRun, openTryOnRun, restoredThemeSettings } from './themeTryOnCore.ts';

const OWNER_THEME = { id: 'theme_owner', name: 'Sunset' };
const ownLook = { preset: 'Thingtime', overrides: { colors: { bg: '#123456' } }, custom: { 'windows.close': { classes: 'x' } } };
const borrowed = (shareId: string) => ({ preset: 'Thingtime', overrides: {}, appliedThemeShareId: shareId, custom: {} });
/** An open run: holding `settings`, currently borrowing `shareId`. */
const run = (settings: unknown, shareId: string) => ({ settings, borrowedShareId: shareId });

test('a visitor already wearing a shared theme still gets their look snapshotted', () => {
	// Share links, the theme gallery and ThemeHost cross-device pickup all set
	// appliedThemeShareId, so gating the capture on "no share id" skipped the
	// snapshot for exactly the theme-wearing users this feature is aimed at —
	// and take-off then dropped them to stock defaults.
	const wearingGalleryTheme = borrowed('theme_gallery');
	const started = nextTryOnRun(undefined, wearingGalleryTheme, OWNER_THEME.id);

	assert.deepEqual(started, run(wearingGalleryTheme, OWNER_THEME.id));
	assert.deepEqual(restoredThemeSettings(started, borrowed(OWNER_THEME.id)), { ...wearingGalleryTheme, custom: {} });
});

test('hopping profile to profile keeps the original snapshot', () => {
	// Second try-on while a run is open: the held look must survive, and only
	// the borrowed id advances, so the borrowed theme never becomes the revert
	// target.
	const open = run(ownLook, OWNER_THEME.id);
	const hopped = nextTryOnRun(open, borrowed(OWNER_THEME.id), 'theme_second');

	assert.deepEqual(hopped, run(ownLook, 'theme_second'));
	assert.deepEqual(restoredThemeSettings(hopped, borrowed('theme_second')), { ...ownLook, custom: {} });
});

test('a run ends when the visitor moves to a look of their own', () => {
	// The regression this shape exists to prevent. Try on a theme, KEEP it (the
	// toast invites exactly that), then adopt a look of your own — a saved
	// theme, or a plain preset. Trying on a LATER profile must snapshot the
	// look you actually had, not resurrect the pre-run one and discard it.
	const abandoned = run(ownLook, 'theme_first');
	const ownSavedTheme = borrowed('theme_mine');
	const plainPreset = { preset: 'Ocean', overrides: {}, custom: {} };

	for (const current of [ownSavedTheme, plainPreset]) {
		assert.equal(openTryOnRun(abandoned, current), null);
		assert.equal(isWearingTryOn({ wornTheme: { id: 'theme_first', name: 'First' }, currentTheme: current, run: abandoned }), false);

		const restarted = nextTryOnRun(abandoned, current, 'theme_third');
		assert.deepEqual(restarted, run(current, 'theme_third'));
		assert.deepEqual(restoredThemeSettings(restarted, borrowed('theme_third')), { ...current, custom: {} });
	}
});

test('wearing the same theme as the owner is not a try-on', () => {
	// No run held — the visitor applied this theme themselves, so the chip must
	// offer "try it on", never a take-off that would reset their look.
	assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: borrowed(OWNER_THEME.id), run: undefined }), false);
	assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: borrowed(OWNER_THEME.id), run: run(ownLook, OWNER_THEME.id) }), true);
});

test('the chip only claims a take-off for the theme actually applied', () => {
	assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: borrowed('theme_other'), run: run(ownLook, OWNER_THEME.id) }), false);
	assert.equal(isWearingTryOn({ wornTheme: null, currentTheme: borrowed(OWNER_THEME.id), run: run(ownLook, OWNER_THEME.id) }), false);
	assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: ownLook, run: run(ownLook, OWNER_THEME.id) }), false);
});

test('take-off restores the held look and survives a lost run', () => {
	assert.deepEqual(restoredThemeSettings(run(ownLook, OWNER_THEME.id), borrowed(OWNER_THEME.id)), { ...ownLook, custom: {} });
	assert.deepEqual(restoredThemeSettings(null, { preset: 'Thingtime', overrides: {} }), DEFAULT_THEME_SETTINGS);
});

test('personal custom classes/CSS survive a take-off', () => {
	// custom is orthogonal to themes (applyThemeDoc and setPreset both carry it),
	// so neither restore path may quietly wipe it.
	const liveCustom = { 'windows.close': { classes: 'sparkle' } };
	assert.deepEqual(restoredThemeSettings(run(ownLook, OWNER_THEME.id), { ...borrowed(OWNER_THEME.id), custom: liveCustom }).custom, liveCustom);
	assert.deepEqual(restoredThemeSettings(null, { ...borrowed(OWNER_THEME.id), custom: liveCustom }), {
		...DEFAULT_THEME_SETTINGS,
		custom: liveCustom
	});
	// The stock fallback is never handed out as a shared mutable object.
	assert.notEqual(restoredThemeSettings(null, null), DEFAULT_THEME_SETTINGS);
});

test('a started run is always closable, even with no theme settings yet', () => {
	// A nullish held look would read back as "no run open" and strand a visitor
	// in the borrowed theme with no working take-off.
	for (const empty of [null, undefined, 'nonsense', []]) {
		const started = nextTryOnRun(undefined, empty, OWNER_THEME.id);
		assert.deepEqual(started, run(DEFAULT_THEME_SETTINGS, OWNER_THEME.id));
		assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: borrowed(OWNER_THEME.id), run: started }), true);
		assert.deepEqual(restoredThemeSettings(started, borrowed(OWNER_THEME.id)), { ...DEFAULT_THEME_SETTINGS, custom: {} });
	}
	// and the held look is a copy — never a live alias of settings.theme
	const captured = nextTryOnRun(undefined, ownLook, OWNER_THEME.id);
	assert.deepEqual(captured.settings, ownLook);
	assert.notEqual(captured.settings, ownLook);
});

test('only a well-formed run counts as a run', () => {
	// Junk, and the bare settings object an earlier build persisted, both read
	// as "no run": the next try-on captures the CURRENT look instead of
	// restoring the visitor to something unrelated.
	const legacySnapshot = ownLook;
	for (const value of [null, undefined, 'theme', 7, [], [ownLook], {}, legacySnapshot, run(ownLook, ''), run('nope', 'theme_x')]) {
		assert.equal(openTryOnRun(value, borrowed(OWNER_THEME.id)), null);
		assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: borrowed(OWNER_THEME.id), run: value }), false);
		assert.deepEqual(nextTryOnRun(value, ownLook, OWNER_THEME.id), run(ownLook, OWNER_THEME.id));
	}
});
