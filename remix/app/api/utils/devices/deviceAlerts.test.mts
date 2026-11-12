import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { deviceHash } from './deviceCore';
import { thingUniqueKey } from '../mongodb/uniqueKeys';
let rows: any[],
	push: any,
	sendCount = 0,
	sendMode = 'accepted',
	revoked = false,
	mediaAllowed = true,
	failFinish = false;
const version = 'a'.repeat(64),
	soundId = 'b'.repeat(64),
	session = { test: true };
const actor = { userId: 'owner', deviceId: 'device', sessionId: 'session', capabilities: [] };
class Failure extends Error {
	constructor(readonly status: number, readonly code: string, message: string) {
		super(message);
	}
}
const val = (row: any, key: string) => key.split('.').reduce((v, k) => v?.[k], row);
const eq = (a: any, b: any) =>
	a?.toString && a?._bsontype
		? a.toString('base64') === b?.toString('base64')
		: a instanceof Date || b instanceof Date
		? Number(a) === Number(b)
		: a === b;
const matches = (row: any, q: any): boolean =>
	Object.entries(q).every(([k, v]: [string, any]) => {
		if (k === '$or') return v.some((q: any) => matches(row, q));
		const value = val(row, k);
		if (v && typeof v === 'object' && !v._bsontype && !(v instanceof Date))
			return Object.entries(v).every(([op, x]) => (op === '$exists' ? (value !== undefined) === x : op === '$ne' ? !eq(value, x) : false));
		return Array.isArray(value) ? value.some((x) => eq(x, v)) : eq(value, v);
	});
const put = (row: any, k: string, v: any) => {
	let t = row;
	const parts = k.split('.');
	for (const p of parts.slice(0, -1)) t = t[p] ??= {};
	t[parts.at(-1)!] = v;
};
const collection = {
	findOne: async (q: any) => rows.find((r) => matches(r, q)) || null,
	findOneAndUpdate: async (q: any, u: any) => {
		const r = rows.find((r) => matches(r, q));
		if (!r) return null;
		for (const [k, v] of Object.entries(u.$set || {})) put(r, k, v);
		return r;
	},
	updateOne: async (q: any, u: any, options?: any) => {
		if (failFinish && u.$set?.['crystal.pushDelivery']?.status === 'provider-accepted') throw Error('uncertain storage');
		let r = rows.find((r) => matches(r, q));
		if (!r && options?.upsert) {
			r = { ...q, ...u.$setOnInsert };
			rows.push(r);
		}
		if (r) {
			for (const [k, v] of Object.entries(u.$set || {})) put(r, k, v);
			for (const k of Object.keys(u.$unset || {})) {
				const parts = k.split('.');
				const parent = parts.slice(0, -1).reduce((v, k) => v?.[k], r);
				if (parent) delete parent[parts.at(-1)!];
			}
		}
		return { matchedCount: r ? 1 : 0 };
	},
	deleteMany: async (q: any) => {
		rows = rows.filter((r) => !matches(r, q));
	},
	insertOne: async (row: any) => {
		rows.push(row);
		return { insertedId: row.shareId };
	}
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
	namedExports: {
		getHomeThingsCollection: async () => collection,
		getSessionsCollection: async () => ({
			updateOne: async (q: any) => ({ matchedCount: !revoked && q.userId === 'owner' && q['meta.deviceId'] === 'device' ? 1 : 0 })
		}),
		withHomeMongoTransaction: async (work: any) => work(session)
	}
});
mock.module(new URL('../storage/accountedThings.ts', import.meta.url).href, {
	namedExports: {
		insertAccountedThing: async (c: any, row: any, o: any) => {
			assert.equal(o.accountedPlane, 'home');
			assert.equal(o.session, session);
			return c.insertOne(row);
		},
		updateAccountedThing: async (c: any, q: any, u: any, o: any) => {
			assert.equal(o.accountedPlane, 'home');
			assert.equal(o.session, session);
			return c.updateOne(q, u);
		}
	}
});
mock.module(new URL('./devices.ts', import.meta.url).href, {
	namedExports: {
		newDeviceThing: (kind: string, fields: any) => ({
			shareId: `sound-${rows.length}`,
			thingtime: [kind],
			ownerId: fields.ownerId,
			targetId: fields.targetId,
			crystal: fields.crystal
		})
	}
});
mock.module(new URL('./deviceObservations.ts', import.meta.url).href, { namedExports: { DeviceObservationFailure: Failure } });
mock.module(new URL('./deviceAlertMedia.ts', import.meta.url).href, {
	namedExports: {
		preparedSoundFilename: (id: string) => `tt-${id}.caf`,
		ownedAudio: async (owner: string, id: string, v: string) =>
			mediaAllowed && owner === 'owner' ? { ok: true, attachmentId: id, versionId: v } : { ok: false, status: 404, error: 'Audio unavailable' },
		downloadDeviceMedia: async (owner: string, id: string, v: string) =>
			mediaAllowed && owner === 'owner'
				? {
						ok: true,
						url: 'https://storage.test/signed',
						attachmentId: id,
						versionId: v,
						size: 3,
						contentType: 'audio/mpeg',
						expiresAt: new Date().toISOString()
				  }
				: { ok: false, status: 404, error: 'Audio unavailable' }
	}
});
mock.module(new URL('../notifications/pushDevices.ts', import.meta.url).href, {
	namedExports: {
		getCanonicalDevicePush: async (owner: string, device: string) => {
			assert.equal(owner, 'owner');
			assert.equal(device, 'device');
			return push;
		},
		normalizePushDeviceInput: (v: any) => ({ ok: true, ...v, platform: 'ios', topic: 'com.thingtime.appletime', key: 'pushkey' }),
		pushDeviceUpsert: (_owner: any, _session: any, _v: any, _now: any, binding: any) => ({
			$set: { ownerId: 'owner', crystal: { canonicalDeviceId: binding.deviceId, cacheGeneration: binding.cacheGeneration } }
		})
	}
});
mock.module(new URL('../notifications/apns.ts', import.meta.url).href, {
	namedExports: {
		sendCanonicalDeviceAlert: async () => {
			sendCount++;
			if (sendMode === 'uncertain') throw Error('network outcome unknown');
			return { status: sendMode === 'accepted' ? 'provider-accepted' : 'rejected' };
		}
	}
});
mock.module(new URL('./deviceCommands.ts', import.meta.url).href, {
	namedExports: {
		DEVICE_COMMAND_TERMINAL_RETENTION_MS: 7 * 24 * 60 * 60 * 1000,
		publicDeviceCommand: (row: any) => ({ id: row.shareId, kind: row.crystal.kind, status: row.crystal.status, input: row.crystal.input }),
		createDeviceCommand: async (owner: string, input: any, options: any) => {
			const row = {
				shareId: `command-${input.requestId}`,
				ownerId: owner,
				targetId: input.deviceId,
				thingtime: ['device-command'],
				uniqueKeys: [thingUniqueKey('deviceUniqueKey', deviceHash('command', owner, input.deviceId, input.requestId))],
				crystal: { ...input, notificationId: 'notification', status: 'queued', ...options }
			};
			rows.push(row);
			return { ok: true, command: row, idempotent: false };
		}
	}
});
const service = await import('./deviceAlerts');
const request = (id = 'request') => ({
	deviceId: 'device',
	requestId: id,
	kind: 'notification.show',
	input: { title: 'Find device', message: 'Return me', sound: { kind: 'default' } }
});
const code = (c: string) => (e: any) => e.code === c;
beforeEach(() => {
	rows = [
		{
			_id: 'device',
			shareId: 'device',
			ownerId: 'owner',
			thingtime: ['device'],
			crystal: { platform: 'ios', capabilities: ['notification.show.v1', 'media.play.v1', 'media.prepare.v1'], alertCacheGeneration: 'cache' }
		}
	];
	push = null;
	sendCount = 0;
	sendMode = 'accepted';
	revoked = false;
	mediaAllowed = true;
	failFinish = false;
});
test('one channel is selected atomically; queued notification never switches into later APNs delivery', async () => {
	let result = await service.createDeviceAlert('owner', request());
	assert.equal(result.delivery.channel, 'node');
	push = { cacheGeneration: 'cache' };
	result = await service.createDeviceAlert('owner', request());
	assert.equal(result.delivery.channel, 'node');
	assert.equal(sendCount, 0);
	assert.equal(rows.filter((r) => r.thingtime.includes('device-command')).length, 1);
});
test('provider acceptance is explicit and cannot cause local redisplay or a duplicate send on retry', async () => {
	push = { cacheGeneration: 'cache' };
	let result = await service.createDeviceAlert('owner', request());
	assert.equal(result.delivery.status, 'provider-accepted');
	assert.equal(result.delivery.played, 'not-observed');
	assert.equal(result.command.status, 'succeeded');
	result = await service.createDeviceAlert('owner', request());
	assert.equal(sendCount, 1);
	assert.equal(result.delivery.status, 'provider-accepted');
	const command = rows.find((r) => r.thingtime.includes('device-command'));
	assert.equal(command.crystal.deliveryChannel, 'apns');
	await assert.rejects(
		service.createDeviceAlert('owner', { ...request(), input: { ...request().input, message: 'Changed' } }),
		code('ALERT_CONFLICT')
	);
});
test('uncertain network or receipt storage never silently retries audible APNs', async () => {
	push = { cacheGeneration: 'cache' };
	sendMode = 'uncertain';
	let result = await service.createDeviceAlert('owner', request());
	assert.equal(result.delivery.status, 'unconfirmed');
	assert.equal(result.command.status, 'needs-review');
	await service.createDeviceAlert('owner', request());
	assert.equal(sendCount, 1);
	sendMode = 'accepted';
	failFinish = true;
	await assert.rejects(service.createDeviceAlert('owner', request('second')), /uncertain storage/);
	failFinish = false;
	const doc = rows.find((r) => r.shareId === 'command-second');
	doc.crystal.pushDelivery.at = new Date(Date.now() - 31_000);
	result = await service.readDeviceAlert('owner', 'device', 'second');
	assert.equal(result.delivery.status, 'unconfirmed');
	assert.equal(sendCount, 2);
});
test('media authorization is exact-lease, current capability, permission, owner, and source bound', async () => {
	const command = {
		shareId: 'media',
		ownerId: 'owner',
		targetId: 'device',
		thingtime: ['device-command'],
		crystal: {
			kind: 'media.play',
			input: { attachmentId: 'audio', versionId: version },
			status: 'claimed',
			leaseHash: deviceHash('lease', 'lease'),
			leaseExpiresAt: new Date(Date.now() + 30_000)
		}
	};
	rows.push(command);
	const result = await service.getDeviceAlertMedia(actor, { commandId: 'media', leaseId: 'lease' });
	assert.equal(result.versionId, version);
	await assert.rejects(service.getDeviceAlertMedia(actor, { commandId: 'media', leaseId: 'wrong' }), code('INVALID_LEASE'));
	await assert.rejects(service.getDeviceAlertMedia(actor, { commandId: 'media', leaseId: 'lease', attachmentId: 'foreign' }), code('INVALID_LEASE'));
	mediaAllowed = false;
	await assert.rejects(service.getDeviceAlertMedia(actor, { commandId: 'media', leaseId: 'lease' }), code('MEDIA_UNAVAILABLE'));
	revoked = true;
	await assert.rejects(service.getDeviceAlertMedia(actor, { commandId: 'media', leaseId: 'lease' }), code('DEVICE_REVOKED'));
});
test('prepared CAF receipts require actual short conversion, matching source/lease and current installation cache', async () => {
	rows.push({
		shareId: 'prepare',
		ownerId: 'owner',
		targetId: 'device',
		thingtime: ['device-command'],
		crystal: {
			kind: 'media.prepare',
			input: { attachmentId: 'audio', versionId: version, soundId },
			status: 'claimed',
			leaseHash: deviceHash('lease', 'lease'),
			leaseExpiresAt: new Date(Date.now() + 30_000)
		}
	});
	const body = { commandId: 'prepare', leaseId: 'lease', cacheGeneration: 'cache', soundId, durationSeconds: 3, format: 'caf', status: 'ready' };
	await assert.rejects(service.recordDevicePreparedSound(actor, { ...body, durationSeconds: 30 }), code('INVALID_SOUND'));
	await assert.rejects(service.recordDevicePreparedSound(actor, { ...body, cacheGeneration: 'old' }), code('CACHE_CHANGED'));
	const result = await service.recordDevicePreparedSound(actor, body);
	assert.equal(result.sound.status, 'ready');
	assert.equal(result.sound.filename, `tt-${soundId}.caf`);
	rows[0].crystal.alertCacheGeneration = 'new';
	await assert.rejects(service.recordDevicePreparedSound(actor, body), code('CACHE_CHANGED'));
});
test('approved push resumes the same idempotent dispatcher and records canonical terminal retention', async () => {
	push = { cacheGeneration: 'cache' };
	await service.createDeviceAlert('owner', request('approval'));
	const doc = rows.find((r) => r.shareId === 'command-approval');
	// Reset fixture to the state committed by ask-every-time queue admission.
	doc.crystal.status = 'needs-approval';
	delete doc.crystal.pushDelivery;
	delete doc.crystal.completedAt;
	doc.crystal.requiresApproval = true;
	doc.crystal.approvalState = 'pending';
	sendCount = 0;
	await service.dispatchDeviceAlertPush('owner', 'device', doc.shareId);
	assert.equal(sendCount, 0);
	doc.crystal.status = 'queued';
	doc.crystal.approvalState = 'approved';
	const receipt = await service.dispatchDeviceAlertPush('owner', 'device', doc.shareId);
	assert.equal(receipt.command.status, 'succeeded');
	assert.equal(receipt.delivery.status, 'provider-accepted');
	assert.equal(receipt.delivery.played, 'not-observed');
	assert.equal(sendCount, 1);
	assert.ok(doc.crystal.expiresAt instanceof Date);
	assert.ok(doc.crystal.deviceTtlAt instanceof Date);
	await service.dispatchDeviceAlertPush('owner', 'device', doc.shareId);
	assert.equal(sendCount, 1);
});
