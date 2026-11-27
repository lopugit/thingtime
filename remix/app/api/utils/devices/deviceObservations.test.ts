import assert from 'node:assert/strict';
import test from 'node:test';
import { Binary } from 'mongodb';
import { createDeviceObservationService, DeviceObservationFailure } from './deviceObservations';

const at = Date.parse('2026-11-06T12:00:00Z');
const actor = { userId: 'owner', deviceId: 'device', sessionId: 'session', capabilities: [] };
const get = (obj: any, key: string) => key.split('.').reduce((v, k) => v?.[k], obj);
const equal = (a: any, b: any) =>
	a instanceof Date || b instanceof Date
		? Number(new Date(a)) === Number(new Date(b))
		: a instanceof Binary && b instanceof Binary
		? a.toString('base64') === b.toString('base64')
		: JSON.stringify(a) === JSON.stringify(b);
function match(row: any, filter: any): boolean {
	return Object.entries(filter).every(([key, v]: [string, any]) => {
		if (key === '$or') return v.some((f: any) => match(row, f));
		const value = get(row, key);
		if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Binary) && !Array.isArray(v))
			return Object.entries(v).every(([op, expected]: [string, any]) =>
				op === '$in'
					? expected.some((e: any) => equal(value, e))
					: op === '$gt'
					? value > expected
					: op === '$lt'
					? value < expected
					: op === '$lte'
					? value <= expected
					: op === '$gte'
					? value >= expected
					: false
			);
		return Array.isArray(value) ? value.some((x) => equal(x, v)) : equal(value, v) || (v === null && value === undefined);
	});
}
function set(row: any, key: string, value: any) {
	const path = key.split('.');
	let target = row;
	for (const part of path.slice(0, -1)) target = target[part] ??= {};
	target[path.at(-1)!] = value;
}
const clone = (v: any): any =>
	v instanceof Date
		? new Date(v)
		: v instanceof Binary
		? new Binary(v.value())
		: Array.isArray(v)
		? v.map(clone)
		: v && typeof v === 'object'
		? Object.fromEntries(Object.entries(v).map(([k, v]) => [k, clone(v)]))
		: v;
function fixture() {
	let rows: any[] = [
		{ _id: 'device', shareId: 'device', thingtime: ['device'], ownerId: 'owner', crystal: {} },
		{ _id: 'foreign', shareId: 'foreign', thingtime: ['device'], ownerId: 'other', crystal: {} }
	];
	let clock = at,
		revoked = false,
		writeFailure = false,
		removeFailure = false;
	let ids = 0;
	const transaction = { fixture: true };
	const writes: string[] = [];
	const collection = {
		findOne: async (filter: any, options: any) => {
			assert.equal(options.session, transaction);
			return clone(rows.find((r) => match(r, filter)) ?? null);
		},
		find: (filter: any, options: any) => {
			assert.equal(options.session, transaction);
			let result = rows.filter((r) => match(r, filter));
			const cursor = {
				sort: (spec: any) => {
					result.sort((a, b) => {
						for (const [key, direction] of Object.entries(spec)) {
							const av = get(a, key),
								bv = get(b, key);
							if (av < bv) return -Number(direction);
							if (av > bv) return Number(direction);
						}
						return 0;
					});
					return cursor;
				},
				limit: (n: number) => {
					result = result.slice(0, n);
					return cursor;
				},
				toArray: async () => result
			};
			return cursor;
		}
	};
	const checked = (options: any) => {
		assert.equal(options.accountedPlane, 'home');
		assert.equal(options.session, transaction);
	};
	const service = createDeviceObservationService({
		things: async () => collection,
		sessions: async () => ({
			updateOne: async (query: any, _update: any, options: any) => {
				assert.equal(options.session, transaction);
				assert.equal(query.userId, 'owner');
				assert.equal(query['meta.deviceId'], 'device');
				return { matchedCount: revoked ? 0 : 1 };
			}
		}),
		transaction: async (work) => {
			const before = clone(rows);
			try {
				return await work(transaction);
			} catch (e) {
				rows = before;
				throw e;
			}
		},
		now: () => new Date(clock),
		uuid: () => `generation-${++ids}`,
		insert: async (_c, doc, options) => {
			checked(options);
			writes.push('insert');
			if (writeFailure) throw Error('storage unavailable');
			const key = doc.uniqueKeys[0];
			if (rows.some((r) => r.uniqueKeys?.some((k) => equal(k, key)))) throw Object.assign(Error('duplicate'), { code: 11000 });
			doc._id = `row-${++ids}`;
			rows.push(doc);
			return { insertedId: doc._id };
		},
		update: async (_c, filter, update: any, options) => {
			checked(options);
			writes.push('update');
			if (writeFailure) throw Error('storage unavailable');
			const row = rows.find((r) => match(r, filter));
			if (row) {
				for (const [k, v] of Object.entries(update.$set ?? {})) set(row, k, v);
				for (const k of Object.keys(update.$unset ?? {})) {
					const path = k.split('.');
					const target = path.slice(0, -1).reduce((v, p) => v?.[p], row);
					if (target) delete target[path.at(-1)!];
				}
			}
			return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
		},
		remove: async (_c, filter, options) => {
			checked(options);
			writes.push('remove');
			if (removeFailure) throw Error('cleanup unavailable');
			const count = rows.length;
			rows = rows.filter((r) => !match(r, filter));
			return { deletedCount: count - rows.length };
		}
	});
	const sample = (id = 'one', ago = 1000, extra: any = {}) => ({
		id,
		type: 'location',
		collectionId: rows[0].crystal.observationSettings?.location?.collectionId,
		observedAt: new Date(clock - ago).toISOString(),
		value: { latitude: 55, longitude: 12, accuracyMeters: 8, precision: 'approximate' },
		...extra
	});
	return {
		service,
		sample,
		writes,
		rows: () => rows,
		setClock: (n: number) => (clock = n),
		setRevoked: () => (revoked = true),
		setWriteFailure: () => (writeFailure = true),
		setRemoveFailure: () => (removeFailure = true)
	};
}
const code = (expected: string) => (e: any) => e instanceof DeviceObservationFailure && e.code === expected;
test('wrong-owner reads/settings and default-disabled collection are refused', async () => {
	const f = fixture();
	await assert.rejects(f.service.read('owner', { deviceId: 'foreign', type: 'location' }), code('DEVICE_NOT_FOUND'));
	await assert.rejects(f.service.settings('other', { deviceId: 'device', type: 'location', enabled: true }), code('DEVICE_NOT_FOUND'));
	await assert.rejects(f.service.record(actor, f.sample('one', 1000, { collectionId: 'old' })), code('OBSERVATION_COLLECTION_DISABLED'));
	assert.deepEqual((await f.service.nodeSettings(actor)).settings, { enabled: false, retentionMs: null, collectionId: null });
});
test('immutable retry returns original receipt; conflicts and late samples never regress latest', async () => {
	const f = fixture();
	await f.service.settings('owner', { deviceId: 'device', type: 'location', enabled: true });
	const sample = f.sample();
	const first = await f.service.record(actor, sample);
	f.setClock(at + 5000);
	assert.deepEqual(await f.service.record(actor, sample), { ...first, duplicate: true });
	await assert.rejects(f.service.record(actor, { ...sample, value: { ...sample.value, latitude: 56 } }), code('OBSERVATION_CONFLICT'));
	await f.service.record(actor, f.sample('older', 100_000));
	const result = await f.service.read('owner', { deviceId: 'device', type: 'location', limit: 1 });
	assert.equal(result.latest.id, 'one');
	assert.equal(result.observations[0].id, 'one');
	assert.ok(result.nextCursor);
	const page = await f.service.read('owner', { deviceId: 'device', type: 'location', limit: 1, cursor: result.nextCursor });
	assert.equal(page.observations[0].id, 'older');
	assert.equal(page.nextCursor, null);
	assert.equal(f.rows().filter((r) => r.thingtime.includes('device-observation')).length, 2);
	assert.ok(
		f
			.rows()
			.filter((r) => r.thingtime.includes('device-observation'))
			.every((r) => r.parentId === 'device' && r.ownerId === 'owner' && r.uniqueKeys.length === 1)
	);
});
test('disable preserves history, revoke blocks reads/ingest, and re-enable fences stale grant', async () => {
	const f = fixture();
	await f.service.settings('owner', { deviceId: 'device', type: 'location', enabled: true });
	const old = f.sample();
	await f.service.record(actor, old);
	await f.service.settings('owner', { deviceId: 'device', type: 'location', enabled: false });
	await assert.rejects(f.service.record(actor, old), code('OBSERVATION_COLLECTION_DISABLED'));
	assert.equal((await f.service.read('owner', { deviceId: 'device', type: 'location' })).observations.length, 1);
	const enabled = await f.service.settings('owner', { deviceId: 'device', type: 'location', enabled: true });
	assert.notEqual(enabled.settings.collectionId, old.collectionId);
	await assert.rejects(f.service.record(actor, old), code('OBSERVATION_COLLECTION_CHANGED'));
	f.setRevoked();
	await assert.rejects(f.service.record(actor, f.sample()), code('DEVICE_REVOKED'));
	await assert.rejects(f.service.nodeSettings(actor), code('DEVICE_REVOKED'));
});
test('retention expires by measurement time, applies retroactively, and Never accepts delayed history', async () => {
	const f = fixture();
	await f.service.settings('owner', { deviceId: 'device', type: 'location', enabled: true });
	await f.service.record(actor, f.sample('old', 100_000));
	const saved = await f.service.settings('owner', { deviceId: 'device', type: 'location', retentionMs: 30_000 });
	assert.equal(saved.cleanup.deleted, 1);
	assert.equal((await f.service.record(actor, f.sample('late', 30_000))).expired, true);
	assert.equal((await f.service.read('owner', { deviceId: 'device', type: 'location' })).latest, null);
	await f.service.settings('owner', { deviceId: 'device', type: 'location', retentionMs: null });
	await f.service.record(actor, f.sample('ancient', 86400_000));
	assert.equal((await f.service.read('owner', { deviceId: 'device', type: 'location' })).observations.length, 1);
	for (const retentionMs of [0, -1, 1.2, '100', Infinity])
		await assert.rejects(f.service.settings('owner', { deviceId: 'device', type: 'location', retentionMs }), code('INVALID_SETTINGS'));
});
test('bounded cleanup resumes without limiting history and removes expired current pointer', async () => {
	const f = fixture();
	await f.service.settings('owner', { deviceId: 'device', type: 'location', enabled: true });
	for (let i = 0; i < 105; i++) await f.service.record(actor, f.sample(`sample-${i}`, 100_000 + i));
	const first = await f.service.settings('owner', { deviceId: 'device', type: 'location', retentionMs: 1000 });
	assert.deepEqual(first.cleanup, { deleted: 100, hasMore: true });
	const second = await f.service.settings('owner', { deviceId: 'device', type: 'location' });
	assert.deepEqual(second.cleanup, { deleted: 5, hasMore: false });
	assert.equal(f.rows()[0].crystal.latestObservations.location, undefined);
});
test('accounted insertion/cleanup failures abort transaction and preserve original policy/history', async () => {
	const f = fixture();
	await f.service.settings('owner', { deviceId: 'device', type: 'location', enabled: true });
	f.setWriteFailure();
	await assert.rejects(f.service.record(actor, f.sample()), /storage unavailable/);
	assert.equal(f.rows().length, 2);
	const g = fixture();
	await g.service.settings('owner', { deviceId: 'device', type: 'location', enabled: true });
	await g.service.record(actor, g.sample('old', 100_000));
	g.setRemoveFailure();
	await assert.rejects(g.service.settings('owner', { deviceId: 'device', type: 'location', retentionMs: 1000 }), /cleanup unavailable/);
	assert.equal(g.rows()[0].crystal.observationSettings.location.retentionMs, null);
	assert.equal(g.rows().length, 3);
});
test('durable sweep resumes batches, honors leases and retries failed account on later cycle', async () => {
	const f = fixture();
	await f.service.settings('owner', { deviceId: 'device', type: 'location', enabled: true });
	await f.service.record(actor, f.sample('old', 1000));
	await f.service.settings('owner', { deviceId: 'device', type: 'location', retentionMs: 2000 });
	f.setClock(at + 5000);
	for (let i = 0; i < 23; i++)
		f.rows().push({ _id: `extra-${i}`, shareId: `z-device-${String(i).padStart(2, '0')}`, thingtime: ['device'], ownerId: 'other', crystal: {} });
	const first = await f.service.sweep();
	assert.equal(first.deleted, 1);
	assert.equal(first.hasMore, true);
	const state = f.rows().find((r) => r.thingtime.includes('device-observation-cleanup'));
	assert.equal(state.storageClass, 'control');
	assert.equal(state.crystal.cursor, 'z-device-17');
	const second = await f.service.sweep();
	assert.equal(second.hasMore, false);
	assert.equal(state.crystal.cursor, null);
	state.crystal.leaseUntil = new Date(at + 100_000);
	const busy = await f.service.sweep();
	assert.equal(busy.busy, true);
	assert.equal(JSON.stringify(state.crystal).includes('latitude'), false);
});
test('observation filters use measurement time and reject invalid cursors/ranges', async () => {
	const f = fixture();
	await f.service.settings('owner', { deviceId: 'device', type: 'location', enabled: true });
	await f.service.record(actor, f.sample('older', 100_000));
	await f.service.record(actor, f.sample('newer', 1000));
	const page = await f.service.read('owner', {
		deviceId: 'device',
		type: 'location',
		from: new Date(at - 5000).toISOString(),
		to: new Date(at).toISOString()
	});
	assert.deepEqual(
		page.observations.map((o) => o.id),
		['newer']
	);
	await assert.rejects(f.service.read('owner', { deviceId: 'device', type: 'location', cursor: 'malformed' }), code('INVALID_CURSOR'));
	await assert.rejects(f.service.read('owner', { deviceId: 'device', type: 'location', from: 'bad' }), code('INVALID_QUERY'));
});

test('fresh observation survives cleanup when the previous detached latest snapshot has expired', async () => {
	const f = fixture();
	await f.service.settings('owner', { deviceId: 'device', type: 'location', enabled: true, retentionMs: 2000 });
	await f.service.record(actor, f.sample('expired-previous', 1000));
	f.setClock(at + 5000);
	await f.service.record(actor, f.sample('fresh', 500));
	const result = await f.service.read('owner', { deviceId: 'device', type: 'location' });
	assert.equal(result.latest?.id, 'fresh');
	assert.deepEqual(
		result.observations.map((o) => o.id),
		['fresh']
	);
});
