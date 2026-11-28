// The model picker's "Check Models" run (LopuModelPicker.tsx): every
// selectable option is sent the tiny message "Live? Y/N" through
// POST /api/v1/ai/models/check, two at a time, and each row paints a green
// tick or a red cross as its answer lands. Module-level on purpose: the
// picker's popover unmounts on close, and a run keeps going (and its results
// stay visible) when it is reopened. No React, no fetch — the caller hands in
// the check function; unit-tested in node (lopuModelCheck.test.ts).
//
// Fencing: results belong to one viewer scope (account + origin). A new scope
// clears them before it renders, a new run supersedes the old one (its late
// answers are dropped), and nothing here ever writes the previous run's or
// previous account's answers into the current state.

import { isDeviceAiProvider } from '~/utils/deviceAiProvider';
import type { LopuProviderGroup } from './lopuProviderCore';

export type LopuModelCheckTarget = { model: string } | { providerId: string };

export type LopuModelCheckItem = {
	key: string;
	label: string;
	// null = shown but not checkable here (skipReason says why)
	target: LopuModelCheckTarget | null;
	skipReason?: string;
};

// what one check call answers: the model replied, it did not, or the account
// is busy (three billed turns already running) and the call should be retried
export type LopuModelCheckAnswer =
	| { live: true; reply?: string | null; latencyMs?: number | null }
	| { live: false; error: string; latencyMs?: number | null }
	| { busy: true; retryAfterMs?: number | null; error?: string };

export type LopuModelCheckFn = (target: LopuModelCheckTarget, signal: AbortSignal) => Promise<LopuModelCheckAnswer>;

export type LopuModelCheckStatus = 'queued' | 'checking' | 'live' | 'error' | 'skipped';

export type LopuModelCheckEntry = {
	status: LopuModelCheckStatus;
	// the error / skip reason, or the model's reply on success
	message: string | null;
	latencyMs: number | null;
};

export type LopuModelCheckState = {
	scope: string | null;
	runId: number;
	running: boolean;
	// checkable rows in the current run, and how many have answered
	total: number;
	done: number;
	results: Readonly<Record<string, LopuModelCheckEntry>>;
};

// Two lanes: with one chat streaming the account still fits within Lopu's
// three in-flight turns (LOPU_MAX_CONCURRENT_TURNS) without busy retries.
export const LOPU_MODEL_CHECK_CONCURRENCY = 2;
// a busy account (LOPU_TURN_IN_FLIGHT) is transient — wait it out, boundedly
export const LOPU_MODEL_CHECK_BUSY_RETRIES = 8;
export const LOPU_MODEL_CHECK_BUSY_WAIT_MS = 2_000;
export const LOPU_MODEL_CHECK_BUSY_MAX_WAIT_MS = 6_000;
export const LOPU_MODEL_CHECK_DEVICE_SKIP = 'Runs on your Thingtime desktop app — send it a message there to check it.';
const BUSY_GAVE_UP = 'Lopu stayed busy with other replies — try Check Models again once they finish.';
const CHECK_FAILED = 'The check could not be completed.';

const EMPTY: LopuModelCheckState = Object.freeze({ scope: null, runId: 0, running: false, total: 0, done: 0, results: Object.freeze({}) });

let state: LopuModelCheckState = EMPTY;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of listeners) listener();
};

export const subscribeLopuModelCheck = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
export const getLopuModelCheckSnapshot = (): LopuModelCheckState => state;
export const getLopuModelCheckServerSnapshot = (): LopuModelCheckState => EMPTY;

/** The results to draw for `scope` — empty when the stored run belongs to another viewer. */
export const lopuModelCheckResultsFor = (snapshot: LopuModelCheckState, scope: string | null): LopuModelCheckState =>
	scope && snapshot.scope === scope ? snapshot : EMPTY;

/** Stop the current run (if any) and forget every result. */
export const resetLopuModelCheck = (): void => {
	controller?.abort();
	controller = null;
	if (state === EMPTY) return;
	state = { ...EMPTY, runId: state.runId };
	emit();
};

/** Drop results that belong to another viewer (an account or origin switch). */
export const ensureLopuModelCheckScope = (scope: string | null): void => {
	if (state.scope !== null && state.scope !== scope) resetLopuModelCheck();
};

/**
 * The rows Check Models sends a message to: every option the viewer can pick
 * (disabled rows — no key, turned off by an admin — are not selectable and
 * are left alone). Device-local ChatGPT plan connections run in the desktop
 * app, not on the server, so they are listed as skipped with the reason.
 */
export const lopuModelCheckItems = (groups: readonly LopuProviderGroup[]): LopuModelCheckItem[] => {
	const items: LopuModelCheckItem[] = [];
	const seen = new Set<string>();
	for (const group of groups) {
		for (const option of group.options) {
			if (option.disabled || seen.has(option.key)) continue;
			seen.add(option.key);
			if (option.kind === 'model') {
				if (option.model) items.push({ key: option.key, label: option.label, target: { model: option.model } });
			} else if (option.providerId) {
				items.push(
					isDeviceAiProvider(option.providerId)
						? { key: option.key, label: option.label, target: null, skipReason: LOPU_MODEL_CHECK_DEVICE_SKIP }
						: { key: option.key, label: option.label, target: { providerId: option.providerId } }
				);
			}
		}
	}
	return items;
};

const waitFor = (ms: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener('abort', done);
			resolve();
		}
		signal.addEventListener('abort', done, { once: true });
	});

const errorMessage = (error: unknown): string => {
	const message = (error as { message?: unknown } | null)?.message;
	return typeof message === 'string' && message.trim() ? message.trim().slice(0, 300) : CHECK_FAILED;
};

export type StartLopuModelCheckInput = {
	scope: string;
	items: readonly LopuModelCheckItem[];
	check: LopuModelCheckFn;
	concurrency?: number;
	// test seams
	wait?: (ms: number, signal: AbortSignal) => Promise<void>;
	now?: () => number;
};

/**
 * Start a fresh run (superseding any current one) and resolve when it has
 * finished or been superseded. Each row moves queued → checking → live |
 * error; skipped rows are final at once.
 */
export const startLopuModelCheck = async (input: StartLopuModelCheckInput): Promise<void> => {
	controller?.abort();
	const abort = new AbortController();
	controller = abort;
	const runId = state.runId + 1;
	const wait = input.wait ?? waitFor;
	const now = input.now ?? (() => Date.now());

	const results: Record<string, LopuModelCheckEntry> = {};
	const queue: { key: string; target: LopuModelCheckTarget }[] = [];
	for (const item of input.items) {
		if (item.target) {
			results[item.key] = { status: 'queued', message: null, latencyMs: null };
			queue.push({ key: item.key, target: item.target });
		} else results[item.key] = { status: 'skipped', message: item.skipReason ?? null, latencyMs: null };
	}
	state = { scope: input.scope, runId, running: queue.length > 0, total: queue.length, done: 0, results };
	emit();

	const current = () => !abort.signal.aborted && state.runId === runId && state.scope === input.scope;
	const write = (key: string, entry: LopuModelCheckEntry, finished: boolean) => {
		if (!current()) return;
		state = { ...state, done: state.done + (finished ? 1 : 0), results: { ...state.results, [key]: entry } };
		emit();
	};

	const checkOne = async (target: LopuModelCheckTarget): Promise<LopuModelCheckEntry> => {
		const startedAt = now();
		for (let attempt = 0; ; attempt++) {
			let answer: LopuModelCheckAnswer;
			try {
				answer = await input.check(target, abort.signal);
			} catch (error) {
				return { status: 'error', message: errorMessage(error), latencyMs: Math.max(0, Math.round(now() - startedAt)) };
			}
			if ('busy' in answer) {
				if (attempt >= LOPU_MODEL_CHECK_BUSY_RETRIES || !current()) return { status: 'error', message: answer.error || BUSY_GAVE_UP, latencyMs: null };
				const requested = typeof answer.retryAfterMs === 'number' && answer.retryAfterMs > 0 ? answer.retryAfterMs : LOPU_MODEL_CHECK_BUSY_WAIT_MS;
				await wait(Math.min(requested, LOPU_MODEL_CHECK_BUSY_MAX_WAIT_MS), abort.signal);
				continue;
			}
			const latencyMs = typeof answer.latencyMs === 'number' ? answer.latencyMs : Math.max(0, Math.round(now() - startedAt));
			if (answer.live === true) return { status: 'live', message: answer.reply ?? null, latencyMs };
			return { status: 'error', message: answer.error || CHECK_FAILED, latencyMs };
		}
	};

	const worker = async () => {
		for (;;) {
			if (!current()) return;
			const next = queue.shift();
			if (!next) return;
			write(next.key, { status: 'checking', message: null, latencyMs: null }, false);
			const entry = await checkOne(next.target);
			write(next.key, entry, true);
		}
	};

	const lanes = Math.max(1, Math.min(input.concurrency ?? LOPU_MODEL_CHECK_CONCURRENCY, queue.length));
	await Promise.all(Array.from({ length: queue.length ? lanes : 0 }, worker));
	if (current()) {
		state = { ...state, running: false };
		emit();
	}
	if (controller === abort) controller = null;
};

// ——— the HTTP call → an answer ———————————————————————————————————————————————

// A 429 that asks to come back within seconds is transient: the account's
// in-flight slots are full (LOPU_TURN_IN_FLIGHT, Retry-After 5) or the rate
// window is about to reset. A longer Retry-After is a real "slow down".
export const LOPU_MODEL_CHECK_RETRYABLE_SECONDS = 10;

/** The endpoint's 200 body (live: true | false) as an answer. */
export const lopuModelCheckAnswerFromOutcome = (outcome: unknown): LopuModelCheckAnswer => {
	const body = (outcome && typeof outcome === 'object' ? outcome : {}) as { live?: unknown; reply?: unknown; error?: unknown; latencyMs?: unknown };
	const latencyMs = typeof body.latencyMs === 'number' && Number.isFinite(body.latencyMs) ? body.latencyMs : null;
	if (body.live === true) return { live: true, reply: typeof body.reply === 'string' ? body.reply : null, latencyMs };
	return { live: false, error: typeof body.error === 'string' && body.error.trim() ? body.error.trim().slice(0, 300) : CHECK_FAILED, latencyMs };
};

/** A thrown API error (ThingtimeApiError: status / retryAfterSeconds / message) as an answer. */
export const lopuModelCheckAnswerFromError = (error: unknown): LopuModelCheckAnswer => {
	const failure = (error && typeof error === 'object' ? error : {}) as { status?: unknown; retryAfterSeconds?: unknown };
	const retryAfter = typeof failure.retryAfterSeconds === 'number' ? failure.retryAfterSeconds : null;
	if (failure.status === 429 && retryAfter !== null && retryAfter > 0 && retryAfter <= LOPU_MODEL_CHECK_RETRYABLE_SECONDS)
		return { busy: true, retryAfterMs: retryAfter * 1000, error: errorMessage(error) };
	return { live: false, error: errorMessage(error) };
};

/** Wrap the API client's call (resolves the 200 body, throws on a refusal) as a LopuModelCheckFn. */
export const createLopuModelCheckFn =
	(call: (target: LopuModelCheckTarget, options: { signal: AbortSignal }) => Promise<unknown>): LopuModelCheckFn =>
	async (target, signal) => {
		try {
			return lopuModelCheckAnswerFromOutcome(await call(target, { signal }));
		} catch (error) {
			if (signal.aborted) throw error;
			return lopuModelCheckAnswerFromError(error);
		}
	};

/** "8 live · 2 errors" — the header's summary once a run has answered. */
export const describeLopuModelCheck = (snapshot: LopuModelCheckState): string | null => {
	const entries = Object.values(snapshot.results);
	const live = entries.filter((entry) => entry.status === 'live').length;
	const failed = entries.filter((entry) => entry.status === 'error').length;
	if (!live && !failed) return null;
	const bits = [`${live} live`];
	if (failed) bits.push(`${failed} ${failed === 1 ? 'error' : 'errors'}`);
	return bits.join(' · ');
};

/** The row tooltip / screen-reader text for one result. */
export const describeLopuModelCheckEntry = (entry: LopuModelCheckEntry | null | undefined): string | null => {
	if (!entry) return null;
	const seconds = typeof entry.latencyMs === 'number' ? ` in ${(entry.latencyMs / 1000).toFixed(1)} s` : '';
	switch (entry.status) {
		case 'queued':
			return 'Waiting to check';
		case 'checking':
			return 'Checking…';
		case 'live':
			return `Live — replied${seconds}${entry.message ? ` "${entry.message}"` : ''}`;
		case 'error':
			return `Error — ${entry.message || CHECK_FAILED}`;
		case 'skipped':
			return `Not checked — ${entry.message || 'not checkable here'}`;
		default:
			return null;
	}
};
