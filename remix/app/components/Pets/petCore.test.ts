import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PET_DEVKIT_CLEARANCE, petAnimation, petInset, petMotionEnabled, petMounted, petVisible } from './petCore';

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

test('the pet stays absent until the stored Pet switch is actually readable', () => {
	// the whole point: while thingtime is still restoring, every setting reads
	// as its default, so mounting on it flashes the pet at the users who
	// switched it off. Nothing mounts until loading resolves.
	assert.equal(petMounted(true, { pet: false }), false);
	assert.equal(petMounted(true, { pet: true }), false);
	assert.equal(petMounted(true, undefined), false);

	// once restored, it is exactly the Pet switch again
	assert.equal(petMounted(false, { pet: true }), true);
	assert.equal(petMounted(false, { pet: false }), false);
	assert.equal(petMounted(false, {}), true);
	assert.equal(petMounted(false, undefined), true);
	assert.equal(petMounted(false, null), true);
});

test('a missing loading flag means "not loading", not "never show the pet"', () => {
	// outside a ThingtimeProvider (embeds, harnesses) loading is absent — the
	// pet must not be permanently suppressed by a signal that never arrives
	assert.equal(petMounted(undefined, { pet: true }), true);
	assert.equal(petMounted(null, { pet: true }), true);
	// but an explicit off still wins
	assert.equal(petMounted(undefined, { pet: false }), false);
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
