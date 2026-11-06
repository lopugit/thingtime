/** Called only by test-account-profile-backup.mjs in its private replica.
 * All fixture data is written through unmodified production Request handlers.
 * Source reads use the same API utility as the account inventory. No Mongo
 * document reads/writes, synthetic users, injected authentication or cursors. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = process.env.THINGTIME_ACCOUNT_PROFILE_TEST_DIRECTORY;
const uri = process.env.MONGODB_CONNECTION_STRING;
assert.ok(directory && /^mongodb:\/\/127\.0\.0\.1:\d+\/thingtime\?replicaSet=account-profile-backup$/.test(uri || ''));
assert.equal(process.env.THINGTIME_EMAIL_PROVIDER, 'console');
const actualDirectory = await realpath(directory!);
assert.equal(dirname(actualDirectory), await realpath(tmpdir()));
assert.ok(basename(actualDirectory).startsWith('thingtime-account-profile-backup-'));
const directoryStat = await stat(actualDirectory);
assert.equal(directoryStat.uid, process.getuid!());
assert.equal(directoryStat.mode & 0o077, 0);
const base = 'http://127.0.0.1:28143';
process.env.APP_URL = base;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.NODE_ENV = 'test';

const register = await import('../app/routes/api/v1/auth/register/_register');
const profile = await import('../app/routes/api/v1/users/profile/_profile');
const notifications = await import('../app/routes/api/v1/notifications/settings/_settings');
const chats = await import('../app/routes/api/v1/chats/settings/_settings');
const prompts = await import('../app/routes/api/v1/settings/lopu-prompt/_lopu-prompt');
const logout = await import('../app/routes/api/v1/auth/logout/_logout');
const { getCurrentUser } = await import('../app/api/utils/auth/getCurrentUser');
const { withHomeMongoSnapshot } = await import('../app/api/utils/mongodb/collections');
const { readBackupAccountContent, retainBackupAccountContent, openBackupAccountSnapshot } = await import('../app/api/utils/backups/accountSnapshots');
const { createAccountInventoryProducer } = await import('../app/api/utils/backups/accountInventory');
const { openLocalBackupStore } = await import('../app/api/utils/backups/localBackupStore');
const { prepareBackup, sealBackup, copySealedBackup } = await import('../app/api/utils/backups/portableBackup');
const { BACKUP_FORMAT } = await import('../app/backups/manifest');
const { normalizeNotificationPrefs } = await import('../app/schemas/registry');

let cookie = '';
const request = (path: string, body?: unknown, authenticated = true) =>
	new Request(base + path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { Origin: base, 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}) },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
async function call(handler: any, path: string, body?: unknown) {
	const response: Response = await handler({ request: request(path, body) });
	assert.equal(response.status, 200, path + ' status');
	return { response, data: await response.json() };
}

const username = 'snapshot-' + randomUUID().slice(0, 8);
const password = randomUUID() + '-NeverExport!';
const email = username + '@example.invalid';
const registration = await call(register.action, '/api/v1/auth/register', { username, password, email, displayName: 'Original account' });
assert.equal(registration.data.ok, true);
cookie = registration.response.headers
	.getSetCookie()
	.map((value) => value.split(';')[0])
	.join('; ');
const ownerId = registration.data.user.id;
const scope = { ownerId, apiOrigin: base, dataPlane: 'home' };
const access = {
	scope,
	authorize: async () => {
		const user = await getCurrentUser(request('/api/v1/auth/me'));
		if (user?.id !== ownerId) throw Error('Account authorization changed');
	}
};
await access.authorize();
await call(profile.action, '/api/v1/users/profile', {
	displayName: 'Saved profile 🥰',
	bio: 'Original\nprofile content',
	hideEmailOnProfile: true,
	avatarUrl: 'https://example.invalid/avatar.png',
	bannerUrl: null
});
const prefs = { push: { reaction: false }, email: { 'weekly-summary': false }, masters: { push: false, email: true } };
const notificationBefore = (await call(notifications.action, '/api/v1/notifications/settings', { prefs })).data.prefs;
await call(chats.action, '/api/v1/chats/settings', { readReceipts: false });
const instructions = [
	{ id: 'saved-enabled', text: 'Keep my exact saved preference.', enabled: true },
	{ id: 'saved-disabled', text: 'Keep this disabled instruction too.', enabled: false }
];
const personalBefore = (await call(prompts.action, '/api/v1/settings/lopu-prompt', { scope: 'personal', revision: null, instructions })).data
	.personal;
const publicBefore = (await call(profile.loader, '/api/v1/users/profile?username=' + username)).data.profile;
const first = await openLocalBackupStore(join(directory!, 'first'));
const second = await openLocalBackupStore(join(directory!, 'second'));
const snapshotId = randomUUID();
let before: any;
await withHomeMongoSnapshot(async (session) => {
	before = await readBackupAccountContent(access, session);
	assert.equal(before.value.profile.displayName, publicBefore.displayName);
	assert.equal(before.value.profile.bio, publicBefore.bio);
	assert.equal(before.value.preferences.hideEmailOnProfile, true);
	assert.equal(before.value.preferences.readReceiptsEnabled, false);
	assert.deepEqual(normalizeNotificationPrefs(before.value.preferences.notificationPrefs), notificationBefore);
	assert.deepEqual(before.value.preferences.lopuInstructions, personalBefore);
	assert.deepEqual(before.value.recentReactions, []);
	assert.equal(Object.prototype.hasOwnProperty.call(before.value.preferences, 'birthday'), false);
	for (const secret of [password, email, 'passwordHash', 'vaultDataKey', 'publicUploads', 'emailVerified'])
		assert.equal(JSON.stringify(before).includes(secret), false, 'Credential/security field exclusion');
	await Promise.all([
		call(profile.action, '/api/v1/users/profile', { displayName: 'Later profile', bio: 'Later', hideEmailOnProfile: false }),
		call(notifications.action, '/api/v1/notifications/settings', { prefs: { masters: { push: true, email: false } } }),
		call(chats.action, '/api/v1/chats/settings', { readReceipts: true }),
		call(prompts.action, '/api/v1/settings/lopu-prompt', {
			scope: 'personal',
			revision: personalBefore.revision,
			instructions: [{ id: 'later', text: 'Later preference.', enabled: true }]
		})
	]);
	assert.deepEqual(await readBackupAccountContent(access, session), before, 'One server timestamp survives real concurrent API updates');
	const stamp = session.snapshotTime;
	const at = new Date(stamp.getHighBitsUnsigned() * 1000).toISOString();
	async function* rows() {
		yield await retainBackupAccountContent(first, snapshotId, 0, before, access);
	}
	await prepareBackup(
		first,
		{
			format: BACKUP_FORMAT,
			snapshotId,
			scope,
			boundary: {
				kind: 'point-in-time',
				token: `mongo:${stamp.getHighBitsUnsigned()}:${stamp.getLowBitsUnsigned()}`,
				startedAt: at,
				completedAt: at
			},
			coverage: {
				selectionId: 'account-profile:' + ownerId,
				description: 'Approved account profile/preferences only; no whole-account or external image byte claim.'
			}
		},
		rows(),
		access
	);
});
const latest = await withHomeMongoSnapshot((session) => readBackupAccountContent(access, session));
assert.equal((latest.value as any).profile.displayName, 'Later profile');
assert.equal((latest.value as any).preferences.readReceiptsEnabled, true);
await sealBackup(first, snapshotId, access);
await copySealedBackup(first, second, snapshotId, access);
await rm(join(directory!, 'first'), { recursive: true });
const offline = await openBackupAccountSnapshot(second, snapshotId, ownerId, access);
assert.deepEqual(offline, before);

// Explicit fixture restore through current writers. Archived identity/revision
// never supplies authority. Product review/restore UI and media remapping remain
// separate work; this proves these saved values can use the current writers.
const value = offline.value as any;
await call(profile.action, '/api/v1/users/profile', {
	displayName: value.profile.displayName,
	bio: value.profile.bio,
	avatarUrl: value.profile.avatarUrl,
	bannerUrl: value.profile.bannerUrl,
	hideEmailOnProfile: value.preferences.hideEmailOnProfile
});
await call(chats.action, '/api/v1/chats/settings', { readReceipts: value.preferences.readReceiptsEnabled });
await call(notifications.action, '/api/v1/notifications/settings', { prefs: value.preferences.notificationPrefs });
const currentPersonal = (await call(prompts.loader, '/api/v1/settings/lopu-prompt')).data.personal;
const staleRestore = await prompts.action({
	request: request('/api/v1/settings/lopu-prompt', {
		scope: 'personal',
		revision: value.preferences.lopuInstructions.revision,
		instructions: value.preferences.lopuInstructions.instructions
	})
});
assert.equal(staleRestore.status, 409, 'Archived revisions cannot bypass the current write fence');
await call(prompts.action, '/api/v1/settings/lopu-prompt', {
	scope: 'personal',
	revision: currentPersonal.revision,
	instructions: value.preferences.lopuInstructions.instructions
});
assert.deepEqual((await call(profile.loader, '/api/v1/users/profile?username=' + username)).data.profile, publicBefore);
assert.deepEqual((await call(notifications.loader, '/api/v1/notifications/settings')).data.prefs, notificationBefore);
assert.equal((await call(chats.loader, '/api/v1/chats/settings')).data.readReceipts, false);
assert.deepEqual((await call(prompts.loader, '/api/v1/settings/lopu-prompt')).data.personal.instructions, instructions);

// A real signup has other managed records. Do not let a successful profile
// proof silently imply complete account coverage.
const incompleteId = randomUUID();
let wholeAccountRefusal = '';
await assert.rejects(createAccountInventoryProducer()(second, incompleteId, access), (error: Error) => {
	wholeAccountRefusal = /hint/.test(error.message) ? 'owner-index-migration-required' : 'unsupported-managed-family';
	return /hint|dedicated adapter/.test(error.message);
});
assert.equal(await second.read(`snapshots/${incompleteId}/plan.json`, 131072), null);
await call(logout.action, '/api/v1/auth/logout', {});
await assert.rejects(
	withHomeMongoSnapshot((session) => readBackupAccountContent(access, session)),
	/authorization changed/
);
// Offline access is independent of a live login, but is still exact-owner scoped.
assert.deepEqual(await openBackupAccountSnapshot(second, snapshotId, ownerId, { scope, authorize: async () => {} }), before);
console.log(
	JSON.stringify({
		accountProfileBackupProof: true,
		wholeAccountRefusal,
		checks: [
			'real-signup-and-settings-handlers',
			'same-timestamp-concurrent-updates',
			'credential-exclusion',
			'independent-vault',
			'explicit-current-writer-restore',
			'whole-account-incomplete-refusal',
			'revoked-live-read',
			'offline-after-logout'
		],
		boundary: 'Production Request handlers and database, not an HTTP/browser or complete-account restore test'
	})
);
process.exit(0);
