import React from 'react';
import { Box, Button, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text, Textarea } from '@chakra-ui/react';
import { DeviceVaultGate } from '~/components/Passwords/DevicePasswordManager';
import { LocalProviderVault } from '~/local-workspace/providerVault';
import { anonymousWorkspaceDatabase, anonymousWorkspaceLease } from '~/local-workspace/runtime.client';

/** Same forms, independent local key; anonymous storage has no sync transport. */
export function DeviceProviderVault({ children }: { children: (vault: LocalProviderVault) => React.ReactNode }) {
 const [vault, setVault] = React.useState<LocalProviderVault | null>(null);
 React.useEffect(() => {
  const current = new LocalProviderVault(anonymousWorkspaceDatabase(), { kind: 'anonymous' }, anonymousWorkspaceLease(), window.location.origin);
  setVault(current);
  const touch = () => current.touch(), hide = () => current.lock();
  window.addEventListener('pointerdown', touch); window.addEventListener('keydown', touch); window.addEventListener('pagehide', hide);
  return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); window.removeEventListener('pagehide', hide); current.dispose(); };
 }, []);
 return vault ? <DeviceVaultGate vault={vault} title="Provider vault">{children}</DeviceVaultGate> : <Text>Opening device vault…</Text>;
}

/** Reveals one device value after the independent device unlock. Account values
 * continue to use VaultReveal and its fresh session/password/passkey proof. */
export function DeviceProviderReveal({ vault, id, label }: { vault: LocalProviderVault; id: string; label: string }) {
 const [open, setOpen] = React.useState(false), [value, setValue] = React.useState<string | null>(null), [error, setError] = React.useState('');
 const request = React.useRef<AbortController | null>(null);
 const clear = React.useCallback(() => { request.current?.abort(); request.current = null; setOpen(false); setValue(null); setError(''); }, []);
 React.useEffect(() => {
  const hidden = () => { if (document.visibilityState === 'hidden') clear(); };
  const locked = vault.subscribe(() => { if (!vault.isUnlocked()) clear(); });
  const events = ['blur', 'pagehide', 'thingtime:hide-vault-values', 'thingtime:mask-vault-values'];
  events.forEach(event => window.addEventListener(event, clear)); document.addEventListener('visibilitychange', hidden);
  return () => { request.current?.abort(); request.current = null; locked(); events.forEach(event => window.removeEventListener(event, clear)); document.removeEventListener('visibilitychange', hidden); };
 }, [vault, clear]);
 React.useEffect(() => { if (value === null) return; const timer = setTimeout(clear, 30_000); return () => clearTimeout(timer); }, [value, clear]);
 const reveal = async () => {
  window.dispatchEvent(new Event('thingtime:hide-vault-values'));
  const controller = new AbortController(); request.current = controller; setOpen(true);
  try {
   const result = await vault.reveal(id, controller.signal);
   if (request.current !== controller || controller.signal.aborted || !vault.isUnlocked()) return;
   if (document.visibilityState === 'hidden') { clear(); return; }
   setValue(result.value);
  } catch { if (!controller.signal.aborted && request.current === controller) setError('This device value could not be opened. Your saved entry has been kept.'); }
 };
 return <>
  <Button size="sm" variant="ghost" aria-label={`Show ${label}`} onClick={() => void reveal()}>Show</Button>
  <Modal isOpen={open} onClose={clear} isCentered size="md"><ModalOverlay /><ModalContent mx={4} maxH="calc(100dvh - 32px)" overflowY="auto">
   <ModalHeader pr={12} overflowWrap="anywhere">Private credential: {label}</ModalHeader><ModalCloseButton />
   <ModalBody><Box><Text fontSize="sm" mb={3}>Hidden after 30 seconds or when you leave this tab.</Text>
    {value !== null && <Textarea aria-label={`${label} credential`} value={value} isReadOnly rows={5} spellCheck={false} autoComplete="off" fontFamily="mono" overflowWrap="anywhere" />}
    {error && <Text role="alert" color="red.600">{error}</Text>}
   </Box></ModalBody><ModalFooter><Button onClick={clear}>Hide</Button></ModalFooter>
  </ModalContent></Modal>
 </>;
}
