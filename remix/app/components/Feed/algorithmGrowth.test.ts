import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { GROWTH_STAGES, crossedGrowthStage, growthStageFor, nextGrowthStage } from './algorithmGrowth.ts';

test('stages ladder matches the design mockup thresholds', () => {
	assert.deepEqual(
		GROWTH_STAGES.map((stage) => [stage.min, stage.emoji]),
		[
			[0, '🥚'],
			[100, '🐣'],
			[500, '🐥'],
			[2000, '🧠']
		]
	);
});

test('growthStageFor picks the stage by boundary, inclusive at min', () => {
	const expectations: Array<[number, string]> = [
		[0, 'Egg'],
		[99, 'Egg'],
		[100, 'Hatching'],
		[499, 'Hatching'],
		[500, 'Fledgling'],
		[1999, 'Fledgling'],
		[2000, 'Thinking'],
		[1_000_000, 'Thinking']
	];
	for (const [signals, name] of expectations) {
		assert.equal(growthStageFor(signals).name, name, `${signals} signals`);
	}
});

test('garbage signal counts clamp to the egg', () => {
	for (const junk of [-5, NaN, Infinity * -1, undefined, null, 'many' as any]) {
		assert.equal(growthStageFor(junk).name, 'Egg', String(junk));
	}
	// non-integer counts floor rather than round up across a boundary
	assert.equal(growthStageFor(99.9).name, 'Egg');
});

test('nextGrowthStage climbs the ladder and tops out at 🧠', () => {
	assert.equal(nextGrowthStage(0)?.name, 'Hatching');
	assert.equal(nextGrowthStage(150)?.name, 'Fledgling');
	assert.equal(nextGrowthStage(600)?.name, 'Thinking');
	assert.equal(nextGrowthStage(5000), null);
});

test('crossedGrowthStage fires only when a boundary is crossed', () => {
	assert.equal(crossedGrowthStage(90, 99), null);
	assert.equal(crossedGrowthStage(99, 100)?.name, 'Hatching');
	assert.equal(crossedGrowthStage(95, 120)?.name, 'Hatching');
	// a big batch can leap a whole stage — the toast celebrates where it landed
	assert.equal(crossedGrowthStage(90, 600)?.name, 'Fledgling');
	assert.equal(crossedGrowthStage(100, 499), null);
	assert.equal(crossedGrowthStage(2000, 9000), null);
	// signals never shrink, but a regression must not celebrate
	assert.equal(crossedGrowthStage(600, 90), null);
});
