import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Link, useNavigate, useParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { materializeSuite, summarizeBehaviourSuite, type BehaviourSuite } from '~/schemas/behaviourSuites';
// the REGISTRY module (not just the lookups): importing it registers the app
// suites, so a cold load of /builder/demos/pokeworld resolves the app
import { ALL_SUITES } from '~/schemas/appSuites/index';
import { WEBPAGE_DEMO_FAMILIES, countDemoBlocks, type WebpageDemo } from '~/schemas/webpageDemos';
import { CARD_STYLES } from '../../theme/card';
import { PageHeader, PageShell } from '../Layout/PageShell';
import { useActionRunConfirm } from '../Actions/ActionRunConfirm';
import type { TtActionConfirmHandler, TtActionUnownedHandler } from '../Actions/useTtActionClicks';
import { WebpageBlocksRenderer, buildComponentsByRef, type ComponentsByRef, type WebpageBlocksRendererProps } from './WebpageBlocksRenderer';
import { WebpageRuntimeProvider } from './webpageRuntime';
import { installSuite as installSuiteThings, installSuiteOnServer, suiteKeyFromActionKey } from './installSuite';
import { DemoThumb, type DemoBlockList } from './DemoLibraryPage';
import {
	DEMO_LIBRARY_PATH,
	demoPageIdentity,
	readSeededCache,
	resolveDemoEntry,
	runtimeIdentityFor,
	suiteActionNames,
	suiteComponentsByRef,
	suiteKindLabel,
	suitePageViews,
	templateCrystalOf,
	writeSeededCache,
	type SuitePageView
} from './demoDetail';
import type { WebpageBlock } from './webpageBlocks';

// /builder/demos/:slug — one demo, behaviour suite, interactive suite, or app
// on its own page: the catalog PREVIEW (the gallery's inert scaled picture
// plus a metadata rail) beside the LIVE version of the same block tree inside
// the page runtime (WebpageRuntimeProvider — without it sources never load
// and $refresh/$install no-op). The slug resolves as a demo first, then as a
// suite/app key from ALL_SUITES. The page paints instantly from the code
// catalog (webpageDemoCrystal / materializeSuite are pure), then reconciles
// once with GET /api/v1/webpages/demos?slug=|?suite= for the seeded flag and
// the platform library components the component-kind demos reference.
//
// TRUST RULE (the same ladder p.tsx and the /things PreviewModal use):
// interactivity comes from OWNERSHIP or PLATFORM CURATION, never from
// markup. A catalog-compiled block tree is platform-curated — it is code in
// this repository and, once seeded, a system-owned reserved-prefix thing —
// so it renders LIVE for any signed-in viewer, behind the catalog-side run
// confirmation, and (for suites) with run-or-install: the executor resolves
// every control click owner-only, so a control can only run the viewer's own
// program; when they have none, the page installs the suite into their things
// and re-runs the same click. Signed-out viewers get the sign-in card and the
// inert picture — never a broken-looking pane.

const RAIL_THUMB_HEIGHT = 320;

type Reconciled = { seeded: boolean | null; library: ComponentsByRef };

// One reconcile per entry: the seeded flag (optimistic from the localStorage
// tier, then the census) and the library components. The view components are
// keyed by slug, so a slug change remounts and re-runs this.
const useCatalogReconcile = (id: string, query: string, pickSeeded: (data: any) => boolean | null): Reconciled => {
	const [state, setState] = React.useState<Reconciled>(() => ({ seeded: readSeededCache(id), library: {} }));
	const pickRef = React.useRef(pickSeeded);
	pickRef.current = pickSeeded;
	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const response = await fetch(`/api/v1/webpages/demos?${query}`, { credentials: 'include' });
				if (!response.ok) return;
				const data = await response.json();
				if (cancelled || !data?.ok) return;
				const seeded = pickRef.current(data);
				if (seeded !== null) writeSeededCache(id, seeded);
				setState((current) => ({ seeded: seeded ?? current.seeded, library: buildComponentsByRef(data) }));
			} catch {
				// the catalog already painted — seeded flags are a progressive detail
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [id, query]);
	return state;
};

// The post-install hand-off is deferred so the "installed ✨" toast is
// readable before the page moves. That timer OUTLIVES this component if the
// viewer navigates away inside the delay, and it would then yank them off
// whatever they opened next. Held in a ref so unmount — and a second install
// — cancels the pending hand-off. (Same shape as p.tsx / DemoLibraryPage.)
const useHandoff = () => {
	const handoffRef = React.useRef<number | null>(null);
	const scheduleHandoff = React.useCallback((run: () => void, delayMs: number) => {
		if (handoffRef.current !== null) window.clearTimeout(handoffRef.current);
		handoffRef.current = window.setTimeout(() => {
			handoffRef.current = null;
			run();
		}, delayMs);
	}, []);
	React.useEffect(
		() => () => {
			if (handoffRef.current !== null) {
				window.clearTimeout(handoffRef.current);
				handoffRef.current = null;
			}
		},
		[]
	);
	return scheduleHandoff;
};

const MONO = 'var(--tt-font-mono, ui-monospace, monospace)';
const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const MUTED = 'var(--tt-muted, #9a9aa6)';

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
	<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
		{children}
	</Text>
);

const MetaRow = ({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) => (
	<Flex columnGap={3} rowGap={1} alignItems="baseline" flexWrap="wrap" minWidth={0} data-testid={testId}>
		<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED} minWidth="72px">
			{label}
		</Text>
		<Box fontSize="xs" color={TEXT} minWidth={0} flex="1">
			{children}
		</Box>
	</Flex>
);

const Chip = ({ children }: { children: React.ReactNode }) => (
	<Box as="span" display="inline-block" borderRadius="999px" border="1px solid var(--tt-border, #ececef)" background="var(--tt-surface-raised, #ffffff)" paddingX={2} paddingY="1px" fontSize="11px" color={TEXT} marginRight={1} marginBottom={1}>
		{children}
	</Box>
);

const chipSx = (active: boolean) => ({
	borderRadius: '999px',
	border: '1px solid var(--tt-border, #ececef)',
	background: active ? INK : 'var(--tt-surface-raised, #ffffff)',
	color: active ? 'var(--tt-surface, #fafafb)' : TEXT,
	fontSize: '13px',
	fontWeight: 600,
	paddingX: 3,
	height: '30px',
	minHeight: '30px',
	_hover: { background: active ? INK : 'var(--tt-surface-sunken, #f1f1f4)' }
});

const SignInCard = ({ what }: { what: string }) => (
	<Flex {...CARD_STYLES} padding={4} alignItems="center" columnGap={3} rowGap={2} flexWrap="wrap" data-testid="demo-signin-card">
		<Text fontSize="xl" lineHeight="1">
			🗝️
		</Text>
		<Box flex="1" minWidth="200px">
			<Text fontWeight={700} color={INK} fontSize="sm">
				Sign in to use {what} live
			</Text>
			<Text fontSize="xs" color={TEXT}>
				Controls run as you, on your own things. Until then this is the same picture as the preview — nothing here can run.
			</Text>
		</Box>
		<Button as={Link} to="/login" size="sm" data-testid="demo-signin">
			Sign in 🗝️
		</Button>
	</Flex>
);

// The LIVE pane: one block tree inside the page runtime. `interactive` is the
// platform-curation decision described in the header note — a signed-in
// viewer, and nothing else, because the tree is catalog code; the executor
// still resolves clicks owner-only.
const LivePane = ({
	pageId,
	pageKey,
	suiteKey,
	source,
	onInstall,
	blocks,
	componentsByRef,
	background,
	onUnowned,
	actionNames,
	what
}: {
	pageId: string;
	pageKey: string | null;
	suiteKey: string | null;
	source: 'system' | null;
	onInstall?: () => Promise<boolean>;
	blocks: DemoBlockList;
	componentsByRef: ComponentsByRef;
	background: string;
	onUnowned?: TtActionUnownedHandler;
	actionNames: Record<string, string>;
	what: string;
}) => {
	const user = useCurrentUser();
	const signedIn = !!user?.id;
	// the catalog-side run confirmation: the first press of each control
	// names what will run before anything executes (ActionRunConfirm)
	const { confirm, dialog } = useActionRunConfirm({ resolveActionName: (action) => actionNames[action] || null });
	// `confirm` is not a WebpageBlocksRenderer prop yet — it is threaded here
	// so the gate arms the moment the renderer forwards it to ComponentBlockView
	// (useTtActionClicks already accepts it); until then the dialog stays idle
	const rendererProps: WebpageBlocksRendererProps & { confirm: TtActionConfirmHandler } = {
		blocks: blocks as WebpageBlock[],
		componentsByRef,
		interactive: signedIn,
		onTtActionUnowned: signedIn ? onUnowned : undefined,
		confirm
	};
	return (
		<Flex flexDirection="column" rowGap={3} minWidth={0}>
			{!signedIn ? <SignInCard what={what} /> : null}
			<Box
				{...CARD_STYLES}
				background={background || 'var(--tt-surface, #fafafb)'}
				padding={{ base: 3, md: 6 }}
				minWidth={0}
				overflowX="auto"
				whiteSpace="normal"
				data-testid="demo-live-pane"
				data-live={signedIn ? 'true' : 'false'}
			>
				<WebpageRuntimeProvider pageId={pageId} pageKey={pageKey} suiteKey={suiteKey} source={source} onInstall={onInstall}>
					<Box width="100%" maxWidth="960px" marginX="auto" minWidth={0}>
						<WebpageBlocksRenderer {...rendererProps} />
					</Box>
					{dialog}
				</WebpageRuntimeProvider>
			</Box>
		</Flex>
	);
};

const PaneHeading = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
	<Flex alignItems="baseline" columnGap={2} flexWrap="wrap">
		<Text fontWeight={800} color={INK} fontSize="sm">
			{title}
		</Text>
		<Eyebrow>{eyebrow}</Eyebrow>
	</Flex>
);

const BackToLibrary = () => (
	<Button as={Link} to={DEMO_LIBRARY_PATH} size="sm" variant="outline" data-testid="demo-back-to-library">
		← Demo library
	</Button>
);

// ── a demo ──────────────────────────────────────────────────────────────────

const DemoView = ({ demo, slug }: { demo: WebpageDemo; slug: string }) => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const user = useCurrentUser();
	const navigate = useNavigate();
	const identity = React.useMemo(() => demoPageIdentity(demo), [demo]);
	const reconciled = useCatalogReconcile(identity.shareId, `slug=${encodeURIComponent(slug)}`, (data) => (typeof data?.demo?.seeded === 'boolean' ? data.demo.seeded : null));
	const seeded = reconciled.seeded === true;
	const runtime = runtimeIdentityFor(identity, seeded);
	const family = WEBPAGE_DEMO_FAMILIES.find((entry) => entry.key === demo.family);
	const blockCount = React.useMemo(() => countDemoBlocks(demo.blocks), [demo.blocks]);
	const [busy, setBusy] = React.useState(false);

	// "Use template" = a personal copy through the ordinary things write path
	// (the same call the builder's New page makes); the crystal drops the
	// catalog pageKey (demoDetail.ts templateCrystalOf)
	const copyTemplate = async () => {
		if (!user?.id) {
			lopu({ title: 'Sign in to use a template 🗝️', description: 'Demos become things in your own library.', status: 'info' });
			navigate('/login');
			return;
		}
		setBusy(true);
		try {
			const resp: any = await apiRef.current.v1.things.create({ thingtime: ['webpage'], crystal: templateCrystalOf(demo, { seeded }), acl: ['tt:user'] });
			if (!resp?.ok) throw resp;
			const id = resp?.thing?.id || resp?.id;
			lopu({ title: 'Template copied into your pages 🧱✨', status: 'success' });
			navigate(`/builder?page=${encodeURIComponent(id)}`);
		} catch (err: any) {
			lopu({ title: err?.error || 'Couldn’t copy the template — try again 🌈', status: 'error' });
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<PageHeader
				eyebrow="Thingtime · builder · demo library"
				title={demo.name}
				subtitle={demo.description}
				after={
					<Flex columnGap={2} rowGap={2} alignItems="center" flexWrap="wrap">
						<BackToLibrary />
						<Button size="sm" onClick={copyTemplate} isLoading={busy} data-testid="demo-detail-use">
							Use template ✨
						</Button>
						{seeded ? (
							<>
								<Button as={Link} to={`/p/${encodeURIComponent(identity.shareId)}`} size="sm" variant="outline" data-testid="demo-detail-open-p">
									Open /p/ ↗
								</Button>
								<Button as={Link} to={`/builder?page=${encodeURIComponent(identity.shareId)}`} size="sm" variant="outline" data-testid="demo-detail-open-builder">
									Open in builder ✏️
								</Button>
							</>
						) : null}
					</Flex>
				}
			/>
			<Box display="grid" gridTemplateColumns={{ base: '1fr', lg: '340px minmax(0, 1fr)' }} gap={4} alignItems="start" minWidth={0}>
				<Flex {...CARD_STYLES} flexDirection="column" rowGap={3} padding={3} minWidth={0} data-testid="demo-preview-pane">
					<PaneHeading title="Preview" eyebrow="catalog · inert" />
					<DemoThumb blocks={demo.blocks} background={demo.previewBg} componentsByRef={reconciled.library} height={RAIL_THUMB_HEIGHT} />
					<Flex flexDirection="column" rowGap={2} data-testid="demo-meta-rail">
						<MetaRow label="Family" testId="demo-meta-family">
							{family?.emoji} {family?.title || demo.family}
						</MetaRow>
						<MetaRow label="Kind">{demo.kind}</MetaRow>
						<MetaRow label="Tone">{demo.tone}</MetaRow>
						<MetaRow label="Layout">{demo.layout}</MetaRow>
						<MetaRow label="Blocks">
							{blockCount} block{blockCount === 1 ? '' : 's'}
						</MetaRow>
						<MetaRow label="Tags">
							{demo.tags.length ? demo.tags.map((tag) => <Chip key={tag}>#{tag}</Chip>) : '—'}
						</MetaRow>
						<MetaRow label="Seeded" testId="demo-meta-seeded">
							{reconciled.seeded === null ? 'checking this deployment…' : seeded ? '🌱 yes — opens at /p/ and in the builder' : 'not on this deployment (Use template still works)'}
						</MetaRow>
					</Flex>
				</Flex>
				<Flex flexDirection="column" rowGap={2} minWidth={0}>
					<PaneHeading title="Live" eyebrow={user?.id ? 'runs as you · owner-only resolution' : 'sign in to arm'} />
					<LivePane
						pageId={runtime.pageId}
						pageKey={identity.pageKey}
						suiteKey={null}
						source={runtime.source}
						blocks={demo.blocks}
						componentsByRef={reconciled.library}
						background={demo.previewBg}
						actionNames={{}}
						what="this demo"
					/>
				</Flex>
			</Box>
		</>
	);
};

// ── a suite / app ───────────────────────────────────────────────────────────

const SuiteView = ({ suite }: { suite: BehaviourSuite }) => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const user = useCurrentUser();
	const navigate = useNavigate();
	const scheduleHandoff = useHandoff();
	const materialized = React.useMemo(() => materializeSuite(suite, 'own'), [suite]);
	const summary = React.useMemo(() => summarizeBehaviourSuite(suite), [suite]);
	const pages = React.useMemo(() => suitePageViews(suite, materialized), [suite, materialized]);
	const componentsByRef = React.useMemo(() => suiteComponentsByRef(materialized), [materialized]);
	const actionNames = React.useMemo(() => suiteActionNames(materialized), [materialized]);
	const reconciled = useCatalogReconcile(summary.pageId, `suite=${encodeURIComponent(suite.key)}`, (data) => (typeof data?.suite?.seeded === 'boolean' ? data.suite.seeded : null));
	const seeded = reconciled.seeded === true;
	const [activeKey, setActiveKey] = React.useState(pages[0]?.key || '');
	const active: SuitePageView = pages.find((page) => page.key === activeKey) || pages[0];
	const runtime = runtimeIdentityFor(active, seeded);
	const [busy, setBusy] = React.useState(false);
	const kindLabel = suiteKindLabel(suite);
	const isApp = !!suite.app;
	const origin = suite.app?.origin && /^https:\/\//.test(suite.app.origin) ? suite.app.origin : null;

	// Install the suite for the viewer — the same split as p.tsx
	// installForViewer: app suites go through the one-request idempotent
	// server install (every page keeps its key, so /p/<pageKey> now serves the
	// viewer's own copy); the demo suites keep the part-by-part client install
	// and open the personal copy by id.
	const installForViewer = React.useCallback(
		async (key: string): Promise<{ href: string | null } | null> => {
			const target = ALL_SUITES.find((entry) => entry.key === key) || null;
			if (!target) return null;
			if (!user?.id) {
				lopu({ title: 'Sign in to install this 🗝️', description: 'Installing it makes the programs — and the data — yours.', status: 'info' });
				navigate('/login');
				return null;
			}
			lopu({ title: `Installing ${target.emoji} ${target.title}…`, description: 'Your own schemas, controls, actions, and pages.', status: 'info', duration: 4000 });
			if (target.app) {
				const installed = await installSuiteOnServer(target.key);
				lopu({
					title: `${target.emoji} ${target.title} installed ✨`,
					description: `${installed.created} things created · ${installed.updated} refreshed — opening your copy at /p/${installed.entryPageKey}.`,
					status: 'success',
					duration: 6000
				});
				return { href: `/p/${encodeURIComponent(installed.entryPageKey)}` };
			}
			const installed = await installSuiteThings((payload) => apiRef.current.v1.things.create(payload), target, { seeded });
			lopu({
				title: `${target.emoji} ${target.title} installed ✨`,
				description: 'Opening your own copy of this page.',
				status: 'success',
				duration: 6000,
				link: { label: 'Open my page', href: `/p/${encodeURIComponent(installed.pageId)}` }
			});
			return { href: `/p/${encodeURIComponent(installed.pageId)}` };
		},
		[lopu, navigate, seeded, user?.id]
	);

	// a control the viewer has no program for: install the suite (their own
	// schemas/controls/actions/data/page), let the click re-run, then take
	// them to their own copy where every control is theirs
	const onUnowned = React.useCallback<TtActionUnownedHandler>(
		async (action: string): Promise<boolean> => {
			const key = suiteKeyFromActionKey(action, ALL_SUITES) || suite.key;
			try {
				const outcome = await installForViewer(key);
				if (!outcome) return false;
				if (outcome.href) {
					const href = outcome.href;
					scheduleHandoff(() => navigate(href), 1200);
				}
				return true;
			} catch (err: any) {
				lopu({ title: err?.error || 'Couldn’t install — try again 🌈', status: 'error' });
				return false;
			}
		},
		[installForViewer, lopu, navigate, scheduleHandoff, suite.key]
	);

	// the Install button and the page's `$install` pseudo-action
	const onInstall = React.useCallback(async (): Promise<boolean> => {
		setBusy(true);
		try {
			const outcome = await installForViewer(suite.key);
			if (!outcome) return false;
			if (outcome.href) navigate(outcome.href);
			return true;
		} catch (err: any) {
			lopu({ title: err?.error || 'Couldn’t install — try again 🌈', description: err?.error ? undefined : 'Some parts may have been created; check /things.', status: 'error' });
			return false;
		} finally {
			setBusy(false);
		}
	}, [installForViewer, lopu, navigate, suite.key]);

	const counts = summary.counts;

	return (
		<>
			<PageHeader
				eyebrow={`Thingtime · builder · demo library · ${kindLabel}`}
				title={`${suite.emoji} ${suite.title}`}
				subtitle={suite.description}
				after={
					<Flex columnGap={2} rowGap={2} alignItems="center" flexWrap="wrap">
						<BackToLibrary />
						<Button size="sm" onClick={onInstall} isLoading={busy} data-testid="suite-detail-install">
							{isApp ? 'Install app ✨' : 'Install suite ✨'}
						</Button>
						{seeded ? (
							<Button as={Link} to={`/p/${encodeURIComponent(summary.pageKey)}`} size="sm" variant="outline" data-testid="suite-detail-open-p">
								Open /p/{summary.pageKey} ↗
							</Button>
						) : null}
					</Flex>
				}
			/>
			<Box display="grid" gridTemplateColumns={{ base: '1fr', lg: '340px minmax(0, 1fr)' }} gap={4} alignItems="start" minWidth={0}>
				<Flex {...CARD_STYLES} flexDirection="column" rowGap={3} padding={3} minWidth={0} data-testid="demo-preview-pane">
					<PaneHeading title="Preview" eyebrow={`catalog · inert · ${active.name}`} />
					<DemoThumb blocks={active.blocks} background={active.previewBg || 'var(--tt-surface, #fafafb)'} componentsByRef={componentsByRef} height={RAIL_THUMB_HEIGHT} />
					<Flex flexDirection="column" rowGap={2} data-testid="demo-meta-rail">
						<MetaRow label="Kind">{kindLabel}</MetaRow>
						<MetaRow label="Tone">{suite.tone}</MetaRow>
						<MetaRow label="Bundle" testId="suite-meta-counts">
							{counts.schemas} schema{counts.schemas === 1 ? '' : 's'} · {counts.components} control{counts.components === 1 ? '' : 's'} · {counts.actions} action{counts.actions === 1 ? '' : 's'} · {counts.data} data · {counts.pages} page{counts.pages === 1 ? '' : 's'}
						</MetaRow>
						{isApp && suite.app ? (
							<MetaRow label="App" testId="suite-meta-app">
								<Text as="span">{suite.app.tagline}</Text>
								{origin ? (
									<>
										{' · '}
										<Box as="a" href={origin} target="_blank" rel="noreferrer noopener" color={INK} textDecoration="underline" data-testid="suite-meta-origin">
											the original ↗
										</Box>
									</>
								) : null}
							</MetaRow>
						) : null}
						<MetaRow label="Actions" testId="suite-meta-actions">
							{materialized.actions.length === 0
								? '—'
								: materialized.actions.map((action, index) => {
										const id = summary.actionIds[index];
										const name = actionNames[action.slug] || action.key;
										return seeded && id ? (
											<Chip key={action.key}>
												<Box as={Link} to={`/actions/${encodeURIComponent(id)}`} color={INK} _hover={{ textDecoration: 'underline' }} data-testid="suite-action-link">
													⚡ {name}
												</Box>
											</Chip>
										) : (
											<Chip key={action.key}>⚡ {name}</Chip>
										);
								  })}
						</MetaRow>
						<MetaRow label="Seeded" testId="demo-meta-seeded">
							{reconciled.seeded === null ? 'checking this deployment…' : seeded ? '🌱 yes — every page opens at /p/' : 'not on this deployment (install still works)'}
						</MetaRow>
						{suite.story.length ? (
							<Box paddingTop={1}>
								<Eyebrow>Story</Eyebrow>
								<Box as="ol" paddingLeft={4} marginTop={1} fontSize="xs" color={TEXT} lineHeight="1.6" data-testid="suite-meta-story">
									{suite.story.map((line, index) => (
										<li key={index}>{line}</li>
									))}
								</Box>
							</Box>
						) : null}
					</Flex>
				</Flex>
				<Flex flexDirection="column" rowGap={2} minWidth={0}>
					<PaneHeading title="Live" eyebrow={user?.id ? 'runs as you · owner-only resolution · installs on first run' : 'sign in to arm'} />
					{pages.length > 1 ? (
						<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center" role="tablist" aria-label={`${suite.title} pages`} data-testid="suite-page-tabs">
							{pages.map((page) => (
								<Flex key={page.key} alignItems="center" columnGap={1}>
									<Button role="tab" aria-selected={page.key === active.key} size="xs" sx={chipSx(page.key === active.key)} onClick={() => setActiveKey(page.key)} data-testid={`suite-page-tab-${page.key}`}>
										{page.name}
									</Button>
									{seeded ? (
										<Button as={Link} to={`/p/${encodeURIComponent(page.pageKey)}`} size="xs" variant="ghost" paddingX={1} aria-label={`Open /p/${page.pageKey}`} title={`/p/${page.pageKey}`} data-testid={`suite-page-open-${page.key}`}>
											↗
										</Button>
									) : null}
								</Flex>
							))}
						</Flex>
					) : null}
					<LivePane
						key={active.key}
						pageId={runtime.pageId}
						pageKey={active.pageKey}
						suiteKey={suite.key}
						source={runtime.source}
						onInstall={onInstall}
						blocks={active.blocks}
						componentsByRef={componentsByRef}
						background={active.previewBg}
						onUnowned={onUnowned}
						actionNames={actionNames}
						what={isApp ? 'this app' : 'this suite'}
					/>
				</Flex>
			</Box>
		</>
	);
};

// ── the route ───────────────────────────────────────────────────────────────

export const DemoDetailPage = () => {
	const { slug = '' } = useParams();
	const entry = React.useMemo(() => resolveDemoEntry(slug, ALL_SUITES), [slug]);
	const title = entry ? (entry.kind === 'demo' ? entry.demo.name : `${entry.suite.emoji} ${entry.suite.title}`) : null;

	React.useEffect(() => {
		if (typeof document !== 'undefined') document.title = `${title || 'Demo not found'} · Builder demos · Thingtime`;
	}, [title]);

	if (!entry) {
		return (
			<PageShell width={680}>
				<Flex flexDirection="column" rowGap={2} paddingTop={12} alignItems="center" textAlign="center" data-testid="demo-not-found">
					<Text fontSize="3xl">🫧</Text>
					<Text color={INK} fontFamily="heading" fontSize="xl" fontWeight={800}>
						This demo isn’t here
					</Text>
					<Text color={TEXT} fontSize="sm">
						No demo, suite, or app is called “{slug.slice(0, 80)}”. It may have been renamed, or never existed.
					</Text>
					<Button as={Link} to={DEMO_LIBRARY_PATH} size="sm" marginTop={2} data-testid="demo-not-found-back">
						← Back to the demo library
					</Button>
				</Flex>
			</PageShell>
		);
	}

	return (
		<PageShell width={1280}>
			{entry.kind === 'demo' ? <DemoView key={entry.slug} demo={entry.demo} slug={entry.slug} /> : <SuiteView key={entry.slug} suite={entry.suite} />}
		</PageShell>
	);
};
