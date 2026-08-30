import React from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useThingtime } from '../Thingtime/useThingtime';
import { DRAWER_HOVER_Z } from '../Nav/Drawer/useDrawer';
import { PAGE_TOP_CLEARANCE } from '../Layout/PageShell';
import { WebpageBlocksRenderer, type ComponentsByRef } from './WebpageBlocksRenderer';
import { BuilderDrawer, BUILDER_DRAWER_WIDTH, InspectorReopenPill } from './BuilderDrawer';
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

// The in-place site editor — the PRIMARY builder surface (limitless: every
// page, full-bleed). The page renders exactly as its normal full-width self;
// block chrome (boundaries, insert zones, drag/drop) overlays it, and the
// right drawer appears. TWO regions edit together through one drawer:
//   🌐 global — the site-global doc, blocks on every page
//   this page — the route's doc, with the live screen as its native block
// Saving persists whichever drafts are dirty (each as the viewer's own fork).
const SiteBlocksEditor = ({ path, children, onDone }: { path: string; children: React.ReactNode; onDone: () => void }) => {
	const pageDraft = useWebpageDraft(React.useMemo(() => ({ kind: 'path' as const, path }), [path]));
	const globalDraft = useWebpageDraft(React.useMemo(() => ({ kind: 'global' as const }), []));
	const pageChrome = useBuilderChrome(pageDraft);
	const globalChrome = useBuilderChrome(globalDraft);
	const [pageName, setPageName] = React.useState('');
	const namedForRef = React.useRef<string | null>(null);

	// one selection across both regions — picking in one clears the other
	React.useEffect(() => {
		if (pageChrome.selectedId) globalChrome.deselect();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- deselect is stable
	}, [pageChrome.selectedId]);
	React.useEffect(() => {
		if (globalChrome.selectedId) pageChrome.deselect();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- deselect is stable
	}, [globalChrome.selectedId]);

	const activeIsGlobal = !!globalChrome.selectedId;
	const activeDraft = activeIsGlobal ? globalDraft : pageDraft;
	const activeChrome = activeIsGlobal ? globalChrome : pageChrome;

	// collapsible drawer — closing it never exits edit mode (the ✕ Done pill
	// does that); selecting any block reopens it
	const [drawerOpen, setDrawerOpen] = React.useState(true);
	React.useEffect(() => {
		if (pageChrome.selectedId || globalChrome.selectedId) setDrawerOpen(true);
	}, [pageChrome.selectedId, globalChrome.selectedId]);

	React.useEffect(() => {
		const page = pageDraft.resolved?.page;
		if (page && namedForRef.current !== page.id) {
			namedForRef.current = page.id;
			setPageName(page.crystal?.name || 'This page');
		}
	}, [pageDraft.resolved]);

	// Unseeded deployment (no system site doc yet): start the draft with the
	// locked native block so the live screen stays visible and positionable —
	// otherwise the fork would have no marker and every block could only land
	// below the page.
	const seededEmptyRef = React.useRef(false);
	React.useEffect(() => {
		if (pageDraft.loading || pageDraft.resolved?.page || pageDraft.blocks.length || seededEmptyRef.current) return;
		seededEmptyRef.current = true;
		const key = path === '/' ? 'home' : path.slice(1).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
		pageDraft.setBlocks([{ id: `native-${key}`, type: 'native', native: key }]);
		if (!pageName) setPageName('This page');
		// eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot seeding keyed on resolve state
	}, [pageDraft.loading, pageDraft.resolved, pageDraft.blocks.length, path]);

	// keep the view cache fresh so leaving edit mode shows what was saved
	React.useEffect(() => {
		return () => {
			routeCache.delete(path);
		};
	}, [path]);

	const saveAll = React.useCallback(async () => {
		if (globalDraft.dirty) {
			const result = await globalDraft.save({ name: 'Global blocks' });
			if (!result.ok) return result;
		}
		if (pageDraft.dirty) {
			const result = await pageDraft.save({ name: pageName || 'This page' });
			if (!result.ok) return result;
		}
		return { ok: true as const };
		// eslint-disable-next-line react-hooks/exhaustive-deps -- pageName read at call time
	}, [globalDraft.dirty, globalDraft.save, pageDraft.dirty, pageDraft.save, pageName]);

	// native = the actual page, full width, exactly as the normal view —
	// only its redundant nav clearance shrinks (content already sits below
	// the global strip)
	const renderNative = React.useCallback(
		() => (
			<Box width="100%" sx={{ '--tt-nav-clearance': '12px' }}>
				{children}
			</Box>
		),
		[children]
	);

	return (
		<>
			<Box width="100%" paddingRight={drawerOpen ? [0, `${BUILDER_DRAWER_WIDTH}px`] : 0} whiteSpace="normal">
				{/* 🌐 global region — blocks on every page, editable right here */}
				<Box
					width="100%"
					paddingTop={PAGE_TOP_CLEARANCE}
					paddingX={4}
					paddingBottom={2}
					background="var(--tt-surface, #fafafb)"
					borderBottom="1px dashed var(--tt-border, #ececef)"
				>
					<Box maxWidth="960px" marginX="auto">
						<Flex alignItems="baseline" columnGap={2} marginBottom={1}>
							<Box
								as="span"
								color="var(--tt-muted, #9a9aa6)"
								fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
								fontSize="10px"
								fontWeight={700}
								letterSpacing="0.12em"
								textTransform="uppercase"
							>
								🌐 Global · renders on every page
							</Box>
							<Box as="span" color="var(--tt-faint, #b6b6c0)" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="10px">
								nav · drawer · footer are Thingtime chrome
							</Box>
						</Flex>
						<WebpageBlocksRenderer
							blocks={globalDraft.blocks}
							componentsByRef={globalDraft.componentsByRef}
							chrome={globalChrome.chrome}
						/>
					</Box>
				</Box>
				{/* this page — full-bleed, the live screen is the native block */}
				<WebpageBlocksRenderer
					blocks={pageDraft.blocks}
					componentsByRef={pageDraft.componentsByRef}
					chrome={pageChrome.chrome}
					renderNative={renderNative}
					insetNonNative={960}
				/>
			</Box>
			{!drawerOpen ? <InspectorReopenPill onClick={() => setDrawerOpen(true)} /> : null}
			{drawerOpen ? (
			<BuilderDrawer
				title={`Editing · ${path}`}
				draft={activeDraft}
				selectedId={activeChrome.selectedId}
				onDeselect={activeChrome.deselect}
				onClose={() => setDrawerOpen(false)}
				mode="site"
				pageName={pageName}
				onPageName={setPageName}
				isPublic={false}
				onIsPublic={() => {}}
				onSaveAll={saveAll}
				anyDirty={pageDraft.dirty || globalDraft.dirty}
				regionLabel={activeIsGlobal ? '🌐 global block' : 'this page'}
			/>
			) : null}
			{pageChrome.insertMenu}
			{globalChrome.insertMenu}
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
