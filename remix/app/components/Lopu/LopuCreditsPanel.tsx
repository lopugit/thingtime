import React from 'react';
import { Box, Button, Flex, Input, Text, Textarea } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router';

import { LopuActionLink } from './LopuLockedState';
import { LOPU_UI, lopuEyebrowSx, lopuFocusRingSx } from './lopuTheme';
import { formatTurnCredits } from './lopuTurnCore';
import { useLopu } from './useLopu';
import { formatCredits, useLopuAccount, type LopuHistoryItem, type LopuLedgerEntry, type LopuUsageRow } from './useLopuAccount';

// Settings → Lopu 🦄 → "Credits & usage" (verified-credits design note §4):
// the balance, this month, lifetime tokens / cost, the verified status line,
// the ledger + usage history (cursor "Load more"), the "Request credits"
// form and — when the deployment set THINGTIME_LOPU_TOPUP_URL — "Buy
// credits". `LopuCreditsSummary` is the compact mirror the user settings
// modal shows (balance + status + a link here). Optimistic: the account
// paints from `tt-lopu-account-<uid>` and refetches in the background.

export const LOPU_CREDITS_ANCHOR_ID = 'lopu-credits';
export const LOPU_CREDITS_PATH = `/settings#${LOPU_CREDITS_ANCHOR_ID}`;
export const LOPU_TOPUP_MIN_CREDITS = 0.5;
export const LOPU_TOPUP_MAX_CREDITS = 1000;
const HISTORY_PAGE = 25;

const LEDGER_LABELS: Record<LopuLedgerEntry['entry'], string> = {
	starter: 'Starter credits',
	grant: 'Credits granted',
	topup: 'Top-up',
	debit: 'Turn',
	adjust: 'Adjustment',
	refund: 'Refund',
	request: 'Request'
};

const REQUEST_STATUS_LABELS: Record<NonNullable<LopuLedgerEntry['requestStatus']>, string> = { pending: 'waiting for an admin', approved: 'approved', declined: 'declined' };

const SURFACE_LABELS: Record<NonNullable<LopuUsageRow['surface']>, string> = { chat: 'Chat turn', voice: 'Voice turn', 'voice-session': 'Voice session' };

const inputSx = {
	bg: LOPU_UI.surfaceAlt,
	border: LOPU_UI.border,
	borderRadius: LOPU_UI.radiusSm,
	color: LOPU_UI.ink,
	fontSize: LOPU_UI.fontSmall,
	_hover: { borderColor: LOPU_UI.faint },
	_focusVisible: { borderColor: LOPU_UI.ink, boxShadow: 'none' },
	_placeholder: { color: LOPU_UI.faint }
} as const;

const formatWhen = (iso: string | null): string => {
	const at = iso ? Date.parse(iso) : NaN;
	if (!Number.isFinite(at)) return '';
	return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const formatTokens = (value: number): string => value.toLocaleString();

/** "Verified ✓ — Lopu builds with you" / the invite-only line / verification off. */
export const describeLopuVerification = (access: { verified: boolean; requireVerification: boolean; known: boolean }, admin: boolean): string => {
	if (admin) return 'Admin — Lopu is always available to you.';
	if (!access.known) return 'Checking your access…';
	if (access.verified) return 'Verified ✓ — Lopu builds with you.';
	if (!access.requireVerification) return 'Not verified, but this deployment does not require it — Lopu builds with you.';
	return 'Not verified yet — Lopu is invite-only for now; an admin needs to verify your account.';
};

const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
	<Box flex="1 1 140px" minW={0} px={3} py={2.5} borderRadius={LOPU_UI.radiusMd} border={LOPU_UI.border} bg={LOPU_UI.surfaceAlt}>
		<Text as="span" display="block" sx={lopuEyebrowSx}>
			{label}
		</Text>
		<Text fontSize="20px" fontWeight={700} color={LOPU_UI.ink} lineHeight="1.2" mt={1} wordBreak="break-word">
			{value}
		</Text>
		{hint ? (
			<Text fontSize="11px" color={LOPU_UI.muted} lineHeight="1.4" mt={0.5}>
				{hint}
			</Text>
		) : null}
	</Box>
);

const HistoryRow = ({ item }: { item: LopuHistoryItem }) => {
	if (item.kind === 'usage') {
		const row = item.row;
		const label = row.surface ? SURFACE_LABELS[row.surface] : 'Turn';
		const detail = [
			row.model || row.provider || null,
			`${formatTokens(row.inputTokens)} in / ${formatTokens(row.outputTokens)} out`,
			row.cacheReadTokens ? `${formatTokens(row.cacheReadTokens)} cached` : null,
			row.billing === 'byo' ? 'your provider' : row.billing === 'free' ? 'free' : null
		]
			.filter(Boolean)
			.join(' · ');
		return (
			<Flex className="lopuHistoryRow" data-kind="usage" align="baseline" gap={3} py={1.5} borderBottom={LOPU_UI.border} minW={0}>
				<Box minW={0} flex={1}>
					<Text fontSize={LOPU_UI.fontSmall} fontWeight={600} color={LOPU_UI.ink} isTruncated>
						{label}
						<Text as="span" fontWeight={400} color={LOPU_UI.muted}>
							{' '}
							· {detail}
						</Text>
					</Text>
					<Text fontSize="11px" color={LOPU_UI.faint}>
						{formatWhen(row.createdAt)}
						{row.estimated ? ' · estimated price' : ''}
						{!row.priced ? ' · not priced' : ''}
					</Text>
				</Box>
				<Text fontSize={LOPU_UI.fontSmall} color={row.billing === 'thingtime' ? LOPU_UI.ink : LOPU_UI.muted} fontFamily={LOPU_UI.fontMono} flexShrink={0}>
					{row.billing === 'thingtime' ? `−${formatTurnCredits(row.debitedMicros || row.costMicros)}` : formatTurnCredits(row.costMicros)}
				</Text>
			</Flex>
		);
	}
	const row = item.row;
	const label = row.entry === 'request' && row.requestStatus ? `${LEDGER_LABELS.request} · ${REQUEST_STATUS_LABELS[row.requestStatus]}` : LEDGER_LABELS[row.entry];
	const signed = row.entry === 'request' ? `${formatTurnCredits(row.amountMicros)} asked` : `${row.amountMicros < 0 ? '−' : '+'}${formatTurnCredits(Math.abs(row.amountMicros))}`;
	const detail = [row.reason, row.note].filter(Boolean).join(' · ');
	return (
		<Flex className="lopuHistoryRow" data-kind="ledger" data-entry={row.entry} align="baseline" gap={3} py={1.5} borderBottom={LOPU_UI.border} minW={0}>
			<Box minW={0} flex={1}>
				<Text fontSize={LOPU_UI.fontSmall} fontWeight={600} color={LOPU_UI.ink} isTruncated>
					{label}
					{detail ? (
						<Text as="span" fontWeight={400} color={LOPU_UI.muted}>
							{' '}
							· {detail}
						</Text>
					) : null}
				</Text>
				<Text fontSize="11px" color={LOPU_UI.faint}>
					{formatWhen(row.createdAt)}
					{row.balanceAfterMicros !== null ? ` · balance ${formatCredits(row.balanceAfterMicros)}` : ''}
				</Text>
			</Box>
			{/* only credits that actually landed read green; a request (pending or not) and a debit stay quiet */}
			<Text fontSize={LOPU_UI.fontSmall} color={row.entry === 'request' || row.amountMicros < 0 ? LOPU_UI.muted : LOPU_UI.positive} fontFamily={LOPU_UI.fontMono} flexShrink={0}>
				{signed}
			</Text>
		</Flex>
	);
};

export const LopuCreditsPanel = ({ admin = false }: { admin?: boolean }) => {
	const lopu = useLopu();
	const { account, access, loaded, error, refresh, requestTopup, loadHistory } = useLopuAccount();
	const [history, setHistory] = React.useState<LopuHistoryItem[]>([]);
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [historyLoaded, setHistoryLoaded] = React.useState(false);
	const [historyBusy, setHistoryBusy] = React.useState(false);
	const [credits, setCredits] = React.useState('5');
	const [note, setNote] = React.useState('');
	const [sending, setSending] = React.useState(false);
	const loadRef = React.useRef(loadHistory);
	loadRef.current = loadHistory;

	const loadPage = React.useCallback(async (cursor: string | null) => {
		setHistoryBusy(true);
		const result = await loadRef.current({ cursor, limit: HISTORY_PAGE });
		setHistoryBusy(false);
		if (!result.ok) return;
		setHistory((current) => {
			const seen = new Set(cursor ? current.map((item) => `${item.kind}:${item.row.id}`) : []);
			const fresh = result.page.items.filter((item) => !seen.has(`${item.kind}:${item.row.id}`));
			return cursor ? [...current, ...fresh] : result.page.items;
		});
		setNextCursor(result.page.nextCursor);
		setHistoryLoaded(true);
	}, []);

	// the first page on mount; the balance / month / lifetime numbers ride
	// the shared account store (already seeded from cache)
	React.useEffect(() => {
		void loadPage(null);
	}, [loadPage]);

	const pending = account?.pendingRequest ?? null;
	const creditsNumber = Number(credits);
	const creditsValid = Number.isFinite(creditsNumber) && creditsNumber >= LOPU_TOPUP_MIN_CREDITS && creditsNumber <= LOPU_TOPUP_MAX_CREDITS;

	const submitRequest = async () => {
		if (!creditsValid || sending || pending) return;
		setSending(true);
		const result = await requestTopup({ credits: creditsNumber, note });
		setSending(false);
		if (result.ok === false) {
			const waiting = result.status === 409;
			lopu({ title: waiting ? 'A request is already waiting' : 'Could not send the request', description: result.error, status: waiting ? 'info' : 'error', duration: 6000 });
			return;
		}
		setNote('');
		lopu({ title: `Asked for ${formatTurnCredits(Math.round(creditsNumber * 1_000_000))} credits ✨`, description: 'An admin will look at it soon.', status: 'success', duration: 6000 });
		void loadPage(null);
	};

	const balanceMicros = account?.balanceMicros ?? 0;
	const balanceTone = balanceMicros <= 0 ? LOPU_UI.danger : account?.lowBalance ? LOPU_UI.warning : LOPU_UI.ink;

	return (
		<Flex className="lopuCreditsPanel" direction="column" gap={3} width="100%" minW={0}>
			<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted} lineHeight="1.5" data-lopu-verified={access.verified ? 'true' : 'false'}>
				{describeLopuVerification(access, admin)}
			</Text>

			<Flex gap={2} wrap="wrap">
				<Stat
					label="Balance"
					value={
						<Text as="span" color={balanceTone}>
							{formatCredits(balanceMicros)}
							<Text as="span" fontSize={LOPU_UI.fontSmall} fontWeight={500} color={LOPU_UI.muted}>
								{formatCredits(balanceMicros).endsWith('¢') ? '' : ' credits'}
							</Text>
						</Text>
					}
					hint={account?.starterCredits ? `New accounts start with ${account.starterCredits} ${account.starterCredits === 1 ? 'credit' : 'credits'}` : '1 credit = 1 USD of list price'}
				/>
				<Stat label={account?.month.key ? `This month · ${account.month.key}` : 'This month'} value={formatCredits(account?.month.costMicros ?? 0)} hint={`${account?.month.turns ?? 0} ${account?.month.turns === 1 ? 'turn' : 'turns'}`} />
				<Stat
					label="Lifetime"
					value={formatCredits(account?.lifetime.costMicros ?? 0)}
					hint={`${account?.lifetime.turns ?? 0} ${account?.lifetime.turns === 1 ? 'turn' : 'turns'} · ${formatTokens(account?.lifetime.inputTokens ?? 0)} in / ${formatTokens(account?.lifetime.outputTokens ?? 0)} out`}
				/>
			</Flex>

			{!account && loaded && error ? (
				<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.danger}>
					{error}
				</Text>
			) : null}

			<Box borderTop={LOPU_UI.border} pt={3}>
				<Text as="span" display="block" sx={lopuEyebrowSx} mb={1.5}>
					{pending ? 'Your request' : 'Request credits'}
				</Text>
				{pending ? (
					<Flex align="center" gap={3} wrap="wrap">
						<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.ink} lineHeight="1.5" flex="1 1 240px" minW={0}>
							{formatTurnCredits(pending.amountMicros)} credits asked{pending.createdAt ? ` on ${formatWhen(pending.createdAt)}` : ''} — waiting for an admin.
							{pending.note ? ` “${pending.note}”` : ''}
						</Text>
						<Button size="xs" variant="outline" borderColor={LOPU_UI.borderColor} color={LOPU_UI.ink} borderRadius={LOPU_UI.radiusSm} onClick={() => void refresh()}>
							Check again
						</Button>
					</Flex>
				) : (
					<Flex direction="column" gap={2}>
						<Flex gap={2} wrap="wrap" align="center">
							<Input
								size="sm"
								type="number"
								inputMode="decimal"
								min={LOPU_TOPUP_MIN_CREDITS}
								max={LOPU_TOPUP_MAX_CREDITS}
								step="0.5"
								width="120px"
								value={credits}
								aria-label="Credits to request"
								isInvalid={credits !== '' && !creditsValid}
								onChange={(event) => setCredits(event.target.value)}
								sx={inputSx}
							/>
							<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted}>
								credits ({LOPU_TOPUP_MIN_CREDITS}–{LOPU_TOPUP_MAX_CREDITS})
							</Text>
						</Flex>
						<Textarea size="sm" rows={2} maxLength={500} value={note} placeholder="A note for the admin (optional)" aria-label="Note for the admin" onChange={(event) => setNote(event.target.value)} sx={inputSx} resize="vertical" />
						<Flex gap={2} wrap="wrap" align="center">
							<Button
								size="sm"
								height="36px"
								bg={LOPU_UI.ink}
								color={LOPU_UI.card}
								borderRadius={LOPU_UI.radiusMd}
								_hover={{ opacity: 0.9 }}
								_disabled={{ opacity: 0.45, cursor: 'not-allowed' }}
								isLoading={sending}
								isDisabled={!creditsValid}
								onClick={submitRequest}
								sx={lopuFocusRingSx}
							>
								Request credits
							</Button>
							{account?.topupUrl ? (
								<LopuActionLink to={account.topupUrl} external>
									Buy credits ↗
								</LopuActionLink>
							) : null}
						</Flex>
					</Flex>
				)}
			</Box>

			<Box borderTop={LOPU_UI.border} pt={3}>
				<Flex align="center" gap={2} mb={1}>
					<Text as="span" sx={lopuEyebrowSx}>
						History
					</Text>
					<Box flex={1} />
					<Button size="xs" variant="ghost" color={LOPU_UI.muted} isLoading={historyBusy && historyLoaded} onClick={() => void Promise.all([refresh(), loadPage(null)])}>
						Refresh
					</Button>
				</Flex>
				{history.length === 0 ? (
					<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted} py={2}>
						{historyLoaded ? 'Nothing yet — every turn Thingtime bills and every credit change lands here.' : historyBusy ? 'Loading…' : ''}
					</Text>
				) : (
					<Box role="table" aria-label="Credits and usage history">
						{history.map((item) => (
							<HistoryRow key={`${item.kind}:${item.row.id}`} item={item} />
						))}
					</Box>
				)}
				{nextCursor ? (
					<Flex pt={2}>
						<Button size="xs" variant="outline" borderColor={LOPU_UI.borderColor} color={LOPU_UI.ink} borderRadius={LOPU_UI.radiusSm} isLoading={historyBusy} onClick={() => void loadPage(nextCursor)}>
							Load more
						</Button>
					</Flex>
				) : null}
			</Box>
		</Flex>
	);
};

// The compact mirror (UserSettingsModal): balance + status + the link here.
export const LopuCreditsSummary = ({ admin = false, onNavigate }: { admin?: boolean; onNavigate?: () => void }) => {
	const { account, access } = useLopuAccount();
	const balanceMicros = account?.balanceMicros ?? 0;
	const tone = balanceMicros <= 0 ? LOPU_UI.danger : account?.lowBalance ? LOPU_UI.warning : LOPU_UI.ink;
	return (
		<Flex className="lopuCreditsSummary" align="center" gap={3} py={2} minW={0}>
			<Box minW={0} flex={1}>
				<Text fontSize="sm" color={LOPU_UI.ink}>
					Credits &amp; usage
				</Text>
				<Text fontSize="xs" color={LOPU_UI.muted} noOfLines={2}>
					{describeLopuVerification(access, admin)}
					{account?.pendingRequest ? ` A request for ${formatTurnCredits(account.pendingRequest.amountMicros)} credits is waiting.` : ''}
				</Text>
			</Box>
			<Text fontSize="sm" fontWeight={700} color={tone} fontFamily={LOPU_UI.fontMono} flexShrink={0}>
				{formatCredits(balanceMicros)}
			</Text>
			<Box as={RouterLink} to={LOPU_CREDITS_PATH} onClick={onNavigate} fontSize="xs" fontWeight={600} color={LOPU_UI.ink} textDecoration="underline" textUnderlineOffset="2px" flexShrink={0} sx={lopuFocusRingSx}>
				Open
			</Box>
		</Flex>
	);
};
