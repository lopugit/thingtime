import React from 'react';
import { Button, Flex, Progress, Text } from '@chakra-ui/react';
import { SettingsSection } from './SettingsSection';
import { LOCAL_WORKSPACE_CHANGED } from '~/local-workspace/runtime.client';
import { workspaceStorageBinding, workspaceStorageIdentity, subscribeWorkspaceStorage } from '~/local-workspace/storageStatus.client';
import { storageProtection, type StorageProtection } from '~/local-workspace/storagePersistence';
import { WORKSPACE_LIMITS, type WorkspaceUsage } from '~/local-workspace/storage';

const message = (error: unknown) => error instanceof Error ? error.message : 'Device storage is unavailable. Try again.';
const bytesLabel = (bytes: number) => `${bytes.toLocaleString()} bytes`;

export function WorkspaceStorageSettings() {
 const identity = React.useSyncExternalStore(subscribeWorkspaceStorage, workspaceStorageIdentity, () => '');
 if (!identity) return <SettingsSection eyebrow="Device storage"><Text fontSize="sm">Reopen these settings after your workspace is ready.</Text></SettingsSection>;
 return <WorkspaceStoragePanel key={identity} identity={identity} />;
}
function WorkspaceStoragePanel({ identity }: { identity: string }) {
 const [access] = React.useState(() => { const binding = workspaceStorageBinding(); return binding?.identity === identity ? binding : null; });
 const [usage, setUsage] = React.useState<WorkspaceUsage | null>(null);
 const [protection, setProtection] = React.useState<StorageProtection | null>(null);
 const [error, setError] = React.useState(''), [protectionError, setProtectionError] = React.useState('');
 const [refreshing, setRefreshing] = React.useState(false), [requesting, setRequesting] = React.useState(false);
 const protecting = React.useRef(false);
 const alive = React.useRef(false), sequence = React.useRef(0), protectionSequence = React.useRef(0);
 const current = React.useCallback(() => alive.current && access?.identity === workspaceStorageIdentity(), [access]);
 const refresh = React.useCallback(async () => {
  if (!access || !current()) return;
  const request = ++sequence.current, protectionRequest = protecting.current ? null : ++protectionSequence.current;
  setRefreshing(true);
  await Promise.allSettled([
   access.read().then(value => { if (current() && request === sequence.current) { setUsage(value); setError(''); } })
    .catch(failure => { if (current() && request === sequence.current) setError(message(failure)); }),
   protectionRequest === null ? Promise.resolve() : Promise.resolve().then(() => storageProtection(navigator.storage, access.lease)).then(value => { if (current() && protectionRequest === protectionSequence.current) { setProtection(value); setProtectionError(''); } })
    .catch(failure => { if (current() && protectionRequest === protectionSequence.current) setProtectionError(message(failure)); })
  ]);
  if (current() && request === sequence.current) setRefreshing(false);
 }, [access, current]);
 React.useEffect(() => {
  const usageRequests = sequence, protectionRequests = protectionSequence;
  alive.current = true; void refresh();
  const update = () => { void refresh(); };
  const timer = setInterval(update, 15_000);
  window.addEventListener(LOCAL_WORKSPACE_CHANGED, update); window.addEventListener('focus', update);
  return () => { alive.current = false; usageRequests.current++; protectionRequests.current++; clearInterval(timer); window.removeEventListener(LOCAL_WORKSPACE_CHANGED, update); window.removeEventListener('focus', update); };
 }, [refresh]);
 const protect = async () => {
  if (!access || !current()) return;
  const request = ++protectionSequence.current; protecting.current = true; setRequesting(true); setProtectionError('');
  try {
   const value = await storageProtection(navigator.storage, access.lease, true);
   if (current() && request === protectionSequence.current) {
    setProtection(value);
    if (value === 'best-effort') setProtectionError('The browser did not grant protection. Your content is still saved; you can try again.');
   }
  } catch (failure) { if (current() && request === protectionSequence.current) setProtectionError(message(failure)); }
  finally { protecting.current = false; if (current()) setRequesting(false); }
 };
 return <SettingsSection eyebrow="Device storage" description={access?.scope.kind === 'anonymous' ? 'Things, drafts, files and History saved in this browser. Anonymous content is never uploaded.' : 'Local copies, drafts and pending edits for this account and database. Account storage is measured separately.'}>
  <Flex direction="column" gap={3} data-testid="workspace-storage-settings">
   {usage ? <>
    <Text role="status" fontSize="sm">{error ? 'Last known usage: ' : ''}{bytesLabel(usage.bytes)} of {bytesLabel(WORKSPACE_LIMITS.bytes)} · {usage.records.toLocaleString()} of {WORKSPACE_LIMITS.records.toLocaleString()} records</Text>
    <Progress aria-label="Device workspace storage used" value={Math.min(100, usage.bytes / WORKSPACE_LIMITS.bytes * 100)} size="xs" borderRadius="full" />
    <Text fontSize="xs" color="var(--tt-muted)">Logical workspace usage includes file bytes, saved history and internal records. Browser files and media caches are measured separately.</Text>
   </> : <Text fontSize="sm">{error ? 'Usage unavailable' : 'Checking device storage…'}</Text>}
   {error ? <Text role="alert" fontSize="sm">{error}</Text> : null}
   <Flex wrap="wrap" gap={2}>
    <Button size="sm" variant="outline" isDisabled={refreshing} onClick={() => void refresh()}>Refresh usage</Button>
    <Button as="a" href="/things" size="sm" variant="outline">Manage or export Things</Button>
    <Button as="a" href="/history" size="sm" variant="outline">Open saved History</Button>
   </Flex>
   <Text fontSize="sm" fontWeight={600}>Browser storage protection</Text>
   <Text fontSize="sm">{protection === 'persistent' ? 'Protected from automatic browser eviction.' : protection === 'unsupported' ? 'This browser does not offer storage protection.' : protection === 'best-effort' ? 'The browser may remove site data when device storage is low.' : protectionError ? 'Browser protection is unavailable.' : 'Checking browser protection…'}</Text>
   <Text fontSize="xs" color="var(--tt-muted)">Protection applies to this site in this browser. It is not a backup and cannot prevent manually cleared site data. Export important Things to keep a separate copy.</Text>
   {protection !== 'persistent' && protection !== 'unsupported' ? <Button alignSelf="flex-start" size="sm" variant="outline" isDisabled={requesting || !protection} onClick={() => void protect()}>{requesting ? 'Requesting protection…' : 'Protect device storage'}</Button> : null}
   {protectionError ? <Text role="alert" fontSize="sm">{protectionError}</Text> : null}
  </Flex>
 </SettingsSection>;
}
