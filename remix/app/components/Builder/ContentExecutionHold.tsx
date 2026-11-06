import React from 'react';

// A server-projected restoration hold is inherited by every nested renderer.
// Client props can tighten this gate, never release an ancestor's hold. The
// server independently checks the protected completion receipt for execution.
const ContentExecutionHeld = React.createContext(false);

export function useContentExecutionHeld(own = false): boolean {
	return React.useContext(ContentExecutionHeld) || own === true;
}

export function ContentExecutionBoundary({ held: own = false, children }: { held?: boolean; children: React.ReactNode }) {
	const inherited = React.useContext(ContentExecutionHeld);
	const held = inherited || own === true;
	const statusId = React.useId();
	const stop = (event: React.SyntheticEvent) => {
		if (!held) return;
		event.preventDefault();
		event.stopPropagation();
	};
	return <ContentExecutionHeld.Provider value={held}>
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
			onClickCapture={held ? stop : undefined} onDoubleClickCapture={held ? stop : undefined}
			onSubmitCapture={held ? stop : undefined} onChangeCapture={held ? stop : undefined}
			onKeyDownCapture={held ? event => { if (event.key === 'Enter' || event.key === ' ') stop(event); } : undefined}
		>
			{children}
		</fieldset>
	</ContentExecutionHeld.Provider>;
}
