import React from 'react';
import { FEATURE_STACK_MAX_AI_ATTEMPTS } from '~/api/utils/ciControl/featureStackModels';
import { Box, Button, Link, Text } from '@chakra-ui/react';
import { SavedAiWaterfallSelector } from '~/components/AI/SavedAiWaterfallSelector';
import type { AiWaterfallConfig } from '~/api/utils/ai/waterfallConfig';
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
	return (
		<Box mt={4}>
			<Text fontSize="xs" fontWeight="600">
				AI model &amp; endpoint
			</Text>
			<Text fontSize="xs" mt={1} overflowWrap="anywhere">
				{value ? `${value.entries[0].modelId} · ${value.entries.length - 1} fallbacks` : 'Use shared AI settings'}
			</Text>
			<Button size="sm" variant="outline" mt={2} isDisabled={disabled} onClick={() => setOpen(true)}>
				Choose AI waterfall
			</Button>
			<Text fontSize="xs" mt={2}>
				<Link href="/settings/ai-waterfalls">Saved AI waterfalls</Link> · <Link href="/settings#secure-vault">Endpoint connections</Link>
			</Text>
			<SavedAiWaterfallSelector
				isOpen={open}
				maxEntries={FEATURE_STACK_MAX_AI_ATTEMPTS}
				value={value}
				onApply={onChange}
				onClose={() => setOpen(false)}
			/>
		</Box>
	);
};
