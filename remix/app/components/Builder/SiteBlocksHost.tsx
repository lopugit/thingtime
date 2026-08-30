import React from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useThingtime } from '../Thingtime/useThingtime';
import { DRAWER_HOVER_Z } from '../Nav/Drawer/useDrawer';
import { PAGE_TOP_CLEARANCE } from '../Layout/PageShell';
import { WebpageBlocksRenderer, type ComponentsByRef } from './WebpageBlocksRenderer';
import { BuilderDrawer, BUILDER_DRAWER_WIDTH } from './BuilderDrawer';
import { useBuilderChrome } from './useBuilderChrome';
import { resolveWebpageClient, useWebpageDraft, type ResolvedWebpage } from './useWebpage';
import type { WebpageBlock } from './webpageBlocks';

// Every Thingtime page is a block-based site: this host (mounted once in
// root.tsx around the route Outlet) resolves the webpage doc bound to the
// current route (the viewer's personalised fork outranks the seeded system
// default) and renders its extra blocks around the native app screen, plus
// the site-global blocks that render on EVERY page. Global blocks respect
// navigation rules: they live above the route swap, their doc is fetched
// once and memoised, so client navigation never re-renders or refetches
// them. The ✏️ pill enters site edit mode — the same builder grammar as
// /builder (hover boundaries, inline + add block, drag/drop, right drawer)
// operating on THIS page; saving forks into a viewer-owned twin.

// Session cache so view-mode navigation renders instantly from last-known
// state and reconciles in the background (optimistic-render house rule).
const routeCache = new Map<string, ResolvedWebpage | null>();

const normalizePath = (pathname: string): string => {
	const trimmed = pathname.replace(/\/+$/, '');
	return trimmed || '/';
};

// Surfaces that are not site pages (they ARE builder/page surfaces or
// chrome-less popups) — no blocks, no edit pill.
const isExcludedPath = (path: string): boolean =>
	path === '/authorize' || path === '/builder' || path.startsWith('/p/') || path.startsWith('/rainbow/');

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
	interactive,
	compensateClearance
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
			paddingTop={PAGE_TOP_CLEARANCE}
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

const useGlobalBlocks = (enabled: boolean): ResolvedWebpage | null => {
	const [state, setState] = React.useState<ResolvedWebpage | null>(globalCache);
	React.useEffect(() => {
		if (!enabled || globalFetched) return;
		globalFetched = true;
		(async () => {
			globalCache = await resolveWebpageClient({ kind: 'global' });
			setState(globalCache);
		})();
	}, [enabled]);
	// in-place refresh when a site-global save happens while a page view is
	// mounted (saves from the in-page edit mode)
	React.useEffect(() => {
		const onSaved = (event: Event) => {
			const detail = (event as CustomEvent).detail as { pageKey?: string | null } | undefined;
			if (detail?.pageKey !== 'site-global') return;
			(async () => {
				globalCache = await resolveWebpageClient({ kind: 'global' });
				setState(globalCache);
			})();
		};
		window.addEventListener('thingtime:webpage-saved', onSaved);
		return () => window.removeEventListener('thingtime:webpage-saved', onSaved);
	}, []);
	return state;
};

const EditPill = ({ active, onToggle }: { active: boolean; onToggle: () => void }) => (
	<Flex
		as="button"
		aria-label={active ? 'Exit site edit mode' : 'Edit this page'}
		data-testid="site-edit-pill"
		position="fixed"
		left="14px"
		bottom="14px"
		zIndex={DRAWER_HOVER_Z}
		alignItems="center"
		columnGap="7px"
		fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
		fontSize="12px"
		fontWeight={700}
		paddingX="12px"
		paddingY="9px"
		borderRadius="var(--tt-radius-pill, 999px)"
		border="1px solid"
		borderColor={active ? 'var(--tt-accent, hotpink)' : 'var(--tt-border, #ececef)'}
		background={active ? 'var(--tt-accent, hotpink)' : 'var(--tt-card, #ffffff)'}
		color={active ? 'var(--tt-accent-contrast, #ffffff)' : 'var(--tt-ink, #16161a)'}
		boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
		cursor="pointer"
		_hover={{ transform: 'translateY(-1px)' }}
		transition="transform 0.12s ease"
		onClick={onToggle}
	>
		{active ? '✕ Done' : '✏️ Edit page'}
	</Flex>
);

// ——— view mode: cached resolve, zero chrome ————————————————————————————

const SiteBlocksView = ({ path, children }: { path: string; children: React.ReactNode }) => {
	const user = useCurrentUser();
	const [resolved, setResolved] = React.useState<ResolvedWebpage | null>(() => routeCache.get(path) ?? null);

	React.useEffect(() => {
		setResolved(routeCache.get(path) ?? null);
		// only signed-in viewers can have personalised docs; the system defaults
		// are single-native (nothing extra to draw), so anonymous view skips the
		// fetch entirely
		if (!user?.id) return;
		let cancelled = false;
		(async () => {
			const data = await resolveWebpageClient({ kind: 'path', path });
			if (!cancelled) {
				routeCache.set(path, data);
				setResolved(data);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [path, user?.id]);

	const globalResolved = useGlobalBlocks(!!user?.id);
	const globalBlocks = (globalResolved?.page?.crystal?.blocks as WebpageBlock[]) || [];
	const globalComponents = globalResolved?.componentsByRef || {};

	const blocks = (resolved?.source === 'user' ? (resolved?.page?.crystal?.blocks as WebpageBlock[]) : null) || [];
	const { before, after } = splitAroundNative(blocks);
	const componentsByRef = resolved?.componentsByRef || {};
	const hasInjectedAbove = globalBlocks.length > 0 || before.length > 0;

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

// ——— edit mode: the full builder grammar on the live page ————————————————

const SiteBlocksEditor = ({ path, children, onDone }: { path: string; children: React.ReactNode; onDone: () => void }) => {
	const draft = useWebpageDraft(React.useMemo(() => ({ kind: 'path' as const, path }), [path]));
	const { chrome, selectedId, deselect, insertMenu } = useBuilderChrome(draft);
	const [pageName, setPageName] = React.useState('');
	const namedForRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		const page = draft.resolved?.page;
		if (page && namedForRef.current !== page.id) {
			namedForRef.current = page.id;
			setPageName(page.crystal?.name || 'This page');
		}
	}, [draft.resolved]);

	// Unseeded deployment (no system site doc yet): start the draft with the
	// locked native block so the live screen stays visible and positionable —
	// otherwise the fork would have no marker and every block could only land
	// below the page.
	const seededEmptyRef = React.useRef(false);
	React.useEffect(() => {
		if (draft.loading || draft.resolved?.page || draft.blocks.length || seededEmptyRef.current) return;
		seededEmptyRef.current = true;
		const key = path === '/' ? 'home' : path.slice(1).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
		draft.setBlocks([{ id: `native-${key}`, type: 'native', native: key }]);
		if (!pageName) setPageName('This page');
		// eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot seeding keyed on resolve state
	}, [draft.loading, draft.resolved, draft.blocks.length, path]);

	// keep the view cache fresh so leaving edit mode shows what was saved
	React.useEffect(() => {
		return () => {
			routeCache.delete(path);
		};
	}, [path]);

	const renderNative = React.useCallback(() => <Box width="100%">{children}</Box>, [children]);

	return (
		<>
			<Box width="100%" paddingRight={[0, `${BUILDER_DRAWER_WIDTH}px`]} paddingTop={PAGE_TOP_CLEARANCE} background="var(--tt-surface, #fafafb)">
				<Box maxWidth="1100px" marginX="auto" paddingX={4} paddingY={4} whiteSpace="normal">
					<WebpageBlocksRenderer
						blocks={draft.blocks}
						componentsByRef={draft.componentsByRef}
						chrome={chrome}
						renderNative={renderNative}
					/>
				</Box>
			</Box>
			<BuilderDrawer
				title={`Site page · ${path}`}
				draft={draft}
				selectedId={selectedId}
				onDeselect={deselect}
				onClose={onDone}
				mode="site"
				pageName={pageName}
				onPageName={setPageName}
				isPublic={false}
				onIsPublic={() => {}}
			/>
			{insertMenu}
		</>
	);
};

export const SiteBlocksHost = ({ children }: { children: React.ReactNode }) => {
	const { pathname } = useLocation();
	const user = useCurrentUser();
	const { thingtime, setThingtime } = useThingtime();
	const path = normalizePath(pathname);
	const excluded = isExcludedPath(path);

	const editMode = !!thingtime?.settings?.builder?.editMode;
	const toggleEditMode = React.useCallback(() => {
		setThingtime?.('settings.builder.editMode', !editMode, { ignoreUndoRedo: true, namespace: 'builder' });
	}, [editMode, setThingtime]);

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

	return (
		<>
			{editMode && user?.id ? (
				<SiteBlocksEditor key={path} path={path} onDone={toggleEditMode}>
					{children}
				</SiteBlocksEditor>
			) : (
				<SiteBlocksView path={path}>{children}</SiteBlocksView>
			)}
			{user?.id ? <EditPill active={editMode} onToggle={toggleEditMode} /> : null}
		</>
	);
};
