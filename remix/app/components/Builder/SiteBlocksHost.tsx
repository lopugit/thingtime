import React from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { PAGE_TOP_CLEARANCE, PageShell } from '../Layout/PageShell';
import {
	blocksAreFullySectioned,
	getNativePageByRoute,
	getNativeSection,
	NativeSectionView
} from './nativeSections';
import { WebpageBlocksRenderer, type ComponentsByRef } from './WebpageBlocksRenderer';
import { resolveWebpageClient, type ResolvedWebpage } from './useWebpage';
import type { WebpageBlock } from './webpageBlocks';

// Every Thingtime page is a block-based site: this host (mounted once in
// root.tsx around the route Outlet) resolves the webpage doc bound to the
// current route (the viewer's personalised fork outranks the seeded system
// default) and renders its extra blocks around the native app screen, plus
// the site-global blocks that render on EVERY page. Global blocks respect
// navigation rules: they live above the route swap, their doc is fetched
// once and memoised, so client navigation never re-renders or refetches
// them. Editing stays on /builder; ordinary pages always render view mode.

// Session cache so view-mode navigation renders instantly from last-known
// state and reconciles in the background (optimistic-render house rule).
const routeCache = new Map<string, ResolvedWebpage | null>();

// Personalised docs belong to ONE account — logout or account switch must
// drop them or the previous user's blocks keep rendering from cache.
let cacheOwnerId: string | null = null;
const ensureCacheOwner = (userId: string | null) => {
	if (cacheOwnerId === userId) return;
	cacheOwnerId = userId;
	routeCache.clear();
	globalCache = null;
	globalFetched = false;
};

const normalizePath = (pathname: string): string => {
	const trimmed = pathname.replace(/\/+$/, '');
	return trimmed || '/';
};

// Surfaces that are not site pages (they ARE builder/page surfaces or
// chrome-less popups) — no blocks, no edit pill.
const isExcludedPath = (path: string): boolean =>
	path === '/authorize' ||
	path === '/builder' ||
	// the Lopu page and its voice / conversation routes are the assistant, not a site page
	path === '/lopu' ||
	path.startsWith('/lopu/') ||
	path === '/settings' ||
	path.startsWith('/p/') ||
	path.startsWith('/rainbow/');

const splitAroundNative = (blocks: WebpageBlock[]): { before: WebpageBlock[]; after: WebpageBlock[] } => {
	const nativeIndex = blocks.findIndex((block) => block.type === 'native');
	if (nativeIndex === -1) return { before: [], after: blocks };
	return { before: blocks.slice(0, nativeIndex), after: blocks.slice(nativeIndex + 1) };
};

// Global blocks — fetched once per session, rendered through React.memo with
// stable props so route swaps leave them untouched.
const GlobalBlocks = React.memo(function GlobalBlocks({
	blocks,
	componentsByRef,
	interactive
}: {
	blocks: WebpageBlock[];
	componentsByRef: ComponentsByRef;
	interactive: boolean;
}) {
	if (!blocks.length) return null;
	return (
		<Box
			className="ttGlobalBlocks"
			width="100%"
			// the nav clearance alone puts content flush against the navbar —
			// global blocks get an extra breath of air below it
			paddingTop={`calc(${PAGE_TOP_CLEARANCE} + 14px)`}
			paddingX={4}
			background="var(--tt-surface, #fafafb)"
		>
			<Box maxWidth="960px" marginX="auto" whiteSpace="normal">
				<WebpageBlocksRenderer blocks={blocks} componentsByRef={componentsByRef} interactive={interactive} />
			</Box>
		</Box>
	);
});

let globalFetched = false;
let globalCache: ResolvedWebpage | null = null;

// The resolved doc is stamped with the account it was fetched for. Clearing
// the module cache is not enough on its own: this state survives a logout
// (the host swaps no component), and a signed-out viewer never refetches to
// correct it — so an unstamped value would render the previous account's
// global blocks on every page for the rest of the tab session.
type GlobalEntry = { owner: string | null; data: ResolvedWebpage | null };

// `retryKey` is the current path: only the EDITOR is keyed by path, so this
// hook never remounts on navigation. Keyed on `enabled` alone the effect would
// fire only on sign-in/out, and every later clearing of `globalFetched` — the
// failed resolve below, or an account switch through ensureCacheOwner — would
// have nothing left to act on, hiding global blocks for the rest of the tab
// session. Re-running per navigation is free: a settled fetch short-circuits.
const useGlobalBlocks = (enabled: boolean, retryKey: string): ResolvedWebpage | null => {
	const [entry, setEntry] = React.useState<GlobalEntry>(() => ({ owner: cacheOwnerId, data: globalCache }));
	React.useEffect(() => {
		if (!enabled || globalFetched) return;
		globalFetched = true;
		(async () => {
			const resolved = await resolveWebpageClient({ kind: 'global' });
			// null is a FAILED resolve (a doc-less success still returns a
			// result) — clear the flag so the next navigation retries instead
			// of hiding global blocks for the whole session
			if (resolved === null) {
				globalFetched = false;
				return;
			}
			globalCache = resolved;
			setEntry({ owner: cacheOwnerId, data: resolved });
		})();
	}, [enabled, retryKey]);
	// in-place refresh when a site-global save happens while a page view is
	// mounted (saves from the in-page edit mode)
	React.useEffect(() => {
		const onSaved = (event: Event) => {
			const detail = (event as CustomEvent).detail as { pageKey?: string | null } | undefined;
			if (detail?.pageKey !== 'site-global') return;
			(async () => {
				globalCache = await resolveWebpageClient({ kind: 'global' });
				setEntry({ owner: cacheOwnerId, data: globalCache });
			})();
		};
		window.addEventListener('thingtime:webpage-saved', onSaved);
		return () => window.removeEventListener('thingtime:webpage-saved', onSaved);
	}, []);
	// ensureCacheOwner runs in the host's RENDER phase, so cacheOwnerId is
	// already the current account here — a stale stamp means "not mine".
	return entry.owner === cacheOwnerId ? entry.data : null;
};


// ——— view mode: cached resolve, zero chrome ————————————————————————————

const SiteBlocksView = ({ path, children }: { path: string; children: React.ReactNode }) => {
	const user = useCurrentUser();
	// The resolve is stamped with the path it belongs to and reconciled in the
	// RENDER phase. `path` changes a whole render before any effect can reset
	// state, and a fully sectioned doc REPLACES the route element rather than
	// wrapping it — so reading last-render state directly would draw the
	// PREVIOUS route's composition, with the newly navigated-to page missing
	// entirely, for a frame on every navigation away from a sectioned page
	// (/, /status, /welcome, /ode, /mongodb-status once seeded).
	const [entry, setEntry] = React.useState<{ path: string; data: ResolvedWebpage | null }>(() => ({
		path,
		data: routeCache.get(path) ?? null
	}));
	const resolved = entry.path === path ? entry.data : (routeCache.get(path) ?? null);

	React.useEffect(() => {
		// only signed-in viewers can have personalised docs; the system defaults
		// are single-native (nothing extra to draw), so anonymous view skips the
		// fetch entirely
		if (!user?.id) return;
		let cancelled = false;
		(async () => {
			const data = await resolveWebpageClient({ kind: 'path', path });
			if (cancelled) return;
			// null is a FAILED resolve (offline, rate limited, a 5xx) — a
			// doc-less success still returns a result. Same rule useGlobalBlocks
			// applies to its cache: a failure must never EVICT good last-known
			// state, or one flaky request blanks the viewer's own blocks (and,
			// on a sectioned page, the whole doc-driven composition) until the
			// next navigation back to this path.
			if (data === null && routeCache.has(path)) return;
			routeCache.set(path, data);
			setEntry({ path, data });
		})();
		return () => {
			cancelled = true;
		};
	}, [path, user?.id]);

	const globalResolved = useGlobalBlocks(!!user?.id, path);
	const globalBlocks = (globalResolved?.page?.crystal?.blocks as WebpageBlock[]) || [];
	const globalComponents = globalResolved?.componentsByRef || {};

	const docBlocks = (resolved?.page?.crystal?.blocks as WebpageBlock[]) || [];
	// Fully sectioned docs (every native block is a registered section) render
	// the whole composition doc-driven — ordering/insertions/removals from the
	// viewer's fork apply, sections are pixel-identical to the route's own
	// render, and the route element is not mounted (one render, one truth).
	const sectioned = docBlocks.length > 0 && blocksAreFullySectioned(docBlocks);
	const sectionedPage = sectioned ? getNativeSection((docBlocks.find((block) => block.type === 'native') as WebpageBlock).native || '')?.page : null;

	const blocks = (resolved?.source === 'user' ? (resolved?.page?.crystal?.blocks as WebpageBlock[]) : null) || [];
	const { before, after } = splitAroundNative(blocks);
	const componentsByRef = resolved?.componentsByRef || {};
	const hasInjectedAbove = globalBlocks.length > 0 || before.length > 0;

	if (sectioned && sectionedPage) {
		const shellWidth = sectionedPage.shellWidth;
		const PageOwnShell = sectionedPage.Shell;
		const composition = (
			<WebpageBlocksRenderer
				blocks={docBlocks}
				componentsByRef={componentsByRef}
				interactive={resolved?.source === 'user'}
				renderNative={(key) => <NativeSectionView sectionKey={key} />}
				bare
			/>
		);
		return (
			<>
				<GlobalBlocks blocks={globalBlocks} componentsByRef={globalComponents} interactive={globalResolved?.source === 'user'} />
				<Box width="100%" whiteSpace="normal" sx={globalBlocks.length ? { '--tt-nav-clearance': '12px' } : undefined}>
					{shellWidth === 'full' ? (
						PageOwnShell ? (
							// full-bleed pages keep their page-owned chrome (background,
							// clearance, centering) in doc-driven renders too
							<React.Suspense fallback={null}>
								<PageOwnShell>{composition}</PageOwnShell>
							</React.Suspense>
						) : (
							composition
						)
					) : (
						<PageShell width={shellWidth}>{composition}</PageShell>
					)}
				</Box>
			</>
		);
	}

	return (
		<>
			<GlobalBlocks blocks={globalBlocks} componentsByRef={globalComponents} interactive={globalResolved?.source === 'user'} />
			{before.length ? (
				<Box width="100%" paddingTop={globalBlocks.length ? 4 : PAGE_TOP_CLEARANCE} paddingX={4} background="var(--tt-surface, #fafafb)">
					<Box maxWidth="960px" marginX="auto" whiteSpace="normal">
						<WebpageBlocksRenderer blocks={before} componentsByRef={componentsByRef} interactive />
					</Box>
				</Box>
			) : null}
			{hasInjectedAbove ? (
				// content already starts below the fixed nav, so the page's own
				// clearance would be pure gap — shrink it for the whole subtree
				<Box width="100%" sx={{ '--tt-nav-clearance': '12px' }}>
					{children}
				</Box>
			) : (
				children
			)}
			{after.length ? (
				<Box width="100%" paddingBottom={8} paddingX={4} background="var(--tt-surface, #fafafb)">
					<Box maxWidth="960px" marginX="auto" whiteSpace="normal">
						<WebpageBlocksRenderer blocks={after} componentsByRef={componentsByRef} interactive />
					</Box>
				</Box>
			) : null}
		</>
	);
};

export const SiteBlocksHost = ({ children }: { children: React.ReactNode }) => {
	const { pathname } = useLocation();
	const user = useCurrentUser();
	const path = normalizePath(pathname);
	const excluded = isExcludedPath(path);

	// Personalised caches are per-account, checked in the RENDER phase rather
	// than an effect: React runs child effects BEFORE parent effects, so an
	// effect here would drop the caches only after the view below had already
	// read the previous account's entries — and a signed-out viewer never
	// refetches, so those blocks would keep rendering for the whole session.
	// ensureCacheOwner is idempotent module bookkeeping (no state, no render
	// output), so calling it here is safe under StrictMode double-render.
	ensureCacheOwner(user?.id || null);

	// Always-mounted invalidation (the /builder canvas saves while no page
	// view is mounted): any webpage save clears the module caches so the next
	// navigation refetches fresh state.
	React.useEffect(() => {
		const onSaved = (event: Event) => {
			const detail = (event as CustomEvent).detail as { pageKey?: string | null; siteRoute?: string | null } | undefined;
			if (detail?.pageKey === 'site-global') {
				globalFetched = false;
				globalCache = null;
			}
			if (detail?.siteRoute) routeCache.delete(detail.siteRoute);
		};
		window.addEventListener('thingtime:webpage-saved', onSaved);
		return () => window.removeEventListener('thingtime:webpage-saved', onSaved);
	}, []);

	if (excluded) return <>{children}</>;

	return <SiteBlocksView path={path}>{children}</SiteBlocksView>;
};
