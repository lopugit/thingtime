import { Box, Flex, Input, SimpleGrid, Text } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';

import { MarketingShell, formatCount, useMarketingSeo } from '~/components/Marketing/MarketingShell';
import { MK, RAINBOW_TEXT_STYLE } from '~/components/Marketing/marketingTheme';
import { MkButton, SectionEyebrow } from '~/components/Marketing/Sections';
import { WalkthroughPlayer } from '~/components/Marketing/WalkthroughPlayer';
import { CATEGORIES, MARKETING_BASE, PAGE_COUNT, TOTAL_ASSET_COUNT, categoryCounts, pageHref } from '~/marketing/catalog';
import { COMPETITORS } from '~/marketing/competitors';
import { FEATURES } from '~/marketing/features';
import { PERSONAS } from '~/marketing/personas';
import { SOCIAL_ASSET_COUNT } from '~/marketing/social';
import { TRENDS } from '~/marketing/trends';
import { USE_CASES } from '~/marketing/useCases';
import { getWalkthrough } from '~/marketing/walkthroughs';

// /marketing — the hub. Every category, the social suite, and quick paths
// into features, audiences, comparisons and styles. Everything below is
// derived from the catalog, so the counts can never drift from the pages.

const Chip = ({ to, children }: { to: string; children: React.ReactNode }) => (
	<Box
		as={RouterLink}
		to={to}
		display="inline-flex"
		alignItems="center"
		gap={1.5}
		px={3}
		py={1.5}
		fontSize="13px"
		fontWeight={700}
		border={MK.border}
		borderRadius={MK.radiusSm}
		background={MK.cardSolid}
		color={MK.ink}
		_hover={{ background: MK.tint, transform: 'translate(-1px, -1px)', boxShadow: MK.shadow }}
		transition="transform 140ms ease, box-shadow 140ms ease"
	>
		{children}
	</Box>
);

const SectionTitle = ({ eyebrow, title, to, linkLabel }: { eyebrow: string; title: string; to?: string; linkLabel?: string }) => (
	<Flex alignItems="flex-end" justifyContent="space-between" gap={4} flexWrap="wrap" marginBottom={5}>
		<Box>
			<SectionEyebrow>{eyebrow}</SectionEyebrow>
			<Text as="h2" fontSize="clamp(24px, 3.4vw, 36px)" fontWeight={900} letterSpacing="-0.02em" lineHeight={1.05} color={MK.ink} margin={0}>
				{title}
			</Text>
		</Box>
		{to && linkLabel ? (
			<Box as={RouterLink} to={to} fontSize="13px" fontWeight={800} color={MK.accent} _hover={{ textDecoration: 'underline' }}>
				{linkLabel} →
			</Box>
		) : null}
	</Flex>
);

export default function MarketingIndex() {
	const navigate = useNavigate();
	const [query, setQuery] = React.useState('');
	const counts = React.useMemo(() => categoryCounts(), []);
	const showcase = React.useMemo(() => getWalkthrough('feature-feed'), []);

	useMarketingSeo({
		title: 'Marketing',
		description: `${formatCount(PAGE_COUNT)} marketing pages, guides, comparisons and animated walkthroughs plus ${formatCount(SOCIAL_ASSET_COUNT)} social images for Thingtime, generated from one catalog.`
	});

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const needle = query.trim();
		if (needle) navigate(`${MARKETING_BASE}/search?q=${encodeURIComponent(needle)}`);
	};

	return (
		<MarketingShell trend="bold-brutal" active={undefined}>
			<Box as="section" paddingTop={[8, 12]} paddingBottom={[8, 12]} data-testid="marketing-hero">
				<SectionEyebrow>🌈 Thingtime marketing suite</SectionEyebrow>
				<Text
					as="h1"
					fontSize="clamp(40px, 7vw, 84px)"
					fontWeight={900}
					letterSpacing="-0.035em"
					lineHeight={1}
					color={MK.ink}
					margin={0}
					maxWidth="14ch"
					sx={{ overflowWrap: 'anywhere' }}
				>
					Every feature. Every audience. <Box as="span" sx={RAINBOW_TEXT_STYLE}>Every format.</Box>
				</Text>
				<Text fontSize={['16px', '19px']} lineHeight={1.6} color={MK.text} maxWidth="680px" marginTop={5}>
					{formatCount(PAGE_COUNT)} landing pages, how-to guides, comparisons, use cases and animated cursor walkthroughs, plus{' '}
					{formatCount(SOCIAL_ASSET_COUNT)} ready-to-post social images in twelve viral styles. {formatCount(TOTAL_ASSET_COUNT)} assets, one catalog,
					zero lorem ipsum.
				</Text>
				<Flex as="form" onSubmit={submit} role="search" gap={2} marginTop={6} maxWidth="560px" flexWrap="wrap">
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search pages: passkeys, Notion, recipes, developers…"
						aria-label="Search marketing pages"
						flex="1 1 240px"
						minHeight="48px"
						background={MK.cardSolid}
						color={MK.ink}
						border={MK.border}
						borderRadius={MK.radiusSm}
						fontFamily={MK.font}
						_placeholder={{ color: MK.muted }}
						_focusVisible={{ borderColor: MK.accent, boxShadow: MK.shadow }}
					/>
					<MkButton type="submit" variant="primary">
						Search
					</MkButton>
				</Flex>
				<Flex gap={2} marginTop={4} flexWrap="wrap">
					{['🌐 Web', '📱 iOS', '⌨️ Raycast', '🔌 API', '🦄 No ads', '🐙 Open source'].map((badge) => (
						<Box key={badge} as="span" fontSize="12px" fontWeight={700} px={2.5} py={1} border={MK.border} borderRadius={MK.radiusSm} background={MK.cardSolid} color={MK.ink}>
							{badge}
						</Box>
					))}
				</Flex>
			</Box>

			<Box as="section" paddingY={[8, 12]} borderTop={`1px solid ${MK.hairline}`} data-testid="marketing-categories">
				<SectionTitle eyebrow="Browse" title="Eleven kinds of page, one social suite" />
				<SimpleGrid columns={[1, 2, 3]} gap={4}>
					{CATEGORIES.map((category) => (
						<Box
							key={category.key}
							as={RouterLink}
							to={`${MARKETING_BASE}/${category.key}`}
							display="block"
							padding={5}
							background={MK.cardSolid}
							border={MK.border}
							borderRadius={MK.radius}
							boxShadow={MK.shadow}
							color={MK.ink}
							_hover={{ transform: 'translate(-2px, -2px)', boxShadow: MK.shadowLg }}
							transition="transform 140ms ease, box-shadow 140ms ease"
							data-testid="marketing-category-card"
						>
							<Text fontSize="30px" lineHeight={1} aria-hidden="true">
								{category.emoji}
							</Text>
							<Flex alignItems="baseline" justifyContent="space-between" gap={2} marginTop={3}>
								<Text fontWeight={900} fontSize="18px" letterSpacing="-0.01em">
									{category.name}
								</Text>
								<Text fontFamily={MK.mono} fontSize="12px" color={MK.muted}>
									{formatCount(counts[category.key] ?? 0)}
								</Text>
							</Flex>
							<Text fontSize="14px" color={MK.text} lineHeight={1.55} marginTop={1}>
								{category.blurb}
							</Text>
						</Box>
					))}
					<Box
						as={RouterLink}
						to={`${MARKETING_BASE}/social-media`}
						display="block"
						padding={5}
						background={MK.ink}
						border={MK.border}
						borderRadius={MK.radius}
						boxShadow={MK.shadow}
						color={MK.bg}
						_hover={{ transform: 'translate(-2px, -2px)', boxShadow: MK.shadowLg }}
						transition="transform 140ms ease, box-shadow 140ms ease"
						data-testid="marketing-social-card"
					>
						<Text fontSize="30px" lineHeight={1} aria-hidden="true">
							📸
						</Text>
						<Flex alignItems="baseline" justifyContent="space-between" gap={2} marginTop={3}>
							<Text fontWeight={900} fontSize="18px" letterSpacing="-0.01em">
								Social media images
							</Text>
							<Text fontFamily={MK.mono} fontSize="12px" opacity={0.7}>
								{formatCount(SOCIAL_ASSET_COUNT)}
							</Text>
						</Flex>
						<Text fontSize="14px" opacity={0.85} lineHeight={1.55} marginTop={1}>
							Downloadable PNG and SVG posts for every feature in twelve viral styles and ten platform sizes.
						</Text>
					</Box>
				</SimpleGrid>
			</Box>

			<Box as="section" paddingY={[8, 12]} borderTop={`1px solid ${MK.hairline}`} data-testid="marketing-showcase">
				<SectionTitle eyebrow="Watch it move" title="Animated walkthroughs on every guide" to={`${MARKETING_BASE}/walkthroughs`} linkLabel="All walkthroughs" />
				<WalkthroughPlayer walkthrough={showcase} autoplay />
			</Box>

			<Box as="section" paddingY={[8, 12]} borderTop={`1px solid ${MK.hairline}`}>
				<SectionTitle eyebrow="Features" title={`${FEATURES.length} feature pages`} to={`${MARKETING_BASE}/landing`} linkLabel="All features" />
				<Flex gap={2} flexWrap="wrap">
					{FEATURES.map((feature) => (
						<Chip key={feature.key} to={pageHref(`landing/${feature.key}`)}>
							<span aria-hidden="true">{feature.emoji}</span> {feature.name}
						</Chip>
					))}
				</Flex>
			</Box>

			<Box as="section" paddingY={[8, 12]} borderTop={`1px solid ${MK.hairline}`}>
				<SimpleGrid columns={[1, 1, 2]} gap={10}>
					<Box>
						<SectionTitle eyebrow="Audiences" title="Thingtime for…" to={`${MARKETING_BASE}/for`} linkLabel="All audiences" />
						<Flex gap={2} flexWrap="wrap">
							{PERSONAS.map((persona) => (
								<Chip key={persona.key} to={pageHref(`for/${persona.key}`)}>
									<span aria-hidden="true">{persona.emoji}</span> {persona.name}
								</Chip>
							))}
						</Flex>
					</Box>
					<Box>
						<SectionTitle eyebrow="Comparisons" title="Thingtime vs…" to={`${MARKETING_BASE}/compare`} linkLabel="All comparisons" />
						<Flex gap={2} flexWrap="wrap">
							{COMPETITORS.map((competitor) => (
								<Chip key={competitor.key} to={pageHref(`compare/thingtime-vs-${competitor.key}`)}>
									<span aria-hidden="true">{competitor.emoji}</span> {competitor.name}
								</Chip>
							))}
						</Flex>
					</Box>
				</SimpleGrid>
			</Box>

			<Box as="section" paddingY={[8, 12]} borderTop={`1px solid ${MK.hairline}`}>
				<SimpleGrid columns={[1, 1, 2]} gap={10}>
					<Box>
						<SectionTitle eyebrow="Use cases" title="Things people keep" to={`${MARKETING_BASE}/use-cases`} linkLabel="All use cases" />
						<Flex gap={2} flexWrap="wrap">
							{USE_CASES.map((useCase) => (
								<Chip key={useCase.key} to={pageHref(`use-cases/${useCase.key}`)}>
									<span aria-hidden="true">{useCase.emoji}</span> {useCase.name}
								</Chip>
							))}
						</Flex>
					</Box>
					<Box>
						<SectionTitle eyebrow="Styles" title="Twelve viral looks" to={`${MARKETING_BASE}/styles`} linkLabel="All style editions" />
						<Flex gap={2} flexWrap="wrap">
							{TRENDS.map((trend) => (
								<Chip key={trend.key} to={pageHref(`styles/${trend.key}/feed`)}>
									<span aria-hidden="true">{trend.emoji}</span> {trend.name}
								</Chip>
							))}
						</Flex>
					</Box>
				</SimpleGrid>
			</Box>

			<Box as="section" paddingY={[8, 12]} borderTop={`1px solid ${MK.hairline}`}>
				<Box background={MK.ink} color={MK.bg} borderRadius={MK.radius} padding={['28px', '48px']} boxShadow={MK.shadow}>
					<Text as="h2" fontSize="clamp(28px, 4.5vw, 52px)" fontWeight={900} letterSpacing="-0.03em" lineHeight={1.05} margin={0}>
						Start with one thing.
					</Text>
					<Text fontSize="16px" opacity={0.85} marginTop={3} maxWidth="560px" lineHeight={1.6}>
						Free while in beta. Nothing you make is lost when you register, and everything you make is a thing you own.
					</Text>
					<Flex gap={3} marginTop={6} flexWrap="wrap">
						<MkButton to="/register" variant="primary">
							Try Thingtime free
						</MkButton>
						<MkButton to="/docs" variant="secondary">
							Read the docs
						</MkButton>
					</Flex>
				</Box>
			</Box>
		</MarketingShell>
	);
}
