import React from 'react';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';

// The click half of the ttAction binding (componentTemplate.ts resolves the
// markup half). Attach the returned handler as onClickCapture on a TRUSTED
// component-render surface; it finds the nearest [data-tt-action] ancestor of
// the click, reads the action key + JSON inputs, and runs the action AS the
// viewer through the ordinary run endpoint. A click grants no authority the
// viewer didn't already have on /actions — the executor's capability + budget
// envelope bounds the run, and the result lands as the usual Lopu toast with
// a deep link to the action's inspector (where the run record just appeared).
//
// `onUnowned` is the one hook a surface gets: when the delegated run comes
// back "no action you own matches" (the executor resolves component clicks
// owner-only), the surface may make the action exist — the demo library
// installs the behaviour suite the control belongs to — and answer true to
// have the SAME click run again. It never widens what a click can run.

export type TtActionUnownedHandler = (action: string, inputs: Record<string, unknown>) => Promise<boolean> | boolean;

const UNOWNED_PATTERN = /no action you own matches/i;

const messageOf = (error: unknown): string => {
	const failure = error as { error?: string; message?: string } | null;
	return failure?.error || failure?.message || '';
};

export type DelegatedRunOutcome = { response?: any; error?: string; installed?: boolean };

// The control flow, pure so it can be tested without a DOM: run; on the
// executor's "unowned" refusal let the surface install, then run the same
// click once more; any other failure surfaces as-is and never calls onUnowned.
export const runDelegatedAction = async (params: {
	action: string;
	inputs: Record<string, unknown>;
	run: () => Promise<any>;
	onUnowned?: TtActionUnownedHandler;
}): Promise<DelegatedRunOutcome> => {
	try {
		return { response: await params.run() };
	} catch (error: unknown) {
		const message = messageOf(error);
		if (!UNOWNED_PATTERN.test(message) || !params.onUnowned) return { error: message };
		try {
			if (!(await params.onUnowned(params.action, params.inputs))) return { error: message };
			return { response: await params.run(), installed: true };
		} catch (retry: unknown) {
			return { error: messageOf(retry) || message };
		}
	}
};

export const useTtActionClicks = (options?: { onUnowned?: TtActionUnownedHandler }) => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const lopuRef = React.useRef(lopu);
	lopuRef.current = lopu;
	const onUnownedRef = React.useRef(options?.onUnowned);
	onUnownedRef.current = options?.onUnowned;
	const busyRef = React.useRef(false);

	return React.useCallback((event: React.MouseEvent) => {
		const origin = event.target as HTMLElement | null;
		const control = origin?.closest?.('[data-tt-action]') as HTMLElement | null;
		// closest() can walk past the wrapper — only act on controls INSIDE it
		if (!control || !(event.currentTarget as HTMLElement).contains(control)) return;
		event.preventDefault();
		event.stopPropagation();
		if (busyRef.current) return;
		const action = control.getAttribute('data-tt-action') || '';
		if (!action) return;
		let inputs: Record<string, unknown> = {};
		try {
			const parsed = JSON.parse(control.getAttribute('data-tt-action-inputs') || '{}');
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) inputs = parsed;
		} catch {}
		busyRef.current = true;
		(async () => {
			try {
				// source: 'component' NARROWS server-side resolution to actions
				// this viewer owns. Markup can name any id, so the delegated
				// path must never hand the viewer's authority to a stranger's
				// program (execute.ts resolveActionProgram, ownedOnly).
				const outcome = await runDelegatedAction({
					action,
					inputs,
					run: () => apiRef.current.v1.actions.run({ action, inputs, source: 'component' }),
					onUnowned: onUnownedRef.current
				});
				const response = outcome.response;
				if (outcome.error !== undefined) {
					lopuRef.current({ title: 'That didn’t work 😔', description: outcome.error || undefined, status: 'error' });
				} else if (response?.status === 'ok') {
					lopuRef.current({
						title: `⚡ Action ran ✓`,
						description: `${response.durationMs}ms · ${response.opsUsed} ops`,
						status: 'success',
						duration: 6000,
						link: { label: 'Inspect the run', href: `/actions/${encodeURIComponent(response.actionId || action)}` }
					});
				} else {
					lopuRef.current({ title: 'The action finished with an error 🧯', description: response?.error || undefined, status: 'error' });
				}
			} finally {
				busyRef.current = false;
			}
		})();
	}, []);
};
