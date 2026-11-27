import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_FILE_RESTORE_REQUIREMENTS } from './accountFileRestore';
import { createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { capabilitySatisfies, thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';

test('file restore negotiates every canonical writer epoch contract on both public manifests', () => {
 const docs = createApiCapabilitiesManifest(), runtime = thingtimeCapabilityManifest('https://restore.test');
 for (const [feature, minimum] of Object.entries(ACCOUNT_FILE_RESTORE_REQUIREMENTS)) {
  assert.ok(capabilitySatisfies(docs.features[feature], minimum), feature);
  assert.ok(capabilitySatisfies(runtime.features[feature]?.version ?? '', minimum), feature);
  const [major,minor,patch] = minimum.split('.').map(Number);
  assert.equal(capabilitySatisfies(`${major+1}.0.0`,minimum),false);
  if (patch) assert.equal(capabilitySatisfies(`${major}.${minor}.${patch-1}`,minimum),false);
  assert.equal(capabilitySatisfies('',minimum),false);
 }
});
