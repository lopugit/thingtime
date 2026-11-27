import React from 'react';
import { ComponentLocalControl, NativeControlsEnabled, ComponentDisplayOnly } from './NativeComponentControls';
import { componentChangeInputs } from './componentChangeInputs';
import { useWebpageRuntime } from './webpageRuntime';

/** Convert a field change to the same delegated Action path as a button. */
export function ComponentChange({
	inputPath,
	stateKey,
	clear,
	queryKey,
	debounceMs,
	allowEmpty,
	className,
	children,
	...props
}: Record<string, unknown> & { children: React.ReactNode }) {
	const displayOnly = React.useContext(ComponentDisplayOnly);
	const enabled = React.useContext(NativeControlsEnabled) && !displayOnly;
	const local = React.useContext(ComponentLocalControl);
	const { setPageQuery } = useWebpageRuntime();
	const usesQuery = typeof queryKey === 'string' && queryKey.length > 0;
	const button = React.useRef<HTMLButtonElement>(null);
	const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const binding = JSON.stringify([enabled, inputPath, stateKey, clear, queryKey, allowEmpty, props['data-tt-action'], props['data-tt-action-inputs']]);
	const currentBinding = React.useRef(binding);
	currentBinding.current = binding;
	React.useEffect(() => () => clearTimeout(timer.current), [binding, setPageQuery]);
	return (
		<span
			className={typeof className === 'string' ? className : undefined}
			onChange={(event) => {
				if (!enabled) return;
				const field = event.target as HTMLInputElement;
				if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName)) return;
				const value =
					field.type === 'checkbox' ? field.checked : ['number', 'range'].includes(field.type) && field.value ? Number(field.value) : field.value;
				if (typeof stateKey === 'string') local?.({ op: 'set', key: stateKey, value, ...(clear === undefined ? {} : { clear }) });
				clearTimeout(timer.current);
				const delay = typeof debounceMs === 'number' && Number.isFinite(debounceMs) ? Math.min(2000, Math.max(0, debounceMs)) : 0;
				if (usesQuery) {
					// Retire the old source immediately, even while waiting for the
					// debounce. This branch only changes presentation query state.
					setPageQuery({ [queryKey]: '' }, true);
					if (value === '' && allowEmpty === false) return;
					const publish = () => {
						if (currentBinding.current === binding) setPageQuery({ [queryKey]: value }, true);
					};
					if (delay) timer.current = setTimeout(publish, delay);
					else publish();
					return;
				}
				if (value === '' && allowEmpty === false) return;
				let inputs;
				try {
					inputs = componentChangeInputs(JSON.parse(String(props['data-tt-action-inputs'] || '{}')), inputPath, value);
				} catch {
					return;
				}
				if (!inputs) return;
				const submit = () => {
					// A delayed change belongs to the original Action and inputs.
					// Never dispatch it into a newly selected record or disabled view.
					if (!button.current || currentBinding.current !== binding) return;
					button.current.setAttribute('data-tt-action-inputs', JSON.stringify(inputs));
					button.current.click();
				};
				if (delay) timer.current = setTimeout(submit, delay);
				else submit();
			}}
		>
			{children}
			<button
				ref={button}
				type="button"
				hidden
				aria-hidden="true"
				tabIndex={-1}
				data-tt-action={!usesQuery && !displayOnly && typeof props['data-tt-action'] === 'string' ? props['data-tt-action'] : undefined}
			/>
		</span>
	);
}
