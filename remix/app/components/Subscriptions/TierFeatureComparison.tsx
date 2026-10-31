import React from 'react';
import { Box, SimpleGrid, Text } from '@chakra-ui/react';
import { speedTestAllowanceLabel, speedTestsPerHour, type SubscriptionTierDescriptor } from '~/api/utils/subscriptions/tierCatalog';
import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';

const CACHE_KEY = 'tt-subscription-tier-comparison-v1';
const validTiers = (value: unknown): SubscriptionTierDescriptor[] =>
	Array.isArray(value)
		? value.filter(
				(tier) =>
					tier &&
					typeof tier.id === 'string' &&
					typeof tier.versionId === 'string' &&
					typeof tier.title === 'string' &&
					typeof tier.emoji === 'string' &&
					tier.status === 'live' &&
					tier.quotas &&
					typeof tier.quotas === 'object'
		  )
		: [];

// One live catalog feeds customer comparisons and the admin tier editor.
// Never present bootstrap defaults as though they were current published plans.
export function TierFeatureComparison() {
	const { tiers: loadTiers } = useApi().v1;
	const lopu = useLopu();
	const report = React.useRef(lopu);
	report.current = lopu;
	const [tiers, setTiers] = React.useState<SubscriptionTierDescriptor[]>(() => {
		const cached = readLocalCache<SubscriptionTierDescriptor[]>(CACHE_KEY);
		return validTiers(cached);
	});
	React.useEffect(() => {
		const controller = new AbortController();
		void loadTiers({ signal: controller.signal })
			.then((result) => {
				if (controller.signal.aborted) return;
				if (!result?.ok || !Array.isArray(result.tiers)) throw new Error('Could not load the tier comparison');
				const live = validTiers(result.tiers);
				setTiers(live);
				writeLocalCache(CACHE_KEY, live);
			})
			.catch(() => {
				if (!controller.signal.aborted) report.current({ title: 'Could not refresh plan features', status: 'error' });
			});
		return () => controller.abort();
	}, [loadTiers]);

	return (
		<Box id="plan-features" width="100%" minW={0}>
			<Text fontWeight={700} mb={2}>
				Compare account features
			</Text>
			<Text fontSize="sm" mb={3}>
				Commander network speed tests
			</Text>
			{tiers.length ? (
				<SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} spacing={3}>
					{tiers.map((tier) => (
						<Box key={tier.versionId} borderWidth="1px" borderRadius="md" padding={3} minW={0}>
							<Text fontWeight={600} overflowWrap="anywhere">
								{tier.emoji} {tier.title}
							</Text>
							<Text mt={1} overflowWrap="anywhere">
								{speedTestAllowanceLabel(speedTestsPerHour(tier.id, tier.quotas))}
							</Text>
						</Box>
					))}
				</SimpleGrid>
			) : (
				<Text fontSize="sm">Plan features are not available yet.</Text>
			)}
			<Text fontSize="xs" mt={3} opacity={0.7}>
				Signed-in allowances are shared across your devices, not your internet connection. Hourly budgets allow back-to-back tests; each test uses
				17.6 MiB in each direction. Partial attempts use part of that allowance. Pro defaults to no speed-test quota. Fixed packet sizes and transfer
				timeouts still apply. Guests can run one test per 15 minutes per IP.
			</Text>
		</Box>
	);
}
