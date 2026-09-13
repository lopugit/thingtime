import { Box, Flex, Input, Text } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';

import { PAGE_TOP_CLEARANCE } from '~/components/Layout/PageShell';
import { MarketingAdminBar, type AdminSurface } from '~/components/Marketing/MarketingPublishing';
import { useMarketingVisibility } from '~/components/Marketing/useMarketingPublications';
import { CATEGORIES, MARKETING_BASE, PAGES } from '~/marketing/catalog';
import { FEATURES } from '~/marketing/features';
import { SOCIAL_ASSET_COUNT } from '~/marketing/social';
import type { TrendKey } from '~/marketing/types';

import { MK, trendVars } from './marketingTheme';

// The chrome every /marketing page shares: a themed full-bleed wash, a
// sticky sub-nav (home, category chips, search) and a footer CTA. The trend
// decides the CSS variables; children only ever read --mk-*.

/**
 * Publishes the current surface's title/description into the document head.
 *
 * `enabled` is the fail-closed switch. While the publish state is unknown (a
 * visitor's cold start) the caller passes false and NOTHING is written: an
 * unpublished page never briefly advertises its own title and description,
 * and a published one is never briefly stamped with the gate's placeholder
 * either. The head simply keeps its previous values for the one round trip.
 */
export const useMarketingSeo = (input: { title: string; description: string; enabled?: boolean }) => {
	const enabled = input.enabled !== false;
	React.useEffect(() => {
		if (typeof document === 'undefined' || !enabled) return;
		document.title = `${input.title} · Thingtime`;
		const ensure = (selector: string, create: () => HTMLMetaElement) => {
			let element = document.head.querySelector<HTMLMetaElement>(selector);
			if (!element) {
				element = create();
				document.head.appendChild(element);
			}
			return element;
		};
		const description = ensure('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' }));
		const previousDescription = description.getAttribute('content');
		description.setAttribute('content', input.description);
		const ogTitle = ensure('meta[property="og:title"]', () => {
			const element = document.createElement('meta');
			element.setAttribute('property', 'og:title');
			return element;
		});
		const previousOgTitle = ogTitle.getAttribute('content');
		ogTitle.setAttribute('content', input.title);
		const ogDescription = ensure('meta[property="og:description"]', () => {
			const element = document.createElement('meta');
			element.setAttribute('property', 'og:description');
			return element;
		});
		const previousOgDescription = ogDescription.getAttribute('content');
		ogDescription.setAttribute('content', input.description);
		return () => {
			if (previousDescription) description.setAttribute('content', previousDescription);
			if (previousOgTitle) ogTitle.setAttribute('content', previousOgTitle);
			if (previousOgDescription) ogDescription.setAttribute('content', previousOgDescription);
		};
	}, [enabled, input.description, input.title]);
};

export const formatCount = (value: number) => value.toLocaleString('en-US');

/** "1 page" / "87 pages" — partial publishes make singulars common. */
export const formatPages = (value: number) => `${formatCount(value)} ${value === 1 ? 'page' : 'pages'}`;

const SOCIAL_ASSETS_PER_FEATURE = SOCIAL_ASSET_COUNT / FEATURES.length;

/**
 * The counts the chrome quotes, as the CURRENT viewer sees them: the whole
 * catalog for admins, only what is published for visitors — so a visitor
 * with three published pages is never promised 1,600.
 */
export const useVisibleCounts = () => {
	const visibility = useMarketingVisibility();
	return React.useMemo(() => {
		const pages = visibility.pages(PAGES).length;
		const social = visibility.social ? visibility.features(FEATURES).length * SOCIAL_ASSETS_PER_FEATURE : 0;
		return { pages, social, total: pages + social };
	}, [visibility]);
};

export const MarketingSubNav = ({ active, query }: { active?: string; query?: string }) => {
	const navigate = useNavigate();
	const location = useLocation();
	const visibility = useMarketingVisibility();
	const counts = useVisibleCounts();
	const [search, setSearch] = React.useState(query ?? '');
	React.useEffect(() => setSearch(query ?? ''), [query, location.pathname]);
	// visitors only see published categories (and the social chip once the
	// suite is published); the home link and search need the hub itself
	const categories = React.useMemo(() => CATEGORIES.filter((category) => visibility.category(category.key)), [visibility]);

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const needle = search.trim();
		navigate(needle ? `${MARKETING_BASE}/search?q=${encodeURIComponent(needle)}` : MARKETING_BASE);
	};

	return (
		<Box
			as="nav"
			aria-label="Marketing sections"
			position="sticky"
			top={PAGE_TOP_CLEARANCE}
			zIndex={5}
			background="color-mix(in srgb, var(--mk-bg) 86%, transparent)"
			backdropFilter="blur(10px)"
			borderBottom={`1px solid ${MK.hairline}`}
			data-testid="marketing-subnav"
		>
			<Flex maxWidth="1180px" margin="0 auto" px={4} py={2} alignItems="center" gap={3} flexWrap="nowrap">
				{visibility.hub ? (
					<Box
						as={RouterLink}
						to={MARKETING_BASE}
						display="inline-flex"
						alignItems="center"
						gap={2}
						fontFamily={MK.font}
						fontWeight={800}
						fontSize="14px"
						color={MK.ink}
						flex="none"
						_hover={{ color: MK.accent }}
						data-testid="marketing-subnav-home"
					>
						🌈 Marketing
					</Box>
				) : (
					// the hub is not published: a wordmark, not a link into a gate
					<Box as="span" display="inline-flex" alignItems="center" gap={2} fontFamily={MK.font} fontWeight={800} fontSize="14px" color={MK.ink} flex="none" data-testid="marketing-subnav-home">
						🌈 Marketing
					</Box>
				)}
				<Flex
					as="ul"
					listStyleType="none"
					margin={0}
					padding={0}
					gap={1.5}
					overflowX="auto"
					flex="1 1 auto"
					minWidth={0}
					sx={{ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
				>
					{categories.map((category) => {
						const isActive = active === category.key;
						return (
							<Box as="li" key={category.key} flex="none">
								<Box
									as={RouterLink}
									to={`${MARKETING_BASE}/${category.key}`}
									display="inline-flex"
									alignItems="center"
									gap={1}
									px={2.5}
									py={1}
									fontSize="12px"
									fontWeight={700}
									fontFamily={MK.font}
									color={isActive ? MK.accentContrast : MK.ink}
									background={isActive ? MK.accent : MK.tint}
									border={isActive ? `1px solid ${MK.accent}` : `1px solid ${MK.hairline}`}
									borderRadius={MK.radiusSm}
									whiteSpace="nowrap"
									_hover={{ background: isActive ? MK.accent : MK.card, borderColor: MK.ink }}
									aria-current={isActive ? 'page' : undefined}
								>
									<span aria-hidden="true">{category.emoji}</span> {category.name}
								</Box>
							</Box>
						);
					})}
					{visibility.social ? (
					<Box as="li" flex="none">
						<Box
							as={RouterLink}
							to={`${MARKETING_BASE}/social-media`}
							display="inline-flex"
							alignItems="center"
							gap={1}
							px={2.5}
							py={1}
							fontSize="12px"
							fontWeight={700}
							fontFamily={MK.font}
							color={active === 'social-media' ? MK.accentContrast : MK.ink}
							background={active === 'social-media' ? MK.accent : MK.tint}
							border={`1px solid ${active === 'social-media' ? MK.accent : MK.hairline}`}
							borderRadius={MK.radiusSm}
							whiteSpace="nowrap"
							_hover={{ borderColor: MK.ink }}
							aria-current={active === 'social-media' ? 'page' : undefined}
						>
							<span aria-hidden="true">📸</span> Social images
						</Box>
					</Box>
					) : null}
				</Flex>
				{visibility.hub ? (
				<Box as="form" onSubmit={submit} role="search" flex="none" display={['none', 'none', 'block']}>
					<Input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder={`Search ${formatPages(counts.pages)}…`}
						size="sm"
						width="220px"
						background={MK.card}
						color={MK.ink}
						borderColor={MK.hairline}
						borderRadius={MK.radiusSm}
						fontFamily={MK.font}
						_placeholder={{ color: MK.muted }}
						aria-label="Search marketing pages"
					/>
				</Box>
				) : null}
			</Flex>
		</Box>
	);
};

export const MarketingShell = ({
	trend,
	active,
	query,
	width = 1180,
	publication,
	children
}: {
	trend: TrendKey;
	active?: string;
	query?: string;
	width?: number;
	/** The surface an admin can publish from this page (renders the admin bar for admins only). */
	publication?: AdminSurface;
	children: React.ReactNode;
}) => {
	const vars = React.useMemo(() => trendVars(trend), [trend]);
	return (
		<Box
			className="ttMarketing"
			data-trend={trend}
			style={vars as React.CSSProperties}
			background={MK.bg}
			color={MK.ink}
			minHeight="100vh"
			paddingTop={PAGE_TOP_CLEARANCE}
			width="100%"
			sx={{ whiteSpace: 'normal', fontFamily: MK.font, '& *': { boxSizing: 'border-box' } }}
		>
			<MarketingSubNav active={active} query={query} />
			<Box as="main" maxWidth={`${width}px`} margin="0 auto" px={4} pb={16}>
				<MarketingAdminBar surface={publication} />
				{children}
			</Box>
			<MarketingFooter />
		</Box>
	);
};

export const MarketingFooter = () => {
	const visibility = useMarketingVisibility();
	const counts = useVisibleCounts();
	const links = [
		{ to: '/register', label: 'Try it free' },
		{ to: '/docs', label: 'Docs' },
		{ to: '/branding', label: 'Brand' },
		{ to: `${MARKETING_BASE}/social-media`, label: 'Social images' },
		{ to: `${MARKETING_BASE}/compare`, label: 'Comparisons' },
		{ to: `${MARKETING_BASE}/for`, label: 'For you' }
	].filter((link) => visibility.href(link.to));
	return (
	<Box as="footer" borderTop={`1px solid ${MK.hairline}`} background={MK.bg2} data-testid="marketing-footer">
		<Flex maxWidth="1180px" margin="0 auto" px={4} py={8} gap={6} flexWrap="wrap" justifyContent="space-between" alignItems="flex-start">
			<Box maxWidth="460px">
				<Text fontFamily={MK.font} fontWeight={800} fontSize="18px" color={MK.ink}>
					🌈 thingtime
				</Text>
				<Text fontSize="13px" color={MK.text} lineHeight={1.6} marginTop={1}>
					A GUI for the internet. Everything is a thing: yours, open, exportable, and free while in beta.
					{counts.total > 0 ? (
						<>
							{' '}This marketing suite holds {formatPages(counts.pages)}
							{counts.social > 0 ? ` and ${formatCount(counts.social)} social images, ${formatCount(counts.total)} assets in all` : ''}, generated from one catalog.
						</>
					) : null}
				</Text>
			</Box>
			<Flex as="ul" listStyleType="none" margin={0} padding={0} gap={4} flexWrap="wrap" fontSize="13px" fontWeight={700}>
				{links.map((link) => (
					<Box as="li" key={link.to}>
						<Box as={RouterLink} to={link.to} color={MK.ink} _hover={{ color: MK.accent }}>
							{link.label}
						</Box>
					</Box>
				))}
			</Flex>
		</Flex>
	</Box>
	);
};

export const Crumbs = ({ items }: { items: { to?: string; label: string }[] }) => (
	<Flex as="nav" aria-label="Breadcrumb" gap={2} alignItems="center" fontSize="12px" color={MK.muted} fontFamily={MK.mono} paddingTop={4} flexWrap="wrap">
		{items.map((item, index) => (
			<React.Fragment key={`${item.label}-${index}`}>
				{index > 0 ? <span aria-hidden="true">›</span> : null}
				{item.to ? (
					<Box as={RouterLink} to={item.to} color={MK.muted} _hover={{ color: MK.ink }}>
						{item.label}
					</Box>
				) : (
					<Text as="span" color={MK.ink}>
						{item.label}
					</Text>
				)}
			</React.Fragment>
		))}
	</Flex>
);
