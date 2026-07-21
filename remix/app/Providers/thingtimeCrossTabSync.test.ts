import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { createThingtimeCrossTabSync } from './thingtimeCrossTabSync.ts';
// @ts-ignore see above.
import type { ThingtimeCrossTabChannel, ThingtimeCrossTabMessage } from './thingtimeCrossTabSync.ts';

type FakeChannel = ThingtimeCrossTabChannel & {
	sent: ThingtimeCrossTabMessage[];
	closed: boolean;
	receive: (data: unknown) => void;
};

const makeFakeChannel = (options: { rejectClone?: (message: ThingtimeCrossTabMessage) => boolean } = {}): FakeChannel => {
	const channel: FakeChannel = {
		sent: [],
		closed: false,
		onmessage: null,
		postMessage: (message) => {
			if (!('encoded' in message) && options.rejectClone?.(message)) {
				throw new DOMException('could not be cloned', 'DataCloneError');
			}
			channel.sent.push(message);
		},
		close: () => {
			channel.closed = true;
		},
		receive: (data) => channel.onmessage?.({ data })
	};
	return channel;
};

const jsonEncode = (value: unknown) => JSON.stringify({ v: typeof value === 'function' ? String(value) : value });
const jsonDecode = (encoded: string) => JSON.parse(encoded).v;

test('publishes local writes tagged with the source tab id', () => {
	const channel = makeFakeChannel();
	const sync = createThingtimeCrossTabSync({
		tabId: 'tab-a',
		encode: jsonEncode,
		decode: jsonDecode,
		onRemoteWrite: () => assert.fail('local publishes must not loop back'),
		createChannel: () => channel
	});

	sync.publish('settings.drawer.width', 320, 111);

	assert.deepEqual(channel.sent, [{ sourceTabId: 'tab-a', path: 'settings.drawer.width', value: 320, timestamp: 111 }]);
});

test('applies remote writes and ignores its own messages', () => {
	const channel = makeFakeChannel();
	const applied: unknown[] = [];
	createThingtimeCrossTabSync({
		tabId: 'tab-a',
		encode: jsonEncode,
		decode: jsonDecode,
		onRemoteWrite: (path, value, timestamp) => applied.push([path, value, timestamp]),
		createChannel: () => channel
	});

	channel.receive({ sourceTabId: 'tab-b', path: ['settings', 'drawer', 'width'], value: 280, timestamp: 5 });
	channel.receive({ sourceTabId: 'tab-a', path: 'ignored.self', value: 1, timestamp: 6 });
	channel.receive(null);
	channel.receive('garbage');

	assert.deepEqual(applied, [[['settings', 'drawer', 'width'], 280, 5]]);
});

test('falls back to encoding when structured clone rejects the value', () => {
	const senderChannel = makeFakeChannel({ rejectClone: (message) => typeof message.value === 'function' });
	const receiverChannel = makeFakeChannel();
	const applied: unknown[] = [];
	createThingtimeCrossTabSync({
		tabId: 'tab-b',
		encode: jsonEncode,
		decode: jsonDecode,
		onRemoteWrite: (path, value) => applied.push([path, value]),
		createChannel: () => receiverChannel
	});

	const sender = createThingtimeCrossTabSync({
		tabId: 'tab-a',
		encode: jsonEncode,
		decode: jsonDecode,
		onRemoteWrite: () => {},
		createChannel: () => senderChannel
	});

	sender.publish('fn', () => 'hello', 9);

	assert.equal(senderChannel.sent.length, 1);
	assert.equal(typeof senderChannel.sent[0].encoded, 'string');
	assert.ok(!('value' in senderChannel.sent[0]));

	receiverChannel.receive(senderChannel.sent[0]);
	assert.equal(applied.length, 1);
	assert.match(String((applied[0] as unknown[])[1]), /hello/);
});

test('reports publish errors when even the encoded fallback fails', () => {
	const channel = makeFakeChannel({ rejectClone: () => true });
	channel.postMessage = () => {
		throw new Error('always fails');
	};
	const errors: string[] = [];
	const sync = createThingtimeCrossTabSync({
		tabId: 'tab-a',
		encode: jsonEncode,
		decode: jsonDecode,
		onRemoteWrite: () => {},
		createChannel: () => channel,
		onError: (_error, context) => errors.push(context.phase)
	});

	sync.publish('path', 1, 2);
	assert.deepEqual(errors, ['publish']);
});

test('degrades to a no-op when BroadcastChannel is unavailable', () => {
	const sync = createThingtimeCrossTabSync({
		tabId: 'tab-a',
		encode: jsonEncode,
		decode: jsonDecode,
		onRemoteWrite: () => {},
		createChannel: () => null
	});

	sync.publish('path', 1, 2);
	sync.close();
});

test('close detaches the handler and closes the channel', () => {
	const channel = makeFakeChannel();
	const sync = createThingtimeCrossTabSync({
		tabId: 'tab-a',
		encode: jsonEncode,
		decode: jsonDecode,
		onRemoteWrite: () => assert.fail('closed sync must not apply'),
		createChannel: () => channel
	});

	sync.close();
	assert.equal(channel.closed, true);
	assert.equal(channel.onmessage, null);
	channel.receive({ sourceTabId: 'tab-b', path: 'p', value: 1, timestamp: 1 });
});
