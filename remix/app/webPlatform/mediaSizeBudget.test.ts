import assert from 'node:assert/strict';
import test from 'node:test';
import { initialVideoBudget, nextVideoBudget } from './mediaSizeBudget';

test('duration budget reserves space for retained audio and mux bytes', () => {
	const maximum = 250000,
		duration = 10;
	const budget = initialVideoBudget(duration, 1500000, 96000, maximum);
	assert.ok(budget.audioBitrate > 0);
	assert.ok(((budget.videoBitrate + budget.audioBitrate) * duration) / 8 < maximum * 0.9);
	assert.deepEqual(initialVideoBudget(duration, 1500000, 96000), { videoBitrate: 1500000, audioBitrate: 96000 });
	assert.equal(initialVideoBudget(duration, 1500000, 0, maximum).audioBitrate, 0);
	assert.throws(() => initialVideoBudget(1000, 1500000, 96000, 1));
});

test('actual overshoot lowers complete-track budgets and even dimensions without dropping audio', () => {
	const current = { videoBitrate: 100000, audioBitrate: 32000, width: 1920, height: 1080 };
	const next = nextVideoBudget(current, 300000, 100000);
	assert.ok(next.videoBitrate < current.videoBitrate);
	assert.ok(next.audioBitrate > 0 && next.audioBitrate < current.audioBitrate);
	assert.ok(next.width < current.width && next.width % 2 === 0);
	assert.ok(next.height < current.height && next.height % 2 === 0);
	for (const bad of [undefined, NaN, Infinity, -1, 0]) assert.throws(() => nextVideoBudget(current, bad as number, 100000));
});

test('retry requires an explicit normalized maximum',()=>{ assert.throws(()=>nextVideoBudget({videoBitrate:1,audioBitrate:0,width:2,height:2},2,undefined as any)); });
