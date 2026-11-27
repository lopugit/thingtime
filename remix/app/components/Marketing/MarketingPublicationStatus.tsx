import { Button, Flex, Spinner, Text } from '@chakra-ui/react';
import React from 'react';
import type { PublicationsSnapshot } from './marketingPublicationsStore';

/** One inline status for the publication-dependent region; cached links stay usable. */
export const MarketingPublicationStatus = ({ state, retry }: {
	state: PublicationsSnapshot;
	retry: () => void;
}) => {
	const failed = state.status === 'degraded' || state.status === 'error';
	if (!failed && !state.refreshing) return null;
	return (
		<Flex align="center" gap={2} flexWrap="wrap" minWidth={0} data-testid="marketing-publication-status" aria-busy={state.refreshing}>
			<Text fontSize="xs" color="var(--tt-muted, #777783)" role="status">
				{failed ? `Publication status unavailable.${state.publications ? ' Showing saved visibility.' : ''}` : 'Updating publication status'}
			</Text>
			{state.refreshing ? <Spinner size="xs" aria-hidden="true" /> : failed ? <Button size="sm" variant="ghost" minHeight="44px" onClick={retry}>Retry</Button> : null}
		</Flex>
	);
};
