import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptOwnerValue } from '../auth/vaultCipher';

test('shared vault cipher reads credentials written by the original user vault and rejects another owner', () => {
  const previous = process.env.THINGTIME_USER_VAULT_KEY;
  process.env.THINGTIME_USER_VAULT_KEY = Buffer.alloc(32, 7).toString('base64url');
  // Frozen synthetic fixture produced by the pre-refactor AES/HMAC/AAD contract.
  const value = { cipherText: '0oIdHHb88KOyqmmxWWrwRmFfdA', iv: 'AwMDAwMDAwMDAwMD', tag: '41Zvio7GbsWjlTs3uzTWRg' };
  try {
    assert.equal(decryptOwnerValue('thingtime-user-vault:v1:', 'fixture-owner', 'fixture-record', value), 'fixture-only-secret');
    assert.throws(() => decryptOwnerValue('thingtime-user-vault:v1:', 'other-owner', 'fixture-record', value));
    assert.throws(() => decryptOwnerValue('thingtime-connections:v1:', 'fixture-owner', 'fixture-record', value));
  } finally {
    if (previous === undefined) delete process.env.THINGTIME_USER_VAULT_KEY;
    else process.env.THINGTIME_USER_VAULT_KEY = previous;
  }
});
