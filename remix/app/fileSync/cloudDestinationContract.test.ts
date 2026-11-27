import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeShareId } from '../api/utils/things/things';
import { validateThingtimeCrystal } from '../schemas/registry';
import { prepareSyncCloudDestination } from './cloudDestination';

// These are the canonical validators called by POST /api/v1/things through
// createThing, not the stricter UUIDv4-only dedicated /files folder contract.
// No database or HTTP writes are performed by this contract check.
test('prepared deterministic folder IDs and crystals pass canonical generic Things create validators', async () => {
	const rows = new Map<string, unknown>();
	let creates = 0;
	await prepareSyncCloudDestination(
		{ baseUpdatedAt: null, remoteFolderId: '', source: { name: 'Selected folder', sourcePath: '/Volumes/External/Selected folder' } },
		{ origin: 'https://thingtime.com', ownerId: 'owner', dataPlane: 'home', deviceId: 'device' },
		{
			assertCurrent() {},
			async negotiate() {},
			async get(id) {
				if (!rows.has(id)) throw Object.assign(Error('missing'), { status: 404 });
				return rows.get(id);
			},
			async create(input) {
				assert.match(input.shareId, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
				assert.equal(sanitizeShareId(input.shareId), input.shareId);
				const validated = validateThingtimeCrystal(input.thingtime, input.crystal);
				assert.ok(validated.ok);
				assert.deepEqual(validated.crystal, input.crystal);
				assert.equal(input.folderId, creates === 0 ? null : [...rows.keys()].at(-1));
				rows.set(input.shareId, { ...input, id: input.shareId, author: { id: 'owner' } });
				creates++;
			}
		}
	);
	assert.equal(creates, 3);
});
