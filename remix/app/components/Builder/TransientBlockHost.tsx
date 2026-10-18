import React from 'react';
import { ComponentDataScope } from './ComponentSelect';
import { NativeControlsEnabled } from './NativeComponentControls';
import { createTransientLifetime, parseTransientBinding, TRANSIENT_BLOCK_ACTION, transientFieldValue, transientNamedField, type TransientBlockActions } from './transientBlockActions';
export type { TransientBlockActions, TransientBlockInvocation } from './transientBlockActions';

export type TransientBlockHostProps = {
	scopeKey: string;
	/** Public display state only. Credentials and transfer bytes stay in adapter closures. */
	scope: Record<string, unknown>;
	actions: TransientBlockActions;
	enabled?: boolean;
	onError?: () => void;
	children: React.ReactNode;
};

/** One explicit adapter boundary. No Action execution, localStorage, Timeline,
 * source refresh or result reporting is used here. The keyed lifetime also
 * removes password/file DOM state when the account or origin changes. */
export function TransientBlockHost(props: TransientBlockHostProps) {
	return <TransientBlockSession key={`${props.scopeKey}:${props.enabled !== false}`} {...props} />;
}

function TransientBlockSession({ scope, actions, enabled = true, onError, children }: TransientBlockHostProps) {
	const host = React.useRef<HTMLDivElement>(null);
	const lifetimeRef = React.useRef(createTransientLifetime());
	const current = React.useRef({ actions, enabled, onError });
	current.current = { actions, enabled, onError };
	React.useLayoutEffect(() => {
		if (lifetimeRef.current.signal.aborted) lifetimeRef.current = createTransientLifetime();
		return () => lifetimeRef.current.close();
	}, []);
	React.useLayoutEffect(() => {
		// Dialog contents are authored blocks; only the browser's focus/top-layer
		// capability is native. Builder edit mode keeps them ordinary open panels.
		if (!enabled) return;
		for (const dialog of host.current?.querySelectorAll<HTMLDialogElement>('dialog[data-tt-action="$transient"]') || []) {
			const binding = parseTransientBinding(dialog.getAttribute('data-tt-action-inputs'));
			const desired = binding?.inputs.open === true || binding?.inputs.open === 'true';
			if (desired && !dialog.open) dialog.showModal();
			else if (!desired && dialog.open) dialog.close();
		}
	});
	const activate = (event: React.SyntheticEvent<HTMLDivElement> | Event, change: boolean) => {
		const root = event.currentTarget as HTMLDivElement;
		const lifetime = lifetimeRef.current;
		const target = event.target as Element;
		// Capture every live click/change before it can bubble into outer Action
		// surfaces, including controls with no action. Preserve native defaults.
		if (!current.current.enabled) return;
		event.stopPropagation();
		const control = target.closest<HTMLElement>('[data-tt-action]');
		if (!control || !root.contains(control)) return;
		if (control.tagName === 'DIALOG' && event.type !== 'cancel') return;
		// Keep every ordinary delegated Action away from transient form values.
		// In edit mode leave selection to Builder, whose controls are inert.
		const field = ['INPUT', 'SELECT', 'TEXTAREA'].includes(control.tagName);
		if (field !== change) {
			// Clicking a field must still focus it / open the native file picker,
			// but must not bubble into an ordinary Action wrapper.
			event.stopPropagation();
			return;
		}
		event.preventDefault(); event.stopPropagation();
		if (control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true' || lifetime.signal.aborted) return;
		if (control.getAttribute('data-tt-action') !== TRANSIENT_BLOCK_ACTION) return;
		const binding = parseTransientBinding(control.getAttribute('data-tt-action-inputs'));
		if (!binding || !Object.prototype.hasOwnProperty.call(current.current.actions, binding.operation)) return;
		const action = current.current.actions[binding.operation];
		const fieldset = control.closest('fieldset');
		const group = fieldset && root.contains(fieldset) ? fieldset : root;
		const read = (name: string) => { lifetime.assertActive(); return transientNamedField(group, name); };
		const value = transientFieldValue(control);
		try {
			// Invoke synchronously so explicit browser-open/download gestures retain
			// user activation. Do not retain or publish the operation's return value.
			const result = action({ inputs: binding.inputs, value, signal: lifetime.signal,
				readField: name => transientFieldValue(read(name)),
				readFile: name => {
					const input = read(name) as HTMLInputElement | null;
					if (input?.type !== 'file') return undefined;
					const file = input.files?.[0]; input.value = ''; return file;
				} });
			Promise.resolve(result).catch(() => { if (!lifetime.signal.aborted) current.current.onError?.(); });
		} catch { if (!lifetime.signal.aborted) current.current.onError?.(); }
	};
	React.useLayoutEffect(() => {
		const root = host.current;
		const cancel = (event: Event) => activate(event, false);
		root?.addEventListener('cancel', cancel, true);
		return () => root?.removeEventListener('cancel', cancel, true);
	});
	return <ComponentDataScope.Provider value={scope}><NativeControlsEnabled.Provider value={enabled}>
		<div ref={host} data-tt-transient-boundary="" onClickCapture={event => activate(event, false)} onChangeCapture={event => activate(event, true)}
			onSubmitCapture={event => { event.preventDefault(); event.stopPropagation(); }}>
			{children}
		</div>
	</NativeControlsEnabled.Provider></ComponentDataScope.Provider>;
}
