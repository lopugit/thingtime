import React from 'react';

// A server-projected restoration hold is inherited by every nested renderer.
// Client props can tighten this gate, never release an ancestor's hold. The
// server independently checks the protected completion receipt for execution.
const ContentExecutionHeld = React.createContext(false);
const ContentRestoring = React.createContext(false);

export function useContentExecutionHeld(own = false): boolean {
	return React.useContext(ContentExecutionHeld) || own === true;
}

// A read being revalidated can tighten execution without claiming that the
// content is being restored or replacing the ordinary, still-readable fields.
export function ContentExecutionScope({ blocked = false, children }: { blocked?: boolean; children: React.ReactNode }) {
	const held = useContentExecutionHeld(blocked);
	return <ContentExecutionHeld.Provider value={held}>{children}</ContentExecutionHeld.Provider>;
}

export function ContentExecutionBoundary({ held: own = false, children }: { held?: boolean; children: React.ReactNode }) {
	const inherited = React.useContext(ContentRestoring);
	const held = inherited || own === true;
	const blocked = React.useContext(ContentExecutionHeld) || held;
	const statusId = React.useId();
	const stop = (event: React.SyntheticEvent) => {
		if (!blocked) return;
		// Background verification must not steal typing, selection or focus.
		// Navigation, form submission and authored activation remain fenced.
		const target = event.target instanceof Element ? event.target : null;
		if (!held && target?.closest('input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), textarea, [contenteditable="true"]') && !target.closest('a, button, [role="button"], [data-tt-action]')) return;
		event.preventDefault();
		event.stopPropagation();
	};
	return <ContentExecutionHeld.Provider value={blocked}><ContentRestoring.Provider value={held}>
		{held && !inherited ? <style>{'[data-tt-execution-held="true"] :is(button, input, select, textarea, [role="button"], [data-tt-action]) { cursor: not-allowed; opacity: 0.55; }'}</style> : null}
		{held && !inherited ? <p id={statusId} role="status" style={{ color: 'var(--tt-muted, #5a5a66)', fontSize: 13, lineHeight: 1.5, margin: '8px 0' }}>
			Restoring content. Actions become available when restoration completes.
		</p> : null}
		{/* Keep this wrapper mounted so entering/leaving a hold preserves drafts.
		    Unlike inert, disabled fields leave the saved content readable to AT.
		    Capture also covers links, authored pseudo-actions and custom controls. */}
		<fieldset disabled={held} aria-disabled={held || undefined} aria-describedby={held && !inherited ? statusId : undefined}
			data-tt-execution-held={held ? 'true' : 'false'}
			style={{ border: 0, padding: 0, margin: 0, minWidth: 0, width: '100%' }}
			onClickCapture={blocked ? stop : undefined} onDoubleClickCapture={blocked ? stop : undefined}
			onSubmitCapture={blocked ? stop : undefined} onChangeCapture={blocked ? stop : undefined}
			onKeyDownCapture={blocked ? event => { if (event.key === 'Enter' || event.key === ' ') stop(event); } : undefined}
		>
			{children}
		</fieldset>
	</ContentRestoring.Provider></ContentExecutionHeld.Provider>;
}
