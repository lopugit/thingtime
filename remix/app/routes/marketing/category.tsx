import { Box, Flex, Input, SimpleGrid, Text } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router';

import { Crumbs, MarketingShell, formatCount, useMarketingSeo } from '~/components/Marketing/MarketingShell';
import { MK } from '~/components/Marketing/marketingTheme';
import { MkButton, SectionEyebrow } from '~/components/Marketing/Sections';
import { CATEGORY_BY_KEY, MARKETING_BASE, PAGES, pageHref, pagesInCategory, searchPages } from '~/marketing/catalog';
import { COMPETITOR_BY_KEY } from '~/marketing/competitors';
import { FEATURE_BY_KEY, FEATURE_CATEGORY_LABELS } from '~/marketing/features';
import { PERSONA_BY_KEY } from '~/marketing/personas';
import { TREND_BY_KEY } from '~/marketing/trends';
import type { MarketingPage, TrendKey } from '~/marketing/types';
import { USE_CASE_BY_KEY } from '~/marketing/useCases';

// /marketing/:category — the index of one category (and /marketing/search).
// Pages are grouped by the reference that best explains them (persona,
// competitor, trend, use case, feature family) and filtered client-side; big
// categories paginate with "show more" so the styles index (500+ pages) stays
// light.

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

const groupLabel = (entry: MarketingPage): { key: string; label: string; emoji: string } => {
	if (entry.refs.trend) {
		const trend = TREND_BY_KEY[entry.refs.trend];
		return { key: `trend:${trend.key}`, label: trend.name, emoji: trend.emoji };
	}
	if (entry.refs.persona) {
		const persona = PERSONA_BY_KEY[entry.refs.persona];
		return { key: `persona:${persona.key}`, label: persona.name, emoji: persona.emoji };
	}
	if (entry.refs.competitor) {
		const competitor = COMPETITOR_BY_KEY[entry.refs.competitor];
		return { key: `competitor:${competitor.key}`, label: competitor.name, emoji: competitor.emoji };
	}
	if (entry.refs.useCase && entry.kind !== 'template') {
		const useCase = USE_CASE_BY_KEY[entry.refs.useCase];
		return { key: `use-case:${useCase.key}`, label: useCase.name, emoji: useCase.emoji };
	}
	if (entry.refs.feature) {
		const feature = FEATURE_BY_KEY[entry.refs.feature];
		const label = FEATURE_CATEGORY_LABELS[feature.category];
		return { key: `family:${feature.category}`, label: label.name, emoji: label.emoji };
	}
	return { key: 'all', label: 'All', emoji: '📄' };
};

const PageCard = ({ entry }: { entry: MarketingPage }) => (
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
		_hover={{ transform: 'translate(-2px, -2px)', boxShadow: MK.shadowLg }}
		transition="transform 140ms ease, box-shadow 140ms ease"
		data-testid="marketing-page-card"
	>
		<Text fontSize="11px" fontFamily={MK.mono} color={MK.muted} noOfLines={1}>
			{entry.eyebrow}
		</Text>
		<Text fontWeight={800} fontSize="16px" lineHeight={1.25} letterSpacing="-0.01em" sx={{ overflowWrap: 'anywhere' }}>
			{entry.title}
		</Text>
		<Text fontSize="13px" color={MK.text} lineHeight={1.5} noOfLines={3}>
			{entry.description}
		</Text>
	</Box>
);

export default function MarketingCategory() {
	const params = useParams();
	const [searchParams, setSearchParams] = useSearchParams();
	const categoryKey = params.category ?? '';
	const isSearch = categoryKey === 'search';
	const category = CATEGORY_BY_KEY[categoryKey];
	const query = searchParams.get('q') ?? '';
	const [filter, setFilter] = React.useState('');
	const [limit, setLimit] = React.useState(PAGE_SIZE);

	React.useEffect(() => {
		setLimit(PAGE_SIZE);
		setFilter('');
	}, [categoryKey, query]);

	const pages = React.useMemo(() => {
		if (isSearch) return searchPages(query, 400);
		if (!category) return [];
		return pagesInCategory(category.key);
	}, [category, isSearch, query]);

	const filtered = React.useMemo(() => {
		const needle = filter.trim().toLowerCase();
		if (!needle) return pages;
		return pages.filter((entry) => `${entry.title} ${entry.description} ${entry.slug}`.toLowerCase().includes(needle));
	}, [filter, pages]);

	const groups = React.useMemo(() => {
		const map = new Map<string, { label: string; emoji: string; pages: MarketingPage[] }>();
		for (const entry of filtered.slice(0, limit)) {
			const group = groupLabel(entry);
			const bucket = map.get(group.key) ?? { label: group.label, emoji: group.emoji, pages: [] };
			bucket.pages.push(entry);
			map.set(group.key, bucket);
		}
		return Array.from(map.values());
	}, [filtered, limit]);

	const title = isSearch ? (query ? `Search: ${query}` : 'Search') : (category?.name ?? 'Not found');
	const description = isSearch
		? `${formatCount(pages.length)} marketing pages match “${query}”.`
		: category
			? `${category.blurb} ${formatCount(pages.length)} pages.`
			: 'This marketing section does not exist.';

	useMarketingSeo({ title, description });

	if (!category && !isSearch) {
		return (
			<MarketingShell trend="bold-brutal">
				<Crumbs items={[{ to: MARKETING_BASE, label: 'Marketing' }, { label: 'Not found' }]} />
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
						<MkButton to={MARKETING_BASE} variant="primary">
							Back to marketing
						</MkButton>
					</Flex>
				</Box>
			</MarketingShell>
		);
	}

	return (
		<MarketingShell trend={CATEGORY_TREND[categoryKey] ?? 'bold-brutal'} active={categoryKey} query={query}>
			<Crumbs items={[{ to: MARKETING_BASE, label: 'Marketing' }, { label: title }]} />
			<Box as="header" paddingTop={6} paddingBottom={6} data-testid="marketing-category-header">
				<SectionEyebrow>
					{isSearch ? '🔍 Search' : `${category!.emoji} ${category!.name}`} · {formatCount(pages.length)} pages
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
							placeholder={`Filter ${formatCount(pages.length)} pages…`}
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
				<Box paddingY={10} textAlign="center" border={MK.border} borderRadius={MK.radius} background={MK.cardSolid}>
					<Text fontSize="40px" aria-hidden="true">
						🔎
					</Text>
					<Text fontWeight={800} fontSize="18px">
						Nothing matches yet
					</Text>
					<Text color={MK.text} fontSize="14px" marginTop={1}>
						Try a feature name, a competitor, or an audience. There are {formatCount(PAGES.length)} pages to find.
					</Text>
				</Box>
			) : (
				groups.map((group) => (
					<Box as="section" key={group.label} paddingBottom={8} data-testid="marketing-group">
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
								<PageCard key={entry.slug} entry={entry} />
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
