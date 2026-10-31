import { useWorkspaceDraft } from '~/drafts/useWorkspaceDraft';
import { DraftSaveStatus } from '~/drafts/DraftPicker';
import { createWithDraft } from '~/drafts/createWithDraft';
import { restoreSitePageDraft } from '~/drafts/sitePageDraft';
import { sitePageSeed, sitePageCrystal } from '~/schemas/sitePages';
import { workspaceStorageIdentity, subscribeWorkspaceStorage } from '~/local-workspace/storageStatus.client';
import { BranchWebpage } from './BranchWebpage';
import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { useNavigate, useSearchParams } from 'react-router';

import LiveWebpage from './LiveWebpage';
import { isSafeCssText } from '../Kinds/safeUrl';
import { WebpageBlocksRenderer } from './WebpageBlocksRenderer';
import { getNativeSection, NativeSectionView } from './nativeSections';
import { BuilderDrawer, InspectorReopenPill, useBuilderDrawerWidth } from './BuilderDrawer';
import { useBuilderChrome } from './useBuilderChrome';
import { useWebpageDraft } from './useWebpage';
import { countBlocks } from './webpageBlocks';
import { ThingDefinitionEditor } from './DefinitionEditor/ThingDefinitionEditor';
import { ThingsPage } from '~/components/Things/ThingsPage';

// /builder — create and edit block-based webpages. Without ?page= it lists
// the user's pages (+ New page); with ?page=<id> it opens the canvas: the
// page renders exactly as /p/ renders it, wrapped in builder chrome (hover
// boundaries, inline + add block menus, drag/drop) with the right-side
// drawer for page settings and the selected block's inspector.

const BuilderCanvas = ({ pageId, sitePath }: { pageId: string; sitePath?: string }) => {
	const navigate = useNavigate();
	const isGlobal = pageId === '__global__';
	const draft = useWebpageDraft(
		React.useMemo(() => (sitePath ? { kind: 'path' as const, path: sitePath } : isGlobal ? { kind: 'global' as const } : { kind: 'id' as const, id: pageId }), [isGlobal, pageId, sitePath])
	);
	const [drawerOpen, setDrawerOpen] = React.useState(
		() => typeof window === 'undefined' || window.innerWidth >= 768
	);
	const inspectBlock = React.useCallback(() => setDrawerOpen(true), []);
	const { chrome, selectedId, deselect, insertMenu, uploadToBlock, uploadToPosition } = useBuilderChrome(draft, {
		onInspect: inspectBlock
	});
	// ?page= can open someone else's page on the fork path, so previewBg is not
	// necessarily the viewer's own. Screen it with the same shared render-time
	// check the component previews apply to this field.
	const canvasBg =
		typeof draft.resolved?.page?.crystal?.previewBg === 'string' && isSafeCssText(draft.resolved.page.crystal.previewBg)
			? draft.resolved.page.crystal.previewBg
			: 'var(--tt-card, #ffffff)';
	const [pageName, setPageName] = React.useState('');
	const [audienceAcl, setAudienceAcl] = React.useState<string[]>(['tt:user']);
	const drawerWidth = useBuilderDrawerWidth();

	// the canvas owns window-level file drops — unhandled ones append to the
	// end of the page instead of the browser opening the file
	const dropRef = React.useRef({ upload: uploadToPosition, length: draft.blocks.length });
	dropRef.current = { upload: uploadToPosition, length: draft.blocks.length };
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
			if (files.length) dropRef.current.upload(files, null, dropRef.current.length);
		};
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('drop', onDrop);
		return () => {
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('drop', onDrop);
		};
	}, []);
	// collapsible on small screens — closing the drawer never exits the canvas
	// phones: the drawer covers nearly the whole viewport, so edit mode
	// starts with the CANVAS visible — selecting a block opens the drawer
	// (existing effect), and the 🧱 Inspector pill reopens it any time
	const namedForRef = React.useRef<string | null>(null);

	// selecting a block is a request to inspect it — reopen a collapsed drawer
	React.useEffect(() => {
		if (selectedId) setDrawerOpen(true);
	}, [selectedId]);

	React.useEffect(() => {
		const page = draft.resolved?.page;
		if (page && namedForRef.current !== page.id) {
			namedForRef.current = page.id;
			setPageName(page.crystal?.name || 'Untitled page');
			setAudienceAcl(Array.isArray(page.acl) && page.acl.length ? page.acl : ['tt:user']);
		}
		// unseeded deployments: the global doc may not exist yet — name the
		// fork properly instead of "Untitled page"
		if (!page && isGlobal && !draft.loading && !pageName) setPageName('Global blocks');
		// eslint-disable-next-line react-hooks/exhaustive-deps -- pageName guard reads current value only
	}, [draft.resolved, draft.loading, isGlobal]);

	const seed = sitePath ? sitePageSeed(sitePath) : undefined;
 const initialized = React.useRef(false);
 React.useEffect(() => {
  if (initialized.current || draft.loading || draft.error || !seed) return;
  initialized.current = true;
  if (!draft.resolved?.page) { setPageName(seed.name); draft.setBlocks(sitePageCrystal(seed).blocks); }
 }, [draft, seed]);
 const isSiteDoc = isGlobal || !!sitePath || !!draft.resolved?.page?.crystal?.siteRoute;
 const baseUpdatedAt = draft.resolved?.page?.updatedAt || null;
 const snapshot = JSON.stringify({ name: pageName, acl: audienceAcl, blocks: draft.blocks, baseUpdatedAt });
 const recovery = useWorkspaceDraft({ context: `site-editor:${sitePath || pageId}:${draft.loading ? 'loading' : 'ready'}`, surface: 'definition', resumeRemote: !draft.loading,
  validateSnapshot: raw => restoreSitePageDraft(raw, baseUpdatedAt),
  onRestore: saved => { const value = restoreSitePageDraft(saved.snapshot, baseUpdatedAt); draft.setBlocks(value.blocks); setPageName(value.name); setAudienceAcl(value.acl); }
 });
 const capture = recovery.capture;
 const saving = React.useRef(false);
 React.useEffect(() => {
  const nameChanged = !!pageName && pageName !== (draft.resolved?.page?.crystal?.name || seed?.name || 'Global blocks');
  if (!saving.current && !draft.loading && !draft.error && (draft.dirty || nameChanged)) capture({ name: (pageName || 'Page draft').slice(0, 160), context: recovery.context, surface: 'definition', snapshot, attachmentIds: [] }, true, true);
 }, [capture, draft.loading, draft.error, draft.dirty, draft.resolved?.page?.crystal?.name, seed?.name, pageName, recovery.context, snapshot]);
 const canvasDraft = { ...draft, discardDraft: () => {
  draft.discardDraft();
  setPageName(draft.resolved?.page?.crystal?.name || seed?.name || 'Global blocks');
  void recovery.retire().catch(() => {});
 }, resetToDefault: async () => {
  if (saving.current) return { ok: false, error: 'This page is already saving.' };
  saving.current = true;
  try {
   const result = await createWithDraft(recovery, draft.resetToDefault);
   initialized.current = false; namedForRef.current = null;
   setPageName(seed?.name || 'Global blocks');
   return result;
  } catch (error: any) { return { ok: false, error: error?.error || error?.message || 'Could not reset this page.' }; }
  finally { saving.current = false; }
 }, save: async (options: Parameters<typeof draft.save>[0]) => {
  if (saving.current) return { ok: false, error: 'This page is already saving.' };
  saving.current = true;
  try { return await createWithDraft(recovery, () => draft.save(options)); }
  catch (error: any) { return { ok: false, error: error?.error || error?.message || 'Could not save this page.' }; }
  finally { saving.current = false; }
 } };


	return (
		<>
			<Flex
				flexDirection="column"
				width="100%"
				minHeight="100vh"
				background="var(--tt-surface, #fafafb)"
				paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
				paddingRight={drawerOpen ? [0, `${drawerWidth}px`] : 0}
				whiteSpace="normal"
			>
				<Flex flexDirection="column" width="100%" maxWidth="960px" marginX="auto" paddingX={4} paddingY={8} flex={1}>
					<Flex alignItems="baseline" justifyContent="space-between" marginBottom={4}>
						<Text
							color="var(--tt-muted, #9a9aa6)"
							fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
							fontSize="10px"
							fontWeight={700}
							letterSpacing="0.12em"
							textTransform="uppercase"
						>
							Builder canvas · {countBlocks(draft.blocks)} blocks{draft.dirty ? ' · unsaved' : ''}
						</Text>
						<Box
							as="button"
							color="var(--tt-link, #2f8fd6)"
							fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
							fontSize="11px"
							cursor="pointer"
							_hover={{ textDecoration: 'underline' }}
							onClick={() => navigate('/builder')}
						>
							← my pages
						</Box>
					</Flex>
					<DraftSaveStatus paused={!!recovery.recoveryError} status={recovery.status} error={recovery.error} retry={recovery.retry} />
					<Box
						background={canvasBg}
						border="1px solid"
						borderColor="var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-lg, 16px)"
						padding={[3, 6]}
						minHeight="50vh"
					>
						<WebpageBlocksRenderer
							blocks={draft.blocks}
							componentsByRef={draft.componentsByRef}
							chrome={chrome}
							// registered native sections render for real in the canvas
							// too; unregistered keys keep the placeholder chip
							renderNative={(key) => (getNativeSection(key) ? <NativeSectionView sectionKey={key} /> : null)}
						/>
					</Box>
				</Flex>
			</Flex>
			{!drawerOpen ? <InspectorReopenPill onClick={() => setDrawerOpen(true)} /> : null}
			{drawerOpen ? (
			<BuilderDrawer
				title={isGlobal ? 'Global blocks 🌐' : isSiteDoc ? `Site page · ${sitePath || draft.resolved?.page?.crystal?.siteRoute}` : 'Page builder 🧱'}
				draft={canvasDraft}
				selectedId={selectedId}
				onSelectBlock={(id) => id ? chrome.onSelect(id) : deselect()}
				footerSpace="var(--tt-builder-toolbar-clearance, 160px)"
				onDeselect={deselect}
				onClose={() => setDrawerOpen(false)}
				mode={isSiteDoc ? 'site' : 'page'}
				pageName={pageName}
				onPageName={setPageName}
				audienceAcl={audienceAcl}
				onAudienceAcl={setAudienceAcl}
				onSaved={(id) => {
					if (!isGlobal && !sitePath && id !== pageId) navigate(`/builder?page=${encodeURIComponent(id)}`, { replace: true });
				}}
				onUploadToBlock={uploadToBlock}
			/>
			) : null}
			{insertMenu}
		</>
	);
};

export const BuilderPage = () => {
	const [searchParams, setSearchParams] = useSearchParams();
	const pageId = searchParams.get('page');
 const identity = React.useSyncExternalStore(subscribeWorkspaceStorage, workspaceStorageIdentity, () => '');
 const sitePath = searchParams.get('site');
 if (sitePath) return sitePageSeed(sitePath) ? <BuilderCanvas key={`${identity}:${sitePath}`} pageId="" sitePath={sitePath} /> : <Text role="alert">Choose a site page from Builder.</Text>;
	if (searchParams.has('branchId')) return <BranchWebpage pageId={pageId || ''} />;
	if (!pageId) return <BuilderPagesList />;
	if (pageId === '__global__') return <BuilderCanvas key={`${identity}:${pageId}`} pageId={pageId} />;
	return <LiveWebpage builderPageId={pageId} />;
};

export default BuilderPage;
