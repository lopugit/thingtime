import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilesHandlers } from './_files';
import { createApiCapabilitiesManifest } from '~/docs/apiDocs';
import { thingtimeCapabilityManifest } from '~/api/utils/capabilities/thingtimeCapabilities';

test('file routes use private full-account access, bounded same-origin JSON and fail-closed limits', async () => {
	let user: any = { id: 'owner', accountKind: 'user' },
		allowed = true,
		calls = 0;
	const handlers = createFilesHandlers({
		getUser: async () => user,
		limit: async () => ({ allowed, unavailable: !allowed } as any),
		inventory: async () => {
			throw Error('unexpected inventory');
		},
		service: {
			async read(owner: string, id: string, op?: string) {
				calls++;
				assert.equal(owner, 'owner');
				assert.equal(id, 'file');
				assert.equal(op, 'operation');
				return { ok: true, receipt: null };
			},
			async commit() {
				calls++;
				return { ok: true, replayed: true };
			}
		} as any
	});
	const request = (method = 'GET', extra: Record<string, string> = {}, body?: string) =>
		new Request('https://example.test/api/v1/files?id=file&operationId=operation', {
			method,
			headers: { Origin: 'https://example.test', 'Content-Type': 'application/json', ...extra },
			body
		});
	const read = await handlers.loader({ request: request() });
	assert.equal(read.status, 200);
	assert.match(read.headers.get('cache-control')!, /private.*no-store/);
	assert.equal((await handlers.action({ request: request('POST', { Origin: 'https://foreign.test' }, '{}') })).status, 403);
	assert.equal((await handlers.action({ request: request('POST', { 'Content-Type': 'text/plain' }, '{}') })).status, 415);
	await assert.rejects(
		handlers.action({ request: request('POST', {}, JSON.stringify({ value: 'x'.repeat(8192) })) }),
		(error: any) => error instanceof Response && error.status === 413
	);
	const before = calls;
	user = null;
	assert.equal((await handlers.loader({ request: request() })).status, 401);
	user = { id: 'service', accountKind: 'service' };
	assert.equal((await handlers.action({ request: request('POST', {}, '{}') })).status, 401);
	user = { id: 'owner', accountKind: 'user' };
	allowed = false;
	assert.equal((await handlers.action({ request: request('POST', {}, '{}') })).status, 503);
	assert.equal(calls, before);
});

test('file capability registers the real read and commit route', () => {
	const manifest = thingtimeCapabilityManifest('https://example.test');
	assert.equal(manifest.features['api.files'].version, '1.1.0');
	assert.equal(createApiCapabilitiesManifest().features['api.files'], '1.1.0');
	assert.ok(manifest.operations.some((op) => op.path === '/api/v1/files' && op.methods.includes('GET') && op.methods.includes('POST')));
});

test('inventory routing is private, full-account, rate-limited and rejects mixed or duplicate selectors', async () => {
	let calls = 0,
		user: any = { id: 'owner', accountKind: 'user' },
		allowed = true;
	const handlers = createFilesHandlers({
		getUser: async () => user,
		limit: async () => ({ allowed, unavailable: !allowed } as any),
		service: {} as any,
		inventory: async (owner, root) => {
			calls++;
			assert.equal(owner, 'owner');
			assert.equal(root, 'folder');
			return { ok: true, inventory: {} } as any;
		}
	});
	const request = (query = 'rootId=folder') => new Request('https://example.test/api/v1/files?' + query);
	const result = await handlers.loader({ request: request() });
	assert.equal(result.status, 200);
	assert.match(result.headers.get('cache-control')!, /private.*no-store/);
	for (const query of ['rootId=folder&id=file', 'rootId=folder&rootId=other', 'rootId=folder&cursor=next', 'rootId=folder&operationId=operation'])
		assert.equal((await handlers.loader({ request: request(query) })).status, 400);
	user = null;
	assert.equal((await handlers.loader({ request: request() })).status, 401);
	user = { id: 'owner', accountKind: 'service' };
	assert.equal((await handlers.loader({ request: request() })).status, 401);
	user.accountKind = 'user';
	allowed = false;
	assert.equal((await handlers.loader({ request: request() })).status, 503);
	assert.equal(calls, 1);
});
