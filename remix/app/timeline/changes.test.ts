import assert from 'node:assert/strict';
import test from 'node:test';
import { timelineChanges, timelineDisplayChanges, timelineChangeLabel, timelineValueLabel } from './changes.ts';
import type { TimelineSnapshot } from './contract.ts';
const snapshot = (value: any): TimelineSnapshot => ({ adapter: 'thing-content', version: 1, value });

test('change cards distinguish missing, null, false, zero and empty strings', () => {
	const changes = timelineChanges(
		snapshot({ crystal: { a: false, b: 0, c: '', d: null } }),
		snapshot({ crystal: { a: true, b: 1, c: null, added: '' } })
	);
	assert.equal(changes.length, 5);
	assert.deepEqual(
		changes.map((change) => [timelineChangeLabel(change.path), timelineValueLabel(change.before), timelineValueLabel(change.after)]),
		[
			['a', 'Off', 'On'],
			['b', '0', '1'],
			['c', 'Empty text', 'Empty'],
			['d', 'Empty', 'Not set'],
			['added', 'Not set', 'Empty text']
		]
	);
});

test('large programs remain bounded and structural changes are still represented', () => {
	const old: any = { crystal: { program: Object.fromEntries(Array.from({ length: 5000 }, (_, n) => [`key${n}`, n])) } };
	const next = structuredClone(old);
	next.crystal.program.key4999 = 'Changed';
	const changes = timelineChanges(snapshot(old), snapshot(next));
	assert.equal(changes.length, 1);
	assert.deepEqual(changes[0].path, ['crystal', 'program']);
	assert.equal(timelineChanges(snapshot(old), snapshot(old)).length, 0);
});

test('page presentation explains component props by stable block identity while merge arrays remain atomic', () => {
	const a = snapshot({
		thingtime: ['webpage'],
		crystal: {
			blocks: [
				{ id: 'hero', type: 'component', args: { color: 'blue' } },
				{ id: 'footer', type: 'heading', text: 'End' }
			]
		}
	});
	const b = snapshot({
		thingtime: ['webpage'],
		crystal: {
			blocks: [
				{ id: 'footer', type: 'heading', text: 'End' },
				{ id: 'hero', type: 'component', args: { color: 'green' } }
			]
		}
	});
	assert.equal(timelineChanges(a, b).length, 1);
	assert.deepEqual(
		timelineDisplayChanges(a, b).map((change) => change.path),
		[
			['crystal', 'blocks', 'order'],
			['crystal', 'blocks', 'hero', 'args', 'color']
		]
	);
	assert.deepEqual(timelineDisplayChanges(a, b)[1].before, { exists: true, value: 'blue' });
	const dataA = snapshot({ ...(a.value as any), thingtime: ['data'] });
	const dataB = snapshot({ ...(b.value as any), thingtime: ['data'] });
	assert.deepEqual(timelineDisplayChanges(dataA, dataB), timelineChanges(dataA, dataB));
});

test('ambiguous duplicate ids and large block trees keep a bounded structural change', () => {
	const a = snapshot({
		thingtime: ['webpage'],
		crystal: {
			blocks: [
				{ id: 'same', text: 'a' },
				{ id: 'same', text: 'b' }
			]
		}
	});
	const b = snapshot({
		thingtime: ['webpage'],
		crystal: {
			blocks: [
				{ id: 'same', text: 'c' },
				{ id: 'same', text: 'd' }
			]
		}
	});
	assert.deepEqual(timelineDisplayChanges(a, b), timelineChanges(a, b));
});
