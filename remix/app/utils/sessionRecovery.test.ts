import assert from 'node:assert/strict';
import test from 'node:test';
import { isSessionRootData, SESSION_RECOVERY_KEY, scheduleSessionRecoveryReset, startSessionRecovery } from './sessionRecovery';

const root = { dataPlane: 'home', titlePrefix: '', envFromCookie: {}, devKitEnv: {}, dataEnvironment: null, user: null };
const fixture = (fetcher: typeof fetch = async () => Response.json(root), timeoutMs = 100) => {
	let probe!: () => Promise<void>;
	let reloads = 0, unsubscribed = false, time = 100_000;
	const values = new Map<string, string>();
	const storage = { getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
	const options = { search: '?view=board', storage: () => storage, reload: () => { reloads++; },
		subscribe: (key: string, listener: () => Promise<void>, interval: number, immediate: boolean) => {
			assert.equal(key, 'session-error-recovery'); assert.equal(interval, 5000); assert.equal(immediate, true);
			probe = listener; return () => { unsubscribed = true; };
		}, fetcher, now: () => time, timeoutMs };
	return { start: () => startSessionRecovery(options), probe: () => probe(), storage, values,
		advance: (ms: number) => { time += ms; }, reloads: () => reloads, unsubscribed: () => unsubscribed };
};

test('recovery checks the exact root query with a credentialed uncached GET then reloads only once', async () => {
	const f = fixture(async (url, init) => {
		assert.equal(url, '/api/root-data?view=board');
		assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
		assert.equal(init?.credentials, 'include'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
		return Response.json(root);
	});
	const stop = f.start(); await f.probe(); await f.probe();
	assert.equal(f.reloads(), 1);
	assert.deepEqual(JSON.parse(f.storage.getItem(SESSION_RECOVERY_KEY)!), { at: 100_000, attempt: 1 });
	stop(); assert.equal(f.unsubscribed(), true);
});

test('both anonymous and authenticated root sessions qualify; unrelated JSON does not', () => {
	assert.equal(isSessionRootData(root), true);
	assert.equal(isSessionRootData({ ...root, user: { id: 'current-user' } }), true);
	for (const data of [{ ok: true }, null, [], { ...root, user: undefined }, { ...root, user: {} }, { ...root, devKitEnv: [] }]) {
		assert.equal(isSessionRootData(data), false);
	}
});
for (const [name, response] of [
	['HTTP error', () => new Response('', { status: 503 })],
	['HTML SPA fallback', () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } })],
	['malformed JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } })],
	['health JSON', () => Response.json({ ok: true })],
	['redirect', () => Object.defineProperty(Response.json(root), 'redirected', { value: true })]
] as const) {
	test(`${name} cannot trigger reload; a later valid read recovers`, async () => {
		let failed = true;
		const f = fixture(async () => failed ? response() : Response.json(root));
		const stop = f.start(); await assert.rejects(f.probe()); assert.equal(f.reloads(), 0);
		failed = false; await f.probe(); assert.equal(f.reloads(), 1); stop();
	});
}

test('pending probes do not overlap and cleanup prevents a late successful reload', async () => {
	let resolve!: (value: Response) => void, calls = 0;
	const f = fixture(async () => { calls++; return new Promise<Response>(r => { resolve = r; }); });
	const stop = f.start(); const pending = f.probe(); await f.probe(); assert.equal(calls, 1);
	stop(); resolve(Response.json(root)); await pending; assert.equal(f.reloads(), 0);
});

test('hung reads are aborted and allow later recovery', async () => {
	let hanging = true;
	const f = fixture(async (_url, init) => {
		if (!hanging) return Response.json(root);
		return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
	}, 5);
	const stop = f.start(); await assert.rejects(f.probe(), { name: 'AbortError' });
	assert.equal(f.reloads(), 0); hanging = false; await f.probe(); assert.equal(f.reloads(), 1); stop();
});

test('reload guard survives remount, slows repeated boot failures and eventually retries', async () => {
	const f = fixture(); let stop = f.start();
	await f.probe(); assert.equal(f.reloads(), 1); stop();
	stop = f.start(); await f.probe(); assert.equal(f.reloads(), 1);
	f.advance(30_000); await f.probe(); assert.equal(f.reloads(), 2); stop();
	stop = f.start(); f.advance(30_000); await f.probe(); assert.equal(f.reloads(), 2);
	f.advance(30_000); await f.probe(); assert.equal(f.reloads(), 3); stop();
});

test('unavailable session storage keeps manual recovery available without an automatic reload loop', async () => {
	const f = fixture(); f.storage.setItem = () => { throw new Error('blocked'); };
	const stop = f.start(); await f.probe(); assert.equal(f.reloads(), 0); stop();
});

test('timeout during JSON decoding ignores a late valid session', async () => {
	let resolve!: (value: unknown) => void;
	const f = fixture(async () => {
		const response = Response.json(root);
		response.json = () => new Promise(r => { resolve = r; });
		return response;
	}, 5);
	const stop = f.start(); const pending = f.probe();
	await new Promise(r => setTimeout(r, 15)); resolve(root); await pending;
	assert.equal(f.reloads(), 0); stop();
});

test('cooldown is capped at five minutes and never permanently exhausts retries', async () => {
	const f = fixture(); f.storage.setItem(SESSION_RECOVERY_KEY, JSON.stringify({ at: 100_000, attempt: 100 }));
	const stop = f.start(); f.advance(299_999); await f.probe(); assert.equal(f.reloads(), 0);
	f.advance(1); await f.probe(); assert.equal(f.reloads(), 1); stop();
});


test('a boot that fails before thirty stable seconds cannot clear the reload guard', () => {
	let resetCount = 0, next = 0;
	const pending = new Map<ReturnType<typeof setTimeout>, () => void>();
	const timers = {
		set: (callback: () => void, delay: number) => {
			assert.equal(delay, 30_000);
			const id = ++next as unknown as ReturnType<typeof setTimeout>;
			pending.set(id, callback); return id;
		},
		clear: (id: ReturnType<typeof setTimeout>) => { pending.delete(id); }
	};
	const cancel = scheduleSessionRecoveryReset(() => { resetCount++; }, timers);
	assert.equal(resetCount, 0);
	cancel(); assert.equal(pending.size, 0, 'unmount or identity change cancels the reset');
	scheduleSessionRecoveryReset(() => { resetCount++; }, timers);
	assert.equal(resetCount, 0);
	for (const callback of pending.values()) callback();
	assert.equal(resetCount, 1, 'only stable mounting resets the guard');
});
