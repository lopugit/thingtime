import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { componentBlocks, componentVersionBindings, mergeComponentVersions } from '../../timeline/componentMerge';
import type { BranchMergePreview } from '../../timeline/branchMerge';
import { TimelinePageCanvas } from './TimelinePageCanvas';

export function TimelineMergePagePreview({ preview }: { preview: BranchMergePreview }) {
	const [side, setSide] = React.useState<'current' | 'incoming' | 'result' | null>(null);
	if (!preview.components || !Array.isArray((preview.result.value as any)?.crystal?.blocks)) return null;
	const merged = mergeComponentVersions(preview.components, preview.result);
	const unresolved = !!(preview.conflicts.length || merged.conflicts.length);
	const selected = side === 'result' && unresolved ? 'current' : side;
	return (
		<Box mb={3}>
			<Flex gap={2} wrap="wrap" mb={2}>
				{(['current', 'incoming', 'result'] as const).map((key) => (
					<Button
						key={key}
						size="sm"
						variant={selected === key ? 'solid' : 'outline'}
						aria-pressed={selected === key}
						isDisabled={key === 'result' && unresolved}
						onClick={() => setSide(selected === key ? null : key)}
					>
						{key === 'current' ? 'Preview current branch' : key === 'incoming' ? 'Preview this version' : 'Preview merge result'}
					</Button>
				))}
			</Flex>
			{selected ? (
				<>
					<Text fontSize="sm" mb={2}>
						Recorded definitions only. Live data and actions are paused. Media and appearance may change independently.
					</Text>
					<TimelinePageCanvas
						blocks={componentBlocks(preview[selected])}
						components={
							selected === 'result'
								? (merged.result.value as any)
								: componentVersionBindings(preview.components[selected], preview.components.entries)
						}
					/>
				</>
			) : null}
		</Box>
	);
}
