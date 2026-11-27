import { DeviceSyncResources } from './DeviceSyncResources';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Button, FormControl, FormLabel, Select, Spinner, Text } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import { getElectronBridge } from '~/utils/electronBridge';
import { createDesktopFolderHost, type FolderHost } from '~/fileSync/desktopFolders.client';
import { SyncDetailsSection } from './SyncDetailsSection';
import { MobileFolderAccess } from './MobileFolderAccess';

/** Local status supplies candidates only. The signed host and paired node must
 * both verify the active account before these controls can access any folder. */
export function DesktopFolderAccess({
	ownerId,
	pairedDeviceIds,
	ownedDeviceIds,
	deviceId: selectedDeviceId,
	active = true,
 showResourceSummary = true
}: {
	ownerId: string;
	pairedDeviceIds: readonly string[];
	ownedDeviceIds: readonly string[];
	deviceId?: string;
	active?: boolean;
 showResourceSummary?: boolean;
}) {
	const user = useCurrentUser(),
		dataPlane = useDataPlane();
	const identity = useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	const bridge = getElectronBridge();
	if (
		!bridge?.folderSyncRequest ||
		bridge.platform !== 'darwin' ||
		user?.id !== ownerId ||
		user.temporary ||
		user.accountKind !== 'user' ||
		dataPlane !== 'home' ||
		identity.pending
	)
		return null;
	const candidates = [...new Set(pairedDeviceIds.filter((id) => ownedDeviceIds.includes(id) && (!selectedDeviceId || selectedDeviceId === id)))].sort();
	if (!candidates.length) return null;
	return (
		<DeviceFolders
			active={active}
   showResourceSummary={showResourceSummary}
			key={JSON.stringify([ownerId, candidates, identity.generation])}
			ownerId={ownerId}
			candidates={candidates}
			generation={identity.generation}
		/>
	);
}
function DeviceFolders({ ownerId, candidates, generation, active, showResourceSummary }: { ownerId: string; candidates: string[]; generation: number; active: boolean; showResourceSummary: boolean }) {
	const [choice, setChoice] = useState('');
	const deviceId = candidates.length === 1 ? candidates[0] : candidates.includes(choice) ? choice : '';
	return (
		<Box border="1px solid var(--tt-border, #ececef)" borderRadius="12px" padding={4} minWidth={0}>
			{candidates.length > 1 ? (
				<FormControl marginTop={2}>
					<FormLabel fontSize="12px">This Mac’s device profile</FormLabel>
					<Select value={choice} onChange={(event) => setChoice(event.target.value)} placeholder="Choose a device profile">
						{candidates.map((id) => (
							<option key={id} value={id}>
								{id}
							</option>
						))}
					</Select>
				</FormControl>
			) : null}
			{deviceId ? <VerifiedFolders active={active} key={deviceId} ownerId={ownerId} deviceId={deviceId} generation={generation} /> : null}
			{showResourceSummary && deviceId ? <Box mt={3}>
				<SyncDetailsSection title="Device activity">
					<DeviceSyncResources ownerId={ownerId} deviceId={deviceId} allowed={active} />
				</SyncDetailsSection>
			</Box> : null}
		</Box>
	);
}
function VerifiedFolders({ ownerId, deviceId, generation, active }: { ownerId: string; deviceId: string; generation: number; active: boolean }) {
	const [host, setHost] = useState<FolderHost>(),
		[error, setError] = useState(''),
		[attempt, setAttempt] = useState(0);
	useEffect(() => {
		const controller = new AbortController(),
			bridge = getElectronBridge();
		setError('');
		if (!bridge?.folderSyncRequest) return;
		void createDesktopFolderHost({
			ownerId,
			deviceId,
			bridge,
			signal: controller.signal,
			rendererOrigin: () => window.location.origin,
			assertCurrent: () => {
				const identity = rootIdentity.read();
				if (identity.pending || identity.generation !== generation || getElectronBridge() !== bridge)
					throw Error('The active account changed. Reopen folder access.');
			}
		})
			.then((value) => {
				if (!controller.signal.aborted) setHost(value);
			})
			.catch((cause) => {
				if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Folder access is unavailable.');
			});
		return () => controller.abort();
	}, [ownerId, deviceId, generation, attempt]);
	// Settings own a stable, independently verified host. Borrowing a task host
	// ties the entire editor tree to that run's abort signal and unmounts cards
	// when the run finishes, even though account/origin authority is unchanged.
	if (host) return <MobileFolderAccess active={active} ownerId={ownerId} deviceId={deviceId} host={host} />;
	return (
		<Box marginTop={2}>
			<Text fontSize="12px" role={error ? 'alert' : undefined}>
				{error || <Spinner as="span" size="xs" role="status" aria-label="Verifying this Mac’s account connection" />}
			</Text>
			{error ? (
				<Button marginTop={2} size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
					Retry folder access
				</Button>
			) : null}
		</Box>
	);
}
