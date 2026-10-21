import React from 'react';
import { componentScopeValue } from '../ComponentsLibrary/componentTemplate';
import { elapsedClockActive } from '../ComponentsLibrary/elapsedTime';

/** Called unconditionally by authored blocks; only running elapsed formatters
 * subscribe to a clock. Static, missing and completed values allocate no timer. */
export function useFormatClock(format: Record<string, unknown> | undefined, scope: Record<string, unknown>): number {
	const start = format?.kind === 'elapsed' && typeof format.arg === 'string' ? componentScopeValue(scope, format.arg) : null;
	const end = format?.kind === 'elapsed' && typeof format.endArg === 'string' ? componentScopeValue(scope, format.endArg) : undefined;
	const running = format?.kind === 'elapsed' && elapsedClockActive(start, end);
	const [now, setNow] = React.useState(Date.now);
	React.useEffect(() => {
		if (!running) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [running, start, end]);
	return now;
}
