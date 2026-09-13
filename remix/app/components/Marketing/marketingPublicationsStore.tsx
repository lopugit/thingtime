import React from 'react';

import { createApiFailure, readApiResponsePayload } from '~/hooks/apiFailure';
import { recordApiCall } from '~/hooks/apiRequestLog';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import {
	EMPTY_PUBLICATIONS,
	applyPublicationChanges,
	normalizePublications,
	type MarketingPublications,
	type PublicationChange
} from '~/marketing/publishingCore';

// Client half of marketing publishing (marketing/publishing.ts): ONE module
// store shared by every /marketing route, the drawer and the admin panel, so a
// page load costs one publications fetch however many components read it.
// Deliberately catalog-FREE (imports publishingCore only): the drawer renders
// on every page, and the 1,600-page catalog must stay in the marketing chunk.
// The catalog-aware `useMarketingVisibility` lives in useMarketingPublications.tsx.
//
// Optimistic-render house rule: the store seeds from the synchronous
// `tt-marketing-publications` localStorage tier so a returning visitor's first
// paint already knows what is published, then refetches in the background and
// reconciles. Only a true cold start (nothing cached) renders the empty
// surface, and admins never wait at all — they see every surface regardless.
//
// Admin writes are optimistic too: the change is applied locally, POSTed, and
// replaced by the server's full state (or reverted + refetched on failure).

const CACHE_KEY = 'tt-marketing-publications';
const PREVIEW_KEY = 'tt-marketing-preview-as-visitor';
const PUBLIC_ENDPOINT = '/api/v1/marketing/publications';
const ADMIN_ENDPOINT = '/api/v1/admin/marketing/publications';
/** A second consumer mounting within this window reuses the last fetch. */
const FRESH_MS = 15_000;
/** A failed fetch retries on its own (a dev-server rebuild, a flaky network) so a visitor is never stuck. */
const RETRY_DELAYS_MS = [1_500, 3_000, 6_000, 12_000];

export type PublicationsStatus = 'cold' | 'cached' | 'live' | 'error';

export type PublicationsSnapshot = {
	publications: MarketingPublications | null;
	status: PublicationsStatus;
	/** In-flight admin writes. */
	pending: number;
	error: string | null;
};

const SERVER_SNAPSHOT: PublicationsSnapshot = { publications: null, status: 'cold', pending: 0, error: null };

let snapshot: PublicationsSnapshot = SERVER_SNAPSHOT;
let seeded = false;
let lastFetchedAt = 0;
let inflight: Promise<MarketingPublications | null> | null = null;
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

const setSnapshot = (patch: Partial<PublicationsSnapshot>) => {
	snapshot = { ...snapshot, ...patch };
	emit();
};

const seedFromCache = () => {
	if (seeded) return;
	seeded = true;
	const cached = readLocalCache<unknown>(CACHE_KEY);
	if (cached) snapshot = { ...snapshot, publications: normalizePublications(cached), status: 'cached' };
};

const cachePublications = (publications: MarketingPublications) => {
	// the audit trail is admin-only — keep it out of the shared browser cache
	const { audit: _audit, ...publicPart } = publications;
	writeLocalCache(CACHE_KEY, publicPart);
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

const getSnapshot = () => {
	seedFromCache();
	return snapshot;
};

const getServerSnapshot = () => SERVER_SNAPSHOT;

const timed = async (method: 'GET' | 'POST', url: string, init: RequestInit, body?: unknown) => {
	const started = performance.now();
	let response: Response;
	try {
		response = await fetch(url, { ...init, method, credentials: 'include' });
	} catch (error) {
		recordApiCall({ at: Date.now(), method, url, status: 0, ok: false, durationMs: Math.round(performance.now() - started), body });
		throw createApiFailure({ cause: error, action: method === 'GET' ? 'load marketing publishing' : 'update marketing publishing', method });
	}
	recordApiCall({ at: Date.now(), method, url, status: response.status, ok: response.ok, durationMs: Math.round(performance.now() - started), body });
	return response;
};

/** Fetch the current state (deduplicated while in flight). Resolves null on failure. */
export const refreshMarketingPublications = async (options: { force?: boolean } = {}): Promise<MarketingPublications | null> => {
	if (inflight) return inflight;
	if (!options.force && snapshot.status === 'live' && Date.now() - lastFetchedAt < FRESH_MS) return snapshot.publications;
	inflight = (async () => {
		try {
			const response = await timed('GET', PUBLIC_ENDPOINT, { cache: 'no-store', headers: { Accept: 'application/json' } });
			const payload = await readApiResponsePayload(response, { action: 'load marketing publishing', method: 'GET' });
			if (!response.ok || payload?.ok !== true) {
				throw createApiFailure({ payload, status: response.status, retryAfter: response.headers.get('Retry-After'), action: 'load marketing publishing', method: 'GET' });
			}
			const publications = normalizePublications(payload.publications);
			cachePublications(publications);
			lastFetchedAt = Date.now();
			retryAttempt = 0;
			setSnapshot({ publications, status: 'live', error: null });
			return publications;
		} catch (error) {
			// keep whatever is cached; only a cold start turns into an error state
			// (which the visibility resolver treats as "nothing published" — fail
			// closed, never blank) and retry with backoff
			setSnapshot({ status: snapshot.publications ? snapshot.status : 'error', error: error instanceof Error ? error.message : String(error) });
			const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
			if (retryAttempt < RETRY_DELAYS_MS.length && !retryTimer && typeof window !== 'undefined') {
				retryAttempt += 1;
				retryTimer = setTimeout(() => {
					retryTimer = null;
					void refreshMarketingPublications({ force: true });
				}, delay);
			}
			return null;
		} finally {
			inflight = null;
		}
	})();
	return inflight;
};

/** Admin write: optimistic locally, then the server's full state (reverted + refetched on failure). */
export const applyMarketingPublicationChanges = async (changes: PublicationChange[]): Promise<MarketingPublications> => {
	if (!changes.length) return snapshot.publications ?? EMPTY_PUBLICATIONS;
	const previous = snapshot.publications;
	setSnapshot({ publications: applyPublicationChanges(previous ?? EMPTY_PUBLICATIONS, changes), pending: snapshot.pending + 1 });
	try {
		const body = { changes };
		const response = await timed(
			'POST',
			ADMIN_ENDPOINT,
			{ headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
			body
		);
		const payload = await readApiResponsePayload(response, { action: 'update marketing publishing', method: 'POST' });
		if (!response.ok || payload?.ok !== true) {
			throw createApiFailure({ payload, status: response.status, retryAfter: response.headers.get('Retry-After'), action: 'update marketing publishing', method: 'POST' });
		}
		const publications = normalizePublications(payload.publications);
		cachePublications(publications);
		lastFetchedAt = Date.now();
		setSnapshot({ publications, status: 'live', pending: Math.max(0, snapshot.pending - 1), error: null });
		return publications;
	} catch (error) {
		setSnapshot({ publications: previous, pending: Math.max(0, snapshot.pending - 1) });
		void refreshMarketingPublications({ force: true });
		throw error;
	}
};

export const useMarketingPublications = () => {
	const state = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	React.useEffect(() => {
		void refreshMarketingPublications();
		// login/logout re-resolves the root user; refetch so an admin session
		// picks up the audit trail (and a signed-out one drops it)
		const onRootRefresh = () => void refreshMarketingPublications({ force: true });
		window.addEventListener('thingtime:root-data-refresh', onRootRefresh);
		return () => window.removeEventListener('thingtime:root-data-refresh', onRootRefresh);
	}, []);
	return React.useMemo(
		() => ({ ...state, refresh: refreshMarketingPublications, apply: applyMarketingPublicationChanges }),
		[state]
	);
};

// ------------------------------------------------------ preview as visitor
//
// The one admin-facing setting of the feature: an admin can flip to the exact
// visitor view (gates, filtered indexes, hidden sections) without signing out.
// Per browser, remembered across reloads, never sent to the server.

let previewSeeded = false;
let previewAsVisitor = false;
const previewListeners = new Set<() => void>();

const seedPreview = () => {
	if (previewSeeded) return;
	previewSeeded = true;
	previewAsVisitor = readLocalCache<boolean>(PREVIEW_KEY) === true;
};

const subscribePreview = (listener: () => void) => {
	previewListeners.add(listener);
	return () => {
		previewListeners.delete(listener);
	};
};

const getPreview = () => {
	seedPreview();
	return previewAsVisitor;
};

export const setPreviewAsVisitor = (next: boolean) => {
	seedPreview();
	previewAsVisitor = next;
	writeLocalCache(PREVIEW_KEY, next);
	previewListeners.forEach((listener) => listener());
};

export const usePreviewAsVisitor = (): [boolean, (next: boolean) => void] => {
	const value = React.useSyncExternalStore(subscribePreview, getPreview, () => false);
	return [value, setPreviewAsVisitor];
};
