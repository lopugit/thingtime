import React from 'react';
import { Flex, Text } from '@chakra-ui/react';

// A quiet, Apple-like chip: hairline border, soft tint, a small tone dot,
// tokens throughout so every theme restyles it. Three sizes (sm/md/lg) so the
// same vocabulary scales from dense lists to the detail inspector.

export type ChipTone = 'neutral' | 'read' | 'write' | 'invoke' | 'create' | 'ok' | 'danger';
export type ChipSize = 'sm' | 'md' | 'lg';

const TONE_DOTS: Record<ChipTone, string> = {
	neutral: 'var(--tt-muted, #9a9aa6)',
	read: 'var(--tt-link, #4c7dff)',
	write: 'var(--tt-warning, #e8a33d)',
	invoke: 'var(--tt-accent, #7c6cff)',
	create: 'var(--tt-positive, #2f9e63)',
	ok: 'var(--tt-positive, #2f9e63)',
	danger: 'var(--tt-danger, #e5484d)'
};

const SIZE_STYLES: Record<ChipSize, { fontSize: string; paddingX: string; paddingY: string; dot: string }> = {
	sm: { fontSize: '10.5px', paddingX: '7px', paddingY: '2px', dot: '5px' },
	md: { fontSize: '12px', paddingX: '9px', paddingY: '3px', dot: '6px' },
	lg: { fontSize: '13px', paddingX: '11px', paddingY: '4px', dot: '7px' }
};

export const ActionChip = ({
	children,
	dot = true,
	size = 'md',
	tone = 'neutral',
	...rest
}: {
	children: React.ReactNode;
	dot?: boolean;
	size?: ChipSize;
	tone?: ChipTone;
} & Record<string, unknown>) => {
	const sizing = SIZE_STYLES[size];
	return (
		<Flex
			align="center"
			background="var(--tt-surface-alt, #f5f5f7)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-pill, 999px)"
			display="inline-flex"
			gap="6px"
			maxWidth="100%"
			minWidth={0}
			paddingX={sizing.paddingX}
			paddingY={sizing.paddingY}
			width="fit-content"
			{...rest}
		>
			{dot ? <Flex background={TONE_DOTS[tone]} borderRadius="full" flexShrink={0} height={sizing.dot} width={sizing.dot} /> : null}
			<Text
				color="var(--tt-text, #33333c)"
				fontSize={sizing.fontSize}
				fontWeight="500"
				lineHeight="1.3"
				overflow="hidden"
				textOverflow="ellipsis"
				whiteSpace="nowrap"
			>
				{children}
			</Text>
		</Flex>
	);
};
