import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEndpointDocs, createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';
import { readFileSync } from 'node:fs';
test('alert operations and metadata patches are registered deliberately in both manifests and runtime routes', () => {
	const source = createApiCapabilitiesManifest();
	const runtime = thingtimeCapabilityManifest('https://thingtime.test');
	const routes = readFileSync(new URL('../../../../server/routes/api/[...].ts', import.meta.url), 'utf8');
	for (const [id, path, version] of [
		['devices-alerts', 'alerts', '1.0.0'],
		['devices-node-push', 'node/push', '1.0.0'],
		['devices-node-media', 'node/media', '1.0.0'],
		['devices-node-alert-sounds', 'node/alert-sounds', '1.0.0'],
		['devices-commands', 'commands', '1.11.0'],
		['devices-node-commands', 'node/commands', '1.11.1'],
		['devices', '', '1.16.0'],
		['devices-node-state', 'node/state', '1.15.2']
	]) {
		assert.equal(source.features[`api.${id}`], version);
		assert.equal(runtime.features[`api.${id}`]?.version, version);
		const doc = apiEndpointDocs.find((d) => d.id === id);
		assert.equal(doc?.featureVersion, version);
		assert.equal(doc?.contractVersion, version);
		if (path) assert.ok(routes.includes(`'v1/devices/${path}'`));
	}
});
