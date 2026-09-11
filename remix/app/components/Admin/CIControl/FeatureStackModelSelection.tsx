import React from 'react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { FEATURE_STACK_MAX_AI_ATTEMPTS } from '~/api/utils/ciControl/featureStackModels';
import { Box, Button, Link, Text } from '@chakra-ui/react';
import { AiWaterfallSelector } from '~/components/AI/AiWaterfallSelector';
import { aiWaterfallEndpoints } from '~/api/utils/ai/waterfallCatalog';
import type { AiWaterfallConfig } from '~/api/utils/ai/waterfallConfig';
import type { LopuVaultProviderPublic } from '~/api/utils/lopu/vaultProviders';

export const FeatureStackModelSelection = ({
	value,
	onChange,
	disabled
}: {
	value: AiWaterfallConfig | null;
	onChange: (value: AiWaterfallConfig | null) => void;
	disabled: boolean;
}) => {
	const [open, setOpen] = React.useState(false);
	const [connections, setConnections] = React.useState<LopuVaultProviderPublic[]>([]);
	const [failed, setFailed] = React.useState(false);
	React.useEffect(() => {
		if (!open) return;
		const controller = new AbortController();
		requireThingtimeCapability('api.ai-models', '1.4.0')
			.then(() => fetch('/api/v1/ai/models', { signal: controller.signal, credentials: 'same-origin' }))
			.then(async (response) => {
				if (!response.ok) throw new Error('Catalog unavailable');
				const result = await response.json();
				setConnections(result.vaultProviders ?? []);
				setFailed(false);
			})
			.catch(() => {
				if (!controller.signal.aborted) setFailed(true);
			});
		return () => controller.abort();
	}, [open]);
	return (
		<Box mt={4}>
			<Text fontSize="xs" fontWeight="600">
				AI model & endpoint
			</Text>
			<Text fontSize="xs" mt={1} overflowWrap="anywhere">
				{value
					? `${value.entries[0].modelId} · ${value.entries.length - 1} fallback${value.entries.length === 2 ? '' : 's'}`
					: 'Use shared AI settings'}
			</Text>
			<Button size="sm" variant="outline" mt={2} isDisabled={disabled} onClick={() => setOpen(true)}>
				Choose AI waterfall
			</Button>
			{failed && (
				<Text fontSize="xs" mt={2}>
					Your endpoint list could not be refreshed. Reopen the selector to retry.
				</Text>
			)}
			<Text fontSize="xs" mt={2}>
				<Link href="/settings#secure-vault">Manage endpoint connections</Link>
			</Text>
			<AiWaterfallSelector
				isOpen={open}
				maxEntries={FEATURE_STACK_MAX_AI_ATTEMPTS}
				value={value}
				endpoints={aiWaterfallEndpoints(connections)}
				onApply={onChange}
				onClose={() => setOpen(false)}
			/>
		</Box>
	);
};
