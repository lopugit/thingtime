import React from 'react';
import { componentStyleRules } from './componentStyleRules';

export function ComponentStyle({ rules, children }: { rules?: unknown; children: React.ReactNode }) {
	const id = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
	const css = React.useMemo(() => componentStyleRules(rules, id), [rules, id]);
	return (
		<div data-tt-style={id} style={{ minWidth: 0 }}>
			<style>{css}</style>
			{children}
		</div>
	);
}
