import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LOPU_MODEL_CHECK_BUSY_RETRIES,
	LOPU_MODEL_CHECK_DEVICE_SKIP,
	createLopuModelCheckFn,
	describeLopuModelCheck,
	describeLopuModelCheckEntry,
	ensureLopuModelCheckScope,
	getLopuModelCheckSnapshot,
	lopuModelCheckAnswerFromError,
	lopuModelCheckItems,
	lopuModelCheckResultsFor,
	resetLopuModelCheck,
	startLopuModelCheck,
	subscribeLopuModelCheck,
	type LopuModelCheckAnswer,
	type LopuModelCheckTarget
} from './lopuModelCheck';
import { buildLopuProviderGroups, type AiModelPublic, type LopuVaultProvider } from './lopuProviderCore';

const model = (id: string, overrides: Partial<AiModelPublic> = {}): AiModelPublic => ({
	id,
	label: id,
	provider: 'anthropic',
	efforts: ['low', 'high'],
	speeds: ['normal'],
	family: 'claude',
	enabled: true,
	available: true,
	isDefault: false,
	...overrides
});
const vault = (id: string, overrides: Partial<LopuVaultProvider> = {}): LopuVaultProvider => ({
	id,
	name: id,
	kind: 'openai',
	model: 'gpt-4o',
	endpointHost: 'api.openai.com',
	available: true,
	reason: null,
	realtimeModels: [],
	...overrides
});

const deferred = <T,>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const keyOf = (target: LopuModelCheckTarget) => ('model' in target ? `model:${target.model}` : `vault:${target.providerId}`);

test('only selectable options are checked; device-local plan connections are listed as skipped', () => {
	const groups = buildLopuProviderGroups(
		[model('a'), model('b', { enabled: false }), model('c', { provider: 'openai', available: false })],
		[vault('v1'), vault('v2', { available: false, reason: 'host not allowed' }), vault('chatgpt-plan-device-01234567-89ab-cdef-0123-456789abcdef')]
	);
	const items = lopuModelCheckItems(groups);
	assert.deepEqual(items.map((item) => item.key), ['model:a', 'vault:v1', 'vault:chatgpt-plan-device-01234567-89ab-cdef-0123-456789abcdef']);
	assert.deepEqual(items[0].target, { model: 'a' });
	assert.deepEqual(items[1].target, { providerId: 'v1' });
	assert.equal(items[2].target, null);
	assert.equal(items[2].skipReason, LOPU_MODEL_CHECK_DEVICE_SKIP);
});

test('a run checks every row a few at a time and paints each answer as it lands', async () => {
	resetLopuModelCheck();
	const pending = new Map<string, ReturnType<typeof deferred<LopuModelCheckAnswer>>>();
	let inFlight = 0;
	let peak = 0;
	const check = async (target: LopuModelCheckTarget) => {
		inFlight += 1;
		peak = Math.max(peak, inFlight);
		const gate = deferred<LopuModelCheckAnswer>();
		pending.set(keyOf(target), gate);
		const answer = await gate.promise;
		inFlight -= 1;
		return answer;
	};
	const items = ['a', 'b', 'c', 'd'].map((id) => ({ key: `model:${id}`, label: id, target: { model: id } }));
	let emits = 0;
	const unsubscribe = subscribeLopuModelCheck(() => (emits += 1));
	const run = startLopuModelCheck({ scope: 'origin|user-1', items, check, concurrency: 2 });
	await flush();
	let snapshot = getLopuModelCheckSnapshot();
	assert.equal(snapshot.running, true);
	assert.equal(snapshot.total, 4);
	assert.equal(snapshot.results['model:a'].status, 'checking');
	assert.equal(snapshot.results['model:c'].status, 'queued');
	assert.equal(peak, 2);

	pending.get('model:a')!.resolve({ live: true, reply: 'Y', latencyMs: 900 });
	await flush();
	snapshot = getLopuModelCheckSnapshot();
	assert.equal(snapshot.results['model:a'].status, 'live');
	assert.equal(snapshot.results['model:c'].status, 'checking');
	assert.equal(snapshot.done, 1);

	pending.get('model:b')!.resolve({ live: false, error: 'HTTP 401', latencyMs: 100 });
	await flush();
	pending.get('model:c')!.resolve({ live: true, reply: 'Yes' });
	await flush();
	pending.get('model:d')!.resolve({ live: false, error: 'timeout' });
	await run;
	snapshot = getLopuModelCheckSnapshot();
	assert.equal(snapshot.running, false);
	assert.equal(snapshot.done, 4);
	assert.equal(peak, 2);
	assert.deepEqual(
		Object.fromEntries(Object.entries(snapshot.results).map(([key, entry]) => [key, entry.status])),
		{ 'model:a': 'live', 'model:b': 'error', 'model:c': 'live', 'model:d': 'error' }
	);
	assert.equal(snapshot.results['model:b'].message, 'HTTP 401');
	assert.equal(describeLopuModelCheck(snapshot), '2 live · 2 errors');
	assert.match(describeLopuModelCheckEntry(snapshot.results['model:a'])!, /^Live — replied in 0\.9 s "Y"$/);
	assert.equal(describeLopuModelCheckEntry(snapshot.results['model:b']), 'Error — HTTP 401');
	assert.ok(emits > 4);
	unsubscribe();
});

test('a new run supersedes the old one: its late answers are dropped', async () => {
	resetLopuModelCheck();
	const first = deferred<LopuModelCheckAnswer>();
	const items = [{ key: 'model:a', label: 'a', target: { model: 'a' } }];
	const old = startLopuModelCheck({ scope: 's', items, check: () => first.promise });
	await flush();
	const fresh = startLopuModelCheck({ scope: 's', items, check: async () => ({ live: false, error: 'down' }) });
	await fresh;
	first.resolve({ live: true, reply: 'stale' });
	await old;
	assert.equal(getLopuModelCheckSnapshot().results['model:a'].status, 'error');
	assert.equal(getLopuModelCheckSnapshot().results['model:a'].message, 'down');
});

test('another viewer never sees the previous viewer\'s results, and a switch clears them', async () => {
	resetLopuModelCheck();
	const pending = deferred<LopuModelCheckAnswer>();
	const items = [{ key: 'model:a', label: 'a', target: { model: 'a' } }];
	const run = startLopuModelCheck({ scope: 'origin|user-1', items, check: () => pending.promise });
	await flush();
	assert.equal(lopuModelCheckResultsFor(getLopuModelCheckSnapshot(), 'origin|user-2').results['model:a'], undefined);
	assert.equal(lopuModelCheckResultsFor(getLopuModelCheckSnapshot(), null).running, false);
	ensureLopuModelCheckScope('origin|user-2');
	pending.resolve({ live: true });
	await run;
	const snapshot = getLopuModelCheckSnapshot();
	assert.equal(snapshot.scope, null);
	assert.deepEqual(snapshot.results, {});
	assert.equal(snapshot.running, false);
});

test('a busy account is waited out a bounded number of times, then reported', async () => {
	resetLopuModelCheck();
	let calls = 0;
	const waits: number[] = [];
	await startLopuModelCheck({
		scope: 's',
		items: [{ key: 'model:a', label: 'a', target: { model: 'a' } }],
		check: async () => {
			calls += 1;
			return calls < 3 ? { busy: true, retryAfterMs: 5_000 } : { live: true, reply: 'Y' };
		},
		wait: async (ms) => {
			waits.push(ms);
		}
	});
	assert.equal(getLopuModelCheckSnapshot().results['model:a'].status, 'live');
	assert.deepEqual(waits, [5_000, 5_000]);

	calls = 0;
	await startLopuModelCheck({
		scope: 's',
		items: [{ key: 'model:a', label: 'a', target: { model: 'a' } }],
		check: async () => {
			calls += 1;
			return { busy: true, retryAfterMs: 60_000 };
		},
		wait: async () => {}
	});
	assert.equal(calls, LOPU_MODEL_CHECK_BUSY_RETRIES + 1);
	assert.equal(getLopuModelCheckSnapshot().results['model:a'].status, 'error');
});

test('skipped rows are final at once and do not count toward the run', async () => {
	resetLopuModelCheck();
	await startLopuModelCheck({ scope: 's', items: [{ key: 'vault:d', label: 'd', target: null, skipReason: 'desktop' }], check: async () => assert.fail('never called') });
	const snapshot = getLopuModelCheckSnapshot();
	assert.equal(snapshot.total, 0);
	assert.equal(snapshot.running, false);
	assert.equal(snapshot.results['vault:d'].status, 'skipped');
	assert.equal(describeLopuModelCheck(snapshot), null);
	assert.equal(describeLopuModelCheckEntry(snapshot.results['vault:d']), 'Not checked — desktop');
});

test('the API call maps to answers: 200 bodies, refusals and short 429s', async () => {
	const live = createLopuModelCheckFn(async () => ({ ok: true, live: true, reply: 'Y', latencyMs: 12 }));
	assert.deepEqual(await live({ model: 'a' }, new AbortController().signal), { live: true, reply: 'Y', latencyMs: 12 });
	const dead = createLopuModelCheckFn(async () => ({ ok: true, live: false, error: 'GPT-5 is rate-limited', latencyMs: 3 }));
	assert.deepEqual(await dead({ model: 'a' }, new AbortController().signal), { live: false, error: 'GPT-5 is rate-limited', latencyMs: 3 });
	const refused = createLopuModelCheckFn(async () => {
		throw Object.assign(new Error('You are out of credits'), { status: 402, retryAfterSeconds: null });
	});
	assert.deepEqual(await refused({ model: 'a' }, new AbortController().signal), { live: false, error: 'You are out of credits' });
	assert.deepEqual(lopuModelCheckAnswerFromError(Object.assign(new Error('busy'), { status: 429, retryAfterSeconds: 5 })), { busy: true, retryAfterMs: 5_000, error: 'busy' });
	assert.deepEqual(lopuModelCheckAnswerFromError(Object.assign(new Error('slow down'), { status: 429, retryAfterSeconds: 400 })), { live: false, error: 'slow down' });
	const abort = new AbortController();
	abort.abort();
	const cancelled = createLopuModelCheckFn(async () => {
		throw Object.assign(new Error('aborted'), { name: 'AbortError' });
	});
	await assert.rejects(cancelled({ model: 'a' }, abort.signal), /aborted/);
});
