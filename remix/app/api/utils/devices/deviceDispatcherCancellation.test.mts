import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
const errors: any[] = [];
let snapshots = 0;
mock.module('nitro/h3', { namedExports: { defineHandler: (handler: any) => handler } });
mock.module(new URL('../mongodb/connectionTracker.ts', import.meta.url).href, { namedExports: { runWithMongoConnectionFeature: (_feature: any, work: any) => work() } });
mock.module(new URL('../mongodb/connectionInventory.ts', import.meta.url).href, { namedExports: { publishMongoConnectionSnapshots: async () => { snapshots++; } } });
mock.module(new URL('../agentTesting.ts', import.meta.url).href, { namedExports: { agentTestRefusal: () => null } });
mock.module(new URL('../../../../server/utils/actionDataRoutes.ts', import.meta.url).href, { namedExports: { actionDataRoutes: {} } });
mock.module(new URL('../auth/expectedActor.ts', import.meta.url).href, { namedExports: { enforceExpectedActor: async () => null } });
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => null } });
mock.module(new URL('../errors/errorLogs.ts', import.meta.url).href, { namedExports: { recordErrorLog: async (...args: any[]) => { errors.push(args); }, withErrorLogRequest: (_path: any, _method: any, work: any) => work() } });
mock.module(new URL('../errors/storageFailure.ts', import.meta.url).href, { namedExports: { storageFailureCode: () => null, storageFailureFromResponse: async () => null } });
mock.module(new URL('../mongodb/endpoint.ts', import.meta.url).href, { namedExports: { getRequestMongoEndpoint: async () => null, runWithMongoEndpoint: (_endpoint: any, work: any) => work() } });
mock.module(new URL('../mongodb/dataPlane.ts', import.meta.url).href, { namedExports: { enforceExpectedDataPlane: () => null } });
mock.module(new URL('../chatgpt/pluginCore.ts', import.meta.url).href, { namedExports: Object.fromEntries(['CHATGPT_AUTHORIZE_PATH', 'CHATGPT_DYNAMIC_CLIENT_REGISTRATION_PATH', 'CHATGPT_MCP_PATH', 'CHATGPT_OAUTH_RELAY_PATH', 'CHATGPT_TOKEN_PATH'].map(key => [key, '/unused-' + key])) });
mock.module(new URL('../storage/userStorageRecovery.ts', import.meta.url).href, { namedExports: { scheduleUserStorageRecovery: () => {} } });
mock.module(new URL('../../../../server/utils/apiFallback.ts', import.meta.url).href, { namedExports: {
	getApiFallbackOrigin: () => null, hasSelfHostedApiEnv: () => true, proxyApiRequestToFallback: () => { throw Error('Unexpected proxy'); }, selectedRuntimeSupportsPlan: async () => false, shouldProxyApiToFallback: () => false, unavailableLocalApiResponse: () => new Response(null, { status: 503 })
} });
mock.module(new URL('../../../docs/apiDocs.ts', import.meta.url).href, { namedExports: { getApiDocByPath: () => ({ group: 'devices' }) } });
const { default: dispatch, routeModules } = await import('../../../../server/routes/api/[...]');
const { StorageMutationError } = await import('../storage/storageCore');
const request = (signal?: AbortSignal) => ({ req: new Request('https://thingtime.test/api/v1/devices/events', { signal }), context: { params: { path: 'v1/devices/events' } } });
beforeEach(() => { errors.length = 0; snapshots = 0; });

test('an observed client disconnect skips error persistence and telemetry publication', async () => {
	const controller = new AbortController();
	routeModules['v1/devices/events'] = async () => ({ loader: async () => { controller.abort(); throw new DOMException('Disconnected', 'AbortError'); } });
	await assert.rejects((dispatch as any)(request(controller.signal)), { name: 'AbortError' });
	assert.equal(errors.length, 0); assert.equal(snapshots, 0);
});

test('service timeouts and abort-named errors without a disconnected request remain logged', async () => {
	for (const name of ['TimeoutError', 'AbortError']) {
		errors.length = 0;
		routeModules['v1/devices/events'] = async () => ({ loader: async () => { throw new DOMException('Service failed', name); } });
		await assert.rejects((dispatch as any)(request()), { name });
		assert.equal(errors.length, 1); assert.equal(errors[0][1].source, 'http-unhandled');
	}
	assert.equal(snapshots, 2);
});

test('storage errors skip persistence only for an independently observed disconnect', async () => {
	for (const disconnected of [false, true]) {
		errors.length = 0;
		const controller = new AbortController();
		routeModules['v1/devices/events'] = async () => ({ loader: async () => {
			if (disconnected) controller.abort();
			throw new StorageMutationError(503, 'accounting_unavailable', 'Storage unavailable');
		} });
		const response = await (dispatch as any)(request(controller.signal));
		assert.equal(response.status, 503); assert.equal(errors.length, disconnected ? 0 : 1);
	}
});
