import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEndpointDocs, createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';
import { capabilitySatisfies } from '../capabilities/capabilityContract';
import { readFileSync } from 'node:fs';
import { DEVICE_THINGTIME, DEVICE_CONTROL_THINGTIME } from '../../../schemas/registry';
const endpoints = {
	'devices-observations': ['/api/v1/devices/observations', ['GET']],
	'devices-node-observations': ['/api/v1/devices/node/observations', ['GET', 'POST']],
	'devices-observation-settings': ['/api/v1/devices/observation-settings', ['POST']],
	'devices-observations-cleanup': ['/api/v1/devices/observations/cleanup', ['GET']]
} as const;
test('observation operations are deliberately versioned in both origin-scoped manifests and Nitro map', () => {
	const origin = 'https://thingtime.test';
	const source = createApiCapabilitiesManifest();
	const manifest = thingtimeCapabilityManifest(origin);
	const map = readFileSync(new URL('../../../../server/routes/api/[...].ts', import.meta.url), 'utf8');
	for (const [id, [path, methods]] of Object.entries(endpoints)) {
		const doc = apiEndpointDocs.find((d) => d.id === id);
		assert.equal(doc?.featureVersion, '1.0.0');
		assert.equal(doc?.contractVersion, '1.0.0');
		assert.deepEqual(doc?.methods, [...methods]);
		assert.equal(doc?.endpoint, path);
		assert.equal(source.features[`api.${id}`], '1.0.0');
		assert.equal(manifest.origin, origin);
		assert.equal(manifest.features[`api.${id}`].version, '1.0.0');
		assert.ok(manifest.operations.some((o) => o.path === path && o.feature === `api.${id}` && methods.every((m) => o.methods.includes(m as any))));
		for (const compatible of ['1.0.0', '1.1.0', '1.0.1']) assert.equal(capabilitySatisfies(compatible, '1.0.0'), true);
		for (const refused of ['', '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(refused, '1.0.0'), false);
		assert.ok(map.includes(`'${path.replace('/api/', '')}'`));
	}
});

test('durable observation content and the leased cleanup cursor keep protected, distinct storage lifecycles', () => {
	assert.ok((DEVICE_THINGTIME as readonly string[]).includes('device-observation'));
	assert.ok((DEVICE_THINGTIME as readonly string[]).includes('device-observation-cleanup'));
	assert.equal((DEVICE_CONTROL_THINGTIME as readonly string[]).includes('device-observation'), false);
	assert.ok((DEVICE_CONTROL_THINGTIME as readonly string[]).includes('device-observation-cleanup'));
	const config = JSON.parse(readFileSync(new URL('../../../../../vercel.json', import.meta.url), 'utf8'));
	assert.ok(config.crons.some((c) => c.path === '/api/v1/devices/observations/cleanup' && c.schedule === '*/15 * * * *'));
});
