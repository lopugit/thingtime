import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserPresence, IDLE_AFTER_MS } from './userPresence';

const fixture = () => {
	let now = 0, next = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const window = new EventTarget();
	const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
	const presence = createUserPresence({
		window, document, now: () => now,
		setTimer: (fn, ms) => { const id = ++next; timers.set(id, { at: now + ms, fn }); return id as unknown as ReturnType<typeof setTimeout>; },
		clearTimer: (id) => { timers.delete(id as unknown as number); }
	} as never);
	const advance = (ms: number) => {
		now += ms;
		for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (timer.at <= now) { timers.delete(id); timer.fn(); }
	};
	return { presence, window, document, advance, timers };
};

test('goes idle after two quiet minutes and returns on the next interaction', () => {
	const f = fixture();
	const changes: boolean[] = [];
	f.presence.subscribe((idle) => changes.push(idle));
	f.advance(IDLE_AFTER_MS - 1);
	assert.equal(f.presence.isIdle(), false);
	f.advance(1);
	assert.equal(f.presence.isIdle(), true);
	assert.equal(f.timers.size, 0, 'an idle window keeps no timer running');
	f.window.dispatchEvent(new Event('pointerdown'));
	assert.equal(f.presence.isIdle(), false);
	assert.deepEqual(changes, [true, false]);
});

test('each interaction restarts the quiet period, using one timer', () => {
	const f = fixture();
	for (let i = 0; i < 5; i++) {
		f.advance(IDLE_AFTER_MS - 1000);
		f.window.dispatchEvent(new Event(i % 2 ? 'keydown' : 'scroll'));
		assert.equal(f.presence.isIdle(), false);
		assert.ok(f.timers.size <= 1);
	}
	f.advance(IDLE_AFTER_MS);
	assert.equal(f.presence.isIdle(), true);
});

test('becoming visible counts as returning; dispose removes everything', () => {
	const f = fixture();
	f.advance(IDLE_AFTER_MS);
	assert.equal(f.presence.isIdle(), true);
	f.document.dispatchEvent(new Event('visibilitychange'));
	assert.equal(f.presence.isIdle(), false);
	f.presence.dispose();
	assert.equal(f.timers.size, 0);
	f.advance(IDLE_AFTER_MS * 2);
	assert.equal(f.presence.isIdle(), false, 'a disposed tracker no longer changes state');
});
