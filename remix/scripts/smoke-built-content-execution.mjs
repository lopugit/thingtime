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
	const contracts = {
		'api.things': '1.52.0', 'api.actions-run': '1.43.0',
		'api.components-browse': '1.1.0', 'api.webpages-resolve': '1.13.0',
		'api.files': '1.12.1', 'api.things-bulk': '1.7.1', 'api.things-delete': '1.1.1'
	};
	for (const path of ['/.well-known/thingtime-capabilities.json', '/api/v1/capabilities']) {
		const response = await app.fetch(new Request('https://thingtime.test' + path), { waitUntil() {} });
		assert.equal(response.status, 200, path);
		assert.match(response.headers.get('content-type') || '', /application\/json/);
		const body = await response.json();
		if (path.startsWith('/.well-known')) assert.equal(body.origin, 'https://thingtime.test');
		for (const [feature, expected] of Object.entries(contracts)) {
			const entry = body.features[feature];
			assert.equal(typeof entry === 'string' ? entry : entry.version, expected, feature);
		}
	}
	for (const [path, feature] of [['things', 'api.things'], ['actions/run', 'api.actions-run'], ['components/browse', 'api.components-browse'], ['webpages/resolve', 'api.webpages-resolve'], ['files', 'api.files'], ['things/bulk', 'api.things-bulk'], ['things/delete', 'api.things-delete']]) {
		const response = await app.fetch(new Request(`https://thingtime.test/api/v1/${path}-docs`), { waitUntil() {} });
		assert.equal(response.status, 200, path);
		assert.match(response.headers.get('content-type') || '', /application\/json/);
		const body = await response.json();
		assert.equal(body.ok, true);
		assert.equal(body.docs.contractVersion, contracts[feature], path);
	}
	console.log('PASS: compiled Vercel origin manifest, registry and seven content-execution and file-restore fence docs contracts; synthetic loopback database configuration, no installed-app acceptance.');
}
