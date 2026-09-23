import React from 'react';
import { NativeControlsEnabled } from './NativeComponentControls';
import { componentDragData, componentDropInputs, type ComponentDragData } from './componentDragInputs';

const DragContext = React.createContext<React.MutableRefObject<ComponentDragData | null> | null>(null);
export function ComponentDragBoundary({ children, resetKey }: { children: React.ReactNode; resetKey?: unknown }) {
	const parent = React.useContext(DragContext);
	const value = React.useRef<ComponentDragData | null>(null);
	const previous = React.useRef(resetKey);
	if (previous.current !== resetKey) {
		value.current = null;
		previous.current = resetKey;
	}
	return <DragContext.Provider value={parent || value}>{children}</DragContext.Provider>;
}

export function ComponentDragSource({ group, inputs, disabled, className, children }: Record<string, unknown> & { children: React.ReactNode }) {
	const enabled = React.useContext(NativeControlsEnabled);
	const drag = React.useContext(DragContext);
	return (
		<div
			className={typeof className === 'string' ? className : undefined}
			draggable={enabled && !!drag && disabled !== true}
			onDragStart={(event) => {
				const value = componentDragData(group, inputs);
				if (!enabled || !drag || disabled === true || !value) {
					event.preventDefault();
					return;
				}
				event.stopPropagation();
				drag.current = value;
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.clearData();
				// Some browsers require a payload to start dragging. No record data
				// crosses the browser boundary; drop targets use the page-local ref.
				event.dataTransfer.setData('text/plain', 'Move item');
			}}
			onDragEnd={() => {
				if (drag) drag.current = null;
			}}
		>
			{children}
		</div>
	);
}

export function ComponentDropTarget({
	group,
	sourceInputs,
	disabled,
	className,
	children,
	...props
}: Record<string, unknown> & { children: React.ReactNode }) {
	const enabled = React.useContext(NativeControlsEnabled);
	const drag = React.useContext(DragContext);
	const button = React.useRef<HTMLButtonElement>(null);
	const [active, setActive] = React.useState(false);
	const candidate = () => {
		if (!enabled || disabled === true) return null;
		try {
			return componentDropInputs(drag?.current || null, group, sourceInputs, JSON.parse(String(props['data-tt-action-inputs'] || '{}')));
		} catch {
			return null;
		}
	};
	return (
		<div
			className={typeof className === 'string' ? className : undefined}
			data-drop-active={active || undefined}
			onDragOver={(event) => {
				if (candidate()) {
					event.preventDefault();
					event.stopPropagation();
					event.dataTransfer.dropEffect = 'move';
					setActive(true);
				}
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
			}}
			onDrop={(event) => {
				const inputs = candidate();
				setActive(false);
				if (!inputs || !button.current) return;
				event.preventDefault();
				event.stopPropagation();
				if (drag) drag.current = null;
				// Use the normal delegated Action button path: ownership, confirmation,
				// account boundaries, concurrency and result handling stay identical.
				button.current.setAttribute('data-tt-action-inputs', JSON.stringify(inputs));
				button.current.click();
			}}
		>
			{children}
			<button
				ref={button}
				type="button"
				hidden
				aria-hidden="true"
				tabIndex={-1}
				data-tt-action={typeof props['data-tt-action'] === 'string' ? props['data-tt-action'] : undefined}
			/>
		</div>
	);
}
