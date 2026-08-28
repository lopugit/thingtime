import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	DEFAULT_THEME_SETTINGS,
	hasTryOnSnapshot,
	isWearingTryOn,
	restoredThemeSettings,
	shouldCaptureTryOnSnapshot,
	tryOnSnapshotFor
} from './themeTryOnCore.ts';

const OWNER_THEME = { id: 'theme_owner', name: 'Sunset' };
const ownLook = { preset: 'Thingtime', overrides: { colors: { bg: '#123456' } }, custom: { 'windows.close': { classes: 'x' } } };
const borrowed = (shareId: string) => ({ preset: 'Thingtime', overrides: {}, appliedThemeShareId: shareId, custom: {} });

test('a visitor already wearing a shared theme still gets their look snapshotted', () => {
	// Share links, the theme gallery and ThemeHost cross-device pickup all set
	// appliedThemeShareId, so gating the capture on "no share id" skipped the
	// snapshot for exactly the theme-wearing users this feature is aimed at —
	// and take-off then dropped them to stock defaults.
	const wearingGalleryTheme = borrowed('theme_gallery');
	assert.equal(shouldCaptureTryOnSnapshot(undefined), true);

	const snapshot = wearingGalleryTheme;
	assert.deepEqual(restoredThemeSettings(snapshot, borrowed(OWNER_THEME.id)), { ...wearingGalleryTheme, custom: {} });
});

test('hopping profile to profile keeps the original snapshot', () => {
	// Second try-on while a run is open: the snapshot is already held, so the
	// borrowed theme must not become the revert target.
	assert.equal(shouldCaptureTryOnSnapshot(ownLook), false);
	assert.deepEqual(restoredThemeSettings(ownLook, borrowed('theme_second')), { ...ownLook, custom: {} });
});

test('wearing the same theme as the owner is not a try-on', () => {
	// No snapshot held — the visitor applied this theme themselves, so the chip
	// must offer "try it on", never a take-off that would reset their look.
	assert.equal(
		isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: borrowed(OWNER_THEME.id), snapshot: undefined }),
		false
	);
	assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: borrowed(OWNER_THEME.id), snapshot: ownLook }), true);
});

test('the chip only claims a take-off for the theme actually applied', () => {
	assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: borrowed('theme_other'), snapshot: ownLook }), false);
	assert.equal(isWearingTryOn({ wornTheme: null, currentTheme: borrowed(OWNER_THEME.id), snapshot: ownLook }), false);
	assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: ownLook, snapshot: ownLook }), false);
});

test('take-off restores the snapshot and survives a lost one', () => {
	assert.deepEqual(restoredThemeSettings(ownLook, borrowed(OWNER_THEME.id)), { ...ownLook, custom: {} });
	assert.deepEqual(restoredThemeSettings(null, { preset: 'Thingtime', overrides: {} }), DEFAULT_THEME_SETTINGS);
});

test('personal custom classes/CSS survive a take-off', () => {
	// custom is orthogonal to themes (applyThemeDoc and setPreset both carry it),
	// so neither restore path may quietly wipe it.
	const liveCustom = { 'windows.close': { classes: 'sparkle' } };
	assert.deepEqual(restoredThemeSettings(ownLook, { ...borrowed(OWNER_THEME.id), custom: liveCustom }).custom, liveCustom);
	assert.deepEqual(restoredThemeSettings(null, { ...borrowed(OWNER_THEME.id), custom: liveCustom }), {
		...DEFAULT_THEME_SETTINGS,
		custom: liveCustom
	});
	// The stock fallback is never handed out as a shared mutable object.
	assert.notEqual(restoredThemeSettings(null, null), DEFAULT_THEME_SETTINGS);
});

test('a stored snapshot is always closable, even with no theme settings yet', () => {
	// A nullish snapshot would read back as "no run open" and strand a visitor
	// in the borrowed theme with no working take-off.
	for (const empty of [null, undefined, 'nonsense', []]) {
		const stored = tryOnSnapshotFor(empty);
		assert.deepEqual(stored, DEFAULT_THEME_SETTINGS);
		assert.equal(hasTryOnSnapshot(stored), true);
		assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: borrowed(OWNER_THEME.id), snapshot: stored }), true);
	}
	assert.deepEqual(tryOnSnapshotFor(ownLook), ownLook);
	assert.notEqual(tryOnSnapshotFor(ownLook), ownLook);
});

test('only a plain settings object counts as a snapshot', () => {
	for (const value of [null, undefined, 'theme', 7, [], [ownLook]]) {
		assert.equal(hasTryOnSnapshot(value), false);
		assert.equal(shouldCaptureTryOnSnapshot(value), true);
		assert.equal(isWearingTryOn({ wornTheme: OWNER_THEME, currentTheme: borrowed(OWNER_THEME.id), snapshot: value }), false);
	}
	assert.equal(hasTryOnSnapshot({}), true);
	assert.equal(hasTryOnSnapshot(ownLook), true);
});
