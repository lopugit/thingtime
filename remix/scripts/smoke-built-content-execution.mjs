// Exercise the canonical compiled Vercel handlers with a synthetic runtime.
// No .env files, user sessions or listener are needed. Any startup database
// attempt targets only the synthetic loopback URI below.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.argv[2] !== '--worker') {
	const result = spawnSync(process.execPath, [import.meta.filename, '--worker'], {
		env: { PATH: process.env.PATH, NODE_ENV: 'test' }, stdio: 'inherit', timeout: 30000
	});
	if (result.error) throw result.error;
	assert.equal(result.status, 0, 'Compiled content-execution manifest smoke failed');
} else {
	process.env.JWT_SECRET = randomBytes(32).toString('base64url');
	process.env.MONGODB_CONNECTION_STRING = 'mongodb://127.0.0.1:28165/thingtime-built-smoke?serverSelectionTimeoutMS=500';
	process.env.THINGTIME_DATA_ENV = 'custom:built-smoke';
	process.env.THINGTIME_DATA_AUTHORITY_ORIGIN = 'https://thingtime.test';
	const { default: app } = await import(pathToFileURL(resolve(import.meta.dirname, '../.vercel/output/functions/__server.func/index.mjs')).href);
	assert.equal(typeof app.fetch, 'function');
	const contracts = [
		['things', 'things', '1.62.0', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']],
		['things-search', 'things/search', '1.7.0', ['GET', 'POST']],
		['things-update', 'things/update', '1.26.0', ['POST']],
		['actions-run', 'actions/run', '1.46.0', ['POST']],
		['components-browse', 'components/browse', '1.1.0', ['GET']],
		['webpages-resolve', 'webpages/resolve', '1.18.0', ['GET', 'POST']],
		['files', 'files', '1.12.2', ['GET', 'POST']],
		['things-bulk', 'things/bulk', '1.8.0', ['POST']],
		['things-delete', 'things/delete', '1.1.1', ['POST']],
		['timeline', 'timeline', '1.23.0', ['GET', 'POST']],
		['things-export', 'things/export', '1.18.0', ['POST']],
		['things-import', 'things/import', '1.15.0', ['POST']],
		['attachment-content', 'attachments/content', '1.20.0', ['GET', 'POST']],
		['attachment-link', 'attachments/link', '1.3.0', ['POST']],
		['attachment-upload-abort', 'attachments/uploads/abort', '1.4.0', ['POST']],
		['attachment-annotate', 'attachments/annotate', '1.4.0', ['POST']],
		['attachment-delete', 'attachments/delete', '1.9.0', ['POST']],
		['chatgpt-mcp', 'integrations/chatgpt/mcp', '2.3.0', ['POST']]
	];
	const readJson = async path => {
		const response = await app.fetch(new Request('https://thingtime.test' + path), { waitUntil() {} });
		assert.equal(response.status, 200, path);
		assert.match(response.headers.get('content-type') || '', /application\/json/, path);
		return response.json();
	};
	const manifest = await readJson('/.well-known/thingtime-capabilities.json');
	const registry = await readJson('/api/v1/capabilities');
	assert.equal(manifest.origin, 'https://thingtime.test');
	for (const [id, route, version, methods] of contracts) {
		const feature = `api.${id}`;
		const endpoint = `/api/v1/${route}`;
		assert.equal(manifest.features[feature]?.version, version, feature);
		assert.equal(registry.features[feature], version, feature);
		assert.ok(registry.features[`route.v1.${route.replaceAll('/', '.')}`], endpoint);
		const operation = manifest.operations.find(operation => operation.feature === feature && operation.path === endpoint);
		assert.deepEqual([...operation?.methods ?? []].sort(), [...methods].sort(), endpoint);
		const body = await readJson(`${endpoint}-docs`);
		assert.equal(body.ok, true, endpoint);
		assert.equal(body.docs.id, id, endpoint);
		assert.equal(body.docs.contractVersion, version, endpoint);
	}
	const connector = await readJson('/.well-known/thingtime-chatgpt-capabilities.json');
	assert.equal(connector.origin, 'https://thingtime.test');
	assert.equal(connector.features['chatgpt.mcp'], '2.1.0');
	assert.equal(connector.features['chatgpt.render-export'], undefined, 'An unconfigured build must not advertise rendering');
	const mcp = (method, params) => app.fetch(new Request('https://thingtime.test/api/v1/integrations/chatgpt/mcp', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
	}), { waitUntil() {} });
	const list = await mcp('tools/list', {});
	assert.equal(list.status, 200);
	const tools = (await list.json()).result.tools;
	assert.ok(tools.some(tool => tool.name === 'login_thingtime'));
	assert.ok(!tools.some(tool => tool.name === 'thingtime_render_and_export'));
	const unavailable = await mcp('tools/call', { name: 'thingtime_render_and_export', arguments: { content: '{}' } });
	assert.equal(unavailable.status, 200);
	assert.equal(unavailable.headers.get('cache-control'), 'no-store');
	assert.equal((await unavailable.json()).result.structuredContent.code, 'RENDER_UNAVAILABLE');
	assert.equal((await mcp('tools/call', { name: 'get_thingtime_thing', arguments: {} })).status, 401);
	console.log(`PASS: compiled Vercel manifests and docs agree on ${contracts.length} content execution, restore, attachment and transfer contracts.`);
}
