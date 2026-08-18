import assert from 'node:assert/strict';
import test from 'node:test';

import { userPublicUploadsEnabled } from './users';

// Signup-permissions hotfix. The permission is deliberately TRI-STATE, and each
// state has to survive a refactor:
//   absent → grandfathered (every account that predates the hotfix keeps
//            uploading; a two-state boolean would silently lock them all out)
//   false  → withheld, including AFTER the email is verified — this is the
//            whole point of the change
//   true   → granted by an admin
const doc = (meta: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) => ({
	username: 'nik',
	emailVerified: true,
	...extra,
	...(meta === undefined ? {} : { meta })
});

test('public upload permission is tri-state and defaults to grandfathered', () => {
	// pre-hotfix accounts (no flag at all, and no meta at all)
	assert.equal(userPublicUploadsEnabled(doc(undefined)), true);
	assert.equal(userPublicUploadsEnabled(doc({})), true);
	assert.equal(userPublicUploadsEnabled(doc({ activeThemeId: 'theme-1' })), true);

	// a post-hotfix signup stays withheld even once the email is verified
	assert.equal(userPublicUploadsEnabled(doc({ publicUploads: false })), false);

	// admin approval grants it
	assert.equal(userPublicUploadsEnabled(doc({ publicUploads: true })), true);
});

test('only an exact false withholds the permission', () => {
	// A truthy-ish or malformed value must not read as "withheld" (that would
	// lock out accounts by accident) and a falsy-ish one must not read as
	// "granted" (that would defeat the gate).
	for (const value of [0, '', null, 'false']) {
		assert.equal(userPublicUploadsEnabled(doc({ publicUploads: value })), true, `unexpected deny for ${JSON.stringify(value)}`);
	}
});

test('admins are never gated by the flag', () => {
	// An admin locked out of uploads could not test or fix the approval flow.
	assert.equal(userPublicUploadsEnabled(doc({ publicUploads: false, admin: true })), true);
});
