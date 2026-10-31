import { Box, Flex, Text } from '@chakra-ui/react';
import React from 'react';

import { Crumbs, MarketingShell, useMarketingSeo } from '~/components/Marketing/MarketingShell';
import { MK } from '~/components/Marketing/marketingTheme';
import type { AdminSurface } from '~/components/Marketing/MarketingPublishing';
import { MkButton } from '~/components/Marketing/Sections';
import { useMarketingVisibility } from '~/components/Marketing/useMarketingPublications';
import { MARKETING_BASE } from '~/marketing/catalog';
import type { TrendKey } from '~/marketing/types';

// What a visitor gets for an unpublished marketing surface — and what the
// suite renders on a true cold start while the publish state is unknown.
//
// Never a redirect: an admin shares the URL, publishes, and the same link
// starts working. The card carries robots=noindex so crawlers that execute
// JS do not index a placeholder, and the visible sub-nav only lists what IS
// published, so the gate leaks nothing about the rest of the catalog.

const useNoIndex = () => {
	React.useEffect(() => {
		if (typeof document === 'undefined') return;
		const meta = document.createElement('meta');
		meta.setAttribute('name', 'robots');
		meta.setAttribute('content', 'noindex');
		meta.setAttribute('data-marketing-gate', 'true');
		document.head.appendChild(meta);
		return () => {
			meta.remove();
		};
	}, []);
};

export const MarketingUnpublished = ({
	surface,
	trend = 'bold-brutal',
	active,
	crumbs
}: {
	surface: AdminSurface;
	trend?: TrendKey;
	active?: string;
	crumbs?: { to?: string; label: string }[];
}) => {
	const visibility = useMarketingVisibility();
	useMarketingSeo({ title: 'Not published yet', description: 'This part of the Thingtime marketing site is not published yet.' });
	useNoIndex();
	const home = visibility.hub ? { to: MARKETING_BASE, label: 'Back to marketing' } : { to: '/', label: 'Back to Thingtime' };
	return (
		<MarketingShell trend={trend} active={active} publication={surface}>
			<Crumbs items={crumbs ?? [visibility.hub ? { to: MARKETING_BASE, label: 'Marketing' } : { label: 'Marketing' }, { label: 'Not published' }]} />
			<Box paddingY={12} textAlign="center" data-testid="marketing-unpublished" data-publication-key={surface.key}>
				<Text fontSize="48px" aria-hidden="true">
					🔒
				</Text>
				<Text as="h1" fontSize="clamp(28px, 4vw, 44px)" fontWeight={900} letterSpacing="-0.02em" margin={0} color={MK.ink}>
					Not published yet
				</Text>
				<Text color={MK.text} marginTop={3} fontSize="16px" lineHeight={1.6} maxWidth="520px" marginX="auto">
					This part of the Thingtime marketing site is still being polished. Check back soon — or start with one thing today.
				</Text>
				<Flex justifyContent="center" gap={3} marginTop={8} flexWrap="wrap">
					<MkButton to={home.to} variant="primary">
						{home.label}
					</MkButton>
					<MkButton to="/register" variant="secondary">
						Try Thingtime free
					</MkButton>
				</Flex>
			</Box>
		</MarketingShell>
	);
};

/**
 * True cold start for a visitor: nothing cached, nothing fetched yet. An
 * empty themed surface (never a spinner) holds the page steady for the one
 * round trip the publications fetch takes.
 */
export const MarketingColdStart = () => (
	<Box minHeight="100vh" width="100%" background="var(--chakra-colors-chakra-body-bg, transparent)" data-testid="marketing-cold-start" aria-busy="true" />
);
