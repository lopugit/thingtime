import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
	addLopuQueueMessage,
	bindLopuQueue,
	drainLopuQueue,
	editLopuQueue,
	getLopuQueue,
	pauseLopuQueue,
	planLopuQueueBatch
} from './lopuQueueStore';
beforeEach(() => {
	bindLopuQueue(null);
	bindLopuQueue('owner');
});
const add = (text: string, chat = 'chat') => addLopuQueueMessage(chat, text, { settings: { model: 'model' } });
test('three messages default to one ordered batch; unchecked items create reply boundaries', () => {
	add('one');
	add('two');
	add('three');
	assert.equal(planLopuQueueBatch(getLopuQueue().items, 'chat')?.text, 'one\n\ntwo\n\nthree');
	editLopuQueue(getLopuQueue().items[1].id, { together: false });
	assert.equal(planLopuQueueBatch(getLopuQueue().items, 'chat')?.text, 'one');
	assert.equal(planLopuQueueBatch(getLopuQueue().items.slice(1), 'chat')?.text, 'two');
});
test('arrows and drag reorder only the intended chat and removal preserves others', () => {
	add('one');
	add('elsewhere', 'other');
	add('two');
	add('three');
	editLopuQueue(getLopuQueue().items[3].id, { direction: -1 });
	assert.equal(planLopuQueueBatch(getLopuQueue().items, 'chat')?.text, 'one\n\nthree\n\ntwo');
	const [one, , three] = getLopuQueue().items;
	editLopuQueue(three.id, { before: one.id });
	editLopuQueue(one.id, { remove: true });
	assert.equal(planLopuQueueBatch(getLopuQueue().items, 'chat')?.text, 'three\n\ntwo');
	assert.equal(planLopuQueueBatch(getLopuQueue().items, 'other')?.text, 'elsewhere');
});
test('uncertain delivery retains immutable identity and payload, locks edits and pauses', async () => {
	add('one');
	add('two');
	const calls: any[] = [];
	await drainLopuQueue('chat', async (text, options) => {
		const { onAccepted: _accepted, ...payload } = options;
		calls.push({ text, options: payload });
		throw new Error('offline');
	});
	assert.equal(getLopuQueue().paused, true);
	editLopuQueue(getLopuQueue().items[0].id, { remove: true });
	assert.equal(getLopuQueue().items.length, 2);
	add('three');
	pauseLopuQueue(false);
	await drainLopuQueue('chat', async (text, options) => {
		const { onAccepted: _accepted, ...payload } = options;
		calls.push({ text, options: payload });
		return { ok: true };
	});
	assert.deepEqual(calls[0], calls[1]);
	assert.deepEqual(
		getLopuQueue().items.map((item) => item.text),
		['three']
	);
});
test('concurrent drains send once and old-account completions cannot consume new-account messages', async () => {
	add('one');
	let release!: (value: any) => void;
	let calls = 0;
	const send = async () => {
		calls++;
		return new Promise((resolve) => {
			release = resolve;
		});
	};
	const pending = drainLopuQueue('chat', send);
	await drainLopuQueue('chat', send);
	assert.equal(calls, 1);
	bindLopuQueue('other');
	add('new');
	release({ ok: true });
	await pending;
	assert.equal(getLopuQueue().items[0].text, 'new');
});
test('batch respects wire text limit and snapshots model/context choices', () => {
	add('x'.repeat(7999));
	add('y');
	assert.equal(planLopuQueueBatch(getLopuQueue().items, 'chat')?.ids.length, 1);
	bindLopuQueue('fresh');
	add('one');
	addLopuQueueMessage('chat', 'two', { settings: { model: 'different' } });
	assert.equal(planLopuQueueBatch(getLopuQueue().items, 'chat')?.ids.length, 1);
});

test('accepted messages leave the queue immediately; interrupted replies cannot replay them', async () => {
	add('first');
	let reject!: (error: Error) => void;
	const pending = drainLopuQueue('chat', async (_text, options) => {
		options.onAccepted?.();
		return new Promise((_resolve, fail) => {
			reject = fail;
		});
	});
	assert.equal(getLopuQueue().items.length, 0);
	assert.equal(getLopuQueue().batch, null);
	assert.equal(getLopuQueue().busy, true);
	add('next');
	let calls = 0;
	await drainLopuQueue('chat', async () => {
		calls++;
		return { ok: true };
	});
	assert.equal(calls, 0, 'acceptance must not release the active reply lock');
	reject(new Error('reply interrupted'));
	await pending;
	assert.equal(getLopuQueue().paused, true);
	pauseLopuQueue(false);
	await drainLopuQueue('chat', async (text) => {
		assert.equal(text, 'next');
		return { ok: true };
	});
	assert.equal(getLopuQueue().items.length, 0);
});

test('old-account acceptance cannot clear or unlock the new account queue', async () => {
	add('old');
	let accept!: () => void;
	let release!: (result: any) => void;
	const pending = drainLopuQueue('chat', async (_text, options) => {
		accept = options.onAccepted!;
		return new Promise((resolve) => {
			release = resolve;
		});
	});
	bindLopuQueue('new-owner');
	add('new');
	accept();
	release({ ok: true });
	await pending;
	assert.equal(getLopuQueue().items[0].text, 'new');
});
