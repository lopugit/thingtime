import React from 'react';
import { Box, Button, Flex, Input, Select, Text } from '@chakra-ui/react';

import { LopuToggle } from '~/components/Lopu/LopuModelPicker';
import { LOPU_UI, lopuEyebrowSx } from '~/components/Lopu/lopuTheme';
import { formatTurnCredits } from '~/components/Lopu/lopuTurnCore';
import { useLopu } from '~/components/Lopu/useLopu';
import {
	formatCredits,
	LOPU_ACCESS_DEFAULTS,
	lopuAdminRowFromDirectory,
	normalizeLopuAccessSettings,
	normalizeLopuAdminAccountRow,
	refreshLopuAccount,
	type LopuAccessSettings,
	type LopuAdminAccountRow
} from '~/components/Lopu/useLopuAccount';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

// Admin → Lopu accounts (verified-credits design note §4): who may use Lopu
// and what they have spent. The Thingtime.LopuAccess editor (require
// verification, allow BYO when unverified, starter credits, the low-balance
// threshold), then the accounts table — search, the verified toggle
// (POST admin/users/lopu-access), balance, this month, the pending top-up
// request with Approve / Decline, and an inline "Add credits" form (POST
// admin/lopu/credits). Every action is re-checked server-side; this is only
// the surface. Optimistic per the house rule: the settings and the first
// page paint from per-device caches, toggles flip instantly and revert on
// failure.

export const LOPU_ACCOUNTS_ANCHOR_ID = 'lopu-accounts';
const ACCESS_CACHE_KEY = 'tt-lopu-admin-access';
const ACCOUNTS_CACHE_KEY = 'tt-lopu-admin-accounts';
const PAGE_LIMIT = 50;

type CreditEntry = 'grant' | 'topup' | 'adjust' | 'refund';
const CREDIT_ENTRIES: Array<{ value: CreditEntry; label: string }> = [
	{ value: 'grant', label: 'Grant' },
	{ value: 'topup', label: 'Top-up' },
	{ value: 'adjust', label: 'Adjustment' },
	{ value: 'refund', label: 'Refund' }
];

const eyebrow = lopuEyebrowSx;

const inputSx = {
	bg: LOPU_UI.card,
	border: LOPU_UI.border,
	borderRadius: LOPU_UI.radiusSm,
	color: LOPU_UI.ink,
	fontSize: LOPU_UI.fontSmall,
	_hover: { borderColor: LOPU_UI.faint },
	_focusVisible: { borderColor: LOPU_UI.ink, boxShadow: 'none' },
	_placeholder: { color: LOPU_UI.faint }
} as const;

const Chip = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'ink' | 'danger' | 'positive' | 'warning' }) => (
	<Box
		as="span"
		display="inline-flex"
		alignItems="center"
		height="18px"
		px="7px"
		borderRadius={LOPU_UI.pill}
		border={LOPU_UI.border}
		bg={LOPU_UI.card}
		fontSize="10px"
		fontWeight={600}
		letterSpacing="0.02em"
		lineHeight={1}
		whiteSpace="nowrap"
		color={tone === 'danger' ? LOPU_UI.danger : tone === 'positive' ? LOPU_UI.positive : tone === 'warning' ? LOPU_UI.warning : tone === 'ink' ? LOPU_UI.ink : LOPU_UI.muted}
	>
		{children}
	</Box>
);

const SmallButton = (props: { onClick: () => void; children: React.ReactNode; busy?: boolean; disabled?: boolean; primary?: boolean; danger?: boolean; title?: string }) => (
	<Button
		size="xs"
		variant={props.primary ? 'solid' : 'outline'}
		bg={props.primary ? LOPU_UI.ink : LOPU_UI.card}
		color={props.primary ? LOPU_UI.card : props.danger ? LOPU_UI.danger : LOPU_UI.ink}
		borderColor={LOPU_UI.borderColor}
		borderRadius={LOPU_UI.radiusSm}
		_hover={props.primary ? { opacity: 0.9 } : { bg: LOPU_UI.surfaceHover }}
		_disabled={{ opacity: 0.45, cursor: 'not-allowed' }}
		isLoading={props.busy}
		isDisabled={props.disabled}
		title={props.title}
		onClick={props.onClick}
	>
		{props.children}
	</Button>
);

const errorMessage = (error: unknown, fallback: string): string => {
	const message = (error as { error?: unknown; message?: unknown } | null)?.error ?? (error as { message?: unknown } | null)?.message;
	return typeof message === 'string' && message ? message : fallback;
};

const sameAccess = (a: LopuAccessSettings, b: LopuAccessSettings): boolean =>
	a.requireVerification === b.requireVerification && a.allowByoUnverified === b.allowByoUnverified && a.starterCredits === b.starterCredits && a.lowBalanceWarningCredits === b.lowBalanceWarningCredits;

const readAccessCache = (): LopuAccessSettings => normalizeLopuAccessSettings(readLocalCache<unknown>(ACCESS_CACHE_KEY) ?? LOPU_ACCESS_DEFAULTS);

const readAccountsCache = (): LopuAdminAccountRow[] => {
	const cached = readLocalCache<{ rows?: unknown }>(ACCOUNTS_CACHE_KEY);
	return Array.isArray(cached?.rows) ? cached!.rows.map(normalizeLopuAdminAccountRow).filter((row): row is LopuAdminAccountRow => !!row) : [];
};

const normalizeRows = (payload: unknown): { rows: LopuAdminAccountRow[]; nextCursor: string | null } => {
	const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
	const list = Array.isArray(source.rows) ? source.rows : Array.isArray(source.accounts) ? source.accounts : [];
	return {
		rows: list.map(normalizeLopuAdminAccountRow).filter((row): row is LopuAdminAccountRow => !!row),
		nextCursor: typeof source.nextCursor === 'string' && source.nextCursor ? source.nextCursor : null
	};
};

// ——— the Thingtime.LopuAccess editor ————————————————————————————————————————

const AccessSettingsEditor = () => {
	const api = useApi();
	const lopu = useLopu();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const [stored, setStored] = React.useState<LopuAccessSettings>(readAccessCache);
	const [draft, setDraft] = React.useState<LopuAccessSettings | null>(null);
	const [saving, setSaving] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;
		apiRef.current.v1.settings
			.lopuAccess()
			.then((resp: any) => {
				if (cancelled || resp?.ok === false) return;
				const next = normalizeLopuAccessSettings(resp);
				setStored(next);
				writeLocalCache(ACCESS_CACHE_KEY, next);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	const current = draft ?? stored;
	const dirty = !!draft && !sameAccess(draft, stored);
	const patch = (next: Partial<LopuAccessSettings>) => setDraft({ ...current, ...next });

	const save = async () => {
		if (!draft || saving) return;
		setSaving(true);
		try {
			const resp = await apiRef.current.v1.admin.setLopuAccess(draft);
			if (resp?.ok === false) {
				lopu({ title: 'Could not save the access settings', description: resp?.error, status: 'error' });
				return;
			}
			const saved = normalizeLopuAccessSettings(resp?.settings || resp?.lopuAccess ? resp : draft);
			setStored(saved);
			setDraft(null);
			writeLocalCache(ACCESS_CACHE_KEY, saved);
			lopu({ title: 'Lopu access settings saved ✨', status: 'success', duration: 5000 });
			// the viewer's own account projection carries these rules
			void refreshLopuAccount();
		} catch (error: unknown) {
			lopu({ title: 'Could not save the access settings', description: errorMessage(error, 'Please try again in a moment.'), status: 'error' });
		} finally {
			setSaving(false);
		}
	};

	const numberField = (label: string, key: 'starterCredits' | 'lowBalanceWarningCredits', hint: string) => (
		<Flex align="center" gap={3} py={1.5} wrap="wrap">
			<Box minW={0} flex="1 1 220px">
				<Text fontSize="sm" fontWeight={600} color={LOPU_UI.ink} lineHeight="1.3">
					{label}
				</Text>
				<Text fontSize="11px" color={LOPU_UI.muted} lineHeight="1.4">
					{hint}
				</Text>
			</Box>
			<Input
				size="xs"
				type="number"
				inputMode="decimal"
				min={0}
				step={key === 'starterCredits' ? '0.5' : '0.1'}
				width="96px"
				value={current[key]}
				aria-label={label}
				onChange={(event) => {
					const value = Number(event.target.value);
					patch({ [key]: Number.isFinite(value) && value >= 0 ? value : 0 } as Partial<LopuAccessSettings>);
				}}
				sx={inputSx}
			/>
		</Flex>
	);

	return (
		<Flex direction="column" gap={1} data-lopu-access-editor>
			<Text sx={eyebrow}>Access rules</Text>
			<Flex align="center" gap={3} py={1.5}>
				<Box minW={0} flex={1}>
					<Text fontSize="sm" fontWeight={600} color={LOPU_UI.ink} lineHeight="1.3">
						Require verification
					</Text>
					<Text fontSize="11px" color={LOPU_UI.muted} lineHeight="1.4">
						New accounts start unverified — Lopu is invite-only until you verify them below. Admins are always verified.
					</Text>
				</Box>
				<LopuToggle checked={current.requireVerification} onChange={(next) => patch({ requireVerification: next })} label="Require verification" />
			</Flex>
			<Flex align="center" gap={3} py={1.5}>
				<Box minW={0} flex={1}>
					<Text fontSize="sm" fontWeight={600} color={LOPU_UI.ink} lineHeight="1.3">
						Allow own providers when unverified
					</Text>
					<Text fontSize="11px" color={LOPU_UI.muted} lineHeight="1.4">
						An unverified account may still chat on a Secure Vault provider of its own (no Thingtime credits are used).
					</Text>
				</Box>
				<LopuToggle checked={current.allowByoUnverified} onChange={(next) => patch({ allowByoUnverified: next })} label="Allow own providers when unverified" />
			</Flex>
			{numberField('Starter credits', 'starterCredits', 'Granted once when an account first meets Lopu (1 credit = 1 USD of list price).')}
			{numberField('Low-balance warning', 'lowBalanceWarningCredits', 'The balance chip turns amber under this many credits.')}
			<Flex gap={2} align="center" pt={1}>
				<SmallButton primary busy={saving} disabled={!dirty} onClick={() => void save()}>
					Save access settings
				</SmallButton>
				{dirty ? (
					<Button size="xs" variant="ghost" color={LOPU_UI.muted} onClick={() => setDraft(null)}>
						Discard
					</Button>
				) : null}
			</Flex>
		</Flex>
	);
};

// ——— one account row ————————————————————————————————————————————————————————

const AccountRow = ({
	row,
	me,
	busy,
	onVerify,
	onCredits,
	onRequest
}: {
	row: LopuAdminAccountRow;
	me: string | null;
	busy: boolean;
	onVerify: (row: LopuAdminAccountRow, verified: boolean) => void;
	onCredits: (row: LopuAdminAccountRow, args: { credits: number; entry: CreditEntry; reason: string }) => Promise<boolean>;
	onRequest: (row: LopuAdminAccountRow, approve: boolean, reason: string) => Promise<boolean>;
}) => {
	const [open, setOpen] = React.useState(false);
	const [credits, setCredits] = React.useState('5');
	const [entry, setEntry] = React.useState<CreditEntry>('grant');
	const [reason, setReason] = React.useState('');
	const [declineReason, setDeclineReason] = React.useState('');
	const [declining, setDeclining] = React.useState(false);
	const amount = Number(credits);
	const amountValid = Number.isFinite(amount) && amount !== 0 && Math.abs(amount) <= 10000;
	const pending = row.pendingRequest;
	const verified = row.user.isAdmin || row.user.lopuVerified;

	const submitCredits = async () => {
		if (!amountValid || busy) return;
		const ok = await onCredits(row, { credits: amount, entry, reason: reason.trim() });
		if (ok) {
			setOpen(false);
			setReason('');
		}
	};

	return (
		<Box className="lopuAccountRow" data-user-id={row.user.id} px={3} py={2} borderRadius={LOPU_UI.radiusMd} border={LOPU_UI.border} bg={LOPU_UI.surfaceAlt}>
			<Flex align="center" gap={3} wrap="wrap">
				<Box minW={0} flex="1 1 200px">
					<Flex align="center" gap={2} wrap="wrap">
						<Text fontSize="sm" fontWeight={600} color={LOPU_UI.ink} noOfLines={1}>
							{row.user.displayName || row.user.username}
						</Text>
						<Text fontSize="xs" color={LOPU_UI.muted} noOfLines={1}>
							@{row.user.username}
						</Text>
						{row.user.isAdmin ? <Chip tone="ink">admin</Chip> : null}
						{verified ? <Chip tone="positive">verified</Chip> : <Chip>invite-only</Chip>}
						{pending ? <Chip tone="warning">request pending</Chip> : null}
						{row.noAccount ? <Chip>has not met Lopu yet</Chip> : null}
					</Flex>
					<Text fontSize="11px" color={LOPU_UI.muted} mt="2px">
						This month {formatCredits(row.month.costMicros)} over {row.month.turns} {row.month.turns === 1 ? 'turn' : 'turns'} · lifetime {formatCredits(row.lifetime.costMicros)} over{' '}
						{row.lifetime.turns} {row.lifetime.turns === 1 ? 'turn' : 'turns'}
					</Text>
				</Box>
				<Text fontSize="sm" fontWeight={700} fontFamily={LOPU_UI.fontMono} color={row.balanceMicros <= 0 ? LOPU_UI.danger : LOPU_UI.ink} flexShrink={0} title="Balance">
					{formatCredits(row.balanceMicros)}
				</Text>
				{/* the caption is a button too: a 44px hit target beside the 26px switch */}
				<Flex align="center" gap={2} flexShrink={0}>
					<Box
						as="button"
						type="button"
						disabled={busy || row.user.isAdmin}
						aria-label={verified ? `Unverify ${row.user.username} for Lopu` : `Verify ${row.user.username} for Lopu`}
						title={row.user.isAdmin ? 'Admins are always verified' : verified ? 'Make Lopu invite-only for this account again' : 'Let this account build with Lopu'}
						minH={`${LOPU_UI.touchTarget}px`}
						px={2}
						fontSize="xs"
						color={LOPU_UI.muted}
						borderRadius={LOPU_UI.radiusSm}
						cursor={busy || row.user.isAdmin ? 'not-allowed' : 'pointer'}
						_hover={busy || row.user.isAdmin ? undefined : { bg: LOPU_UI.surfaceHover, color: LOPU_UI.ink }}
						_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '1px' }}
						onClick={() => onVerify(row, !verified)}
					>
						{verified ? 'Verified' : 'Unverified'}
					</Box>
					<LopuToggle
						checked={verified}
						disabled={busy || row.user.isAdmin}
						label={`${row.user.username} verified for Lopu`}
						onChange={(next) => onVerify(row, next)}
					/>
				</Flex>
				<SmallButton onClick={() => setOpen((prev) => !prev)} disabled={busy} title="Grant, adjust or refund credits">
					{open ? 'Close' : 'Add credits'}
				</SmallButton>
			</Flex>

			{pending ? (
				<Flex align="center" gap={2} wrap="wrap" mt={2} pt={2} borderTop={LOPU_UI.border}>
					<Text fontSize="xs" color={LOPU_UI.ink} flex="1 1 200px" minW={0}>
						Asks for <strong>{formatTurnCredits(pending.amountMicros)} credits</strong>
						{pending.note ? ` — “${pending.note}”` : ''}
					</Text>
					{declining ? (
						<>
							<Input size="xs" width="180px" value={declineReason} placeholder="Reason (optional)" aria-label="Decline reason" onChange={(event) => setDeclineReason(event.target.value)} sx={inputSx} />
							<SmallButton danger busy={busy} onClick={() => void onRequest(row, false, declineReason.trim()).then((ok) => ok && setDeclining(false))}>
								Decline
							</SmallButton>
							<Button size="xs" variant="ghost" color={LOPU_UI.muted} onClick={() => setDeclining(false)}>
								Keep
							</Button>
						</>
					) : (
						<>
							<SmallButton primary busy={busy} onClick={() => void onRequest(row, true, '')}>
								Approve
							</SmallButton>
							<SmallButton danger disabled={busy} onClick={() => setDeclining(true)}>
								Decline
							</SmallButton>
						</>
					)}
				</Flex>
			) : null}

			{open ? (
				<Flex align="center" gap={2} wrap="wrap" mt={2} pt={2} borderTop={LOPU_UI.border}>
					<Input size="xs" type="number" inputMode="decimal" step="0.5" width="96px" value={credits} aria-label="Credits" isInvalid={credits !== '' && !amountValid} onChange={(event) => setCredits(event.target.value)} sx={inputSx} />
					<Select size="xs" width="130px" value={entry} aria-label="Ledger entry" onChange={(event) => setEntry(event.target.value as CreditEntry)} sx={inputSx}>
						{CREDIT_ENTRIES.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</Select>
					<Input size="xs" flex="1 1 160px" value={reason} placeholder="Reason" aria-label="Reason" onChange={(event) => setReason(event.target.value)} sx={inputSx} />
					<SmallButton primary busy={busy} disabled={!amountValid} onClick={() => void submitCredits()}>
						{amount < 0 ? 'Take credits' : 'Add credits'}
					</SmallButton>
					{row.user.id === me ? (
						<Text fontSize="11px" color={LOPU_UI.muted}>
							(your own account)
						</Text>
					) : null}
				</Flex>
			) : null}
		</Box>
	);
};

// ——— the panel ——————————————————————————————————————————————————————————————

export const LopuAccountsAdmin = () => {
	const api = useApi();
	const lopu = useLopu();
	const me = useCurrentUser();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const [rows, setRows] = React.useState<LopuAdminAccountRow[]>(readAccountsCache);
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [query, setQuery] = React.useState('');
	const [activeQuery, setActiveQuery] = React.useState('');
	const [loading, setLoading] = React.useState(false);
	const [loaded, setLoaded] = React.useState(false);
	const [failed, setFailed] = React.useState<string | null>(null);
	const [busyId, setBusyId] = React.useState<string | null>(null);

	const load = React.useCallback(async (q: string, cursor: string | null) => {
		setLoading(true);
		try {
			const resp = await apiRef.current.v1.admin.lopuAccounts({ ...(q ? { q } : {}), ...(cursor ? { cursor } : {}), limit: PAGE_LIMIT });
			if (resp?.ok === false) throw new Error(errorMessage(resp, 'Could not load the accounts'));
			let page = normalizeRows(resp);
			// the accounts list only knows people who have met Lopu (their
			// `lopu-account` row); a search that finds nobody there falls back
			// to the admin users directory so a brand-new account can be
			// verified — or given credits — before its first turn
			if (q && !cursor && page.rows.length === 0) {
				const directory = await apiRef.current.v1.admin.users({ q }).catch(() => null);
				const results = Array.isArray(directory?.results) ? directory.results : [];
				page = { rows: results.map(lopuAdminRowFromDirectory).filter((row): row is LopuAdminAccountRow => !!row), nextCursor: null };
			}
			setRows((current) => {
				if (!cursor) return page.rows;
				const seen = new Set(current.map((row) => row.user.id));
				return [...current, ...page.rows.filter((row) => !seen.has(row.user.id))];
			});
			setNextCursor(page.nextCursor);
			setFailed(null);
			if (!q && !cursor) writeLocalCache(ACCOUNTS_CACHE_KEY, { at: Date.now(), rows: page.rows.slice(0, PAGE_LIMIT) });
		} catch (error: unknown) {
			setFailed(errorMessage(error, 'Could not load the accounts'));
		} finally {
			setLoading(false);
			setLoaded(true);
		}
	}, []);

	React.useEffect(() => {
		void load('', null);
	}, [load]);

	const search = () => {
		const q = query.trim();
		setActiveQuery(q);
		void load(q, null);
	};

	const patchRow = (userId: string, patch: (row: LopuAdminAccountRow) => LopuAdminAccountRow) => setRows((current) => current.map((row) => (row.user.id === userId ? patch(row) : row)));

	const verify = async (row: LopuAdminAccountRow, verified: boolean) => {
		if (busyId) return;
		const previous = row.user.lopuVerified;
		// optimistic — the toggle flips now and reverts if the server refuses
		patchRow(row.user.id, (entry) => ({ ...entry, user: { ...entry.user, lopuVerified: verified } }));
		setBusyId(row.user.id);
		try {
			const resp = await apiRef.current.v1.admin.setUserLopuAccess({ userId: row.user.id, verified });
			if (resp?.ok === false) throw new Error(errorMessage(resp, 'Could not update the account'));
			const saved = resp?.user && typeof resp.user === 'object' && typeof resp.user.lopuVerified === 'boolean' ? resp.user.lopuVerified : verified;
			patchRow(row.user.id, (entry) => ({ ...entry, user: { ...entry.user, lopuVerified: saved } }));
			lopu({ title: saved ? `@${row.user.username} can use Lopu ✨` : `@${row.user.username} is invite-only again`, status: 'success', duration: 5000 });
			if (row.user.id === me?.id) void refreshLopuAccount();
		} catch (error: unknown) {
			patchRow(row.user.id, (entry) => ({ ...entry, user: { ...entry.user, lopuVerified: previous } }));
			lopu({ title: 'Could not update the account', description: errorMessage(error, 'Please try again in a moment.'), status: 'error' });
		} finally {
			setBusyId(null);
		}
	};

	// the credits endpoint echoes the whole admin row ({ ok, account, ledger,
	// request }): balance, month, lifetime and the pending request all come
	// from the server; a response without it moves the balance by the delta
	const applyCreditsResponse = (row: LopuAdminAccountRow, resp: any, fallbackDelta: number) => {
		const served = normalizeLopuAdminAccountRow(resp?.account);
		if (served && served.user.id === row.user.id) {
			patchRow(row.user.id, (entry) => ({ ...served, user: { ...entry.user, ...served.user } }));
			return;
		}
		const balance = typeof resp?.balanceMicros === 'number' ? resp.balanceMicros : row.balanceMicros + fallbackDelta;
		patchRow(row.user.id, (entry) => ({ ...entry, balanceMicros: balance, noAccount: false }));
	};

	const grant = async (row: LopuAdminAccountRow, args: { credits: number; entry: CreditEntry; reason: string }): Promise<boolean> => {
		if (busyId) return false;
		setBusyId(row.user.id);
		try {
			const resp = await apiRef.current.v1.admin.lopuCredits({ userId: row.user.id, credits: args.credits, entry: args.entry, reason: args.reason || `${args.entry} by admin` });
			if (resp?.ok === false) throw new Error(errorMessage(resp, 'Could not update the credits'));
			applyCreditsResponse(row, resp, Math.round(args.credits * 1_000_000));
			lopu({ title: `${args.credits > 0 ? '+' : ''}${args.credits} credits for @${row.user.username} ✨`, status: 'success', duration: 5000 });
			if (row.user.id === me?.id) void refreshLopuAccount();
			return true;
		} catch (error: unknown) {
			lopu({ title: 'Could not update the credits', description: errorMessage(error, 'Please try again in a moment.'), status: 'error' });
			return false;
		} finally {
			setBusyId(null);
		}
	};

	const settleRequest = async (row: LopuAdminAccountRow, approve: boolean, reason: string): Promise<boolean> => {
		const pending = row.pendingRequest;
		if (busyId || !pending) return false;
		setBusyId(row.user.id);
		try {
			const credits = pending.amountMicros / 1_000_000;
			const resp = approve
				? await apiRef.current.v1.admin.lopuCredits({ userId: row.user.id, credits, entry: 'topup', reason: reason || 'top-up request approved', ...(pending.id ? { requestId: pending.id } : {}) })
				: await apiRef.current.v1.admin.lopuCredits({ userId: row.user.id, ...(pending.id ? { requestId: pending.id } : {}), decline: true, reason: reason || 'declined by admin' });
			if (resp?.ok === false) throw new Error(errorMessage(resp, 'Could not settle the request'));
			patchRow(row.user.id, (entry) => ({ ...entry, pendingRequest: null }));
			if (approve) applyCreditsResponse({ ...row, pendingRequest: null }, resp, pending.amountMicros);
			lopu({ title: approve ? `Approved ${formatTurnCredits(pending.amountMicros)} credits for @${row.user.username} ✨` : `Declined @${row.user.username}'s request`, status: 'success', duration: 5000 });
			if (row.user.id === me?.id) void refreshLopuAccount();
			return true;
		} catch (error: unknown) {
			lopu({ title: 'Could not settle the request', description: errorMessage(error, 'Please try again in a moment.'), status: 'error' });
			return false;
		} finally {
			setBusyId(null);
		}
	};

	const pendingCount = rows.filter((row) => row.pendingRequest).length;

	return (
		<Flex flexDirection="column" rowGap={3} data-lopu-accounts-admin>
			<Text sx={eyebrow}>Lopu accounts 🦄</Text>
			<Text fontSize="xs" color={LOPU_UI.muted} lineHeight="1.5">
				Lopu is invite-only: verify an account to let it build with Lopu, and grant credits for the turns Thingtime&apos;s own keys pay for (1 credit = 1 USD of list
				price). People using their own Secure Vault providers spend nothing here.
			</Text>

			<AccessSettingsEditor />

			<Text sx={eyebrow}>Accounts{pendingCount ? ` · ${pendingCount} pending ${pendingCount === 1 ? 'request' : 'requests'}` : ''}</Text>
			<Flex columnGap={2} rowGap={2} wrap="wrap">
				<Input
					size="sm"
					flex="1 1 220px"
					placeholder="🔍 username or name"
					aria-label="Search accounts"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							search();
						}
					}}
					sx={inputSx}
				/>
				<Button size="sm" variant="outline" borderColor={LOPU_UI.borderColor} color={LOPU_UI.ink} borderRadius={LOPU_UI.radiusSm} isLoading={loading && !rows.length} onClick={search} flexShrink={0}>
					Search
				</Button>
				{activeQuery ? (
					<Button
						size="sm"
						variant="ghost"
						color={LOPU_UI.muted}
						onClick={() => {
							setQuery('');
							setActiveQuery('');
							void load('', null);
						}}
					>
						Clear
					</Button>
				) : null}
			</Flex>

			{failed ? (
				<Text fontSize="xs" color={LOPU_UI.danger}>
					{failed}
				</Text>
			) : null}
			<Flex flexDirection="column" rowGap={1}>
				{rows.map((row) => (
					<AccountRow key={row.user.id} row={row} me={me?.id ?? null} busy={busyId === row.user.id} onVerify={verify} onCredits={grant} onRequest={settleRequest} />
				))}
				{!rows.length ? (
					<Text fontSize="xs" color={LOPU_UI.muted}>
						{loaded && !loading ? (activeQuery ? 'No accounts match that search.' : 'No accounts have met Lopu yet.') : 'Loading accounts…'}
					</Text>
				) : null}
			</Flex>
			{nextCursor ? (
				<Flex>
					<SmallButton busy={loading} onClick={() => void load(activeQuery, nextCursor)}>
						Load more
					</SmallButton>
				</Flex>
			) : null}
		</Flex>
	);
};
