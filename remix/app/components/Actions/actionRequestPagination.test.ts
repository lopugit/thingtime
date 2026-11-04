import { actionLimitsOf, describeActionStep } from './actionInspect';
import assert from 'node:assert/strict';
import test from 'node:test';
import { browserActionMinimumVersion, parseActionRequestPagination } from '~/schemas/actionRequestPagination';
import { sanitizeActionCrystal } from '~/schemas/registry';
import { requestActionPages } from './actionRequestPagination';
import { executeBrowserAction, type BrowserActionHost } from './browserActionRuntime';

const pagination = { cursorParam: 'cursor', cursorPath: 'paging.next', itemsPath: 'data.records', itemKey: 'id', maxPages: 3, maxItems: 5 };
test('indexed expressions negotiate their runtime before old clients can execute them', () => {
	for (const operation of ['indexBy', 'groupBy']) {
		const program = { steps: [{ op: 'return', value: { nested: { ttExpr: [operation, [], '$item.id'] } } }] };
		assert.equal(browserActionMinimumVersion(program), '1.11.0');
	}
	assert.equal(browserActionMinimumVersion({ steps: [{ op: 'return', value: 'indexBy' }] }), '1.7.0');
});
const page = (records: unknown[], next: unknown) => ({ title: 'Collection', data: { records }, paging: { next } });

test('paginated requests preserve metadata, leading-zero data and stable first-seen order across overlapping pages', async () => {
	const queries: Record<string, unknown>[] = [];
	const result = await requestActionPages(
		pagination,
		{ q: 'x & y' },
		async (query, index) => {
			queries.push(query);
			return index === 1
				? page(
						[
							{ id: 'a', serial: '0012' },
							{ id: 'b', title: 'old' }
						],
						'page/2'
				  )
				: page(
						[
							{ id: 'b', title: 'current' },
							{ id: 'c', serial: '0001' }
						],
						null
				  );
		},
		10000
	);
	assert.deepEqual(queries, [{ q: 'x & y' }, { q: 'x & y', cursor: 'page/2' }]);
	assert.deepEqual(
		result,
		page(
			[
				{ id: 'a', serial: '0012' },
				{ id: 'b', title: 'current' },
				{ id: 'c', serial: '0001' }
			],
			null
		)
	);
});

test('pagination refuses cycles, missing fields and invalid cursors rather than silently returning incomplete records', async () => {
	for (const response of [page([], 'repeat'), { data: { records: [] } }, page([], {}), page([], false)]) {
		let calls = 0;
		await assert.rejects(
			requestActionPages(
				pagination,
				{},
				async () => {
					calls++;
					return response;
				},
				10000
			),
			/cursor|configured fields/
		);
		assert.ok(calls <= 2);
	}
	await assert.rejects(
		requestActionPages(pagination, { cursor: 4 }, async () => page([], 2), 10000),
		/backwards/
	);
});

test('page, item and combined byte caps fail instead of presenting a truncated collection', async () => {
	let calls = 0;
	await assert.rejects(
		requestActionPages({ ...pagination, maxPages: 2 }, {}, async () => page([], ++calls), 10000),
		/page budget/
	);
	assert.equal(calls, 2);
	await assert.rejects(
		requestActionPages({ ...pagination, maxItems: 1 }, {}, async (_query, index) => page([{ id: String(index) }], index), 10000),
		/item budget/
	);
	await assert.rejects(
		requestActionPages(pagination, {}, async (_query, index) => page([{ id: String(index), text: 'x'.repeat(100) }], index === 2 ? null : 2), 230),
		/byte budget/
	);
});

test('saved pagination rejects unsafe paths and never repeats a mutation', () => {
	for (const value of [
		{ ...pagination, itemsPath: '__proto__.items' },
		{ ...pagination, cursorPath: 'data.records.next' },
		{ ...pagination, maxPages: Infinity },
		{ ...pagination, maxItems: -1 },
		{ ...pagination, url: 'https://example.test' }
	])
		assert.equal(parseActionRequestPagination(value), null);
	const action = {
		name: 'Pages',
		runtime: 'browser',
		capabilities: [{ capability: 'http.request', endpoints: ['POST /api/v1/things'] }],
		steps: [{ op: 'http.request', method: 'POST', path: '/api/v1/things', feature: 'api.things', minimumVersion: '1.29.0', pagination }]
	};
	assert.equal(sanitizeActionCrystal(action).ok, false);
});

const program = {
	name: 'Pages',
	runtime: 'browser',
	capabilities: [{ capability: 'http.request', endpoints: ['GET /api/v1/things'] }],
	steps: [
		{ op: 'http.request', method: 'GET', path: '/api/v1/things', feature: 'api.things', minimumVersion: '1.29.0', pagination },
		{ op: 'return', value: '$step.1' }
	]
};
const prepared = (limits = {}) => ({
	ok: true as const,
	status: 'prepared' as const,
	execution: 'browser' as const,
	actionId: 'collection',
	viewer: { id: 'owner' },
	inputs: {},
	program: { ...program, limits }
});
const host = (overrides: Partial<BrowserActionHost>): BrowserActionHost => ({
	assertIdentity: () => {},
	request: async () => page([], null),
	prepare: async () => {
		throw new Error('Not expected');
	},
	...overrides
});

test('each page spends the shared operation budget and requires the pagination runtime contract', async () => {
	let calls = 0;
	await assert.rejects(
		executeBrowserAction(
			prepared({ maxOperations: 1 }),
			host({
				request: async (step) => {
					assert.equal(step.runtimeVersion, '1.8.0');
					calls++;
					return page([], 2);
				}
			})
		),
		/operation budget/
	);
	assert.equal(calls, 1);
});

test('an account change between pages stops before another request', async () => {
	let changed = false,
		calls = 0;
	await assert.rejects(
		executeBrowserAction(
			prepared(),
			host({
				assertIdentity: () => {
					if (changed) throw new Error('Account changed');
				},
				request: async () => {
					calls++;
					changed = true;
					return page([], 2);
				}
			})
		),
		/Account changed/
	);
	assert.equal(calls, 1);
});

test('larger browser envelopes are explicit and versioned without increasing server or default limits', async () => {
	const limits = { timeoutMs: 30000, maxResultBytes: 1024 * 1024 };
	const browser = sanitizeActionCrystal({ ...program, limits });
	const server = sanitizeActionCrystal({ name: 'Server', limits, steps: [{ op: 'return', value: 'ok' }] });
	assert.equal(browser.ok, true);
	assert.equal(server.ok, true);
	if (!browser.ok || !server.ok) return;
	assert.deepEqual(browser.crystal.limits, limits);
	assert.equal(actionLimitsOf({ runtime: 'browser', limits }).maxResultBytes, limits.maxResultBytes);
	assert.equal(actionLimitsOf({ runtime: 'browser', limits }).timeoutMs, limits.timeoutMs);
	assert.equal(actionLimitsOf({ runtime: 'server', limits }).maxResultBytes, 262144);
	assert.match(describeActionStep(program.steps[0]), /3 pages \/ 5 items/);
	assert.deepEqual(server.crystal.limits, { timeoutMs: 10000, maxResultBytes: 262144 });
	assert.equal(browserActionMinimumVersion({ steps: [], limits }), '1.8.0');
	assert.equal(browserActionMinimumVersion({ steps: [] }), '1.7.0');
	const response = page([{ id: 'large', text: 'x'.repeat(300000) }], null);
	assert.deepEqual(await executeBrowserAction(prepared(limits), host({ request: async () => response })), response);
	await assert.rejects(executeBrowserAction(prepared(), host({ request: async () => response })), /byte budget/);
});
