import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { PERSONAL_RECORDING_CAPABILITY } from './personalRecordingCore';

let devices: any[], sessions: any[];
const queries: any[] = [];
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
	getHomeThingsCollection: async () => ({ find: (filter: any, options: any) => {
		queries.push({ filter, options });
		return { sort: (sort: any) => { queries.push({ sort }); return { limit: (limit: number) => {
			queries.push({ limit }); return { toArray: async () => devices };
		} }; } };
	} }),
	getSessionsCollection: async () => ({ aggregate: (pipeline: any) => {
		queries.push({ pipeline }); return { toArray: async () => sessions };
	} })
} });
const { listPersonalRecordingDevices, validatePersonalRecordingDevice } = await import('./personalRecordingDevices');
beforeEach(() => {
	queries.length = 0;
	devices = [{ shareId: 'paired', crystal: { name: 'My Mac', private: 'must-not-project' } }, { shareId: 'not-a-worker' }];
	sessions = [{ _id: 'paired', lastSeenAt: new Date() }];
});

test('device menu uses two bounded home-owner reads and only live capable device sessions', async () => {
	const choices = await listPersonalRecordingDevices('owner');
	assert.equal(choices.length, 1); assert.equal(choices[0].online, true);
	assert.deepEqual(Object.keys(choices[0]).sort(), ['id', 'lastSeenAt', 'name', 'online']);
	assert.doesNotMatch(JSON.stringify(choices), /must-not-project/);
	assert.deepEqual(queries[0], { filter: { ownerId: 'owner', thingtime: 'device', deletedAt: null },
		options: { projection: { shareId: 1, 'crystal.name': 1 } } });
	assert.deepEqual(queries[2], { limit: 100 });
	const pipeline = queries[3].pipeline;
	const match = pipeline[0].$match;
	assert.equal(match.userId, 'owner'); assert.equal(match.purpose, 'device'); assert.equal(match.revokedAt, null);
	assert.equal(match['meta.capabilities'], PERSONAL_RECORDING_CAPABILITY);
	assert.deepEqual(match['meta.deviceId'], { $in: ['paired', 'not-a-worker'] });
	assert.equal(match.$or[0].expiresAt, null); assert.ok(match.$or[1].expiresAt.$gt instanceof Date);
	assert.deepEqual(pipeline[1], { $group: { _id: '$meta.deviceId', lastSeenAt: { $max: '$meta.lastSeenAt' } } });
	assert.deepEqual(pipeline[2], { $limit: 100 });
});

test('never-connected, malformed, future or stale heartbeats do not claim the device is online', async () => {
	for (const lastSeenAt of [null, undefined, 'invalid', new Date(Date.now() + 600000), new Date(0)]) {
		sessions = [{ _id: 'paired', lastSeenAt }];
		const [choice] = await listPersonalRecordingDevices('owner');
		assert.equal(choice.online, false);
		if (!(lastSeenAt instanceof Date && lastSeenAt.getTime() === 0)) assert.equal(choice.lastSeenAt, null);
	}
});

test('only owned eligible worker ids are selectable, while clearing needs no lookup', async () => {
	await validatePersonalRecordingDevice('owner', null);
	assert.equal(queries.length, 0);
	await validatePersonalRecordingDevice('owner', 'paired');
	await assert.rejects(validatePersonalRecordingDevice('owner', 'not-a-worker'), TypeError);
	await assert.rejects(validatePersonalRecordingDevice('owner', 'another-owner-device'), TypeError);
	devices = []; queries.length = 0;
	assert.deepEqual(await listPersonalRecordingDevices('owner'), []);
	assert.equal(queries.some((query) => query.pipeline), false);
});
