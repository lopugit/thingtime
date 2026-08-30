import type { ComponentType, ReactNode } from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { UserCard, RAINBOW } from '~/components/User/UserCard';
import { RAINBOW_TEXT } from '~/theme/rainbow';
import { getUserDisplayName } from '~/utils/userIdentity';

// The /welcome page decomposed into standalone, pixel-identical SECTIONS —
// the same components render the route AND its site-doc blocks (see
// Builder/nativeSections.tsx), so "every element within a native block is a
// builder block" holds with zero duplicated markup. The page has no loader
// and no page-local fetch: sections read the shared current-user state via
// useCurrentUser() (already optimistic/cached app-wide) and the dev
// verification link from router location state. Each section guards the
// no-user case itself so any section mounts independently, in any order.

export const WelcomeHeroSection = () => {
	const user = useCurrentUser();
	if (!user) return null;

	return (
		<Flex direction="column" align="center" gap={1} textAlign="center">
			<Text
				fontSize="2xl"
				fontWeight="800"
				fontFamily="heading"
				letterSpacing="-0.02em"
				background={RAINBOW_TEXT}
				backgroundSize="calc(100px + 200%)"
				sx={{
					WebkitBackgroundClip: 'text',
					backgroundClip: 'text',
					WebkitTextFillColor: 'transparent',
					animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
				}}
			>
				Welcome to Thingtime! 🎉
			</Text>
			<Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">
				Your account is ready, {getUserDisplayName(user)} ✨🦄
			</Text>
		</Flex>
	);
};

export const WelcomeCardSection = () => {
	const user = useCurrentUser();
	const navigate = useNavigate();
	const location = useLocation();
	const verificationLink = (location.state as any)?.verificationLink as string | undefined;

	if (!user) return null;

	return (
		<UserCard user={user}>
			{!user.emailVerified && !user.temporary && (
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
					📬 We sent a verification link to your email.
				</Text>
			)}
			{verificationLink && (
				<Box
					as="a"
					href={verificationLink}
					fontSize="xs"
					fontWeight="700"
					color="var(--tt-rainbow-5, #a555e8)"
					textDecoration="underline"
					wordBreak="break-all"
				>
					🔗 Verify your email now (dev)
				</Box>
			)}
			<Button
				mt={2}
				onClick={() => navigate('/')}
				color="white"
				fontFamily="heading"
				fontWeight="600"
				background={RAINBOW}
				backgroundSize="calc(100px + 200%)"
				sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
				_hover={{ opacity: 0.9 }}
				borderRadius="var(--tt-radius-md, 12px)"
			>
				Let's go →
			</Button>
		</UserCard>
	);
};

// Local ordered section list — the route renders this directly (it cannot
// import the Builder/nativeSections registry until this page's entry lands
// there; the coordinator wires the registry + seed centrally).
// The page-owned full-bleed wrapper (centering, gap, surface wash) — used by
// the route AND by doc-driven builder renders so 'full' pages keep their
// chrome everywhere.
export const WelcomeShell = ({ children }: { children: ReactNode }) => (
	<Flex
		minHeight="100vh"
		width="100%"
		align="center"
		justify="center"
		direction="column"
		px={4}
		gap={5}
		background="var(--tt-surface, #fafafb)"
	>
		{children}
	</Flex>
);

export const WELCOME_SECTIONS: Array<{ key: string; title: string; Component: ComponentType }> = [
	{ key: 'welcome-hero', title: 'Welcome hero', Component: WelcomeHeroSection },
	{ key: 'welcome-card', title: 'Account card', Component: WelcomeCardSection }
];
