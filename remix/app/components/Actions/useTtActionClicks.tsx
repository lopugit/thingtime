import React from 'react';
import { CATALOG_RECORD_ACTION } from '~/schemas/catalogRecordsSuite';
import { LOCAL_UI_ACTION } from './localUiAction';
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

// `confirm` is the CATALOG-SIDE gate (claude-todo/20-tester-runs-actions.md):
// a surface where the viewer did not compose the page — a component's own
// page, a demo — asks before the first run of each action so a stray click
// on author-controlled markup never executes a program by surprise. It runs
// AFTER the sign-in gate and BEFORE any request; answering false runs
// nothing and writes no run record. runDelegatedAction stays the sole
// caller of onUnowned.
export type TtActionConfirmHandler = (request: { action: string; inputs: Record<string, unknown> }) => Promise<boolean> | boolean;

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

export const useTtActionClicks = (options?: { onUnowned?: TtActionUnownedHandler; confirm?: TtActionConfirmHandler; onLocal?: (inputs: Record<string, unknown>) => void; onResult?: (outcome: { action: string; ok: boolean; result: unknown; error: string | null }) => void }) => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const lopuRef = React.useRef(lopu);
	lopuRef.current = lopu;
	const onUnownedRef = React.useRef(options?.onUnowned);
	onUnownedRef.current = options?.onUnowned;
	const confirmRef = React.useRef(options?.confirm);
	confirmRef.current = options?.confirm;
	const localRef = React.useRef(options?.onLocal);
	localRef.current = options?.onLocal;
	const resultRef = React.useRef(options?.onResult);
	resultRef.current = options?.onResult;
	const busyRef = React.useRef(false);
	const mountedRef = React.useRef(true);
	React.useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
	const runtime = useWebpageRuntime();
	const runtimeRef = React.useRef(runtime);
	runtimeRef.current = runtime;
	const user = useCurrentUser();
	const signedIn = !!user?.id;
	const identityRef = React.useRef(user?.id);
	identityRef.current = user?.id;
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
			if (busyRef.current || control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true') return;
			const action = control.getAttribute('data-tt-action') || '';
			if (!action) return;
			if (action === LOCAL_UI_ACTION) {
				try {
					const input = JSON.parse(control.getAttribute('data-tt-action-inputs') || '{}');
					if (input && typeof input === 'object' && !Array.isArray(input)) localRef.current?.(input);
				} catch {}
				return;
			}
			if (action === REFRESH_ACTION) {
				runtimeRef.current.refresh();
				return;
			}
			if (!signedIn && (!runtimeRef.current.sharedRun || action === INSTALL_ACTION)) {
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
			// component root. Fields win over static inputs, including explicit
			// empty text; excluded or missing fields preserve static inputs.
			const group = (control.closest('fieldset') as HTMLElement | null) || (event.currentTarget as HTMLElement);
			if (group.querySelector('[data-tt-upload-blocking="true"]')) {
				lopuRef.current({ title: 'Finish adding your file', description: 'Wait for the upload, then choose Use file before running this form.', status: 'info' });
				return;
			}
			const invalid = Array.from(group.querySelectorAll<HTMLInputElement>('input, select, textarea')).find((field) => !field.checkValidity());
			if (invalid) { invalid.reportValidity(); return; }
			inputs = { ...inputs, ...gatherFormFields(group) };
			busyRef.current = true;
			const identity = identityRef.current;
			const runRuntime = runtimeRef.current;
			const runApi = apiRef.current;
			const reportResult = resultRef.current;
			const onUnowned = onUnownedRef.current;
			control.setAttribute('aria-busy', 'true');
			(async () => {
				try {
					if (confirmRef.current && !runtimeRef.current.sharedRun) {
						const approved = await confirmRef.current({ action, inputs });
						if (!mountedRef.current || identity !== identityRef.current || !approved) return;
					}
					// source: 'component' NARROWS server-side resolution to actions
					// this viewer owns. Markup can name any id, so the delegated
					// path must never hand the viewer's authority to a stranger's
					// program (execute.ts resolveActionProgram, ownedOnly).
					const outcome = await runDelegatedAction({
						action,
						inputs,
						run: () => {
							if (!mountedRef.current || identity !== identityRef.current) throw new Error('Account changed');
							return runRuntime.sharedRun ? runRuntime.sharedRun(action, inputs) : runApi.v1.actions.run({ action, inputs, source: 'component' });
						},
						onUnowned: async (key, fields) => {
							if (!mountedRef.current || identity !== identityRef.current) return false;
							if (key === CATALOG_RECORD_ACTION) {
								const { installSuiteOnServer } = await import('../Builder/installSuite');
								await installSuiteOnServer('catalog-records', { onlyMissing: true });
								return true;
							}
							return onUnowned?.(key, fields) ?? false;
						}
					});
					if (!mountedRef.current || identity !== identityRef.current) return;
					const response = outcome.response;
					if (outcome.error !== undefined) {
						lopuRef.current({ title: 'That didn’t work 😔', description: outcome.error || undefined, status: 'error' });
						const report = { action, ok: false, result: null, error: outcome.error || 'failed' };
						runRuntime.report(report);
						reportResult?.(report);
					} else if (response?.status === 'ok') {
						const toast = toastFromResult(response.result, {
							title: '⚡ Action ran ✓',
							description: `${response.durationMs}ms · ${response.opsUsed} ops`
						});
						if (toast) {
							lopuRef.current({
								...toast,
								duration: 6000,
								...(!runtimeRef.current.sharedRun ? { link: { label: 'Inspect the run', href: `/actions/${encodeURIComponent(response.actionId || action)}` } } : {})
							});
						}
						const report = { action, ok: true, result: response.result ?? null, error: null };
						runRuntime.report(report);
						reportResult?.(report);
					} else {
						lopuRef.current({ title: 'The action finished with an error 🧯', description: response?.error || undefined, status: 'error' });
						const report = { action, ok: false, result: null, error: response?.error || 'error' };
						runRuntime.report(report);
						reportResult?.(report);
					}
				} catch {
					if (mountedRef.current && identity === identityRef.current) {
						lopuRef.current({ title: 'Could not run this action', status: 'error' });
						const report = { action, ok: false, result: null, error: 'Could not run this action' };
						runRuntime.report(report);
						reportResult?.(report);
					}
				} finally {
					control.removeAttribute('aria-busy');
					busyRef.current = false;
				}
			})();
		},
		[navigate, signedIn]
	);
};
