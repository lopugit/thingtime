import assert from 'node:assert/strict';
import test from 'node:test';
import { SUBSPACE_MESSAGES_REQUIREMENTS } from './subspaceMessagesCapabilities';
import { capabilitySatisfies } from '~/api/utils/capabilities/capabilityContract';
import { thingtimeCapabilityManifest } from '~/api/utils/capabilities/thingtimeCapabilities';

test('embedded Messenger only activates when every consumed origin contract is compatible', () => {
  const manifest = thingtimeCapabilityManifest('https://subspaces.test');
  for (const [feature, minimum] of Object.entries(SUBSPACE_MESSAGES_REQUIREMENTS)) {
    assert.equal(capabilitySatisfies(manifest.features[feature]?.version, minimum), true, feature);
    assert.equal(capabilitySatisfies(undefined, minimum), false, feature);
    assert.equal(capabilitySatisfies('2.0.0', minimum), false, feature);
    assert.equal(capabilitySatisfies('1.0.0', minimum), false, feature);
  }
});
