import React from 'react';
import { Box, Button, Center, Flex, Image, Text } from '@chakra-ui/react';

import type { AccountHint } from '~/hooks/usePasskeys';
import { RAINBOW } from '~/theme/rainbow';

// Shared "continue as" rows for the auto-login surfaces (the global popup and
// the login form's suggestion strip). Pure presentation — the host decides
// what picking an account or its passkey button does.

const hintDisplayName = (hint: AccountHint) => hint.user.displayName || hint.user.username;

const HintAvatar = (props: { hint: AccountHint }) => {
	const { user } = props.hint;
	if (user.avatarUrl) {
		return (
			<Image
				src={user.avatarUrl}
				alt={hintDisplayName(props.hint)}
				width="32px"
				height="32px"
				borderRadius="999px"
				objectFit="cover"
				flexShrink={0}
				border="1px solid var(--tt-border, #ececef)"
			/>
		);
	}
	return (
		<Center
			width="32px"
			height="32px"
			borderRadius="999px"
			flexShrink={0}
			background={RAINBOW}
			backgroundSize="calc(100px + 200%)"
			sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
			color="white"
			fontSize="xs"
			fontWeight="700"
		>
			{hintDisplayName(props.hint).trim().charAt(0).toUpperCase()}
		</Center>
	);
};

const originLabel = (origin: string) => {
	try {
		return new URL(origin).host;
	} catch {
		return origin;
	}
};

export const hintOriginsLabel = (hint: AccountHint) =>
	hint.origins.map((entry) => originLabel(entry.origin)).join(', ');

export const AccountHintRow = (props: {
	hint: AccountHint;
	onPick: (hint: AccountHint) => void;
	onPasskey?: ((hint: AccountHint) => void) | null;
	pickLabel?: string;
}) => {
	const { hint, onPick, onPasskey } = props;
	return (
		<Flex
			alignItems="center"
			columnGap={3}
			paddingY={2}
			paddingX={2}
			borderRadius="var(--tt-radius-sm, 9px)"
			transition="background 150ms ease"
			_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
		>
			<Flex
				as="button"
				type="button"
				onClick={() => onPick(hint)}
				alignItems="center"
				columnGap={3}
				flex="1"
				minWidth={0}
				cursor="pointer"
				textAlign="left"
			>
				<HintAvatar hint={hint} />
				<Box minWidth={0}>
					<Text fontSize="sm" fontWeight="600" color="var(--tt-ink, #16161a)" noOfLines={1}>
						{hintDisplayName(hint)}
					</Text>
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" noOfLines={1}>
						@{hint.user.username} · signed in on {hintOriginsLabel(hint)}
					</Text>
				</Box>
			</Flex>
			<Button size="xs" variant="outline" flexShrink={0} onClick={() => onPick(hint)}>
				{props.pickLabel || 'Continue'}
			</Button>
			{onPasskey ? (
				<Button
					size="xs"
					variant="outline"
					flexShrink={0}
					onClick={() => onPasskey(hint)}
					title="Sign in with a passkey"
				>
					🔑
				</Button>
			) : null}
		</Flex>
	);
};
