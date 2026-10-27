import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { ALL_SUITES } from '../schemas/appSuites';
import { suiteBundleVersion, type InstallSuiteResult } from '../schemas/suiteInstallation';
import { AccountThingSync } from './accountSync';
import { LocalActions } from './actions';
import { AccountSuiteSync, ACCOUNT_SUITE_INSTALLS, ACCOUNT_SUITE_PARTS, installedSuiteIds, type AccountSuiteIntent, type ReconcileAccountSuite } from './accountSuites';
import { WorkspaceDatabase, WorkspaceError, type WorkspaceLease } from './storage';

const scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
const key = 'web-standards';
const setup = (reconcile: ReconcileAccountSuite = async () => { throw new Error('Reconciliation unavailable'); }) => {
	const factory = new IDBFactory(), db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange);
	let active = true, time = Date.now();
	const listeners = new Set<() => void>();
	const lease: WorkspaceLease = { assertCurrent() { if (!active) throw new Error('Workspace changed'); }, onInvalidate(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
	const sync = new AccountThingSync(db, scope, lease, () => time), suites = new AccountSuiteSync(db, scope, lease, sync, reconcile, () => time);
	const read = <T>(collection: string, id: string) => db.transaction(scope, 'readonly', lease, tx => tx.get<T>(collection, id));
	return { factory, db, lease, sync, suites, read, tick() { time += 120_000; }, retire() { active = false; listeners.forEach(fn => fn()); } };
};
const receipt = (intent: AccountSuiteIntent, overrides: Record<string, unknown> = {}): InstallSuiteResult => ({
	...intent.local,
	receipt: { requestId: intent.request.requestId, ownerId: scope.ownerId, origin: scope.origin, dataPlane: scope.dataPlane,
		bundleVersion: intent.request.bundleVersion, snapshots: intent.baseline.map(row => ({ ...row,
			author: { id: scope.ownerId }, acl: ['tt:user'], visibility: 'private', extended: row.extended ?? null,
			tags: row.tags || [], folderId: row.folderId || null, targetId: row.targetId || null
		} as any)), ...overrides }
});

test('signed-in suite admission is atomic, editable offline, durable across cold reload and concurrent tabs', async () => {
	const f = setup();
	const otherDb = new WorkspaceDatabase(f.factory, undefined, undefined, IDBKeyRange);
	try {
		const otherSync = new AccountThingSync(otherDb, scope, f.lease), other = new AccountSuiteSync(otherDb, scope, f.lease, otherSync, async () => {});
		const [first, second] = await Promise.all([f.suites.install(key), other.install(key)]);
		assert.deepEqual(first, second);
		const intent = (await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))!;
		assert.equal(intent.baseline.length, installedSuiteIds(first).length);
		assert.deepEqual(new Set(intent.createdIds), new Set(installedSuiteIds(first)));
		for (const id of intent.createdIds) assert.equal((await f.read<any>(ACCOUNT_SUITE_PARTS, id)).requestId, intent.request.requestId);
		const run = await new LocalActions(f.db, scope, f.lease, f.sync).run({ action: first.actionIds.catalogue });
		assert.equal(run.status, 'ok', run.error);
		assert.ok(run.result);
		const componentId = Object.values(first.componentIds)[0];
		await f.sync.things.update({ id: componentId, crystal: { description: 'Later offline edit' } });
		await f.suites.install(key);
		assert.equal((await f.sync.things.get(componentId)).crystal.description, 'Later offline edit');
		assert.notEqual(intent.baseline.find(row => row.id === componentId)?.crystal.description, 'Later offline edit');
		await f.db.close();
		assert.deepEqual(await other.install(key), first);
		assert.equal((await otherSync.things.get(componentId)).crystal.description, 'Later offline edit');
		assert.ok(await otherDb.transaction(scope, 'readonly', f.lease, async tx => (await tx.list('timeline-events')).length));
	} finally { await f.db.close(); await otherDb.close(); }
});

test('suite intent and holds roll back with content and History on failed admission', async () => {
	const f = setup();
	try {
		const transaction = f.db.transaction.bind(f.db);
		f.db.transaction = ((scope: any, mode: any, lease: any, run: any) => transaction(scope, mode, lease, tx => run({ ...tx,
			put: async (collection: string, id: string, value: unknown) => {
				if (collection === ACCOUNT_SUITE_INSTALLS) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
				return tx.put(collection, id, value);
			}
		}))) as typeof f.db.transaction;
		await assert.rejects(f.suites.install(key), /quota|full/i);
		f.db.transaction = transaction;
		assert.deepEqual(await f.sync.things.snapshot(), []);
		assert.deepEqual(await f.sync.status(), []);
		for (const collection of [ACCOUNT_SUITE_INSTALLS, ACCOUNT_SUITE_PARTS, 'timeline-events'])
			assert.deepEqual(await f.db.transaction(scope, 'readonly', f.lease, tx => tx.list(collection)), []);
	} finally { await f.db.close(); }
});

test('incomplete account cache install preserves cached definitions and samples without claiming remote absence', async () => {
	const f = setup();
	try {
		const first = await f.suites.install(key);
		const part = Object.values(first.componentIds)[0];
		await f.sync.things.update({ id: part, crystal: { description: 'User content' } });
		const previous = await f.sync.things.get(part);
		await f.db.transaction(scope, 'readwrite', f.lease, async tx => {
			await tx.delete(ACCOUNT_SUITE_INSTALLS, key);
			for (const id of installedSuiteIds(first)) await tx.delete(ACCOUNT_SUITE_PARTS, id);
			for (const id of Object.values(first.pageIds)) { await tx.delete('things', id); await tx.delete('thing-sync', id); }
		});
		const second = await f.suites.install(key);
		assert.equal(second.componentIds[Object.keys(first.componentIds)[0]], part);
		assert.deepEqual(await f.sync.things.get(part), previous);
		assert.equal(second.created, Object.values(first.pageIds).length);
		assert.equal((await f.suites.status())[0].state, 'pending');
	} finally { await f.db.close(); }
});

test('validated canonical receipt survives failed reconciliation and retries with its frozen request identity', async () => {
	let reconcileCalls = 0;
	const f = setup(async () => { reconcileCalls++; throw new Error('Synthetic atomic mapping failure'); });
	try {
		await f.suites.install(key);
		const intent = (await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))!;
		const requests: unknown[] = [];
		const transport = { install: async (request: unknown) => { requests.push(structuredClone(request)); return receipt(intent); } };
		await f.suites.sync(transport);
		assert.equal(reconcileCalls, 1);
		assert.ok((await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))?.remote);
		for (const id of installedSuiteIds(intent.local)) assert.ok(await f.read(ACCOUNT_SUITE_PARTS, id));
		f.tick(); await f.suites.sync(transport);
		assert.equal(requests.length, 1, 'receipt replay needs no second remote request');
		assert.deepEqual(requests[0], intent.request);
		assert.equal(reconcileCalls, 2);
		assert.notEqual((await f.suites.status())[0].state, 'synced');
	} finally { await f.db.close(); }
});

test('durable suite receipts omit hidden-link bearer and grant metadata', async () => {
	const f = setup();
	try {
		await f.suites.install(key);
		const intent = (await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))!, remote = receipt(intent);
		Object.assign(remote.receipt!.snapshots[0], { linkKey: 'synthetic-do-not-retain', tokenAcl: ['synthetic-grant'] });
		await f.suites.sync({ install: async () => remote });
		const retained = (await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))!.remote!;
		assert.equal('linkKey' in retained.receipt!.snapshots[0], false);
		assert.equal('tokenAcl' in retained.receipt!.snapshots[0], false);
		assert.deepEqual(retained.receipt!.snapshots[0].acl, ['tt:user']);
	} finally { await f.db.close(); }
});

test('wrong-scope receipts and retired leases cannot acknowledge an installation', async () => {
	let reconciled = false;
	const f = setup(async () => { reconciled = true; });
	try {
		await f.suites.install(key);
		const intent = (await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))!;
		await f.suites.sync({ install: async () => receipt(intent, { ownerId: 'another-owner' }) });
		assert.equal(reconciled, false);
		assert.equal((await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))?.remote, undefined);
		f.tick();
		await f.suites.sync({ install: async () => receipt(intent, { bundleVersion: 'changed-bundle' }) });
		assert.equal(reconciled, false);
		assert.equal((await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))?.remote, undefined);
		f.tick();
		await assert.rejects(f.suites.sync({ install: async () => { f.retire(); return receipt(intent); } }), /Workspace changed/);
		assert.equal(reconciled, false);
	} finally { await f.db.close(); }
});

test('suite bundle identity ignores object insertion order and changes with executable bundle content', async () => {
	const suite = ALL_SUITES.find(suite => suite.key === key)!;
	const first = await suiteBundleVersion(suite);
	assert.match(first, /^suite-bundle-v1:[a-f0-9]{64}$/);
	assert.equal(await suiteBundleVersion(Object.fromEntries(Object.entries(suite).reverse()) as typeof suite), first);
	assert.notEqual(await suiteBundleVersion({ ...suite, title: `${suite.title} revised` }), first);
});

test('lost suite response retries the exact operation and digest while independent content can still save', async () => {
	const f = setup();
	try {
		await f.suites.install(key);
		const intent = (await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))!, requests: unknown[] = [];
		const transport = { install: async (request: unknown): Promise<InstallSuiteResult> => { requests.push(structuredClone(request)); throw new Error('Lost response'); } };
		await f.suites.sync(transport);
		const unrelated = await f.sync.things.create({ thingtime: ['data'], crystal: { text: 'Independent offline work' } });
		assert.equal((await f.sync.things.get(unrelated.id)).crystal.text, 'Independent offline work');
		f.tick(); await f.suites.sync(transport);
		assert.deepEqual(requests, [intent.request, intent.request]);
		assert.equal((await f.suites.status())[0].state, 'pending');
	} finally { await f.db.close(); }
});

test('safe reconciliation blockers remain actionable and incompatible bundle refusals do not loop', async () => {
	const message = 'An open editor draft needs to be saved before suite identity adoption.';
	const f = setup(async () => { throw new WorkspaceError('SUITE_RECONCILE_CONFLICT', message, 409); });
	try {
		await f.suites.install(key);
		const intent = (await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))!;
		await f.suites.sync({ install: async () => receipt(intent) });
		assert.equal((await f.suites.status())[0].error, message);
		assert.equal((await f.suites.status())[0].errorCode, 'SUITE_RECONCILE_CONFLICT');
		assert.equal((await f.suites.status())[0].state, 'error');
		await f.db.transaction(scope, 'readwrite', f.lease, tx => tx.put(ACCOUNT_SUITE_INSTALLS, key, { ...intent, state: 'pending' }));
		let writes = 0;
		const transport = { install: async (): Promise<InstallSuiteResult> => {
			writes++;
			throw new WorkspaceError('SUITE_BUNDLE_CHANGED', 'Account sync needs version-compatible server support or explicit recovery; updating the app alone does not change this saved request.', 409);
		} };
		await f.suites.sync(transport); f.tick(); await f.suites.sync(transport);
		assert.equal(writes, 1);
		assert.equal((await f.suites.status())[0].errorCode, 'SUITE_BUNDLE_CHANGED');
		await assert.rejects(f.suites.retry(key), /updating the app alone does not change this saved request/);
		assert.equal((await f.sync.things.create({ thingtime: ['data'], crystal: { text: 'Independent work stays available' } })).crystal.text, 'Independent work stays available');
		await f.db.close();
		const reopened = new WorkspaceDatabase(f.factory, undefined, undefined, IDBKeyRange), recoveredContent = new AccountThingSync(reopened, scope, f.lease);
		const recovered = new AccountSuiteSync(reopened, scope, f.lease, recoveredContent, async () => {});
		const suite = ALL_SUITES.find(suite => suite.key === key)!, title = suite.title;
		try {
			suite.title += ' application update';
			assert.notEqual(await suiteBundleVersion(suite), intent.request.bundleVersion);
			assert.deepEqual(await recovered.install(key), intent.local, 'An app update must not silently replace the frozen graph.');
			const preserved = await reopened.transaction(scope, 'readonly', f.lease, tx => tx.get<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key));
			assert.deepEqual(preserved!.request, intent.request);
			assert.equal(preserved!.state, 'error');
			assert.match((await recovered.status())[0].error!, /updating the app alone does not change this saved request/);
			assert.equal((await recoveredContent.things.snapshot()).length > 0, true);
		} finally { suite.title = title; await reopened.close(); }
	} finally { await f.db.close(); }
});

test('outgoing suite requests are exact immutable clones and malformed saved requests never send', async () => {
	const f = setup();
	try {
		await f.suites.install(key);
		const intent = (await f.read<AccountSuiteIntent>(ACCOUNT_SUITE_INSTALLS, key))!;
		let calls = 0;
		await f.suites.sync({ install: async request => {
			calls++;
			assert.equal(Object.isFrozen(request), true);
			assert.deepEqual(request, intent.request);
			assert.notEqual(request, intent.request);
			throw new Error('Expected offline request');
		} });
		f.tick();
		await f.db.transaction(scope, 'readwrite', f.lease, tx => tx.put(ACCOUNT_SUITE_INSTALLS, key, {
			...intent, request: { ...intent.request, unexpected: 'not permitted' }
		}));
		await f.suites.sync({ install: async () => { calls++; return receipt(intent); } });
		assert.equal(calls, 1);
		assert.equal((await f.suites.status())[0].state, 'error');
		for (const id of installedSuiteIds(intent.local)) assert.ok(await f.read(ACCOUNT_SUITE_PARTS, id));
	} finally { await f.db.close(); }
});
