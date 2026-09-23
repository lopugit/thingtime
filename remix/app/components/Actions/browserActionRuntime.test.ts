import assert from 'node:assert/strict';
import test from 'node:test';
import { executeBrowserAction, type BrowserActionHost } from './browserActionRuntime';
import { sanitizeActionCrystal } from '~/schemas/registry';
import type { PreparedBrowserAction } from '~/schemas/browserActions';

const request = { op: 'http.request', method: 'GET', path: '/api/v1/things', feature: 'api.things', minimumVersion: '1.27.0', query: { q: '$input.query' } };
const program = (steps: Record<string, unknown>[] = [request, { op: 'return', value: '$step.1' }]): Record<string, any> => ({
	name: 'Read records', runtime: 'browser', inputs: [{ name: 'query', type: 'string' }],
	capabilities: [{ capability: 'http.request', endpoints: ['GET /api/v1/things'] }], steps
});
const prepared = (value = program()): PreparedBrowserAction => ({ ok: true, status: 'prepared', execution: 'browser', actionId: 'reader', viewer: { id: 'viewer-1' }, inputs: { query: 'my items & filter' }, program: value });
const host = (overrides: Partial<BrowserActionHost> = {}): BrowserActionHost => ({
	assertIdentity: (id) => assert.equal(id, 'viewer-1'), request: async () => ({ things: [{ title: 'Battery', serial: '0012' }] }),
	prepare: async () => { throw new Error('No child expected'); }, ...overrides
});

test('browser flow transports query values separately and transforms API data with the shared expression grammar', async () => {
	const result = await executeBrowserAction(prepared(program([
		request, { op: 'compute', value: { ttExpr: ['map', '$step.1.things', { title: '$item.title', serial: '$item.serial' }] } }, { op: 'return', value: '$step.2' }
	])), host({ request: async (step, actor, signal) => {
		assert.equal(step.path, '/api/v1/things'); assert.deepEqual(step.query, { q: 'my items & filter' });
		assert.equal(actor, 'viewer-1'); assert.ok(signal instanceof AbortSignal);
		return { things: [{ title: 'Battery', serial: '0012' }] };
	} }));
	assert.deepEqual(result, [{ title: 'Battery', serial: '0012' }]);
});

test('authoring refuses remote URLs, traversal, parameterized destinations and undeclared endpoints', () => {
	for (const path of ['https://example.com', '//example.com', '/api/v1/../auth', '/api/v1/things?q=1', '/api/v1/%74hings', '$input.query', '/api/v1/auth']) {
		assert.equal(sanitizeActionCrystal(program([{ ...request, path }])).ok, false, path);
	}
	assert.equal(sanitizeActionCrystal({ ...program(), runtime: 'server' }).ok, false);
	assert.equal(sanitizeActionCrystal(program([{ op: 'things.delete', id: '$input.query' }])).ok, false);
	assert.equal(sanitizeActionCrystal(program()).ok, true);
});

test('flow stops immediately when identity changes during a request', async () => {
	let changed = false, count = 0;
	await assert.rejects(executeBrowserAction(prepared(program([request, request])), host({
		assertIdentity: () => { if (changed) throw new Error('Account changed'); },
		request: async () => { count++; changed = true; return {}; }
	})), /Account changed/);
	assert.equal(count, 1);
});

test('child flows share recursion and operation budgets', async () => {
	const parent = program([{ op: 'actions.invoke', action: 'reader' }, { op: 'return', value: '$step.1' }]);
	parent.capabilities = [{ capability: 'actions.invoke', actions: ['reader'] }];
	await assert.rejects(executeBrowserAction(prepared(parent), host({ prepare: async () => prepared(parent) })), /Recursive/);
	const limited = program([request, request]); limited.limits = { maxOperations: 1 };
	let count = 0;
	await assert.rejects(executeBrowserAction(prepared(limited), host({ request: async () => { count++; return {}; } })), /budget/);
	assert.equal(count, 1);
});

test('failed requests do not trigger subsequent writes or automatic retries', async () => {
	let count = 0;
	await assert.rejects(executeBrowserAction(prepared(program([request, request])), host({ request: async () => { count++; throw new Error('Network failure'); } })), /Network failure/);
	assert.equal(count, 1);
});

test('conditional branches and false/zero results retain their values', async () => {
	const result = await executeBrowserAction(prepared(program([
		{ op: 'compute', value: 0 }, { ...request, when: false }, { op: 'return', value: { zero: '$step.1', skipped: '$step.2', flag: false } }
	])), host({ request: async () => assert.fail('Skipped branch must not request') }));
	assert.deepEqual(result, { zero: 0, skipped: null, flag: false });
});


test('a child deadline aborts a hanging host independently of its parent', async () => {
 const childProgram = { ...program(), limits: { timeoutMs: 10 } };
 const parent = program([{ op: 'actions.invoke', action: 'child' }]);
 parent.capabilities = [{ capability: 'actions.invoke', actions: ['child'] }];
 let childSignal: AbortSignal | undefined;
 // Keep Node alive while AbortSignal.timeout uses its unref'ed timer.
 const keepAlive = setTimeout(() => {}, 2000);
 try {
  await assert.rejects(executeBrowserAction(prepared(parent), host({
   prepare: async () => ({ ...prepared(childProgram), actionId: 'child' }),
   request: async (_step, _actor, signal) => { childSignal = signal; return new Promise(() => {}); }
  })), /timed out/);
  assert.equal(childSignal?.aborted, true);
 } finally { clearTimeout(keepAlive); }
});
