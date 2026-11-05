import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalThings, type LocalThing } from './things';
import { LocalTimeline } from './timeline';
import { localRelatedThingIds } from './timelineRelated';
import { WorkspaceDatabase, type WorkspaceTransaction } from './storage';
import { parseRelatedTimelineScope } from '../timeline/relatedHistory';
import type { TimelinePageRequest } from '../timeline/sync';

const scope = { kind: 'anonymous' as const },
	lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const query = (id: string, extra: Partial<TimelinePageRequest> = {}): TimelinePageRequest => ({
	thingId: id,
	related: true,
	before: null,
	after: null,
	limit: 40,
	...extra
});
const card = (name: string, source?: string) => ({
	name,
	componentKey: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
	version: 1,
	render: { tag: 'p', children: name },
	...(source ? { source: { action: source } } : {})
});
const block = (component: string, args?: Record<string, unknown>, id = `block-${component.slice(-12)}`) => ({
	id,
	type: 'component',
	component,
	...(args ? { args } : {})
});
class ObservedDatabase extends WorkspaceDatabase {
	afterRead?: () => Promise<void>;
	override async transaction<T>(...args: Parameters<WorkspaceDatabase['transaction']>): Promise<T> {
		const result = await super.transaction(...args);
		if (args[1] === 'readonly' && this.afterRead) {
			const run = this.afterRead;
			this.afterRead = undefined;
			await run();
		}
		return result as T;
	}
}
async function fixture() {
	const factory = new IDBFactory(),
		db = new ObservedDatabase(factory),
		things = new LocalThings(db, scope, lease),
		history = new LocalTimeline(db, lease, 'https://local-related.example');
	const schema = await things.create({ thingtime: ['schema'], crystal: { name: 'Related schema', fields: [{ name: 'title', type: 'string' }] } });
	const data = await things.create({ thingtime: ['data'], crystal: { title: 'Related data', schemaId: schema.id } });
	const action = await things.create({
		thingtime: ['action'],
		crystal: {
			name: 'Read local data',
			actionKey: 'read-local',
			capabilities: [{ capability: 'things.read' }],
			steps: [
				{ op: 'things.get', id: data.id },
				{ op: 'return', value: 'Never executed' }
			]
		}
	});
	const component = await things.create({ thingtime: ['component'], crystal: card('related-card', action.id) });
	const root = await things.create({ thingtime: ['webpage'], crystal: { name: 'Related page', blocks: [block('related-card')] } });
	return { factory, db, things, history, schema, data, action, component, root };
}

test('related local History traverses canonical five-kind content without requests or Action execution, and survives reopen', async () => {
	const h = await fixture(),
		originalFetch = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = async () => {
		requests++;
		throw new Error('No networking');
	};
	try {
		const unrelated = await h.things.create({ thingtime: ['data'], crystal: { name: 'Unrelated' } });
		const result = await h.history.page(query(h.root.id));
		const ids = [h.root, h.component, h.action, h.data, h.schema].map((row) => row.id).sort();
		assert.deepEqual(result.related?.thingIds, ids);
		assert.equal(result.related?.sharedCount, 0);
		assert.equal(
			result.related?.revision,
			createHash('sha256')
				.update(JSON.stringify([h.root.id, ids, 0]))
				.digest('hex')
		);
		parseRelatedTimelineScope(result.related, h.root.id);
		assert.equal(result.entries.length, 5);
		assert.ok(result.entries.every((row) => ids.includes(row.event.thingId)));
		assert.equal(JSON.stringify(result).includes(unrelated.id), false);
		assert.equal((await h.things.list({ thingtime: 'action-run' })).things.length, 0);
		await h.db.close();
		const reopened = new WorkspaceDatabase(h.factory);
		try {
			assert.deepEqual(await new LocalTimeline(reopened, lease, 'https://local-related.example').page(query(h.root.id)), result);
		} finally {
			await reopened.close();
		}
		assert.equal(requests, 0);
	} finally {
		globalThis.fetch = originalFetch;
		await h.db.close();
	}
});

test('related paging preserves both cursor directions and resets when old dependencies are added or removed', async () => {
	const h = await fixture();
	try {
		const old = await h.things.create({ thingtime: ['component'], crystal: card('older-card') });
		await h.things.update({ id: h.root.id, crystal: { name: 'New page name' } });
		const current = await h.history.page(query(h.root.id)),
			all = [];
		let before: number | null = null;
		do {
			const part = await h.history.page(query(h.root.id, { limit: 2, before, relatedRevision: current.related!.revision }));
			all.push(...part.entries);
			before = part.nextBefore;
		} while (before !== null);
		assert.deepEqual(all, current.entries);
		const newest = current.entries[0].receipt.position;
		await h.things.update({ id: h.component.id, crystal: { name: 'Edited component' } });
		const live = await h.history.page(query(h.root.id, { after: newest, relatedRevision: current.related!.revision }));
		assert.deepEqual(
			live.entries.map((row) => row.event.thingId),
			[h.component.id]
		);
		assert.equal(live.related!.revision, current.related!.revision);
		await h.things.update({ id: h.root.id, crystal: { blocks: [block(h.component.id), block(old.id)] } });
		const added = await h.history.page(query(h.root.id, { after: live.entries[0].receipt.position, relatedRevision: current.related!.revision }));
		assert.equal(added.reset, true);
		assert.ok(added.entries.some((row) => row.event.thingId === old.id && row.receipt.position < newest));
		await h.things.update({ id: h.root.id, crystal: { blocks: [block(old.id)] } });
		const removed = await h.history.page(query(h.root.id, { before: newest, relatedRevision: added.related!.revision }));
		assert.equal(removed.reset, true);
		assert.deepEqual(removed.related!.thingIds, [old.id, h.root.id].sort());
		assert.ok(removed.entries.every((row) => removed.related!.thingIds.includes(row.event.thingId)));
	} finally {
		await h.db.close();
	}
});

test('stored component instances and saved args contribute Actions; metadata, runtime inputs and older key versions do not', async () => {
	const h = await fixture();
	try {
		const actions = [];
		for (const name of ['saved', 'one', 'two', 'unrelated'])
			actions.push(
				await h.things.create({ thingtime: ['action'], crystal: { name, actionKey: name, capabilities: [], steps: [{ op: 'return', value: name }] } })
			);
		await h.things.update({
			id: h.component.id,
			crystal: {
				args: [{ name: 'action', type: 'string', default: 'unrelated' }],
				savedArgs: { action: 'saved' },
				source: null,
				render: { tag: 'button', ttAction: '{action}', ttActionInputs: { ttAction: 'unrelated' }, children: 'Run' }
			}
		});
		await h.things.update({
			id: h.root.id,
			crystal: { blocks: [block('related-card', { action: 'one' }, 'one'), block('related-card', { action: 'two' }, 'two')] }
		});
		const result = await h.history.page(query(h.root.id));
		assert.deepEqual(result.related!.thingIds, [h.root.id, h.component.id, ...actions.slice(0, 3).map((row) => row.id)].sort());
		const replacement = await h.things.create({
			thingtime: ['component'],
			crystal: { ...card('replacement'), componentKey: 'related-card', version: 2 }
		});
		const next = await h.history.page(query(h.root.id, { after: result.entries[0].receipt.position, relatedRevision: result.related!.revision }));
		assert.equal(next.reset, true);
		assert.deepEqual(next.related!.thingIds, [h.root.id, replacement.id].sort());
	} finally {
		await h.db.close();
	}
});

test('related discovery excludes account partitions and public caches, and rejects non-page, missing, deleted and malformed roots', async () => {
	const h = await fixture();
	try {
		const account = new LocalThings(
			h.db,
			{ kind: 'account', ownerId: 'private-owner', origin: 'https://local-related.example', dataPlane: 'home' },
			lease
		);
		const remote = await account.create({ thingtime: ['component'], crystal: card('Private component') });
		const remotePage = await account.create({ thingtime: ['webpage'], crystal: { name: 'Private page', blocks: [] } });
		await h.db.transaction(scope, 'readwrite', lease, (tx) => tx.put('public-catalog', remote.id, remote));
		await h.things.update({ id: h.root.id, crystal: { blocks: [block(h.component.id), block(remote.id)] } });
		const result = await h.history.page(query(h.root.id));
		assert.ok(!result.related!.thingIds.includes(remote.id));
		assert.ok(result.entries.every((row) => row.event.thingId !== remote.id));
		assert.equal(JSON.stringify(result).includes('Private component'), false);
		for (const id of [h.component.id, remotePage.id, 'absent']) await assert.rejects(h.history.page(query(id)), /Open a page/);
		for (const extra of [{ after: 1 }, { relatedRevision: 'invalid' }, { before: 1, after: 2 }])
			await assert.rejects(h.history.page(query(h.root.id, extra)), /Invalid/);
		await assert.rejects(h.history.page({ ...query(h.root.id), related: undefined, relatedRevision: result.related!.revision }), /requires Page/);
		await h.things.remove([h.root.id]);
		await assert.rejects(h.history.page(query(h.root.id)), /Open a page/);
	} finally {
		await h.db.close();
	}
});

test('membership changes between hashing and the final read reject stale results, with successful explicit refresh', async () => {
	const h = await fixture();
	try {
		h.db.afterRead = async () => {
			await h.things.update({ id: h.root.id, crystal: { blocks: [] } });
		};
		await assert.rejects(h.history.page(query(h.root.id)), /changed while loading/);
		assert.deepEqual((await h.history.page(query(h.root.id))).related!.thingIds, [h.root.id]);
		const abort = new AbortController();
		h.db.afterRead = async () => {
			abort.abort();
		};
		await assert.rejects(h.history.page(query(h.root.id), abort.signal), /aborted/i);
		let active = true;
		const retiring = new LocalTimeline(
			h.db,
			{
				assertCurrent() {
					if (!active) throw new Error('Retired workspace');
				},
				onInvalidate: () => () => {}
			},
			'https://local-related.example'
		);
		h.db.afterRead = async () => {
			active = false;
		};
		await assert.rejects(retiring.page(query(h.root.id)), /Retired workspace/);
	} finally {
		await h.db.close();
	}
});

test('related discovery bounds distinct Things, edges and render contexts and safely terminates stored cycles', async () => {
	const now = new Date().toISOString();
	const row = (id: string, kind: string, crystal: Record<string, any>): LocalThing => ({
		id,
		thingtime: [kind],
		crystal,
		revision: 1,
		createdAt: now,
		updatedAt: now
	});
	const read = (rows: LocalThing[]) =>
		localRelatedThingIds({ list: async () => rows.map((value) => ({ id: value.id, value })) } as unknown as WorkspaceTransaction, 'page');
	const components = Array.from({ length: 128 }, (_, n) => row(`c-${n}`, 'component', card(`c-${n}`)));
	await assert.rejects(read([row('page', 'webpage', { blocks: components.map((c) => block(c.id)) }), ...components]), /too many related Things/);
	const repeated = (count: number) => [
		row('page', 'webpage', { blocks: Array.from({ length: count }, (_, n) => block('card', { n }, String(n))) }),
		row('card', 'component', card('card'))
	];
	await assert.rejects(read(repeated(513)), /too many related references/);
	await assert.rejects(read(repeated(512)), /too many related render contexts/);
	const cycle = [
		row('page', 'webpage', { blocks: [block('card')] }),
		row('card', 'component', card('card', 'action')),
		row('action', 'action', { steps: [{ op: 'actions.invoke', action: 'action' }] })
	];
	assert.deepEqual(await read(cycle), ['action', 'card', 'page']);
});

test('related metadata and large revisions stay within the existing page byte ceiling', async () => {
	const h = await fixture();
	try {
		for (let n = 0; n < 4; n++)
			await h.things.update({ id: h.data.id, crystal: { title: `Large ${n}`, body: Array.from({ length: 160 }, () => 'x'.repeat(5000)) } });
		let before: number | null = null,
			count = 0,
			revision: string | undefined;
		do {
			const page = await h.history.page(query(h.root.id, { before, relatedRevision: revision }));
			assert.ok(new TextEncoder().encode(JSON.stringify(page)).length < 4 * 1024 * 1024 + 4096);
			count += page.entries.length;
			before = page.nextBefore;
			revision = page.related!.revision;
		} while (before !== null);
		assert.equal(count, 9);
	} finally {
		await h.db.close();
	}
});
