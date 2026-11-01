import test from 'node:test';
import assert from 'node:assert/strict';
import { newFileSyncConfiguration } from './configuration';
import {
	ConfigurationConflict,
	configurationDraftKey,
	persistConfigurationDraft,
	readConfigurationDraft,
	readOwnedSyncFolder,
	saveConfigurationDraft,
	type ConfigurationDraft,
	type ConfigurationEditorTransport
} from './configurationEditor';
const scope = { origin: 'https://thingtime.com', ownerId: 'owner', dataPlane: 'home', deviceId: 'device' };
const config = newFileSyncConfiguration({ name: 'Documents', deviceId: 'device', localRootId: 'root', remoteFolderId: 'cloud' });
const fresh = (): ConfigurationDraft => ({ version: 1, id: 'connection', baseUpdatedAt: null, pending: true, configuration: config, exclusions: '' });
const row = (configuration = config, updatedAt = '2026-10-17T00:00:01Z') => ({
	id: 'connection',
	author: { id: 'owner' },
	acl: ['tt:user'],
	thingtime: ['file-sync'],
	crystal: configuration,
	updatedAt
});
function fixture(initial: any = null) {
	let current = initial,
		creates = 0,
		updates = 0,
		verifies = 0,
		lost = false,
		active = true,
		grant = true;
	const api: ConfigurationEditorTransport = {
		assertCurrent() {
			if (!active) throw Error('identity changed');
		},
		async get(id) {
			if (id === 'cloud') return { id, author: { id: 'owner' }, acl: ['tt:user'], thingtime: ['folder'], crystal: { name: 'Cloud' } };
			if (!current) throw Object.assign(Error('missing'), { status: 404 });
			return current;
		},
		async create(id, configuration) {
			creates++;
			assert.equal(id, 'connection');
			assert.equal(current, null);
			current = row(configuration);
			if (lost) throw Error('lost reply');
		},
		async update(id, configuration, expectedUpdatedAt) {
			updates++;
			assert.equal(id, 'connection');
			assert.equal(current.updatedAt, expectedUpdatedAt);
			current = row(configuration, '2026-10-17T00:00:02Z');
			if (lost) throw Error('lost reply');
		},
		async verifyDeviceRoot(deviceId, rootId) {
			verifies++;
			assert.equal(deviceId, 'device');
			assert.equal(rootId, 'root');
			if (!grant) throw Error('grant missing');
		}
	};
	return {
		api,
		stats: () => ({ creates, updates, verifies }),
		current: () => current,
		lose: () => {
			lost = true;
		},
		switch: () => {
			active = false;
		},
		revoke: () => {
			grant = false;
		}
	};
}
test('persisted fixed identity recovers an accepted create with a lost reply without a second create', async () => {
	const f = fixture();
	f.lose();
	const pending = readConfigurationDraft(JSON.stringify(fresh()), 'device')!;
	assert.equal((await saveConfigurationDraft(pending, scope, f.api)).id, 'connection');
	await saveConfigurationDraft(pending, scope, f.api);
	assert.deepEqual(f.stats(), { creates: 1, updates: 0, verifies: 1 });
});
test('accepted update with lost response recovers exact current state and never repeats mutation', async () => {
	const original = row(),
		f = fixture(original);
	f.lose();
	const pending = { ...fresh(), baseUpdatedAt: original.updatedAt, configuration: { ...config, name: 'Changed' } };
	assert.equal((await saveConfigurationDraft(pending, scope, f.api)).configuration.name, 'Changed');
	await saveConfigurationDraft(pending, scope, f.api);
	assert.equal(f.stats().updates, 1);
});
test('stale edit, deleted edit and colliding fixed ID preserve the draft and never overwrite', async () => {
	for (const [initial, base] of [
		[row({ ...config, name: 'Other' }), null],
		[row({ ...config, name: 'Other' }), '2026-10-16T00:00:00Z'],
		[null, '2026-10-16T00:00:00Z']
	] as const) {
		const f = fixture(initial),
			draft = { ...fresh(), baseUpdatedAt: base },
			before = structuredClone(draft);
		await assert.rejects(saveConfigurationDraft(draft, scope, f.api), ConfigurationConflict);
		assert.deepEqual(draft, before);
		assert.equal(f.stats().creates + f.stats().updates, 0);
	}
});
test('fresh native authorization is required before dispatch, but not to confirm an already saved connection', async () => {
	const f = fixture();
	f.revoke();
	await assert.rejects(saveConfigurationDraft(fresh(), scope, f.api), /grant missing/);
	assert.equal(f.stats().creates, 0);
	const accepted = fixture(row());
	accepted.revoke();
	await saveConfigurationDraft(fresh(), scope, accepted.api);
	assert.equal(accepted.stats().verifies, 0);
});
test('account changes during folder authorization prevent the write', async () => {
	const f = fixture(),
		get = f.api.get;
	f.api.get = async (id) => {
		const result = await get(id);
		if (id === 'cloud') f.switch();
		return result;
	};
	await assert.rejects(saveConfigurationDraft(fresh(), scope, f.api), /identity changed/);
	assert.equal(f.stats().creates, 0);
});
test('read errors other than 404 never imply absence or trigger a create', async () => {
	for (const status of [401, 403, 409, 500, 503]) {
		const f = fixture();
		f.api.get = async () => {
			throw Object.assign(Error('unavailable'), { status });
		};
		await assert.rejects(saveConfigurationDraft(fresh(), scope, f.api), /unavailable/);
		assert.equal(f.stats().creates, 0);
	}
});
test('wrong account, audience, kind, ID or cloud destination cannot authorize saving', async () => {
	for (const change of [{ author: { id: 'another' } }, { acl: ['tt:all'] }, { thingtime: ['post'] }, { id: 'wrong' }]) {
		const f = fixture({ ...row(), ...change });
		await assert.rejects(saveConfigurationDraft(fresh(), scope, f.api));
		assert.equal(f.stats().creates, 0);
	}
	const f = fixture(),
		get = f.api.get;
	f.api.get = async (id) => (id === 'cloud' ? { id, author: { id: 'another' }, acl: ['tt:user'], thingtime: ['folder'] } : get(id));
	await assert.rejects(saveConfigurationDraft(fresh(), scope, f.api), /private cloud folder/);
	assert.equal(f.stats().creates, 0);
});
test('an uncertain request keeps the fixed payload retryable', async () => {
	const f = fixture();
	let requests = 0;
	f.api.create = async () => {
		requests++;
		throw Error('offline');
	};
	const draft = fresh(),
		snapshot = JSON.stringify(draft);
	await assert.rejects(saveConfigurationDraft(draft, scope, f.api), /offline/);
	await assert.rejects(saveConfigurationDraft(draft, scope, f.api), /offline/);
	assert.equal(JSON.stringify(draft), snapshot);
	assert.equal(requests, 2);
});
test('unsaved drafts and wrong device never reach transport', async () => {
	const f = fixture();
	await assert.rejects(saveConfigurationDraft({ ...fresh(), pending: false }, scope, f.api), /Preserve/);
	await assert.rejects(saveConfigurationDraft(fresh(), { ...scope, deviceId: 'another' }, f.api), /device changed/);
	assert.deepEqual(f.stats(), { creates: 0, updates: 0, verifies: 0 });
});
test('verified synchronous storage round-trips incomplete drafts and catches quota, silent writes and concurrent replacement', () => {
	let value: string | null = null;
	const store = {
		getItem: () => value,
		setItem: (_: string, v: string) => {
			value = v;
		},
		removeItem: () => {
			value = null;
		}
	};
	const draft = { ...fresh(), pending: false, configuration: { ...config, name: '   ', remoteFolderId: '' }, exclusions: '../incomplete draft path' };
	const raw = persistConfigurationDraft(store, 'key', null, draft);
	assert.deepEqual(readConfigurationDraft(raw, 'device'), draft);
	assert.throws(() => persistConfigurationDraft(store, 'key', null, draft), /another tab/);
	assert.throws(
		() =>
			persistConfigurationDraft(
				{
					...store,
					setItem() {
						throw Error('quota');
					}
				},
				'key',
				raw,
				fresh()
			),
		/quota/
	);
	assert.throws(() => persistConfigurationDraft({ ...store, setItem() {} }, 'key', raw, fresh()), /Could not preserve/);
	assert.equal(persistConfigurationDraft(store, 'key', raw, null), null);
});
test('drafts reject corruption, cross-device replay and invalid pending payloads without deleting storage', () => {
	assert.throws(() => readConfigurationDraft('{', 'device'));
	assert.throws(() => readConfigurationDraft(JSON.stringify(fresh()), 'another'));
	assert.throws(() => readConfigurationDraft(JSON.stringify({ ...fresh(), exclusions: '../secret' }), 'device'));
	assert.equal(readConfigurationDraft(null, 'device'), null);
	for (const field of ['ownerId', 'deviceId', 'dataPlane', 'origin'])
		assert.notEqual(configurationDraftKey(scope), configurationDraftKey({ ...scope, [field]: 'different' }));
});
test('only private owned cloud folders are offered', () => {
	assert.throws(() => readOwnedSyncFolder({ id: 'cloud', author: { id: 'owner' }, acl: ['tt:all'], thingtime: ['folder'] }, 'owner'));
});
