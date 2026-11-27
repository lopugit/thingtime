import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_AUTOMATION_SWITCHES } from '~/automation/automationSwitches';
import { AUTOMATION_SWITCHES_CACHE_CONTROL, createAutomationSwitchesLoader } from './_switches';

test('the public switches read is CDN-cacheable and lists every switch', async () => {
	const loader = createAutomationSwitchesLoader(async () => ({ switches: DEFAULT_AUTOMATION_SWITCHES, updatedAt: null, updatedBy: 'admin-secret-id' }));
	const response = await loader({ request: new Request('https://thingtime.test/api/v1/automation/switches') });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Cache-Control'), AUTOMATION_SWITCHES_CACHE_CONTROL);
	const body = await response.json();
	assert.deepEqual(body, { ok: true, switches: DEFAULT_AUTOMATION_SWITCHES, updatedAt: null });
	assert.equal('updatedBy' in body, false, 'the public read never names the administrator');
	const refused = await loader({ request: new Request('https://thingtime.test/api/v1/automation/switches', { method: 'POST' }) });
	assert.equal(refused.status, 405);
});
