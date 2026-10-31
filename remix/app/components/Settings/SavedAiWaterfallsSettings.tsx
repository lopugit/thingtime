import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { AiWaterfallSelector } from '~/components/AI/AiWaterfallSelector';
import { useSavedAiWaterfalls } from '~/components/AI/useSavedAiWaterfalls';
import type { SavedAiWaterfall } from '~/api/utils/ai/savedWaterfallCore';
export const SavedAiWaterfallsSettings = ({ userId }: { userId: string }) => {
	const library = useSavedAiWaterfalls(userId);
	const [editing, setEditing] = React.useState<SavedAiWaterfall>();
	const [open, setOpen] = React.useState(false);
	return (
		<Flex direction="column" gap={3}>
			<Text>Keep named model and endpoint orders to reuse across features. Applying a saved waterfall copies it into that feature.</Text>
			<Button
				alignSelf="flex-start"
				onClick={() => {
					setEditing(undefined);
					setOpen(true);
				}}
			>
				New waterfall
			</Button>
			{library.error && <Text role="status">{library.error}</Text>}
			{!library.items.length && <Text fontSize="sm">No saved waterfalls yet.</Text>}
			{library.items.map((row) => (
				<Box key={row.id} borderWidth="1px" borderRadius="md" p={3} minW={0}>
					<Flex gap={3} align="center" justify="space-between" wrap="wrap">
						<Text fontWeight="600" overflowWrap="anywhere">
							{row.name}
						</Text>
						<Button
							size="sm"
							onClick={() => {
								setEditing(row);
								setOpen(true);
							}}
						>
							Edit waterfall
						</Button>
					</Flex>
					<Text mt={2} fontSize="sm" overflowWrap="anywhere">
						{row.config.entries.map((entry) => entry.modelId).join(' → ')}
					</Text>
				</Box>
			))}
			<AiWaterfallSelector
				isOpen={open}
				value={editing?.config ?? null}
				initialSaved={editing}
				endpoints={[
					...library.endpoints,
					{ id: 'default', label: 'Provider default', models: [{ id: 'default', label: 'Default model', efforts: [], speeds: ['normal'] }] }
				]}
				library={library}
				allowInherit={false}
				applyLabel="Close editor"
				onApply={() => {}}
				onClose={() => setOpen(false)}
			/>
		</Flex>
	);
};
