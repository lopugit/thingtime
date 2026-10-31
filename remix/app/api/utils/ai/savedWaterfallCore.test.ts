import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedWaterfallInput } from './savedWaterfallCore';
import { createSavedWaterfallHandlers } from '~/routes/api/v1/ai/waterfalls/_waterfalls';
const config = { version: 1, entries: [{ endpointId: 'server:openai', modelId: 'gpt-5.6-sol', effort: null, speed: 'normal' }] };
test('saved configs reject secrets and require an exact edit revision while copying the ordered snapshot', () => {
	const input = { name: ' Coding ', config };
	const saved = parseSavedWaterfallInput(input);
	assert.equal(saved.name, 'Coding');
	assert.notEqual(saved.config.entries, input.config.entries);
	for (const extra of [{ token: 'secret' }, { ownerId: 'another' }, { name: '' }, { id: 'ai-waterfall-11111111-1111-1111-1111-111111111111' }])
		assert.throws(() => parseSavedWaterfallInput({ ...input, ...extra }));
	assert.throws(() => parseSavedWaterfallInput({ ...input, config: { ...config, entries: [{ ...config.entries[0], token: 'secret' }] } }));
	const revision = '2026-09-11T00:00:00.000Z';
	assert.equal(
		parseSavedWaterfallInput({ ...input, id: 'ai-waterfall-11111111-1111-1111-1111-111111111111', updatedAt: revision }).updatedAt,
		revision
	);
});
test('library route authenticates and fences account changes before reading or saving', async () => {
	let calls = 0;
	let actor = '';
	const deps = {
		user: async () => ({ id: 'owner', temporary: false } as any),
		list: async (id: string) => {
			calls++;
			actor = id;
			return [];
		},
		save: async (id: string, value: unknown) => {
			calls++;
			actor = id;
			parseSavedWaterfallInput(value);
			return { ok: false as const, status: 409, error: 'Conflict' };
		}
	};
	const handler = createSavedWaterfallHandlers(deps);
	const request = (method: string, account = 'owner') => ({
		request: new Request('https://thingtime.test/api/v1/ai/waterfalls', {
			method,
			headers: { 'content-type': 'application/json', 'x-thingtime-expected-user': account },
			...(method === 'POST' ? { body: JSON.stringify({ name: 'Coding', config }) } : {})
		})
	});
	assert.equal((await handler.loader(request('GET', 'other'))).status, 409);
	assert.equal((await handler.action(request('POST', 'other'))).status, 409);
	assert.equal(calls, 0);
	const listed = await handler.loader(request('GET'));
	assert.equal(listed.status, 200);
	assert.equal(actor, 'owner');
	assert.match(listed.headers.get('Cache-Control')!, /no-store/);
	assert.equal((await handler.action(request('POST'))).status, 409);
	assert.equal(actor, 'owner');
	const anonymous = createSavedWaterfallHandlers({ ...deps, user: async () => null });
	assert.equal((await anonymous.loader(request('GET'))).status, 401);
	assert.equal((await anonymous.action(request('POST'))).status, 401);
});
