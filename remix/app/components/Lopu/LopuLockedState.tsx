import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router';

import { LopuRingAvatar } from './LopuActivityBadge';
import { LOPU_UI, lopuFocusRingSx } from './lopuTheme';
import type { LopuLockReason } from './useLopuAccount';

// 🦄 The locked state (verified-credits design note §4): what the /lopu page,
// the floating window / sheet and voice mode draw in place of the
// conversation while Lopu is invite-only for this account — the unicorn on
// its ring, "Lopu is invite-only for now", one line saying an admin must
// verify the account, and for admins a link to Admin → Lopu accounts. The
// composer and the mic stay visible but disabled around it; the navbar 🦄
// and the drawer entry keep opening this view, so there is never a dead end.

export const LOPU_LOCKED_TITLE = 'Lopu is invite-only for now';
export const LOPU_LOCKED_LINE = 'An admin needs to verify your account before Lopu can build with you.';
export const LOPU_LOCKED_BYO_LINE = 'Until then you can still chat with Lopu on one of your own providers from Secure Vault — pick it in the model chip.';
export const LOPU_TEMPORARY_TITLE = 'Create an account to chat with Lopu';
export const LOPU_TEMPORARY_LINE = 'Conversations are saved to your account, so Lopu needs a real one first.';
export const LOPU_ADMIN_ACCOUNTS_PATH = '/settings#lopu-accounts';
export const LOPU_MANAGE_PROVIDERS_PATH = '/settings#secure-vault';

export type LopuLockedStateProps = {
	reason: LopuLockReason;
	// the viewer is an admin: offer the accounts panel (admins are never locked
	// themselves — this is the copy an admin sees when previewing the state)
	admin?: boolean;
	// the admin lets unverified accounts chat on their own providers
	byoAllowed?: boolean;
	compact?: boolean;
};

// A pill action shared by the locked state, the gate bubble and the balance
// chip's popover: a site link, an external link (new tab, no referrer) or a
// plain button. Ink when primary, hairline otherwise; 32px tall (the
// composer's control height), 44px on touch.
export const LopuActionLink = ({
	to,
	onClick,
	children,
	primary = false,
	external = false,
	compact = false
}: {
	to?: string;
	onClick?: () => void;
	children: React.ReactNode;
	primary?: boolean;
	external?: boolean;
	compact?: boolean;
}) => {
	const shared = {
		display: 'inline-flex',
		alignItems: 'center',
		height: `${compact ? 30 : LOPU_UI.control}px`,
		px: 4,
		borderRadius: LOPU_UI.pill,
		bg: primary ? LOPU_UI.ink : LOPU_UI.card,
		color: primary ? LOPU_UI.card : LOPU_UI.ink,
		border: primary ? '1px solid transparent' : LOPU_UI.border,
		fontSize: LOPU_UI.fontSmall,
		fontWeight: 600,
		whiteSpace: 'nowrap' as const,
		cursor: 'pointer',
		_hover: primary ? { opacity: 0.9 } : { bg: LOPU_UI.surfaceHover },
		sx: { WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation', ...lopuFocusRingSx }
	};
	if (!to) {
		return (
			<Box as="button" type="button" onClick={onClick} {...shared}>
				{children}
			</Box>
		);
	}
	if (external) {
		return (
			<Box as="a" href={to} target="_blank" rel="noopener noreferrer" onClick={onClick} {...shared}>
				{children}
			</Box>
		);
	}
	return (
		<Box as={RouterLink} to={to} onClick={onClick} {...shared}>
			{children}
		</Box>
	);
};

const ActionLink = LopuActionLink;

export const LopuLockedState = ({ reason, admin = false, byoAllowed = false, compact = false }: LopuLockedStateProps) => {
	const temporary = reason === 'temporary';
	const title = temporary ? LOPU_TEMPORARY_TITLE : LOPU_LOCKED_TITLE;
	const line = temporary ? LOPU_TEMPORARY_LINE : LOPU_LOCKED_LINE;
	return (
		<Flex
			className="lopuLockedState"
			data-reason={reason}
			role="status"
			aria-live="polite"
			direction="column"
			align="center"
			justify="center"
			textAlign="center"
			flex={1}
			minH={compact ? '200px' : '320px'}
			px={4}
			py={6}
			gap={compact ? 3 : 4}
		>
			<LopuRingAvatar size={compact ? 48 : 56} ring={2} />
			<Box maxW="380px">
				<Text fontSize={compact ? '15px' : '17px'} fontWeight={700} color={LOPU_UI.ink} lineHeight="1.3">
					{title}
				</Text>
				<Text fontSize={compact ? LOPU_UI.fontCompact : LOPU_UI.fontBody} color={LOPU_UI.muted} lineHeight="1.5" mt={1.5}>
					{line}
				</Text>
				{!temporary && byoAllowed ? (
					<Text fontSize={compact ? LOPU_UI.fontCompact : LOPU_UI.fontBody} color={LOPU_UI.muted} lineHeight="1.5" mt={1.5}>
						{LOPU_LOCKED_BYO_LINE}
					</Text>
				) : null}
			</Box>
			<Flex gap={2} wrap="wrap" justify="center">
				{temporary ? (
					<>
						<ActionLink to="/register" primary>
							Create an account
						</ActionLink>
						<ActionLink to="/login">Sign in</ActionLink>
					</>
				) : null}
				{!temporary && admin ? (
					<ActionLink to={LOPU_ADMIN_ACCOUNTS_PATH} primary>
						Admin → Lopu accounts
					</ActionLink>
				) : null}
				{!temporary && byoAllowed ? <ActionLink to={LOPU_MANAGE_PROVIDERS_PATH}>Your providers</ActionLink> : null}
				{!temporary ? <ActionLink to="/settings#lopu-credits">Credits &amp; usage</ActionLink> : null}
			</Flex>
		</Flex>
	);
};
