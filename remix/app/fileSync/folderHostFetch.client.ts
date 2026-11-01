/** Exact-origin account transport shared by native sync hosts. Signed object
 * uploads keep their credential-free destination; API fallback is Mac-only. */
export function createFolderHostFetch(input: {
 origin: string; localOrigin: string; ownerId: string; signal: AbortSignal;
 // Trusted hosts may reuse the same proxy for an explicitly selected plane.
 expectedDataPlane?: string;
 check(): void; fetch: typeof fetch;
}): typeof fetch {
 const changed = () => Error('The account, device or sync server changed. Reopen folder access.');
	const { origin, localOrigin, ownerId, signal: outerSignal, check, fetch: fetcher } = input;
	return async (target, init) => {
		check();
		// Shared transports only pass URLs with explicit options. Refuse Request
		// objects rather than accidentally dropping their method, body or signal.
		if (typeof target !== 'string' && !(target instanceof URL)) throw changed();
		const url = new URL(target),
			headers = new Headers(init?.headers);
		if (url.username || url.password || url.hash) throw changed();
		const signed = init?.credentials === 'omit';
		if (signed) {
			if (
				(url.protocol !== 'https:' && url.origin !== origin) ||
				init?.redirect !== 'error' ||
				['authorization', 'cookie', 'x-thingtime-expected-actor', 'x-thingtime-expected-data-plane', 'x-thingtime-expected-api-origin'].some((key) =>
					headers.has(key)
				)
			)
				throw changed();
		} else if (
			url.origin !== origin ||
			!url.pathname.startsWith('/api/v1/') ||
			!['same-origin', 'include'].includes(init?.credentials ?? '') ||
			init?.redirect !== 'error' ||
			init?.cache !== 'no-store' ||
			headers.get('X-Thingtime-Expected-Actor') !== ownerId ||
			headers.get('X-Thingtime-Expected-Data-Plane') !== (input.expectedDataPlane ?? 'home') ||
			headers.has('authorization') ||
			headers.has('cookie')
		)
			throw changed();
		if (!signed) headers.set('X-Thingtime-Expected-Api-Origin', origin!);
		const destination = signed ? url : new URL(url.pathname + url.search, localOrigin);
		const signal = init?.signal ? AbortSignal.any([outerSignal, init.signal]) : outerSignal;
		signal.throwIfAborted();
		const response = await fetcher(destination, { ...init, headers, signal });
		try {
			check();
			signal.throwIfAborted();
			if (response.redirected || (!signed && origin !== localOrigin && response.headers.get('x-thingtime-api-fallback') !== origin)) throw changed();
			return response;
		} catch (error) {
			await response.body?.cancel().catch(() => {});
			throw error;
		}
	};
}
