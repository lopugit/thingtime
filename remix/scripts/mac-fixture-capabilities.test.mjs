import test from 'node:test';
import assert from 'node:assert/strict';
import { MAC_FIXTURE_API_REQUIREMENTS, validateMacFixtureCapabilities } from './mac-fixture-capabilities.mjs';
const origin = 'http://127.0.0.1:28311';
const manifest = () => ({ origin, features: Object.fromEntries(Object.entries(MAC_FIXTURE_API_REQUIREMENTS).map(([feature, version]) => [feature, { version }])) });

test('fixture accepts its minimum requirements and compatible additive API releases', () => {
  const current = manifest();
  assert.equal(validateMacFixtureCapabilities(current, origin), current);
  current.features['api.files'].version = '1.12.0';
  current.features['api.attachment-content'].version = '1.18.0';
  current.features['api.file-sync-batches'].version = '1.3.1';
  assert.equal(validateMacFixtureCapabilities(current, origin), current);
});
test('fixture refuses wrong-origin, missing, malformed, older and breaking capabilities', () => {
  assert.throws(() => validateMacFixtureCapabilities(manifest(), 'http://127.0.0.1:28399'), /origin mismatch/);
  assert.throws(() => validateMacFixtureCapabilities(null, origin), /origin mismatch/);
  for (const feature of Object.keys(MAC_FIXTURE_API_REQUIREMENTS)) {
    for (const version of [undefined, 'invalid', '1.0.0', '2.0.0']) {
      const current = manifest();
      if (version === undefined) delete current.features[feature];
      else current.features[feature].version = version;
      assert.throws(() => validateMacFixtureCapabilities(current, origin), new RegExp(feature));
    }
  }
});
