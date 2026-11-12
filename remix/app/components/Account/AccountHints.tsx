import React from 'react';
import { Badge, Box, Button, Center, Flex, Image, Text } from '@chakra-ui/react';

import type { AccountHint } from '~/hooks/usePasskeys';
import { RAINBOW } from '~/theme/rainbow';

import { accountHintOriginPresentation, accountHintOriginsSummary } from './accountHintOrigin';

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

export const hintOriginsLabel = (hint: AccountHint) => accountHintOriginsSummary(hint.origins);

export const AccountHintRow = (props: {
	hint: AccountHint;
	onPick: (hint: AccountHint) => void;
	onPasskey?: ((hint: AccountHint) => void) | null;
	pickLabel?: string;
}) => {
	const { hint, onPick, onPasskey } = props;
	const [originsExpanded, setOriginsExpanded] = React.useState(false);
	const summary = hintOriginsLabel(hint);
	return (
		<Box
			padding={2}
			borderRadius="var(--tt-radius-sm, 9px)"
			transition="background 150ms ease"
			_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
		>
			<Flex alignItems="center" columnGap={3}>
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
						<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" noOfLines={1} title={`Signed in on ${summary}`}>
							@{hint.user.username} · signed in on {summary}
						</Text>
					</Box>
				</Flex>
				<Button
					size="xs"
					variant="ghost"
					flexShrink={0}
					onClick={() => setOriginsExpanded((expanded) => !expanded)}
					aria-expanded={originsExpanded}
					aria-label={originsExpanded ? 'Hide sign-in origin details' : 'Show sign-in origin details'}
				>
					{originsExpanded ? '⌃' : '⌄'}
				</Button>
				<Button size="xs" variant="outline" flexShrink={0} onClick={() => onPick(hint)}>
					{props.pickLabel || 'Continue'}
				</Button>
				{onPasskey ? (
					<Button size="xs" variant="outline" flexShrink={0} onClick={() => onPasskey(hint)} title="Sign in with a passkey">
						🔑
					</Button>
				) : null}
			</Flex>
			{originsExpanded ? (
				<Flex flexDirection="column" gap={1.5} marginTop={3} paddingLeft="44px">
					{hint.origins.map((entry) => {
						const source = accountHintOriginPresentation(entry.origin);
						return (
							<Flex key={`${entry.origin}:${entry.lastSeenAt}`} alignItems="center" columnGap={2} minWidth={0} flexWrap="wrap">
								<Badge colorScheme={source.environment === 'Production' ? 'purple' : source.environment === 'Local' ? 'gray' : 'blue'}>
									{source.environment}
								</Badge>
								<Text fontSize="xs" color="var(--tt-ink, #16161a)" fontFamily="mono" overflowWrap="anywhere">
									{source.origin}
								</Text>
								<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
									active {new Date(entry.lastSeenAt).toLocaleString()}
								</Text>
							</Flex>
						);
					})}
				</Flex>
			) : null}
		</Box>
	);
};
