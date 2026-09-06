import { Box, Flex, SimpleGrid, Text } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink, useParams } from 'react-router';

import { Crumbs, MarketingShell, useMarketingSeo } from '~/components/Marketing/MarketingShell';
import { MK } from '~/components/Marketing/marketingTheme';
import { MarketingSections, MkButton, SectionEyebrow } from '~/components/Marketing/Sections';
import { CATEGORY_BY_KEY, MARKETING_BASE, PAGE_BY_SLUG, buildPageBySlug, pageHref, searchPages } from '~/marketing/catalog';
import { TRENDS } from '~/marketing/trends';

// /marketing/* — one generated page. The splat is the catalog slug
// ("landing/feed", "for/developers/open-api", "styles/y2k-chrome/polls").
// Building happens on render (memoised per slug) so the 1600-page catalog
// costs nothing until a page is opened.

const NotFound = ({ slug }: { slug: string }) => {
	const suggestions = React.useMemo(() => searchPages(slug.replace(/[/-]+/g, ' '), 6), [slug]);
	return (
		<MarketingShell trend="bold-brutal">
			<Crumbs items={[{ to: MARKETING_BASE, label: 'Marketing' }, { label: 'Not found' }]} />
			<Box paddingY={12} textAlign="center" data-testid="marketing-not-found">
				<Text fontSize="48px" aria-hidden="true">
					🫥
				</Text>
				<Text as="h1" fontSize="clamp(28px, 4vw, 44px)" fontWeight={900} letterSpacing="-0.02em" margin={0}>
					That page is not a thing (yet)
				</Text>
				<Text color={MK.text} marginTop={2} fontFamily={MK.mono} fontSize="13px">
					/marketing/{slug}
				</Text>
				{suggestions.length ? (
					<Box marginTop={8} textAlign="left" maxWidth="720px" marginX="auto">
						<SectionEyebrow>Closest matches</SectionEyebrow>
						<SimpleGrid columns={[1, 2]} gap={3}>
							{suggestions.map((entry) => (
								<Box key={entry.slug} as={RouterLink} to={pageHref(entry.slug)} padding={4} border={MK.border} borderRadius={MK.radius} background={MK.cardSolid} color={MK.ink} _hover={{ boxShadow: MK.shadow }}>
									<Text fontWeight={800}>{entry.title}</Text>
									<Text fontSize="13px" color={MK.text} noOfLines={2}>
										{entry.description}
									</Text>
								</Box>
							))}
						</SimpleGrid>
					</Box>
				) : null}
				<Flex justifyContent="center" marginTop={8}>
					<MkButton to={MARKETING_BASE} variant="primary">
						Back to marketing
					</MkButton>
				</Flex>
			</Box>
		</MarketingShell>
	);
};

export default function MarketingPageRoute() {
	const params = useParams();
	const slug = (params['*'] ?? '').replace(/\/+$/, '');
	const page = React.useMemo(() => buildPageBySlug(slug), [slug]);
	const category = page ? CATEGORY_BY_KEY[page.category] : null;

	useMarketingSeo({ title: page?.title ?? 'Not found', description: page?.description ?? 'This marketing page does not exist.' });

	React.useEffect(() => {
		if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' });
	}, [slug]);

	if (!page || !category) return <NotFound slug={slug} />;

	const related = page.related.map((relatedSlug) => PAGE_BY_SLUG[relatedSlug]).filter(Boolean);
	const styleSiblings = page.kind === 'trend-landing' || page.kind === 'landing' ? TRENDS.filter((trend) => trend.key !== page.trend) : [];

	return (
		<MarketingShell trend={page.trend} active={page.category}>
			<Crumbs items={[{ to: MARKETING_BASE, label: 'Marketing' }, { to: `${MARKETING_BASE}/${category.key}`, label: category.name }, { label: page.title }]} />
			<Box data-testid="marketing-page" data-slug={page.slug} data-kind={page.kind} data-trend={page.trend}>
				<MarketingSections page={page} />
			</Box>

			{styleSiblings.length && page.refs.feature ? (
				<Box as="section" paddingY={[8, 12]} borderTop={`1px solid ${MK.hairline}`} data-testid="marketing-style-siblings">
					<SectionEyebrow>Same page, other looks</SectionEyebrow>
					<Text as="h2" fontSize="clamp(24px, 3.4vw, 36px)" fontWeight={900} letterSpacing="-0.02em" lineHeight={1.05} margin={0}>
						Re-cut in eleven other styles
					</Text>
					<Flex gap={2} flexWrap="wrap" marginTop={4}>
						{styleSiblings.map((trend) => {
							const target = `styles/${trend.key}/${page.refs.feature}`;
							const to = PAGE_BY_SLUG[target] ? pageHref(target) : pageHref(`landing/${page.refs.feature}`);
							return (
								<Box key={trend.key} as={RouterLink} to={to} px={3} py={1.5} fontSize="13px" fontWeight={700} border={MK.border} borderRadius={MK.radiusSm} background={MK.cardSolid} color={MK.ink} _hover={{ background: MK.tint }}>
									<span aria-hidden="true">{trend.emoji}</span> {trend.name}
								</Box>
							);
						})}
					</Flex>
				</Box>
			) : null}

			{related.length ? (
				<Box as="section" paddingY={[8, 12]} borderTop={`1px solid ${MK.hairline}`} data-testid="marketing-related">
					<SectionEyebrow>Related</SectionEyebrow>
					<Text as="h2" fontSize="clamp(24px, 3.4vw, 36px)" fontWeight={900} letterSpacing="-0.02em" lineHeight={1.05} margin={0}>
						Keep reading
					</Text>
					<SimpleGrid columns={[1, 2, 3]} gap={3} marginTop={5}>
						{related.map((entry) => (
							<Box key={entry.slug} as={RouterLink} to={pageHref(entry.slug)} display="flex" flexDirection="column" gap={1.5} padding={4} border={MK.border} borderRadius={MK.radius} background={MK.cardSolid} color={MK.ink} boxShadow={MK.shadow} _hover={{ transform: 'translate(-2px, -2px)', boxShadow: MK.shadowLg }} transition="transform 140ms ease, box-shadow 140ms ease">
								<Text fontSize="11px" fontFamily={MK.mono} color={MK.muted} noOfLines={1}>
									{entry.eyebrow}
								</Text>
								<Text fontWeight={800} lineHeight={1.25} sx={{ overflowWrap: 'anywhere' }}>
									{entry.title}
								</Text>
								<Text fontSize="13px" color={MK.text} noOfLines={2}>
									{entry.description}
								</Text>
							</Box>
						))}
					</SimpleGrid>
				</Box>
			) : null}
		</MarketingShell>
	);
}
