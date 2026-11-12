import assert from 'node:assert/strict';
import test from 'node:test';

import type { UserDoc } from './users';
import { confirmCurrentPassword } from './passwordConfirmation';

const user = (passwordHash = 'stored-hash'): UserDoc => ({
	ttid: 'admin',
	username: 'admin',
	email: 'admin@example.invalid',
	passwordHash,
	displayName: 'Admin',
	emailVerified: true,
	createdAt: new Date('2026-08-08T00:00:00.000Z'),
	updatedAt: new Date('2026-08-08T00:00:00.000Z'),
	meta: {}
});

test('current-password confirmation verifies only the requested user hash', async () => {
	const calls: unknown[][] = [];
	const dependencies = {
		findUser: async (userId: string) => {
			calls.push(['find', userId]);
			return user();
		},
		verify: async (password: string, hash: string) => {
			calls.push(['verify', password, hash]);
			return password === 'correct-password' && hash === 'stored-hash';
		}
	};

	assert.equal(await confirmCurrentPassword('user-1', 'correct-password', dependencies), 'confirmed');
	assert.equal(await confirmCurrentPassword('user-1', 'wrong-password', dependencies), 'mismatch');
	assert.deepEqual(calls, [
		['find', 'user-1'],
		['verify', 'correct-password', 'stored-hash'],
		['find', 'user-1'],
		['verify', 'wrong-password', 'stored-hash']
	]);
});

test('current-password confirmation distinguishes mismatches from unavailable verification', async () => {
	let calls = 0;
	const never = {
		findUser: async () => {
			calls += 1;
			return user();
		},
		verify: async () => {
			calls += 1;
			return true;
		}
	};
	assert.equal(await confirmCurrentPassword('', 'password', never), 'mismatch');
	assert.equal(await confirmCurrentPassword('user-1', '', never), 'mismatch');
	assert.equal(await confirmCurrentPassword('user-1', 'x'.repeat(4_097), never), 'mismatch');
	assert.equal(calls, 0);

	assert.equal(
		await confirmCurrentPassword('user-1', 'password', {
			findUser: async () => null,
			verify: async () => true
		}),
		'mismatch'
	);
	assert.equal(
		await confirmCurrentPassword('user-1', 'password', {
			findUser: async () => user(),
			verify: async () => {
				throw new Error('malformed hash');
			}
		}),
		'unavailable'
	);
	assert.equal(
		await confirmCurrentPassword('user-1', 'password', {
			findUser: async () => {
				throw new Error('lookup unavailable');
			},
			verify: async () => true
		}),
		'unavailable'
	);
});
