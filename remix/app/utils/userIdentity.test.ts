import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANONYMOUS_USER_NAME,
  LOGIN_TO_CLAIM_LABEL,
  getUserDisplayName,
  getUserIdentityDetail,
  getUserMention
} from './userIdentity';

test('temporary identities never expose their generated username in presentation labels', () => {
  const temporary = {
    username: 'guest-a1b2c3d4e5f6',
    displayName: 'Temporary space',
    temporary: true
  };

  assert.equal(getUserDisplayName(temporary), ANONYMOUS_USER_NAME);
  assert.equal(getUserIdentityDetail(temporary), LOGIN_TO_CLAIM_LABEL);
  assert.equal(getUserMention(temporary), ANONYMOUS_USER_NAME);
});

test('claimed identities retain their chosen name and public handle', () => {
  const claimed = { username: 'lopu', displayName: 'Lopu', temporary: false };

  assert.equal(getUserDisplayName(claimed), 'Lopu');
  assert.equal(getUserIdentityDetail(claimed), '@lopu');
  assert.equal(getUserMention(claimed), '@lopu');
});
