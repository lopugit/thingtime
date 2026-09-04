import React from 'react';
import { Box, Button, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Text } from '@chakra-ui/react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { materializeSuite, summarizeBehaviourSuite, type BehaviourSuite, type MaterializedSuite } from '~/schemas/behaviourSuites';
// the REGISTRY module (not just the lookups): importing it registers the app
// suites, so the gallery lists Pokeworld and StarsAlign on a cold load
import { ALL_SUITES } from '~/schemas/appSuites/index';
import { installSuite as installSuiteThings, installSuiteOnServer, suiteKeyFromActionKey } from './installSuite';
import {
	WEBPAGE_DEMO_FAMILIES,
	countDemoBlocks,
	getWebpageDemos,
	webpageDemoPageKey,
	webpageDemoShareId,
	type WebpageDemo
} from '~/schemas/webpageDemos';
import { CARD_STYLES } from '../../theme/card';
import { PageHeader, PageShell } from '../Layout/PageShell';
import { useActionRunConfirm } from '../Actions/ActionRunConfirm';
import { WebpageBlocksRenderer, buildComponentsByRef, type ComponentsByRef, type WebpageBlocksRendererProps } from './WebpageBlocksRenderer';
import { WebpageRuntimeProvider } from './webpageRuntime';
import {
	KIND_FILTERS,
	KIND_LABELS,
	demoDetailHref,
	demoMatchesSearch,
	isSuiteKind,
	parseKindFilter,
	runtimeIdentityFor,
	suiteActionNames,
	suiteComponentsByRef,
	suiteKindLabel,
	suiteMatchesSearch,
	suitesForKind,
	templateCrystalOf,
	type KindFilter
} from './demoDetail';
import type { WebpageBlock } from './webpageBlocks';

// /builder/demos — the builder DEMO LIBRARY: every catalog demo (sections,
// full pages, component-block pages) as a live scaled thumbnail, filterable by
// family/kind/search, plus the BEHAVIOUR SUITES, INTERACTIVE suites, and APPS
// tabs (schemas + components + actions + data + page bundles). The catalogs
// are code (schemas/webpageDemos, schemas/behaviourSuites, schemas/appSuites),
// so the gallery paints instantly from the modules; GET /api/v1/webpages/demos
// then reconciles which entries are seeded on this deployment (those open at
// /p/ and in the builder directly) and hands back the platform library
// components the component-kind demos reference — the one part of a demo that
// lives in the DB rather than in code. "Use this template" clones a demo, and
// "Install suite" clones a whole bundle, into the viewer's own things through
// the ordinary things write path — the same call the builder's New page makes
// — so both work before any seed runs and never mutate the shared seed.
//
// Every card is a LINK to the entry's own page (/builder/demos/<slug>) —
// browse cards stay inert; the dedicated page (and the Preview modal here)
// is where a block tree goes live. TRUST RULE for the modal: a catalog-
// compiled block tree is platform-curated (it is code in this repository,
// seeded system-owned), so it renders live for any signed-in viewer, with the
// catalog-side run confirmation and, for suites, run-or-install. Ownership or
// curation decide interactivity — never markup.

const PAGE_SIZE = 36;
const THUMB_WIDTH = 760;
const THUMB_SCALE = 0.42;
const THUMB_HEIGHT = 200;

type SeededState = { seeded: Set<string>; suites: Set<string>; seededCount: number; total: number };

type Preview = { kind: 'demo'; demo: WebpageDemo } | { kind: 'suite'; suite: BehaviourSuite; materialized: MaterializedSuite };

const chipSx = (active: boolean) => ({
	borderRadius: '999px',
	border: '1px solid var(--tt-border, #ececef)',
	background: active ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-raised, #ffffff)',
	color: active ? 'var(--tt-surface, #fafafb)' : 'var(--tt-text, #5a5a66)',
	fontSize: '13px',
	fontWeight: 600,
	paddingX: 3,
	height: '30px',
	minHeight: '30px',
	_hover: { background: active ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-sunken, #f1f1f4)' }
});

export type DemoBlockList = WebpageDemo['blocks'];

// Scaled live render of a block tree — INERT (no click wrapper, no runtime),
// the catalog's picture of a page. Mounts once scrolled near the viewport (a
// few hundred renderers at once would be wasteful) and stays mounted after —
// no flicker while filtering. Shared with the dedicated demo page's PREVIEW
// pane, which is the same picture at a taller height.
export const DemoThumb = ({
	blocks,
	background,
	componentsByRef,
	height = THUMB_HEIGHT
}: {
	blocks: DemoBlockList;
	background: string;
	componentsByRef?: ComponentsByRef;
	height?: number;
}) => {
	const ref = React.useRef<HTMLDivElement | null>(null);
	const [visible, setVisible] = React.useState(false);
	// the canvas is laid out at THUMB_WIDTH and scaled to the card: a fixed
	// scale clipped the right edge wherever the grid's minmax gave a card less
	// than 760 × scale, so the scale follows the measured box width instead
	const [scale, setScale] = React.useState(THUMB_SCALE);

	React.useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const fit = () => {
			const width = node.clientWidth;
			if (width > 0) setScale(Math.min(1, width / THUMB_WIDTH));
		};
		fit();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(fit);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	React.useEffect(() => {
		const node = ref.current;
		if (!node || visible) return;
		if (typeof IntersectionObserver === 'undefined') {
			setVisible(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
			},
			{ rootMargin: '400px 0px' }
		);
		observer.observe(node);
		// browsers throttle observer callbacks in hidden/background documents —
		// a card that is on screen must never stay blank, so a page that loads
		// while hidden mounts its (paginated) cards on a short fallback timer;
		// a visible document keeps the lazy observer path for off-screen cards
		const fallback = document.visibilityState === 'hidden' ? window.setTimeout(() => setVisible(true), 1200) : null;
		return () => {
			observer.disconnect();
			if (fallback !== null) window.clearTimeout(fallback);
		};
	}, [visible]);

	return (
		<Box
			ref={ref}
			height={`${height}px`}
			overflow="hidden"
			borderRadius="12px"
			background={background}
			border="1px solid var(--tt-border, #ececef)"
			pointerEvents="none"
			userSelect="none"
			data-testid="demo-thumb"
		>
			{visible ? (
				<Box width={`${THUMB_WIDTH}px`} transform={`scale(${scale})`} transformOrigin="top left" padding="20px 24px">
					<WebpageBlocksRenderer blocks={blocks as WebpageBlock[]} componentsByRef={componentsByRef || {}} />
				</Box>
			) : null}
		</Box>
	);
};

// the card title/thumbnail links: real anchors (middle-click and keyboard
// work) to the entry's own page; the buttons beside them are siblings, not
// descendants, so they never bubble into the link
const cardLinkSx = { _hover: { textDecoration: 'none', opacity: 0.92 }, _focusVisible: { outline: '2px solid var(--tt-ink, #16161a)', outlineOffset: '2px', borderRadius: '12px' } };

const DemoCard = ({
	demo,
	seeded,
	onPreview,
	onUse,
	busy,
	componentsByRef
}: {
	demo: WebpageDemo;
	seeded: boolean;
	onPreview: () => void;
	onUse: () => void;
	busy: boolean;
	componentsByRef: ComponentsByRef;
}) => {
	const family = WEBPAGE_DEMO_FAMILIES.find((entry) => entry.key === demo.family);
	const id = webpageDemoShareId(demo.slug);
	const href = demoDetailHref(demo.slug);
	const blockCount = React.useMemo(() => countDemoBlocks(demo.blocks), [demo.blocks]);
	return (
		<Flex {...CARD_STYLES} flexDirection="column" rowGap={3} padding={3} minWidth={0} data-testid="demo-card" data-demo-slug={demo.slug}>
			<Box as={Link} to={href} display="block" aria-label={`Open ${demo.name}`} sx={cardLinkSx} data-testid="demo-card-thumb-link">
				<DemoThumb blocks={demo.blocks} background={demo.previewBg} componentsByRef={componentsByRef} />
			</Box>
			<Flex flexDirection="column" rowGap={1} minWidth={0}>
				<Text as={Link} to={href} color="var(--tt-ink, #16161a)" fontWeight={700} fontSize="sm" noOfLines={1} minWidth={0} sx={cardLinkSx} data-testid="demo-card-title-link">
					{demo.name}
				</Text>
				<Flex alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1}>
					<Text fontSize="11px" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" color="var(--tt-muted, #9a9aa6)" textTransform="uppercase" letterSpacing="0.08em">
						{family?.emoji} {family?.title || demo.family}
					</Text>
					<Text fontSize="11px" color="var(--tt-muted, #9a9aa6)">
						· {blockCount} block{blockCount === 1 ? '' : 's'}
					</Text>
					{seeded ? (
						<Text fontSize="11px" color="var(--tt-muted, #9a9aa6)" title="Seeded on this deployment — opens at /p/ and in the builder">
							· 🌱 seeded
						</Text>
					) : null}
				</Flex>
			</Flex>
			<Flex columnGap={2} rowGap={2} flexWrap="wrap">
				<Button size="xs" variant="outline" onClick={onPreview} data-testid="demo-preview">
					Preview
				</Button>
				<Button size="xs" onClick={onUse} isLoading={busy} data-testid="demo-use">
					Use template ✨
				</Button>
				{seeded ? (
					<Button as={Link} to={`/p/${encodeURIComponent(id)}`} size="xs" variant="ghost" data-testid="demo-open-p">
						/p/ ↗
					</Button>
				) : null}
			</Flex>
		</Flex>
	);
};

const SuiteCard = ({ suite, seeded, onPreview, onInstall, busy }: { suite: BehaviourSuite; seeded: boolean; onPreview: () => void; onInstall: () => void; busy: boolean }) => {
	const summary = React.useMemo(() => summarizeBehaviourSuite(suite), [suite]);
	const materialized = React.useMemo(() => materializeSuite(suite, 'own'), [suite]);
	const componentsByRef = React.useMemo(() => suiteComponentsByRef(materialized), [materialized]);
	const counts = summary.counts;
	const href = demoDetailHref(suite.key);
	return (
		<Flex {...CARD_STYLES} flexDirection="column" rowGap={3} padding={3} minWidth={0} data-testid="suite-card" data-suite-key={suite.key}>
			<Box as={Link} to={href} display="block" aria-label={`Open ${suite.title}`} sx={cardLinkSx} data-testid="suite-card-thumb-link">
				<DemoThumb blocks={materialized.page.crystal.blocks as DemoBlockList} background={String(materialized.page.crystal.previewBg || 'var(--tt-surface, #fafafb)')} componentsByRef={componentsByRef} />
			</Box>
			<Flex flexDirection="column" rowGap={1} minWidth={0}>
				<Text as={Link} to={href} color="var(--tt-ink, #16161a)" fontWeight={700} fontSize="sm" noOfLines={1} sx={cardLinkSx} data-testid="suite-card-title-link">
					{suite.emoji} {suite.title}
				</Text>
				<Text color="var(--tt-text, #5a5a66)" fontSize="xs" noOfLines={2}>
					{suite.description}
				</Text>
				<Text fontSize="11px" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" color="var(--tt-muted, #9a9aa6)" textTransform="uppercase" letterSpacing="0.08em">
					{counts.schemas} schema{counts.schemas === 1 ? '' : 's'} · {counts.components} control{counts.components === 1 ? '' : 's'} · {counts.actions} action{counts.actions === 1 ? '' : 's'} · {suite.app ? `${counts.pages} pages` : `${counts.data} data`}
					{seeded ? ' · 🌱 seeded' : ''}
				</Text>
				{suite.app ? (
					<Text color="var(--tt-text, #5a5a66)" fontSize="xs">
						{suite.app.tagline}
					</Text>
				) : null}
			</Flex>
			<Flex columnGap={2} rowGap={2} flexWrap="wrap">
				<Button size="xs" variant="outline" onClick={onPreview} data-testid="suite-preview">
					Preview
				</Button>
				{suite.app && seeded ? (
					<Button as={Link} to={`/p/${encodeURIComponent(summary.pageKey)}`} size="xs" variant="ghost" data-testid="suite-open-app">
						Open /p/{summary.pageKey} ↗
					</Button>
				) : null}
				<Button size="xs" onClick={onInstall} isLoading={busy} data-testid="suite-install">
					{suite.app ? 'Install app ✨' : 'Install suite ✨'}
				</Button>
				{seeded ? (
					<>
						<Button as={Link} to={`/p/${encodeURIComponent(summary.pageId)}`} size="xs" variant="ghost" data-testid="suite-open-p">
							/p/ ↗
						</Button>
						{/* nothing enforces that a suite declares an action, and
						    encodeURIComponent(undefined) is the string "undefined" —
						    a zero-action suite would ship a link to /actions/undefined */}
						{summary.actionIds[0] ? (
							<Button as={Link} to={`/actions/${encodeURIComponent(summary.actionIds[0])}`} size="xs" variant="ghost" data-testid="suite-open-action">
								⚡ /actions
							</Button>
						) : null}
					</>
				) : null}
			</Flex>
		</Flex>
	);
};

const searchPlaceholderFor = (kind: KindFilter): string => {
	if (kind === 'app') return 'Search apps — pokeworld, starsalign…';
	if (kind === 'interactive') return 'Search interactive suites — calculator, converter…';
	if (kind === 'suite') return 'Search suites — guestbook, orders…';
	return 'Search demos — hero, pricing, ink…';
};

const suiteNounFor = (kind: KindFilter): string => (kind === 'app' ? 'app' : kind === 'interactive' ? 'interactive suite' : 'suite');

export default function DemoLibraryPage() {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const user = useCurrentUser();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();

	const demos = React.useMemo(() => getWebpageDemos(), []);
	const family = searchParams.get('family') || '';
	const kind = parseKindFilter(searchParams.get('kind'));
	const suiteKind = isSuiteKind(kind);
	const [search, setSearch] = React.useState(searchParams.get('q') || '');
	const [shown, setShown] = React.useState(PAGE_SIZE);
	const [seededState, setSeededState] = React.useState<SeededState>({ seeded: new Set(), suites: new Set(), seededCount: 0, total: demos.length });
	// the platform library components the component-kind demos reference — the
	// catalog can paint everything else from code, but these live in the DB, so
	// they arrive with the same reconcile that brings the seeded flags
	const [libraryComponents, setLibraryComponents] = React.useState<ComponentsByRef>({});
	const [preview, setPreview] = React.useState<Preview | null>(null);
	const [busyKey, setBusyKey] = React.useState<string | null>(null);
	const [seeding, setSeeding] = React.useState(false);

	// The post-install hand-off waits so the "installed ✨" toast is readable
	// before the gallery navigates. That timer OUTLIVES this page if the viewer
	// leaves inside the delay, and it would then pull them off whatever they
	// opened next. Held in a ref so unmount cancels the pending hand-off.
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

	const setParam = (key: string, value: string) => {
		const next = new URLSearchParams(searchParams);
		if (value) next.set(key, value);
		else next.delete(key);
		setSearchParams(next, { replace: true });
		setShown(PAGE_SIZE);
	};

	const refreshSeeded = React.useCallback(async () => {
		try {
			const response = await fetch('/api/v1/webpages/demos', { credentials: 'include' });
			if (!response.ok) return;
			const data = await response.json();
			if (!data?.ok || !Array.isArray(data.demos)) return;
			setLibraryComponents(buildComponentsByRef(data));
			setSeededState({
				seeded: new Set(data.demos.filter((entry: any) => entry.seeded).map((entry: any) => entry.slug)),
				suites: new Set((Array.isArray(data.suites) ? data.suites : []).filter((entry: any) => entry.seeded).map((entry: any) => entry.key)),
				seededCount: Number(data.seededCount) || 0,
				total: Number(data.total) || demos.length
			});
		} catch {
			// the catalog already painted — seeded flags are a progressive detail
		}
	}, [demos.length]);

	React.useEffect(() => {
		refreshSeeded();
	}, [refreshSeeded]);

	React.useEffect(() => {
		if (typeof document !== 'undefined') document.title = 'Builder demos · Thingtime';
	}, []);

	const familyCounts = React.useMemo(() => {
		const counts = new Map<string, number>();
		for (const demo of demos) counts.set(demo.family, (counts.get(demo.family) || 0) + 1);
		return counts;
	}, [demos]);

	const needle = search.trim().toLowerCase();
	const filtered = React.useMemo(() => {
		if (suiteKind) return [];
		return demos.filter((demo) => (!family || demo.family === family) && (kind === 'all' || demo.kind === kind) && demoMatchesSearch(demo, needle));
	}, [demos, family, kind, needle, suiteKind]);
	const filteredSuites = React.useMemo(() => (suiteKind ? suitesForKind(kind, ALL_SUITES).filter((suite) => suiteMatchesSearch(suite, needle)) : []), [kind, needle, suiteKind]);

	const visible = filtered.slice(0, shown);

	const requireUser = (what: string): boolean => {
		if (user?.id) return true;
		lopu({ title: `Sign in to ${what} 🗝️`, description: 'Demos become things in your own library.', status: 'info' });
		navigate('/login');
		return false;
	};

	const copyTemplate = async (demo: WebpageDemo) => {
		if (!requireUser('use a template')) return;
		setBusyKey(demo.slug);
		try {
			const resp: any = await apiRef.current.v1.things.create({
				thingtime: ['webpage'],
				crystal: templateCrystalOf(demo, { seeded: seededState.seeded.has(demo.slug) }),
				acl: ['tt:user']
			});
			if (!resp?.ok) throw resp;
			const id = resp?.thing?.id || resp?.id;
			lopu({ title: 'Template copied into your pages 🧱✨', status: 'success' });
			setPreview(null);
			navigate(`/builder?page=${encodeURIComponent(id)}`);
		} catch (err: any) {
			lopu({ title: err?.error || 'Couldn’t copy the template — try again 🌈', status: 'error' });
		} finally {
			setBusyKey(null);
		}
	};

	// Install = the suite's OWN-mode bundle created part by part through the
	// ordinary things write path, in dependency order: schemas (their ids
	// stamp the data), components, actions, data, then the page. The page's
	// controls then run the viewer's own actions (owner-only resolution).
	const installSuite = async (suite: BehaviourSuite): Promise<boolean> => {
		if (!requireUser('install a suite')) return false;
		setBusyKey(`suite:${suite.key}`);
		try {
			if (suite.app) {
				// an APP: one idempotent server install (every page keeps its key),
				// then the entry page — the same URL now serves the viewer's copy
				const installed = await installSuiteOnServer(suite.key);
				lopu({
					title: `${suite.emoji} ${suite.title} installed ✨`,
					description: `${installed.created} things created · ${installed.updated} refreshed — opening your copy at /p/${installed.entryPageKey}.`,
					status: 'success',
					duration: 8000
				});
				setPreview(null);
				navigate(`/p/${encodeURIComponent(installed.entryPageKey)}`);
				return true;
			}
			const installed = await installSuiteThings((payload) => apiRef.current.v1.things.create(payload), suite, { seeded: seededState.suites.has(suite.key) });
			const bundle = materializeSuite(suite, 'own');
			const pageId = installed.pageId;
			lopu({
				title: `${suite.emoji} ${suite.title} installed ✨`,
				description: `${bundle.schemas.length} schemas · ${bundle.components.length} controls · ${bundle.actions.length} actions · ${bundle.data.length} data things · 1 page — tap a control to run your program.`,
				status: 'success',
				duration: 8000
			});
			setPreview(null);
			navigate(`/p/${encodeURIComponent(pageId)}`);
			return true;
		} catch (err: any) {
			lopu({ title: err?.error || 'Couldn’t install the suite — try again 🌈', description: err?.error ? undefined : 'Some parts may have been created; check /things.', status: 'error' });
			return false;
		} finally {
			setBusyKey(null);
		}
	};

	// a control clicked in a suite preview: a signed-in viewer with no copy of
	// the program gets the suite installed on the spot, the same click re-runs,
	// and their own page opens — the modal's controls are never inert for them
	const onPreviewUnowned = React.useCallback(
		async (action: string): Promise<boolean> => {
			const key = suiteKeyFromActionKey(action, ALL_SUITES) || (preview?.kind === 'suite' ? preview.suite.key : null);
			const suite = key ? ALL_SUITES.find((entry) => entry.key === key) : null;
			if (!suite || !user?.id) return false;
			if (suite.app) {
				const installed = await installSuiteOnServer(suite.key);
				lopu({ title: `${suite.emoji} ${suite.title} installed ✨`, description: `Opening your copy at /p/${installed.entryPageKey}.`, status: 'success', duration: 6000 });
				scheduleHandoff(() => navigate(`/p/${encodeURIComponent(installed.entryPageKey)}`), 800);
				return true;
			}
			lopu({ title: `Installing the ${suite.emoji} ${suite.title} suite…`, description: 'Your own schemas, controls, actions, and sample data.', status: 'info', duration: 4000 });
			const installed = await installSuiteThings((payload) => apiRef.current.v1.things.create(payload), suite, { seeded: seededState.suites.has(suite.key) });
			lopu({
				title: `${suite.emoji} ${suite.title} installed ✨`,
				description: 'Running your click now — your own copy of the page is one tap away.',
				status: 'success',
				duration: 8000,
				link: { label: 'Open my page', href: `/p/${encodeURIComponent(installed.pageId)}` }
			});
			return true;
		},
		[lopu, navigate, preview, scheduleHandoff, seededState.suites, user?.id]
	);

	// the `$install` pseudo-action a suite page may render (the runtime's
	// install hook): the same install the button runs, read through a ref so
	// the hook sees the latest seeded flags without re-creating per render
	const installSuiteRef = React.useRef(installSuite);
	installSuiteRef.current = installSuite;
	const previewSuite = preview?.kind === 'suite' ? preview.suite : null;
	const onPreviewInstall = React.useCallback(async (): Promise<boolean> => (previewSuite ? installSuiteRef.current(previewSuite) : false), [previewSuite]);

	const seedDemos = async () => {
		setSeeding(true);
		try {
			const response = await fetch('/api/v1/admin/webpages/seed-demos', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
			const data = await response.json().catch(() => null);
			if (!response.ok || !data?.ok) throw data;
			lopu({ title: `Demo library seeded 🌱 ${data.created} new · ${data.refreshed} refreshed · ${data.unchanged} unchanged`, status: 'success' });
			await refreshSeeded();
		} catch (err: any) {
			lopu({ title: err?.error || 'Seeding failed — check the admin allowlist 🌱', status: 'error' });
		} finally {
			setSeeding(false);
		}
	};

	const previewBlocks = preview ? (preview.kind === 'demo' ? preview.demo.blocks : (preview.materialized.page.crystal.blocks as DemoBlockList)) : [];
	const previewBg = preview ? (preview.kind === 'demo' ? preview.demo.previewBg : String(preview.materialized.page.crystal.previewBg || '')) : '';
	const previewComponents = React.useMemo(
		() => (preview?.kind === 'suite' ? suiteComponentsByRef(preview.materialized) : libraryComponents),
		[preview, libraryComponents]
	);
	const previewSeeded = preview ? (preview.kind === 'demo' ? seededState.seeded.has(preview.demo.slug) : seededState.suites.has(preview.suite.key)) : false;
	const previewSeededId = preview ? (preview.kind === 'demo' ? webpageDemoShareId(preview.demo.slug) : preview.materialized.page.shareId) : '';
	const previewPageKey = preview ? (preview.kind === 'demo' ? webpageDemoPageKey(preview.demo.slug) : String(preview.materialized.page.crystal.pageKey || '')) : '';
	const previewSlug = preview ? (preview.kind === 'demo' ? preview.demo.slug : preview.suite.key) : '';
	// the runtime identity of the modal's render: the seeded copy's when it
	// exists on this deployment, else a catalog: id (see demoDetail.ts)
	const previewRuntime = runtimeIdentityFor({ pageKey: previewPageKey, shareId: previewSeededId }, previewSeeded);
	const previewActionNames = React.useMemo(() => (preview?.kind === 'suite' ? suiteActionNames(preview.materialized) : {}), [preview]);
	// the catalog-side run confirmation: the first press of each control
	// names what will run before anything executes (ActionRunConfirm)
	const { confirm: previewConfirm, dialog: previewConfirmDialog } = useActionRunConfirm({
		resolveActionName: (action) => previewActionNames[action] || null
	});
	// `confirm` is not a WebpageBlocksRenderer prop yet — it is threaded here
	// so the gate arms the moment the renderer forwards it to ComponentBlockView
	// (useTtActionClicks already accepts it); until then the dialog stays idle
	const previewRendererProps: WebpageBlocksRendererProps & { confirm: typeof previewConfirm } = {
		blocks: previewBlocks as WebpageBlock[],
		componentsByRef: previewComponents,
		// platform-curated → live for any signed-in viewer (see the header note)
		interactive: !!user?.id,
		onTtActionUnowned: preview?.kind === 'suite' ? onPreviewUnowned : undefined,
		confirm: previewConfirm
	};
	const notSeeded = seededState.total + ALL_SUITES.length - seededState.seededCount - seededState.suites.size;

	return (
		<PageShell width={1280}>
			<PageHeader
				eyebrow="Thingtime · builder"
				title="Demo library 🧱✨"
				subtitle={`${demos.length} example sections, pages, and component compositions, plus ${ALL_SUITES.length} behaviour suites, interactive suites, and apps that wire schemas, actions, and controls into working programs — open any of them on its own page, preview it live, then make it yours with one tap.`}
				after={
					<Flex columnGap={2} alignItems="center">
						<Button as={Link} to="/builder" size="sm" variant="outline" data-testid="demos-back-to-builder">
							← Builder
						</Button>
						{user?.isAdmin && notSeeded > 0 ? (
							<Button size="sm" onClick={seedDemos} isLoading={seeding} data-testid="demos-seed">
								Seed {notSeeded} demos 🌱
							</Button>
						) : null}
					</Flex>
				}
			/>

			<Flex flexDirection="column" rowGap={3}>
				<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
					{KIND_FILTERS.map((entry) => (
						<Button key={entry} size="xs" sx={chipSx(kind === entry)} onClick={() => setParam('kind', entry === 'all' ? '' : entry)} data-testid={`demos-kind-${entry}`}>
							{KIND_LABELS[entry]}
						</Button>
					))}
					<Input
						size="sm"
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
							setShown(PAGE_SIZE);
						}}
						placeholder={searchPlaceholderFor(kind)}
						maxWidth="280px"
						marginLeft={{ base: 0, md: 'auto' }}
						borderRadius="999px"
						data-testid="demos-search"
					/>
				</Flex>
				{suiteKind ? (
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" data-testid="demos-count">
						{filteredSuites.length} {suiteNounFor(kind)}{filteredSuites.length === 1 ? '' : 's'} · each installs its schemas, controls, actions, sample data, and page into your own things · {seededState.suites.size}/{ALL_SUITES.length} seeded on this deployment
					</Text>
				) : (
					<>
						<Flex columnGap={2} rowGap={2} flexWrap="wrap">
							<Button size="xs" sx={chipSx(!family)} onClick={() => setParam('family', '')} data-testid="demos-family-all">
								All · {demos.length}
							</Button>
							{WEBPAGE_DEMO_FAMILIES.filter((entry) => kind === 'all' || entry.kind === kind).map((entry) => (
								<Button key={entry.key} size="xs" sx={chipSx(family === entry.key)} onClick={() => setParam('family', family === entry.key ? '' : entry.key)} data-testid={`demos-family-${entry.key}`}>
									{entry.emoji} {entry.title} · {familyCounts.get(entry.key) || 0}
								</Button>
							))}
						</Flex>
						<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" data-testid="demos-count">
							{filtered.length} demo{filtered.length === 1 ? '' : 's'}
							{family ? ` in ${WEBPAGE_DEMO_FAMILIES.find((entry) => entry.key === family)?.title}` : ''} · {seededState.seededCount}/{seededState.total} seeded on this deployment
						</Text>
					</>
				)}
			</Flex>

			{suiteKind ? (
				filteredSuites.length === 0 ? (
					<Flex {...CARD_STYLES} padding={6} flexDirection="column" rowGap={2}>
						<Text color="var(--tt-ink, #16161a)" fontWeight={700}>
							No {suiteNounFor(kind)} matches 🫧
						</Text>
						{kind === 'interactive' && !needle ? (
							<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
								Interactive suites land as they are written — try the behaviour suites or the apps meanwhile.
							</Text>
						) : null}
					</Flex>
				) : (
					<Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(300px, 1fr))" gap={4} data-testid="suites-grid">
						{filteredSuites.map((suite) => (
							<SuiteCard
								key={suite.key}
								suite={suite}
								seeded={seededState.suites.has(suite.key)}
								onPreview={() => setPreview({ kind: 'suite', suite, materialized: materializeSuite(suite, 'own') })}
								onInstall={() => installSuite(suite)}
								busy={busyKey === `suite:${suite.key}`}
							/>
						))}
					</Box>
				)
			) : filtered.length === 0 ? (
				<Flex {...CARD_STYLES} padding={6} flexDirection="column" rowGap={2}>
					<Text color="var(--tt-ink, #16161a)" fontWeight={700}>
						Nothing matches 🫧
					</Text>
					<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
						Try another family, or clear the search.
					</Text>
				</Flex>
			) : (
				<Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(300px, 1fr))" gap={4} data-testid="demos-grid">
					{visible.map((demo) => (
						<DemoCard
							key={demo.slug}
							demo={demo}
							seeded={seededState.seeded.has(demo.slug)}
							onPreview={() => setPreview({ kind: 'demo', demo })}
							onUse={() => copyTemplate(demo)}
							busy={busyKey === demo.slug}
							componentsByRef={libraryComponents}
						/>
					))}
				</Box>
			)}

			{!suiteKind && visible.length < filtered.length ? (
				<Flex justifyContent="center">
					<Button variant="outline" size="sm" onClick={() => setShown((count) => count + PAGE_SIZE)} data-testid="demos-show-more">
						Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more ({filtered.length - visible.length} left)
					</Button>
				</Flex>
			) : null}

			<Modal isOpen={!!preview} onClose={() => setPreview(null)} size="6xl" scrollBehavior="inside">
				<ModalOverlay />
				<ModalContent background={previewBg || 'var(--tt-surface, #fafafb)'} borderRadius="20px" marginX={{ base: 2, md: 6 }}>
					<ModalHeader paddingBottom={2}>
						<Flex flexDirection="column" rowGap={1} paddingRight={8}>
							<Text fontSize="lg" fontWeight={800} color="var(--tt-ink, #16161a)" noOfLines={1}>
								{preview?.kind === 'demo' ? preview.demo.name : preview ? `${preview.suite.emoji} ${preview.suite.title} · ${suiteKindLabel(preview.suite)}` : ''}
							</Text>
							<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" fontWeight={400}>
								{preview?.kind === 'demo'
									? `${preview.demo.description} ${user?.id ? 'This preview is live — controls run as you.' : 'Sign in to try its controls live.'}`
									: preview
										? `${preview.suite.description} ${user?.id ? 'Tap a control: it installs the suite as your own programs and runs.' : 'Sign in and tap a control to install the suite as your own programs.'}`
										: ''}
							</Text>
							<Flex columnGap={2} rowGap={2} flexWrap="wrap" marginTop={2}>
								{preview?.kind === 'demo' ? (
									<Button size="xs" onClick={() => copyTemplate(preview.demo)} isLoading={busyKey === preview.demo.slug} data-testid="demo-modal-use">
										Use template ✨
									</Button>
								) : preview ? (
									<Button size="xs" onClick={() => installSuite(preview.suite)} isLoading={busyKey === `suite:${preview.suite.key}`} data-testid="suite-modal-install">
										{preview.suite.app ? 'Install app ✨' : 'Install suite ✨'}
									</Button>
								) : null}
								{preview ? (
									<Button as={Link} to={demoDetailHref(previewSlug)} size="xs" variant="outline" data-testid="preview-open-page">
										Open its page ↗
									</Button>
								) : null}
								{preview && previewSeeded ? (
									<>
										<Button as={Link} to={`/p/${encodeURIComponent(previewSeededId)}`} size="xs" variant="outline">
											Open /p/ ↗
										</Button>
										<Button as={Link} to={`/builder?page=${encodeURIComponent(previewSeededId)}`} size="xs" variant="outline">
											Open in builder ✏️
										</Button>
									</>
								) : null}
							</Flex>
						</Flex>
					</ModalHeader>
					<ModalCloseButton />
					<ModalBody paddingBottom={8} data-testid="demo-modal-body">
						{preview ? (
							// the page runtime is what makes source-bound blocks fetch and
							// refetch after every control run — without it the render is
							// inert (sources never load, $refresh/$install no-op)
							<WebpageRuntimeProvider
								pageId={previewRuntime.pageId}
								pageKey={previewPageKey || null}
								suiteKey={preview.kind === 'suite' ? preview.suite.key : null}
								source={previewRuntime.source}
								onInstall={preview.kind === 'suite' ? onPreviewInstall : undefined}
							>
								<Box width="100%" maxWidth="960px" marginX="auto" whiteSpace="normal" minWidth={0}>
									<WebpageBlocksRenderer {...previewRendererProps} />
								</Box>
								{previewConfirmDialog}
							</WebpageRuntimeProvider>
						) : null}
					</ModalBody>
				</ModalContent>
			</Modal>
		</PageShell>
	);
}
