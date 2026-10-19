import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
mock.module('../things/search', { namedExports: { searchThings: async () => { throw new Error('Inject the authorized search'); } } });
mock.module('../things/things', { namedExports: { viewerOf: (user: any, pat: any) => ({ id: user.id, username: user.username, pat }) } });
mock.module('../auth/resolveActor', { namedExports: {
	resolveActor: async () => ({ kind: 'anonymous' }), revalidateActor: async () => ({ kind: 'anonymous' }), actorUser: (actor: any) => actor.kind === 'anonymous' ? null : actor.kind === 'app' ? actor.ctx.user : actor.user,
	actorPat: (actor: any) => actor.kind === 'pat' ? actor.pat : null, actorCors: (actor: any) => actor.cors || {}
} });
mock.module('../rateLimit/enforce', { namedExports: { enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({ status: 429 }) } });
mock.module('../mongodb/endpoint', { namedExports: { getRequestMongoEndpoint: async () => null, runWithMongoEndpoint: (_selection: any, fn: any) => fn() } });
mock.module('../mongodb/dataPlane', { namedExports: { enforceExpectedDataPlane: () => null, mongoDataPlane: (selection: any) => selection?.id || 'home' } });
const { readAgentOverview } = await import('./overview');
const { parseOverviewInput } = await import('./overviewCore');
const { createAgentOverviewHandler } = await import('../../../routes/api/v1/agent-overview/_agent-overview.tsx');
const input = () => parseOverviewInput(new URLSearchParams('taskSchema=tasks&agentSchema=agents'));
const page = (things: any[], nextCursor: string | null = null) => ({ ok: true as const, things, posts: {}, nextCursor, total: null, totalCapped: false, ranked: false });
const thing = (id: string, crystal: any = {}) => ({ id, crystal });

test('canonical search receives the identical scoped viewer and namespace on every source page', async () => {
	const viewer = { id: 'owner', pat: { tokenId: 'scoped', onlyCreatedThings: true, visibility: 'private' as const } };
	const app = { appId: 'app', ownerId: 'owner' } as any;
	const calls: any[] = [];
	const result = await readAgentOverview(viewer, input(), app, { search: async (actualViewer, query, actualApp) => {
		assert.equal(actualViewer, viewer); assert.equal(actualApp, app); calls.push(query);
		const role = (query.conditions as any)[0].conditions[0].value;
		return page([thing(role + (query.cursor || 'first'))], role === 'tasks' && !query.cursor ? 'second' : null);
	} });
	assert.equal(calls.length, 3); assert.equal(result.coverage.complete, true); assert.equal(result.stats.tasks, 2);
	assert.equal(calls.every(query => query.thingtime === 'data' && query.sort === 'oldest'), true);
});

test('ACL/search refusal aborts the whole projection and never exposes raw error details', async () => {
	await assert.rejects(readAgentOverview({ id: 'owner' }, input(), null, { search: async () => ({ ok: false, status: 403, error: 'private upstream detail' }) }), error => (error as any).status === 403 && !(error as Error).message.includes('private upstream'));
});

test('operational scan deadline discloses lower bounds and continuation reaches later source pages', async () => {
	let time = 0;
	const first = await readAgentOverview({ id: 'owner' }, input(), null, { now: () => time, budgetMs: 5, search: async () => { time = 6; return page([thing('first')], 'next-source-page'); } });
	assert.equal(first.coverage.complete, false); assert.ok(first.nextCursor);
	const visited: any[] = [];
	const next = await readAgentOverview({ id: 'owner' }, { ...input(), cursor: first.nextCursor! }, null, { search: async (_viewer, query) => { visited.push(query.cursor); return page([thing(String(query.cursor || 'agent'))]); } });
	assert.ok(visited.includes('next-source-page')); assert.equal(next.coverage.scanContinued, true); assert.equal(next.coverage.complete, false);
});

test('abort fences delayed search completion and prevents additional queries', async () => {
	const controller = new AbortController(); let calls = 0;
	const result = readAgentOverview({ id: 'owner' }, input(), null, { signal: controller.signal, search: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 30)); return page([]); } });
	controller.abort(new Error('stopped'));
	await assert.rejects(result, /stopped/); assert.equal(calls, 1);
});

const request = (stream = false, signal?: AbortSignal) => new Request(`https://thingtime.test/api/v1/agent-overview?taskSchema=tasks${stream ? '&stream=1' : ''}`, { signal });
const user = { id: 'synthetic', username: 'synthetic' };
function dependencies(overrides: Record<string, any> = {}) {
	return { resolveActor: async () => ({ kind: 'user', user }), revalidateActor: async (request: Request, _admitted: any, options: any) => overrides.resolveActor ? overrides.resolveActor(request, options) : { kind: 'user', user }, enforceRateLimit: async () => ({ allowed: true }),
		readAgentOverview: async () => ({ rows: [thing('first')], measuredAt: new Date().toISOString() }),
		getRequestMongoEndpoint: async () => null, runWithMongoEndpoint: (_endpoint: any, fn: any) => fn(), enforceExpectedDataPlane: () => null,
		mongoDataPlane: (endpoint: any) => endpoint?.id || 'home', ...overrides } as any;
}

test('anonymous and rate-limited requests never read records; failures remain private', async () => {
	let reads = 0;
	let handler = createAgentOverviewHandler(dependencies({ resolveActor: async () => ({ kind: 'anonymous' }), readAgentOverview: async () => { reads++; } }));
	let response = await handler({ request: request() }); assert.equal(response.status, 401); assert.equal(reads, 0); assert.match(response.headers.get('Cache-Control')!, /no-store/);
	handler = createAgentOverviewHandler(dependencies({ enforceRateLimit: async () => ({ allowed: false }), readAgentOverview: async () => { reads++; } }));
	response = await handler({ request: request() }); assert.equal(response.status, 429); assert.equal(reads, 0);
	handler = createAgentOverviewHandler(dependencies({ readAgentOverview: async () => { throw new Error('mongodb://secret'); } }));
	response = await handler({ request: request() }); assert.equal(response.status, 503); assert.equal((await response.text()).includes('mongodb://secret'), false);
});

test('PAT scope and app namespace survive route snapshots without downgrading credentials', async () => {
	const pat = { tokenId: 'token', onlyCreatedThings: true, visibility: 'private' };
	for (const actor of [{ kind: 'pat', user, pat }, { kind: 'app', ctx: { user }, scope: { appId: 'one', ownerId: user.id }, rateIdentity: 'app-one', cors: { 'Access-Control-Allow-Origin': 'https://client.test' } }]) {
		const handler = createAgentOverviewHandler(dependencies({ resolveActor: async (_request: Request, options: any) => { assert.equal(options.thingsScope, 'things.read'); return actor; },
			readAgentOverview: async (viewer: any, _input: any, app: any) => { assert.equal(viewer.pat, actor.kind === 'pat' ? pat : null); assert.equal(app, actor.kind === 'app' ? actor.scope : null); return { rows: [], measuredAt: 'now' }; } }));
		const response = await handler({ request: request() }); assert.equal(response.status, 200);
		if (actor.kind === 'app') assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://client.test');
	}
});

test('SSE changes detect deletion, ignore timestamps, and reauthorize before publishing', async () => {
	let reads = 0, auth = 0;
	const handler = createAgentOverviewHandler(dependencies({ resolveActor: async () => { auth++; return { kind: 'user', user }; },
		readAgentOverview: async () => ({ rows: ++reads === 1 ? [thing('deleted-later')] : [], measuredAt: String(reads) }) }), { intervalMs: 2, lifetimeMs: 16 });
	const response = await handler({ request: request(true) }); const output = await response.text();
	assert.equal((output.match(/event: snapshot/g) || []).length, 2); assert.match(output, /event: heartbeat/); assert.ok(auth >= 5);
	assert.match(output, /retry: 2000/); assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8');
});

test('SSE revocation or database change sends forbidden and stops without another record read', async () => {
	for (const change of ['auth', 'plane']) {
		let auth = 0, planes = 0, reads = 0;
		const handler = createAgentOverviewHandler(dependencies({
			resolveActor: async () => change === 'auth' && ++auth > 3 ? { kind: 'anonymous' } : { kind: 'user', user },
			getRequestMongoEndpoint: async () => change === 'plane' && ++planes > 3 ? { id: 'other' } : null,
			readAgentOverview: async () => { reads++; return { rows: [], measuredAt: 'now' }; }
		}), { intervalMs: 1, lifetimeMs: 30 });
		const response = await handler({ request: request(true) }); const output = await response.text();
		assert.match(output, /event: forbidden/); assert.equal(reads, 1);
	}
});

test('reader cancellation stops the polling lifecycle', async () => {
	let reads = 0;
	const handler = createAgentOverviewHandler(dependencies({ readAgentOverview: async () => { reads++; return { rows: [], measuredAt: 'now' }; } }), { intervalMs: 2, lifetimeMs: 50 });
	const response = await handler({ request: request(true) }); const reader = response.body!.getReader(); await reader.read(); await reader.cancel();
	const stopped = reads; await new Promise(resolve => setTimeout(resolve, 12)); assert.equal(reads, stopped);
});
