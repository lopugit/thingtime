import assert from 'node:assert/strict';
import test from 'node:test';
import { TIMELINE_SETTINGS_BODY_MAX_BYTES, createTimelineSettingsHandlers } from './settings/_settings.tsx';
import { getActiveMongoEndpoint, runWithMongoEndpoint } from '../../../../api/utils/mongodb/endpoint.ts';
import { SecureWriteContendedError } from '../../../../api/utils/auth/users.ts';
import { DEFAULT_HISTORY_PREFS, HISTORY_PAUSED_THINGS_MAX, applyHistoryPrefsPatch, type HistoryPrefs } from '../../../../timeline/historyPrefs.ts';

const ids = (count: number, length = 6) => Array.from({ length: count }, (_, index) => `${String(index).padStart(4, '0')}${'x'.repeat(Math.max(0, length - 4))}`);

function setup() {
	const calls: any[] = [];
	const state = { owner: 'user-1' as string | null, kind: 'user', temporary: false, limited: false, matched: true, contended: false, prefs: { ...DEFAULT_HISTORY_PREFS, pausedThingIds: [] as string[] } as HistoryPrefs };
	const handlers = createTimelineSettingsHandlers({
		user: async () => state.owner ? ({ id: state.owner, accountKind: state.kind, temporary: state.temporary } as any) : null,
		limit: async (...args: any[]) => { calls.push(['rate', ...args.slice(1)]); return { allowed: !state.limited, limit: 30, remaining: 0, resetAt: new Date(Date.now() + 5000).toISOString() } as any; },
		get: async (userId) => { calls.push(['get', userId]); return { ...state.prefs, pausedThingIds: [...state.prefs.pausedThingIds] }; },
		set: async (userId, patch) => {
			calls.push(['set', userId, patch]);
			if (state.contended) throw new SecureWriteContendedError(userId);
			if (!state.matched) return { matched: false };
			state.prefs = applyHistoryPrefsPatch(state.prefs, patch);
			return { matched: true, prefs: state.prefs };
		}
	});
	return { handlers, state, calls };
}
const request = (method = 'GET', body?: unknown, headers: Record<string, string> = {}) => new Request('https://thingtime.test/api/v1/timeline/settings', { method, ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body ?? { prefs: { syncHold: true } }) } : { headers }) });
const isPrivate = (res: Response) => { assert.equal(res.headers.get('Cache-Control'), 'private, no-store'); assert.equal(res.headers.get('Vary'), 'Cookie, Authorization, x-tt-mongo-url'); };

test('only a current full account reaches the store; 401 replies are private and touch nothing', async () => {
	const h = setup();
	for (const [owner, kind, temporary] of [[null, 'user', false], ['user-1', 'user', true], ['user-1', 'service', false]] as const) {
		h.state.owner = owner; h.state.kind = kind; h.state.temporary = temporary;
		for (const req of [request(), request('POST')]) {
			const res = req.method === 'GET' ? await h.handlers.loader({ request: req }) : await h.handlers.action({ request: req });
			assert.equal(res.status, 401); isPrivate(res);
			assert.deepEqual(await res.json(), { ok: false, error: 'Sign in with a full account to manage history settings.' });
		}
	}
	assert.deepEqual(h.calls, []);
});

test('GET returns the stored record under timeline.read, fail-closed per user, with private headers', async () => {
	const h = setup(); h.state.prefs = { syncHold: true, retention: '90d', pausedThingIds: ['page-1'] };
	const res = await h.handlers.loader({ request: request() });
	assert.equal(res.status, 200); isPrivate(res);
	assert.deepEqual(await res.json(), { ok: true, prefs: { syncHold: true, retention: '90d', pausedThingIds: ['page-1'] } });
	assert.deepEqual(h.calls, [['rate', 'timeline.read', 'user:user-1', { failClosed: true }], ['get', 'user-1']]);
	h.state.limited = true;
	const busy = await h.handlers.loader({ request: request() });
	assert.equal(busy.status, 429); isPrivate(busy); assert.ok(busy.headers.get('Retry-After'));
	assert.equal(h.calls.filter(call => call[0] === 'get').length, 1);
});

test('POST validates the body strictly and never writes an invalid patch', async () => {
	const h = setup();
	const refused: Array<[unknown, RegExp]> = [
		[{ prefs: { pausedThingIds: ['page-1'] } }, /Unknown history preference: pausedThingIds/],
		[{ prefs: { pause: ['page-1', '-bad'] } }, /pause contains an invalid Thing id/],
		[{ prefs: { syncHold: 'yes' } }, /syncHold must be true or false/],
		[{ prefs: { retention: 'weekly' } }, /retention must be one of forever, 90d, named/],
		[{ prefs: { pause: ids(HISTORY_PAUSED_THINGS_MAX + 1) } }, /pause lists at most 200 Thing ids/],
		[{ prefs: {} }, /History preference patch is empty/], [{ prefs: { resume: [] } }, /History preference patch is empty/],
		[{ prefs: 'held' }, /prefs must be an object/], [{ prefs: null }, /prefs must be an object/], [{}, /prefs must be an object/],
		[{ prefs: { syncHold: true }, ownerId: 'user-1' }, /Body must be \{ prefs \}/], [[], /Body must be/], ['{not json', /prefs must be an object/]
	];
	for (const [body, pattern] of refused) {
		const res = await h.handlers.action({ request: request('POST', body) });
		assert.equal(res.status, 400, JSON.stringify(body)?.slice(0, 60)); isPrivate(res);
		const reply = await res.json(); assert.equal(reply.ok, false); assert.match(reply.error, pattern);
	}
	assert.deepEqual(h.calls.filter(call => call[0] === 'set'), []);
	assert.equal(h.calls.filter(call => call[0] === 'rate').length, refused.length);
	assert.ok(h.calls.every(call => call[0] !== 'rate' || (call[1] === 'timeline.settings' && call[2] === 'user:user-1' && call[3].failClosed === true)));
	assert.equal((await h.handlers.action({ request: request('DELETE') })).status, 405);
});

test('pause and resume are deltas merged by the store; the reply is the full stored record, never the patch', async () => {
	const h = setup(); h.state.prefs = { syncHold: false, retention: 'named', pausedThingIds: ['page-1'] };
	const first = await h.handlers.action({ request: request('POST', { prefs: { pause: ['page-2', 'page-3'] } }) });
	assert.equal(first.status, 200); isPrivate(first);
	assert.deepEqual(await first.json(), { ok: true, prefs: { syncHold: false, retention: 'named', pausedThingIds: ['page-1', 'page-2', 'page-3'] } });
	const second = await h.handlers.action({ request: request('POST', { prefs: { resume: ['page-1', 'missing'], syncHold: true } }) });
	assert.deepEqual(await second.json(), { ok: true, prefs: { syncHold: true, retention: 'named', pausedThingIds: ['page-2', 'page-3'] } });
	assert.deepEqual(h.calls.filter(call => call[0] === 'set'), [['set', 'user-1', { pause: ['page-2', 'page-3'] }], ['set', 'user-1', { resume: ['page-1', 'missing'], syncHold: true }]]);
	assert.deepEqual(h.calls.filter(call => call[0] === 'get'), []);
});

test('store outcomes map to 404, 400 and a retryable 503 with private headers', async () => {
	const h = setup();
	h.state.matched = false;
	const missing = await h.handlers.action({ request: request('POST') });
	assert.equal(missing.status, 404); isPrivate(missing); assert.deepEqual(await missing.json(), { ok: false, error: 'Account not found' });
	h.state.matched = true; h.state.contended = true;
	const contended = await h.handlers.action({ request: request('POST') });
	assert.equal(contended.status, 503); isPrivate(contended); assert.equal(contended.headers.get('Retry-After'), '1');
	assert.deepEqual(await contended.json(), { ok: false, error: 'History settings are busy; retry shortly' });
	h.state.contended = false; h.state.prefs = { ...DEFAULT_HISTORY_PREFS, pausedThingIds: ids(HISTORY_PAUSED_THINGS_MAX) };
	const overflow = await h.handlers.action({ request: request('POST', { prefs: { pause: ['one-more'] } }) });
	assert.equal(overflow.status, 400); isPrivate(overflow); assert.deepEqual(await overflow.json(), { ok: false, error: 'Too many paused Things (max 200)' });
	assert.equal(h.state.prefs.pausedThingIds.length, HISTORY_PAUSED_THINGS_MAX);
	h.state.limited = true;
	const busy = await h.handlers.action({ request: request('POST') });
	assert.equal(busy.status, 429); isPrivate(busy); assert.ok(busy.headers.get('Retry-After'));
	assert.equal(h.calls.filter(call => call[0] === 'set').length, 3);
});

test('a maximal legitimate patch fits the 64 KiB cap and an oversize body is refused before parsing', async () => {
	const h = setup();
	const body = JSON.stringify({ prefs: { pause: ids(HISTORY_PAUSED_THINGS_MAX, 200) } });
	assert.ok(new TextEncoder().encode(body).byteLength > 16 * 1024 && new TextEncoder().encode(body).byteLength <= TIMELINE_SETTINGS_BODY_MAX_BYTES);
	const ok = await h.handlers.action({ request: request('POST', body) });
	assert.equal(ok.status, 200);
	assert.equal((await ok.json()).prefs.pausedThingIds.length, HISTORY_PAUSED_THINGS_MAX);
	const oversize = JSON.stringify({ prefs: { syncHold: true }, pad: 'x'.repeat(TIMELINE_SETTINGS_BODY_MAX_BYTES) });
	for (const req of [request('POST', oversize), request('POST', { prefs: { syncHold: true } }, { 'content-length': String(TIMELINE_SETTINGS_BODY_MAX_BYTES + 1) })]) {
		const res = await h.handlers.action({ request: req });
		assert.equal(res.status, 413); isPrivate(res); assert.deepEqual(await res.json(), { ok: false, error: 'History settings request is too large' });
	}
	assert.equal(h.calls.filter(call => call[0] === 'set').length, 1);
});

test('a selected custom data source changes nothing: the injected (home-pinned) store is still the one used', async () => {
	const h = setup(); const selection = { url: 'mongodb://custom.test/other', savedId: null };
	await runWithMongoEndpoint(selection, async () => {
		assert.equal(getActiveMongoEndpoint(), selection);
		const read = await h.handlers.loader({ request: request() });
		assert.equal(read.status, 200); assert.deepEqual((await read.json()).prefs, DEFAULT_HISTORY_PREFS);
		const write = await h.handlers.action({ request: request('POST', { prefs: { pause: ['page-1'] } }, { 'x-tt-mongo-url': selection.url }) });
		assert.equal(write.status, 200); assert.deepEqual((await write.json()).prefs.pausedThingIds, ['page-1']);
		assert.equal(getActiveMongoEndpoint(), selection);
	});
	assert.equal(getActiveMongoEndpoint(), null);
	assert.deepEqual(h.calls.filter(call => call[0] !== 'rate'), [['get', 'user-1'], ['set', 'user-1', { pause: ['page-1'] }]]);
	assert.deepEqual(h.state.prefs.pausedThingIds, ['page-1']);
});
