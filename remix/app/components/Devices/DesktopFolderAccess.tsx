import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Button, FormControl, FormLabel, Select, Text } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import { getElectronBridge } from '~/utils/electronBridge';
import { createDesktopFolderHost, type FolderHost } from '~/fileSync/desktopFolders.client';
import { MobileFolderAccess } from './MobileFolderAccess';
import { nativeSyncTasks } from '~/fileSync/nativeSyncTasks.client';

/** Local status supplies candidates only. The signed host and paired node must
 * both verify the active account before these controls can access any folder. */
export function DesktopFolderAccess({
	ownerId,
	pairedDeviceIds,
	ownedDeviceIds,
	deviceId: selectedDeviceId,
	active = true
}: {
	ownerId: string;
	pairedDeviceIds: readonly string[];
	ownedDeviceIds: readonly string[];
	deviceId?: string;
	active?: boolean;
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
			key={JSON.stringify([ownerId, candidates, identity.generation])}
			ownerId={ownerId}
			candidates={candidates}
			generation={identity.generation}
		/>
	);
}
function DeviceFolders({ ownerId, candidates, generation, active }: { ownerId: string; candidates: string[]; generation: number; active: boolean }) {
	const [choice, setChoice] = useState('');
	const deviceId = candidates.length === 1 ? candidates[0] : candidates.includes(choice) ? choice : '';
	return (
		<Box border="1px solid var(--tt-border, #ececef)" borderRadius="12px" padding={4} minWidth={0}>
			<Text fontWeight={700} fontSize="14px">
				Folders on this Mac
			</Text>
			{candidates.length > 1 ? (
				<FormControl marginTop={2}>
					<FormLabel fontSize="12px">Local device connection</FormLabel>
					<Select value={choice} onChange={(event) => setChoice(event.target.value)} placeholder="Choose a connection">
						{candidates.map((id) => (
							<option key={id} value={id}>
								{id}
							</option>
						))}
					</Select>
				</FormControl>
			) : null}
			{deviceId ? <VerifiedFolders active={active} key={deviceId} ownerId={ownerId} deviceId={deviceId} generation={generation} /> : null}
		</Box>
	);
}
function VerifiedFolders({ ownerId, deviceId, generation, active }: { ownerId: string; deviceId: string; generation: number; active: boolean }) {
	const task = useSyncExternalStore(nativeSyncTasks.subscribe, nativeSyncTasks.read, nativeSyncTasks.read);
	let taskHost: FolderHost | undefined;
	if (task?.scope.ownerId === ownerId && task.scope.deviceId === deviceId && task.scope.dataPlane === 'home') {
		try { task.host?.assertCurrent(); taskHost = task.host; } catch { /* Reauthorize after stop or identity change. */ }
	}
	const [host, setHost] = useState<FolderHost>(),
		[error, setError] = useState(''),
		[attempt, setAttempt] = useState(0);
	useEffect(() => {
		if (taskHost) { setHost(undefined); return; }
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
	}, [ownerId, deviceId, generation, attempt, taskHost]);
	if (taskHost || host) return <MobileFolderAccess active={active} ownerId={ownerId} deviceId={deviceId} host={taskHost ?? host} />;
	return (
		<Box marginTop={2}>
			<Text fontSize="12px" role={error ? 'alert' : undefined}>
				{error || 'Verifying this Mac’s account connection…'}
			</Text>
			{error ? (
				<Button marginTop={2} size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
					Retry folder access
				</Button>
			) : null}
		</Box>
	);
}
