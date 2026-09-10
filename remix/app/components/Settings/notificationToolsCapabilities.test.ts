import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsNotificationTools, NOTIFICATION_TOOLS_REQUIREMENTS } from './NotificationTools';
import { createApiCapabilitiesManifest, apiEndpointDocs } from '~/docs/apiDocs';
import { thingtimeCapabilityManifest } from '~/api/utils/capabilities/thingtimeCapabilities';
const origin = 'https://thingtime.test';
test('notification controls require compatible origin-scoped semantic capabilities', () => {
  const manifest = thingtimeCapabilityManifest(origin);
  assert.equal(supportsNotificationTools(manifest, origin), true);
  assert.equal(supportsNotificationTools(manifest, 'https://other.test'), false);
  assert.equal(supportsNotificationTools({ ...manifest, features: { ...manifest.features, 'api.notifications-test': '1.1.0' } }, origin), false);
  for (const id of Object.keys(NOTIFICATION_TOOLS_REQUIREMENTS)) {
    for (const version of [null, '0.9.0', '2.0.0', '1.0.0-preview']) assert.equal(supportsNotificationTools({ ...manifest, features: { ...manifest.features, [id]: version } }, origin), false);
    assert.equal(supportsNotificationTools({ ...manifest, features: { ...manifest.features, [id]: '1.2.0' } }, origin), true);
  }
});
test('new operations are deliberately registered in both manifests', () => {
  for (const [id, version] of [['notifications-test', '1.1.1'], ['lopu-reminders', '1.0.0'], ['watch-recordings', '1.0.0']]) {
    assert.equal(createApiCapabilitiesManifest().features[`api.${id}`], version);
    assert.equal(thingtimeCapabilityManifest(origin).features[`api.${id}`].version, version);
    assert.ok(apiEndpointDocs.find((doc) => doc.id === id)?.methods.includes('POST'));
  }
});
