import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_CREATION_REQUIREMENTS, CONTENT_EXECUTION_READ_REQUIREMENTS } from '../../../backups/contentCreation';
import { createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { capabilitySatisfies, thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';

test('reviewed creation and inert-preview clients negotiate published semantic contracts on both manifests', () => {
	const origin = 'https://creation-contract.test';
	const source = createApiCapabilitiesManifest(), runtime = thingtimeCapabilityManifest(origin);
	assert.equal(runtime.origin, origin);
	for (const [feature, minimum] of Object.entries({ ...CONTENT_CREATION_REQUIREMENTS, ...CONTENT_EXECUTION_READ_REQUIREMENTS })) {
		assert.ok(capabilitySatisfies(source.features[feature], minimum), feature);
		assert.ok(capabilitySatisfies(runtime.features[feature]?.version ?? '', minimum), feature);
		const [major, minor, patch] = minimum.split('.').map(Number);
		assert.equal(capabilitySatisfies(`${major}.${minor}.${patch + 1}`, minimum), true);
		assert.equal(capabilitySatisfies(`${major + 1}.0.0`, minimum), false);
		assert.equal(capabilitySatisfies(`${major}.${Math.max(0, minor - 1)}.0`, minimum), false);
		assert.equal(capabilitySatisfies('', minimum), false);
	}
});
