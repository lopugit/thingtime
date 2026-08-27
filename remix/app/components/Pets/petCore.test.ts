import assert from 'node:assert/strict';
import test from 'node:test';

import { petAnimation, petInset, petMotionEnabled } from './petCore';

test('decorative motion follows the theme switch and defaults to on', () => {
	assert.equal(petMotionEnabled({ motion: true }), true);
	assert.equal(petMotionEnabled({ motion: false }), false);
	// an absent or not-yet-hydrated theme must not freeze the pet
	assert.equal(petMotionEnabled({}), true);
	assert.equal(petMotionEnabled(undefined), true);
	assert.equal(petMotionEnabled(null), true);
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
