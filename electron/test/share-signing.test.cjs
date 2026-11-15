'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('unprovisioned share binaries reject identity claims that prevent macOS launch', async () => {
  const { verifyUnprovisionedShareEntitlements } = await import('../scripts/verify-share-extension.mjs');
  const entitlements = {
    'com.apple.security.application-groups': ['TESTTEAM01.com.thingtime.desktop.share'],
    'com.apple.security.app-sandbox': true,
    'com.apple.security.files.user-selected.read-only': true
  };
  assert.doesNotThrow(() => verifyUnprovisionedShareEntitlements(entitlements));
  for (const key of ['com.apple.application-identifier', 'com.apple.developer.team-identifier']) {
    assert.throws(() => verifyUnprovisionedShareEntitlements({ ...entitlements, [key]: 'TESTTEAM01' }),
      /restricted identity entitlements/);
  }
});
