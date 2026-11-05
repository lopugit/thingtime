import assert from 'node:assert/strict';
import test from 'node:test';
import { createSuiteInstallResponse } from './_install';
import { withInternalRequestActor } from '~/api/utils/auth/internalRequestActor';
const origin = 'https://suite.example', body = { key: 'guestbook', onlyMissing: true, requestId: '123e4567-e89b-42d3-a456-426614174000', bundleVersion: 'suite-bundle-v1:' + 'a'.repeat(64) };
const request = (extra: Record<string, string> = {}, value: unknown = body) => new Request(origin + '/api/v1/webpages/suites/install', { method: 'POST',
	headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': 'owner', 'X-Thingtime-Expected-Data-Plane': 'home', ...extra }, body: JSON.stringify(value) });
function fixture(overrides: any = {}) {
	let installs = 0;
	const run = createSuiteInstallResponse({ getCurrentUser: async () => ({ id: 'owner' }) as any, mongoDataPlane: () => 'home', enforceRateLimit: async () => ({ allowed: true }) as any,
		installSuiteForViewer: async (_viewer: any, _key: any, options: any) => { await options.admit(); installs++; return { ok: true } as any; }, ...overrides });
	return { run, installs: () => installs };
}
test('receipt installs require the current origin, actor and selected plane', async () => {
	for (const headers of [{ Origin: 'https://foreign.example' }, { 'X-Thingtime-Expected-Actor': 'another' }, { 'X-Thingtime-Expected-Data-Plane': 'custom-' + 'a'.repeat(64) }, { 'X-Thingtime-Expected-Actor': '' }, { 'X-Thingtime-Expected-Data-Plane': '' }]) {
		const f = fixture(), response = await f.run({ request: request(headers) }); assert.ok([400, 403, 409].includes(response.status)); assert.equal(f.installs(), 0); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
	}
	const f = fixture(); assert.equal((await f.run({ request: request() })).status, 200); assert.equal(f.installs(), 1);
});
test('revoked sessions and internal actors cannot install programs', async () => {
	const missing = fixture({ getCurrentUser: async () => null }); assert.equal((await missing.run({ request: request() })).status, 401); assert.equal(missing.installs(), 0);
	const f = fixture(), req = request(); await withInternalRequestActor(req, async () => ({ id: 'owner' }) as any, async () => { assert.equal((await f.run({ request: req })).status, 403); }); assert.equal(f.installs(), 0);
});
test('admission rechecks the actor before writing and before returning a receipt', async () => {
	let reads = 0; const f = fixture({ getCurrentUser: async () => ({ id: ++reads > 2 ? 'changed' : 'owner' }) as any });
	const response = await f.run({ request: request() }); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'WORKSPACE_CHANGED'); assert.equal(f.installs(), 0);
});

test('legacy JSON callers retain the no-Origin admission contract while using atomic installation', async () => {
	const f = fixture(), req = new Request(origin + '/api/v1/webpages/suites/install', { method: 'POST', body: JSON.stringify({ key: 'guestbook', onlyMissing: true }) });
	assert.equal((await f.run({ request: req })).status, 200); assert.equal(f.installs(), 1);
});

test('new-operation bundle mismatch preserves its distinct safe machine code', async () => {
	const f = fixture({ installSuiteForViewer: async () => ({ ok: false, status: 409, code: 'SUITE_BUNDLE_CHANGED', error: 'The bundled suite changed. Your device changes have been kept.' }) });
	const response = await f.run({ request: request() }); assert.equal(response.status, 409);
	assert.equal((await response.json()).code, 'SUITE_BUNDLE_CHANGED');
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
