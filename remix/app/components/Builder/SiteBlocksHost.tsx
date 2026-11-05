import { WebpageRuntimeProvider } from './webpageRuntime';
import { siteBlocksExcluded } from '~/schemas/sitePages';
import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useLocation } from 'react-router';

import { workspaceStorageBinding, workspaceStorageIdentity, subscribeWorkspaceStorage } from '~/local-workspace/storageStatus.client';
import { LOCAL_WORKSPACE_CHANGED } from '~/local-workspace/runtime.client';
import { createSiteBlocksCache } from './siteBlocksCache';
import { PAGE_TOP_CLEARANCE, PageShell } from '../Layout/PageShell';
import {
	blocksAreFullySectioned,
	getNativeSection,
	NativeSectionView
} from './nativeSections';
import { WebpageBlocksRenderer, type ComponentsByRef } from './WebpageBlocksRenderer';
import { loadWebpageClient, type ResolvedWebpage } from './useWebpage';
import type { WebpageBlock } from './webpageBlocks';

// Every Thingtime page is a block-based site: this host (mounted once in
// root.tsx around the route Outlet) resolves the webpage doc bound to the
// current route (the viewer's personalised fork outranks the seeded system
// default) and renders its extra blocks around the native app screen, plus
// the site-global blocks that render on EVERY page. Global blocks respect
// navigation rules: they live above the route swap, their doc is fetched
// once and memoised, so client navigation never re-renders or refetches
// them. Editing stays on /builder; ordinary pages always render view mode.

const normalizePath = (pathname: string): string => {
	const trimmed = pathname.replace(/\/+$/, '');
	return trimmed || '/';
};

const splitAroundNative = (blocks: WebpageBlock[]): { before: WebpageBlock[]; after: WebpageBlock[] } => {
	const nativeIndex = blocks.findIndex((block) => block.type === 'native');
	if (nativeIndex === -1) return { before: [], after: blocks };
	return { before: blocks.slice(0, nativeIndex), after: blocks.slice(nativeIndex + 1) };
};

const SitePageRuntime = ({ resolved, children }: { resolved: ResolvedWebpage | null; children: React.ReactNode }) => (
 <WebpageRuntimeProvider suiteKey={resolved?.page?.crystal?.suiteKey || null} enabled={resolved?.source === 'user'} pageId={resolved?.page?.id || null} pageKey={resolved?.page?.crystal?.pageKey || null} source={resolved?.source || null}>
  {children}
 </WebpageRuntimeProvider>
);

// Global blocks — fetched once per session, rendered through React.memo with
// stable props so route swaps leave them untouched.
const GlobalBlocks = React.memo(function GlobalBlocks({
	blocks,
	componentsByRef,
	interactive,
	navCleared = false,
 resolved
}: {
	blocks: WebpageBlock[];
	componentsByRef: ComponentsByRef;
	interactive: boolean;
	navCleared?: boolean;
 resolved: ResolvedWebpage | null;
}) {
	if (!blocks.length) return null;
	return (
		<Box
			className="ttGlobalBlocks"
			width="100%"
			// the nav clearance alone puts content flush against the navbar —
			// global blocks get an extra breath of air below it
			paddingTop={navCleared ? 4 : `calc(${PAGE_TOP_CLEARANCE} + 14px)`}
			paddingX={4}
			background="var(--tt-surface, #fafafb)"
		>
			<Box maxWidth="960px" marginX="auto" whiteSpace="normal">
				<SitePageRuntime resolved={resolved}><WebpageBlocksRenderer blocks={blocks} componentsByRef={componentsByRef} interactive={interactive} /></SitePageRuntime>
			</Box>
		</Box>
	);
});

type SiteCache = ReturnType<typeof createSiteBlocksCache<ResolvedWebpage>>;
type SiteBinding = NonNullable<ReturnType<typeof workspaceStorageBinding>>;
const useSiteResource = (cache: SiteCache, binding: SiteBinding, key: string, target: Parameters<typeof loadWebpageClient>[0], revision: number, retryKey: string) => {
 const state = React.useSyncExternalStore(cache.subscribe, () => cache.read(key), () => cache.read(key));
 const targetKey = JSON.stringify(target);
 React.useEffect(() => {
  if (key === 'global' && cache.fresh(key)) return;
  void cache.load(key, async () => {
   const result = await loadWebpageClient(JSON.parse(targetKey));
   return result.status === 'ready' ? result.data : result.status === 'missing' ? { page: null, source: null, componentsByRef: {} } : null;
  }, binding.lease.assertCurrent);
 }, [cache, binding, key, targetKey, revision, retryKey]);
 return state;
};

// ——— view mode: cached resolve, zero chrome ————————————————————————————

const SiteBlocksView = ({ path, children, cache, binding, revision, refresh }: { path: string; children: React.ReactNode; cache: SiteCache; binding: SiteBinding; revision: number; refresh: () => void }) => {
 const route = useSiteResource(cache, binding, path, { kind: 'path', path }, revision, path);
 const global = useSiteResource(cache, binding, 'global', { kind: 'global' }, revision, path);
 const resolved = route.data, globalResolved = global.data;
 const failure = route.error || global.error ? (
  <Box width="100%" paddingTop={PAGE_TOP_CLEARANCE} paddingX={4} background="var(--tt-surface, #fafafb)" whiteSpace="normal">
   <Flex role="alert" gap={2} wrap="wrap" align="center" maxWidth="960px" marginX="auto" paddingY={4}>
    <Text>Could not refresh your page blocks. Your last loaded version is still available.</Text>
    <Button size="sm" onClick={refresh}>Retry page blocks</Button>
   </Flex>
  </Box>
 ) : null;
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
	const hasInjectedAbove = Boolean(failure) || globalBlocks.length > 0 || before.length > 0;

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
			<SitePageRuntime resolved={resolved}>
				{failure}
				<GlobalBlocks resolved={globalResolved} blocks={globalBlocks} componentsByRef={globalComponents} interactive={globalResolved?.source === 'user'} navCleared={Boolean(failure)} />
				<Box width="100%" whiteSpace="normal" sx={failure || globalBlocks.length ? { '--tt-nav-clearance': '12px' } : undefined}>
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
			</SitePageRuntime>
		);
	}

	return (
		<SitePageRuntime resolved={resolved}>
			{failure}
				<GlobalBlocks resolved={globalResolved} blocks={globalBlocks} componentsByRef={globalComponents} interactive={globalResolved?.source === 'user'} navCleared={Boolean(failure)} />
			{before.length ? (
				<Box width="100%" paddingTop={failure || globalBlocks.length ? 4 : PAGE_TOP_CLEARANCE} paddingX={4} background="var(--tt-surface, #fafafb)">
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
		</SitePageRuntime>
	);
};

export const SiteBlocksHost = ({ children }: { children: React.ReactNode }) => {
 const identity = React.useSyncExternalStore(subscribeWorkspaceStorage, workspaceStorageIdentity, () => '');
 return identity ? <SiteBlocksWorkspace key={identity}>{children}</SiteBlocksWorkspace> : <>{children}</>;
};
const SiteBlocksWorkspace = ({ children }: { children: React.ReactNode }) => {
 const { pathname } = useLocation();
 const [cache] = React.useState(() => createSiteBlocksCache<ResolvedWebpage>());
 const [binding] = React.useState(() => workspaceStorageBinding()!);
 const [revision, setRevision] = React.useState(0);
 const refresh = React.useCallback(() => { cache.invalidate(); setRevision(value => value + 1); }, [cache]);
 React.useEffect(() => {
  window.addEventListener('thingtime:webpage-saved', refresh);
  window.addEventListener(LOCAL_WORKSPACE_CHANGED, refresh);
  return () => {
   window.removeEventListener('thingtime:webpage-saved', refresh);
   window.removeEventListener(LOCAL_WORKSPACE_CHANGED, refresh);
   // Responses assert the captured lease; obsolete workspace caches cannot
   // accept a late result and are released with this component instance.
  };
 }, [refresh]);
 const path = normalizePath(pathname);
 if (siteBlocksExcluded(path)) return <>{children}</>;
 return <SiteBlocksView path={path} cache={cache} binding={binding} revision={revision} refresh={refresh}>{children}</SiteBlocksView>;
};
