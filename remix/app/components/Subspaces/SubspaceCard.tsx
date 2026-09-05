import React from 'react';
import { Box, Button, Center, Flex, Image, Text } from '@chakra-ui/react';
import { Link } from 'react-router';

import { ACCESS_META, subspaceAccent, type PublicSubspace } from './subspaceTypes';

// One row of the /s directory and the "similar subspaces" sidebars: icon,
// name, /s/slug, member count, access badge, and a join/leave button that
// paints optimistically (the parent owns the API call + revert).

const INK = 'var(--tt-ink, #16161a)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_LG = 'var(--tt-radius-lg, 16px)';

export const SubspaceIcon = (props: { subspace: Pick<PublicSubspace, 'branding' | 'name' | 'slug'>; size?: string; fontSize?: string }) => {
	const { subspace, size = '44px', fontSize = 'xl' } = props;
	const accent = subspaceAccent(subspace);
	if (subspace.branding?.iconUrl) {
		return (
			<Image
				src={subspace.branding.iconUrl}
				alt={subspace.name}
				width={size}
				height={size}
				borderRadius="999px"
				objectFit="cover"
				flexShrink={0}
				border={`2px solid ${accent}`}
				background="var(--tt-surface-alt, #f5f5f7)"
			/>
		);
	}
	return (
		<Center width={size} height={size} borderRadius="999px" background={accent} color="white" fontSize={fontSize} flexShrink={0} fontWeight={700}>
			{subspace.branding?.icon || subspace.name.trim().charAt(0).toUpperCase() || '🪐'}
		</Center>
	);
};

export const SubspaceCard = (props: {
	subspace: PublicSubspace;
	onToggleMembership?: (subspace: PublicSubspace) => void;
	busy?: boolean;
	compact?: boolean;
}) => {
	const { subspace, onToggleMembership, busy, compact } = props;
	const access = ACCESS_META[subspace.access];
	const isOwner = subspace.viewer.role === 'owner';
	return (
		<Flex
			as={Link}
			to={`/s/${subspace.slug}`}
			alignItems="center"
			columnGap={3}
			padding={compact ? 3 : 4}
			background="var(--tt-card, #ffffff)"
			border={BORDER}
			borderRadius={RADIUS_LG}
			_hover={{ borderColor: subspaceAccent(subspace) }}
			transition="border-color 0.15s ease"
			data-subspace-slug={subspace.slug}
		>
			<SubspaceIcon subspace={subspace} size={compact ? '36px' : '44px'} fontSize={compact ? 'md' : 'xl'} />
			<Box flex="1" minWidth={0}>
				<Flex alignItems="center" columnGap={2} flexWrap="wrap">
					<Text fontWeight={700} color={INK} noOfLines={1}>
						{subspace.name}
					</Text>
					<Text fontFamily="mono" fontSize="xs" color={MUTED} noOfLines={1}>
						s/{subspace.slug}
					</Text>
					{subspace.access !== 'public' && (
						<Text as="span" fontSize="10px" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase" color={MUTED} title={access.hint}>
							{access.emoji} {access.label}
						</Text>
					)}
					{subspace.nsfw && (
						<Text as="span" fontSize="10px" fontWeight={700} color="var(--tt-danger, #e5484d)">
							18+
						</Text>
					)}
				</Flex>
				{!compact && subspace.description && (
					<Text fontSize="sm" color="var(--tt-text, #5a5a66)" noOfLines={2} whiteSpace="normal">
						{subspace.description}
					</Text>
				)}
				<Text fontSize="xs" color={MUTED} marginTop={compact ? 0 : 1}>
					{subspace.memberCount.toLocaleString()} {subspace.memberCount === 1 ? 'member' : 'members'}
					{typeof subspace.postCount === 'number' ? ` · ${subspace.postCount.toLocaleString()} posts` : ''}
				</Text>
			</Box>
			{onToggleMembership && !isOwner && (
				<Button
					size="xs"
					flexShrink={0}
					borderRadius="999px"
					variant={subspace.viewer.member ? 'outline' : 'solid'}
					background={subspace.viewer.member ? 'transparent' : subspaceAccent(subspace)}
					color={subspace.viewer.member ? INK : 'white'}
					borderColor="var(--tt-border, #ececef)"
					_hover={{ opacity: 0.85 }}
					isLoading={busy}
					isDisabled={subspace.viewer.banned}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onToggleMembership(subspace);
					}}
					aria-label={subspace.viewer.member ? `Leave s/${subspace.slug}` : `Join s/${subspace.slug}`}
				>
					{subspace.viewer.banned ? 'Banned' : subspace.viewer.member ? 'Joined ✓' : subspace.access === 'private' ? 'Private 🔒' : 'Join'}
				</Button>
			)}
		</Flex>
	);
};
