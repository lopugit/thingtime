import React from 'react';

import { createApiFailure, readApiResponsePayload } from '~/hooks/apiFailure';
import { recordApiCall } from '~/hooks/apiRequestLog';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { rootIdentity } from '~/utils/rootIdentity';
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

export type PublicationsStatus = 'cold' | 'cached' | 'live' | 'degraded' | 'error';

export type PublicationsSnapshot = {
	publications: MarketingPublications | null;
	status: PublicationsStatus;
	/** In-flight admin writes. */
	pending: number;
	error: string | null;
	refreshing: boolean;
};

const SERVER_SNAPSHOT: PublicationsSnapshot = { publications: null, status: 'cold', pending: 0, error: null, refreshing: false };

let snapshot: PublicationsSnapshot = SERVER_SNAPSHOT;
let seeded = false;
let generation = 0;
let readEpoch = 0;
let readController: AbortController | null = null;
let rootListenerInstalled = false;
let rootGeneration = rootIdentity.read().generation;
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

export const getMarketingPublicationsSnapshot = () => {
	seedFromCache();
	return snapshot;
};

const getServerSnapshot = () => SERVER_SNAPSHOT;

const timed = async (method: 'GET' | 'POST', url: string, init: RequestInit, body?: unknown) => {
	const started = performance.now();
	const controller = new AbortController();
	const abort = () => controller.abort(init.signal?.reason);
	if (init.signal?.aborted) abort();
	else init.signal?.addEventListener('abort', abort, { once: true });
	// The API's 6s database budget is followed by bounded response/error
	// middleware (8.6s measured end-to-end); leave transport margin for 503.
	const timer = setTimeout(() => controller.abort(new DOMException('Request deadline exceeded', 'TimeoutError')), method === 'GET' ? 12000 : 15000);
	let status = 0;
	try {
		const response = await fetch(url, { ...init, signal: controller.signal, method, credentials: 'include' });
		status = response.status;
		// Keep the signal alive until the body is consumed, not just headers.
		const payload = await readApiResponsePayload(response, { action: method === 'GET' ? 'load marketing publishing' : 'update marketing publishing', method });
		recordApiCall({ at: Date.now(), method, url, status, ok: response.ok, durationMs: Math.round(performance.now() - started), body });
		return { response, payload };
	} catch (error) {
		recordApiCall({ at: Date.now(), method, url, status, ok: false, durationMs: Math.round(performance.now() - started), body });
		throw createApiFailure({ cause: error, status: status || undefined, action: method === 'GET' ? 'load marketing publishing' : 'update marketing publishing', method });
	} finally {
		clearTimeout(timer);
		init.signal?.removeEventListener('abort', abort);
	}
};

// A write invalidates all earlier reads even when the account stays the same.
// Abort the real transfer, then fence transports that complete despite abort.
const invalidatePublicationReads = () => {
	readEpoch += 1;
	readController?.abort();
	readController = null;
	inflight = null;
	if (retryTimer) clearTimeout(retryTimer);
	retryTimer = null;
};

// Clear session-only audit before a new identity renders, and fence all old
// completions. Public publication lists are shared by design on this origin.
export const resetMarketingPublicationsIdentity = () => {
	generation += 1;
	invalidatePublicationReads();
	retryAttempt = 0;
	lastFetchedAt = 0;
	const publications = snapshot.publications ? normalizePublications({ ...snapshot.publications, audit: undefined }) : null;
	setSnapshot({ publications, status: publications ? 'cached' : 'cold', error: null, pending: 0, refreshing: false });
};

/** Fetch the current state (deduplicated while in flight). Resolves null on failure. */
export const refreshMarketingPublications = async (options: { force?: boolean } = {}): Promise<MarketingPublications | null> => {
	seedFromCache();
	if (rootIdentity.read().pending || snapshot.pending > 0) return null;
	if (inflight) return inflight;
	if (!options.force && snapshot.status === 'live' && Date.now() - lastFetchedAt < FRESH_MS) return snapshot.publications;
	const requestGeneration = generation;
	const requestReadEpoch = readEpoch;
	const isCurrentRead = () => requestGeneration === generation && requestReadEpoch === readEpoch;
	const controller = new AbortController();
	readController = controller;
	setSnapshot({ refreshing: true });
	inflight = (async () => {
		try {
			const { response, payload } = await timed('GET', PUBLIC_ENDPOINT, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
			if (!isCurrentRead()) return null;
			if (response.status === 503 && payload?.ok === false && payload?.freshness === 'stale' && payload?.publications) {
				const { audit: _audit, ...publicPart } = normalizePublications(payload.publications);
				setSnapshot({ publications: publicPart, status: 'degraded', error: 'Marketing publishing is temporarily unavailable' });
			}
			if (!response.ok || payload?.ok !== true) {
				throw createApiFailure({ payload, status: response.status, retryAfter: response.headers.get('Retry-After'), action: 'load marketing publishing', method: 'GET' });
			}
			const publications = normalizePublications(payload.publications);
			cachePublications(publications);
			lastFetchedAt = Date.now();
			retryAttempt = 0;
			if (retryTimer) clearTimeout(retryTimer);
			retryTimer = null;
			setSnapshot({ publications, status: 'live', error: null });
			return publications;
		} catch (error) {
			if (!isCurrentRead()) return null;
			// keep whatever is cached; only a cold start turns into an error state
			// (which the visibility resolver treats as "nothing published" — fail
			// closed, never blank) and retry with backoff
			const publications = snapshot.publications ? normalizePublications({ ...snapshot.publications, audit: undefined }) : null;
			setSnapshot({ publications, status: publications ? 'degraded' : 'error', error: error instanceof Error ? error.message : String(error) });
			const retryAfterSeconds = Number((error as { retryAfterSeconds?: number })?.retryAfterSeconds) || 0;
			const delay = Math.max(RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)], retryAfterSeconds * 1000);
			if (retryAttempt < RETRY_DELAYS_MS.length && !retryTimer && typeof window !== 'undefined') {
				retryAttempt += 1;
				retryTimer = setTimeout(() => {
					retryTimer = null;
					if (isCurrentRead()) void refreshMarketingPublications({ force: true });
				}, delay);
			}
			return null;
		} finally {
			if (isCurrentRead()) { inflight = null; readController = null; setSnapshot({ refreshing: false }); }
		}
	})();
	return inflight;
};

/** Admin write: optimistic locally, then the server's full state (reverted + refetched on failure). */
export const applyMarketingPublicationChanges = async (changes: PublicationChange[]): Promise<MarketingPublications> => {
	seedFromCache();
	if (!changes.length) return snapshot.publications ?? EMPTY_PUBLICATIONS;
	const requestGeneration = generation;
	const previous = snapshot.publications;
	invalidatePublicationReads();
	setSnapshot({ publications: applyPublicationChanges(previous ?? EMPTY_PUBLICATIONS, changes), pending: snapshot.pending + 1, refreshing: false });
	try {
		const body = { changes };
		const { response, payload } = await timed(
			'POST',
			ADMIN_ENDPOINT,
			{ headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
			body
		);
		if (requestGeneration !== generation) throw new Error('Account changed while publishing');
		if (!response.ok || payload?.ok !== true) {
			throw createApiFailure({ payload, status: response.status, retryAfter: response.headers.get('Retry-After'), action: 'update marketing publishing', method: 'POST' });
		}
		invalidatePublicationReads();
		if (payload.freshness && payload.freshness !== 'live') {
			// The write committed; a failed verification read must not roll it
			// back or replace useful optimistic state with invented emptiness.
			const publications = snapshot.publications ?? EMPTY_PUBLICATIONS;
			setSnapshot({ status: 'degraded', pending: Math.max(0, snapshot.pending - 1), error: 'Changes saved; publication status is temporarily unavailable' });
			void refreshMarketingPublications({ force: true });
			return publications;
		}
		const publications = normalizePublications(payload.publications);
		cachePublications(publications);
		lastFetchedAt = Date.now();
		setSnapshot({ publications, status: 'live', pending: Math.max(0, snapshot.pending - 1), error: null });
		return publications;
	} catch (error) {
		if (requestGeneration !== generation) throw error;
		invalidatePublicationReads();
		setSnapshot({ publications: previous, pending: Math.max(0, snapshot.pending - 1) });
		void refreshMarketingPublications({ force: true });
		throw error;
	}
};

export const useMarketingPublications = () => {
	const state = React.useSyncExternalStore(subscribe, getMarketingPublicationsSnapshot, getServerSnapshot);
	React.useEffect(() => {
		void refreshMarketingPublications();
		// login/logout re-resolves the root user; refetch so an admin session
		// picks up the audit trail (and a signed-out one drops it)
		if (!rootListenerInstalled) {
			rootListenerInstalled = true;
			rootIdentity.subscribe(() => {
				const identity = rootIdentity.read();
				if (identity.generation !== rootGeneration) {
					rootGeneration = identity.generation;
					resetMarketingPublicationsIdentity();
				}
				if (!identity.pending) void refreshMarketingPublications({ force: true });
			});
			window.addEventListener('thingtime:root-data-refresh', () => {
				if (!rootIdentity.read().pending) void refreshMarketingPublications({ force: true });
			});
		}
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
