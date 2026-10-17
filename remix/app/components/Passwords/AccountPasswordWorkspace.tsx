import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import type { LocalPasswordVault } from '~/local-workspace/passwordVault';
import type { WorkspaceScope } from '~/local-workspace/storage';
import { accountPasswordTransport } from '~/local-workspace/passwordTransport.client';
import { createSyncPump } from '~/local-workspace/syncPump';
import { accountWorkspaceLease, canSyncAccountWorkspace, subscribeWorkspaceBinding, announceLocalWorkspaceChange, LOCAL_WORKSPACE_CHANGED } from '~/local-workspace/runtime.client';
type Scope = Extract<WorkspaceScope, { kind: 'account' }>;
type Status = Awaited<ReturnType<LocalPasswordVault['syncStatus']>>;

/** Unlock grants local decryption only. Every network operation independently
 * requires the current confirmed account/origin/data-plane lease. */
export function AccountPasswordWorkspace({ vault, scope, children }: { vault: LocalPasswordVault; scope: Scope; children: React.ReactNode }) {
 const [status, setStatus] = React.useState<Status>([]), [titles, setTitles] = React.useState<Record<string, string>>({});
 const [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [resolving, setResolving] = React.useState(false);
 const confirmed = React.useSyncExternalStore(subscribeWorkspaceBinding, () => canSyncAccountWorkspace(scope), () => false);
 const controls = React.useRef<{ wake: () => void; controller: AbortController; transport: ReturnType<typeof accountPasswordTransport> } | null>(null);
 React.useEffect(() => {
  let active = true, sequence = 0;
  const controller = new AbortController(), transport = accountPasswordTransport(scope, accountWorkspaceLease(scope));
  const enabled = () => active && vault.isUnlocked() && navigator.onLine !== false && canSyncAccountWorkspace(scope);
  const refresh = async () => {
   const version = ++sequence, next = await vault.syncStatus(), names: Record<string,string> = {};
   for (const row of next.filter(row => row.state === 'refused').slice(0,20)) {
    try { names[row.recordId] = (await vault.read(row.recordId, controller.signal)).entry.title; } catch { names[row.recordId] = 'Deleted device entry'; }
   }
   if (active && version === sequence) { setStatus(next); setTitles(names); }
   return next;
  };
  const pull = createSyncPump(enabled, async () => {
   try { await vault.reconcile(transport, controller.signal); if (active) { setError(''); announceLocalWorkspaceChange(); } return null; }
   catch { if (active && vault.isUnlocked()) setError('Account refresh is unavailable. Saved device entries remain available.'); return 60_000; }
  });
  const push = createSyncPump(enabled, async () => {
   try {
    const result = await vault.synchronize(transport, controller.signal), rows = await refresh();
    if (result.completed && active) { setError(''); announceLocalWorkspaceChange(); pull.wake(); }
    const pending = rows.filter(row => row.state !== 'refused');
    return pending.length ? Math.max(1000, Math.min(...pending.map(row => row.retryAt > Date.now() ? row.retryAt - Date.now() : 60_000))) : null;
   } catch { if (active && vault.isUnlocked()) setError('Account sync is unavailable. Device changes remain saved and encrypted.'); return 60_000; }
  });
  const changed = () => { void refresh().catch(() => {}); push.wake(); };
  const wake = () => { changed(); pull.wake(); };
  controls.current = { wake, controller, transport };
  const off = subscribeWorkspaceBinding(wake);
  window.addEventListener('online', wake); window.addEventListener('focus', wake); window.addEventListener(LOCAL_WORKSPACE_CHANGED, changed);
  wake();
  return () => { active = false; controls.current = null; controller.abort(); push.stop(); pull.stop(); off(); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); window.removeEventListener(LOCAL_WORKSPACE_CHANGED, changed); };
 }, [vault, scope]);
 const resolve = async (row: Status[number], choice: 'account' | 'copy') => {
  const current = controls.current; if (!current || resolving) return;
  setResolving(true); setError(''); setMessage('');
  try {
   await vault.resolveRefused(row.recordId, row.revision, choice, current.transport, current.controller.signal);
   if (!current.controller.signal.aborted) { setMessage('Resolution saved. Reopen any open entry to load its saved version.'); announceLocalWorkspaceChange(); current.wake(); }
  } catch { if (!current.controller.signal.aborted) setError('The conflict could not be resolved. Refresh and review it again; device changes have been kept.'); }
  finally { if (!current.controller.signal.aborted) setResolving(false); }
 };
 const refused = status.filter(row => row.state === 'refused');
 return <>
  <Box mx={{ base: 3, md: 6 }} mt={4} p={3} border="1px solid var(--tt-border, #e6e6eb)" borderRadius="12px">
   <Flex alignItems="center" gap={3} flexWrap="wrap"><Text role="status">{!confirmed ? 'Device vault · account confirmation needed for sync' : status.length ? `${status.length} device changes waiting for account sync` : 'Device vault · no pending account changes'}</Text><Button size="sm" variant="outline" onClick={() => controls.current?.wake()}>Refresh account sync</Button></Flex>
   {error && <Text role="alert" mt={2}>{error}</Text>}{message && <Text role="status" mt={2}>{message}</Text>}
   {refused.slice(0,20).map(row => <Box key={row.id} mt={3} p={3} border="1px solid var(--tt-border, #e6e6eb)" borderRadius="8px">
    <Text fontWeight="bold">{titles[row.recordId] || 'Password entry'} needs review</Text>
    <Text mt={1}>The account refused this change. Keep the device version as a new entry, or discard its pending changes and use the account version.</Text>
    <Flex gap={2} mt={2} flexWrap="wrap">{row.canCopy && <Button size="sm" isDisabled={!confirmed || resolving} onClick={() => void resolve(row, 'copy')}>Keep device version as new entry</Button>}<Button size="sm" variant="outline" isDisabled={!confirmed || resolving} onClick={() => void resolve(row, 'account')}>Use account version</Button></Flex>
   </Box>)}
   {refused.length > 20 && <Text mt={2}>Resolve these entries to review the remaining conflicts.</Text>}
  </Box>
  {children}
 </>;
}
