import assert from 'node:assert/strict';
import test from 'node:test';

import { createProfileAction } from './_profile';

const endpoint = 'https://thingtime.example/api/v1/users/profile';
const request = (body: unknown, headers: Record<string, string> = {}) =>
	new Request(endpoint, {
		method: 'POST',
		headers: { Origin: 'https://thingtime.example', 'Content-Type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

test('profile action rejects cross-origin, unauthenticated, and non-JSON mutations', async () => {
	let updates = 0;
	const action = createProfileAction({
		getUser: async () => ({ id: 'user-1' } as any),
		updateProfile: async () => {
			updates += 1;
			return { ok: true, user: { id: 'user-1' } as any };
		}
	});
	const crossOrigin = await action({ request: request({}, { Origin: 'https://attacker.example' }) });
	assert.equal(crossOrigin.status, 403);
	assert.deepEqual(await crossOrigin.json(), { ok: false, error: 'Cross-origin profile requests are not allowed' });

	const unauthenticated = createProfileAction({
		getUser: async () => null,
		updateProfile: async () => {
			updates += 1;
			return { ok: true, user: {} as any };
		}
	});
	assert.equal((await unauthenticated({ request: request({}) })).status, 401);
	assert.equal((await action({ request: request('{}', { 'Content-Type': 'text/plain' }) })).status, 415);
	assert.equal(updates, 0);
});

test('profile action forwards managed attachment ids and returns the effective self projection', async () => {
	let received: any;
	const expected = {
		id: 'user-1',
		avatarUrl: '/api/v1/attachments/content?id=avatar-1',
		avatarAttachmentId: 'avatar-1',
		avatarLinkedUrl: 'https://images.example/fallback.jpg'
	};
	const action = createProfileAction({
		getUser: async () => ({ id: 'user-1' } as any),
		updateProfile: async (userId: string, body: any) => {
			received = { userId, body };
			return { ok: true, user: expected as any };
		}
	});
	const response = await action({
		request: request({ avatarAttachmentId: 'avatar-1', bannerAttachmentId: null })
	});
	assert.equal(response.status, 200);
	assert.deepEqual(received, {
		userId: 'user-1',
		body: { avatarAttachmentId: 'avatar-1', bannerAttachmentId: null }
	});
	assert.deepEqual(await response.json(), { ok: true, user: expected });
});

test('profile action preserves authored failures and enforces the streaming body cap', async () => {
	const action = createProfileAction({
		getUser: async () => ({ id: 'user-1' } as any),
		updateProfile: async () => ({ ok: false, status: 409, error: 'The selected avatar attachment is unavailable' })
	});
	const conflict = await action({ request: request({ avatarAttachmentId: 'avatar-missing' }) });
	assert.equal(conflict.status, 409);
	assert.deepEqual(await conflict.json(), { ok: false, error: 'The selected avatar attachment is unavailable' });

	let oversized: unknown;
	try {
		await action({ request: request({ padding: 'x'.repeat(257 * 1024) }, { 'Content-Length': '0' }) });
	} catch (error) {
		oversized = error;
	}
	assert.ok(oversized instanceof Response);
	assert.equal(oversized.status, 413);
	assert.deepEqual(await oversized.json(), { ok: false, error: 'Request body too large' });
});
