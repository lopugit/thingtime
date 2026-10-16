import type { AccountFileSync } from './accountFiles';
import type { AccountFileMetadata } from './accountFileMetadata';
import { useOfflineWorkspace } from '../hooks/useWorkspaceUser';
import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useDataPlane } from '../hooks/useDataPlane';
import { accountWorkspaceWorker } from './accountApi.client';
import { LOCAL_WORKSPACE_CHANGED, announceLocalWorkspaceChange } from './runtime.client';
import type { AccountThingSync } from './accountSync';
import type { AccountInteractionSync } from './accountInteractions';

type Review = Awaited<ReturnType<AccountThingSync['inspectConflict']>>;
type Status = Awaited<ReturnType<AccountThingSync['status']>>;
export function AccountSyncStatus() {
 const user = useCurrentUser(), dataPlane = useDataPlane(), offline = useOfflineWorkspace();
 const ownerId = offline?.ownerId || (user && !user.temporary ? user.id : null);
 if (!ownerId || !dataPlane) return null;
 return <React.Fragment key={JSON.stringify([ownerId, dataPlane])}><WorkspaceStatus ownerId={ownerId} dataPlane={dataPlane} unconfirmed={!!offline} /><InteractionStatus ownerId={ownerId} dataPlane={dataPlane} unconfirmed={!!offline} /><FileSyncStatus ownerId={ownerId} dataPlane={dataPlane} unconfirmed={!!offline} /></React.Fragment>;
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
  try { await run(service); if (mounted.current) { setRows((await service.sync.status()).filter(row => row.state !== 'synced')); announceLocalWorkspaceChange(); service.wake(); } }
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
    {row.state === 'conflict' && row.deleted ? <Button size="sm" isDisabled={busy || !online || unconfirmed} onClick={() => void act(service => service.sync.retry(row.id))}>Check deletion again</Button> : null}
   </Flex>)}
   {rows.length > 20 ? <Text fontSize="sm">Showing the first 20 of {rows.length} pending Things.</Text> : null}
  </details>
  {review ? <Box mt={3}>
   <Text fontWeight="bold">{review.deleted ? 'Review this deletion' : 'Choose the version to keep'}</Text>
   <Text fontSize="sm">{review.deleted ? 'This Thing was deleted on this device, but its account version changed. Delete the reviewed version or restore the account version to this device.' : 'Keeping this device’s version will replace the reviewed account version. Keeping the account version will replace this device’s edits.'}</Text>
   <Flex gap={3} flexWrap="wrap" my={3}>
    {([{ name: 'This device', row: review.local }, { name: 'Account', row: review.remote }]).map(({ name, row }) => <Box key={name} flex="1" minW="min(260px, 100%)" maxW="100%"><Text>{name}</Text><Box as="pre" maxH="240px" overflow="auto" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="xs">{JSON.stringify({ thingtime: row.thingtime, crystal: row.crystal, extended: row.extended, tags: row.tags, folderId: row.folderId, targetId: row.targetId, acl: row.acl }, null, 2)}</Box></Box>)}
   </Flex>
   <Flex gap={3} flexWrap="wrap">
    {(['local', 'remote'] as const).map(keep => <Button key={keep} size="sm" isDisabled={busy || !online || unconfirmed} onClick={() => void act(async service => { await service.sync.resolveConflict(service.transport, { id: review.local.id, keep, localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt }); if (mounted.current) setReview(null); })}>{keep === 'local' ? review.deleted ? 'Delete reviewed account version' : 'Keep this device’s version' : 'Keep account version'}</Button>)}
    <Button size="sm" variant="ghost" onClick={() => setReview(null)}>Cancel</Button>
   </Flex>
  </Box> : null}
  {error ? <Text role="alert" mt={2}>{error}</Text> : null}
 </Box>;
}


function InteractionStatus({ ownerId, dataPlane, unconfirmed }: { ownerId: string; dataPlane: string; unconfirmed: boolean }) {
	const [rows, setRows] = React.useState<Awaited<ReturnType<AccountInteractionSync['status']>>>([]),
		[review, setReview] = React.useState<Awaited<ReturnType<AccountInteractionSync['inspect']>> | null>(null),
		[error, setError] = React.useState(''),
		[busy, setBusy] = React.useState(false),
		[online, setOnline] = React.useState(navigator.onLine);
	const service = React.useRef<ReturnType<typeof accountWorkspaceWorker> | null>(null),
		mounted = React.useRef(true);
	React.useEffect(() => {
		mounted.current = true;
		const current = accountWorkspaceWorker({ kind: 'account', ownerId, dataPlane, origin: window.location.origin });
		service.current = current;
		const update = () => {
			setOnline(navigator.onLine);
			void current.interactions
				.status()
				.then((value) => {
					if (mounted.current) setRows(value.filter((row) => row.state !== 'synced'));
				})
				.catch(() => {});
		};
		update();
		for (const event of [LOCAL_WORKSPACE_CHANGED, 'online', 'offline']) window.addEventListener(event, update);
		return () => {
			mounted.current = false;
			for (const event of [LOCAL_WORKSPACE_CHANGED, 'online', 'offline']) window.removeEventListener(event, update);
		};
	}, [ownerId, dataPlane]);
	const act = async (run: (value: NonNullable<typeof service.current>) => Promise<unknown>) => {
		if (!service.current) return;
		setBusy(true);
		setError('');
		try {
			await run(service.current);
			if (mounted.current) {
				announceLocalWorkspaceChange();
				service.current.wake();
			}
		} catch (failure) {
			if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not sync interactions.');
		} finally {
			if (mounted.current) setBusy(false);
		}
	};
	if (!rows.length && !error) return null;
	const disabled = busy || !online || unconfirmed;
	const describe = (state: { saved: boolean; reactions: string[] }) =>
		`${state.saved ? 'In Library' : 'Not in Library'} · Reactions: ${state.reactions.join(' ') || 'none'}`;
	return (
		<Box
			as="section"
			aria-label="Account interaction sync"
			maxW="900px"
			w="calc(100% - 32px)"
			mx="auto"
			mt="var(--tt-nav-clearance, 72px)"
			mb={4}
			sx={{ '[data-testid="account-sync-status"] + &': { marginTop: '16px' } }}
			p={4}
			borderWidth="1px"
			borderRadius="lg"
		>
			<Text role="status">
				{rows.length} bookmark or reaction change{rows.length === 1 ? '' : 's'} saved on this device.{' '}
				{rows.some((row) => ['error', 'conflict'].includes(row.state)) ? 'Account sync needs attention.' : 'Waiting for verified account sync.'}
			</Text>
			<details>
				<summary>Review interaction sync</summary>
				{rows.slice(0, 20).map((row) => (
					<Flex key={row.id} gap={3} py={2} align="center" flexWrap="wrap">
						<Text flex="1" flexBasis={{ base: '100%', md: 'auto' }} minW={0} overflowWrap="anywhere" fontSize="sm">
							{row.id}: {row.error || row.state}
						</Text>
						<Button
							size="sm"
							isDisabled={disabled || row.state === 'syncing'}
							onClick={() =>
								void act(async (current) => {
									const next = await current.interactions.inspect(current.transport.interactions, row.id);
									if (mounted.current) setReview(next);
								})
							}
						>
							Review account choice
						</Button>
						{row.state !== 'conflict' ? (
							<Button
								size="sm"
								isDisabled={disabled || row.state === 'syncing'}
								onClick={() => void act((current) => current.interactions.retry(row.id))}
							>
								Retry interaction sync
							</Button>
						) : null}
					</Flex>
				))}
			</details>
			{review ? (
				<Box mt={3}>
					<Text>This device: {describe(review.local)}</Text>
					<Text>Account: {describe(review.remote)}</Text>
					<Flex gap={3} mt={3} flexWrap="wrap">
						{(['local', 'remote'] as const).map((keep) => (
							<Button
								key={keep}
								size="sm"
								isDisabled={disabled}
								onClick={() =>
									void act(async (current) => {
										await current.interactions.resolve(current.transport.interactions, review, keep);
										if (mounted.current) setReview(null);
									})
								}
							>
								{keep === 'local' ? 'Keep device interaction choices' : 'Keep account interaction choices'}
							</Button>
						))}
						<Button size="sm" variant="ghost" onClick={() => setReview(null)}>
							Cancel
						</Button>
					</Flex>
				</Box>
			) : null}
			{error ? <Text role="alert">{error}</Text> : null}
		</Box>
	);
}


function FileSyncStatus({ ownerId, dataPlane, unconfirmed }: { ownerId: string; dataPlane: string; unconfirmed: boolean }) {
	const [rows, setRows] = React.useState<Awaited<ReturnType<ReturnType<typeof accountWorkspaceWorker>['files']['status']>>>([]);
	const [review, setReview] = React.useState<Awaited<ReturnType<AccountFileMetadata['inspect']>> | null>(null);
	const [deletionReview, setDeletionReview] = React.useState<Awaited<ReturnType<AccountFileSync['inspectDeletion']>> | null>(null);
	const [error, setError] = React.useState(''),
		[busy, setBusy] = React.useState(false),
		[online, setOnline] = React.useState(navigator.onLine);
	const service = React.useRef<ReturnType<typeof accountWorkspaceWorker> | null>(null);
	const mounted = React.useRef(true);
	React.useEffect(() => {
		mounted.current = true;
		const current = accountWorkspaceWorker({ kind: 'account', ownerId, dataPlane, origin: location.origin });
		service.current = current;
		const update = () => {
			setOnline(navigator.onLine);
			void current.files
				.status()
				.then((value) => {
					if (mounted.current) setRows(value.filter((row) => row.state !== 'synced'));
				})
				.catch(() => {});
		};
		update();
		for (const event of [LOCAL_WORKSPACE_CHANGED, 'online', 'offline']) window.addEventListener(event, update);
		return () => {
			mounted.current = false;
			for (const event of [LOCAL_WORKSPACE_CHANGED, 'online', 'offline']) window.removeEventListener(event, update);
		};
	}, [ownerId, dataPlane]);
	if (!rows.length && !error && !review && !deletionReview) return null;
	const act = async (run: (current: ReturnType<typeof accountWorkspaceWorker>) => Promise<unknown>) => {
		const current = service.current;
		if (!current) return;
		setBusy(true);
		setError('');
		try {
			await run(current);
			if (mounted.current) {
				setRows((await current.files.status()).filter((row) => row.state !== 'synced'));
				announceLocalWorkspaceChange();
				current.wake();
			}
		} catch (failure) {
			if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not retry account upload.');
		} finally {
			if (mounted.current) setBusy(false);
		}
	};
	return (
		<Box
			as="section"
			aria-label="Account file sync"
			maxW="900px"
			w="calc(100% - 32px)"
			mx="auto"
			mt="var(--tt-nav-clearance, 72px)"
			mb={4}
			px={4}
			py={3}
			borderWidth="1px"
			borderRadius="lg"
		>
			<Text role="status">
				{rows.length} file change{rows.length === 1 ? '' : 's'} saved on this device.{' '}
				{unconfirmed || !online
					? 'Waiting for verified account sync.'
					: rows.some((row) => row.state === 'conflict')
					? 'File changes need review.'
					: rows.some((row) => row.state === 'error')
					? 'Account upload needs attention.'
					: 'Syncing files and details to your account.'}
			</Text>
			<details>
				<summary>Review file sync</summary>
				{rows.slice(0, 20).map((row) => (
					<Flex key={row.id} gap={3} align="center" flexWrap="wrap" py={2}>
						<Text fontSize="sm" flex="1" minW={0} overflowWrap="anywhere">
							{row.name}: {row.error || (row.phase === 'delete' ? 'Deleted on this device; account deletion is queued.' : row.phase === 'cancel' ? 'Cancellation queued; device bytes are retained until confirmed.' : row.state === 'syncing' ? 'Syncing' : 'Waiting to sync')}
						</Text>
						{row.state === 'conflict' ? <Button size="sm" isDisabled={busy || !online || unconfirmed} onClick={() => void act(async current => {
							if (row.phase === 'delete') { const next = await current.files.inspectDeletion(current.transport.files, row.id); if (mounted.current) setDeletionReview(next); }
							else { const next = await current.files.metadata.inspect(current.transport.files, row.id); if (mounted.current) setReview(next); }
						})}>{row.phase === 'delete' ? 'Review file deletion' : 'Compare file details'}</Button> : <Button size="sm" isDisabled={busy || !online || unconfirmed || row.state === 'syncing'} onClick={() => void act(current => current.files.retry(row.id))}>
							{row.phase === 'delete' ? 'Retry deletion' : row.phase === 'cancel' ? 'Retry cancellation' : row.remoteId ? 'Retry file sync' : 'Retry upload'}
						</Button>}
						{row.canCancel && <Box w="100%">
							<Text fontSize="sm" mb={2}>Cancelling removes this device file once the upload is safely cancelled.</Text>
							<Button size="sm" isDisabled={busy} onClick={() => void act(current => current.files.cancel(row.id))}>Cancel upload</Button>
						</Box>}
					</Flex>
				))}
			</details>
			{review && <Box mt={3}>
				<Text fontWeight="bold">Compare file details</Text>
				<Text fontSize="sm">Choose the details to keep. The file bytes stay unchanged.</Text>
				<Flex gap={3} flexWrap="wrap" my={3}>
					{[{ name: 'This device', value: review.local }, { name: 'Account', value: review.remote.metadata }].map(({ name, value }) => <Box key={name} flex="1" minW="min(260px, 100%)" maxW="100%">
						<Text>{name}</Text><Box as="pre" maxH="240px" overflow="auto" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="xs">{JSON.stringify(value, null, 2)}</Box>
					</Box>)}
				</Flex>
				<Flex gap={3} flexWrap="wrap">{(['local', 'remote'] as const).map(keep => <Button key={keep} size="sm" isDisabled={busy || !online || unconfirmed} onClick={() => void act(async current => {
					await current.files.metadata.resolve(current.transport.files, { id: review.id, remoteId: review.remoteId, localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt, keep });
					if (mounted.current) setReview(null);
				})}>{keep === 'local' ? 'Keep device file details' : 'Keep account file details'}</Button>)}
				<Button size="sm" variant="ghost" onClick={() => setReview(null)}>Cancel</Button></Flex>
			</Box>}
			{deletionReview && <Box mt={3}>
				<Text fontWeight="bold">Review file deletion</Text>
				<Text fontSize="sm">The account file changed. Keep the device file, or delete the account version shown here.</Text>
				<Flex gap={3} flexWrap="wrap" my={3}>
					{[{ name: 'Deleted device version', value: deletionReview.local }, { name: 'Current account version', value: deletionReview.remote.metadata }].map(({ name, value }) => <Box key={name} flex="1" minW="min(260px, 100%)" maxW="100%">
						<Text>{name}</Text><Box as="pre" maxH="240px" overflow="auto" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="xs">{JSON.stringify(value, null, 2)}</Box>
					</Box>)}
				</Flex>
				<Flex gap={3} flexWrap="wrap">{(['file', 'delete'] as const).map(keep => <Button key={keep} size="sm" isDisabled={busy || !online || unconfirmed} onClick={() => void act(async current => {
					await current.files.resolveDeletion(current.transport.files, { id: deletionReview.id, localRevision: deletionReview.localRevision, operationVersion: deletionReview.operationVersion, remoteUpdatedAt: deletionReview.remote.updatedAt, keep });
					if (mounted.current) setDeletionReview(null);
				})}>{keep === 'file' ? 'Keep device file' : 'Delete reviewed account file'}</Button>)}
					<Button size="sm" variant="ghost" onClick={() => setDeletionReview(null)}>Close review</Button>
				</Flex>
			</Box>}
			{error && <Text role="alert">{error}</Text>}
		</Box>
	);
}
