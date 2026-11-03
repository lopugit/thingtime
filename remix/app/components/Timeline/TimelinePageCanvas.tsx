import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { NativeControlsEnabled } from '../Builder/NativeComponentControls';
import { WebpageBlocksRenderer, type ComponentsByRef } from '../Builder/WebpageBlocksRenderer';
import { sanitizeWebpageBlocks } from '../../schemas/registry';

/** Shared inert canvas for historical versions and merge reviews. */
export function TimelinePageCanvas({ blocks, components }: { blocks: unknown; components: ComponentsByRef }) {
	const sanitized = sanitizeWebpageBlocks(blocks);
	if (!sanitized.ok) return <Text role="status">This page version cannot be rendered safely. Its original data remains available.</Text>;
	return (
		<Box
			borderWidth="1px"
			borderColor="var(--tt-border)"
			borderRadius="lg"
			p={3}
			overflow="auto"
			maxH="520px"
			onClickCapture={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
			onSubmitCapture={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<NativeControlsEnabled.Provider value={false}>
				<WebpageBlocksRenderer blocks={sanitized.blocks as any} componentsByRef={components} interactive={false} />
			</NativeControlsEnabled.Provider>
		</Box>
	);
}
