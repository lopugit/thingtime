import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import {
	CLICK_MS,
	DEFAULT_HOLD_MS,
	LOOP_PAUSE_MS,
	MOVE_MS,
	TYPE_MS_PER_CHAR,
	activeTargetFor,
	advance,
	currentStep,
	initialState,
	partialText,
	phaseDuration,
	progressFor,
	seekTo,
	seekToHold,
	stepDuration,
	typedTextFor,
	walkthroughDuration
} from './walkthroughEngine.ts';
import type { PlayerState } from './walkthroughEngine.ts';
import type { Walkthrough } from '../../marketing/types.ts';

const TOUR: Walkthrough = {
	key: 'test',
	title: 'Test tour',
	screen: 'feed',
	feature: 'feed',
	intro: 'Three moves.',
	steps: [
		{ target: 'composer', action: 'click', label: 'Open the composer' },
		{ target: 'composer', action: 'type', label: 'Say something', text: 'hello' },
		{ target: 'composer-post', action: 'hover', label: 'Post', hold: 300 }
	]
};

// step 0: 650 + 260 + 700 = 1610 · step 1: 650 + 225 + 700 = 1575 · step 2: 650 + 260 + 300 = 1210
const STEP_MS = [MOVE_MS + CLICK_MS + DEFAULT_HOLD_MS, MOVE_MS + 5 * TYPE_MS_PER_CHAR + DEFAULT_HOLD_MS, MOVE_MS + CLICK_MS + 300];
const TOUR_MS = STEP_MS[0] + STEP_MS[1] + STEP_MS[2];
const LOOP_MS = TOUR_MS + LOOP_PAUSE_MS;

const tickThrough = (walkthrough: Walkthrough, totalMs: number, tickMs: number, reducedMotion = false): PlayerState => {
	let state = initialState();
	let elapsed = 0;
	while (elapsed < totalMs) {
		const delta = Math.min(tickMs, totalMs - elapsed);
		state = advance(state, walkthrough, delta, reducedMotion);
		elapsed += delta;
	}
	return state;
};

test('durations follow the spec constants', () => {
	const [click, type, hover] = TOUR.steps;
	assert.equal(phaseDuration(click, 'move', false), MOVE_MS);
	assert.equal(phaseDuration(click, 'move', true), 0);
	assert.equal(phaseDuration(click, 'act', false), CLICK_MS);
	assert.equal(phaseDuration(hover, 'act', false), CLICK_MS);
	assert.equal(phaseDuration({ target: 'x', action: 'scroll', label: 's' }, 'act', false), CLICK_MS);
	assert.equal(phaseDuration({ target: 'x', action: 'move', label: 'm' }, 'act', false), 0);
	assert.equal(phaseDuration(type, 'act', false), 5 * TYPE_MS_PER_CHAR);
	assert.equal(phaseDuration(click, 'hold', false), DEFAULT_HOLD_MS);
	assert.equal(phaseDuration(hover, 'hold', false), 300);
	assert.equal(phaseDuration(click, 'done', false), LOOP_PAUSE_MS);
	assert.deepEqual(TOUR.steps.map((step) => stepDuration(step, false)), STEP_MS);
	assert.equal(walkthroughDuration(TOUR, false), LOOP_MS);
	assert.equal(walkthroughDuration(TOUR, true), LOOP_MS - 3 * MOVE_MS);
	assert.equal(walkthroughDuration({ ...TOUR, steps: [] }, false), 0);
});

test('initialState rests at the start of step 0', () => {
	assert.deepEqual(initialState(), { stepIndex: 0, phase: 'move', typedChars: 0, elapsedInPhase: 0, loops: 0 });
	assert.equal(activeTargetFor(initialState(), TOUR), null);
	assert.deepEqual(typedTextFor(initialState(), TOUR), {});
	assert.equal(progressFor(initialState(), TOUR), 0);
	assert.equal(currentStep(initialState(), TOUR)?.target, 'composer');
});

test('advance walks move → act → hold → next step deterministically', () => {
	let state = advance(initialState(), TOUR, 100, false);
	assert.deepEqual(state, { stepIndex: 0, phase: 'move', typedChars: 0, elapsedInPhase: 100, loops: 0 });
	assert.equal(activeTargetFor(state, TOUR), null);

	state = advance(state, TOUR, MOVE_MS - 100, false);
	assert.deepEqual(state, { stepIndex: 0, phase: 'act', typedChars: 0, elapsedInPhase: 0, loops: 0 });
	assert.equal(activeTargetFor(state, TOUR), 'composer');

	state = advance(state, TOUR, CLICK_MS, false);
	assert.deepEqual(state, { stepIndex: 0, phase: 'hold', typedChars: 0, elapsedInPhase: 0, loops: 0 });
	assert.equal(activeTargetFor(state, TOUR), 'composer');

	state = advance(state, TOUR, DEFAULT_HOLD_MS, false);
	assert.deepEqual(state, { stepIndex: 1, phase: 'move', typedChars: 0, elapsedInPhase: 0, loops: 0 });
	assert.equal(activeTargetFor(state, TOUR), null);

	// crossing several boundaries in one delta lands mid-hold of step 1
	state = advance(state, TOUR, MOVE_MS + 5 * TYPE_MS_PER_CHAR + 50, false);
	assert.deepEqual(state, { stepIndex: 1, phase: 'hold', typedChars: 5, elapsedInPhase: 50, loops: 0 });
});

test('advance is pure and ignores non-positive or invalid deltas', () => {
	const start = initialState();
	const frozen = Object.freeze({ ...start });
	assert.equal(advance(frozen, TOUR, 0, false), frozen);
	assert.equal(advance(frozen, TOUR, -50, false), frozen);
	assert.equal(advance(frozen, TOUR, Number.NaN, false), frozen);
	const next = advance(frozen, TOUR, 10, false);
	assert.notEqual(next, frozen);
	assert.deepEqual(frozen, start, 'input state must not be mutated');
});

test('typed text grows one character per TYPE_MS_PER_CHAR during the act phase', () => {
	let state = seekTo(1, TOUR);
	assert.deepEqual(typedTextFor(state, TOUR), {}, 'nothing typed while the cursor travels');
	state = advance(state, TOUR, MOVE_MS, false);
	assert.equal(state.phase, 'act');
	assert.deepEqual(typedTextFor(state, TOUR), { composer: '' });
	state = advance(state, TOUR, TYPE_MS_PER_CHAR * 2, false);
	assert.equal(state.typedChars, 2);
	assert.deepEqual(typedTextFor(state, TOUR), { composer: 'he' });
	state = advance(state, TOUR, TYPE_MS_PER_CHAR * 2 + 20, false);
	assert.equal(state.typedChars, 4);
	assert.deepEqual(typedTextFor(state, TOUR), { composer: 'hell' });
	state = advance(state, TOUR, TYPE_MS_PER_CHAR - 20, false);
	assert.equal(state.phase, 'hold');
	assert.equal(state.typedChars, 5);
	assert.deepEqual(typedTextFor(state, TOUR), { composer: 'hello' });
	// earlier type steps keep their full text once the tour moves on
	state = advance(state, TOUR, DEFAULT_HOLD_MS + 10, false);
	assert.equal(state.stepIndex, 2);
	assert.deepEqual(typedTextFor(state, TOUR), { composer: 'hello' });
});

test('typed text never splits an emoji surrogate pair', () => {
	assert.equal(partialText('🌈x', 0), '');
	assert.equal(partialText('🌈x', 1), '🌈');
	assert.equal(partialText('🌈x', 2), '🌈');
	assert.equal(partialText('🌈x', 3), '🌈x');
	assert.equal(partialText('abc', 99), 'abc');
	assert.equal(partialText('abc', -1), '');
	const tour: Walkthrough = { ...TOUR, steps: [{ target: 'composer', action: 'type', label: 't', text: 'a🌈b' }] };
	const state = advance(seekTo(0, tour), tour, MOVE_MS + TYPE_MS_PER_CHAR * 2, false);
	assert.equal(state.typedChars, 2);
	assert.deepEqual(typedTextFor(state, tour), { composer: 'a🌈' });
});

test('after the last hold the tour rests in done, then wraps to step 0 with loops + 1', () => {
	let state = advance(initialState(), TOUR, TOUR_MS, false);
	assert.deepEqual(state, { stepIndex: 2, phase: 'done', typedChars: 0, elapsedInPhase: 0, loops: 0 });
	assert.equal(activeTargetFor(state, TOUR), null);
	assert.equal(progressFor(state, TOUR), 1);
	assert.deepEqual(typedTextFor(state, TOUR), { composer: 'hello' }, 'the finished screen persists through the pause');

	state = advance(state, TOUR, LOOP_PAUSE_MS - 1, false);
	assert.equal(state.phase, 'done');
	state = advance(state, TOUR, 1, false);
	assert.deepEqual(state, { stepIndex: 0, phase: 'move', typedChars: 0, elapsedInPhase: 0, loops: 1 });
	assert.deepEqual(typedTextFor(state, TOUR), {}, 'the screen resets on wrap');
	assert.equal(progressFor(state, TOUR), 0);

	state = advance(state, TOUR, LOOP_MS * 2, false);
	assert.equal(state.loops, 3);
	assert.equal(state.stepIndex, 0);
	assert.equal(state.phase, 'move');
});

test('a done-phase type step keeps its full text typed', () => {
	const tour: Walkthrough = { ...TOUR, steps: [{ target: 'composer', action: 'type', label: 't', text: 'hi' }] };
	const state = advance(initialState(), tour, stepDuration(tour.steps[0], false), false);
	assert.equal(state.phase, 'done');
	assert.equal(state.typedChars, 2);
	assert.deepEqual(typedTextFor(state, tour), { composer: 'hi' });
});

test('seekTo lands at the start of a step and clamps out-of-range indexes', () => {
	assert.deepEqual(seekTo(1, TOUR), { stepIndex: 1, phase: 'move', typedChars: 0, elapsedInPhase: 0, loops: 0 });
	assert.equal(seekTo(99, TOUR).stepIndex, 2);
	assert.equal(seekTo(-4, TOUR).stepIndex, 0);
	assert.equal(seekTo(1.9, TOUR).stepIndex, 1);
	assert.equal(seekTo(Number.NaN, TOUR).stepIndex, 0);
	assert.equal(seekTo(2, TOUR, 4).loops, 4);
	assert.equal(seekTo(3, { ...TOUR, steps: [] }).stepIndex, 0);
	assert.equal(activeTargetFor(seekTo(2, TOUR), TOUR), null);
});

test('seekToHold shows a step already acted', () => {
	const state = seekToHold(1, TOUR, 2);
	assert.deepEqual(state, { stepIndex: 1, phase: 'hold', typedChars: 5, elapsedInPhase: 0, loops: 2 });
	assert.equal(activeTargetFor(state, TOUR), 'composer');
	assert.deepEqual(typedTextFor(state, TOUR), { composer: 'hello' });
	assert.equal(seekToHold(0, TOUR).typedChars, 0);
	// advancing from a hold continues to the next step normally
	assert.equal(advance(state, TOUR, DEFAULT_HOLD_MS, false).stepIndex, 2);
});

test('reduced motion makes every move phase instant', () => {
	let state = advance(initialState(), TOUR, 1, true);
	assert.deepEqual(state, { stepIndex: 0, phase: 'act', typedChars: 0, elapsedInPhase: 1, loops: 0 });
	state = advance(state, TOUR, CLICK_MS - 1 + DEFAULT_HOLD_MS, true);
	assert.deepEqual(state, { stepIndex: 1, phase: 'act', typedChars: 0, elapsedInPhase: 0, loops: 0 });
	// a full reduced loop wraps and, the move being 0ms, lands straight in step 0's act
	const full = advance(initialState(), TOUR, walkthroughDuration(TOUR, true), true);
	assert.deepEqual(full, { stepIndex: 0, phase: 'act', typedChars: 0, elapsedInPhase: 0, loops: 1 });
	assert.equal(advance(initialState(), TOUR, walkthroughDuration(TOUR, true) - 1, true).phase, 'done');
	// a state that was mid-move when motion got reduced moves straight on
	const stranded: PlayerState = { stepIndex: 0, phase: 'move', typedChars: 0, elapsedInPhase: 300, loops: 0 };
	assert.equal(advance(stranded, TOUR, 1, true).phase, 'act');
});

test('a huge delta lands exactly where many 16ms ticks would', () => {
	const total = 100000;
	const jump = advance(initialState(), TOUR, total, false);
	const ticked = tickThrough(TOUR, total, 16);
	assert.equal(jump.loops, ticked.loops);
	assert.equal(jump.stepIndex, ticked.stepIndex);
	assert.equal(jump.phase, ticked.phase);
	assert.equal(jump.typedChars, ticked.typedChars);
	assert.ok(Math.abs(jump.elapsedInPhase - ticked.elapsedInPhase) < 1e-6);
	// and the arithmetic checks out by hand: 16 full loops, then 4080ms into the 17th
	assert.equal(jump.loops, Math.floor(total / LOOP_MS));
	const rest = total - jump.loops * LOOP_MS;
	assert.equal(rest, 4080);
	assert.equal(jump.stepIndex, 2);
	assert.equal(jump.phase, 'act');
	assert.equal(jump.elapsedInPhase, rest - STEP_MS[0] - STEP_MS[1] - MOVE_MS);
	// same story with reduced motion and odd tick sizes
	const jumpReduced = advance(initialState(), TOUR, 77777, true);
	const tickedReduced = tickThrough(TOUR, 77777, 7, true);
	assert.deepEqual(jumpReduced, tickedReduced);
});

test('zero-length phases terminate and still visit every step', () => {
	const tour: Walkthrough = {
		...TOUR,
		steps: [
			{ target: 'a', action: 'move', label: 'a', hold: 0 },
			{ target: 'b', action: 'move', label: 'b', hold: 0 },
			{ target: 'c', action: 'type', label: 'c', text: '', hold: 0 }
		]
	};
	assert.equal(walkthroughDuration(tour, true), LOOP_PAUSE_MS);
	const state = advance(initialState(), tour, 1, true);
	assert.deepEqual(state, { stepIndex: 2, phase: 'done', typedChars: 0, elapsedInPhase: 1, loops: 0 });
	assert.equal(advance(state, tour, LOOP_PAUSE_MS - 1, true).loops, 1);
	assert.equal(progressFor(state, tour, true), 1);
	assert.equal(progressFor(seekTo(1, tour), tour, true), 1 / 3, 'falls back to step fractions when nothing takes time');
});

test('progress is monotonic within a loop, hits 1 in done and resets on wrap', () => {
	let state = initialState();
	let previous = progressFor(state, TOUR);
	let sawDone = false;
	for (let elapsed = 0; elapsed < LOOP_MS; elapsed += 16) {
		state = advance(state, TOUR, 16, false);
		const progress = progressFor(state, TOUR);
		assert.ok(progress >= 0 && progress <= 1, `progress ${progress} out of range`);
		if (state.loops === 0) {
			assert.ok(progress >= previous - 1e-9, `progress went backwards: ${previous} → ${progress} at ${JSON.stringify(state)}`);
			previous = progress;
			if (state.phase === 'done') {
				sawDone = true;
				assert.equal(progress, 1);
			}
		} else {
			assert.ok(progress < 0.05, 'progress restarts after the wrap');
			break;
		}
	}
	assert.ok(sawDone);
	assert.ok(Math.abs(progressFor(seekTo(1, TOUR), TOUR) - STEP_MS[0] / TOUR_MS) < 1e-9);
	assert.ok(Math.abs(progressFor(seekToHold(2, TOUR), TOUR) - (STEP_MS[0] + STEP_MS[1] + MOVE_MS + CLICK_MS) / TOUR_MS) < 1e-9);
	// reduced motion re-weights the timeline but stays in range
	assert.equal(progressFor(seekTo(0, TOUR), TOUR, true), 0);
	assert.equal(progressFor({ ...seekTo(2, TOUR), phase: 'hold', elapsedInPhase: 300 }, TOUR, true), 1);
});

test('an empty walkthrough is inert', () => {
	const empty: Walkthrough = { ...TOUR, steps: [] };
	const state = initialState();
	assert.equal(advance(state, empty, 5000, false), state);
	assert.equal(activeTargetFor(state, empty), null);
	assert.deepEqual(typedTextFor(state, empty), {});
	assert.equal(progressFor(state, empty), 0);
	assert.equal(currentStep(state, empty), null);
});

test('states from a longer walkthrough are clamped to the current one', () => {
	const stale: PlayerState = { stepIndex: 7, phase: 'hold', typedChars: 0, elapsedInPhase: 0, loops: 1 };
	assert.equal(activeTargetFor(stale, TOUR), 'composer-post');
	assert.deepEqual(typedTextFor(stale, TOUR), { composer: 'hello' });
	assert.equal(advance(stale, TOUR, 300, false).phase, 'done');
	assert.ok(progressFor(stale, TOUR) <= 1);
});
