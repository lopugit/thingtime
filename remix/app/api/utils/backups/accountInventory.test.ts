import { timelineBackupFixture } from './timelineRecords.fixtures';
import { timelineBackupRecordFromDoc, openBackupTimelineRecord } from './timelineRecords';
import { joinTimelineEvent } from '../../../timeline/records';
import { copySealedBackup } from './portableBackup';
import assert from 'node:assert/strict';
import { BSON } from 'mongodb';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createAccountInventoryProducer } from './accountInventory';
import { captureBackup, sealBackup, openBackupItem, type BackupObjectStore } from './portableBackup';
import { fingerprintSource } from '../../../fileSync/contentFingerprint';

function fixture(count = 300) {
	const source: any[] = Array.from({ length: count }, (_, n) => ({
		shareId: `thing-${String(n).padStart(4, '0')}`,
		ownerId: 'owner',
		thingtime: ['data'],
		crystal: { text: `original-${n}` },
		secure: 'NEVER_EXPORT',
		linkKey: 'NEVER_EXPORT',
		tokenAcl: 'NEVER_EXPORT'
	}));
	const objects = new Map<string, Uint8Array>();
	const store: BackupObjectStore = {
		read: async (key, max) => {
			const value = objects.get(key);
			if (value) assert.ok(value.length <= max);
			return value ?? null;
		},
		put: async (key, value) => {
			if (objects.has(key)) assert.deepEqual(objects.get(key), value);
			else objects.set(key, value.slice());
		}
	};
	const scope = { apiOrigin: 'https://backup.test', ownerId: 'owner', dataPlane: 'home' };
	const access = { scope, authorize: async () => {}, signal: undefined as AbortSignal | undefined };
	const state = { queries: 0, closed: 0, ended: 0, beforeQuery: (_n: number) => {}, alterRows: (_n: number, rows: any[]) => rows };
	let frozen: any[];
	const session = { snapshotEnabled: true, inTransaction: () => false, snapshotTime: undefined as any };
	const projections: Record<string, number>[] = [];
	const collection = {
		find(filter: any, options: any) {
			state.beforeQuery(++state.queries);
			assert.equal(options.session, session);
			assert.equal(filter.ownerId, 'owner');
			assert.equal(options.collation.locale, 'simple');
			assert.equal(options.readPreference, 'primary');
			assert.deepEqual(options.hint, { ownerId: 1, shareId: 1 });
			projections.push(options.projection);
			if (!frozen) {
				frozen = source.map((row) => BSON.deserialize(BSON.serialize(row)));
				session.snapshotTime = { getHighBitsUnsigned: () => 1792195200, getLowBitsUnsigned: () => 7 };
			}
			let limit = 0;
			const cursor = {
				sort(value: any) {
					assert.deepEqual(value, { shareId: 1 });
					return cursor;
				},
				limit(n: number) {
					assert.ok(n === 128 || n === 8);
					limit = n;
					return cursor;
				},
				batchSize(n: number) {
					assert.ok(n === 128 || n === 8);
					return cursor;
				},
				async close() {
					state.closed++;
				},
				async *[Symbol.asyncIterator]() {
					const selected = frozen
						.filter(
							(row) =>
								row.ownerId === filter.ownerId &&
								(!filter.shareId?.$gt || row.shareId > filter.shareId.$gt) &&
								(!filter.shareId?.$in || filter.shareId.$in.includes(row.shareId))
						)
						.sort((a, b) => (a.shareId < b.shareId ? -1 : a.shareId > b.shareId ? 1 : 0))
						.slice(0, limit);
					const projected = selected.map((row) => {
						const result: any = {};
						for (const [path, included] of Object.entries(options.projection)) {
							if (!included) continue;
							const [root, child] = path.split('.');
							if (child && row[root]?.[child] !== undefined) (result[root] ??= {})[child] = row[root][child];
							else if (!child && row[root] !== undefined) result[root] = row[root];
						}
						return result;
					});
					yield* state.alterRows(state.queries, projected);
				}
			};
			return cursor;
		}
	};
	const producer = createAccountInventoryProducer({
		collection: async () => collection,
		customPlane: () => false,
		snapshot: async (work) => {
			try {
				return await work(session);
			} finally {
				state.ended++;
			}
		}
	});
	const id = randomUUID();
	const json = (key: string) => JSON.parse(Buffer.from(objects.get(`snapshots/${id}/${key}`)!).toString());
	return { source, store, objects, scope, access, state, session, projections, id, json, run: () => producer(store, id, access) };
}

test('freezes more than two pages despite source edits, inserts and deletions; canonical metadata survives source removal', async () => {
	const f = fixture();
	f.source.push({ shareId: 'foreign', ownerId: 'someone-else', thingtime: ['data'], crystal: 'private' });
	f.state.beforeQuery = (n) => {
		if (n === 2) {
			f.source[0].crystal.text = 'changed';
			f.source.splice(128, 1);
			f.source.push({ shareId: 'new', ownerId: 'owner', thingtime: ['data'] });
		}
	};
	const plan = await f.run();
	assert.equal(plan.items, 300);
	assert.equal(plan.pages, 3);
	assert.equal(plan.bytes, '0');
	assert.equal(f.state.queries, 7);
	assert.equal(f.state.closed, 7);
	assert.equal(f.state.ended, 1);
	assert.deepEqual(f.json('header.json').boundary, {
		kind: 'point-in-time',
		token: 'mongo:1792195200:7',
		startedAt: new Date(1792195200 * 1000).toISOString(),
		completedAt: new Date(1792195200 * 1000).toISOString()
	});
	for (const projection of f.projections) for (const field of ['secure', 'linkKey', 'tokenAcl']) assert.equal(projection[field], undefined);
	assert.ok(![...f.objects.values()].some((bytes) => Buffer.from(bytes).includes('NEVER_EXPORT')));
	f.source.length = 0;
	await captureBackup(
		f.store,
		f.id,
		{
			read: async () => {
				throw Error('Metadata must not read live bytes');
			}
		},
		f.access
	);
	await sealBackup(f.store, f.id, f.access);
	const retained = await openBackupItem(f.store, f.id, 'thing-0128', f.access);
	assert.equal((retained.item.snapshot.value as any).crystal.text, 'original-128');
	assert.equal(retained.item.snapshot.adapter, 'thing-content');
	assert.match(retained.item.revision, /^snapshot-[a-f0-9]{64}$/);
});

test('file items retain canonical immutable content references and fingerprints', async () => {
	const f = fixture(0),
		bytes = Buffer.from('retained file');
	const fingerprint = await fingerprintSource({ size: bytes.length, check: () => {}, read: async (at, length) => bytes.subarray(at, at + length) });
	f.source.push({
		shareId: 'file-one',
		ownerId: 'owner',
		thingtime: ['file'],
		timelineHeadId: 'revision-one',
		folderId: 'folder-one',
		crystal: {
			name: 'file.txt',
			trashed: false,
			content: { attachmentId: 'attachment-one', version: 'a'.repeat(64), size: bytes.length, fingerprint }
		}
	});
	await f.run();
	const item = f.json('plan/0.json').items[0];
	assert.equal(item.snapshot.adapter, 'file-content');
	assert.equal(item.revision, 'revision-one');
	assert.equal(item.snapshot.value.content.version, 'a'.repeat(64));
	assert.deepEqual(item.content, { size: bytes.length, fingerprint });
});

test('empty inventory still needs a server timestamp and produces a valid empty plan', async () => {
	const f = fixture(0);
	const plan = await f.run();
	assert.equal(plan.items, 0);
	assert.equal(plan.pages, 0);
	assert.equal(f.state.ended, 1);
	assert.equal(f.json('header.json').boundary.token, 'mongo:1792195200:7');
});

test('an account switch during authorization refuses before obtaining source data', async () => {
	const f = fixture();
	f.access.authorize = async () => {
		f.scope.ownerId = 'other';
	};
	await assert.rejects(f.run(), /account or origin changed/);
	assert.equal(f.state.queries, 0);
	assert.equal(f.objects.size, 0);
});

for (const mode of ['no-timestamp', 'invalid-timestamp', 'not-snapshot', 'transaction'] as const) {
	test(`${mode} cannot manufacture a point-in-time header`, async () => {
		const f = fixture(0);
		if (mode === 'not-snapshot') f.session.snapshotEnabled = false;
		if (mode === 'transaction') f.session.inTransaction = () => true;
		f.state.alterRows = (_n, rows) => {
			if (mode === 'no-timestamp') f.session.snapshotTime = undefined;
			if (mode === 'invalid-timestamp') f.session.snapshotTime = { getHighBitsUnsigned: () => NaN, getLowBitsUnsigned: () => 1 };
			return rows;
		};
		await assert.rejects(f.run());
		assert.equal(f.objects.size, 0);
		assert.equal(f.state.ended, 1);
	});
}

test('unsupported managed family refuses before fetching its private payload and cannot restart under the same ID', async () => {
	for (const kind of ['passkey', 'ai-connection', 'chat-message']) {
		const f = fixture(1);
		f.source[0].thingtime = [kind];
		await assert.rejects(f.run(), /dedicated adapter/);
		assert.equal(f.state.queries, 1);
		assert.equal(f.projections[0].crystal, undefined);
		assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
		await assert.rejects(f.run(), /already started/);
		assert.equal(f.state.ended, 1);
	}
});

for (const mode of ['revoked', 'cancelled', 'scope', 'boundary', 'missing', 'duplicate', 'oversized', 'expired'] as const) {
	test(`${mode} enumeration never publishes a complete plan and closes its cursor/session`, async () => {
		const f = fixture(2),
			controller = new AbortController();
		f.access.signal = controller.signal;
		f.state.beforeQuery = (n) => {
			if (n !== 2) return;
			if (mode === 'revoked')
				f.access.authorize = async () => {
					throw Error('Revoked');
				};
			if (mode === 'cancelled') controller.abort();
			if (mode === 'scope') f.scope.ownerId = 'other';
			if (mode === 'boundary') f.session.snapshotTime = { getHighBitsUnsigned: () => 1792195201, getLowBitsUnsigned: () => 7 };
		};
		f.state.alterRows = (n, rows) => {
			if (n !== 2) return rows;
			if (mode === 'expired') throw Error('SnapshotTooOld');
			if (mode === 'missing') return rows.slice(1);
			if (mode === 'duplicate') return [rows[0], rows[0]];
			if (mode === 'oversized') rows[0].crystal = 'x'.repeat(256 * 1024);
			return rows;
		};
		await assert.rejects(f.run());
		assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
		assert.equal(f.state.closed, f.state.queries);
		assert.equal(f.state.ended, 1);
	});
}

test('canonical Timeline records and large snapshot parts survive source and first-vault loss', async () => {
	const f = fixture(1),
		history = timelineBackupFixture();
	f.source.push(...history.docs);
	const expected = new Map(history.docs.map((doc) => [doc.shareId, timelineBackupRecordFromDoc(doc)]));
	const plan = await f.run();
	assert.equal(plan.items, history.docs.length + 1);
	assert.ok(BigInt(plan.bytes) > BigInt(2_400_000));
	assert.ok(f.state.queries < history.docs.length, 'history payload reads are batched');
	for (const projection of f.projections.filter((p) => p.secure)) {
		assert.equal(projection.tokenAcl, undefined);
		assert.equal(projection.linkKey, undefined);
	}
	const sourceReads = async () => {
		throw Error('Frozen Timeline records must not reread live source');
	};
	f.source.length = 0;
	const capture = await captureBackup(f.store, f.id, { read: sourceReads }, f.access);
	assert.equal(capture.copiedBytes, '0');
	assert.equal(capture.reusedBytes, plan.bytes);
	await sealBackup(f.store, f.id, f.access);
	const second = fixture(0);
	await copySealedBackup(f.store, second.store, f.id, f.access);
	f.objects.clear();
	const records = [];
	for (const [id, record] of expected) {
		const restored = await openBackupTimelineRecord(second.store, f.id, id, f.access);
		assert.deepEqual(restored, record);
		records.push(restored);
	}
	assert.ok(![...second.objects.values()].some((bytes) => Buffer.from(bytes).includes('NEVER_EXPORT')));
	const event = records.find((r) => r.kind === 'timeline-event' && (r.value as any).event.id === 'event-two')!;
	const links = records.filter((r) => r.kind === 'timeline-link' && (r.value as any).eventId === 'event-two').map((r) => r.value as any);
	assert.deepEqual(joinTimelineEvent((event.value as any).event, links), history.events[1]);
	const parts = records
		.filter((r) => r.kind === 'timeline-snapshot-part')
		.map((r) => r.value as any)
		.sort((a, b) => a.ordinal - b.ordinal);
	assert.deepEqual(JSON.parse(parts.map((part) => part.data).join('')), history.big);
	assert.ok(records.some((r) => r.kind === 'timeline-version-name' && (r.value as any).cleared === true));
});

test('a changed Timeline envelope refuses the entire snapshot before its plan is sealed', async () => {
	for (const patch of [{ ownerId: 'foreign' }, { targetId: 'wrong' }, { timelineEnvelopeVersion: 99 }, { shareId: 'wrong' }]) {
		const f = fixture(0),
			doc = timelineBackupFixture().docs.find((d) => d.thingtime[0] === 'timeline-event');
		f.source.push({ ...doc, ...patch });
		// Keep census owner in-scope for the envelope owner mismatch case.
		if (patch.ownerId) {
			f.source[0].ownerId = 'owner';
			f.source[0].secure = BSON.deserialize(BSON.serialize(doc)).secure;
		}
		if (patch.ownerId) f.state.alterRows = (n, rows) => (n === 2 ? rows.map((row) => ({ ...row, ownerId: 'foreign' })) : rows);
		await assert.rejects(f.run());
		assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
	}
});

test('revocation during frozen Timeline payload persistence cannot publish a plan or seal', async () => {
	const f = fixture(0);
	f.source.push(...timelineBackupFixture().docs);
	const put = f.store.put;
	let revoked = false;
	f.store.put = async (key, bytes) => {
		await put(key, bytes);
		if (key.startsWith('chunks/')) revoked = true;
	};
	f.access.authorize = async () => {
		if (revoked) throw Error('Revoked');
	};
	await assert.rejects(f.run(), /Revoked/);
	assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
	assert.equal(f.objects.has(`snapshots/${f.id}/complete.json`), false);
});

for (const failure of ['missing-chunk', 'corrupt-chunk', 'lost-range-reply'] as const) {
	test(`${failure} cannot certify a frozen Timeline backup`, async () => {
		const f = fixture(0);
		f.source.push(...timelineBackupFixture().docs);
		if (failure === 'lost-range-reply') {
			const put = f.store.put;
			f.store.put = async (key, bytes) => {
				await put(key, bytes);
				if (key.includes('/ranges/')) throw Error('Range reply lost');
			};
			await assert.rejects(f.run(), /Range reply lost/);
			assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
			await assert.rejects(f.run()); // a new database snapshot needs a fresh identity
		} else {
			await f.run();
			const key = [...f.objects.keys()].find((key) => key.startsWith('chunks/'))!;
			if (failure === 'missing-chunk') f.objects.delete(key);
			else f.objects.get(key)![0] ^= 255;
		}
		await assert.rejects(sealBackup(f.store, f.id, f.access));
		assert.equal(f.objects.has(`snapshots/${f.id}/complete.json`), false);
	});
}

test('a later unsupported managed family cannot leave a complete partial Timeline snapshot', async () => {
	const f = fixture(100);
	f.source.push(...timelineBackupFixture().docs);
	f.source.push({ shareId: 'zz-unsupported', ownerId: 'owner', thingtime: ['passkey'], secure: 'NEVER_EXPORT' });
	await assert.rejects(f.run(), /dedicated adapter/);
	assert.ok([...f.objects.keys()].some((key) => key.startsWith('chunks/')));
	assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
	assert.equal(f.objects.has(`snapshots/${f.id}/complete.json`), false);
});

test('sealed Timeline reads refuse changed scope before storage and detect later byte damage', async () => {
	const f = fixture(0),
		history = timelineBackupFixture();
	f.source.push(...history.docs);
	await f.run();
	await sealBackup(f.store, f.id, f.access);
	let reads = 0;
	const read = f.store.read;
	f.store.read = async (...args) => {
		reads++;
		return read(...args);
	};
	await assert.rejects(
		openBackupTimelineRecord(f.store, f.id, history.firstPartId, {
			...f.access,
			authorize: async () => {
				throw Error('Owner session revoked');
			}
		}),
		/revoked/
	);
	assert.equal(reads, 0);
	await assert.rejects(
		openBackupTimelineRecord(f.store, f.id, history.firstPartId, {
			...f.access,
			scope: { ...f.scope, ownerId: 'someone-else' }
		}),
		/account or origin/
	);
	// Damage the exact retained part after a valid seal. The read must still hash it.
	const part = await openBackupItem(f.store, f.id, history.firstPartId, f.access);
	const range = f.json(`ranges/${part.item.ordinal}/0.json`).ranges[0];
	f.objects.get(`chunks/${range.sha256}`)![0] ^= 255;
	await assert.rejects(openBackupTimelineRecord(f.store, f.id, history.firstPartId, f.access));
});
