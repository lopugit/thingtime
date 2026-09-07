import React from 'react';
import { Flex, Text, Tooltip } from '@chakra-ui/react';
import { ArrowBigDown, ArrowBigUp } from 'lucide-react';

import type { PublicUpdownVotes, UpdownDirection } from './feedTypes';
import { EMPTY_VOTES } from './feedTypes';

// The up/down vote pill — Reddit-style ▲ score ▼ — that sits beside the
// native react button on posts and comments. Up/down votes are a SEPARATE,
// deliberately limited reaction kind (one of up/down per viewer), so this
// control never touches the emoji reactions; it only knows `votes` and
// reports the direction the viewer tapped. Tapping the active arrow again
// clears the vote (the parent applies applyUpdownVote optimistically).

const INK = 'var(--tt-ink, #16161a)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const UP = 'var(--tt-vote-up, #ff5a1f)';
const DOWN = 'var(--tt-vote-down, #4f7cff)';

export type UpdownControlProps = {
	votes: PublicUpdownVotes | null | undefined;
	onVote: (direction: UpdownDirection) => void;
	// guests still see the score; tapping nudges them to log in (parent decides)
	enabled?: boolean;
	// comments use the small variant
	size?: 'md' | 'sm';
	// optional accent for the "up" state (a subspace's branding colour)
	accent?: string | null;
};

const formatScore = (score: number): string => {
	const abs = Math.abs(score);
	if (abs < 1000) return String(score);
	if (abs < 1_000_000) return `${(score / 1000).toFixed(abs < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
	return `${(score / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
};

export const UpdownControl = (props: UpdownControlProps) => {
	const { onVote, enabled = true, size = 'md', accent } = props;
	const votes = props.votes || EMPTY_VOTES;
	const upColor = accent || UP;
	const active = votes.viewerVote;
	const iconSize = size === 'sm' ? 15 : 20;
	const arrow = (direction: UpdownDirection) => {
		const isActive = active === direction;
		const color = isActive ? (direction === 'up' ? upColor : DOWN) : MUTED;
		return (
			<Tooltip label={direction === 'up' ? (isActive ? 'Remove upvote' : 'Upvote') : isActive ? 'Remove downvote' : 'Downvote'} fontSize="xs" borderRadius="8px" hasArrow openDelay={400}>
				<Flex
					as="button"
					type="button"
					alignItems="center"
					justifyContent="center"
					width={size === 'sm' ? '22px' : '28px'}
					height={size === 'sm' ? '22px' : '28px'}
					borderRadius="999px"
					color={color}
					opacity={enabled ? 1 : 0.7}
					_hover={{ color: direction === 'up' ? upColor : DOWN, background: 'var(--tt-surface-hover, #ececee)' }}
					transition="color 0.12s ease-out, transform 0.12s ease-out"
					_active={{ transform: 'scale(1.15)' }}
					aria-label={direction === 'up' ? 'Upvote' : 'Downvote'}
					aria-pressed={isActive}
					data-updown={direction}
					onClick={(event: React.MouseEvent) => {
						event.stopPropagation();
						onVote(direction);
					}}
				>
					{direction === 'up' ? (
						<ArrowBigUp size={iconSize} strokeWidth={2} fill={isActive ? 'currentColor' : 'none'} />
					) : (
						<ArrowBigDown size={iconSize} strokeWidth={2} fill={isActive ? 'currentColor' : 'none'} />
					)}
				</Flex>
			</Tooltip>
		);
	};
	return (
		<Flex
			alignItems="center"
			columnGap={size === 'sm' ? 0 : 0.5}
			paddingX={size === 'sm' ? 0.5 : 1}
			height={size === 'sm' ? '24px' : '32px'}
			borderRadius="999px"
			border="1px solid var(--tt-border, #ececef)"
			background="var(--tt-card, #ffffff)"
			flexShrink={0}
			data-testid="updown-control"
			title={`${votes.up} up · ${votes.down} down`}
		>
			{arrow('up')}
			<Text
				as="span"
				minWidth={size === 'sm' ? '14px' : '18px'}
				textAlign="center"
				fontSize={size === 'sm' ? '11px' : 'sm'}
				fontWeight={700}
				lineHeight="1"
				sx={{ fontVariantNumeric: 'tabular-nums' }}
				color={active === 'up' ? upColor : active === 'down' ? DOWN : votes.score !== 0 ? INK : MUTED}
				data-updown-score={votes.score}
			>
				{formatScore(votes.score)}
			</Text>
			{arrow('down')}
		</Flex>
	);
};
