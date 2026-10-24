import type { LocalProviderVault } from '~/local-workspace/providerVault';
import { validUserVaultSnapshotVersion } from '~/api/utils/lopu/userVaultModel';
import { EXPECTED_DATA_PLANE_HEADER } from '~/utils/dataPlane';
import { accountRemoteWorkspaceLease, canSyncAccountWorkspace, subscribeWorkspaceBinding, announceLocalWorkspaceChange } from '~/local-workspace/runtime.client';
import { readBoundedJson } from '~/local-workspace/accountTransport.client';
import React from 'react';
import {
	Box,
	Button,
	FormControl,
	FormLabel,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Stack,
	Text,
	Textarea
} from '@chakra-ui/react';
import { startAuthentication } from '@simplewebauthn/browser';
import { useLocation } from 'react-router';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';

type Props = { vault: 'ci' | 'admin' | 'personal' | 'deployment'; id: string; label: string; deviceVault?: LocalProviderVault; deviceRevision?: number };
const HIDE_EVENT = 'thingtime:hide-vault-values';

// Keyed to the account and selected item, never passed through localCache,
// useApi/DevKit logging, toasts, URLs or persistent browser storage.
export const VaultReveal = (props: Props) => {
	const user = useCurrentUser();
	const location = useLocation();
	return user ? <VaultRevealScope key={`${user.id}:${user.isAdmin}:${props.vault}:${props.id}:${location.key}`} {...props} /> : null;
};
const VaultRevealScope = ({ vault, id, label, deviceVault, deviceRevision }: Props) => {
 const scope = deviceVault?.scope.kind === 'account' ? deviceVault.scope : null;
 const confirmed = React.useSyncExternalStore(subscribeWorkspaceBinding, () => !scope || canSyncAccountWorkspace(scope), () => false);
 const [selectedVersion, setSelectedVersion] = React.useState<string | null>(null);
 const [retained, setRetained] = React.useState(false);
	const [open, setOpen] = React.useState(false);
	const [password, setPassword] = React.useState('');
	const [value, setValue] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState('');
	const requestRef = React.useRef<AbortController | null>(null);
	const passwordRef = React.useRef<HTMLInputElement>(null);
	const clear = React.useCallback(() => {
		requestRef.current?.abort();
		requestRef.current = null;
		setOpen(false);
		setPassword('');
		setValue(null);
  setSelectedVersion(null); setRetained(false);
		setBusy(false);
		setError('');
	}, []);
	React.useEffect(() => {
		window.addEventListener(HIDE_EVENT, clear);
		window.addEventListener('pagehide', clear);
		return () => {
			window.removeEventListener(HIDE_EVENT, clear);
			window.removeEventListener('pagehide', clear);
			requestRef.current?.abort();
		};
	}, [clear]);
 React.useEffect(() => {
  const unbound = scope ? subscribeWorkspaceBinding(clear) : undefined;
  const off = deviceVault?.subscribe(() => { if (!deviceVault.isUnlocked()) clear(); });
  if (!confirmed) clear();
  return () => { off?.(); unbound?.(); };
 }, [deviceVault, scope, confirmed, clear]);
	React.useEffect(() => {
		if (value === null) return;
		const timer = window.setTimeout(clear, 30_000);
		const hidden = () => {
			if (document.visibilityState === 'hidden') clear();
		};
		window.addEventListener('blur', clear);
		document.addEventListener('visibilitychange', hidden);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener('blur', clear);
			document.removeEventListener('visibilitychange', hidden);
		};
	}, [value, clear]);
	const verify = async (method: 'password' | 'passkey') => {
		if (busy) return;
		requestRef.current?.abort();
		const controller = new AbortController();
		requestRef.current = controller;
  let retire: (() => void) | undefined;
  let assertCurrent = () => {};
		const currentPassword = password;
		setPassword('');
		setBusy(true);
		setError('');
		const post = async (body: Record<string, unknown>) => {
   assertCurrent(); controller.signal.throwIfAborted();
			const response = await fetch('/api/v1/vault/reveal', {
				method: 'POST',
				credentials: 'same-origin',
				cache: 'no-store',
				signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    redirect: 'error',
				headers: { 'Content-Type': 'application/json', ...(scope ? { [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane } : {}) },
				body: JSON.stringify({ vault, id, ...body, ...(scope ? { includeVersion: true, expectedOwnerId: scope.ownerId } : {}) })
			});
			const result: any = await readBoundedJson(response);
   assertCurrent(); controller.signal.throwIfAborted();
			if (!response.ok || !result.ok) {
				// Only fixed messages: never echo server/provider payloads into the UI.
				throw new Error(
					response.status === 429
						? 'Too many attempts. Wait fifteen minutes and try again.'
						: response.status === 409
						? 'No active passkey here. Use your current password or add a passkey in Security settings.'
						: 'Could not verify this account or open this entry. Please try again.'
				);
			}
			return result;
		};
		try {
   if (deviceVault && (!scope || vault !== 'personal' || !deviceVault.isUnlocked())) throw new Error('Device vault is unavailable.');
   if (scope) {
    if (window.location.origin !== scope.origin) throw new Error('Account origin changed.');
    const lease = accountRemoteWorkspaceLease(scope);
    assertCurrent = () => { lease.assertCurrent(); if (!deviceVault?.isUnlocked()) throw new Error('Device vault locked.'); };
    retire = lease.onInvalidate(() => controller.abort()); assertCurrent();
    await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
   }
			await requireThingtimeCapability('api.vault-reveal', scope ? '1.3.0' : vault === 'deployment' ? '1.1.0' : '1.0.0');
			if (controller.signal.aborted) return;
			let result;
			if (method === 'password') result = await post({ action: 'reveal', password: currentPassword });
			else {
				const options = await post({ action: 'options' });
				if (controller.signal.aborted) return;
				const response = await startAuthentication({ optionsJSON: options.options });
				if (controller.signal.aborted) return;
				result = await post({ action: 'reveal', ticket: options.ticket, response });
			}
			if (controller.signal.aborted || requestRef.current !== controller) return;
			if (document.visibilityState === 'hidden') {
				clear();
				return;
			}
			if (result.vault !== vault || result.id !== id || typeof result.value !== 'string') throw new Error('Unexpected verification response.');
   assertCurrent();
   if (scope && (result.ownerId !== scope.ownerId || result.dataPlane !== scope.dataPlane || !validUserVaultSnapshotVersion(result.version))) throw new Error('Unexpected account snapshot.');
   setSelectedVersion(scope ? result.version : null);
			setValue(result.value);
		} catch (failure) {
			if (!controller.signal.aborted)
				setError(
					failure instanceof Error && failure.name === 'NotAllowedError'
						? 'Passkey verification cancelled. Try again or use your password.'
						: 'Verification failed. Check your current password or try a passkey. If you made several attempts, wait fifteen minutes.'
				);
		} finally {
   retire?.();
			if (requestRef.current === controller) setBusy(false);
		}
	};
 const retain = async () => {
  if (!deviceVault || !scope || !selectedVersion || value === null || busy || retained || deviceRevision === undefined) return;
  const controller = requestRef.current;
  if (!controller || controller.signal.aborted) return;
  setBusy(true); setError('');
  let off: (() => void) | undefined;
  try {
   const remote = accountRemoteWorkspaceLease(scope); remote.assertCurrent();
   off = remote.onInvalidate(() => controller.abort());
   // Tie local encryption and its final transaction to current remote consent.
   await deviceVault.retainSelectedValue(id, deviceRevision, { id, version: selectedVersion, value }, controller.signal);
   remote.assertCurrent();
   if (requestRef.current === controller && !controller.signal.aborted) { setRetained(true); announceLocalWorkspaceChange(); }
  } catch { if (!controller.signal.aborted) setError('The account or entry changed. Refresh and verify it again; existing device values have been kept.'); }
  finally { off?.(); if (requestRef.current === controller) setBusy(false); }
 };

	return (
		<>
			<Button
				size="sm"
				variant="ghost"
				aria-label={`Show ${label}`}
    isDisabled={!confirmed}
				onClick={() => {
					window.dispatchEvent(new Event(HIDE_EVENT));
					setOpen(true);
				}}
			>
				Show
			</Button>
			<Modal isOpen={open} onClose={clear} initialFocusRef={passwordRef} isCentered size="md" portalProps={{ appendToParentPortal: false }}>
				<ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} />
				<ModalContent containerProps={{ zIndex: DRAWER_MODAL_Z }} mx={4} maxH="calc(100dvh - 32px)" overflowY="auto">
					<ModalHeader pr={12} wordBreak="break-word">
						{value === null ? 'Verify to show' : 'Private credential'}: {label}
					</ModalHeader>
					<ModalCloseButton />
					<ModalBody>
						<Stack spacing={4}>
							{value === null ? (
								<Box
									as="form"
									onSubmit={(event: React.FormEvent) => {
										event.preventDefault();
										void verify('password');
									}}
								>
									<Text fontSize="sm" mb={4}>
										Confirm your current account password or use a passkey. This opens only this credential.
									</Text>
									<FormControl>
										<FormLabel>Current password</FormLabel>
										<Input
											ref={passwordRef}
											type="password"
											autoComplete="current-password"
											maxLength={4096}
											value={password}
											onChange={(event) => setPassword(event.target.value)}
										/>
									</FormControl>
									<Stack mt={4}>
										<Button type="submit" isDisabled={!password || busy} isLoading={busy}>
											Verify and show
										</Button>
										<Button variant="outline" isDisabled={busy} onClick={() => void verify('passkey')}>
											Verify with passkey
										</Button>
									</Stack>
								</Box>
							) : (
								<>
									<Text fontSize="sm">Hidden automatically after 30 seconds or when you leave this tab. Copy only to a trusted destination.</Text>
         {deviceVault && scope && <Box>
          <Text fontSize="sm" mb={2}>Keep this selected value encrypted on this device to use it offline. Other account values stay on the account.</Text>
          <Button size="sm" whiteSpace="normal" height="auto" minH={8} py={2} isDisabled={busy || retained || !confirmed} onClick={() => void retain()}>{retained ? 'Saved on this device' : 'Keep this value offline'}</Button>
         </Box>}
									<Textarea
										aria-label={`${label} credential`}
										value={value}
										isReadOnly
										rows={5}
										spellCheck={false}
										autoComplete="off"
										fontFamily="mono"
										overflowWrap="anywhere"
									/>
								</>
							)}
							{error ? (
								<Text role="alert" color="red.600" fontSize="sm">
									{error}
								</Text>
							) : null}
						</Stack>
					</ModalBody>
					<ModalFooter>
						<Button onClick={clear}>{value === null ? 'Cancel' : 'Hide'}</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</>
	);
};
