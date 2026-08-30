import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { Icon } from '~/components/Icon/Icon';
import { AuthorAvatar } from '~/components/Feed/PostCard';
import type { FeedAuthor } from '~/components/Feed/feedTypes';
import { UserAvatarCircle } from '~/components/Nav/Drawer/DrawerContent';
import { ProfileAvatarCircle, ProfileBanner } from '~/components/Profile/ProfilePage';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Avatars + identity entry. Every circle below is the
// REAL component (AuthorAvatar, ProfileAvatarCircle, ProfileBanner,
// UserAvatarCircle) fed fake users inline — no fetches. The one image avatar
// is an inline data: URI so the story stays fully offline.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const Caption = (props: { children: React.ReactNode }) => (
	<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" textAlign="center">
		{props.children}
	</Text>
);

// Offline "uploaded avatar" — a tiny inline SVG portrait.
const FAKE_AVATAR_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#ffbc48"/><circle cx="32" cy="25" r="11" fill="#ffffff"/><path d="M12 64a20 20 0 0 1 40 0z" fill="#ffffff"/></svg>'
)}`;

const PETAL: FeedAuthor = {
	id: 'story-petal',
	username: 'petal',
	displayName: 'Petal 🌸',
	temporary: false,
	avatarUrl: null
};

const JUNIPER: FeedAuthor = {
	id: 'story-juniper',
	username: 'juniper',
	displayName: null,
	temporary: false,
	avatarUrl: null
};

const SUNNY: FeedAuthor = {
	id: 'story-sunny',
	username: 'sunny',
	displayName: 'Sunny',
	temporary: false,
	avatarUrl: FAKE_AVATAR_URI
};

const AvatarScaleStory = () => (
	<Flex alignItems="flex-end" columnGap={6} rowGap={5} flexWrap="wrap">
		<Flex flexDirection="column" alignItems="center" rowGap="8px">
			<ProfileAvatarCircle avatarUrl={null} name="Petal 🌸" size="96px" borderWidth="4px" />
			<Caption>96px · profile header (4px card ring)</Caption>
		</Flex>
		<Flex flexDirection="column" alignItems="center" rowGap="8px">
			<AuthorAvatar author={JUNIPER} size="36px" />
			<Caption>36px · post header + comments</Caption>
		</Flex>
		<Flex flexDirection="column" alignItems="center" rowGap="8px">
			<ProfileAvatarCircle avatarUrl={null} name="Sunny" size="28px" fontSize="xs" />
			<Caption>28px · nav / drawer</Caption>
		</Flex>
		<Flex flexDirection="column" alignItems="center" rowGap="8px">
			<AuthorAvatar author={PETAL} size="22px" fontSize="10px" />
			<Caption>22px · shared-post byline</Caption>
		</Flex>
		<Flex flexDirection="column" alignItems="center" rowGap="8px">
			<AuthorAvatar author={SUNNY} size="36px" />
			<Caption>set avatar — the image always wins</Caption>
		</Flex>
		<Flex flexDirection="column" alignItems="center" rowGap="8px">
			<AuthorAvatar author={null} size="36px" />
			<Caption>no author · “?” on surface-alt</Caption>
		</Flex>
		<Flex flexDirection="column" alignItems="center" rowGap="8px">
			<UserAvatarCircle />
			<Caption>you, live (UserAvatarCircle)</Caption>
		</Flex>
	</Flex>
);

const AuthorRowsStory = () => (
	<Flex flexDirection="column" rowGap={4} maxWidth="440px">
		<Box
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			padding={3}
		>
			<Flex alignItems="center" columnGap={2} marginBottom={2}>
				<AuthorAvatar author={PETAL} size="22px" fontSize="10px" />
				<Text fontSize="xs" fontWeight={700} color="var(--tt-ink, #16161a)" noOfLines={1}>
					Petal 🌸
				</Text>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" flexShrink={0}>
					·
				</Text>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" flexShrink={0} _hover={{ textDecoration: 'underline' }}>
					2h
				</Text>
			</Flex>
			<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
				The sunflowers opened this morning 🌻
			</Text>
		</Box>
		<Flex columnGap={2} alignItems="flex-start">
			<AuthorAvatar author={JUNIPER} size="36px" />
			<Box
				background="var(--tt-surface-alt, #f5f5f7)"
				borderRadius="var(--tt-radius-md, 12px)"
				paddingX={3}
				paddingY={2}
			>
				<Text fontSize="xs" fontWeight={700} color="var(--tt-ink, #16161a)">
					juniper
				</Text>
				<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
					Comment rows reuse the exact same AuthorAvatar, one size up.
				</Text>
			</Box>
		</Flex>
		<Flex columnGap={2} alignItems="center">
			<AuthorAvatar author={null} size="22px" fontSize="10px" />
			<Text fontSize="xs" fontWeight={700} color="var(--tt-ink, #16161a)">
				Anonymous 👻
			</Text>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
				· null author — no link, “?” circle
			</Text>
		</Flex>
	</Flex>
);

const ProfileHeaderStory = () => (
	<Box maxWidth="520px">
		<ProfileBanner bannerUrl={null} height={['96px', '140px']} />
		<Flex marginTop="-44px" paddingX="20px" alignItems="flex-end" columnGap="14px">
			<ProfileAvatarCircle avatarUrl={null} name="Petal 🌸" size="96px" borderWidth="4px" />
			<Box paddingBottom="4px" minWidth={0}>
				<Text
					fontFamily="var(--tt-font-heading, system-ui, sans-serif)"
					fontSize="20px"
					fontWeight={700}
					letterSpacing="-0.02em"
					color="var(--tt-ink, #16161a)"
					noOfLines={1}
				>
					Petal 🌸
				</Text>
				<Text fontFamily={MONO} fontSize="11px" color="var(--tt-muted, #9a9aa6)">
					@petal · joined June 2026
				</Text>
			</Box>
		</Flex>
	</Box>
);

const NavIdentityStory = () => (
	<Flex flexDirection="column" rowGap={4} maxWidth="440px">
		<Flex
			alignItems="center"
			justifyContent="flex-end"
			columnGap={4}
			paddingX={4}
			paddingY="10px"
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
		>
			<Icon chakras={{ opacity: 0.3 }} size="12px" name="👀"></Icon>
			<Icon size="12px" name="🎨"></Icon>
			<Flex flexDir="row" gap={2} alignItems="center" cursor="pointer">
				<Box fontSize="xs" fontWeight="600">
					Petal 🌸
				</Box>
				<Icon transform="scaleX(-100%)" size="12px" name="🌈"></Icon>
			</Flex>
			<Icon size="12px" name="🦄"></Icon>
		</Flex>
		<Flex
			alignItems="center"
			justifyContent="flex-end"
			columnGap={4}
			paddingX={4}
			paddingY="10px"
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
		>
			<Flex flexDir="row" gap={2} alignItems="center" cursor="pointer">
				<Box fontSize="xs" opacity={0.5}>
					Login
				</Box>
				<Icon transform="scaleX(-100%)" size="12px" name="🌈"></Icon>
			</Flex>
			<Icon size="12px" name="🦄"></Icon>
		</Flex>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
			signed-in vs signed-out nav cluster — the 🌈 is the identity mark in both, mirrored (scaleX −100%) on desktop
		</Text>
	</Flex>
);

export const avatarIdentityStories: DesignSystemStory[] = [
	{
		id: 'avatar-scale',
		title: 'The rainbow circle, at every size',
		description:
			'One idiom, four sizes: a 999px circle that shows the uploaded image when avatarUrl is set and otherwise falls back to the animated brand rainbow behind a white 700-weight initial. 96px on profile headers (with a 4px card-colour ring over the banner), 36px on posts and comments, 28px in the nav and drawer, 22px in shared-post bylines. No author at all renders “?” on surface-alt — grey means nobody, rainbow means somebody.',
		render: AvatarScaleStory,
		note: 'The last circle is the live UserAvatarCircle: your own avatar when signed in, the 🌈 icon on surface-alt when signed out.'
	},
	{
		id: 'author-rows',
		title: 'Author rows in feed cards',
		description:
			'The byline recipe from PostCard: AuthorAvatar (22px in shared sub-cards, 36px on post headers and comments) + display name at xs/700 ink + a middot + the muted relative timestamp, which is always a permalink to /post/:id. Comments keep the identical avatar and wrap the words in a surface-alt bubble. A null author renders “Anonymous 👻” with the grey “?” circle and no profile link.',
		render: AuthorRowsStory,
		note: 'Avatars with a username are wrapped in a Link to /profile/:username by AuthorAvatar itself — never re-wrap them.'
	},
	{
		id: 'profile-header',
		title: 'Profile header cluster',
		description:
			'ProfileBanner + ProfileAvatarCircle composed the way /profile does it: the banner strip (uploaded image, or the animated rainbow gradient when unset) with the 96px avatar overlapping its bottom edge, ringed in 4px of card colour so it reads cleanly over both image and rainbow. Name in heading type, @username + joined date in muted mono underneath. The live page uses banner heights [140px, 220px]; this story is scaled down to fit.',
		render: ProfileHeaderStory,
		note: 'Both components are shared with EditProfileModal’s live preview — edit-profile shows exactly what the header will render.'
	},
	{
		id: 'nav-identity',
		title: 'Nav identity cluster',
		description:
			'The right end of the fixed nav, recreated: edit-mode toggles (👀 viewer at 0.3 opacity until active, 🎨 edit), then the identity cluster — display name at xs/600 next to the mirrored 🌈, linking to /profile — and the 🦄 home link. Signed out, the cluster reads “Login” at half opacity with the same 🌈: the rainbow is the constant, presence is the variable.',
		render: NavIdentityStory,
		note: 'Seven quick clicks on the live nav 🦄 trigger the tt-gallop easter egg — see the Rainbow + motion entry.'
	}
];
