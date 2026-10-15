import { useOfflineWorkspace } from '../hooks/useWorkspaceUser';
import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useDataPlane } from '../hooks/useDataPlane';
import { accountWorkspaceWorker } from './accountApi.client';
import { LOCAL_WORKSPACE_CHANGED } from './runtime.client';
import type { AccountThingSync } from './accountSync';

type Review = Awaited<ReturnType<AccountThingSync['inspectConflict']>>;
type Status = Awaited<ReturnType<AccountThingSync['status']>>;
export function AccountSyncStatus() {
 const user = useCurrentUser(), dataPlane = useDataPlane(), offline = useOfflineWorkspace();
 const ownerId = offline?.ownerId || (user && !user.temporary ? user.id : null);
 if (!ownerId || !dataPlane) return null;
 return <WorkspaceStatus key={JSON.stringify([ownerId, dataPlane])} ownerId={ownerId} dataPlane={dataPlane} unconfirmed={!!offline} />;
}
function WorkspaceStatus({ ownerId, dataPlane, unconfirmed }: { ownerId: string; dataPlane: string; unconfirmed: boolean }) {
 const [rows, setRows] = React.useState<Status>([]), [error, setError] = React.useState('');
 const [review, setReview] = React.useState<Review | null>(null), [busy, setBusy] = React.useState(false);
 const [online, setOnline] = React.useState(navigator.onLine);
 const serviceRef = React.useRef<ReturnType<typeof accountWorkspaceWorker> | null>(null);
 const mounted = React.useRef(true);
 React.useEffect(() => {
  mounted.current = true;
  const service = accountWorkspaceWorker({ kind: 'account', ownerId, dataPlane, origin: window.location.origin });
  serviceRef.current = service;
  const update = () => { setOnline(navigator.onLine); void service.sync.status().then(value => { if (mounted.current) setRows(value.filter(row => row.state !== 'synced')); }).catch(() => {}); };
  update();
  window.addEventListener(LOCAL_WORKSPACE_CHANGED, update); window.addEventListener('online', update); window.addEventListener('offline', update);
  return () => { mounted.current = false; window.removeEventListener(LOCAL_WORKSPACE_CHANGED, update); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
 }, [ownerId, dataPlane]);
 const act = async (run: (service: ReturnType<typeof accountWorkspaceWorker>) => Promise<unknown>) => {
  const service = serviceRef.current; if (!service) return;
  setBusy(true); setError('');
  try { await run(service); if (mounted.current) { setRows((await service.sync.status()).filter(row => row.state !== 'synced')); service.wake(); } }
  catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not complete sync. Your local edits are preserved.'); }
  finally { if (mounted.current) setBusy(false); }
 };
 if (!rows.length && !error && !unconfirmed) return null;
 const conflicts = rows.filter(row => row.state === 'conflict').length;
 return <Box as="section" aria-label="Account sync" data-testid="account-sync-status" maxW="900px" w="calc(100% - 32px)" mx="auto" mt="var(--tt-nav-clearance, 72px)" mb={4} px={4} py={3} borderWidth="1px" borderRadius="lg">
  {unconfirmed ? <Flex gap={3} flexWrap="wrap" align="center"><Text flex="1">Offline account workspace. Local edits are available; account sync is paused until your session is verified.</Text><Button size="sm" isDisabled={!online} onClick={() => window.dispatchEvent(new Event('thingtime:root-data-refresh'))}>Reconnect</Button></Flex> : null}
  {rows.length ? <Text role="status">{conflicts ? `${conflicts} sync conflict${conflicts === 1 ? '' : 's'}. Your local edits are preserved.` : rows.some(row => row.state === 'error') ? 'Account sync needs attention. Your local edits are preserved.' : `${rows.length} change${rows.length === 1 ? '' : 's'} saved on this device. ${online ? 'Waiting to sync with your account.' : 'Offline — sync will resume when connected.'}`}</Text> : null}
  <details><summary>Review sync</summary>
   {rows.slice(0, 20).map(row => <Flex key={row.id} gap={3} align="center" flexWrap="wrap" py={2}>
    <Text fontSize="sm" flex="1" minW={0} overflowWrap="anywhere">{row.id}: {row.error || row.state}</Text>
    {row.state === 'conflict' ? <Button size="sm" isDisabled={busy || !online || unconfirmed} onClick={() => void act(async service => { const next = await service.sync.inspectConflict(service.transport, row.id); if (mounted.current) setReview(next); })}>Compare versions</Button> :
     <Button size="sm" isDisabled={busy || !online || unconfirmed || row.state === 'syncing'} onClick={() => void act(service => service.sync.retry(row.id))}>Retry sync</Button>}
   </Flex>)}
   {rows.length > 20 ? <Text fontSize="sm">Showing the first 20 of {rows.length} pending Things.</Text> : null}
  </details>
  {review ? <Box mt={3}>
   <Text fontWeight="bold">Choose the version to keep</Text>
   <Text fontSize="sm">Keeping this device’s version will replace the reviewed account version. Keeping the account version will replace this device’s edits.</Text>
   <Flex gap={3} flexWrap="wrap" my={3}>
    {([{ name: 'This device', row: review.local }, { name: 'Account', row: review.remote }]).map(({ name, row }) => <Box key={name} flex="1" minW="min(260px, 100%)" maxW="100%"><Text>{name}</Text><Box as="pre" maxH="240px" overflow="auto" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="xs">{JSON.stringify({ thingtime: row.thingtime, crystal: row.crystal, extended: row.extended, tags: row.tags, folderId: row.folderId, targetId: row.targetId, acl: row.acl }, null, 2)}</Box></Box>)}
   </Flex>
   <Flex gap={3} flexWrap="wrap">
    {(['local', 'remote'] as const).map(keep => <Button key={keep} size="sm" isDisabled={busy || !online || unconfirmed} onClick={() => void act(async service => { await service.sync.resolveConflict(service.transport, { id: review.local.id, keep, localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt }); if (mounted.current) setReview(null); })}>{keep === 'local' ? 'Keep this device’s version' : 'Keep account version'}</Button>)}
    <Button size="sm" variant="ghost" onClick={() => setReview(null)}>Cancel</Button>
   </Flex>
  </Box> : null}
  {error ? <Text role="alert" mt={2}>{error}</Text> : null}
 </Box>;
}
