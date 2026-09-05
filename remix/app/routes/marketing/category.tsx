import { Box, Flex, Input, SimpleGrid, Text } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router';

import { MarketingColdStart, MarketingUnpublished } from '~/components/Marketing/MarketingGate';
import { PublishToggle, type AdminSurface } from '~/components/Marketing/MarketingPublishing';
import { Crumbs, MarketingShell, formatCount, formatPages, useMarketingSeo, useVisibleCounts } from '~/components/Marketing/MarketingShell';
import { MK } from '~/components/Marketing/marketingTheme';
import { MkButton, SectionEyebrow } from '~/components/Marketing/Sections';
import { useMarketingVisibility } from '~/components/Marketing/useMarketingPublications';
import { CATEGORY_BY_KEY, MARKETING_BASE, pageHref, pagesInCategory, searchPages } from '~/marketing/catalog';
import { groupPages } from '~/marketing/pageGroups';
import { HUB_KEY, categoryKey, categoryPageKeys, pageKey } from '~/marketing/publishing';
import type { MarketingPage, TrendKey } from '~/marketing/types';

// /marketing/:category — the index of one category (and /marketing/search).
// Pages are grouped by the reference that best explains them (persona,
// competitor, trend, use case, feature family) and filtered client-side; big
// categories paginate with "show more" so the styles index (500+ pages) stays
// light. Visitors only get the pages an admin published; the index itself is
// its own publishable surface (marketing/publishing.ts) and never cascades.

const PAGE_SIZE = 60;

const CATEGORY_TREND: Record<string, TrendKey> = {
	landing: 'bold-brutal',
	guides: 'bold-brutal',
	walkthroughs: 'bold-brutal',
	compare: 'mono-minimal',
	for: 'bento',
	'use-cases': 'pastel-soft',
	concepts: 'dark-neon',
	templates: 'sticker-collage',
	styles: 'gradient-glow',
	faq: 'bold-brutal',
	checklists: 'bento',
	search: 'bold-brutal'
};

const PageCard = ({ entry, dimmed }: { entry: MarketingPage; dimmed: boolean }) => (
	<Box position="relative" minWidth={0}>
		<Box
			as={RouterLink}
			to={pageHref(entry.slug)}
			display="flex"
			flexDirection="column"
			gap={1.5}
			padding={4}
			background={MK.cardSolid}
			border={MK.border}
			borderRadius={MK.radius}
			boxShadow={MK.shadow}
			color={MK.ink}
			minHeight="132px"
			height="100%"
			opacity={dimmed ? 0.72 : 1}
			_hover={{ transform: 'translate(-2px, -2px)', boxShadow: MK.shadowLg }}
			transition="transform 140ms ease, box-shadow 140ms ease"
			data-testid="marketing-page-card"
			data-published={dimmed ? 'false' : 'true'}
		>
			<Text fontSize="11px" fontFamily={MK.mono} color={MK.muted} noOfLines={1} paddingRight="36px">
				{entry.eyebrow}
			</Text>
			<Text fontWeight={800} fontSize="16px" lineHeight={1.25} letterSpacing="-0.01em" sx={{ overflowWrap: 'anywhere' }}>
				{entry.title}
			</Text>
			<Text fontSize="13px" color={MK.text} lineHeight={1.5} noOfLines={3}>
				{entry.description}
			</Text>
		</Box>
		<PublishToggle publicationKey={pageKey(entry.slug)} label={entry.title} iconOnly position="absolute" top="10px" right="10px" />
	</Box>
);

export default function MarketingCategory() {
	const params = useParams();
	const [searchParams, setSearchParams] = useSearchParams();
	const visibility = useMarketingVisibility();
	const counts = useVisibleCounts();
	const categoryKeyParam = params.category ?? '';
	const isSearch = categoryKeyParam === 'search';
	const category = CATEGORY_BY_KEY[categoryKeyParam];
	const query = searchParams.get('q') ?? '';
	const [filter, setFilter] = React.useState('');
	const [limit, setLimit] = React.useState(PAGE_SIZE);

	React.useEffect(() => {
		setLimit(PAGE_SIZE);
		setFilter('');
	}, [categoryKeyParam, query]);

	const pages = React.useMemo(() => {
		if (isSearch) return visibility.pages(searchPages(query, 400));
		if (!category) return [];
		return visibility.pages(pagesInCategory(category.key));
	}, [category, isSearch, query, visibility]);

	const filtered = React.useMemo(() => {
		const needle = filter.trim().toLowerCase();
		if (!needle) return pages;
		return pages.filter((entry) => `${entry.title} ${entry.description} ${entry.slug}`.toLowerCase().includes(needle));
	}, [filter, pages]);

	const groups = React.useMemo(() => groupPages(filtered.slice(0, limit)), [filtered, limit]);

	const title = isSearch ? (query ? `Search: ${query}` : 'Search') : (category?.name ?? 'Not found');
	const description = isSearch
		? `${formatPages(pages.length)} match “${query}”.`
		: category
			? `${category.blurb} ${formatPages(pages.length)}.`
			: 'This marketing section does not exist.';

	const gated = visibility.ready && (isSearch ? !visibility.hub : !!category && !visibility.category(category.key));
	useMarketingSeo({
		title: gated ? 'Not published yet' : title,
		description: gated ? 'This part of the Thingtime marketing site is not published yet.' : description,
		// unknown publish state writes nothing; "no such section" needs none
		enabled: (!category && !isSearch) || visibility.ready
	});

	if (!category && !isSearch) {
		return (
			<MarketingShell trend="bold-brutal">
				<Crumbs items={[visibility.hub ? { to: MARKETING_BASE, label: 'Marketing' } : { label: 'Marketing' }, { label: 'Not found' }]} />
				<Box paddingY={12} textAlign="center">
					<Text fontSize="48px" aria-hidden="true">
						🫥
					</Text>
					<Text as="h1" fontSize="clamp(28px, 4vw, 44px)" fontWeight={900} letterSpacing="-0.02em" margin={0}>
						No such section
					</Text>
					<Text color={MK.text} marginTop={2}>
						Try one of the categories in the bar above.
					</Text>
					<Flex justifyContent="center" marginTop={6}>
						<MkButton to={visibility.hub ? MARKETING_BASE : '/'} variant="primary">
							{visibility.hub ? 'Back to marketing' : 'Back to Thingtime'}
						</MkButton>
					</Flex>
				</Box>
			</MarketingShell>
		);
	}

	// the surface an admin publishes from here: the category index (with a
	// bulk switch over its pages), or the hub for the search view
	const surface: AdminSurface = category
		? { key: categoryKey(category.key), label: `${category.name} index`, bulk: { noun: 'pages', keys: categoryPageKeys(category.key) } }
		: { key: HUB_KEY, label: 'Marketing hub' };
	const trend = CATEGORY_TREND[categoryKeyParam] ?? 'bold-brutal';

	if (!visibility.ready) return <MarketingColdStart />;
	if (isSearch ? !visibility.hub : !visibility.category(category!.key)) {
		return (
			<MarketingUnpublished
				surface={surface}
				trend={trend}
				active={categoryKeyParam}
				crumbs={[visibility.hub ? { to: MARKETING_BASE, label: 'Marketing' } : { label: 'Marketing' }, { label: category?.name ?? 'Search' }]}
			/>
		);
	}

	return (
		<MarketingShell trend={trend} active={categoryKeyParam} query={query} publication={surface}>
			<Crumbs items={[visibility.hub ? { to: MARKETING_BASE, label: 'Marketing' } : { label: 'Marketing' }, { label: title }]} />
			<Box as="header" paddingTop={6} paddingBottom={6} data-testid="marketing-category-header">
				<SectionEyebrow>
					{isSearch ? '🔍 Search' : `${category!.emoji} ${category!.name}`} · {formatPages(pages.length)}
				</SectionEyebrow>
				<Text as="h1" fontSize="clamp(34px, 5.5vw, 64px)" fontWeight={900} letterSpacing="-0.03em" lineHeight={1.02} color={MK.ink} margin={0} sx={{ overflowWrap: 'anywhere' }}>
					{isSearch ? (query ? `“${query}”` : 'Search the suite') : category!.name}
				</Text>
				<Text fontSize={['15px', '17px']} color={MK.text} lineHeight={1.6} maxWidth="640px" marginTop={3}>
					{isSearch ? 'Titles, descriptions and slugs across every category.' : category!.blurb}
				</Text>
				<Flex gap={2} marginTop={5} flexWrap="wrap" maxWidth="640px">
					{isSearch ? (
						<Box
							as="form"
							flex="1 1 240px"
							onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
								event.preventDefault();
								const next = new FormData(event.currentTarget).get('q');
								setSearchParams(next ? { q: String(next) } : {});
							}}
						>
							<Input
								name="q"
								defaultValue={query}
								key={query}
								placeholder="Search everything…"
								aria-label="Search marketing pages"
								minHeight="44px"
								background={MK.cardSolid}
								color={MK.ink}
								border={MK.border}
								borderRadius={MK.radiusSm}
								fontFamily={MK.font}
								_placeholder={{ color: MK.muted }}
							/>
						</Box>
					) : (
						<Input
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							placeholder={`Filter ${formatPages(pages.length)}…`}
							aria-label={`Filter ${category!.name}`}
							flex="1 1 240px"
							minHeight="44px"
							background={MK.cardSolid}
							color={MK.ink}
							border={MK.border}
							borderRadius={MK.radiusSm}
							fontFamily={MK.font}
							_placeholder={{ color: MK.muted }}
						/>
					)}
				</Flex>
			</Box>

			{filtered.length === 0 ? (
				<Box paddingY={10} textAlign="center" border={MK.border} borderRadius={MK.radius} background={MK.cardSolid} data-testid="marketing-category-empty">
					<Text fontSize="40px" aria-hidden="true">
						{pages.length === 0 && !isSearch ? '🌱' : '🔎'}
					</Text>
					<Text fontWeight={800} fontSize="18px">
						{pages.length === 0 && !isSearch ? 'Pages are on their way' : 'Nothing matches yet'}
					</Text>
					<Text color={MK.text} fontSize="14px" marginTop={1}>
						{pages.length === 0 && !isSearch
							? 'Nothing in this section is published yet — check back soon.'
							: `Try a feature name, a competitor, or an audience. There ${counts.pages === 1 ? 'is' : 'are'} ${formatPages(counts.pages)} to find.`}
					</Text>
				</Box>
			) : (
				groups.map((group) => (
					<Box as="section" key={group.key} paddingBottom={8} data-testid="marketing-group">
						<Flex alignItems="baseline" gap={2} marginBottom={3}>
							<Text as="h2" fontSize="18px" fontWeight={900} letterSpacing="-0.01em" margin={0}>
								<span aria-hidden="true">{group.emoji}</span> {group.label}
							</Text>
							<Text fontFamily={MK.mono} fontSize="12px" color={MK.muted}>
								{group.pages.length}
							</Text>
						</Flex>
						<SimpleGrid columns={[1, 2, 3]} gap={3}>
							{group.pages.map((entry) => (
								<PageCard key={entry.slug} entry={entry} dimmed={visibility.everything && !visibility.isPublished(pageKey(entry.slug))} />
							))}
						</SimpleGrid>
					</Box>
				))
			)}

			{filtered.length > limit ? (
				<Flex justifyContent="center" paddingBottom={8}>
					<MkButton variant="secondary" onClick={() => setLimit((current) => current + PAGE_SIZE)} type="button">
						Show {formatCount(Math.min(PAGE_SIZE, filtered.length - limit))} more of {formatCount(filtered.length - limit)}
					</MkButton>
				</Flex>
			) : null}
		</MarketingShell>
	);
}
