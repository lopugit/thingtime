import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutomationSwitchesClient } from './automationSwitchesClient';

const fixture = (responses: Array<{ ok: boolean; body: unknown } | Error>, saved?: string) => {
	let now = 0;
	const calls: string[] = [];
	const storage = new Map<string, string>(saved ? [['tt-automation-switches:v1', saved]] : []);
	let onReturn: (() => void) | undefined;
	const client = createAutomationSwitchesClient({
		fetch: async (url) => {
			calls.push(url);
			const next = responses.shift();
			if (!next || next instanceof Error) throw next ?? new Error('offline');
			return { ok: next.ok, json: async () => next.body };
		},
		storage: () => ({ getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => void storage.set(key, value) }),
		now: () => now,
		onReturn: (listener) => { onReturn = listener; return () => {}; }
	});
	const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
	return { client, calls, storage, flush, back: async (ms: number) => { now += ms; onReturn?.(); await flush(); } };
};

test('everything is off until the server answers, then the answer applies and is remembered', async () => {
	const f = fixture([{ ok: true, body: { ok: true, switches: { 'web.timeline': true } } }]);
	assert.equal(f.client.allows('timer:timeline/TimelineProvider:1'), false);
	let changes = 0;
	f.client.subscribe(() => changes++);
	await f.flush();
	assert.equal(f.calls.length, 1);
	assert.equal(f.client.allows('timer:timeline/TimelineProvider:1'), true);
	assert.equal(f.client.allows('timer:components/Nav/NotificationsBell:1'), false);
	assert.equal(changes, 1);
	assert.match(f.storage.get('tt-automation-switches:v1') ?? '', /"web.timeline":true/);
});

test('a failed or refused read never switches work on', async () => {
	const f = fixture([new Error('offline'), { ok: false, body: { ok: false } }], JSON.stringify({ 'web.lopu': true }));
	assert.equal(f.client.enabled('web.lopu'), true, 'previous visit seeds first paint');
	f.client.start();
	await f.flush();
	assert.equal(f.client.enabled('web.lopu'), true);
	await f.back(11 * 60_000);
	assert.equal(f.client.enabled('web.lopu'), true);
	assert.equal(f.client.enabled('web.timeline'), false);
});

test('switches are re-read on return to the window at most every ten minutes, never on a timer', async () => {
	const answer = { ok: true, body: { ok: true, switches: {} } };
	const f = fixture([answer, answer, answer]);
	f.client.start();
	await f.flush();
	await f.back(60_000);
	assert.equal(f.calls.length, 1);
	await f.back(10 * 60_000);
	assert.equal(f.calls.length, 2);
});

test('the admin editor applies a saved state at once', () => {
	const f = fixture([]);
	f.client.apply({ 'mac.node': true });
	assert.equal(f.client.enabled('mac.node'), true);
});
