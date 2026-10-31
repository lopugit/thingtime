import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldBootstrapTemporaryUser } from './temporaryUserBootstrap';

test('only an anonymous /things landing bootstraps a temporary user', () => {
	assert.equal(shouldBootstrapTemporaryUser('/things', null), true);
	assert.equal(shouldBootstrapTemporaryUser('/things/', null), true);
	assert.equal(shouldBootstrapTemporaryUser('/', null), false);
	assert.equal(shouldBootstrapTemporaryUser('/login', null), false);
	assert.equal(shouldBootstrapTemporaryUser('/things', { id: 'existing-user' } as any), false);
});
