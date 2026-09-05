import React from 'react';
import { Badge, Box, Button, Flex, Input, Text } from '@chakra-ui/react';

import { RainbowButton } from './SettingsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useApi } from '~/hooks/useApi';
import { isPasskeyCancel, passkeyErrorMessage, passkeysSupported, usePasskeyAuth } from '~/hooks/usePasskeys';
import type { PasskeyRecord } from '~/hooks/usePasskeys';

// Settings → Security passkey manager: list (provider, dates, linked apps),
// add (password-confirmed ceremony — the platform/1Password sheet handles the
// actual save), rename/describe inline, revoke and delete (password-confirmed,
// revoke-first). Optimistic rendering: the list seeds from localCache and
// reconciles from the API in the background.

const cacheKeyForUser = (userId: string) => `tt-passkeys:${userId}`;

const inputSx = {
	background: 'var(--tt-surface-alt, #f5f5f7)',
	border: '1px solid transparent',
	borderRadius: 'var(--tt-radius-sm, 9px)',
	'&:focus': { background: 'var(--tt-card, #ffffff)', borderColor: 'var(--tt-border, #ececef)' }
};

const compactDate = (iso: string | null) => {
	if (!iso) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const linkedAppLabel = (appKey: string, appName: string | null) => {
	if (appName) return appName;
	if (appKey.startsWith('origin:')) {
		try {
			return new URL(appKey.slice('origin:'.length)).host;
		} catch {
			return appKey.slice('origin:'.length);
		}
	}
	return appKey.replace(/^app:/, '');
};

const PasskeyRow = (props: {
	passkey: PasskeyRecord;
	onChanged: () => void;
}) => {
	const { passkey, onChanged } = props;
	const api = useApi();
	const lopu = useLopu();

	const [editing, setEditing] = React.useState(false);
	const [nickname, setNickname] = React.useState(passkey.nickname);
	const [description, setDescription] = React.useState(passkey.description || '');
	const [saving, setSaving] = React.useState(false);

	// 'revoke' | 'delete' — which destructive action the password confirm is for
	const [confirming, setConfirming] = React.useState<null | 'revoke' | 'delete'>(null);
	const [confirmPassword, setConfirmPassword] = React.useState('');
	const [confirmBusy, setConfirmBusy] = React.useState(false);

	const revoked = Boolean(passkey.revokedAt);

	const saveEdit = async () => {
		setSaving(true);
		try {
			const resp = await api.v1.auth.passkeys.update({ id: passkey.id, nickname, description });
			if (resp?.ok) {
				lopu({ title: 'Passkey updated ✨', status: 'success', duration: 3000 });
				setEditing(false);
				onChanged();
			}
		} catch (err: any) {
			lopu({ title: 'Could not update passkey', description: passkeyErrorMessage(err), status: 'error', duration: 6000 });
		} finally {
			setSaving(false);
		}
	};

	const runConfirmed = async () => {
		if (!confirming) return;
		setConfirmBusy(true);
		try {
			const resp =
				confirming === 'revoke'
					? await api.v1.auth.passkeys.revoke({ id: passkey.id, password: confirmPassword })
					: await api.v1.auth.passkeys.delete({ id: passkey.id, password: confirmPassword });
			if (resp?.ok) {
				lopu({
					title: confirming === 'revoke' ? 'Passkey revoked 🛑' : 'Passkey deleted 🗑️',
					description: confirming === 'revoke' ? 'It can never log in again. Delete it to clear it from this list.' : undefined,
					status: 'success',
					duration: 5000
				});
				setConfirming(null);
				setConfirmPassword('');
				onChanged();
			}
		} catch (err: any) {
			lopu({
				title: confirming === 'revoke' ? 'Could not revoke passkey' : 'Could not delete passkey',
				description: passkeyErrorMessage(err),
				status: 'error',
				duration: 6000
			});
		} finally {
			setConfirmBusy(false);
		}
	};

	const meta = [
		passkey.providerName,
		passkey.deviceType === 'multiDevice' ? (passkey.backedUp ? 'synced' : 'multi-device') : passkey.deviceType === 'singleDevice' ? 'this device only' : null,
		passkey.createdAt ? `added ${compactDate(passkey.createdAt)}` : null,
		passkey.lastUsedAt ? `last used ${compactDate(passkey.lastUsedAt)}` : 'never used'
	]
		.filter(Boolean)
		.join(' · ');

	return (
		<Flex
			flexDirection="column"
			rowGap={2}
			padding={3}
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			opacity={revoked ? 0.66 : 1}
		>
			<Flex alignItems="center" columnGap={3} flexWrap="wrap" rowGap={2}>
				<Box minWidth={0} flex="1">
					{editing ? (
						<Flex flexDirection="column" rowGap={2}>
							<Input size="sm" sx={inputSx} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname" maxLength={64} />
							<Input
								size="sm"
								sx={inputSx}
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="Description (optional)"
								maxLength={280}
							/>
						</Flex>
					) : (
						<>
							<Flex alignItems="center" columnGap={2}>
								<Text fontSize="sm" fontWeight="600" color="var(--tt-ink, #16161a)" noOfLines={1}>
									🔑 {passkey.nickname}
								</Text>
								{revoked && (
									<Badge colorScheme="red" fontSize="10px">
										Revoked {compactDate(passkey.revokedAt)}
									</Badge>
								)}
							</Flex>
							<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" noOfLines={1}>
								{meta}
							</Text>
							{passkey.description ? (
								<Text fontSize="xs" color="var(--tt-text, #5a5a66)" noOfLines={2}>
									{passkey.description}
								</Text>
							) : null}
						</>
					)}
				</Box>
				<Flex columnGap={2} flexShrink={0}>
					{editing ? (
						<>
							<Button size="xs" variant="outline" onClick={() => setEditing(false)} isDisabled={saving}>
								Cancel
							</Button>
							<Button size="xs" onClick={saveEdit} isLoading={saving}>
								Save
							</Button>
						</>
					) : (
						<>
							<Button size="xs" variant="outline" onClick={() => setEditing(true)}>
								Edit ✏️
							</Button>
							{revoked ? (
								<Button size="xs" variant="outline" colorScheme="red" onClick={() => setConfirming(confirming === 'delete' ? null : 'delete')}>
									Delete 🗑️
								</Button>
							) : (
								<Button size="xs" variant="outline" colorScheme="red" onClick={() => setConfirming(confirming === 'revoke' ? null : 'revoke')}>
									Revoke 🛑
								</Button>
							)}
						</>
					)}
				</Flex>
			</Flex>

			{passkey.linkedApps.length ? (
				<Flex columnGap={1} rowGap={1} flexWrap="wrap">
					{passkey.linkedApps.map((link) => (
						<Badge
							key={link.appKey}
							fontSize="10px"
							fontWeight="500"
							textTransform="none"
							background="var(--tt-surface-alt, #f5f5f7)"
							color="var(--tt-text, #5a5a66)"
							borderRadius="999px"
							paddingX={2}
							title={`First used ${compactDate(link.firstUsedAt) || '—'} · last used ${compactDate(link.lastUsedAt) || '—'}`}
						>
							{link.appKey.startsWith('app:') ? '🧩 ' : '🌐 '}
							{linkedAppLabel(link.appKey, link.appName)}
							{link.usageCount > 1 ? ` ×${link.usageCount}` : ''}
						</Badge>
					))}
				</Flex>
			) : null}

			{confirming ? (
				<Flex columnGap={2} alignItems="center" flexWrap="wrap" rowGap={2}>
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
						Confirm your password to {confirming === 'revoke' ? 'revoke' : 'permanently delete'}:
					</Text>
					<Input
						size="xs"
						sx={inputSx}
						type="password"
						autoComplete="current-password"
						width="180px"
						value={confirmPassword}
						onChange={(e) => setConfirmPassword(e.target.value)}
						placeholder="Password"
						onKeyDown={(e) => {
							if (e.key === 'Enter') runConfirmed();
						}}
					/>
					<Button size="xs" colorScheme="red" onClick={runConfirmed} isLoading={confirmBusy} isDisabled={!confirmPassword}>
						{confirming === 'revoke' ? 'Revoke' : 'Delete forever'}
					</Button>
				</Flex>
			) : null}
		</Flex>
	);
};

export const PasskeysManager = () => {
	const user = useCurrentUser();
	return user ? <AccountPasskeysManager key={user.id} userId={user.id} /> : null;
};

const AccountPasskeysManager = ({ userId }: { userId: string }) => {
	const cacheKey = cacheKeyForUser(userId);
	const api = useApi();
	const lopu = useLopu();
	const { registerPasskey, cancelPasskey } = usePasskeyAuth();

	const [passkeys, setPasskeys] = React.useState<PasskeyRecord[]>(() => readLocalCache<PasskeyRecord[]>(cacheKey) || []);
	const [adding, setAdding] = React.useState(false);
	const [addPassword, setAddPassword] = React.useState('');
	const [addNickname, setAddNickname] = React.useState('');
	const [addBusy, setAddBusy] = React.useState(false);
	const [listError, setListError] = React.useState(false);
	const mounted = React.useRef(true);
	React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

	// apiRef idiom: useApi's identity changes per render — a [api]-dep callback
	// would re-run the list effect every render (request loop).
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const refresh = React.useCallback(() => {
		apiRef.current.v1.auth.passkeys
			.list()
			.then((resp: any) => {
				if (mounted.current && resp?.ok && Array.isArray(resp.passkeys)) {
					setListError(false);
					setPasskeys(resp.passkeys);
					writeLocalCache(cacheKey, resp.passkeys);
				}
			})
			.catch(() => { if (mounted.current) setListError(true); });
	}, [cacheKey]);

	React.useEffect(() => {
		refresh();
	}, [refresh]);

	const supported = passkeysSupported();

	const addPasskey = async () => {
		if (!addPassword || addBusy) return;
		setAddBusy(true);
		try {
			const resp = await registerPasskey({ password: addPassword, nickname: addNickname || undefined });
			if (resp?.ok) {
				lopu({
					title: `Passkey added ✨`,
					description: resp.passkey?.providerName
						? `Saved with ${resp.passkey.providerName}. Use it on Thingtime addresses that share this account environment.`
						: 'Use it on Thingtime addresses that share this account environment.',
					status: 'success',
					duration: 8000
				});
				setAdding(false);
				setAddPassword('');
				setAddNickname('');
				refresh();
			}
		} catch (err: any) {
			if (!isPasskeyCancel(err)) {
				lopu({
					title: 'Could not add passkey',
					description: passkeyErrorMessage(err),
					status: 'error',
					duration: 6000
				});
			}
		} finally {
			setAddBusy(false);
		}
	};

	return (
		<Flex flexDirection="column" rowGap={3}>
			<Flex flexDirection={['column', 'row']} alignItems={['flex-start', 'center']} columnGap={4} rowGap={2}>
				<Box>
					<Text fontSize="sm" color="var(--tt-ink, #16161a)">
						Passkeys 🔑
					</Text>
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
						Sign in with Touch ID, Face ID, or your password manager (iCloud Keychain, 1Password…) — passkeys belong to the account environment where you add them. Production and development accounts may differ. No password, no 2FA code.
					</Text>
				</Box>
				<Box marginLeft={[0, 'auto']} flexShrink={0}>
					{supported ? (
						<RainbowButton size="xs" onClick={() => { cancelPasskey(); setAddPassword(''); setAdding((current) => !current); }}>
							{adding ? 'Close' : 'Add a passkey ✨'}
						</RainbowButton>
					) : (
						<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
							This browser doesn't support passkeys
						</Text>
					)}
				</Box>
			</Flex>

			{adding ? (
				<Flex
					columnGap={2}
					rowGap={2}
					alignItems="center"
					flexWrap="wrap"
					padding={3}
					background="var(--tt-surface-alt, #f5f5f7)"
					borderRadius="var(--tt-radius-md, 12px)"
				>
					<Input
						size="sm"
						sx={{ ...inputSx, background: 'var(--tt-card, #ffffff)' }}
						type="password"
						autoComplete="current-password"
						width={['100%', '200px']}
						value={addPassword}
						onChange={(e) => setAddPassword(e.target.value)}
						placeholder="Confirm password 🔐"
						onKeyDown={(e) => {
							if (e.key === 'Enter') addPasskey();
						}}
					/>
					<Input
						size="sm"
						sx={{ ...inputSx, background: 'var(--tt-card, #ffffff)' }}
						width={['100%', '200px']}
						value={addNickname}
						onChange={(e) => setAddNickname(e.target.value)}
						placeholder="Nickname (optional)"
						maxLength={64}
					/>
					<Button size="sm" onClick={addPasskey} isLoading={addBusy} isDisabled={!addPassword} loadingText="Follow your browser…">
						Create 🔑
					</Button>
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" width="100%">
						Your browser will offer to save the passkey — to iCloud Keychain, 1Password, a security key, or this device.
					</Text>
				</Flex>
			) : null}

			{listError ? <Text fontSize="xs" role="alert">Could not load passkeys. <Button size="xs" variant="link" onClick={refresh}>Try again</Button></Text> : null}
			{passkeys.length ? (
				<Flex flexDirection="column" rowGap={2}>
					{passkeys.map((passkey) => (
						<PasskeyRow key={passkey.id} passkey={passkey} onChanged={refresh} />
					))}
				</Flex>
			) : (
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
					{listError ? 'Your passkey list is unavailable.' : 'No passkeys yet.'}
				</Text>
			)}
		</Flex>
	);
};
