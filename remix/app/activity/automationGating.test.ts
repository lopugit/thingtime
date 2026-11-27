import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivityManager } from './activityManager';
import { createBackgroundRefresh, type RefreshEnvironment } from '../hooks/backgroundRefresh';

test('an administrator switch stops network polling but never local timers or lifecycle guards', () => {
	let off = true;
	const manager = createActivityManager({ storage: () => undefined, hidden: () => false, idle: () => false, blocked: () => off, notify: (fn) => fn() });
	let network = 0, local = 0, guard = 0;
	manager.register({ id: 'timer:timeline/TimelineProvider:1', title: 'Timeline', kind: 'polling' }, () => { network++; });
	manager.register({ id: 'timer:components/Builder/useFormatClock:1', title: 'Clock', kind: 'polling', local: true }, () => { local++; });
	manager.register({ id: 'activity.visibility', title: 'Lifecycle', kind: 'listener', essential: true }, () => { guard++; });
	assert.deepEqual([network, local, guard], [0, 1, 1]);
	assert.equal(manager.read().find((row) => row.id === 'timer:timeline/TimelineProvider:1')?.state, 'Turned off by an administrator');
	off = false;
	manager.visibilityChanged();
	assert.equal(network, 1, 'turning the switch on starts the work');
	off = true;
	let stopped = 0;
	manager.register({ id: 'timer:components/Nav/NotificationsBell:1', title: 'Bell', kind: 'polling' }, () => () => { stopped++; });
	assert.equal(stopped, 0);
});

test('a switched-off refresh key loads once on mount and never repeats or refreshes on return', async () => {
	let blocked = true;
	const switchListeners = new Set<() => void>();
	const window = new EventTarget();
	const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
	let now = 0, next = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const refresh = createBackgroundRefresh({ window, document, online: () => true, now: () => now,
		setTimer: (fn, ms) => { const id = ++next; timers.set(id, { at: now + ms, fn }); return id; },
		clearTimer: (id) => timers.delete(id as unknown as number),
		blocked: () => blocked,
		onSwitches: (listener: () => void) => { switchListeners.add(listener); return () => { switchListeners.delete(listener); }; }
	} as unknown as RefreshEnvironment);
	const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
	let calls = 0;
	refresh.subscribe('lopu-tasks:user-1', () => { calls++; }, 3000);
	await flush();
	assert.equal(calls, 1, 'the view still loads once');
	assert.equal(timers.size, 0, 'nothing is scheduled');
	now += 5000;
	window.dispatchEvent(new Event('focus'));
	await flush();
	assert.equal(calls, 1, 'no refresh on return while off');
	blocked = false;
	for (const listener of switchListeners) listener();
	await flush();
	assert.equal(calls, 2, 'turning the switch on refreshes now');
	assert.equal(timers.size, 1, 'and resumes the interval');
});
