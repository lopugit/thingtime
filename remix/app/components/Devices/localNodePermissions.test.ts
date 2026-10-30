import assert from 'node:assert/strict';
import test from 'node:test';

import { permissionSnapshot, permissionStatusLabel } from './localNodePermissions';

const granted = [
	{ kind: 'accessibility', status: 'authorized' as const },
	{ kind: 'screenRecording', status: 'authorized' as const }
];
const previous = { permissions: granted, permissionsCheckedAt: 10, permissionCheckError: null };

test('failed and incomplete checks retain cached access but mark it stale without advancing the check time', () => {
	for (const result of [
		{ status: 'rejected' as const, reason: new Error('Node stopped') },
		{ status: 'fulfilled' as const, value: undefined },
		{ status: 'fulfilled' as const, value: { permissions: [granted[0]] } }
	]) {
		const snapshot = permissionSnapshot(previous, result, 20);
		assert.equal(snapshot.permissions, granted);
		assert.equal(snapshot.permissionsCheckedAt, 10);
		assert.ok(snapshot.permissionCheckError);
	}
});

test('a complete live preflight clears the failure and reflects revocation', () => {
	const permissions = granted.map((permission) => ({ ...permission, status: 'denied' as const }));
	assert.deepEqual(
		permissionSnapshot(
			{ ...previous, permissionCheckError: 'offline' },
			{
				status: 'fulfilled',
				value: { permissions }
			},
			30
		),
		{ permissions, permissionsCheckedAt: 30, permissionCheckError: null }
	);
});

test('unknown and stale results cannot be presented as a current macOS denial or grant', () => {
	assert.equal(permissionStatusLabel('unknown', false), 'Not confirmed');
	assert.equal(permissionStatusLabel('authorized', true), 'Allowed (last known)');
	assert.equal(permissionStatusLabel('denied', true), 'Not allowed by macOS (last known)');
	assert.equal(permissionStatusLabel('denied', false), 'Not allowed by macOS');
});
