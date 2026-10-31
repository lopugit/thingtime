import { useLayoutEffect, useRef } from 'react';

/** Available to child passive effects as soon as this tree is committed.
 * Invalidate synchronously on removal so late asynchronous work stays fenced. */
export function useMountedRef() {
	const mounted = useRef(false);
	useLayoutEffect(() => {
		mounted.current = true;
		return () => { mounted.current = false; };
	}, []);
	return mounted;
}
