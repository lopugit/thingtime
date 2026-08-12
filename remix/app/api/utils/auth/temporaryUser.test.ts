import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTemporaryUserAccountInput, TEMPORARY_USER_STORAGE_ALLOWANCE_BYTES } from './temporaryUser';
import { toPublicProfile, toPublicUser } from './users';
import { isSameOriginPost } from '~/routes/api/v1/auth/temporary/_temporary';
import { ANONYMOUS_USER_NAME } from '~/utils/userIdentity';

test('temporary users are safe standard accounts with bounded storage', () => {
	const input = buildTemporaryUserAccountInput('A1B2-C3D4-E5F6-7890', 'not-a-browser-secret');

	assert.equal(input.username, 'guest-a1b2c3d4e5f6');
	assert.equal(input.email, 'guest-a1b2c3d4e5f6@temporary.thingtime.invalid');
	assert.equal(input.displayName, ANONYMOUS_USER_NAME);
	assert.equal(input.accountKind, 'user');
	assert.equal(input.emailVerified, false);
	assert.equal(input.storageAllowanceBytes, TEMPORARY_USER_STORAGE_ALLOWANCE_BYTES);
	assert.equal(input.meta?.temporary, true);
	assert.equal(input.meta?.recoverable, true);
	assert.ok((input.password || '').length >= 6);
});

test('old temporary account records project as Anonymous without leaking their stored label', () => {
	const stored = {
		_id: '64f000000000000000000003',
		ttid: 'guest-a1b2c3d4e5f6',
		username: 'guest-a1b2c3d4e5f6',
		email: 'guest-a1b2c3d4e5f6@temporary.thingtime.invalid',
		displayName: 'Temporary space',
		emailVerified: false,
		createdAt: new Date('2026-08-12T00:00:00.000Z'),
		meta: { temporary: true }
	};

	const current = toPublicUser(stored);
	const profile = toPublicProfile(stored);
	assert.equal(current.displayName, ANONYMOUS_USER_NAME);
	assert.equal(current.temporary, true);
	assert.equal(profile.displayName, ANONYMOUS_USER_NAME);
	assert.equal(profile.temporary, true);
});

test('temporary bootstrap accepts the public proxy origin and rejects foreign origins', () => {
	const localHeaders = {
		Host: 'localhost:18280',
		Origin: 'http://localhost:18280'
	};
	assert.equal(isSameOriginPost(new Request('http://127.0.0.1:18282/api/v1/auth/temporary', { headers: localHeaders })), true);
	assert.equal(
		isSameOriginPost(
			new Request('http://127.0.0.1:18282/api/v1/auth/temporary', {
				headers: { ...localHeaders, Origin: 'https://attacker.example' }
			})
		),
		false
	);
	assert.equal(isSameOriginPost(new Request('http://127.0.0.1:18282/api/v1/auth/temporary')), true);
});
