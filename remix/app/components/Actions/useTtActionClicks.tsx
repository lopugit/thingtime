import { PAGE_COLLECTION_REQUIREMENTS } from '~/schemas/authoredControls';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { ACTION_BATCH_ATTRIBUTE, readActionBatch, runActionBatches } from './actionBatches';
import React from 'react';
import { useContentExecutionHeld } from '../Builder/ContentExecutionHold';
import { isTransientBlockTarget, TRANSIENT_BLOCK_ACTION } from '../Builder/transientBlockActions';
import { CATALOG_RECORD_ACTION } from '~/schemas/catalogRecordsSuite';
import { LOCAL_UI_ACTION, MODIFIER_ACTION_INPUTS, localQueryFormInput, modifierSelectionInput } from './localUiAction';
import { useLocation, useNavigate } from 'react-router';
import { useLidarScanActivation } from '../NativeBridge/LidarScanProvider';
import { isLidarScanInput } from '../NativeBridge/lidarScanBridge';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { useWorkspaceUser } from '~/hooks/useWorkspaceUser';
import { useWorkspaceScope } from '~/hooks/useWorkspaceScope';
import { gatherFormFields, useWebpageRuntime } from '~/components/Builder/webpageRuntime';
import { ownsAuthoredControl } from '../Builder/authoredControlOwnership';
import { captureComponentFormFields } from '../Builder/componentFormFields';
import { notifyComponentControlActivation } from '../Builder/componentControlActivation';

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

/** Keyboard parity for named fields in Component and expanded page forms. */
export const clickTtActionForEnter = (event: React.KeyboardEvent, requireFieldset = false): void => {
	const field = event.target as HTMLInputElement;
	if (!ownsAuthoredControl(event.currentTarget as HTMLElement, field)) return;
	if (field.closest('[data-tt-native-control], [data-tt-native-upload]')) return;
	if (
		event.key !== 'Enter' ||
		event.nativeEvent.isComposing ||
		field.tagName !== 'INPUT' ||
		['checkbox', 'radio', 'range', 'button', 'file'].includes(field.type)
	) return;
	const candidate = field.closest('fieldset');
	const fieldset = candidate && ownsAuthoredControl(event.currentTarget as HTMLElement, candidate) ? candidate : null;
	if (requireFieldset && !fieldset) return;
	const group = fieldset || event.currentTarget as HTMLElement;
	const submit = group.querySelector<HTMLButtonElement>('button[data-tt-action]:not(:disabled)');
	if (!submit) return;
	const action = submit.getAttribute('data-tt-action');
	if (action === LOCAL_UI_ACTION) {
		try {
			const input = JSON.parse(submit.getAttribute('data-tt-action-inputs') || '{}');
			if (input?.op !== 'search' && !(input?.op === 'query' && input.scope === 'page' && input.form === true)) return;
		} catch { return; }
	}
	event.preventDefault();
	submit.click();
};

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

export const useTtActionClicks = (options?: {
	identity?: object;
	executionHeld?: boolean;
	onUnowned?: TtActionUnownedHandler;
	confirm?: TtActionConfirmHandler;
	onLocal?: (inputs: Record<string, unknown>) => void;
	onPending?: (action: string | null) => void;
	onResult?: (outcome: { action: string; ok: boolean; result: unknown; error: string | null }) => void;
	fallbackGroup?: (control: HTMLElement, boundary: HTMLElement) => HTMLElement;
}) => {
	const held = useContentExecutionHeld(options?.executionHeld);
	const heldRef = React.useRef(held);
	heldRef.current = held;
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
	const pendingRef = React.useRef(options?.onPending);
	pendingRef.current = options?.onPending;
	const fallbackGroupRef = React.useRef(options?.fallbackGroup);
	fallbackGroupRef.current = options?.fallbackGroup;
	const busyRef = React.useRef<{ identity: object | null; active: boolean }>({ identity: null, active: false });
	const handledCtrlGesture = React.useRef<HTMLElement | null>(null);
	const mountedRef = React.useRef(true);
	React.useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
	const runtime = useWebpageRuntime();
	const runtimeRef = React.useRef(runtime);
	runtimeRef.current = runtime;
	const user = useWorkspaceUser();
	const workspaceScope = useWorkspaceScope();
	const hasWorkspace = workspaceScope !== 'pending' && !!user?.id;
	const activateLidar = useLidarScanActivation();
	const location = useLocation();
	// Retire pending confirmations on workspace, runtime or route changes.
	// eslint-disable-next-line react-hooks/exhaustive-deps -- opaque action generation
	const actionIdentity = React.useMemo(() => ({}), [workspaceScope, user?.id, runtime.identity, location.key, held, options?.identity]);
	const identityRef = React.useRef(actionIdentity);
	identityRef.current = actionIdentity;
	if (busyRef.current.identity !== actionIdentity) busyRef.current = { identity: actionIdentity, active: false };
	const navigate = useNavigate();

	return React.useCallback(
		(event: React.MouseEvent) => {
			const busy = busyRef.current;
			if (event.type === 'mousedown') { handledCtrlGesture.current = null; return; }
			if (heldRef.current) {
				if (event.type === 'click') { event.preventDefault(); event.stopPropagation(); }
				return;
			}
			const origin = event.target as HTMLElement | null;
			if (isTransientBlockTarget(origin)) return;
			const control = origin?.closest?.('[data-tt-action]') as HTMLElement | null;
			// closest() can walk past the wrapper — only act on controls INSIDE it
			if (!control || !ownsAuthoredControl(event.currentTarget as HTMLElement, control)) return;
			// Reserved for an explicitly mounted transient adapter. Never prepare,
			// record or gather its fields as a normal Action, even outside that host.
			if (control.getAttribute('data-tt-action') === TRANSIENT_BLOCK_ACTION) return;
			// a click that lands ON a form field is the viewer typing, not firing
			const tag = origin?.tagName?.toLowerCase();
			if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'option' || tag === 'label') return;
			const modifier = control.matches('button[type=button]') && modifierSelectionInput(event, control.getAttribute(MODIFIER_ACTION_INPUTS));
			if (!modifier && event.type !== 'click') return;
			event.preventDefault();
			event.stopPropagation();
			if (control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true') return;
			if (modifier) {
				// On macOS one Ctrl-primary press can emit both contextmenu and click.
				if (event.ctrlKey && handledCtrlGesture.current === control) return;
				if (event.ctrlKey) handledCtrlGesture.current = control;
				localRef.current?.(modifier);
				return;
			}
			const action = control.getAttribute('data-tt-action') || '';
			if (action === '$transient') return; // An enclosing transient host owns this intent; never persist or dispatch it.
			if (!action) return;
			if (action === LOCAL_UI_ACTION) {
				try {
					const input = JSON.parse(control.getAttribute('data-tt-action-inputs') || '{}');
					if (input && typeof input === 'object' && !Array.isArray(input)) {
						if (input.op === 'native') {
							if (!activateLidar || !isLidarScanInput(input) || !control.matches('button[type=button]') ||
								!event.nativeEvent.isTrusted || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
							const issue = activateLidar(user?.localOnly || user?.offline ? undefined : user?.id);
							if (issue) lopuRef.current({ title: 'LiDAR scanner', description: issue, status: 'info', link: { label: 'Things', href: '/things' } });
							return;
						}
						const wrapper = event.currentTarget as HTMLElement;
						const fieldset = control.closest('fieldset') as HTMLElement | null;
						const group = fieldset && ownsAuthoredControl(wrapper, fieldset) ? fieldset : fallbackGroupRef.current?.(control, wrapper) || wrapper;
						if (input.op === 'query' && input.form === true) {
							if (busy.active) return;
							const invalid = Array.from(group.querySelectorAll<HTMLInputElement>('input, select, textarea')).find((field) => !field.checkValidity());
							if (invalid) { invalid.reportValidity(); return; }
							const identity = identityRef.current;
							busy.active = true; control.setAttribute('aria-busy', 'true');
							void captureComponentFormFields(group, gatherFormFields, () => mountedRef.current && identity === identityRef.current && control.isConnected)
								.then(fields => { if (mountedRef.current && identity === identityRef.current) { localRef.current?.(localQueryFormInput(input, fields)); notifyComponentControlActivation(control); } })
								.catch(error => { if (mountedRef.current && identity === identityRef.current) lopuRef.current({ title: 'Check the form', description: messageOf(error), status: 'error' }); })
								.finally(() => { busy.active = false; control.removeAttribute('aria-busy'); });
						} else { localRef.current?.(input); notifyComponentControlActivation(control); }
					}
				} catch {}
				return;
			}
			if (busy.active) return;
			if (action === REFRESH_ACTION) {
				runtimeRef.current.refresh();
				notifyComponentControlActivation(control);
				return;
			}
			if (!hasWorkspace && (!runtimeRef.current.sharedRun || action === INSTALL_ACTION)) {
				lopuRef.current({ title: 'Sign in to use this 🗝️', description: 'Controls run as you, on your own things.', status: 'info', duration: 6000 });
				navigate('/login');
				return;
			}
			if (action === INSTALL_ACTION) {
				const install = runtimeRef.current.install;
				if (!install) return;
				busy.active = true;
				install()
					.catch(() => false)
					.finally(() => {
						busy.active = false;
					});
				notifyComponentControlActivation(control);
				return;
			}
			const batchValue = control.getAttribute(ACTION_BATCH_ATTRIBUTE);
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
			const boundary = event.currentTarget as HTMLElement;
			const fieldset = control.closest('fieldset') as HTMLElement | null;
			const group = (fieldset && ownsAuthoredControl(boundary, fieldset) ? fieldset : null) || fallbackGroupRef.current?.(control, boundary) || boundary;
			if (group.querySelector('[data-tt-upload-blocking="true"]')) {
				lopuRef.current({ title: 'Finish adding your file', description: 'Wait for the upload, then choose Use file before running this form.', status: 'info' });
				return;
			}
			const invalid = Array.from(group.querySelectorAll<HTMLInputElement>('input, select, textarea')).find((field) => !field.checkValidity());
			if (invalid) { invalid.reportValidity(); return; }
			busy.active = true;
			const identity = identityRef.current;
			const runRuntime = runtimeRef.current;
			const runApi = apiRef.current;
			const reportResult = resultRef.current;
			const reportPending = pendingRef.current;
			const onUnowned = onUnownedRef.current;
			control.setAttribute('aria-busy', 'true');
			reportPending?.(action);
			(async () => {
				try {
					const batch = batchValue === null ? null : readActionBatch(batchValue);
					if (batch && (!control.matches('button[type=button]') || runRuntime.source !== 'user' || runRuntime.sharedRun)) {
						throw new Error('Action batches require a button on your own live page.');
					}
					const picked = batch && Object.prototype.hasOwnProperty.call(runRuntime.selection, batch.selectionKey) ? runRuntime.selection[batch.selectionKey] : undefined;
					if (batch && (!picked?.items.length || picked.context !== batch.context)) throw new Error('Select at least one item for the current batch.');
					const captured = picked?.items.slice();
					const fields = await captureComponentFormFields(group, gatherFormFields, () => mountedRef.current && identity === identityRef.current && control.isConnected);
					if (!mountedRef.current || identity !== identityRef.current) return;
					inputs = { ...inputs, ...fields, ...(batch ? { [batch.input]: captured } : {}) };
					if (confirmRef.current && !runtimeRef.current.sharedRun) {
						const approved = await confirmRef.current({ action, inputs });
						if (!mountedRef.current || identity !== identityRef.current || !approved) return;
					}
					if (batch) await requireThingtimeCapability('api.actions-run', PAGE_COLLECTION_REQUIREMENTS['api.actions-run']);
					if (!mountedRef.current || identity !== identityRef.current) return;
					const run = (values: Record<string, unknown>) => {
						if (!mountedRef.current || identity !== identityRef.current) throw new Error('Account or page changed.');
						return runRuntime.sharedRun ? runRuntime.sharedRun(action, values) : runApi.v1.actions.run({ action, inputs: values, source: 'component' });
					};
					notifyComponentControlActivation(control);
					// source: 'component' NARROWS server-side resolution to actions
					// this viewer owns. Markup can name any id, so the delegated
					// path must never hand the viewer's authority to a stranger's
					// program (execute.ts resolveActionProgram, ownedOnly).
					const outcome = await runDelegatedAction({
						action,
						inputs,
						run: () => batch ? runActionBatches(batch, inputs, run) : run(inputs),
						onUnowned: batch ? undefined : async (key, fields) => {
							if (!mountedRef.current || identity !== identityRef.current) return false;
							if (key === CATALOG_RECORD_ACTION) {
								const { installSuiteForWorkspace } = await import('../Builder/installSuite');
								if (!mountedRef.current || identity !== identityRef.current) return false;
								await installSuiteForWorkspace('catalog-records', { onlyMissing: true });
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
				} catch (error) {
					if (mountedRef.current && identity === identityRef.current) {
						const message = messageOf(error) || 'Could not run this action';
						lopuRef.current({ title: 'Could not run this action', description: message, status: 'error' });
						const report = { action, ok: false, result: null, error: message };
						runRuntime.report(report);
						reportResult?.(report);
					}
				} finally {
					control.removeAttribute('aria-busy');
					busy.active = false;
					if (mountedRef.current && identity === identityRef.current) reportPending?.(null);
				}
			})();
		},
		[activateLidar, navigate, hasWorkspace, user?.id]
	);
};
