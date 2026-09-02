import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PET_DEVKIT_CLEARANCE, petAnimation, petDisplay, petInset, petMotionEnabled, petVisible } from './petCore';

test('decorative motion follows the theme switch and defaults to on', () => {
	assert.equal(petMotionEnabled({ motion: true }), true);
	assert.equal(petMotionEnabled({ motion: false }), false);
	// an absent or not-yet-hydrated theme must not freeze the pet
	assert.equal(petMotionEnabled({}), true);
	assert.equal(petMotionEnabled(undefined), true);
	assert.equal(petMotionEnabled(null), true);
});

test('the pet can be switched off entirely, and defaults to on', () => {
	assert.equal(petVisible({ pet: true }), true);
	assert.equal(petVisible({ pet: false }), false);
	// a theme that predates the switch, or one that hasn't hydrated, keeps the
	// pet rather than flashing it away on first paint
	assert.equal(petVisible({}), true);
	assert.equal(petVisible(undefined), true);
	assert.equal(petVisible(null), true);
});

test('first-paint visibility comes from the pre-paint var, not from JS', () => {
	// The Pet switch decides what the FIRST paint looks like, and theme.general
	// is Tier 2 (the async localforage blob), which AI_ALL.md says cannot seed a
	// first render. So the switch has to arrive as a var that tt-boot.js can
	// reapply pre-paint — deriving this from theme state would reintroduce
	// exactly the flash (or the pop-in) the two tiers exist to prevent.
	assert.equal(petDisplay(), 'var(--tt-pet-display, block)');
});

test('the pre-paint var falls back to visible when there is no snapshot', () => {
	// a first-ever visit has no tt-theme-vars yet, and localStorage can be off
	// entirely (private mode) — the pet must default on rather than vanish
	const [, name, fallback] = /^var\((--tt-[\w-]+), (.+)\)$/u.exec(petDisplay()) ?? [];

	assert.equal(name, '--tt-pet-display');
	assert.equal(fallback, 'block');
});

test('the pet unmounts only on a stored off, never on the hydration default', () => {
	// the second tier: once the stored answer is readable, an off pet leaves the
	// DOM entirely. Defaulting to on is what makes the ordering safe — React
	// must never rip out a pet the pre-paint snapshot had already painted.
	assert.equal(petVisible({ pet: false }), false);
	assert.equal(petVisible({ pet: true }), true);
	// the pre-hydration default, and a theme predating the key
	assert.equal(petVisible({}), true);
	assert.equal(petVisible(undefined), true);
});

test('visibility and motion are independent switches', () => {
	// motion off means "still pet", not "no pet" — the two controls answer
	// different questions and must not collapse into one
	assert.equal(petVisible({ pet: true, motion: false } as { pet?: boolean }), true);
	assert.equal(petMotionEnabled({ pet: false, motion: true } as { motion?: boolean }), true);
});

test('animations are dropped entirely when motion is off', () => {
	const float = 'lopuuu-float 4.8s ease-in-out infinite';

	assert.equal(petAnimation(float, true), float);
	// undefined, not 'none': Chakra then emits no animation declaration at all
	assert.equal(petAnimation(float, false), undefined);
});

test('insets clear the device safe area on both axes', () => {
	assert.equal(petInset(16, 'bottom'), 'calc(16px + var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px)))');
	assert.equal(petInset(24, 'bottom'), 'calc(24px + var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px)))');
	assert.equal(petInset(12, 'right'), 'calc(12px + var(--thingtime-safe-area-right, env(safe-area-inset-right, 0px)))');
});

test('the pet stays off the DevKit bubble in the bottom-right corner', () => {
	// DevKit.tsx pins a 52px round trigger at safe-area-right + 20px, and shows
	// it whenever the deploy env is not production — so every preview build and
	// every local dev session. A pet in the raw corner renders underneath it.
	const devKitTriggerReach = 20 + 52;

	assert.ok(
		PET_DEVKIT_CLEARANCE >= devKitTriggerReach,
		`a ${PET_DEVKIT_CLEARANCE}px right inset overlaps the DevKit trigger, which reaches ${devKitTriggerReach}px in from the edge`
	);
	// the same clearance InspectorReopenPill already uses for this exact corner
	assert.equal(petInset(PET_DEVKIT_CLEARANCE, 'right'), 'calc(84px + var(--thingtime-safe-area-right, env(safe-area-inset-right, 0px)))');
});

test('the pet renders at the DevKit-clearing inset, not the raw corner', async () => {
	const source = await readFile(new URL('./LopuuuPet.tsx', import.meta.url), 'utf8');

	// the constant is only worth having if the component actually reads it —
	// a literal right={petInset(24, 'right')} would silently reintroduce the
	// overlap while this file's arithmetic kept passing
	assert.match(source, /right=\{petInset\(PET_DEVKIT_CLEARANCE, 'right'\)\}/u);
});

test('the pet spends the pre-paint var on display, and reads no async tier', async () => {
	const source = await readFile(new URL('./LopuuuPet.tsx', import.meta.url), 'utf8');

	// the var is only worth writing if the component actually applies it
	assert.match(source, /display=\{petDisplay\(\)\}/u);
	// and the regression that would undo all of it: gating the pet on the
	// localforage blob's hydration flag again, which cannot seed a first render
	assert.doesNotMatch(source, /\bloading\b/u, 'the pet must not gate its first paint on Tier-2 hydration');
});
