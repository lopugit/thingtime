import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test through the tsx loader.
import { stringifyThingtime } from './thingtimeSerialization.ts';
// @ts-ignore Node executes this TypeScript test through the tsx loader.
import { createThingtimeSyncChannel } from './thingtimeSyncChannel.ts';

let channelSequence = 0;
const uniqueChannelName = (): string => `thingtime-test-${process.pid}-${channelSequence++}`;
const settleMessages = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

const nextMessage = <T>(register: (resolve: (value: T) => void) => void, timeoutMs = 1_000): Promise<T> =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timed out waiting for a sync message')), timeoutMs);
		register((value) => {
			clearTimeout(timer);
			resolve(value);
		});
	});

test('a write published in one tab arrives in another with the same path and value', async () => {
	const channelName = uniqueChannelName();
	let deliver: ((update: { path: any; value: any }) => void) | null = null;
	const receiver = createThingtimeSyncChannel({
		tabId: 'tab-b',
		channelName,
		onRemoteWrite: (path, value) => deliver?.({ path, value })
	});
	const sender = createThingtimeSyncChannel({
		tabId: 'tab-a',
		channelName,
		onRemoteWrite: () => assert.fail('the sender must not apply its own write')
	});
	assert.ok(receiver && sender, 'BroadcastChannel should exist in the Node test runtime');

	try {
		const received = nextMessage<{ path: any; value: any }>((resolve) => {
			deliver = resolve;
		});
		sender.publish(['settings', 'drawer', 'width'], 420);

		assert.deepEqual(await received, { path: ['settings', 'drawer', 'width'], value: 420 });
	} finally {
		sender.close();
		receiver.close();
	}
});

test('the active safe serializer preserves data types and strips runtime functions', async () => {
	const channelName = uniqueChannelName();
	let deliver: ((value: any) => void) | null = null;
	const receiver = createThingtimeSyncChannel({
		tabId: 'tab-b',
		channelName,
		onRemoteWrite: (_path, value) => deliver?.(value)
	});
	const sender = createThingtimeSyncChannel({ tabId: 'tab-a', channelName, onRemoteWrite: () => {} });
	assert.ok(receiver && sender);

	const instant = '2026-01-01T00:00:00.000Z';
	const value: Record<string, any> = {
		date: new Date(instant),
		userText: instant,
		handler: () => 'runtime only'
	};
	value.self = value;

	try {
		const received = nextMessage<any>((resolve) => {
			deliver = resolve;
		});
		sender.publish('settings.safeCodec', value);
		const parsed = await received;

		assert.ok(parsed.date instanceof Date);
		assert.equal(parsed.date.toISOString(), instant);
		assert.equal(parsed.userText, instant);
		assert.equal(parsed.self, parsed);
		assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'handler'), false);
	} finally {
		sender.close();
		receiver.close();
	}
});

test('a tab ignores messages carrying its own source id', async () => {
	const channelName = uniqueChannelName();
	const applied: any[] = [];
	const receiver = createThingtimeSyncChannel({
		tabId: 'same-tab',
		channelName,
		onRemoteWrite: (path, value) => applied.push({ path, value })
	});
	const sender = createThingtimeSyncChannel({ tabId: 'same-tab', channelName, onRemoteWrite: () => {} });
	assert.ok(receiver && sender);

	try {
		sender.publish('settings.theme', 'dark');
		await settleMessages();
		assert.deepEqual(applied, []);
	} finally {
		sender.close();
		receiver.close();
	}
});

test('undo timelines remain tab-local while nested user data named timemachine still syncs', async () => {
	const channelName = uniqueChannelName();
	const applied: Array<{ path: any; value: any }> = [];
	const receiver = createThingtimeSyncChannel({
		tabId: 'tab-b',
		channelName,
		onRemoteWrite: (path, value) => applied.push({ path, value })
	});
	const sender = createThingtimeSyncChannel({ tabId: 'tab-a', channelName, onRemoteWrite: () => {} });
	assert.ok(receiver && sender);

	try {
		sender.publish('timemachine', { local: true });
		sender.publish('timemachine.user', { local: true });
		sender.publish(['tt', 'timemachine', 'user'], { local: true });
		sender.publish('thingtime.timemachine.user', { local: true });
		sender.publish('Content.timemachine', 'ordinary user data');
		await settleMessages();

		assert.deepEqual(applied, [{ path: 'Content.timemachine', value: 'ordinary user data' }]);
	} finally {
		sender.close();
		receiver.close();
	}
});

test('foreign, malformed, and invalid-path messages are ignored', async () => {
	const channelName = uniqueChannelName();
	const applied: any[] = [];
	const channel = createThingtimeSyncChannel({
		tabId: 'tab-x',
		channelName,
		onRemoteWrite: (path, value) => applied.push({ path, value })
	});
	assert.ok(channel);
	const impostor = new BroadcastChannel(channelName);
	const validPayload = stringifyThingtime({ codec: 'thingtime-safe-v1', value: 'dark' });

	try {
		impostor.postMessage(null);
		impostor.postMessage({ type: 'something-else' });
		impostor.postMessage({ type: 'tt-write', path: [], payload: validPayload, sourceTabId: 'other', timestamp: 1 });
		impostor.postMessage({
			type: 'tt-write',
			path: 'settings.__proto__.polluted',
			payload: validPayload,
			sourceTabId: 'other',
			timestamp: 1
		});
		impostor.postMessage({ type: 'tt-write', path: 'a', payload: '', sourceTabId: 'other', timestamp: 1 });
		impostor.postMessage({
			type: 'tt-write',
			path: 'a',
			payload: stringifyThingtime({ codec: 'wrong-codec', value: 'dark' }),
			sourceTabId: 'other',
			timestamp: 1
		});
		await settleMessages();

		assert.deepEqual(applied, []);
	} finally {
		impostor.close();
		channel.close();
	}
});

test('a top-level function is not converted into an undefined remote write', async () => {
	const channelName = uniqueChannelName();
	const applied: any[] = [];
	const receiver = createThingtimeSyncChannel({
		tabId: 'tab-b',
		channelName,
		onRemoteWrite: (path, value) => applied.push({ path, value })
	});
	const sender = createThingtimeSyncChannel({ tabId: 'tab-a', channelName, onRemoteWrite: () => {} });
	assert.ok(receiver && sender);

	try {
		sender.publish('settings.runtimeMethod', () => 'runtime only');
		await settleMessages();
		assert.deepEqual(applied, []);
	} finally {
		sender.close();
		receiver.close();
	}
});

test('close stops publishing and applying', async () => {
	const channelName = uniqueChannelName();
	const applied: any[] = [];
	const receiver = createThingtimeSyncChannel({
		tabId: 'tab-b',
		channelName,
		onRemoteWrite: (path, value) => applied.push({ path, value })
	});
	const sender = createThingtimeSyncChannel({ tabId: 'tab-a', channelName, onRemoteWrite: () => {} });
	assert.ok(receiver && sender);

	receiver.close();
	sender.publish('settings.theme', 'dark');
	sender.close();
	sender.publish('settings.theme', 'light');
	await settleMessages();

	assert.deepEqual(applied, []);
});

test('undefined values survive through an explicit safe-codec marker', async () => {
	const channelName = uniqueChannelName();
	let deliver: ((update: { path: any; value: any }) => void) | null = null;
	const receiver = createThingtimeSyncChannel({
		tabId: 'tab-b',
		channelName,
		onRemoteWrite: (path, value) => deliver?.({ path, value })
	});
	const sender = createThingtimeSyncChannel({ tabId: 'tab-a', channelName, onRemoteWrite: () => {} });
	assert.ok(receiver && sender);

	try {
		const received = nextMessage<{ path: any; value: any }>((resolve) => {
			deliver = resolve;
		});
		sender.publish('settings.gone', undefined);
		assert.deepEqual(await received, { path: 'settings.gone', value: undefined });
	} finally {
		sender.close();
		receiver.close();
	}
});

test('BroadcastChannel absence degrades to the existing single-tab behavior', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
	Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, writable: true, value: undefined });

	try {
		assert.equal(createThingtimeSyncChannel({ tabId: 'tab-a', onRemoteWrite: () => {} }), null);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'BroadcastChannel', descriptor);
		else delete (globalThis as Record<string, unknown>).BroadcastChannel;
	}
});
