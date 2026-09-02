import React from 'react';
import { useNavigate } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { gatherFormFields, useWebpageRuntime } from '~/components/Builder/webpageRuntime';

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

// Pseudo-actions a control may name instead of a program: `$refresh` bumps
// the page runtime (every source-bound block refetches) and `$install`
// installs the page's suite for the viewer. Neither reaches the run endpoint.
export const REFRESH_ACTION = '$refresh';
export const INSTALL_ACTION = '$install';

// A result that carries a `message` string narrates itself in the toast —
// "You caught PIKACHU!" beats "38ms · 4 ops" on an app page. `title` and
// `status` are honoured the same way; everything else keeps the run summary.
export const toastFromResult = (
	result: unknown,
	fallback: { title: string; description: string }
): { title: string; description: string; status: 'success' | 'error' | 'info' } | null => {
	const record = result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : null;
	// `silent: true` = the page itself shows the outcome (a map step, a
	// re-render) — no toast at all
	if (record && record.silent === true) return null;
	const message = record && typeof record.message === 'string' && record.message.trim() ? record.message.trim().slice(0, 400) : null;
	const title = record && typeof record.title === 'string' && record.title.trim() ? record.title.trim().slice(0, 120) : null;
	const status = record && (record.status === 'error' || record.status === 'info') ? record.status : 'success';
	if (!message && !title) return { ...fallback, status: 'success' };
	return { title: title || (status === 'error' ? 'Hmm 🧯' : '⚡ Done ✓'), description: message || fallback.description, status };
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
	const runtime = useWebpageRuntime();
	const runtimeRef = React.useRef(runtime);
	runtimeRef.current = runtime;
	const user = useCurrentUser();
	const signedIn = !!user?.id;
	const navigate = useNavigate();

	return React.useCallback(
		(event: React.MouseEvent) => {
			const origin = event.target as HTMLElement | null;
			const control = origin?.closest?.('[data-tt-action]') as HTMLElement | null;
			// closest() can walk past the wrapper — only act on controls INSIDE it
			if (!control || !(event.currentTarget as HTMLElement).contains(control)) return;
			// a click that lands ON a form field is the viewer typing, not firing
			const tag = origin?.tagName?.toLowerCase();
			if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'option' || tag === 'label') return;
			event.preventDefault();
			event.stopPropagation();
			if (busyRef.current) return;
			const action = control.getAttribute('data-tt-action') || '';
			if (!action) return;
			if (action === REFRESH_ACTION) {
				runtimeRef.current.refresh();
				return;
			}
			if (!signedIn) {
				lopuRef.current({ title: 'Sign in to use this 🗝️', description: 'Controls run as you, on your own things.', status: 'info', duration: 6000 });
				navigate('/login');
				return;
			}
			if (action === INSTALL_ACTION) {
				const install = runtimeRef.current.install;
				if (!install) return;
				busyRef.current = true;
				install()
					.catch(() => false)
					.finally(() => {
						busyRef.current = false;
					});
				return;
			}
			let inputs: Record<string, unknown> = {};
			try {
				const parsed = JSON.parse(control.getAttribute('data-tt-action-inputs') || '{}');
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) inputs = parsed;
			} catch {}
			// named fields inside the control's FORM GROUP become inputs — a
			// component with an <input name="nickname"> and a button IS a form.
			// The group is the closest <fieldset> around the control (so one
			// component can hold several independent forms), else the whole
			// component root. Field values win over the static inputs; untouched
			// fields keep them.
			const group = (control.closest('fieldset') as HTMLElement | null) || (event.currentTarget as HTMLElement);
			inputs = { ...inputs, ...gatherFormFields(group) };
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
						runtimeRef.current.report({ action, ok: false, result: null, error: outcome.error || 'failed' });
					} else if (response?.status === 'ok') {
						const toast = toastFromResult(response.result, {
							title: '⚡ Action ran ✓',
							description: `${response.durationMs}ms · ${response.opsUsed} ops`
						});
						if (toast) {
							lopuRef.current({
								...toast,
								duration: 6000,
								link: { label: 'Inspect the run', href: `/actions/${encodeURIComponent(response.actionId || action)}` }
							});
						}
						runtimeRef.current.report({ action, ok: true, result: response.result ?? null, error: null });
					} else {
						lopuRef.current({ title: 'The action finished with an error 🧯', description: response?.error || undefined, status: 'error' });
						runtimeRef.current.report({ action, ok: false, result: null, error: response?.error || 'error' });
					}
				} finally {
					busyRef.current = false;
				}
			})();
		},
		[navigate, signedIn]
	);
};
