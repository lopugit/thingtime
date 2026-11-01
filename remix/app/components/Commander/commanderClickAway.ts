import React from 'react';

// Mobile Safari generates a compatibility `click` after an unprevented touch.
// A document-level `touchend` state update can replace the touched React tree
// before that click is emitted, making every control outside Commander appear
// inert. Close on the eventual click (plus keyboard focus) instead.
export const COMMANDER_CLICK_AWAY_EVENTS = ['click', 'focusin'] as const;

export const shouldCloseCommanderForTarget = (root: HTMLElement | null, target: EventTarget | null): boolean => {
	if (!root || !target || typeof (target as Node).nodeType !== 'number') return false;

	const node = target as Node;
	return !root.contains(node) && root.ownerDocument.contains(node);
};

export const CommanderClickAwayBoundary = (props: { children: React.ReactElement; onClickAway: (event: Event) => void }) => {
	const rootRef = React.useRef<HTMLElement | null>(null);
	const onClickAwayRef = React.useRef(props.onClickAway);
	React.useEffect(() => {
		onClickAwayRef.current = props.onClickAway;
	}, [props.onClickAway]);

	React.useEffect(() => {
		const root = rootRef.current;
		const ownerDocument = root?.ownerDocument;
		if (!root || !ownerDocument) return;

		let active = false;
		let focusTimer: number | undefined;
		const activationTimer = window.setTimeout(() => {
			active = true;
		}, 0);
		const handleClickAway = (event: Event) => {
			if (!active || !shouldCloseCommanderForTarget(root, event.target)) return;
			if (event.type === 'focusin') {
				window.clearTimeout(focusTimer);
				focusTimer = window.setTimeout(() => onClickAwayRef.current(event), 0);
				return;
			}
			window.clearTimeout(focusTimer);
			onClickAwayRef.current(event);
		};

		for (const eventName of COMMANDER_CLICK_AWAY_EVENTS) {
			ownerDocument.addEventListener(eventName, handleClickAway);
		}

		return () => {
			active = false;
			window.clearTimeout(activationTimer);
			window.clearTimeout(focusTimer);
			for (const eventName of COMMANDER_CLICK_AWAY_EVENTS) {
				ownerDocument.removeEventListener(eventName, handleClickAway);
			}
		};
	}, []);

	return React.cloneElement(props.children as React.ReactElement<any>, { ref: rootRef });
};
