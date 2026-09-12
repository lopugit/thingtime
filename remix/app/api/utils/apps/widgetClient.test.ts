import assert from 'node:assert/strict';
import test from 'node:test';
import { WIDGET_CALLBACK_URI, WIDGET_CLIENT_ID, widgetClientSeed } from './widgetClient';
import { normalizeDesktopRedirectUri } from './desktopOAuthRedirect';

test('Widgets identity accepts only its exact native callback, with no browser origins', () => {
  const seed = widgetClientSeed(2);
  assert.equal(seed.crystal.clientId, WIDGET_CLIENT_ID);
  assert.deepEqual(seed.crystal.origins, []);
  assert.deepEqual(seed.crystal.nativeRedirectUris, [WIDGET_CALLBACK_URI]);
  assert.equal(normalizeDesktopRedirectUri(WIDGET_CALLBACK_URI)?.native, true);
  assert.equal(seed.ownerId, 'system');
  assert.deepEqual(seed.acl, ['tt:user']);
  assert.equal(seed.storageClass, 'control');
});
