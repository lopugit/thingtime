import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// @ts-ignore Node executes this TypeScript test through the tsx loader.
import { stringifyThingtime } from './thingtimeSerialization.ts';
// @ts-ignore Node executes this TypeScript test through the tsx loader.
import { createThingtimeSyncChannel, shouldPublishAppliedWrite } from './thingtimeSyncChannel.ts';
// @ts-ignore Node executes this TypeScript test through the tsx loader.
import { smarts } from '../smarts/index.tsx';

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

test('the carried timestamp is diagnostic: same-path concurrent writes swap instead of converging', async () => {
	// Pins the semantics the `timestamp` field does NOT provide, because a wire
	// field named `timestamp` reads like conflict resolution and there is none:
	// every message is applied on arrival, so per path this is last-writer-wins
	// by delivery order. Two tabs writing one path inside a single round-trip
	// therefore end up holding each other's value permanently.
	//
	// Asserted as the behaviour that exists rather than the behaviour that would
	// be nicer, for the same reason as the escaped-path test below: pinning what
	// is true is what makes a future change visible. If per-path applied
	// timestamps ever land in ThingtimeProvider, the later write wins in BOTH
	// tabs and this test goes red — that is the signal to update it together
	// with the note on the field in thingtimeSyncChannel.ts, not to delete it.
	const channelName = uniqueChannelName();
	const tabA: Record<string, any> = {};
	const tabB: Record<string, any> = {};
	const a = createThingtimeSyncChannel({
		tabId: 'tab-a',
		channelName,
		onRemoteWrite: (path, value) => {
			tabA[String(path)] = value;
		}
	});
	const b = createThingtimeSyncChannel({
		tabId: 'tab-b',
		channelName,
		onRemoteWrite: (path, value) => {
			tabB[String(path)] = value;
		}
	});
	assert.ok(a && b);

	try {
		// Each tab applies its own write locally first — exactly what the mutation
		// queue does before ThingtimeProvider publishes — then broadcasts it.
		tabA['Content.note'] = 'from-a';
		a.publish('Content.note', 'from-a');
		tabB['Content.note'] = 'from-b';
		b.publish('Content.note', 'from-b');
		await settleMessages();

		assert.equal(tabA['Content.note'], 'from-b', 'tab A ends up holding tab B write');
		assert.equal(tabB['Content.note'], 'from-a', 'tab B ends up holding tab A write');
	} finally {
		a.close();
		b.close();
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

// The text of each setThingtime(...) call, from its opening paren to that
// paren's own balanced close, so a multi-line options object is inspected as
// one statement rather than line by line. Stopping at the balanced close and
// not at the next `);` anywhere later in the file is what keeps a mention that
// is not a call — the design-system entries quote this API in prose — from
// swallowing the lines after it and matching a key it never writes.
const setThingtimeCalls = (source: string): string[] => {
	const calls: string[] = [];
	const call = /setThingtime\??\.?\(/g;
	let match = call.exec(source);

	while (match) {
		let depth = 0;
		let end = source.length;

		for (let index = match.index + match[0].length - 1; index < source.length; index += 1) {
			if (source[index] === '(') depth += 1;
			else if (source[index] === ')' && (depth -= 1) === 0) {
				end = index + 1;
				break;
			}
		}

		calls.push(source.slice(match.index, end));
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

test('the editor live-layout mirror declares itself tab-local while saved configs still sync', () => {
	// `settings.editor.live` IS a viewport: the windows open in THIS editor,
	// keyed by ids this mount generated. EditorDrawerSection renders it as that
	// tab's own window list, so broadcasting swaps a peer's list for this tab's —
	// its real windows disappear from its drawer while the foreign rows it shows
	// act on ids absent from its tree. Its mirror effect depends on
	// tree/floating/minimised, none of which a remote write touches, so the peer
	// cannot put it back until its own layout happens to change.
	const editorSplit = readFileSync(path.join(appDir, 'components/Thingtime/EditorSplit.tsx'), 'utf8');
	const mirror = editorSplit.match(/setThingtimeRef\.current\('settings\.editor\.live'[\s\S]*?\);/);
	assert.ok(mirror, 'expected EditorSplit to still mirror the live layout into settings');
	assert.match(mirror[0], /tabLocal: true/, 'the live layout must not replace a peer drawer window list');

	// Saved layouts are shared user data — the motivating case for this channel —
	// and must NOT have been swept up by the same change.
	const drawerSection = readFileSync(path.join(appDir, 'components/Nav/Drawer/EditorDrawerSection.tsx'), 'utf8');
	const configWrite = drawerSection.slice(drawerSection.indexOf("setThingtime('settings.editor.configs'")).match(/^[^;]*;/);
	assert.ok(configWrite, 'expected EditorDrawerSection to still write settings.editor.configs');
	assert.doesNotMatch(configWrite[0], /tabLocal/, 'saved configs should keep syncing across tabs');
});

test("the composer's tmp seed declares itself tab-local so it cannot delete a peer's live draft", () => {
	// The seed REPLACES the whole `tmp` branch, and its prune cannot tell an
	// abandoned persisted session from another tab's live one — every `s<hex>`
	// key is dropped. Broadcast, that reaches a peer as "your composer session no
	// longer exists" and destroys a post someone is part-way through typing.
	// Unlike the chrome cases this is user-authored content, so it is the one
	// tab-local write here whose absence loses data rather than just surprising.
	const composer = readFileSync(path.join(appDir, 'components/Feed/PostComposer.tsx'), 'utf8');
	const seed = composer.match(/setThingtime\(\s*DRAFT_TMP_KEY,[\s\S]*?\);/);
	assert.ok(seed, 'expected PostComposer to still seed the tmp branch through setThingtime');
	assert.match(seed[0], /tabLocal: true/, 'the tmp seed must not delete another tab composer session');
	// Passing an options object replaces setThingtime's default one.
	assert.match(seed[0], /namespace: 'default'/, 'the seed must keep the namespace it has always used');

	// The post-submit clear is the seed's other half and has to match it, or the
	// branch is only half off the wire. It writes `tmp.<draftSessionId>`, and
	// draftSessionId is minted per mount (`React.useState(() => 's' + hex)`), so
	// the key names THIS composer's session and no peer owns one. Broadcast, it
	// cannot destroy a peer draft — the peer's id differs — but it does land a
	// foreign `s<hex>` branch in every other tab, which that tab then persists in
	// its next full-tree autosave and shows under `tt.tmp` in the tree editor
	// until its own next composer mount prunes it. Asserted separately from the
	// seed so a change to either one alone fails here.
	const clear = composer.match(/setThingtime\(`\$\{DRAFT_TMP_KEY\}\.\$\{draftSessionId\}`[\s\S]*?\);/);
	assert.ok(clear, 'expected PostComposer to still clear its own session branch through setThingtime');
	assert.match(clear[0], /tabLocal: true/, "the spent-draft clear must not reach another tab's tmp branch");
	assert.match(clear[0], /namespace: 'default'/, 'the clear must keep the namespace it has always used');
});

test('the DevKit form prefills declare themselves tab-local', () => {
	// A prefill fills the form in front of THIS DevKit — an instruction to one
	// viewport, not shared state. Login/Register consume it from an effect keyed
	// on `_ts`, a fresh Date.now() every click, so the effect always re-fires:
	// broadcast, one click replaces the username/email/password a peer has typed
	// into its own form and calls setPasswordVisible(true) there. DevKit is not
	// dev-only — root.tsx renders it for every session except the authorize popup.
	const devKit = readFileSync(path.join(appDir, 'components/DevKit/DevKit.tsx'), 'utf8');

	for (const key of ['devKit.registerPrefill', 'devKit.loginPrefill']) {
		const write = devKit.match(new RegExp(`setThingtime\\(\\s*'${key.replace('.', '\\.')}'[\\s\\S]*?\\);`));
		assert.ok(write, `expected DevKit to still write ${key} through setThingtime`);
		assert.match(write[0], /tabLocal: true/, `${key} must not overwrite a form in another tab`);
		// Passing an options object replaces setThingtime's default one.
		assert.match(write[0], /namespace: 'default'/, `${key} must keep the namespace it has always used`);
	}

	// The consumers are what make the broadcast actuating rather than inert;
	// if either stops driving form state from the prefill, revisit the flag.
	for (const [file, setter] of [
		['components/Login/Login.tsx', 'loginPrefill'],
		['components/Login/Register.tsx', 'registerPrefill']
	]) {
		const source = readFileSync(path.join(appDir, file), 'utf8');
		assert.match(source, new RegExp(setter), `expected ${file} to still read ${setter}`);
		assert.match(source, /setPasswordVisible\(true\)/, `expected ${file} to still reveal the password on prefill`);
	}
});

test('an array path part is one literal key, so exact-match validation is sufficient', () => {
	// The guard checks string paths by SPLITTING them and array paths by matching
	// each element exactly. That asymmetry looks like a hole — `['a.__proto__']`
	// and `['tt.timemachine']` both slip past an exact-match check — and it is
	// only safe because smarts.setsmart never re-splits an array element: it
	// assigns obj[ee(part)] directly, so a dotted part is a literal own key that
	// addresses neither the prototype nor the real timeline. Pin that here: if
	// setsmart ever starts re-splitting, the guard becomes bypassable and this
	// test is the thing that says so.
	//
	// It also rules OUT the tempting inverse fix — normalising array parts
	// through the string splitter before validating. Legitimate keys contain dots
	// (see useTtTheme's `custom` map, keyed 'windows.close'), so splitting them
	// would mis-segment real data rather than harden anything.
	const build = () => {
		const root: any = { timemachine: { SENTINEL: 'local-timeline' } };
		root.tt = root;
		root.thingtime = root;
		return root;
	};

	const polluted = build();
	smarts.setsmart(polluted, ['a.__proto__', 'polluted'], 'ATTACKER');
	assert.equal(({} as any).polluted, undefined, 'a dotted array part must not reach Object.prototype');
	assert.ok(Object.prototype.hasOwnProperty.call(polluted, 'a.__proto__'), 'it must land as one literal own key');

	const aliased = build();
	smarts.setsmart(aliased, ['tt.timemachine', 'SENTINEL'], 'ATTACKER');
	assert.equal(aliased.timemachine.SENTINEL, 'local-timeline', 'a dotted array part must not reach the real timeline');
	assert.ok(Object.prototype.hasOwnProperty.call(aliased, 'tt.timemachine'), 'it must land as one literal own key');

	// Sensitivity check: the segmented form the guard actually rejects DOES reach
	// the timeline, so the two assertions above are not passing vacuously.
	const reached = build();
	smarts.setsmart(reached, ['timemachine', 'SENTINEL'], 'ATTACKER');
	assert.equal(reached.timemachine.SENTINEL, 'ATTACKER');
});

test('an escaped-bracket string path passes the guard and still lands as one literal key', async () => {
	// The string-path twin of the test above, and the same shape of reasoning.
	//
	// The guard splits string paths on /[.[\]"']+/, which does NOT treat a
	// backslash as a delimiter, so `[\"__proto__\"]` tokenises to `\` and
	// `__proto__\` — neither matches UNSAFE_PATH_PARTS and the message is
	// ACCEPTED. That is harmless only downstream: parsePropertyPath never enters
	// its bracket mode for `[\"` (that mode needs a bare `["`), so the whole path
	// stays ONE literal own key addressing neither the prototype nor the real
	// timeline. Assert the acceptance rather than a rejection the guard does not
	// actually make, so this pins the behaviour that exists.
	//
	// If parsePropertyPath ever learns to honour `\"` inside brackets — plausible,
	// it already carries escape branches — these paths start resolving to a real
	// `__proto__` segment while the guard still waves them through. This test is
	// the thing that says so.
	//
	// The tempting fix at that point is "validate with parsePropertyPath instead
	// of the regex, so the guard and the apply path agree." Don't: it LOOSENS the
	// guard. Swapping it and replaying 545 hostile paths accepted 256 where the
	// regex accepted 125 — a strict superset, nothing accepted by the regex and
	// rejected by the parser — because the regex splits on `[`, `]`, `"` and `'`
	// unconditionally and so rejects bare and single-quoted bracket forms
	// (`[__proto__]`, `['__proto__']`, `["__proto__"`) that parsePropertyPath
	// keeps as one literal key. Splitting more aggressively than the consumer is
	// the correct direction for a denylist: it can over-reject a path, never
	// under-reject one. Keep the regex; fix the segmentation downstream.
	const escaped = '[\\"__proto__\\"]';
	const nested = 'a[\\"__proto__\\"].x';

	const accepted: any[] = [];
	const channelName = uniqueChannelName();
	const channel = createThingtimeSyncChannel({
		tabId: 'tab-guard',
		channelName,
		onRemoteWrite: (path) => accepted.push(path)
	});
	assert.ok(channel);
	const impostor = new BroadcastChannel(channelName);
	const payload = stringifyThingtime({ codec: 'thingtime-safe-v1', value: 'ATTACKER' });

	try {
		for (const path of [escaped, nested]) {
			impostor.postMessage({ type: 'tt-write', path, payload, sourceTabId: 'other', timestamp: 1 });
		}
		await settleMessages();
		assert.deepEqual(accepted, [escaped, nested], 'the regex guard does not catch the escaped forms');
	} finally {
		impostor.close();
		channel.close();
	}

	// ...and the apply path is what keeps that safe: one literal key, no reachable
	// `__proto__` segment, prototype chain untouched.
	for (const path of [escaped, nested]) {
		const root: any = {};
		smarts.setsmart(root, path, 'ATTACKER');
		assert.equal(Object.getPrototypeOf(root), Object.prototype, `${path} must not replace the prototype`);
		assert.equal(({} as any).x, undefined, `${path} must not reach Object.prototype`);
		assert.ok(
			Object.keys(root).every((key) => !key.startsWith('__proto__')),
			`${path} must not create a bare __proto__ segment`
		);
	}
	assert.deepEqual(smarts.parsePropertyPath(escaped), [escaped], 'the escaped form must stay one unsplit key');

	// Sensitivity check: the unescaped form the guard DOES reject is the one that
	// would otherwise segment into a real `__proto__` part, so the assertions above
	// are not passing vacuously.
	assert.deepEqual(smarts.parsePropertyPath('settings.__proto__.polluted'), ['settings', '__proto__', 'polluted']);
});

test('a key rename keeps syncing, and the transport still carries writes only', () => {
	// The rename asymmetry recorded at the top of thingtimeSyncChannel.ts: the
	// write crosses, the `path-renamed` event that compensates for it does not,
	// so a peer's string-bound editor windows and composer draftPath go blank.
	//
	// This guards the WRONG fix. Marking the rename tabLocal would silence the
	// blank windows by withholding a user-data write — restoring exactly the
	// stale-tab clobber this channel exists to fix — and it would look like a
	// tidy one-word change to whoever hits the symptom. Assert the write stays
	// on the wire, in the same shape as the "saved configs keep syncing" and
	// "drawer preferences keep syncing" guards above.
	const thingtime = readFileSync(path.join(appDir, 'components/Thingtime/Thingtime.tsx'), 'utf8');
	const rename = thingtime.slice(thingtime.indexOf('const updatePath = React.useCallback'));

	const write = rename.match(/setThingtime\(parentPath, newObject,[\s\S]*?\);/);
	assert.ok(write, 'expected updatePath to still write the rewritten parent through setThingtime');
	assert.doesNotMatch(write[0], /tabLocal/, 'a rename is user data — withholding it restores the whole-tree clobber');

	// Non-vacuous: the emit the peer never receives has to still be there, or
	// the asymmetry this pins no longer exists and the note needs revisiting.
	assert.match(rename.slice(0, rename.indexOf('focus next input')), /events\?\.next\?\.\(\{\s*type: 'path-renamed'/);

	// ...and the transport is what makes it an asymmetry: writes only, no event
	// hook. If a second message type ever lands, this fails and the note at the
	// top of thingtimeSyncChannel.ts is what needs updating alongside it.
	const channel = createThingtimeSyncChannel({ tabId: 'tab-a', channelName: uniqueChannelName(), onRemoteWrite: () => {} });
	assert.ok(channel);
	try {
		assert.deepEqual(Object.keys(channel).sort(), ['close', 'publish']);
	} finally {
		channel.close();
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
