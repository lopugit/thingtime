import { Box, Flex, Input, SimpleGrid, Text } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';

import { MarketingColdStart, MarketingUnpublished } from '~/components/Marketing/MarketingGate';
import { PublishToggle, type AdminSurface } from '~/components/Marketing/MarketingPublishing';
import { MarketingShell, formatCount, formatPages, useMarketingSeo, useVisibleCounts } from '~/components/Marketing/MarketingShell';
import { MK, RAINBOW_TEXT_STYLE } from '~/components/Marketing/marketingTheme';
import { MkButton, SectionEyebrow } from '~/components/Marketing/Sections';
import { useMarketingVisibility } from '~/components/Marketing/useMarketingPublications';
import { WalkthroughPlayer } from '~/components/Marketing/WalkthroughPlayer';
import { CATEGORIES, MARKETING_BASE, pageHref, pagesInCategory } from '~/marketing/catalog';
import { COMPETITORS } from '~/marketing/competitors';
import { FEATURES } from '~/marketing/features';
import { PERSONAS } from '~/marketing/personas';
import { HUB_KEY, SOCIAL_KEY, categoryKey } from '~/marketing/publishing';
import { TRENDS } from '~/marketing/trends';
import { USE_CASES } from '~/marketing/useCases';
import { getWalkthrough } from '~/marketing/walkthroughs';

// /marketing — the hub. Every category, the social suite, and quick paths
// into features, audiences, comparisons and styles. Everything below is
// derived from the catalog, so the counts can never drift from the pages —
// and filtered through the publish state (marketing/publishing.ts), so a
// visitor only sees categories, image sets and pages an admin has published.

const HUB_SURFACE: AdminSurface = { key: HUB_KEY, label: 'Marketing hub' };

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

/** A chip row that only lists targets the viewer can open; the whole block drops when nothing is left. */
const ChipBlock = <T,>({
	eyebrow,
	title,
	to,
	linkLabel,
	items,
	href,
	render
}: {
	eyebrow: string;
	title: string;
	to?: string;
	linkLabel?: string;
	items: readonly T[];
	href: (item: T) => string;
	render: (item: T) => React.ReactNode;
}) => {
	const visibility = useMarketingVisibility();
	const visible = items.filter((item) => visibility.href(href(item)));
	if (!visible.length) return null;
	const linkOk = to ? visibility.href(to) : false;
	return (
		<Box>
			<SectionTitle eyebrow={eyebrow} title={title} to={linkOk ? to : undefined} linkLabel={linkOk ? linkLabel : undefined} />
			<Flex gap={2} flexWrap="wrap">
				{visible.map((item) => (
					<Chip key={href(item)} to={href(item)}>
						{render(item)}
					</Chip>
				))}
			</Flex>
		</Box>
	);
};

export default function MarketingIndex() {
	const navigate = useNavigate();
	const visibility = useMarketingVisibility();
	const counts = useVisibleCounts();
	const [query, setQuery] = React.useState('');
	const showcase = React.useMemo(() => getWalkthrough('feature-feed'), []);
	const categories = React.useMemo(
		() =>
			CATEGORIES.filter((category) => visibility.category(category.key)).map((category) => {
				const pages = pagesInCategory(category.key);
				return { category, total: pages.length, visible: visibility.pages(pages).length, published: visibility.isPublished(categoryKey(category.key)) };
			}),
		[visibility]
	);

	// the gate owns the tab title while it shows (never leak an unpublished surface's title)
	const gated = visibility.ready && !visibility.hub;
	useMarketingSeo({
		title: gated ? 'Not published yet' : 'Marketing',
		description: gated
			? 'This part of the Thingtime marketing site is not published yet.'
			: `${formatCount(counts.pages)} marketing pages, guides, comparisons and animated walkthroughs${
					counts.social ? ` plus ${formatCount(counts.social)} social images` : ''
			  } for Thingtime, generated from one catalog.`,
		// cold start writes nothing rather than a fail-closed "0 pages" blurb
		enabled: visibility.ready
	});

	if (!visibility.ready) return <MarketingColdStart />;
	if (!visibility.hub) return <MarketingUnpublished surface={HUB_SURFACE} crumbs={[{ label: 'Marketing' }]} />;

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const needle = query.trim();
		if (needle) navigate(`${MARKETING_BASE}/search?q=${encodeURIComponent(needle)}`);
	};

	const kinds = categories.length;
	const browseTitle = visibility.everything
		? 'Eleven kinds of page, one social suite'
		: kinds
			? `${formatCount(kinds)} ${kinds === 1 ? 'kind' : 'kinds'} of page${visibility.social ? ', one social suite' : ''}`
			: visibility.social
				? 'One social suite'
				: 'More on the way';

	return (
		<MarketingShell trend="bold-brutal" active={undefined} publication={HUB_SURFACE}>
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
				<Text fontSize={['16px', '19px']} lineHeight={1.6} color={MK.text} maxWidth="680px" marginTop={5} data-testid="marketing-hero-counts">
					{visibility.everything ? (
						<>
							{formatCount(counts.pages)} landing pages, how-to guides, comparisons, use cases and animated cursor walkthroughs, plus{' '}
							{formatCount(counts.social)} ready-to-post social images in twelve viral styles. {formatCount(counts.total)} assets, one catalog, zero lorem ipsum.
						</>
					) : (
						<>
							{formatPages(counts.pages)}: landing pages, how-to guides, comparisons, use cases and animated cursor walkthroughs
							{counts.social ? <>, plus {formatCount(counts.social)} ready-to-post social images in twelve viral styles</> : null}. One catalog, zero lorem ipsum.
						</>
					)}
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
				<SectionTitle eyebrow="Browse" title={browseTitle} />
				{categories.length || visibility.social ? (
					<SimpleGrid columns={[1, 2, 3]} gap={4}>
						{categories.map(({ category, total, visible, published }) => (
							<Box key={category.key} position="relative">
								<Box
									as={RouterLink}
									to={`${MARKETING_BASE}/${category.key}`}
									display="block"
									padding={5}
									background={MK.cardSolid}
									border={MK.border}
									borderRadius={MK.radius}
									boxShadow={MK.shadow}
									color={MK.ink}
									opacity={visibility.everything && !published ? 0.72 : 1}
									_hover={{ transform: 'translate(-2px, -2px)', boxShadow: MK.shadowLg }}
									transition="transform 140ms ease, box-shadow 140ms ease"
									data-testid="marketing-category-card"
									data-published={published ? 'true' : 'false'}
								>
									<Text fontSize="30px" lineHeight={1} aria-hidden="true">
										{category.emoji}
									</Text>
									<Flex alignItems="baseline" justifyContent="space-between" gap={2} marginTop={3}>
										<Text fontWeight={900} fontSize="18px" letterSpacing="-0.01em">
											{category.name}
										</Text>
										<Text fontFamily={MK.mono} fontSize="12px" color={MK.muted} title={visibility.everything ? `${visible} pages` : undefined}>
											{visibility.everything ? formatCount(total) : formatCount(visible)}
										</Text>
									</Flex>
									<Text fontSize="14px" color={MK.text} lineHeight={1.55} marginTop={1}>
										{category.blurb}
									</Text>
									{visibility.everything ? (
										<Text fontFamily={MK.mono} fontSize="11px" color={MK.muted} marginTop={3} data-testid="marketing-category-published-count">
											{formatCount(visibility.pages(pagesInCategory(category.key)).filter((entry) => visibility.isPublished(`page:${entry.slug}`)).length)} of{' '}
											{formatCount(total)} pages published
										</Text>
									) : null}
								</Box>
								<PublishToggle publicationKey={categoryKey(category.key)} label={`${category.name} index`} iconOnly position="absolute" top="12px" right="12px" />
							</Box>
						))}
						{visibility.social ? (
							<Box position="relative">
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
									opacity={visibility.everything && !visibility.isPublished(SOCIAL_KEY) ? 0.72 : 1}
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
											{formatCount(counts.social)}
										</Text>
									</Flex>
									<Text fontSize="14px" opacity={0.85} lineHeight={1.55} marginTop={1}>
										Downloadable PNG and SVG posts for every feature in twelve viral styles and ten platform sizes.
									</Text>
								</Box>
								<PublishToggle publicationKey={SOCIAL_KEY} label="Social image suite" iconOnly position="absolute" top="12px" right="12px" />
							</Box>
						) : null}
					</SimpleGrid>
				) : (
					<Box paddingY={8} textAlign="center" border={MK.border} borderRadius={MK.radius} background={MK.cardSolid} data-testid="marketing-hub-empty">
						<Text fontSize="40px" aria-hidden="true">
							🌱
						</Text>
						<Text fontWeight={800} fontSize="18px">
							Pages are on their way
						</Text>
						<Text color={MK.text} fontSize="14px" marginTop={1}>
							Nothing is published in the suite yet — check back soon.
						</Text>
					</Box>
				)}
			</Box>

			<Box as="section" paddingY={[8, 12]} borderTop={`1px solid ${MK.hairline}`} data-testid="marketing-showcase">
				<SectionTitle
					eyebrow="Watch it move"
					title="Animated walkthroughs on every guide"
					to={visibility.category('walkthroughs') ? `${MARKETING_BASE}/walkthroughs` : undefined}
					linkLabel={visibility.category('walkthroughs') ? 'All walkthroughs' : undefined}
				/>
				<WalkthroughPlayer walkthrough={showcase} autoplay />
			</Box>

			<ChipBlock
				eyebrow="Features"
				title={visibility.everything ? `${FEATURES.length} feature pages` : 'Feature pages'}
				to={`${MARKETING_BASE}/landing`}
				linkLabel="All features"
				items={FEATURES}
				href={(feature) => pageHref(`landing/${feature.key}`)}
				render={(feature) => (
					<>
						<span aria-hidden="true">{feature.emoji}</span> {feature.name}
					</>
				)}
			/>

			<SimpleGrid columns={[1, 1, 2]} gap={10} paddingY={[8, 12]}>
				<ChipBlock
					eyebrow="Audiences"
					title="Thingtime for…"
					to={`${MARKETING_BASE}/for`}
					linkLabel="All audiences"
					items={PERSONAS}
					href={(persona) => pageHref(`for/${persona.key}`)}
					render={(persona) => (
						<>
							<span aria-hidden="true">{persona.emoji}</span> {persona.name}
						</>
					)}
				/>
				<ChipBlock
					eyebrow="Comparisons"
					title="Thingtime vs…"
					to={`${MARKETING_BASE}/compare`}
					linkLabel="All comparisons"
					items={COMPETITORS}
					href={(competitor) => pageHref(`compare/thingtime-vs-${competitor.key}`)}
					render={(competitor) => (
						<>
							<span aria-hidden="true">{competitor.emoji}</span> {competitor.name}
						</>
					)}
				/>
				<ChipBlock
					eyebrow="Use cases"
					title="Things people keep"
					to={`${MARKETING_BASE}/use-cases`}
					linkLabel="All use cases"
					items={USE_CASES}
					href={(useCase) => pageHref(`use-cases/${useCase.key}`)}
					render={(useCase) => (
						<>
							<span aria-hidden="true">{useCase.emoji}</span> {useCase.name}
						</>
					)}
				/>
				<ChipBlock
					eyebrow="Styles"
					title="Twelve viral looks"
					to={`${MARKETING_BASE}/styles`}
					linkLabel="All style editions"
					items={TRENDS}
					href={(trend) => pageHref(`styles/${trend.key}/feed`)}
					render={(trend) => (
						<>
							<span aria-hidden="true">{trend.emoji}</span> {trend.name}
						</>
					)}
				/>
			</SimpleGrid>

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
