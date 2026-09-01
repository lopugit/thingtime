import assert from 'node:assert/strict';
import test from 'node:test';

import { createPeerSyncLoader } from './_sync';

test('peer sync scheduler requires the exact private cron bearer', async () => {
	const loader = createPeerSyncLoader({ getCronSecret: () => 'cron-secret' });
	assert.equal((await loader({ request: new Request('https://thingtime.com/api/v1/peers/sync') })).status, 401);
	assert.equal(
		(await loader({ request: new Request('https://thingtime.com/api/v1/peers/sync', { headers: { authorization: 'Bearer cron-secret-other' } }) }))
			.status,
		401
	);
});

test('peer sync scheduler fails closed until the asymmetric peer identity is configured', async () => {
	const loader = createPeerSyncLoader({ getCronSecret: () => 'cron-secret', getIdentity: () => null });
	assert.equal(
		(await loader({ request: new Request('https://thingtime.com/api/v1/peers/sync', { headers: { authorization: 'Bearer cron-secret' } }) })).status,
		503
	);
});
