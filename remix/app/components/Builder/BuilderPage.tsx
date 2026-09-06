import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '../../theme/card';
import { isSafeCssText } from '../Kinds/safeUrl';
import { PageHeader, PageShell } from '../Layout/PageShell';
import { WebpageBlocksRenderer } from './WebpageBlocksRenderer';
import { getNativeSection, NativeSectionView } from './nativeSections';
import { BuilderDrawer, InspectorReopenPill, useBuilderDrawerWidth } from './BuilderDrawer';
import { useBuilderChrome } from './useBuilderChrome';
import { useWebpageDraft } from './useWebpage';
import { countBlocks, type WebpageBlock } from './webpageBlocks';

// /builder — create and edit block-based webpages. Without ?page= it lists
// the user's pages (+ New page); with ?page=<id> it opens the canvas: the
// page renders exactly as /p/ renders it, wrapped in builder chrome (hover
// boundaries, inline + add block menus, drag/drop) with the right-side
// drawer for page settings and the selected block's inspector.

type PageRow = { id: string; crystal: Record<string, any>; updatedAt?: string };

const PagesList = () => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const user = useCurrentUser();
	const navigate = useNavigate();
	const [pages, setPages] = React.useState<PageRow[] | null>(null);
	const [creating, setCreating] = React.useState(false);

	React.useEffect(() => {
		if (!user?.id) {
			setPages([]);
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const resp: any = await apiRef.current.v1.things.list({ thingtime: 'webpage', limit: 50 });
				if (!cancelled) setPages(resp?.ok ? resp.things || [] : []);
			} catch {
				if (!cancelled) setPages([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [user?.id]);

	const createPage = async () => {
		setCreating(true);
		try {
			const resp: any = await apiRef.current.v1.things.create({
				thingtime: ['webpage'],
				crystal: { name: 'Untitled page', version: 1, blocks: [] },
				acl: ['tt:user']
			});
			if (!resp?.ok) throw resp;
			const id = resp?.thing?.id || resp?.id;
			lopu({ title: 'New page created 🧱✨', status: 'success' });
			navigate(`/builder?page=${encodeURIComponent(id)}`);
		} catch (err: any) {
			lopu({ title: err?.error || 'Couldn’t create the page — try again 🌈', status: 'error' });
		} finally {
			setCreating(false);
		}
	};

	return (
		<PageShell width={920}>
			<PageHeader
				eyebrow="Thingtime · block by block"
				title="Builder 🧱"
				subtitle="Build webpages from Thingtime components and actions — and personalise every Thingtime page with the ✏️ edit mode."
				after={
					<Flex columnGap={2} alignItems="center">
						<Button as={Link} to="/builder/demos" size="sm" variant="outline" data-testid="builder-demo-library">
							Demo library 🧱
						</Button>
						{user?.id ? (
							<Button size="sm" onClick={createPage} isLoading={creating} data-testid="builder-new-page">
								New page ✨
							</Button>
						) : null}
					</Flex>
				}
			/>
			{!user?.id ? (
				<Flex {...CARD_STYLES} padding={6} flexDirection="column" rowGap={2}>
					<Text color="var(--tt-ink, #16161a)" fontWeight={700}>
						Sign in to build pages 🗝️
					</Text>
					<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
						Your pages are things — private by default, publishable at /p/&lt;id&gt; when you flip the toggle.
					</Text>
				</Flex>
			) : pages === null ? null : (
				<Flex flexDirection="column" rowGap={3}>
					{pages.length === 0 ? (
						<Flex {...CARD_STYLES} padding={6} flexDirection="column" rowGap={2}>
							<Text color="var(--tt-ink, #16161a)" fontWeight={700}>
								No pages yet 🌱
							</Text>
							<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
								Hit “New page ✨” to start one, or open any Thingtime page and press the ✏️ pill to make it yours.
							</Text>
						</Flex>
					) : null}
					<Flex {...CARD_STYLES} padding={4} alignItems="center" justifyContent="space-between" columnGap={3}>
						<Box minWidth={0}>
							<Text color="var(--tt-ink, #16161a)" fontWeight={700}>
								Global blocks 🌐
							</Text>
							<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="11px">
								blocks that render on every page — yours only
							</Text>
						</Box>
						<Button as={Link} to="/builder?page=__global__" size="xs" flexShrink={0}>
							Edit
						</Button>
					</Flex>
					{pages.map((page) => (
						<Flex key={page.id} {...CARD_STYLES} padding={4} alignItems="center" justifyContent="space-between" columnGap={3}>
							<Box minWidth={0}>
								<Text color="var(--tt-ink, #16161a)" fontWeight={700} noOfLines={1}>
									{page.crystal?.name || 'Untitled page'}
								</Text>
								<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="11px" noOfLines={1}>
									{page.crystal?.siteRoute
										? `site page · ${page.crystal.siteRoute}`
										: `${countBlocks((page.crystal?.blocks as WebpageBlock[]) || [])} blocks · /p/${page.id}`}
								</Text>
							</Box>
							<Flex columnGap={2} flexShrink={0}>
								{!page.crystal?.siteRoute ? (
									<Button as={Link} to={`/p/${page.id}`} size="xs" variant="outline">
										View
									</Button>
								) : (
									<Button as={Link} to={page.crystal.siteRoute} size="xs" variant="outline">
										Visit
									</Button>
								)}
								<Button as={Link} to={`/builder?page=${encodeURIComponent(page.id)}`} size="xs">
									Edit
								</Button>
							</Flex>
						</Flex>
					))}
				</Flex>
			)}
		</PageShell>
	);
};

const BuilderCanvas = ({ pageId }: { pageId: string }) => {
	const navigate = useNavigate();
	const isGlobal = pageId === '__global__';
	const draft = useWebpageDraft(
		React.useMemo(() => (isGlobal ? { kind: 'global' as const } : { kind: 'id' as const, id: pageId }), [isGlobal, pageId])
	);
	const { chrome, selectedId, deselect, insertMenu, uploadToBlock, uploadToPosition } = useBuilderChrome(draft);
	// ?page= can open someone else's page on the fork path, so previewBg is not
	// necessarily the viewer's own. Screen it with the same shared render-time
	// check the component previews apply to this field.
	const canvasBg =
		typeof draft.resolved?.page?.crystal?.previewBg === 'string' && isSafeCssText(draft.resolved.page.crystal.previewBg)
			? draft.resolved.page.crystal.previewBg
			: 'var(--tt-card, #ffffff)';
	const [pageName, setPageName] = React.useState('');
	const [isPublic, setIsPublic] = React.useState(false);
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
	const [drawerOpen, setDrawerOpen] = React.useState(
		() => typeof window === 'undefined' || window.innerWidth >= 768
	);
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
			setIsPublic(Array.isArray((page as any).acl) ? (page as any).acl.includes('tt:all') : false);
		}
		// unseeded deployments: the global doc may not exist yet — name the
		// fork properly instead of "Untitled page"
		if (!page && isGlobal && !draft.loading && !pageName) setPageName('Global blocks');
		// eslint-disable-next-line react-hooks/exhaustive-deps -- pageName guard reads current value only
	}, [draft.resolved, draft.loading, isGlobal]);

	const isSiteDoc = isGlobal || !!draft.resolved?.page?.crystal?.siteRoute;

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
				title={isGlobal ? 'Global blocks 🌐' : isSiteDoc ? `Site page · ${draft.resolved?.page?.crystal?.siteRoute}` : 'Page builder 🧱'}
				draft={draft}
				selectedId={selectedId}
				onDeselect={deselect}
				onClose={() => setDrawerOpen(false)}
				mode={isSiteDoc ? 'site' : 'page'}
				pageName={pageName}
				onPageName={setPageName}
				isPublic={isPublic}
				onIsPublic={setIsPublic}
				onSaved={(id) => {
					if (!isGlobal && id !== pageId) navigate(`/builder?page=${encodeURIComponent(id)}`, { replace: true });
				}}
				onUploadToBlock={uploadToBlock}
			/>
			) : null}
			{insertMenu}
		</>
	);
};

export const BuilderPage = () => {
	const [searchParams] = useSearchParams();
	const pageId = searchParams.get('page');
	return pageId ? <BuilderCanvas pageId={pageId} /> : <PagesList />;
};

export default BuilderPage;
