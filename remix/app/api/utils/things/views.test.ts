import assert from 'node:assert/strict';
import test from 'node:test';

import { runWithMongoEndpoint } from '../mongodb/endpoint';
import { emitCreationNotifications } from './things';
import { recordPostViews, resolveViewStats } from './views';

test('custom Mongo content cannot read or mutate home notifications and view telemetry', async () => {
	const previousMongoUri = process.env.MONGODB_CONNECTION_STRING;
	process.env.MONGODB_CONNECTION_STRING = 'mongodb://home.example.test/thingtime';
	try {
		await runWithMongoEndpoint(
			{ url: 'mongodb://custom.example.test/thingtime', savedId: null },
			async () => {
				const request = new Request('https://thingtime.test/api/v1/things/views', {
					headers: { 'user-agent': 'Thingtime boundary regression test' }
				});
				assert.deepEqual(
					await recordPostViews(request, { id: 'viewer-id' }, [{ id: 'home-collision', dwellMs: 5000 }]),
					{ ok: true, counted: 0 }
				);
				assert.equal((await resolveViewStats(['home-collision'])).size, 0);

				// Without the custom-plane guard, this public post would query the home
				// follow/friend graph and emit home bell/email fan-out.
				await emitCreationNotifications(
					{
						shareId: 'home-collision',
						ownerId: 'actor-id',
						thingtime: ['post'],
						crystal: { type: 'text', text: 'untrusted custom-plane post' },
						acl: ['tt:all'],
						tags: [],
						createdAt: new Date(),
						updatedAt: new Date()
					} as any,
					null,
					{ id: 'actor-id', username: 'actor' }
				);
			}
		);
	} finally {
		if (previousMongoUri === undefined) delete process.env.MONGODB_CONNECTION_STRING;
		else process.env.MONGODB_CONNECTION_STRING = previousMongoUri;
	}
});
