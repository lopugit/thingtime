import assert from 'node:assert/strict';
import test from 'node:test';
import { DictationSilence, normalizeDictationSilenceSeconds } from './dictationSilence';

const setup = (hearMeOut = false, silenceSeconds = 5) => {
	let now = 0, id = 0, sends = 0, open = false, current = true;
	const timers = new Map<number, { at: number; callback: () => void }>();
	const allCallbacks: (() => void)[] = [];
	const controller = new DictationSilence({ hearMeOut, silenceSeconds }, {
		isCurrent: () => current,
		prompt: value => { open = value; },
		send: () => { sends++; }
	}, {
		set: (callback, delay) => { allCallbacks.push(callback); timers.set(++id, { at: now + delay, callback }); return id; },
		clear: key => { timers.delete(key as number); }
	});
	return {
		controller, allCallbacks,
		state: () => ({ sends, open, timers: timers.size }),
		switchOwner: () => { current = false; },
		advance(ms: number) {
			const end = now + ms;
			for (;;) {
				const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
				if (!next || next[1].at > end) break;
				now = next[1].at; timers.delete(next[0]); next[1].callback();
			}
			now = end;
		}
	};
};

test('defaults, invalid persisted values and bounded custom delays', () => {
	for (const invalid of [undefined, null, '8', NaN, Infinity, {}]) assert.equal(normalizeDictationSilenceSeconds(invalid), 5);
	assert.equal(normalizeDictationSilenceSeconds(0), 1);
	assert.equal(normalizeDictationSilenceSeconds(999999999), 120);
	assert.equal(normalizeDictationSilenceSeconds(7.56), 7.6);
});
test('empty recordings never send; first words wait five full seconds and send once', () => {
	const t = setup(); t.controller.start(); t.advance(120000);
	assert.equal(t.state().sends, 0);
	t.controller.transcript(); t.advance(4999); assert.equal(t.state().sends, 0);
	t.advance(1); assert.equal(t.state().sends, 1);
	t.advance(30000); assert.equal(t.state().sends, 1);
});
test('new words reset the deadline, final/end without new words does not', () => {
	const t = setup(); t.controller.start(); t.controller.transcript(); t.advance(4000);
	t.controller.transcript(); t.advance(4000); t.controller.recognitionEnd();
	t.advance(999); assert.equal(t.state().sends, 0);
	t.advance(1); assert.equal(t.state().sends, 1);
});
test('active speech holds sending even without new recognition results', () => {
	const t = setup(); t.controller.start(); t.controller.transcript(); t.advance(4000);
	t.controller.speechStart(); t.advance(20000); assert.equal(t.state().sends, 0);
	t.controller.transcript(); t.advance(10000); assert.equal(t.state().sends, 0);
	t.controller.speechEnd(); t.advance(5000); assert.equal(t.state().sends, 1);
});
test('recognizer ending releases speech hold without losing words', () => {
	const t = setup(); t.controller.start(); t.controller.speechStart(); t.controller.transcript();
	t.controller.recognitionEnd(); t.advance(5000); assert.equal(t.state().sends, 1);
});
test('Hear me out repeats one prompt every ten seconds and never auto-sends', () => {
	const t = setup(true); t.controller.start(); t.controller.transcript();
	t.advance(9999); assert.equal(t.state().open, false);
	t.advance(1); assert.deepEqual(t.state(), { sends: 0, open: true, timers: 1 });
	t.advance(60000); assert.deepEqual(t.state(), { sends: 0, open: true, timers: 1 });
	t.controller.keepListening(); t.advance(9999); assert.equal(t.state().open, false);
	t.advance(1); assert.equal(t.state().open, true);
	t.controller.speechStart(); assert.equal(t.state().open, false);
	t.controller.transcript(); t.controller.speechEnd(); t.advance(10000);
	t.controller.send(); t.controller.send(); t.advance(60000);
	assert.deepEqual(t.state(), { sends: 1, open: false, timers: 0 });
});
test('Stop, error, edit, mode change and unmount cancel stale queued timer callbacks', () => {
	const t = setup(); t.controller.start(); t.controller.transcript();
	const late = t.allCallbacks.at(-1)!;
	t.controller.stop(); late(); t.advance(10000);
	assert.deepEqual(t.state(), { sends: 0, open: false, timers: 0 });
	t.controller.start(); t.controller.transcript(); late(); t.advance(4999);
	assert.equal(t.state().sends, 0); t.advance(1); assert.equal(t.state().sends, 1);
});
test('owner or chat changes fence automatic sends and explicit prompt sends', () => {
	for (const hear of [false, true]) {
		const t = setup(hear); t.controller.start(); t.controller.transcript();
		if (hear) t.advance(10000);
		t.switchOwner(); t.controller.send(); t.advance(20000);
		assert.deepEqual(t.state(), { sends: 0, open: false, timers: 0 });
	}
});
test('changing policy replaces the old timer and grants the full new silence delay', () => {
	const t = setup(); t.controller.start(); t.controller.transcript(); t.advance(4000);
	t.controller.update({ silenceSeconds: 8, hearMeOut: false }); t.advance(7999);
	assert.equal(t.state().sends, 0); t.advance(1); assert.equal(t.state().sends, 1);
	const h = setup(); h.controller.start(); h.controller.transcript(); h.advance(4900);
	h.controller.update({ silenceSeconds: 5, hearMeOut: true }); h.advance(10000);
	assert.deepEqual(h.state(), { sends: 0, open: true, timers: 1 });
});
