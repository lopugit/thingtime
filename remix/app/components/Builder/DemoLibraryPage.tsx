import React from 'react';
import { Box, Button, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Text } from '@chakra-ui/react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
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
import { WebpageBlocksRenderer } from './WebpageBlocksRenderer';
import type { WebpageBlock } from './webpageBlocks';

// /builder/demos — the builder DEMO LIBRARY: every catalog demo (sections,
// full pages, component-block pages) as a live scaled thumbnail, filterable by
// family/kind/search. The catalog is code (schemas/webpageDemos), so the
// gallery paints instantly from the module; GET /api/v1/webpages/demos then
// reconciles which demos are seeded on this deployment (those open at /p/ and
// in the builder directly). "Use this template" clones a demo into the
// viewer's own webpage thing through the ordinary things write path — the
// same call the builder's New page makes — so templates work before any seed
// runs and never mutate the shared seed.

const PAGE_SIZE = 36;
const THUMB_WIDTH = 760;
const THUMB_SCALE = 0.42;
const THUMB_HEIGHT = 200;

type SeededState = { seeded: Set<string>; seededCount: number; total: number };

const KIND_LABELS: Record<WebpageDemoKind | 'all', string> = { all: 'Everything', section: 'Sections', page: 'Pages', component: 'Component blocks' };

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

// Scaled live render of the demo's blocks. Mounts only once scrolled near the
// viewport (a few hundred renderers at once would be wasteful) and stays
// mounted after — no flicker while filtering.
const DemoThumb = ({ demo }: { demo: WebpageDemo }) => {
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
		return () => observer.disconnect();
	}, [visible]);

	return (
		<Box
			ref={ref}
			height={`${THUMB_HEIGHT}px`}
			overflow="hidden"
			borderRadius="12px"
			background={demo.previewBg}
			border="1px solid var(--tt-border, #ececef)"
			pointerEvents="none"
			userSelect="none"
			data-testid="demo-thumb"
		>
			{visible ? (
				<Box width={`${THUMB_WIDTH}px`} transform={`scale(${THUMB_SCALE})`} transformOrigin="top left" padding="20px 24px">
					<WebpageBlocksRenderer blocks={demo.blocks as WebpageBlock[]} componentsByRef={{}} />
				</Box>
			) : null}
		</Box>
	);
};

const DemoCard = ({ demo, seeded, onPreview, onUse, busy }: { demo: WebpageDemo; seeded: boolean; onPreview: () => void; onUse: () => void; busy: boolean }) => {
	const family = WEBPAGE_DEMO_FAMILIES.find((entry) => entry.key === demo.family);
	const id = webpageDemoShareId(demo.slug);
	const blockCount = React.useMemo(() => countDemoBlocks(demo.blocks), [demo.blocks]);
	return (
		<Flex {...CARD_STYLES} flexDirection="column" rowGap={3} padding={3} minWidth={0} data-testid="demo-card" data-demo-slug={demo.slug}>
			<Box cursor="pointer" onClick={onPreview} role="button" aria-label={`Preview ${demo.name}`}>
				<DemoThumb demo={demo} />
			</Box>
			<Flex flexDirection="column" rowGap={1} minWidth={0}>
				<Flex alignItems="center" columnGap={2} minWidth={0}>
					<Text color="var(--tt-ink, #16161a)" fontWeight={700} fontSize="sm" noOfLines={1} minWidth={0}>
						{demo.name}
					</Text>
				</Flex>
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
	const kind = (searchParams.get('kind') || 'all') as WebpageDemoKind | 'all';
	const [search, setSearch] = React.useState(searchParams.get('q') || '');
	const [shown, setShown] = React.useState(PAGE_SIZE);
	const [seededState, setSeededState] = React.useState<SeededState>({ seeded: new Set(), seededCount: 0, total: demos.length });
	const [preview, setPreview] = React.useState<WebpageDemo | null>(null);
	const [busySlug, setBusySlug] = React.useState<string | null>(null);
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
			setSeededState({
				seeded: new Set(data.demos.filter((entry: any) => entry.seeded).map((entry: any) => entry.slug)),
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

	const filtered = React.useMemo(() => {
		const needle = search.trim().toLowerCase();
		return demos.filter(
			(demo) =>
				(!family || demo.family === family) &&
				(kind === 'all' || demo.kind === kind) &&
				(!needle || demo.name.toLowerCase().includes(needle) || demo.tags.some((tag) => tag.includes(needle)) || demo.description.toLowerCase().includes(needle))
		);
	}, [demos, family, kind, search]);

	const visible = filtered.slice(0, shown);

	const useTemplate = async (demo: WebpageDemo) => {
		if (!user?.id) {
			lopu({ title: 'Sign in to use a template 🗝️', description: 'Templates become pages in your own Things.', status: 'info' });
			navigate('/login');
			return;
		}
		setBusySlug(demo.slug);
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
			setBusySlug(null);
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

	const previewSeeded = preview ? seededState.seeded.has(preview.slug) : false;

	return (
		<PageShell width={1280}>
			<PageHeader
				eyebrow="Thingtime · builder"
				title="Demo library 🧱✨"
				subtitle={`${demos.length} example sections, pages, and component compositions — preview any of them, then make it yours with one tap.`}
				after={
					<Flex columnGap={2} alignItems="center">
						<Button as={Link} to="/builder" size="sm" variant="outline" data-testid="demos-back-to-builder">
							← Builder
						</Button>
						{user?.isAdmin && seededState.seededCount < seededState.total ? (
							<Button size="sm" onClick={seedDemos} isLoading={seeding} data-testid="demos-seed">
								Seed {seededState.total - seededState.seededCount} demos 🌱
							</Button>
						) : null}
					</Flex>
				}
			/>

			<Flex flexDirection="column" rowGap={3}>
				<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
					{(['all', 'section', 'page', 'component'] as const).map((entry) => (
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
						placeholder="Search demos — hero, pricing, ink…"
						maxWidth="280px"
						marginLeft={{ base: 0, md: 'auto' }}
						borderRadius="999px"
						data-testid="demos-search"
					/>
				</Flex>
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
			</Flex>

			{filtered.length === 0 ? (
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
							onPreview={() => setPreview(demo)}
							onUse={() => useTemplate(demo)}
							busy={busySlug === demo.slug}
						/>
					))}
				</Box>
			)}

			{visible.length < filtered.length ? (
				<Flex justifyContent="center">
					<Button variant="outline" size="sm" onClick={() => setShown((count) => count + PAGE_SIZE)} data-testid="demos-show-more">
						Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more ({filtered.length - visible.length} left)
					</Button>
				</Flex>
			) : null}

			<Modal isOpen={!!preview} onClose={() => setPreview(null)} size="6xl" scrollBehavior="inside">
				<ModalOverlay />
				<ModalContent background={preview?.previewBg || 'var(--tt-surface, #fafafb)'} borderRadius="20px" marginX={{ base: 2, md: 6 }}>
					<ModalHeader paddingBottom={2}>
						<Flex flexDirection="column" rowGap={1} paddingRight={8}>
							<Text fontSize="lg" fontWeight={800} color="var(--tt-ink, #16161a)" noOfLines={1}>
								{preview?.name}
							</Text>
							<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" fontWeight={400}>
								{preview?.description}
							</Text>
							<Flex columnGap={2} rowGap={2} flexWrap="wrap" marginTop={2}>
								<Button size="xs" onClick={() => preview && useTemplate(preview)} isLoading={!!preview && busySlug === preview.slug} data-testid="demo-modal-use">
									Use template ✨
								</Button>
								{preview && previewSeeded ? (
									<>
										<Button as={Link} to={`/p/${encodeURIComponent(webpageDemoShareId(preview.slug))}`} size="xs" variant="outline">
											Open /p/ ↗
										</Button>
										<Button as={Link} to={`/builder?page=${encodeURIComponent(webpageDemoShareId(preview.slug))}`} size="xs" variant="outline">
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
								<WebpageBlocksRenderer blocks={preview.blocks as WebpageBlock[]} componentsByRef={{}} />
							</Box>
						) : null}
					</ModalBody>
				</ModalContent>
			</Modal>
		</PageShell>
	);
}
