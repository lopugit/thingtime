import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { componentBlocks } from '../../timeline/componentMerge';
import { previewComponentValues } from '../../timeline/componentDefinitions';
import type { PublishedVersionPreview } from '../../timeline/publishedVersion';
import { TimelinePageCanvas } from './TimelinePageCanvas';

export function TimelinePublishedPagePreview({
	preview,
	componentMode
}: {
	preview: PublishedVersionPreview;
	componentMode: 'recorded' | 'current';
}) {
	const [side, setSide] = React.useState<'current' | 'incoming' | 'result' | null>(null);
	if (!preview.thingtime?.includes('webpage') || !preview.components || !Array.isArray((preview.result.value as any)?.crystal?.blocks)) return null;
	const unresolved = !!(preview.conflicts.length || preview.components.conflicts.length);
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
						isDisabled={(key === 'current' && preview.current === null) || (key === 'result' && unresolved)}
						onClick={() => setSide(selected === key ? null : key)}
					>
						{key === 'current' ? 'Preview current page' : key === 'incoming' ? 'Preview this version' : 'Preview result'}
					</Button>
				))}
			</Flex>
			{selected ? (
				<>
					<Text fontSize="sm" mb={2}>
						Live data and actions are paused. Media and appearance may change independently.
					</Text>
					<TimelinePageCanvas
						blocks={componentBlocks(preview[selected])}
						components={previewComponentValues(preview.components[selected], selected === 'result' && componentMode === 'recorded') as any}
					/>
				</>
			) : null}
		</Box>
	);
}
