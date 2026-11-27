import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Timestamp, Long } from 'mongodb';
import {
	createAccountInventoryStepper,
	initialAccountInventoryCursor,
	ACCOUNT_INVENTORY_STEP_RECORDS,
	AccountInventorySnapshotExpiredError,
	AccountInventorySnapshotUnavailableError,
	type AccountInventoryCursor
} from './accountInventorySteps';
import { captureBackup, sealBackup, openBackupItem, type BackupObjectStore } from './portableBackup';
import { backupDraftFixture } from './draftRecords.fixtures';
import { openAccountInventoryReferences } from './accountInventoryReferences';
function fixture(count = 19) {
	const source: any[] = Array.from({ length: count }, (_, i) => ({
		ownerId: 'owner',
		shareId: `thing-${String(i).padStart(5, '0')}`,
		thingtime: ['data'],
		crystal: { text: `before-${i}` },
		timelineHeadId: `head-${i}`,
		secure: 'NEVER_EXPORT_CONTROL'
	}));
	const objects = new Map<string, Uint8Array>(),
		snapshots = new Map<string, any[]>(),
		commands: any[] = [],
		heads = new Map<string, any>();
	const t = new Timestamp({ t: Date.parse('2026-11-06T00:00:00Z') / 1000, i: 17 });
	let beforeCommand = (_command: any) => {};
	let revoked = false,
		expired = false,
		changed = false,
		transient = false,
		wireLimit = ACCOUNT_INVENTORY_STEP_RECORDS,
		selected = 0;
	const store: BackupObjectStore = {
		read: async (key, max) => {
			const value = objects.get(key);
			if (value) assert.ok(value.length <= max);
			return value ?? null;
		},
		put: async (key, bytes) => {
			if (objects.has(key)) assert.ok(Buffer.from(objects.get(key)!).equals(bytes), 'Immutable backup object bytes changed');
			else objects.set(key, bytes.slice());
		}
	};
	const access = {
		scope: { ownerId: 'owner', apiOrigin: 'https://backup.test', dataPlane: 'home' },
		signal: undefined as AbortSignal | undefined,
		authorize: async () => {
			if (revoked) throw Error('Access revoked');
		}
	};
	const database = {
		command: async (command: any, options: any) => {
			beforeCommand(command);
			commands.push(command);
			assert.equal(command.find, 'canonical-things');
			assert.equal(command.filter.ownerId, 'owner');
			assert.deepEqual(command.hint, { ownerId: 1, shareId: 1 });
			assert.equal(command.singleBatch, true);
			assert.equal(options.readPreference, 'primary');
			assert.equal(command.readConcern.level, 'snapshot');
			assert.ok(command.limit <= ACCOUNT_INVENTORY_STEP_RECORDS);
			assert.ok(command.maxTimeMS <= 10000);
			if (transient) throw Object.assign(Error('Sensitive detail'), { code: 246, codeName: 'SnapshotUnavailable' });
			if (expired) throw Object.assign(Error('Sensitive server detail'), { code: 239, codeName: 'SnapshotTooOld' });
			const requested = command.readConcern.atClusterTime;
			if (!requested) {
				selected++;
				snapshots.set(
					t.toString(),
					source.map((row) => ({ ...row, crystal: structuredClone(row.crystal) }))
				);
			}
			const pinned = snapshots.get((requested ?? t).toString());
			assert.ok(pinned);
			const id = command.filter.shareId;
			const rows = pinned
				.filter((row) => row.ownerId === command.filter.ownerId && (!id || (typeof id === 'string' ? row.shareId === id : row.shareId > id.$gt)))
				.sort((a, b) => (a.shareId < b.shareId ? -1 : 1))
				.slice(0, Math.min(command.limit, wireLimit))
				.map((row) => {
					const result: any = {};
					for (const [path, include] of Object.entries(command.projection)) {
						if (!include) continue;
						const [key, child] = path.split('.');
						if (child && row[key]?.[child] !== undefined) (result[key] ??= {})[child] = structuredClone(row[key][child]);
						else if (!child && row[key] !== undefined) result[key] = row[key];
					}
					return result;
				});
			return { cursor: { id: Long.ZERO, firstBatch: rows, atClusterTime: changed ? new Timestamp({ t: t.getHighBitsUnsigned() + 1, i: 17 }) : t } };
		}
	};
	const worker = () =>
		createAccountInventoryStepper({
			collection: async () => ({ collectionName: 'canonical-things' }),
			database: async () => database,
			customPlane: () => false,
			attachmentHead: async ({ objectKey, versionId }) => {
				const head = heads.get(objectKey);
				assert.equal(head?.versionId, versionId);
				return head;
			}
		});
	const id = randomUUID(),
		json = (key: string) => JSON.parse(Buffer.from(objects.get(`snapshots/${id}/${key}`)!).toString());
	const step = (cursor: AccountInventoryCursor) => worker()(store, id, access, JSON.parse(JSON.stringify(cursor)));
	const finish = async (cursor = initialAccountInventoryCursor()) => {
		for (let unit = 0; unit < count + 30; unit++) {
			const result = await step(cursor);
			cursor = result.cursor;
			if (result.complete) return result;
		}
		throw Error('Did not terminate');
	};
	return {
		source,
		objects,
		store,
		access,
		commands,
		heads,
		t,
		id,
		json,
		step,
		finish,
		selected: () => selected,
		beforeCommand: (callback: (command: any) => void) => {
			beforeCommand = callback;
		},
		revoke: () => {
			revoked = true;
		},
		expire: () => {
			expired = true;
		},
		change: () => {
			changed = true;
		},
		transient: (value: boolean) => {
			transient = value;
		},
		truncate: () => {
			wireLimit = 1;
		}
	};
}
test('presentation names and parents are retained at the same pinned timestamp as streamed ordinary content', async () => {
	const f = fixture(3);
	Object.assign(f.source[0], { thingtime: ['folder'], crystal: { name: 'Parent' } });
	Object.assign(f.source[1], { folderId: f.source[0].shareId, crystal: { name: 'Child', text: 'x'.repeat(200000) } });
	const selected = await f.step(initialAccountInventoryCursor());
	f.source[0].crystal.name = 'Changed'; f.source[1].folderId = null;
	const result = await f.finish(selected.cursor);
	const retained = await openAccountInventoryReferences(f.store, f.id, 'owner', result.cursor.referenceStateHash, f.access.authorize);
	assert.deepEqual(await retained.descriptor(f.source[0].shareId), { id: f.source[0].shareId, parentId: null, name: 'Parent', kind: 'folder' });
	assert.deepEqual(await retained.descriptor(f.source[1].shareId), { id: f.source[1].shareId, parentId: f.source[0].shareId, name: 'Child', kind: 'data' });
	assert.equal(f.selected(), 1);
});

test('first unit returns exact BSON timestamp without publishing any objects', async () => {
	const f = fixture(),
		r = await f.step(initialAccountInventoryCursor());
	assert.equal(r.cursor.seconds, f.t.getHighBitsUnsigned());
	assert.equal(r.cursor.increment, 17);
	assert.equal(r.plan, null);
	assert.equal(r.complete, false);
	assert.equal(f.objects.size, 0);
	assert.equal(f.commands.length, 1);
	assert.ok(!('atClusterTime' in f.commands[0].readConcern));
});
test('fresh workers remain at one snapshot despite concurrent edits, inserts and deletes', async () => {
	const f = fixture(),
		start = await f.step(initialAccountInventoryCursor()),
		first = await f.step(start.cursor);
	assert.equal(first.cursor.nextOrdinal, 19);
	assert.equal(first.cursor.pages, 1);
	f.source[0].crystal.text = 'after';
	f.source.splice(8, 1);
	f.source.push({ ownerId: 'owner', shareId: 'thing-00007-new', thingtime: ['data'], crystal: { text: 'inserted' } });
	const r = await f.finish(first.cursor);
	assert.equal(r.plan!.items, 20);
	assert.equal(f.selected(), 1);
	const items = Array.from({ length: r.plan!.pages }, (_, i) => f.json(`plan/${i}.json`).items).flat();
	assert.equal(items[0].snapshot.value.crystal.text, 'before-0');
	assert.ok(items.some((item) => item.thingId === 'thing-00008'));
	assert.ok(!items.some((item) => item.thingId === 'thing-00007-new'));
	assert.equal(items.at(-1).snapshot.value.coverage.discovery, 'complete');
	assert.equal(items.at(-1).snapshot.value.coverage.wholeAccountReady, false);
	assert.ok(items.slice(0, -1).every((item) => !item.thingId.startsWith('~.')));
	assert.equal(f.json('header.json').boundary.token, `mongo:${f.t.getHighBitsUnsigned()}:17`);
	for (const cmd of f.commands.slice(1)) assert.deepEqual(cmd.readConcern.atClusterTime, f.t);
	for (const bytes of f.objects.values()) assert.ok(!Buffer.from(bytes).toString().includes('NEVER_EXPORT_CONTROL'));
});
test('uncertain immutable page acknowledgement replays identical bytes and continuation', async () => {
	const f = fixture(),
		start = await f.step(initialAccountInventoryCursor()),
		first = await f.step(start.cursor),
		retained = new Map(f.objects),
		replay = await f.step(start.cursor);
	assert.deepEqual(replay, first);
	assert.deepEqual(f.objects, retained);
	assert.equal(f.selected(), 1);
});
test('uncertain page receipt survives source history expiry and terminal seal replay is immutable', async () => {
	const f = fixture(2),
		start = await f.step(initialAccountInventoryCursor()),
		first = await f.step(start.cursor),
		terminal = await f.step(first.cursor),
		before = f.commands.length;
	f.expire();
	const replay = await f.step(start.cursor);
	assert.deepEqual(replay, first);
	const sealedReplay = await f.step(first.cursor);
	assert.deepEqual(sealedReplay, terminal);
	assert.equal(f.commands.length, before);
});
test('a changed immutable page receipt cannot advance continuation', async () => {
	const f = fixture(2),
		start = await f.step(initialAccountInventoryCursor());
	await f.step(start.cursor);
	const key = `snapshots/${f.id}/plan/0.json`,
		page = f.json('plan/0.json');
	page.previous = 'a'.repeat(64);
	f.objects.set(key, new TextEncoder().encode(JSON.stringify(page)));
	await assert.rejects(f.step(start.cursor));
});
test('short singleBatch is not interpreted as end of catalogue', async () => {
	const f = fixture(3);
	f.truncate();
	const r = await f.finish();
	assert.equal(r.plan!.items, 4);
	assert.equal(r.plan!.pages, 4);
});
test('expired snapshot fails recoverably without replacing timestamp or sealing plan', async () => {
	const f = fixture(),
		start = await f.step(initialAccountInventoryCursor());
	f.expire();
	await assert.rejects(
		f.step(start.cursor),
		(e) => e instanceof AccountInventorySnapshotExpiredError && e.code === 'snapshot-expired' && e.recoverable && !e.message.includes('Sensitive')
	);
	assert.equal(f.selected(), 1);
	assert.ok(!f.objects.has(`snapshots/${f.id}/plan.json`));
});
test('server boundary drift and revoked authorization refuse', async () => {
	const f = fixture(),
		start = await f.step(initialAccountInventoryCursor());
	f.change();
	await assert.rejects(f.step(start.cursor), /boundary changed/);
	const other = fixture(),
		boundary = await other.step(initialAccountInventoryCursor());
	other.revoke();
	await assert.rejects(other.step(boundary.cursor), /revoked/);
	assert.equal(other.objects.size, 0);
});
test('invalid scalar continuation cannot access database or store', async () => {
	const f = fixture();
	for (const patch of [{ seconds: 1 }, { bytes: '-1' }, { nextOrdinal: 1 }, { lastThingId: 'invalid space' }, { pages: 1 }])
		await assert.rejects(f.step({ ...initialAccountInventoryCursor(), ...patch }), /continuation/);
	assert.equal(f.commands.length, 0);
	assert.equal(f.objects.size, 0);
});
test('managed/control families retain typed exclusions without private envelopes', async () => {
	const f = fixture(0);
	for (const kind of ['backup-job', 'backup-job-event', 'device', 'subscription'])
		f.source.push({
			ownerId: 'owner',
			shareId: `control-${kind}`,
			thingtime: [kind],
			crystal: { secret: 'NEVER_EXPORT_CONTROL' },
			secure: 'NEVER_EXPORT_CONTROL'
		});
	const r = await f.finish();
	assert.equal(r.cursor.excluded, 4);
	for (const item of f.json('plan/0.json').items) assert.equal(item.snapshot.adapter, 'backup-source-exclusion');
	for (const bytes of f.objects.values()) assert.ok(!Buffer.from(bytes).toString().includes('NEVER_EXPORT_CONTROL'));
});
test('new plan interoperates with canonical v1 capture, seal and selected-item reader', async () => {
	const f = fixture(2),
		r = await f.finish();
	await captureBackup(
		f.store,
		f.id,
		{
			read: async () => {
				throw Error('Inline metadata must not fetch live content');
			}
		},
		f.access
	);
	const seal = await sealBackup(f.store, f.id, f.access);
	assert.equal(seal.items, r.plan!.items);
	const opened = await openBackupItem(f.store, f.id, 'thing-00000', f.access);
	assert.equal((opened.item.snapshot.value as any).crystal.text, 'before-0');
});
test('draft retained serializer and exact-version attachment closure survive worker restarts', async () => {
	const f = fixture(0),
		draft = await backupDraftFixture();
	f.source.push(...draft.docs, ...draft.attachments.map((a) => a.doc));
	for (const a of draft.attachments) f.heads.set(a.doc.objectKey, a.head);
	const r = await f.finish();
	assert.equal(r.plan!.items, 6);
	assert.ok(Array.from(f.objects.keys()).some((key) => key.includes('/ranges/')));
	const broken = fixture(0);
	broken.source.push(...draft.docs);
	const start = await broken.step(initialAccountInventoryCursor());
	await assert.rejects(broken.step(start.cursor), /dependency is missing/);
	assert.ok(!broken.objects.has(`snapshots/${broken.id}/plan.json`));
});

test('SnapshotUnavailable246 preserves exact timestamp and can retry without restarting inventory', async () => {
	const f = fixture(1),
		start = await f.step(initialAccountInventoryCursor());
	f.transient(true);
	await assert.rejects(f.step(start.cursor), (e) => e instanceof AccountInventorySnapshotUnavailableError && e.retrySameTimestamp && e.recoverable);
	f.transient(false);
	const result = await f.step(start.cursor);
	assert.equal(result.cursor.seconds, start.cursor.seconds);
	assert.equal(result.cursor.increment, start.cursor.increment);
	assert.equal(f.selected(), 1);
});

test('more than two census windows resume with fixed scalar state and no total-item cap', async () => {
	const f = fixture(263),
		start = await f.step(initialAccountInventoryCursor()),
		first = await f.step(start.cursor);
	assert.equal(first.cursor.nextOrdinal, 128);
	assert.equal(first.cursor.pages, 1);
	const result = await f.finish(first.cursor);
	assert.equal(result.plan!.items, 264);
	assert.ok(result.plan!.pages >= 4);
});

test('soft-deadline variation after a durable final-bundle lost reply can resume the same accepted input', async () => {
	for (const slowerRetry of [false, true]) {
		const f = fixture(),
			initial = await f.step(initialAccountInventoryCursor());
		const originalNow = Date.now,
			base = originalNow();
		let clock = base,
			attempt = 0,
			payloads = 0,
			lose = true;
		Date.now = () => clock;
		f.beforeCommand((command) => {
			if (command.projection.crystal && ++payloads === 3 && (slowerRetry ? attempt === 1 : attempt === 0)) clock = base + 16000;
		});
		const originalPut = f.store.put;
		f.store.put = async (key, bytes) => {
			await originalPut(key, bytes);
			if (lose && key.includes('/references/bundles/')) {
				lose = false;
				throw Error('Accepted final bundle reply lost');
			}
		};
		try {
			await assert.rejects(f.step(initial.cursor), /final bundle reply lost/);
			const stored = [...f.objects.entries()].find(([key]) => key.includes('/references/bundles/'))!;
			clock = base;
			payloads = 0;
			attempt = 1;
			const recovered = await f.step(initial.cursor);
			assert.equal(recovered.cursor.nextOrdinal, slowerRetry ? 3 : 19);
			assert.equal(recovered.cursor.seconds, initial.cursor.seconds);
			assert.equal(recovered.cursor.increment, initial.cursor.increment);
			assert.equal(f.selected(), 1);
			assert.deepEqual(f.objects.get(stored[0]), stored[1]);
			assert.equal(f.json('plan/0.json').items.length, slowerRetry ? 3 : 19);
			const complete = await f.finish(recovered.cursor);
			assert.equal(complete.plan!.items, 20);
		} finally {
			Date.now = originalNow;
		}
	}
});

test('corruption or cancellation while adopting an earlier bundle cannot publish a unit receipt', async () => {
	for (const cancelled of [false, true]) {
		const f = fixture(),
			start = await f.step(initialAccountInventoryCursor()),
			originalPut = f.store.put;
		let lose = true;
		f.store.put = async (key, bytes) => {
			await originalPut(key, bytes);
			if (lose && key.includes('/references/bundles/')) {
				lose = false;
				throw Error('Accepted bundle reply lost');
			}
		};
		await assert.rejects(f.step(start.cursor), /reply lost/);
		const key = [...f.objects.keys()].find((key) => key.includes('/references/bundles/'))!,
			before = f.objects.size,
			read = f.store.read,
			abort = new AbortController();
		f.access.signal = abort.signal;
		f.store.read = async (candidate, max) => {
			const bytes = await read(candidate, max);
			if (candidate === key && bytes) {
				if (cancelled) abort.abort(Error('Synthetic adoption cancellation'));
				else {
					const changed = bytes.slice();
					changed[changed.length - 1] = 0;
					return changed;
				}
			}
			return bytes;
		};
		await assert.rejects(f.step(start.cursor));
		assert.equal(f.objects.size, before);
		assert.ok(!f.objects.has(`snapshots/${f.id}/plan.json`));
	}
});

test('a pinned timestamp cannot make an impossible zero-page continuation valid', async () => {
	const f = fixture(),
		start = await f.step(initialAccountInventoryCursor()),
		queries = f.commands.length;
	for (const patch of [
		{ nextOrdinal: 1 },
		{ lastThingId: 'unpublished-source' },
		{ bytes: '1' },
		{ pages: 1, previousHash: 'a'.repeat(64), nextOrdinal: 1 }
	])
		await assert.rejects(f.step({ ...start.cursor, ...patch }), /continuation/);
	assert.equal(f.commands.length, queries);
	assert.equal(f.objects.size, 0);
});
