import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { createThingtimeSyncChannel } from './thingtimeSyncChannel.ts';

const serialize = (value: any) => JSON.stringify(value);
const parse = (text: string) => JSON.parse(text);

const nextMessage = <T>(register: (resolve: (value: T) => void) => void, timeoutMs = 1_000): Promise<T> =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timed out waiting for a sync message')), timeoutMs);
		register((value) => {
			clearTimeout(timer);
			resolve(value);
		});
	});

test('a write published in one tab arrives in another tab with the same path and value', async () => {
	let deliver: ((update: { path: any; value: any }) => void) | null = null;
	const receiver = createThingtimeSyncChannel({
		tabId: 'tab-b',
		serialize,
		parse,
		onRemoteWrite: (path, value) => deliver?.({ path, value })
	});
	const sender = createThingtimeSyncChannel({
		tabId: 'tab-a',
		serialize,
		parse,
		onRemoteWrite: () => assert.fail('the sender must not apply its own write')
	});
	assert.ok(receiver && sender, 'BroadcastChannel should exist in the Node test runtime');

	const received = nextMessage<{ path: any; value: any }>((resolve) => {
		deliver = resolve;
	});
	sender!.publish(['settings', 'drawer', 'width'], 420);

	assert.deepEqual(await received, { path: ['settings', 'drawer', 'width'], value: 420 });
	sender!.close();
	receiver!.close();
});

test('a tab ignores its own broadcasts (no echo loop)', async () => {
	const applied: any[] = [];
	const channel = createThingtimeSyncChannel({
		tabId: 'same-tab',
		serialize,
		parse,
		onRemoteWrite: (path, value) => applied.push({ path, value })
	});
	const impostor = new BroadcastChannel('thingtime');
	impostor.postMessage({
		type: 'tt-write',
		path: 'settings.theme',
		payload: serialize({ v: 'dark' }),
		sourceTabId: 'same-tab',
		timestamp: 1
	});
	// Give the (ignored) message a real chance to be delivered first.
	await new Promise((resolve) => setTimeout(resolve, 50));

	assert.deepEqual(applied, []);
	impostor.close();
	channel!.close();
});

test('malformed and foreign messages are ignored without applying anything', async () => {
	const applied: any[] = [];
	const channel = createThingtimeSyncChannel({
		tabId: 'tab-x',
		serialize,
		parse,
		onRemoteWrite: (path, value) => applied.push({ path, value })
	});
	const impostor = new BroadcastChannel('thingtime');
	impostor.postMessage(null);
	impostor.postMessage({ type: 'something-else' });
	impostor.postMessage({ type: 'tt-write', path: 'a', payload: 'not-json{', sourceTabId: 'other', timestamp: 1 });
	await new Promise((resolve) => setTimeout(resolve, 50));

	assert.deepEqual(applied, []);
	impostor.close();
	channel!.close();
});

test('close() stops publishing and applying', async () => {
	const applied: any[] = [];
	const receiver = createThingtimeSyncChannel({
		tabId: 'tab-b',
		serialize,
		parse,
		onRemoteWrite: (path, value) => applied.push({ path, value })
	});
	const sender = createThingtimeSyncChannel({
		tabId: 'tab-a',
		serialize,
		parse,
		onRemoteWrite: () => {}
	});
	receiver!.close();
	sender!.publish('settings.theme', 'dark');
	sender!.close();
	sender!.publish('settings.theme', 'light');
	await new Promise((resolve) => setTimeout(resolve, 50));

	assert.deepEqual(applied, []);
});

test('undefined values survive the payload wrapper', async () => {
	let deliver: ((update: { path: any; value: any }) => void) | null = null;
	const receiver = createThingtimeSyncChannel({
		tabId: 'tab-b',
		serialize,
		parse,
		onRemoteWrite: (path, value) => deliver?.({ path, value })
	});
	const sender = createThingtimeSyncChannel({
		tabId: 'tab-a',
		serialize,
		parse,
		onRemoteWrite: () => {}
	});

	const received = nextMessage<{ path: any; value: any }>((resolve) => {
		deliver = resolve;
	});
	sender!.publish('settings.gone', undefined);

	assert.deepEqual(await received, { path: 'settings.gone', value: undefined });
	sender!.close();
	receiver!.close();
});
