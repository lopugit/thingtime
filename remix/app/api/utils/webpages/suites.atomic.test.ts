import assert from 'node:assert/strict';
import test from 'node:test';
import { createSuiteInstaller, SuiteInstallAdmissionError } from './suites';
import { ALL_SUITES } from '../../../schemas/appSuites';
import { suiteBundleVersion } from '../../../schemas/suiteInstallation';
import { StorageMutationError } from '../storage/storageCore';
const owner = { id: 'suite-owner' }, origin = 'https://suite.example', suite = ALL_SUITES.find(suite => suite.key === 'guestbook')!;
const uuid = '123e4567-e89b-42d3-a456-426614174000';
const options = async (requestId = uuid) => ({ onlyMissing: true, requestId, bundleVersion: await suiteBundleVersion(suite), origin, dataPlane: 'home', admit: async () => {} });
function fixture() {
	let docs: any[] = [], events: any[] = [], queue = Promise.resolve(), next = 0, creates = 0, updates = 0, effects = 0, failAfter = Infinity;
	const collection = { find(query: any, { session }: any) {
		assert.equal(session.active, true);
		let rows = session.docs.filter((doc: any) => Object.entries(query).every(([key, expected]: any) => {
			const actual = key.split('.').reduce((value: any, key: string) => value?.[key], doc);
			if (expected?.$exists !== undefined) return (actual !== undefined) === expected.$exists;
			if (expected?.$in) return expected.$in.includes(actual);
			return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
		}));
		return { sort() { rows = rows.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt) || a.shareId.localeCompare(b.shareId)); return this; }, async toArray() { return structuredClone(rows); } };
	} };
	const suites = [suite];
	const install = createSuiteInstaller({ suites, getThingsCollection: async () => collection as any,
		withMongoTransaction: async (work: any) => {
			const previous = queue; let release!: () => void; queue = new Promise(resolve => { release = resolve; }); await previous;
			const session = { active: true, docs: structuredClone(docs), events: structuredClone(events), inTransaction: () => true };
			try { const result = await work(session); docs = session.docs; events = session.events; return result; } finally { session.active = false; release(); }
		},
		lockTimelineOwner: async (_things: any, _owner: any, session: any) => { assert.equal(session.active, true); return {} as any; },
		createThing: async (ownerId: string, input: any, _viewer: any, _app: any, hooks: any) => {
			if (++creates === failAfter) throw new StorageMutationError(402, 'quota_exceeded', 'Storage quota exceeded');
			const now = new Date(1700000000000 + ++next).toISOString();
			const doc = { shareId: `part-${next}`, ownerId, ...structuredClone(input), createdAt: now, updatedAt: now, extended: null, tags: [], folderId: null, targetId: null };
			hooks.transaction.session.docs.push(doc); hooks.transaction.afterCommit(async () => { effects++; }); return { ok: true, doc } as any;
		},
		updateThing: async (_viewer: any, id: any, input: any, opts: any) => { updates++; opts.transaction.session.docs.find((doc: any) => doc.shareId === id).crystal = input.crystal; return { ok: true } as any; },
		toPublicThings: async (rows: any[]) => rows.map(doc => ({ id: doc.shareId, thingtime: doc.thingtime, crystal: doc.crystal, extended: doc.extended, tags: doc.tags,
			folderId: doc.folderId, targetId: doc.targetId, acl: doc.acl, ...(doc.linkKey ? { linkKey: doc.linkKey } : {}), ...(doc.tokenAcl ? { tokenAcl: doc.tokenAcl } : {}), visibility: doc.acl.includes('tt:all') ? 'public' : doc.acl.includes('tt:hidden') ? 'hidden' : 'private', author: { id: doc.ownerId }, createdAt: doc.createdAt, updatedAt: doc.updatedAt })) as any,
		appendTimelineEvent: async (_things: any, event: any, session: any) => { session.events.push(structuredClone(event)); return {} as any; },
		readTimelineEntries: async (_things: any, ownerId: string, ids: string[], session: any) => session.events.filter((event: any) => event.ownerId === ownerId && ids.includes(event.id)).map((event: any) => ({ event }))
	});
	return { install, suites, docs: () => docs, events: () => events, counts: () => ({ creates, updates, effects }), failAt: (count: number) => { failAfter = count; } };
}
test('concurrent installations bind one canonical identity set and preserve existing onlyMissing content', async () => {
	const f = fixture(), opts = await options();
	const [a, b] = await Promise.all([f.install(owner, suite.key, opts), f.install(owner, suite.key, { ...opts, requestId: '223e4567-e89b-42d3-a456-426614174000' })]);
	assert.equal(a.ok, true); assert.equal(b.ok, true); if (!a.ok || !b.ok) return;
	for (const key of ['schemaIds', 'componentIds', 'actionIds', 'pageIds', 'dataIds'] as const) assert.deepEqual(a[key], b[key]);
	assert.ok(a.created > 0); assert.equal(b.created, 0); assert.equal(f.docs().length, a.created); assert.equal(f.counts().effects, a.created);
	const customized = f.docs().find(doc => doc.thingtime.includes('component')); customized.crystal.name = 'My customized control'; customized.acl = ['tt:all'];
	const c = await f.install(owner, suite.key, { ...opts, requestId: '323e4567-e89b-42d3-a456-426614174000' });
	assert.equal(c.ok, true); if (!c.ok) return; assert.equal(c.created, 0); assert.equal(c.updated, 0);
	const snapshot = c.receipt!.snapshots.find(doc => doc.id === customized.shareId)!;
	assert.equal(snapshot.crystal.name, 'My customized control'); assert.deepEqual(snapshot.acl, ['tt:all']); assert.equal(snapshot.visibility, 'public'); assert.equal(f.counts().updates, 0);
});
test('lost reply replays exact original snapshot after later account or bundled-definition changes', async () => {
	const f = fixture(), opts = await options(), first = await f.install(owner, suite.key, opts); assert.equal(first.ok, true);
	const counts = f.counts(), eventCount = f.events().length;
	f.docs()[0].crystal.name = 'A later account edit'; const oldTitle = suite.title; suite.title = 'A later bundled revision';
	try { assert.deepEqual(await f.install(owner, suite.key, opts), first); } finally { suite.title = oldTitle; }
	f.suites.length = 0; assert.deepEqual(await f.install(owner, suite.key, opts), first, 'A prior receipt survives removal from the bundled catalogue');
	assert.deepEqual(f.counts(), counts); assert.equal(f.events().length, eventCount);
});
test('quota or final admission failure rolls back every part, receipt and side effect', async () => {
	const f = fixture(); f.failAt(3); const denied = await f.install(owner, suite.key, await options());
	assert.equal(denied.ok, false); if (denied.ok) return; assert.equal(denied.status, 402);
	assert.equal(f.docs().length, 0); assert.equal(f.events().length, 0); assert.equal(f.counts().effects, 0);
	const g = fixture(); let admissions = 0;
	const changed = await g.install(owner, suite.key, { ...await options(), admit: async () => { if (++admissions > 1) throw new SuiteInstallAdmissionError(409); } });
	assert.equal(changed.ok, false); if (changed.ok) return; assert.equal(changed.status, 409);
	assert.equal(g.docs().length, 0); assert.equal(g.events().length, 0); assert.equal(g.counts().effects, 0);
});
test('request identity cannot be reused for another origin, plane or bundled version', async () => {
	const f = fixture(), opts = await options(); await f.install(owner, suite.key, opts); const count = f.docs().length;
	for (const mismatch of [{ origin: 'https://other.example' }, { dataPlane: 'custom-' + 'a'.repeat(64) }, { bundleVersion: 'suite-bundle-v1:' + 'a'.repeat(64) }]) {
		const result = await f.install(owner, suite.key, { ...opts, ...mismatch }); assert.equal(result.ok, false); if (result.ok) return; assert.equal(result.status, 409); assert.equal(result.code, undefined, 'Reusing a committed operation is an identity/content conflict, not an update hint');
	}
	assert.equal(f.docs().length, count);
	const g = fixture(), changed = await g.install(owner, suite.key, { ...opts, bundleVersion: 'suite-bundle-v1:' + 'a'.repeat(64) }); assert.equal(changed.ok, false); if (changed.ok) return; assert.equal(changed.code, 'SUITE_BUNDLE_CHANGED'); assert.equal(g.docs().length, 0); assert.equal(g.events().length, 0); assert.equal(g.counts().creates, 0);
	const other = await f.install({ id: 'different-owner' }, suite.key, opts); assert.equal(other.ok, true); if (!other.ok) return;
	assert.notDeepEqual(other.componentIds, (await f.install(owner, suite.key, opts) as any).componentIds);
});
test('legacy installer calls also use atomic serialization', async () => {
	const f = fixture(), [a, b] = await Promise.all([f.install(owner, suite.key), f.install(owner, suite.key)]);
	assert.equal(a.ok, true); assert.equal(b.ok, true); if (!a.ok || !b.ok) return; assert.equal(b.created, 0); assert.deepEqual(a.pageIds, b.pageIds);
});

test('large customized parts replay exact chunked snapshots without hidden-link or token grants', async () => {
	const f = fixture(), opts = await options(); await f.install(owner, suite.key, opts);
	const part = f.docs().find(doc => doc.thingtime.includes('component'));
	part.crystal.description = '🧭'.repeat(1_100_000); part.linkKey = 'fixture-hidden-bearer'; part.tokenAcl = ['tt:token/fixture']; part.acl = ['tt:hidden'];
	const request = { ...opts, requestId: '423e4567-e89b-42d3-a456-426614174000' };
	const installed = await f.install(owner, suite.key, request); assert.equal(installed.ok, true); if (!installed.ok) return;
	const snapshot = installed.receipt!.snapshots.find(row => row.id === part.shareId)!;
	assert.equal(snapshot.crystal.description, part.crystal.description); assert.equal('linkKey' in snapshot, false); assert.equal('tokenAcl' in snapshot, false);
	assert.ok(f.events().filter(event => event.operationId === request.requestId && event.after.adapter === 'suite-install-part').length > installed.receipt!.snapshots.length);
	assert.deepEqual(await f.install(owner, suite.key, request), installed);
});
