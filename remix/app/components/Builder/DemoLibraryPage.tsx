import React from 'react';
import { Box, Button, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Text } from '@chakra-ui/react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { BEHAVIOUR_SUITES, materializeSuite, summarizeBehaviourSuite, type BehaviourSuite, type MaterializedSuite } from '~/schemas/behaviourSuites';
import {
	WEBPAGE_DEMO_FAMILIES,
	countDemoBlocks,
	getWebpageDemos,
	webpageDemoCrystal,
	webpageDemoShareId,
	type WebpageDemo,
	type WebpageDemoKind
} from '~/schemas/webpageDemos';
import { CARD_STYLES } from '../../theme/card';
import { PageHeader, PageShell } from '../Layout/PageShell';
import { WebpageBlocksRenderer, buildComponentsByRef, type ComponentsByRef } from './WebpageBlocksRenderer';
import type { WebpageBlock } from './webpageBlocks';

// /builder/demos — the builder DEMO LIBRARY: every catalog demo (sections,
// full pages, component-block pages) as a live scaled thumbnail, filterable by
// family/kind/search, plus the BEHAVIOUR SUITES tab (schemas + components +
// actions + data + page bundles). The catalogs are code
// (schemas/webpageDemos, schemas/behaviourSuites), so the gallery paints
// instantly from the modules; GET /api/v1/webpages/demos then reconciles
// which entries are seeded on this deployment (those open at /p/ and in the
// builder directly) and hands back the platform library components the
// component-kind demos reference — the one part of a demo that lives in the
// DB rather than in code. "Use this template" clones a demo, and "Install suite"
// clones a whole bundle, into the viewer's own things through the ordinary
// things write path — the same call the builder's New page makes — so both
// work before any seed runs and never mutate the shared seed.

const PAGE_SIZE = 36;
const THUMB_WIDTH = 760;
const THUMB_SCALE = 0.42;
const THUMB_HEIGHT = 200;

type SeededState = { seeded: Set<string>; suites: Set<string>; seededCount: number; total: number };

type KindFilter = WebpageDemoKind | 'all' | 'suite';

const KIND_LABELS: Record<KindFilter, string> = { all: 'Everything', section: 'Sections', page: 'Pages', component: 'Component blocks', suite: '🧪 Behaviour suites' };

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

// A suite's controls render from the catalog's own component crystals, so a
// preview needs no resolve round trip and no seed.
const suiteComponentsByRef = (materialized: MaterializedSuite): ComponentsByRef => {
	const out: ComponentsByRef = {};
	for (const component of materialized.components) out[component.slug] = { id: component.slug, crystal: component.crystal };
	return out;
};

// Scaled live render of a block tree. Mounts once scrolled near the viewport
// (a few hundred renderers at once would be wasteful) and stays mounted after
// — no flicker while filtering.
const Thumb = ({ blocks, background, componentsByRef }: { blocks: DemoBlockList; background: string; componentsByRef?: ComponentsByRef }) => {
	const ref = React.useRef<HTMLDivElement | null>(null);
	const [visible, setVisible] = React.useState(false);

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
			height={`${THUMB_HEIGHT}px`}
			overflow="hidden"
			borderRadius="12px"
			background={background}
			border="1px solid var(--tt-border, #ececef)"
			pointerEvents="none"
			userSelect="none"
			data-testid="demo-thumb"
		>
			{visible ? (
				<Box width={`${THUMB_WIDTH}px`} transform={`scale(${THUMB_SCALE})`} transformOrigin="top left" padding="20px 24px">
					<WebpageBlocksRenderer blocks={blocks as WebpageBlock[]} componentsByRef={componentsByRef || {}} />
				</Box>
			) : null}
		</Box>
	);
};

type DemoBlockList = WebpageDemo['blocks'];

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
	const blockCount = React.useMemo(() => countDemoBlocks(demo.blocks), [demo.blocks]);
	return (
		<Flex {...CARD_STYLES} flexDirection="column" rowGap={3} padding={3} minWidth={0} data-testid="demo-card" data-demo-slug={demo.slug}>
			<Box cursor="pointer" onClick={onPreview} role="button" aria-label={`Preview ${demo.name}`}>
				<Thumb blocks={demo.blocks} background={demo.previewBg} componentsByRef={componentsByRef} />
			</Box>
			<Flex flexDirection="column" rowGap={1} minWidth={0}>
				<Text color="var(--tt-ink, #16161a)" fontWeight={700} fontSize="sm" noOfLines={1} minWidth={0}>
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
	return (
		<Flex {...CARD_STYLES} flexDirection="column" rowGap={3} padding={3} minWidth={0} data-testid="suite-card" data-suite-key={suite.key}>
			<Box cursor="pointer" onClick={onPreview} role="button" aria-label={`Preview ${suite.title} suite`}>
				<Thumb blocks={materialized.page.crystal.blocks as DemoBlockList} background={String(materialized.page.crystal.previewBg || 'var(--tt-surface, #fafafb)')} componentsByRef={componentsByRef} />
			</Box>
			<Flex flexDirection="column" rowGap={1} minWidth={0}>
				<Text color="var(--tt-ink, #16161a)" fontWeight={700} fontSize="sm" noOfLines={1}>
					{suite.emoji} {suite.title}
				</Text>
				<Text color="var(--tt-text, #5a5a66)" fontSize="xs" noOfLines={2}>
					{suite.description}
				</Text>
				<Text fontSize="11px" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" color="var(--tt-muted, #9a9aa6)" textTransform="uppercase" letterSpacing="0.08em">
					{counts.schemas} schema{counts.schemas === 1 ? '' : 's'} · {counts.components} control{counts.components === 1 ? '' : 's'} · {counts.actions} action{counts.actions === 1 ? '' : 's'} · {counts.data} data
					{seeded ? ' · 🌱 seeded' : ''}
				</Text>
			</Flex>
			<Flex columnGap={2} rowGap={2} flexWrap="wrap">
				<Button size="xs" variant="outline" onClick={onPreview} data-testid="suite-preview">
					Preview
				</Button>
				<Button size="xs" onClick={onInstall} isLoading={busy} data-testid="suite-install">
					Install suite ✨
				</Button>
				{seeded ? (
					<>
						<Button as={Link} to={`/p/${encodeURIComponent(summary.pageId)}`} size="xs" variant="ghost" data-testid="suite-open-p">
							/p/ ↗
						</Button>
						<Button as={Link} to={`/actions/${encodeURIComponent(summary.actionIds[0])}`} size="xs" variant="ghost" data-testid="suite-open-action">
							⚡ /actions
						</Button>
					</>
				) : null}
			</Flex>
		</Flex>
	);
};

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
	const kind = (searchParams.get('kind') || 'all') as KindFilter;
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
		if (kind === 'suite') return [];
		return demos.filter(
			(demo) =>
				(!family || demo.family === family) &&
				(kind === 'all' || demo.kind === kind) &&
				(!needle || demo.name.toLowerCase().includes(needle) || demo.tags.some((tag) => tag.includes(needle)) || demo.description.toLowerCase().includes(needle))
		);
	}, [demos, family, kind, needle]);
	const filteredSuites = React.useMemo(
		() =>
			kind === 'suite'
				? BEHAVIOUR_SUITES.filter((suite) => !needle || suite.title.toLowerCase().includes(needle) || suite.description.toLowerCase().includes(needle) || suite.key.includes(needle))
				: [],
		[kind, needle]
	);

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
			const { pageKey: _pageKey, ...crystal } = webpageDemoCrystal(demo) as Record<string, unknown> & { pageKey?: string };
			const resp: any = await apiRef.current.v1.things.create({
				thingtime: ['webpage'],
				crystal: {
					...crystal,
					name: demo.name,
					...(seededState.seeded.has(demo.slug) ? { forkOf: webpageDemoShareId(demo.slug) } : {})
				},
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
	const installSuite = async (suite: BehaviourSuite) => {
		if (!requireUser('install a suite')) return;
		setBusyKey(`suite:${suite.key}`);
		try {
			const bundle = materializeSuite(suite, 'own');
			const create = async (payload: Record<string, unknown>): Promise<string> => {
				const resp: any = await apiRef.current.v1.things.create(payload);
				if (!resp?.ok) throw resp;
				return resp?.thing?.id || resp?.id;
			};
			const schemaIds = new Map<string, string>();
			for (const schema of bundle.schemas) schemaIds.set(schema.key, await create({ thingtime: ['schema'], crystal: schema.crystal, acl: ['tt:user'] }));
			for (const component of bundle.components) await create({ thingtime: ['component'], crystal: component.crystal, acl: ['tt:user'] });
			for (const action of bundle.actions) await create({ thingtime: ['action'], crystal: action.crystal, acl: ['tt:user'] });
			for (const entry of bundle.data) {
				await create({ thingtime: ['data'], crystal: { ...entry.crystal, schemaId: schemaIds.get(entry.schemaKey) }, acl: ['tt:user'] });
			}
			const { pageKey: _pageKey, ...pageCrystal } = bundle.page.crystal as Record<string, unknown> & { pageKey?: string };
			const pageId = await create({
				thingtime: ['webpage'],
				crystal: { ...pageCrystal, ...(seededState.suites.has(suite.key) ? { forkOf: bundle.page.shareId } : {}) },
				acl: ['tt:user']
			});
			lopu({
				title: `${suite.emoji} ${suite.title} installed ✨`,
				description: `${bundle.schemas.length} schemas · ${bundle.components.length} controls · ${bundle.actions.length} actions · ${bundle.data.length} data things · 1 page — tap a control to run your program.`,
				status: 'success',
				duration: 8000
			});
			setPreview(null);
			navigate(`/p/${encodeURIComponent(pageId)}`);
		} catch (err: any) {
			lopu({ title: err?.error || 'Couldn’t install the suite — try again 🌈', description: err?.error ? undefined : 'Some parts may have been created; check /things.', status: 'error' });
		} finally {
			setBusyKey(null);
		}
	};

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
	const notSeeded = seededState.total + BEHAVIOUR_SUITES.length - seededState.seededCount - seededState.suites.size;

	return (
		<PageShell width={1280}>
			<PageHeader
				eyebrow="Thingtime · builder"
				title="Demo library 🧱✨"
				subtitle={`${demos.length} example sections, pages, and component compositions, plus ${BEHAVIOUR_SUITES.length} behaviour suites that wire schemas, actions, and controls into working programs — preview any of them, then make it yours with one tap.`}
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
					{(['all', 'section', 'page', 'component', 'suite'] as const).map((entry) => (
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
						placeholder={kind === 'suite' ? 'Search suites — guestbook, orders…' : 'Search demos — hero, pricing, ink…'}
						maxWidth="280px"
						marginLeft={{ base: 0, md: 'auto' }}
						borderRadius="999px"
						data-testid="demos-search"
					/>
				</Flex>
				{kind === 'suite' ? (
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" data-testid="demos-count">
						{filteredSuites.length} suite{filteredSuites.length === 1 ? '' : 's'} · each installs its schemas, controls, actions, sample data, and page into your own things · {seededState.suites.size}/{BEHAVIOUR_SUITES.length} seeded on this deployment
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

			{kind === 'suite' ? (
				filteredSuites.length === 0 ? (
					<Flex {...CARD_STYLES} padding={6} flexDirection="column" rowGap={2}>
						<Text color="var(--tt-ink, #16161a)" fontWeight={700}>
							No suite matches 🫧
						</Text>
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

			{kind !== 'suite' && visible.length < filtered.length ? (
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
								{preview?.kind === 'demo' ? preview.demo.name : preview ? `${preview.suite.emoji} ${preview.suite.title} · behaviour suite` : ''}
							</Text>
							<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" fontWeight={400}>
								{preview?.kind === 'demo' ? preview.demo.description : preview ? `${preview.suite.description} Controls are inert in the preview — install the suite to run them as your own programs.` : ''}
							</Text>
							<Flex columnGap={2} rowGap={2} flexWrap="wrap" marginTop={2}>
								{preview?.kind === 'demo' ? (
									<Button size="xs" onClick={() => copyTemplate(preview.demo)} isLoading={busyKey === preview.demo.slug} data-testid="demo-modal-use">
										Use template ✨
									</Button>
								) : preview ? (
									<Button size="xs" onClick={() => installSuite(preview.suite)} isLoading={busyKey === `suite:${preview.suite.key}`} data-testid="suite-modal-install">
										Install suite ✨
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
							<Box width="100%" maxWidth="960px" marginX="auto" whiteSpace="normal">
								<WebpageBlocksRenderer blocks={previewBlocks as WebpageBlock[]} componentsByRef={previewComponents} />
							</Box>
						) : null}
					</ModalBody>
				</ModalContent>
			</Modal>
		</PageShell>
	);
}
