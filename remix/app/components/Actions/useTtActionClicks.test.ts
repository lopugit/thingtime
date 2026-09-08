import assert from 'node:assert/strict';
import test from 'node:test';

import { runDelegatedAction } from './useTtActionClicks';

// The run-or-install control flow behind a ttAction click on a demo surface:
// the executor refuses delegated clicks that name an action the viewer does
// not own; only THAT refusal may hand off to the surface's installer, and only
// a truthy installer answer re-runs the same click.

const unowned = () => Promise.reject({ error: 'No action you own matches "demo-guestbook-sign" — a component control can only run your own actions' });

test('a successful run passes straight through and never consults onUnowned', async () => {
	let asked = 0;
	const outcome = await runDelegatedAction({
		action: 'demo-guestbook-sign',
		inputs: { name: 'Ada' },
		run: async () => ({ status: 'ok', durationMs: 12, opsUsed: 2 }),
		onUnowned: async () => {
			asked += 1;
			return true;
		}
	});
	assert.equal(outcome.response?.status, 'ok');
	assert.equal(outcome.installed, undefined);
	assert.equal(asked, 0);
});

test('the unowned refusal installs, then re-runs the same click once', async () => {
	let runs = 0;
	const seen: Array<[string, Record<string, unknown>]> = [];
	const outcome = await runDelegatedAction({
		action: 'demo-guestbook-sign',
		inputs: { name: 'Ada', mood: 'happy' },
		run: async () => {
			runs += 1;
			if (runs === 1) return unowned();
			return { status: 'ok', durationMs: 30, opsUsed: 2 };
		},
		onUnowned: async (action, inputs) => {
			seen.push([action, inputs]);
			return true;
		}
	});
	assert.equal(runs, 2);
	assert.deepEqual(seen, [['demo-guestbook-sign', { name: 'Ada', mood: 'happy' }]]);
	assert.equal(outcome.installed, true);
	assert.equal(outcome.response?.status, 'ok');
});

test('an installer that declines leaves the original refusal in place', async () => {
	let runs = 0;
	const outcome = await runDelegatedAction({
		action: 'demo-guestbook-sign',
		inputs: {},
		run: async () => {
			runs += 1;
			return unowned();
		},
		onUnowned: async () => false
	});
	assert.equal(runs, 1);
	assert.match(outcome.error || '', /No action you own matches/);
});

test('other failures surface as-is and never trigger an install', async () => {
	let asked = 0;
	const outcome = await runDelegatedAction({
		action: 'demo-guestbook-sign',
		inputs: {},
		run: async () => Promise.reject({ error: 'Input name is required' }),
		onUnowned: async () => {
			asked += 1;
			return true;
		}
	});
	assert.equal(asked, 0);
	assert.equal(outcome.error, 'Input name is required');
});

test('a failing installer reports its own error, not a second refusal', async () => {
	const outcome = await runDelegatedAction({
		action: 'demo-guestbook-sign',
		inputs: {},
		run: async () => unowned(),
		onUnowned: async () => Promise.reject({ error: 'Account content requires storage migration' })
	});
	assert.equal(outcome.error, 'Account content requires storage migration');
});

test('without an installer the refusal is just an error', async () => {
	const outcome = await runDelegatedAction({ action: 'x', inputs: {}, run: async () => unowned() });
	assert.match(outcome.error || '', /No action you own matches/);
});
