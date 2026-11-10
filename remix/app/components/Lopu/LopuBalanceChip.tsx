import React from 'react';
import { Box, Flex, Popover, PopoverBody, PopoverContent, PopoverTrigger, Text } from '@chakra-ui/react';

import { LopuActionLink } from './LopuLockedState';
import { LOPU_UI, lopuChipSx, lopuEyebrowSx, lopuPopoverSx } from './lopuTheme';
import { formatCredits, type LopuAccount } from './useLopuAccount';

// The composer's balance chip (verified-credits design note §4): "4.97
// credits" beside the model chip, amber once the balance is under the
// admin's low-balance threshold, red at zero or below with the top-up
// action; a BYO turn (the chat thinks with the viewer's own provider) reads
// "your provider" instead — Thingtime credits are not used for it. Tapping
// the chip opens a small popover with the balance, this month's usage, and
// the way to get more: "Request credits" (Settings → Lopu) and "Buy credits"
// when the deployment set THINGTIME_LOPU_TOPUP_URL.

export const LOPU_CREDITS_SETTINGS_PATH = '/settings#lopu-credits';
export const LOPU_BYO_CHIP_LABEL = 'your provider';

export type LopuBalanceTone = 'muted' | 'warning' | 'danger';

/** Which tint the chip wears: red at ≤ 0, amber under the threshold, quiet otherwise. */
export const lopuBalanceTone = (account: Pick<LopuAccount, 'balanceMicros' | 'lowBalance'> | null | undefined): LopuBalanceTone => {
	if (!account) return 'muted';
	if (account.balanceMicros <= 0) return 'danger';
	if (account.lowBalance) return 'warning';
	return 'muted';
};

/** The chip's text: "4.97 credits" / "42¢" / "0.00 credits". */
export const lopuBalanceChipLabel = (account: Pick<LopuAccount, 'balanceMicros'> | null | undefined): string => {
	const text = formatCredits(account?.balanceMicros ?? 0);
	return text.endsWith('¢') ? text : `${text} credits`;
};

const TONE_COLORS: Record<LopuBalanceTone, string> = { muted: LOPU_UI.muted, warning: LOPU_UI.warning, danger: LOPU_UI.danger };

const PopoverLink = LopuActionLink;

export type LopuBalanceChipProps = {
	account: LopuAccount | null;
	// the current choice is one of the viewer's own providers
	byo: boolean;
	compact?: boolean;
	mobile?: boolean;
	disabled?: boolean;
};

export const LopuBalanceChip = ({ account, byo, compact = false, mobile = false, disabled = false }: LopuBalanceChipProps) => {
	const height = `${compact ? 26 : LOPU_UI.controlCompact}px`;
	const hitArea = mobile ? { _before: { content: '""', position: 'absolute', left: 0, right: 0, top: '-8px', bottom: '-8px' } } : {};

	if (byo) {
		return (
			<Box
				as="span"
				className="lopuBalanceChip"
				data-lopu-control
				data-billing="byo"
				title="This chat thinks with your own provider — Thingtime credits are not used"
				sx={{ ...lopuChipSx, height, cursor: 'default', fontWeight: 500, color: LOPU_UI.muted, _hover: {} }}
			>
				{LOPU_BYO_CHIP_LABEL}
			</Box>
		);
	}

	if (!account) return null;

	const tone = lopuBalanceTone(account);
	const label = lopuBalanceChipLabel(account);
	const title = tone === 'danger' ? "Lopu's credits for your account are used up — add credits to keep going" : tone === 'warning' ? 'Your Lopu credits are running low' : 'Your Lopu credits';

	return (
		<Popover placement="top-start" isLazy strategy="fixed" gutter={8}>
			<PopoverTrigger>
				<Box
					as="button"
					type="button"
					className="lopuBalanceChip"
					data-lopu-control
					data-billing="thingtime"
					data-tone={tone}
					aria-label={`Credits: ${label}`}
					aria-haspopup="dialog"
					title={title}
					disabled={disabled}
					sx={{
						...lopuChipSx,
						height,
						position: 'relative',
						color: TONE_COLORS[tone],
						...(tone === 'muted' ? {} : { borderColor: TONE_COLORS[tone] }),
						...hitArea
					}}
				>
					<Text as="span" isTruncated minW={0}>
						{label}
					</Text>
				</Box>
			</PopoverTrigger>
			<PopoverContent
				width="300px"
				maxW="calc(100vw - 24px)"
				sx={lopuPopoverSx}
				_focus={{ outline: 'none', boxShadow: LOPU_UI.shadowPopover }}
				_focusVisible={{ outline: 'none', boxShadow: LOPU_UI.shadowPopover }}
				aria-label="Your Lopu credits"
			>
				<PopoverBody px={3} py={2.5}>
					<Text as="span" display="block" sx={lopuEyebrowSx} pb={1}>
						Credits
					</Text>
					<Flex align="baseline" gap={2}>
						<Text fontSize="22px" fontWeight={700} color={TONE_COLORS[tone] === LOPU_UI.muted ? LOPU_UI.ink : TONE_COLORS[tone]} lineHeight="1.1">
							{formatCredits(account.balanceMicros)}
						</Text>
						<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted}>
							{formatCredits(account.balanceMicros).endsWith('¢') ? 'left' : 'credits left'}
						</Text>
					</Flex>
					<Text fontSize="11px" color={LOPU_UI.muted} mt={1} lineHeight="1.4">
						This month: {formatCredits(account.month.costMicros)} credits over {account.month.turns} {account.month.turns === 1 ? 'turn' : 'turns'}. 1 credit = 1 USD of list
						price.
					</Text>
					{tone === 'danger' ? (
						<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.danger} mt={2} lineHeight="1.4">
							Lopu&apos;s credits for your account are used up — add credits to keep going.
						</Text>
					) : null}
					{account.pendingRequest ? (
						<Text fontSize="11px" color={LOPU_UI.muted} mt={2} lineHeight="1.4">
							A request for {formatCredits(account.pendingRequest.amountMicros)} credits is waiting for an admin.
						</Text>
					) : null}
					<Flex gap={2} wrap="wrap" mt={3}>
						<PopoverLink to={LOPU_CREDITS_SETTINGS_PATH} primary={!account.topupUrl}>
							{account.pendingRequest ? 'Credits & usage' : 'Request credits'}
						</PopoverLink>
						{account.topupUrl ? (
							<PopoverLink to={account.topupUrl} external primary>
								Buy credits ↗
							</PopoverLink>
						) : null}
					</Flex>
				</PopoverBody>
			</PopoverContent>
		</Popover>
	);
};
