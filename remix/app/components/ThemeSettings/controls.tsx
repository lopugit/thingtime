import { Box, Flex, Input } from '@chakra-ui/react';
import React from 'react';

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

export const isHexColor = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

/** Swatch + hex/text input pair used by the Theme Studio and settings modal. */
export const ColorControl = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
	<Flex alignItems="center" gap="8px">
		<Box
			position="relative"
			width="28px"
			height="28px"
			borderRadius="var(--tt-radius-xs, 7px)"
			overflow="hidden"
			border="1px solid var(--tt-border, #ececef)"
		>
			<Box position="absolute" inset={0} background={value} />
			<Input
				type="color"
				value={isHexColor(value) ? value : '#888888'}
				onChange={(e) => onChange(e.target.value)}
				position="absolute"
				inset={0}
				opacity={0}
				width="100%"
				height="100%"
				padding={0}
				cursor="pointer"
			/>
		</Box>
		<Input
			value={value}
			onChange={(e) => onChange(e.target.value)}
			width="130px"
			size="sm"
			fontFamily={MONO}
			fontSize="12px"
			background="var(--tt-surface-alt, #f5f5f7)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-sm, 9px)"
		/>
	</Flex>
);
