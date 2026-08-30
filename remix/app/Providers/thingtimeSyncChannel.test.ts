import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// @ts-ignore Node executes this TypeScript test through the tsx loader.
import { stringifyThingtime } from './thingtimeSerialization.ts';
// @ts-ignore Node executes this TypeScript test through the tsx loader.
import { createThingtimeSyncChannel, shouldPublishAppliedWrite } from './thingtimeSyncChannel.ts';

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
		// The root aliases each point back at the root, so a REPEATED alias run
		// still addresses the tab-local timeline and must not cross either.
		sender.publish('tt.tt.timemachine.user', { local: true });
		sender.publish('thingtime.tt.timemachine.user', { local: true });
		sender.publish(['tt', 'thingtime', 'timemachine', 'user'], { local: true });
		sender.publish('Content.timemachine', 'ordinary user data');
		// Only a LEADING alias run is the root. A nested key named tt is user data.
		sender.publish('Content.tt.timemachine', 'ordinary user data');
		await settleMessages();

		assert.deepEqual(applied, [
			{ path: 'Content.timemachine', value: 'ordinary user data' },
			{ path: 'Content.tt.timemachine', value: 'ordinary user data' }
		]);
	} finally {
		sender.close();
		receiver.close();
	}
});

test('a whole-tree root replacement is never broadcast, but named children of the root still are', async () => {
	// applyThingtimeUpdate treats a bare 'tt'/'thingtime' path as a REPLACEMENT of
	// the entire tree. Broadcasting one would overwrite each receiving tab's root
	// wholesale — carrying the sender's tab-local `timemachine` timeline with it —
	// so the root aliases are only ever a prefix here, never the whole path.
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
		sender.publish('tt', { whole: 'tree' });
		sender.publish('thingtime', { whole: 'tree' });
		sender.publish(['tt'], { whole: 'tree' });
		sender.publish(['thingtime'], { whole: 'tree' });
		// A path that is only aliases resolves to the root's own alias property, so
		// applying one would replace the receiving tab's `tt`/`thingtime`
		// self-reference with the payload and detach it from its real tree.
		sender.publish('tt.tt', { whole: 'tree' });
		sender.publish('thingtime.tt', { whole: 'tree' });
		sender.publish(['tt', 'thingtime'], { whole: 'tree' });
		sender.publish('tt.settings.theme', 'dark');
		// A repeated alias run in front of real data is still an ordinary write.
		sender.publish('tt.tt.settings.theme', 'dark');
		await settleMessages();

		assert.deepEqual(applied, [
			{ path: 'tt.settings.theme', value: 'dark' },
			{ path: 'tt.tt.settings.theme', value: 'dark' }
		]);
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

test('only writes that are neither remote echoes nor tab-local chrome are published', () => {
	assert.equal(shouldPublishAppliedWrite(undefined), true);
	assert.equal(shouldPublishAppliedWrite({}), true);
	assert.equal(shouldPublishAppliedWrite({ fromRemote: false, tabLocal: false }), true);

	// A peer's write already rode this tab's queue — republishing it would echo.
	assert.equal(shouldPublishAppliedWrite({ fromRemote: true }), false);
	// Chrome for this viewport: persisted as usual, but never actuates a peer.
	assert.equal(shouldPublishAppliedWrite({ tabLocal: true }), false);
	assert.equal(shouldPublishAppliedWrite({ fromRemote: true, tabLocal: true }), false);
});

// The transport deliberately holds no list of chrome paths, so nothing stops a
// future write of a viewport-presence key from silently crossing tabs again.
// These two assertions are that guard: they read the real call sites.
const appDir = fileURLToPath(new URL('..', import.meta.url));

const sourceFilesUnder = (dir: string): string[] => {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFilesUnder(full);
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
	});
};

// The text of each setThingtime(...) call, so a multi-line options object is
// inspected as one statement rather than line by line.
const setThingtimeCalls = (source: string): string[] => {
	const calls: string[] = [];
	const call = /setThingtime\??\.?\(/g;
	let match = call.exec(source);

	while (match) {
		const end = source.indexOf(');', match.index);
		calls.push(source.slice(match.index, end === -1 ? source.length : end));
		match = call.exec(source);
	}

	return calls;
};

test('every commanderActive write declares itself tab-local', () => {
	const offenders: string[] = [];
	let checked = 0;

	for (const file of sourceFilesUnder(appDir)) {
		for (const call of setThingtimeCalls(readFileSync(file, 'utf8'))) {
			if (!call.includes('commanderActive')) continue;
			checked += 1;
			// Broadcasting the palette's open/closed state toggles it in every
			// other tab — and the peer's toggle effect clears its input, so a
			// half-typed query elsewhere is destroyed. Commander *preferences*
			// under the same key are unaffected and still sync.
			if (!call.includes('tabLocal: true')) offenders.push(`${path.relative(appDir, file)}: ${call.split('\n')[0]}`);
		}
	}

	assert.deepEqual(offenders, []);
	// A rename that silently matches nothing would otherwise pass vacuously.
	assert.ok(checked >= 5, `expected the known commanderActive write sites, found ${checked}`);
});

test('the drawer writes that describe this viewport declare themselves tab-local while drawer preferences still sync', () => {
	const useDrawer = readFileSync(path.join(appDir, 'components/Nav/Drawer/useDrawer.tsx'), 'utf8');

	// `open` is whether this drawer is showing; `selectedItem` is which section it
	// is showing, and DrawerContent writes that one from this tab's `pathname`.
	// Both describe a viewport rather than a preference, and a peer cannot undo
	// either: the pathname-sync effect re-runs only on pathname/open/variant/
	// loading, and returns early while that peer's drawer is closed.
	for (const viewportState of ["setDrawerSetting('open'", "setDrawerSetting('selectedItem'"]) {
		const write = useDrawer.slice(useDrawer.indexOf(viewportState)).match(/^[^;]*;/);
		assert.ok(write, `expected useDrawer to still write ${viewportState} through setDrawerSetting`);
		assert.match(write[0], /tabLocal: true/, `${viewportState} must not actuate another tab`);
	}

	// Width/direction/ordering are shared preferences — the motivating case for
	// this channel — and must NOT have been swept up by the same change.
	for (const preference of ["setDrawerSetting('width'", "setDrawerSetting('opens.direction'", "setDrawerSetting('userDrawerOrdering'"]) {
		const write = useDrawer.slice(useDrawer.indexOf(preference)).match(/^[^;]*;/);
		assert.ok(write, `expected useDrawer to still write ${preference}`);
		assert.doesNotMatch(write[0], /tabLocal/, `${preference} should keep syncing across tabs`);
	}
});

test('both settings.editor.openConfig writes declare themselves tab-local', () => {
	// openConfig is a handoff to this tab's own next navigation ("remember which
	// config to load, then head to the editor"), not a shared setting. Crossing
	// tabs it does two things: a peer already on /editor that has not consumed an
	// intent since mount applies the layout over its open windows, and the
	// consuming clear erases an intent another tab set but has not navigated to.
	// Both directions have to be suppressed or the pair is still lopsided.
	const writes = [
		['components/Nav/Drawer/EditorDrawerSection.tsx', "setThingtime('settings.editor.openConfig'"],
		['components/Thingtime/EditorSplit.tsx', "setThingtimeRef.current('settings.editor.openConfig'"]
	];

	for (const [file, needle] of writes) {
		const source = readFileSync(path.join(appDir, file), 'utf8');
		const index = source.indexOf(needle);
		assert.notEqual(index, -1, `expected ${file} to still write settings.editor.openConfig`);
		assert.match(source.slice(index).match(/^[^;]*;/)?.[0] ?? '', /tabLocal: true/, `${file} must not actuate another tab`);
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
