import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const remixRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const vite = await createServer({
	root: remixRoot,
	configFile: false,
	appType: 'custom',
	server: { middlewareMode: true },
	resolve: { alias: { '~': path.join(remixRoot, 'app') } }
});
const users = await vite.ssrLoadModule('/app/api/utils/auth/users.ts');
test.after(async () => {
	await vite.close();
});

const { stripLegacyStorageFromSecurePayload } = users as typeof import('./users');

test('legacy storage cleanup preserves credentials and metadata but removes both stale counters', () => {
	const payload = {
		email: 'person@example.com',
		passwordHash: 'hash',
		emailVerified: true,
		accountKind: 'user',
		storageAllowanceBytes: 5_000,
		storageUsedBytes: 9_999,
		meta: { theme: 'night', nested: { kept: true } }
	};

	assert.equal(stripLegacyStorageFromSecurePayload(payload), payload);
	assert.deepEqual(payload, {
		email: 'person@example.com',
		passwordHash: 'hash',
		emailVerified: true,
		accountKind: 'user',
		meta: { theme: 'night', nested: { kept: true } }
	});
	assert.equal(Object.prototype.hasOwnProperty.call(payload, 'storageAllowanceBytes'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(payload, 'storageUsedBytes'), false);
});
