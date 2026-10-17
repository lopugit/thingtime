import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import type { LocalProviderVault } from '~/local-workspace/providerVault';
import type { WorkspaceScope } from '~/local-workspace/storage';
import { accountProviderTransport } from '~/local-workspace/providerTransport.client';
import { createSyncPump } from '~/local-workspace/syncPump';
import { accountWorkspaceLease, canSyncAccountWorkspace, subscribeWorkspaceBinding, announceLocalWorkspaceChange, LOCAL_WORKSPACE_CHANGED } from '~/local-workspace/runtime.client';
type Scope = Extract<WorkspaceScope, { kind: 'account' }>;
type Status = Awaited<ReturnType<LocalProviderVault['syncStatus']>>;
type Review = Awaited<ReturnType<LocalProviderVault['reviewRefused']>>;

/** Local saves have no dependency on these independent account sync workers. */
export function AccountProviderWorkspace({ vault, scope, children }: { vault: LocalProviderVault; scope: Scope; children: React.ReactNode }) {
 const [status, setStatus] = React.useState<Status>([]), [review, setReview] = React.useState<Review | null>(null);
 const [error, setError] = React.useState(''), [message, setMessage] = React.useState(''), [resolving, setResolving] = React.useState(false);
 const confirmed = React.useSyncExternalStore(subscribeWorkspaceBinding, () => canSyncAccountWorkspace(scope), () => false);
 const controls = React.useRef<{ wake: () => void; controller: AbortController; transport: ReturnType<typeof accountProviderTransport> } | null>(null);
 React.useEffect(() => {
  let active = true, sequence = 0;
  const controller = new AbortController(), transport = accountProviderTransport(scope, accountWorkspaceLease(scope));
  const enabled = () => active && vault.isUnlocked() && navigator.onLine !== false && canSyncAccountWorkspace(scope);
  const refresh = async () => {
   const generation = ++sequence, next = await vault.syncStatus();
   const conflict = next[0]?.state === 'refused' ? await vault.reviewRefused(next[0].recordId, controller.signal) : null;
   if (active && generation === sequence) { setStatus(next); setReview(conflict); }
   return next;
  };
  const pull = createSyncPump(enabled, async () => {
   try { await vault.reconcileMetadata(transport, controller.signal); if (active) { setError(''); announceLocalWorkspaceChange(); } return null; }
   catch { if (active && vault.isUnlocked()) setError('Account refresh is unavailable. Device entries remain available.'); return 60_000; }
  });
  const push = createSyncPump(enabled, async () => {
   try {
    const result = await vault.synchronize(transport, controller.signal), rows = await refresh();
    if (result.completed && active) { setError(''); announceLocalWorkspaceChange(); pull.wake(); }
    // The queue is ordered by dependencies. A refused first change is reviewed
    // before later changes can be sent; uncertain requests keep their identity.
    const first = rows[0];
    return first && first.state !== 'refused' ? (first.retryAt && first.retryAt > Date.now() ? Math.min(60_000, first.retryAt - Date.now()) : 60_000) : null;
   } catch { if (active && vault.isUnlocked()) setError('Account sync is unavailable. Device changes remain saved and encrypted.'); return 60_000; }
  });
  const changed = () => { void refresh().catch(() => { if (active) setError('The waiting changes could not be reviewed. Saved device entries have been kept.'); }); push.wake(); };
  const wake = () => { changed(); pull.wake(); };
  controls.current = { wake, controller, transport };
  const off = subscribeWorkspaceBinding(wake);
  window.addEventListener('online', wake); window.addEventListener('focus', wake); window.addEventListener(LOCAL_WORKSPACE_CHANGED, changed);
  wake();
  return () => { active = false; controls.current = null; controller.abort(); push.stop(); pull.stop(); off(); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); window.removeEventListener(LOCAL_WORKSPACE_CHANGED, changed); };
 }, [vault, scope]);
 const resolve = async (choice: 'account' | 'copy') => {
  const current = controls.current, selected = review; if (!current || !selected || resolving) return;
  setResolving(true); setError(''); setMessage('');
  try {
   await vault.resolveRefused(selected.recordId, selected.reviewId, choice, current.transport, current.controller.signal);
   if (!current.controller.signal.aborted) { setReview(null); setMessage('Resolution saved on this device. Account sync continues separately.'); announceLocalWorkspaceChange(); current.wake(); }
  } catch { if (!current.controller.signal.aborted) { setReview(null); setError('The conflict changed or could not be resolved. Refresh and review it again; device changes have been kept.'); current.wake(); } }
  finally { if (!current.controller.signal.aborted) setResolving(false); }
 };
 return <>
  <Box mb={4} p={3} border="1px solid var(--tt-border, #e6e6eb)" borderRadius="12px" minW={0}>
   <Flex alignItems="center" gap={3} flexWrap="wrap"><Text role="status">{!confirmed ? 'Device vault · account confirmation needed for sync' : status.length ? `${status.length} device changes waiting for account sync` : 'Device vault · no pending account changes'}</Text><Button size="sm" variant="outline" onClick={() => controls.current?.wake()}>Refresh account sync</Button></Flex>
   {error && <Text role="alert" mt={2}>{error}</Text>}{message && <Text role="status" mt={2}>{message}</Text>}
   {review && <Box mt={3} p={3} border="1px solid var(--tt-border, #e6e6eb)" borderRadius="8px" aria-label="Review provider vault conflict">
    <Text fontWeight="bold">Waiting changes need review</Text>
    <Text mt={1}>The account refused this change. These entries are reviewed together because their saved environments depend on each other.</Text>
    <Box as="ul" my={3} pl={5}>{review.items.map(item => <Text as="li" key={item.id} overflowWrap="anywhere">{item.name}{item.deleted ? ' (deleted on this device)' : ''}</Text>)}</Box>
    <Text>Use the account versions to discard pending device changes for these entries. Keeping the device versions creates independent entries and preserves the account originals.</Text>
    {!review.canCopy && <Text mt={2}>An independent copy needs values already saved on this device. Deleted entries and values available only from the account cannot be copied.</Text>}
    <Flex gap={2} mt={3} flexWrap="wrap">
     {review.canCopy && <Button size="sm" whiteSpace="normal" height="auto" minH={8} py={2} isDisabled={!confirmed || resolving} onClick={() => void resolve('copy')}>Keep device versions as new entries</Button>}
     <Button size="sm" variant="outline" isDisabled={!confirmed || resolving} onClick={() => void resolve('account')}>Use account versions</Button>
    </Flex>
   </Box>}
  </Box>
  {children}
 </>;
}
