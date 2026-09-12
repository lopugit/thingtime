import type { Walkthrough, WalkthroughStep } from '~/marketing/types';

// The walkthrough player's clock, as a pure state machine. A Walkthrough
// (marketing/walkthroughs.ts) is a list of steps; each step plays as three
// phases — move (the cursor travels to the target), act (click / hover /
// scroll / type), hold (the caption lingers) — and after the last step's
// hold the tour rests in 'done' for LOOP_PAUSE_MS before wrapping to step 0.
//
// Nothing here touches React or the DOM: the player feeds real frame deltas
// into advance() and reads the derived view (active target, typed text,
// progress) back out, so the whole timeline is unit-testable and any delta
// — one 16ms frame or a 100s catch-up — lands in exactly the same state.

export type PlayerPhase = 'move' | 'act' | 'hold' | 'done';

export type PlayerState = {
	stepIndex: number;
	phase: PlayerPhase;
	/** UTF-16 units of the current 'type' step's text revealed so far. */
	typedChars: number;
	elapsedInPhase: number;
	/** How many times the tour has wrapped back to step 0. */
	loops: number;
};

export const MOVE_MS = 650;
export const CLICK_MS = 260;
export const TYPE_MS_PER_CHAR = 45;
export const DEFAULT_HOLD_MS = 700;
export const LOOP_PAUSE_MS = 1600;

/** Phase order within a step; 'done' only follows the last step's hold. */
export const PHASE_ORDER: readonly PlayerPhase[] = ['move', 'act', 'hold', 'done'];

const textOf = (step: WalkthroughStep | undefined | null): string => (step && step.action === 'type' && typeof step.text === 'string' ? step.text : '');

const clampIndex = (index: number, count: number): number => {
	if (count <= 0) return 0;
	if (!Number.isFinite(index)) return 0;
	return Math.min(count - 1, Math.max(0, Math.floor(index)));
};

const clamp01 = (value: number): number => (value <= 0 || !Number.isFinite(value) ? 0 : value >= 1 ? 1 : value);

/** How long a phase of a step lasts, in ms. 'done' is the loop pause. */
export const phaseDuration = (step: WalkthroughStep, phase: PlayerPhase, reducedMotion: boolean): number => {
	switch (phase) {
		case 'move':
			return reducedMotion ? 0 : MOVE_MS;
		case 'act':
			if (!step) return 0;
			if (step.action === 'type') return textOf(step).length * TYPE_MS_PER_CHAR;
			if (step.action === 'move') return 0;
			return CLICK_MS;
		case 'hold':
			return Math.max(0, step && typeof step.hold === 'number' && Number.isFinite(step.hold) ? step.hold : DEFAULT_HOLD_MS);
		case 'done':
			return LOOP_PAUSE_MS;
		default:
			return 0;
	}
};

/** move + act + hold for one step. */
export const stepDuration = (step: WalkthroughStep, reducedMotion: boolean): number =>
	phaseDuration(step, 'move', reducedMotion) + phaseDuration(step, 'act', reducedMotion) + phaseDuration(step, 'hold', reducedMotion);

/** One full loop: every step plus the pause in 'done'. */
export const walkthroughDuration = (walkthrough: Walkthrough, reducedMotion: boolean): number =>
	walkthrough.steps.length === 0 ? 0 : walkthrough.steps.reduce((total, step) => total + stepDuration(step, reducedMotion), 0) + LOOP_PAUSE_MS;

export const initialState = (): PlayerState => ({ stepIndex: 0, phase: 'move', typedChars: 0, elapsedInPhase: 0, loops: 0 });

const typedCharsFor = (step: WalkthroughStep | undefined, phase: PlayerPhase, elapsedInPhase: number): number => {
	const text = textOf(step);
	if (!text) return 0;
	if (phase === 'act') return Math.min(text.length, Math.max(0, Math.floor(elapsedInPhase / TYPE_MS_PER_CHAR)));
	if (phase === 'hold' || phase === 'done') return text.length;
	return 0;
};

/**
 * Advance the clock by deltaMs. Walks phase boundaries one at a time so a
 * huge delta visits every phase and step a run of small deltas would — it
 * never skips a step — and returns the same object when nothing changes.
 */
export const advance = (state: PlayerState, walkthrough: Walkthrough, deltaMs: number, reducedMotion: boolean): PlayerState => {
	const steps = walkthrough.steps;
	if (steps.length === 0 || !(deltaMs > 0)) return state;
	let stepIndex = clampIndex(state.stepIndex, steps.length);
	let phase: PlayerPhase = PHASE_ORDER.includes(state.phase) ? state.phase : 'move';
	let elapsed = Number.isFinite(state.elapsedInPhase) ? Math.max(0, state.elapsedInPhase) : 0;
	let loops = Number.isFinite(state.loops) ? state.loops : 0;
	let remaining = deltaMs;
	// Every loop passes through 'done' (LOOP_PAUSE_MS > 0), so this always
	// terminates even when every step phase is zero-length.
	for (;;) {
		const room = phaseDuration(steps[stepIndex], phase, reducedMotion) - elapsed;
		if (remaining < room) {
			elapsed += remaining;
			break;
		}
		remaining -= Math.max(room, 0);
		elapsed = 0;
		if (phase === 'move') phase = 'act';
		else if (phase === 'act') phase = 'hold';
		else if (phase === 'hold') {
			if (stepIndex + 1 < steps.length) {
				stepIndex += 1;
				phase = 'move';
			} else phase = 'done';
		} else {
			stepIndex = 0;
			phase = 'move';
			loops += 1;
		}
	}
	return { stepIndex, phase, typedChars: typedCharsFor(steps[stepIndex], phase, elapsed), elapsedInPhase: elapsed, loops };
};

/** A state at the start of stepIndex's 'move' phase (index is clamped). */
export const seekTo = (stepIndex: number, walkthrough: Walkthrough, loops = 0): PlayerState => ({
	stepIndex: clampIndex(stepIndex, walkthrough.steps.length),
	phase: 'move',
	typedChars: 0,
	elapsedInPhase: 0,
	loops
});

/**
 * A state at the start of stepIndex's 'hold' phase: the step already acted
 * (text fully typed, target active). What a paused player shows when the
 * viewer steps through with Previous / Next.
 */
export const seekToHold = (stepIndex: number, walkthrough: Walkthrough, loops = 0): PlayerState => {
	const index = clampIndex(stepIndex, walkthrough.steps.length);
	return { stepIndex: index, phase: 'hold', typedChars: textOf(walkthrough.steps[index]).length, elapsedInPhase: 0, loops };
};

/** The first `chars` UTF-16 units of text, never splitting a surrogate pair (emoji). */
export const partialText = (text: string, chars: number): string => {
	const clamped = Math.max(0, Math.min(text.length, Number.isFinite(chars) ? Math.floor(chars) : 0));
	let end = clamped;
	if (end > 0 && end < text.length) {
		const code = text.charCodeAt(end - 1);
		if (code >= 0xd800 && code <= 0xdbff) end += 1;
	}
	return text.slice(0, end);
};

export const currentStep = (state: PlayerState, walkthrough: Walkthrough): WalkthroughStep | null =>
	walkthrough.steps.length === 0 ? null : (walkthrough.steps[clampIndex(state.stepIndex, walkthrough.steps.length)] ?? null);

/**
 * Text shown in each typed target: every 'type' step before the current one
 * contributes its full text; the current step contributes what has been
 * typed so far once its act phase starts (nothing during 'move').
 */
export const typedTextFor = (state: PlayerState, walkthrough: Walkthrough): Record<string, string> => {
	const typed: Record<string, string> = {};
	const steps = walkthrough.steps;
	if (steps.length === 0) return typed;
	const index = clampIndex(state.stepIndex, steps.length);
	for (let i = 0; i < index; i += 1) {
		const step = steps[i];
		const text = textOf(step);
		if (text) typed[step.target] = text;
	}
	const step = steps[index];
	const text = textOf(step);
	if (text && state.phase !== 'move') typed[step.target] = partialText(text, state.typedChars);
	return typed;
};

/** The target under the cursor while it acts or holds; null while travelling or resting. */
export const activeTargetFor = (state: PlayerState, walkthrough: Walkthrough): string | null => {
	if (state.phase !== 'act' && state.phase !== 'hold') return null;
	const step = currentStep(state, walkthrough);
	return step ? step.target : null;
};

/** 0..1 through the current loop; 1 while resting in 'done', 0 again after the wrap. */
export const progressFor = (state: PlayerState, walkthrough: Walkthrough, reducedMotion = false): number => {
	const steps = walkthrough.steps;
	if (steps.length === 0) return 0;
	if (state.phase === 'done') return 1;
	const index = clampIndex(state.stepIndex, steps.length);
	let total = 0;
	let before = 0;
	for (let i = 0; i < steps.length; i += 1) {
		const duration = stepDuration(steps[i], reducedMotion);
		if (i < index) before += duration;
		total += duration;
	}
	if (total <= 0) return clamp01(index / steps.length);
	const step = steps[index];
	const elapsed = Number.isFinite(state.elapsedInPhase) ? Math.max(0, state.elapsedInPhase) : 0;
	const within =
		state.phase === 'move'
			? elapsed
			: state.phase === 'act'
				? phaseDuration(step, 'move', reducedMotion) + elapsed
				: phaseDuration(step, 'move', reducedMotion) + phaseDuration(step, 'act', reducedMotion) + elapsed;
	return clamp01((before + Math.min(within, stepDuration(step, reducedMotion))) / total);
};
