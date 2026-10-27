import React from 'react';
import { Box, Button, Heading, Input, Text } from '@chakra-ui/react';
import type { DeviceVaultSession } from '~/local-workspace/deviceVaultSession';
import { LocalPasswordVault } from '~/local-workspace/passwordVault';
import type { WorkspaceScope } from '~/local-workspace/storage';
import { anonymousWorkspaceDatabase, anonymousWorkspaceLease, accountWorkspaceLease } from '~/local-workspace/runtime.client';

/** The normal editor/importer/exporter behind an independently encrypted device
 * vault. No account session, server key or native AutoFill grant is borrowed. */
export function DevicePasswordManager({ children, scope }: { children: (vault: LocalPasswordVault) => React.ReactNode; scope?: Extract<WorkspaceScope, { kind: 'account' }> }) {
 const [vault, setVault] = React.useState<LocalPasswordVault | null>(null);
 React.useEffect(() => {
  const current = new LocalPasswordVault(anonymousWorkspaceDatabase(), scope ?? { kind: 'anonymous' }, scope ? accountWorkspaceLease(scope) : anonymousWorkspaceLease(), window.location.origin);
  setVault(current);
  const touch = () => current.touch(); window.addEventListener('pointerdown', touch); window.addEventListener('keydown', touch);
  const hide = () => current.lock(); window.addEventListener('pagehide', hide);
  return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); window.removeEventListener('pagehide', hide); current.dispose(); };
 }, [scope]);
 return vault ? <DeviceVaultGate vault={vault}>{children}</DeviceVaultGate> : <Box p={6}><Heading size="md">Passwords</Heading><Text mt={3}>Opening device vault…</Text></Box>;
}
export function DeviceVaultGate<T extends DeviceVaultSession>({ vault, children, title = 'Passwords' }: { vault: T; children: (vault: T) => React.ReactNode; title?: string }) {
 const fieldId = React.useId();
 const unlocked = React.useSyncExternalStore(vault.subscribe, vault.isUnlocked, () => false);
 const [configured, setConfigured] = React.useState<boolean | null>(null), [password, setPassword] = React.useState(''), [confirmation, setConfirmation] = React.useState('');
 const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
 React.useEffect(() => { let alive = true; vault.configured().then(value => { if (alive) setConfigured(value); }).catch(() => { if (alive) setError('Device vault storage is unavailable. Your saved entries have not been changed.'); }); return () => { alive = false; }; }, [vault, unlocked]);
 const submit = async (event: React.FormEvent) => {
  event.preventDefault(); if (busy || configured === null) return;
  if (!configured && password !== confirmation) { setError('The two passphrases do not match.'); return; }
  const phrase = password; setPassword(''); setConfirmation(''); setBusy(true); setError('');
  try { await vault.unlock(phrase, !configured); setConfigured(true); }
  catch (reason) { setError(reason instanceof Error ? reason.message : 'The device vault could not be unlocked.'); }
  finally { setBusy(false); }
 };
 if (unlocked) return <>{children(vault)}</>;
 return <Box as="form" onSubmit={submit} maxW="560px" mx="auto" p={{ base: 3, md: 6 }}>
  <Heading size="lg">{title}</Heading>
  <Text mt={3}>{configured === false ? 'Set up an encrypted vault for this device.' : 'Unlock the encrypted vault on this device.'}</Text>
  <Text mt={2} color="var(--tt-muted)">{vault.scope.kind === 'anonymous' ? 'Anonymous entries stay on this device and are never uploaded.' : 'Account entries save encrypted on this device first. Sync runs separately after your account is confirmed.'} Your vault locks after five minutes without use.</Text>
  {configured === false && <Text mt={3}>Choose a separate device passphrase of at least 12 characters. It is not your account password and cannot be reset. Keep it safe to recover device edits that have not synced. Saved entries are available offline.</Text>}
  <Text as="label" htmlFor={`${fieldId}-password`} display="block" mt={4}>Device vault passphrase</Text>
  <Input id={`${fieldId}-password`} type="password" autoComplete={configured ? 'current-password' : 'new-password'} maxLength={4096} value={password} onChange={event => setPassword(event.target.value)} isDisabled={busy} />
  {configured === false && <><Text as="label" htmlFor={`${fieldId}-confirmation`} display="block" mt={3}>Confirm device vault passphrase</Text><Input id={`${fieldId}-confirmation`} type="password" autoComplete="new-password" maxLength={4096} value={confirmation} onChange={event => setConfirmation(event.target.value)} isDisabled={busy} /></>}
  {error && <Text role="alert" mt={3} color="red.600">{error}</Text>}
  <Button mt={4} type="submit" isLoading={busy} isDisabled={configured === null || !password || (!configured && !confirmation)}>{configured === false ? 'Create device vault' : 'Unlock device vault'}</Button>
 </Box>;
}
