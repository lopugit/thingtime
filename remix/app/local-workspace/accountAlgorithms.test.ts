import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import {
	AccountAlgorithmSync,
	parseAccountAlgorithmSnapshot,
	type AccountAlgorithmSnapshot,
	type AccountAlgorithmTransport
} from './accountAlgorithms';
import { LocalAlgorithms } from './algorithms';
import { LocalThings } from './things';
import { WorkspaceDatabase, WorkspaceError } from './storage';
import { parseAlgorithmWrite, type AlgorithmWrite, type AlgorithmWriteAcknowledgment } from '../api/utils/algorithms/algorithmSyncContract';
const scope = { kind: 'account', ownerId: 'owner', origin: 'https://algorithm.test', dataPlane: 'home' } as const;
const version = (n: number) => 'algorithm-state-v1:' + n.toString(16).padStart(64, '0');
const saved = (id: string = randomUUID(), n = 1): AccountAlgorithmSnapshot => ({
	id,
	version: version(n),
	content: {
		name: 'Reading',
		emoji: '🧠',
		weights: { types: { text: 1 }, tags: { kindness: 2 }, authors: {} },
		eventCount: 3,
		lastTrainedAt: '2026-10-18T00:00:00.000Z'
	},
	description: 'Private profile',
	parentId: null,
	shared: false,
	listed: false,
	folderId: null,
	legacy: false,
	createdAt: '2026-10-18T00:00:00.000Z',
	updatedAt: '2026-10-18T00:00:00.000Z'
});
function fixture() {
	let now = Date.parse('2026-10-18T01:00:00Z'),
		live = true;
	const callbacks = new Set<() => void>();
	const db = new WorkspaceDatabase(new IDBFactory()),
		lease = {
			assertCurrent() {
				if (!live) throw new WorkspaceError('WORKSPACE_CHANGED', 'Changed account', 409);
			},
			onInvalidate(cb: () => void) {
				callbacks.add(cb);
				return () => {
					callbacks.delete(cb);
				};
			}
		};
	const sync = new AccountAlgorithmSync(db, scope, lease, () => now, randomUUID);
	return {
		db,
		lease,
		sync,
		now: () => now,
		advance() {
			now += 100000;
		},
		retire() {
			live = false;
			callbacks.forEach((cb) => cb());
		}
	};
}
function server(initial: AccountAlgorithmSnapshot[] = []) {
	let serial = 10;
	const rows = new Map(initial.map((row) => [row.id, structuredClone(row)])),
		calls: AlgorithmWrite[] = [],
		receipts = new Map<string, { body: string; ack: AlgorithmWriteAcknowledgment }>();
	const transport: AccountAlgorithmTransport = {
		snapshot: async () => structuredClone([...rows.values()]),
		write: async (input) => {
			const command = parseAlgorithmWrite(input);
			calls.push(structuredClone(command));
			const body = JSON.stringify(command),
				prior = receipts.get(command.writeId);
			if (prior) {
				assert.equal(body, prior.body);
				return prior.ack;
			}
			const before = rows.get(command.id);
			if ((before?.version ?? null) !== command.expectedVersion) throw new WorkspaceError('CONFLICT', 'Changed profile', 409);
			const resultVersion = command.action === 'save' ? version(++serial) : null;
			if (command.action === 'save')
				rows.set(command.id, {
					...saved(command.id),
					...before,
					version: resultVersion!,
					content: command.content,
					description: command.description,
					parentId: command.parentId ?? before?.parentId ?? null
				});
			else rows.delete(command.id);
			const ack = { id: command.id, writeId: command.writeId, expectedVersion: command.expectedVersion, action: command.action, resultVersion };
			receipts.set(command.writeId, { body, ack });
			return ack;
		}
	};
	return { rows, calls, transport };
}
const posts = [{ id: 'public-post', type: 'text', tags: ['kindness'], author: { id: 'author' }, createdAt: '2026-10-18T00:00:00.000Z' }];
test('account algorithm writes, training and export finish locally without adopting anonymous profiles', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	const anon = new LocalAlgorithms(f.db, f.lease),
		a = (await anon.create({ name: 'Anonymous' })).algorithm;
	const created = (await f.sync.algorithms.create({ name: 'Account' })).algorithm;
	assert.ok(!created.id.startsWith('local-'));
	assert.equal((await f.sync.status())[0].state, 'pending');
	await f.sync.algorithms.observePublicPosts(posts);
	await f.sync.algorithms.track({ algorithmId: created.id, events: [{ thingId: 'public-post', signal: 'react' }] });
	assert.equal((await f.sync.list()).algorithms[0].eventCount, 1);
	assert.equal((await anon.list()).algorithms[0].id, a.id);
	const things = new LocalThings(f.db, scope, f.lease),
		manifest = (await things.export([created.id])).manifest;
	assert.equal(manifest.things[0].crystal.eventCount, 1);
	assert.ok(!JSON.stringify(manifest).includes('writeId'));
	await assert.rejects(things.update({ id: created.id, crystal: { name: 'Bypass' } }), /dedicated/);
	await f.sync.algorithms.remove(created.id);
	assert.equal((await f.sync.status()).length, 0);
	assert.equal((await anon.list()).algorithms.length, 1);
	assert.throws(() => new AccountAlgorithmSync(f.db, { kind: 'anonymous' } as any, f.lease), /never synchronize/);
	assert.throws(() => new AccountAlgorithmSync(f.db, { ...scope, dataPlane: 'custom-' + 'a'.repeat(64) }, f.lease), /home workspace/);
});
test('canonical writer callbacks commit with content, selection and deletion or roll back together', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	let refuse = false;
	const local = new LocalAlgorithms(f.db, f.lease, {
		scope,
		onWrite: async () => {
			if (refuse) throw Error('Queue failed');
		},
		onActive: async () => {
			if (refuse) throw Error('Selection failed');
		}
	});
	const row = (await local.create({ name: 'Original' })).algorithm;
	refuse = true;
	await assert.rejects(local.update({ id: row.id, name: 'Lost edit' }), /Queue failed/);
	assert.equal((await local.list()).algorithms[0].name, 'Original');
	await assert.rejects(local.setActive(row.id), /Selection failed/);
	assert.equal((await local.list()).activeAlgorithmId, null);
	await assert.rejects(local.remove(row.id), /Queue failed/);
	assert.equal((await local.list()).algorithms.length, 1);
});
test('lost response retries exactly while a newer local edit remains independent', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	const s = server(),
		row = (await f.sync.algorithms.create({ name: 'Original' })).algorithm;
	let lost = true;
	const transport = {
		...s.transport,
		write: async (command: AlgorithmWrite, signal: AbortSignal) => {
			const ack = await s.transport.write(command, signal);
			if (lost) {
				lost = false;
				throw Error('Lost response');
			}
			return ack;
		}
	};
	assert.equal((await f.sync.sync(transport)).completed, 0);
	await f.sync.algorithms.update({ id: row.id, name: 'New device edit' });
	await f.sync.algorithms.observePublicPosts(posts);
	await f.sync.algorithms.track({ algorithmId: row.id, events: [{ thingId: 'public-post', signal: 'react' }] });
	f.advance();
	assert.equal((await f.sync.sync(transport)).completed, 2);
	assert.equal(s.calls.length, 3);
	assert.deepEqual(s.calls[0], s.calls[1]);
	assert.notEqual(s.calls[1].writeId, s.calls[2].writeId);
	assert.equal(s.rows.get(row.id)!.content.name, 'New device edit');
	assert.equal(s.rows.get(row.id)!.content.eventCount, 1);
	assert.equal(s.rows.size, 1);
	assert.equal((await f.sync.status())[0].state, 'synced');
	await f.sync.refresh(s.transport);
	assert.equal((await f.sync.status())[0].base!.version, s.rows.get(row.id)!.version);
	assert.equal((await f.sync.list()).algorithms[0].name, 'New device edit');
});
test('complete snapshots preserve pending edits, fence stale reads and reject malformed catalogues before removal', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	const remote = saved(),
		s = server([remote]);
	await f.sync.refresh(s.transport);
	for (const bad of [
		[{ ...remote, ownerId: 'other' }],
		[remote, remote],
		[{ ...remote, content: { ...remote.content, eventCount: -1 } }],
		[{ ...remote, legacy: undefined }],
		[{ ...remote, updatedAt: 'bad' }]
	])
		assert.throws(() => parseAccountAlgorithmSnapshot(bad));
	const ticket = await f.sync.beginRead();
	await f.sync.algorithms.update({ id: remote.id, name: 'Device' });
	assert.equal(await f.sync.remember([], ticket), false);
	await assert.rejects(f.sync.remember([{ ...remote, content: {} }], await f.sync.beginRead()));
	assert.equal((await f.sync.list()).algorithms[0].name, 'Device');
	await f.sync.refresh(s.transport);
	assert.equal((await f.sync.list()).algorithms[0].name, 'Device');
	const other = new AccountAlgorithmSync(f.db, { ...scope, ownerId: 'other' }, f.lease);
	assert.equal((await other.list()).algorithms.length, 0);
});
test('two tabs cannot send the same live claim and deletion during creation is preserved', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	const s = server(),
		row = (await f.sync.algorithms.create({ name: 'Transient' })).algorithm;
	let release!: () => void, started!: () => void;
	const ready = new Promise<void>((resolve) => {
			started = resolve;
		}),
		gate = new Promise<void>((resolve) => {
			release = resolve;
		});
	const transport = {
		...s.transport,
		write: async (command: AlgorithmWrite, signal: AbortSignal) => {
			const ack = await s.transport.write(command, signal);
			started();
			await gate;
			return ack;
		}
	};
	const running = f.sync.sync(transport, undefined, 1);
	await ready;
	const second = new AccountAlgorithmSync(f.db, scope, f.lease, f.now, randomUUID);
	assert.equal((await second.sync(s.transport)).completed, 0);
	const ticket = await f.sync.beginRead();
	await second.algorithms.remove(row.id);
	release();
	await running;
	assert.equal((await f.sync.status())[0].state, 'pending');
	assert.equal((await f.sync.list()).algorithms.length, 0);
	assert.equal((await second.sync(s.transport)).completed, 1);
	assert.equal(s.rows.size, 0);
	assert.equal(await second.remember([saved(row.id)], ticket), false);
	await second.remember([saved(row.id)], await second.beginRead());
	assert.equal((await second.list()).algorithms.length, 0);
});
test('stale-profile conflict requires fresh review and can preserve an independent private copy', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	const remote = saved(),
		s = server([remote]);
	await f.sync.refresh(s.transport);
	await f.sync.algorithms.update({ id: remote.id, name: 'Device' });
	s.rows.set(remote.id, { ...remote, version: version(2), content: { ...remote.content, name: 'Remote' } });
	await f.sync.sync(s.transport);
	assert.equal((await f.sync.status())[0].state, 'conflict');
	await assert.rejects(f.sync.retry(remote.id), /Review/);
	const review = await f.sync.inspect(remote.id, s.transport);
	await f.sync.algorithms.update({ id: remote.id, name: 'Newer device' });
	await assert.rejects(f.sync.resolve(review, 'local', s.transport), /Device algorithm changed/);
	const fresh = await f.sync.inspect(remote.id, s.transport);
	const { copyId } = await f.sync.resolve(fresh, 'copy', s.transport);
	assert.ok(copyId);
	assert.notEqual(copyId, remote.id);
	await f.sync.sync(s.transport);
	assert.equal(s.rows.get(remote.id)!.content.name, 'Remote');
	assert.equal(s.rows.get(copyId!)!.content.name, 'Newer device (device copy)');
	assert.equal(s.rows.get(copyId!)!.shared, false);
});
test('changed remote review, forged acknowledgment and expired identity cannot replace device work', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	const remote = saved(),
		s = server([remote]);
	await f.sync.refresh(s.transport);
	await f.sync.algorithms.update({ id: remote.id, name: 'Device' });
	s.rows.set(remote.id, { ...remote, version: version(2) });
	await f.sync.sync(s.transport);
	const review = await f.sync.inspect(remote.id, s.transport);
	s.rows.set(remote.id, { ...remote, version: version(3) });
	await assert.rejects(f.sync.resolve(review, 'local', s.transport), /Account algorithm changed again/);
	const fresh = await f.sync.inspect(remote.id, s.transport);
	await f.sync.resolve(fresh, 'local', s.transport);
	await f.sync.sync({
		...s.transport,
		write: async (command, signal) => {
			const ack = await s.transport.write(command, signal);
			command.writeId = 'wrong';
			return { ...ack, writeId: 'wrong' };
		}
	});
	assert.equal((await f.sync.status())[0].state, 'pending');
	assert.equal((await f.sync.list()).algorithms[0].name, 'Device');
	f.advance();
	f.retire();
	await assert.rejects(f.sync.sync(s.transport), /Changed account/);
});

test('branch sync waits for its source and source deletion waits for an unsent branch', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	const s = server(),
		parent = (await f.sync.algorithms.create({ name: 'Source' })).algorithm;
	const child = (await f.sync.algorithms.create({ name: 'Branch', branchFrom: parent.id })).algorithm;
	await f.sync.sync(s.transport, undefined, 1);
	await f.sync.algorithms.remove(parent.id);
	await f.sync.sync(s.transport);
	assert.equal(s.rows.has(parent.id), false);
	assert.equal(s.rows.get(child.id)!.parentId, parent.id);
	assert.equal(s.calls[1].id, child.id);
	assert.equal(s.calls[2].action, 'delete');
});

test('an unavailable unsent branch source preserves local content for independent-copy review', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	const s = server(),
		parent = (await f.sync.algorithms.create({ name: 'Source' })).algorithm;
	const child = (await f.sync.algorithms.create({ name: 'Branch', branchFrom: parent.id })).algorithm;
	await f.sync.algorithms.remove(parent.id);
	assert.equal((await f.sync.sync(s.transport)).completed, 0);
	assert.equal((await f.sync.status())[0].state, 'error');
	assert.equal(s.calls.length, 0);
	const review = await f.sync.inspect(child.id, s.transport),
		{ copyId } = await f.sync.resolve(review, 'copy', s.transport);
	await f.sync.sync(s.transport);
	assert.equal(s.rows.size, 1);
	assert.equal(s.rows.get(copyId!)!.parentId, null);
	assert.equal((await f.sync.list()).algorithms.length, 1);
});

test('large retained profiles can edit and synchronize within the per-record limit', async (t) => {
	const f = fixture();
	t.after(() => f.db.close());
	const remote = saved();
	remote.content.weights.tags = Object.fromEntries(Array.from({ length: 1800 }, (_, i) => ['tag-' + i + '-' + 'x'.repeat(350), 1]));
	const s = server([remote]);
	await f.sync.refresh(s.transport);
	await f.sync.algorithms.update({ id: remote.id, name: 'Large retained profile' });
	assert.equal((await f.sync.sync(s.transport)).completed, 1);
	assert.deepEqual(s.rows.get(remote.id)!.content.weights, remote.content.weights);
	assert.equal((await f.sync.list()).algorithms[0].name, 'Large retained profile');
});
