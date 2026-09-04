import React from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useThingtime } from '../Thingtime/useThingtime';
import { DRAWER_HOVER_Z } from '../Nav/Drawer/useDrawer';
import { PAGE_TOP_CLEARANCE, PageShell } from '../Layout/PageShell';
import {
	blocksAreFullySectioned,
	getNativePageByRoute,
	getNativeSection,
	NativeSectionView
} from './nativeSections';
import { WebpageBlocksRenderer, type ComponentsByRef } from './WebpageBlocksRenderer';
import { BuilderDrawer, InspectorReopenPill, useBuilderDrawerWidth } from './BuilderDrawer';
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

// Exit-with-unsaved-changes guard: the editor (mounted per-path) reports its
// dirty state here so the host's Done pill can ask before discarding.
const siteEditorDirty = { current: false };

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

// ——— edit mode: the full builder grammar on the live page ————————————————

// The in-place site editor — the PRIMARY builder surface (limitless: every
// page, full-bleed). The page renders exactly as its normal full-width self;
// block chrome (boundaries, insert zones, drag/drop) overlays it, and the
// right drawer appears. TWO regions edit together through one drawer:
//   🌐 global — the site-global doc, blocks on every page
//   this page — the route's doc, with the live screen as its native block
// Saving persists whichever drafts are dirty (each as the viewer's own fork).
// Leaving edit mode is the HOST's Done pill (it owns the dirty-state confirm),
// so the editor takes no onDone of its own.
const SiteBlocksEditor = ({ path, children }: { path: string; children: React.ReactNode }) => {
	const pageDraft = useWebpageDraft(React.useMemo(() => ({ kind: 'path' as const, path }), [path]));
	const globalDraft = useWebpageDraft(React.useMemo(() => ({ kind: 'global' as const }), []));
	const pageChrome = useBuilderChrome(pageDraft);
	const globalChrome = useBuilderChrome(globalDraft);
	const [pageName, setPageName] = React.useState('');
	const namedForRef = React.useRef<string | null>(null);
	const drawerWidth = useBuilderDrawerWidth();

	// Edit mode owns file drag/drop for the WHOLE window: without this the
	// browser navigates to (opens) any file dropped outside a zone or frame.
	// Zones/frames stopPropagation, so this only catches unhandled drops —
	// those upload and append to the end of the page draft.
	const pageDropRef = React.useRef({ upload: pageChrome.uploadToPosition, length: pageDraft.blocks.length });
	pageDropRef.current = { upload: pageChrome.uploadToPosition, length: pageDraft.blocks.length };
	React.useEffect(() => {
		const hasFiles = (event: DragEvent) => !!event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files');
		const onDragOver = (event: DragEvent) => {
			if (hasFiles(event)) event.preventDefault();
		};
		const onDrop = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			// an inner surface (frame, zone, the app's own composer) already
			// claimed this drop — appending a second copy would double-handle it
			if (event.defaultPrevented) return;
			event.preventDefault();
			const files = Array.from(event.dataTransfer?.files || []);
			if (files.length) pageDropRef.current.upload(files, null, pageDropRef.current.length);
		};
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('drop', onDrop);
		return () => {
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('drop', onDrop);
		};
	}, []);

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
	// phones: the drawer covers nearly the whole viewport, so edit mode
	// starts with the CANVAS visible — selecting a block opens the drawer
	// (existing effect), and the 🧱 Inspector pill reopens it any time
	const [drawerOpen, setDrawerOpen] = React.useState(
		() => typeof window === 'undefined' || window.innerWidth >= 768
	);
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
	// registered SECTION list when this route is in the native registry (the
	// page decomposes immediately), else the locked whole-page native block —
	// otherwise the fork would have no marker and every block could only land
	// below the page.
	const seededEmptyRef = React.useRef(false);
	React.useEffect(() => {
		if (pageDraft.loading || pageDraft.resolved?.page || pageDraft.blocks.length || seededEmptyRef.current) return;
		seededEmptyRef.current = true;
		const registered = getNativePageByRoute(path);
		if (registered) {
			pageDraft.setBlocks(
				registered.sections.map((section) => ({ id: `native-${section.key}`, type: 'native' as const, native: section.key }))
			);
		} else {
			const key = path === '/' ? 'home' : path.slice(1).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
			pageDraft.setBlocks([{ id: `native-${key}`, type: 'native', native: key }]);
		}
		if (!pageName) setPageName('This page');
		// eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot seeding keyed on resolve state
	}, [pageDraft.loading, pageDraft.resolved, pageDraft.blocks.length, path]);

	// keep the view cache fresh so leaving edit mode shows what was saved
	React.useEffect(() => {
		return () => {
			routeCache.delete(path);
		};
	}, [path]);

	// report unsaved changes to the host so ✕ Done can confirm before
	// discarding them
	React.useEffect(() => {
		siteEditorDirty.current = pageDraft.dirty || globalDraft.dirty;
		return () => {
			siteEditorDirty.current = false;
		};
	}, [pageDraft.dirty, globalDraft.dirty]);

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

	// native = a registered section (pixel-identical block) when the key is in
	// the registry, else the whole live page — full width, exactly as the
	// normal view, with only its redundant nav clearance shrunk (content
	// already sits below the global strip)
	const renderNative = React.useCallback(
		(key: string) =>
			getNativeSection(key) ? (
				<NativeSectionView sectionKey={key} />
			) : (
				<Box width="100%" sx={{ '--tt-nav-clearance': '12px' }}>
					{children}
				</Box>
			),
		[children]
	);

	// a fully sectioned draft edits inside the page's own shell (surface wash,
	// clearance, readable column) — exactly how the route renders it
	const draftSectioned = pageDraft.blocks.length > 0 && blocksAreFullySectioned(pageDraft.blocks);
	const draftPage = draftSectioned
		? getNativeSection((pageDraft.blocks.find((block) => block.type === 'native') as WebpageBlock)?.native || '')?.page
		: null;

	return (
		<>
			<Box
				width="100%"
				paddingRight={drawerOpen ? [0, `${drawerWidth}px`] : 0}
				whiteSpace="normal"
				// the canvas owns its wash: collapsed insert zones and shrunk nav
				// clearance are transparent, and a white body bar between the
				// global strip and the page would read as broken layout
				background="var(--tt-surface, #fafafb)"
			>
				{/* 🌐 global region — blocks on every page, editable right here.
				    TRUE WYSIWYG: the region label and the dashed region separator
				    are absolute OVERLAYS (the label floats in the breathing band
				    below the nav, the separator is a zero-height line), so this
				    strip's content geometry is identical to view mode's
				    GlobalBlocks. */}
				<Box
					width="100%"
					position="relative"
					paddingTop={`calc(${PAGE_TOP_CLEARANCE} + 14px)`}
					paddingX={4}
					background="var(--tt-surface, #fafafb)"
				>
					<Flex
						position="absolute"
						top={PAGE_TOP_CLEARANCE}
						left={0}
						right={0}
						height="14px"
						alignItems="center"
						justifyContent="center"
						columnGap={2}
						pointerEvents="none"
						zIndex={2}
					>
						<Box
							as="span"
							color="var(--tt-muted, #9a9aa6)"
							fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
							fontSize="9px"
							fontWeight={700}
							letterSpacing="0.12em"
							textTransform="uppercase"
							lineHeight="1"
						>
							🌐 Global · renders on every page
						</Box>
						<Box
							as="span"
							color="var(--tt-faint, #b6b6c0)"
							fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
							fontSize="9px"
							lineHeight="1"
							display={['none', 'inline']}
						>
							nav · drawer · footer are Thingtime chrome
						</Box>
					</Flex>
					<Box
						position="absolute"
						left={0}
						right={0}
						bottom="-1px"
						borderTop="1px dashed var(--tt-border, #ececef)"
						pointerEvents="none"
					/>
					<Box maxWidth="960px" marginX="auto">
						{globalDraft.loading && !globalDraft.blocks.length ? null : (
							<WebpageBlocksRenderer
								blocks={globalDraft.blocks}
								componentsByRef={globalDraft.componentsByRef}
								chrome={globalChrome.chrome}
								testIdPrefix="global"
							/>
						)}
					</Box>
				</Box>
				{/* this page — sectioned pages edit inside their own shell; legacy
				    whole-page natives edit full-bleed with authored blocks inset.
				    While the draft resolves, the live page renders untouched
				    (optimistic — never an empty dropwell flash) */}
				{pageDraft.loading && !pageDraft.blocks.length ? (
					<Box width="100%" sx={{ '--tt-nav-clearance': '12px' }}>
						{children}
					</Box>
				) : draftSectioned && draftPage && draftPage.shellWidth === 'full' && draftPage.Shell ? (
					// full-bleed sectioned pages edit inside their page-owned shell
					<Box width="100%" sx={{ '--tt-nav-clearance': '12px' }}>
						<React.Suspense fallback={null}>
							<draftPage.Shell>
								<WebpageBlocksRenderer
									blocks={pageDraft.blocks}
									componentsByRef={pageDraft.componentsByRef}
									chrome={pageChrome.chrome}
									renderNative={renderNative}
									testIdPrefix="page"
								/>
							</draftPage.Shell>
						</React.Suspense>
					</Box>
				) : draftSectioned && draftPage && draftPage.shellWidth !== 'full' ? (
					// the global strip above already cleared the nav — shrink the
					// shell's own clearance to a normal seam
					<Box width="100%" sx={{ '--tt-nav-clearance': '12px' }}>
						<PageShell width={draftPage.shellWidth}>
							<WebpageBlocksRenderer
								blocks={pageDraft.blocks}
								componentsByRef={pageDraft.componentsByRef}
								chrome={pageChrome.chrome}
								renderNative={renderNative}
								testIdPrefix="page"
							/>
						</PageShell>
					</Box>
				) : (
					<WebpageBlocksRenderer
						blocks={pageDraft.blocks}
						componentsByRef={pageDraft.componentsByRef}
						chrome={pageChrome.chrome}
						renderNative={renderNative}
						insetNonNative={960}
						testIdPrefix="page"
					/>
				)}
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
				onUploadToBlock={activeChrome.uploadToBlock}
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
		// leaving edit mode discards the draft — unsaved work asks first
		if (editMode && siteEditorDirty.current && !window.confirm('Discard unsaved changes to this page?')) return;
		setThingtime?.('settings.builder.editMode', !editMode, { ignoreUndoRedo: true, namespace: 'builder' });
	}, [editMode, setThingtime]);

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

	return (
		<>
			{editMode && user?.id ? (
				<SiteBlocksEditor key={path} path={path}>
					{children}
				</SiteBlocksEditor>
			) : (
				<SiteBlocksView path={path}>{children}</SiteBlocksView>
			)}
			{user?.id ? <EditPill active={editMode} onToggle={toggleEditMode} /> : null}
		</>
	);
};
