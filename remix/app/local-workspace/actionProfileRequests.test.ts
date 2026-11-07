import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalActions } from './actions';
import { localActionRequests, localActionRequestSupported } from './actionRequests';
import { LocalThings } from './things';
import { LocalAlgorithms } from './algorithms';
import { LocalTimeline } from './timeline';
import { AccountThingSync } from './accountSync';
import { AccountThemeSync } from './accountThemes';
import { AccountAlgorithmSync } from './accountAlgorithms';
import { AccountTimeline } from './accountTimeline';
import { WorkspaceDatabase, type WorkspaceScope } from './storage';
import { createQuotaFactory } from './storageTestFixture';

const anonymous = { kind: 'anonymous' } as const;
const home = { kind: 'account', ownerId: 'owner', origin: 'https://profiles.test', dataPlane: 'home' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const versions: Record<string, string> = { themes: '1.1.1', 'themes-delete': '1.1.1', algorithms: '1.1.0', 'algorithms-update': '1.1.0', 'algorithms-active': '1.1.0', 'algorithms-delete': '1.0.1' };
const step = (route: string, body?: unknown, method = 'POST') => ({
	op: 'http.request', method, path: `/api/v1/${route}`, query: {}, feature: `api.${route.replace('/', '-')}`,
	minimumVersion: versions[route.replace('/', '-')] ?? '1.0.0', maxResultBytes: 65536,
	...(body === undefined ? {} : { body })
});
const definition = (steps: any[]) => ({ thingtime: ['action'], crystal: { name: 'Dedicated device profiles', runtime: 'browser', version: 1,
	capabilities: [{ capability: 'http.request', endpoints: [...new Set(steps.map(step => `${step.method} ${step.path}`))] }],
	steps: [...steps, { op: 'return', value: `$step.${steps.length}` }] } });
const program = () => [
	step('themes', { name: 'Device theme', theme: {} }),
	step('themes/active', { themeId: '$step.1.theme.id' }),
	step('themes', { id: '$step.1.theme.id', name: 'Updated theme', theme: {} }),
	step('algorithms', { name: 'Device algorithm' }),
	step('algorithms/update', { id: '$step.4.algorithm.id', name: 'Updated algorithm', description: 'Saved offline' }),
	step('algorithms/active', { algorithmId: '$step.4.algorithm.id' }),
	step('algorithms/track', { algorithmId: '$step.4.algorithm.id', events: [{ thingId: 'post', signal: 'react' }] }),
	step('algorithms', undefined, 'GET')
];
const request = (db: WorkspaceDatabase, scope: WorkspaceScope, store?: AccountThingSync) => localActionRequests(db, scope, lease, async () => { throw new Error('Unexpected nested run'); }, store ? active => {
	const sync = store.withLease(active);
	return { ...Object.fromEntries(['get', 'list', 'snapshot', 'create', 'update', 'move', 'import', 'export'].map(key => [key, (sync.things as any)[key].bind(sync.things)])), remove: sync.remove.bind(sync) } as any;
} : undefined);

test('saved anonymous browser Actions edit dedicated profiles, capture History and never fetch', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, anonymous, lease), fetch = globalThis.fetch;
	globalThis.fetch = async () => { throw new Error('HTTP forbidden'); };
	try {
		await new LocalAlgorithms(db, lease).observePublicPosts([{ id: 'post', type: 'text', tags: ['offline'], author: { id: 'author' }, createdAt: new Date().toISOString() }]);
		const action = await things.create(definition(program())), actions = new LocalActions(db, anonymous, lease);
		assert.equal(await actions.canRunLocally(action.id), true);
		const outcome = await actions.run({ action: action.id }); assert.equal(outcome.status, 'ok', outcome.error);
		const algorithms = outcome.result as any; assert.equal(algorithms.algorithms[0].name, 'Updated algorithm');
		assert.equal(algorithms.activeAlgorithmId, algorithms.algorithms[0].id);
		assert.equal(algorithms.algorithms[0].eventCount, 1);
		const invoke = request(db, anonymous), actor = 'local-workspace', signal = new AbortController().signal;
		const themes = await invoke(step('themes', undefined, 'GET'), actor, signal) as any;
		assert.equal(themes.themes[0].name, 'Updated theme'); assert.equal(themes.activeThemeId, themes.themes[0].id);
		const history = await new LocalTimeline(db, lease, 'https://profiles.test').page({ thingId: themes.themes[0].id, before: null, after: null, limit: 40 });
		assert.ok(history.entries.length >= 2);
		await assert.rejects(things.update({ id: themes.themes[0].id, crystal: { name: 'Bypass' } }), /dedicated/);
		await invoke(step('themes/delete', { id: themes.themes[0].id }), actor, signal);
		await invoke(step('algorithms/delete', { id: algorithms.algorithms[0].id }), actor, signal);
		assert.equal((await invoke(step('themes', undefined, 'GET'), actor, signal) as any).activeThemeId, null);
		assert.equal((await invoke(step('algorithms', undefined, 'GET'), actor, signal) as any).activeAlgorithmId, null);
		assert.equal(await db.transaction(anonymous, 'readonly', lease, async tx => (await tx.list('account-theme-sync')).length + (await tx.list('account-algorithm-sync')).length), 0);
	} finally { globalThis.fetch = fetch; await db.close(); }
});

test('account browser profile effects use dedicated content and selection queues with client History', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()), sync = new AccountThingSync(db, home, lease), fetch = globalThis.fetch;
	globalThis.fetch = async () => { throw new Error('HTTP forbidden'); };
	try {
		const action = await sync.things.create(definition(program())), actions = new LocalActions(db, home, lease, sync);
		assert.equal(await actions.canRunLocally(action.id), true);
		const outcome = await actions.run({ action: action.id }); assert.equal(outcome.status, 'ok', outcome.error);
		assert.equal(outcome.historyError, undefined);
		const themes = new AccountThemeSync(db, home, lease), algorithms = new AccountAlgorithmSync(db, home, lease);
		const theme = (await themes.list()).themes[0], algorithm = (await algorithms.list()).algorithms[0];
		assert.equal(theme.name, 'Updated theme'); assert.equal(algorithm.name, 'Updated algorithm');
		assert.equal((await themes.status())[0].state, 'pending'); assert.equal((await algorithms.status())[0].state, 'pending');
		assert.equal((await themes.selection.status())?.desired, theme.id); assert.equal((await algorithms.selection.status())?.desired, algorithm.id);
		assert.equal((await themes.selection.status())?.state, 'pending'); assert.equal((await algorithms.selection.status())?.state, 'pending');
		assert.ok((await sync.status()).every(row => row.id !== theme.id && row.id !== algorithm.id), 'protected profiles never enter generic content sync');
		const history = new AccountTimeline(db, home, lease);
		for (const id of [theme.id, algorithm.id]) {
			const rows = await history.rows({ thingId: id }); assert.ok(rows.length >= 2);
			assert.ok(rows.every(row => row.event.source === 'client' && row.event.mode === 'draft'));
		}
		assert.equal((await actions.runs({ action: action.id })).runs.length, 1);
	} finally { globalThis.fetch = fetch; await db.close(); }
});

test('profile preflight refuses remote scopes, public services, sharing, unsupported fields and versions before effects', async () => {
	for (const unsupported of [
		step('themes', { name: 'Publish', theme: {}, visibility: 'public' }),
		step('algorithms/update', { id: 'owned', shared: false }), step('algorithms/update', { id: 'owned', listed: true }),
		step('algorithms/track', { events: [] }), step('themes/shared', undefined, 'GET'),
		step('themes/sync', { operation: 'snapshot' }), step('algorithms/search', undefined, 'GET'),
		{ ...step('themes', { theme: {} }), minimumVersion: '2.0.0' }, { ...step('themes', { theme: {} }), feature: 'api.things' },
		{ ...step('themes', undefined, 'GET'), query: { ownerId: 'foreign' } }, step('themes', { theme: {}, ownerId: 'foreign' })
	]) assert.equal(localActionRequestSupported(unsupported, home), false, JSON.stringify(unsupported));
	const custom = { ...home, dataPlane: 'custom' }, db = new WorkspaceDatabase(new IDBFactory()), sync = new AccountThingSync(db, custom, lease);
	try {
		const action = await sync.things.create(definition([step('themes', { name: 'Wrong scope', theme: {} })]));
		assert.equal(await new LocalActions(db, custom, lease, sync).canRunLocally(action.id), false);
		assert.equal((await new AccountThemeSync(db, home, lease).list()).themes.length, 0);
		assert.equal((await new LocalThings(db, anonymous, lease).snapshot()).length, 0);
	} finally { await db.close(); }
});

test('profile requests refuse foreign IDs, stale actors and cancellation without creating effects', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()), invoke = request(db, anonymous), signal = new AbortController().signal;
	try {
		await assert.rejects(invoke(step('themes', { name: 'Cancelled', theme: {} }), 'local-workspace', AbortSignal.abort()), /abort/i);
		await assert.rejects(invoke(step('themes', { name: 'Wrong actor', theme: {} }), 'foreign', signal), /Workspace changed/);
		await assert.rejects(invoke(step('algorithms', { name: 'Foreign branch', branchFrom: 'foreign' }), 'local-workspace', signal), /not in this workspace/);
		await assert.rejects(invoke(step('themes/active', { themeId: 'foreign' }), 'local-workspace', signal), /not in this workspace/);
		assert.equal((await new LocalThings(db, anonymous, lease).snapshot()).length, 0);
	} finally { await db.close(); }
});

test('profile quota failure rolls back content, dedicated queue and History together; retry succeeds', async () => {
	const factory = createQuotaFactory({ records: 1 }), db = new WorkspaceDatabase(factory), sync = new AccountThingSync(db, home, lease), invoke = request(db, home, sync);
	try {
		await assert.rejects(invoke(step('themes', { name: 'Atomic theme', theme: {} }), home.ownerId, new AbortController().signal), { code: 'LOCAL_QUOTA' });
		assert.equal((await sync.things.snapshot()).length, 0);
		assert.equal((await new AccountThemeSync(db, home, lease).status()).length, 0);
		assert.equal((await new AccountTimeline(db, home, lease).rows({})).length, 0);
		factory.capacity.records = Infinity;
		assert.equal((await invoke(step('themes', { name: 'Atomic theme', theme: {} }), home.ownerId, new AbortController().signal) as any).theme.name, 'Atomic theme');
	} finally { await db.close(); }
});
