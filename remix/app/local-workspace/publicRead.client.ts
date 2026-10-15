import { anonymousWorkspaceDatabase, anonymousWorkspaceLease } from './runtime.client';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { WorkspaceError } from './storage';

/** Anonymous public discovery never borrows a newly signed-in tab's cookies.
 * Cache only public, non-bearer reads. Cached content grants no write authority. */
export async function publicWorkspaceRead(path: string, feature: string, version: string, signal?: AbortSignal) {
	const lease = anonymousWorkspaceLease(); lease.assertCurrent(); signal?.throwIfAborted();
	const url = new URL(path, window.location.origin);
	if (url.origin !== window.location.origin || !['/api/v1/things', '/api/v1/things/feed', '/api/v1/things/trending', '/api/v1/components/browse', '/api/v1/schemas/browse', '/api/v1/webpages/resolve', '/api/v1/themes/shared', '/api/v1/algorithms/search', '/api/v1/algorithms/shared', '/api/v1/users/profile', '/api/v1/users/activity', '/api/v1/users/search'].includes(url.pathname)) throw new WorkspaceError('INVALID_PUBLIC_READ', 'Unsupported public catalog read');
	const key = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url.pathname + url.search)).then(bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''));
	const cacheable = !url.searchParams.has('key') && !url.searchParams.has('sharedRoot');
	const db = anonymousWorkspaceDatabase();
	try {
		await requireThingtimeCapability(feature, version); lease.assertCurrent(); signal?.throwIfAborted();
		const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: signal || AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } });
		lease.assertCurrent();
		if (!response.ok) throw new WorkspaceError('PUBLIC_READ_FAILED', `Public content is unavailable (${response.status})`, response.status);
		const data = await response.json(); lease.assertCurrent(); signal?.throwIfAborted();
		if (data?.ok !== true) throw new WorkspaceError('PUBLIC_READ_FAILED', 'Invalid public catalog response', 502);
		if (cacheable) await db.transaction({ kind: 'anonymous' }, 'readwrite', lease, tx => tx.put('public-catalog', key, data)).catch(() => {});
		lease.assertCurrent(); return data;
	} catch (error) {
		lease.assertCurrent(); signal?.throwIfAborted();
		// Authoritative refusals must never resurrect a previously visible row.
		// A timeout or a rate limit is not such a refusal: it says nothing about
		// whether the content still exists, so it keeps the cache and falls back
		// to it, using the same transient classification as the account queue.
		if (error instanceof WorkspaceError && error.status < 500 && error.status !== 408 && error.status !== 429) {
			if (cacheable) await db.transaction({ kind: 'anonymous' }, 'readwrite', lease, tx => tx.delete('public-catalog', key));
			throw error;
		}
		if (cacheable) {
			const cached = await db.transaction({ kind: 'anonymous' }, 'readonly', lease, tx => tx.get('public-catalog', key));
			if (cached) return cached;
		}
		throw error;
	}
}
