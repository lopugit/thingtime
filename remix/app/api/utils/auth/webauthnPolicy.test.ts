import assert from 'node:assert/strict';
import test from 'node:test';

import { PASSKEY_USER_VERIFICATION } from './webauthnPolicy';

test('passkey ceremonies request the user verification required by verification', () => {
	assert.equal(PASSKEY_USER_VERIFICATION, 'required');
});
