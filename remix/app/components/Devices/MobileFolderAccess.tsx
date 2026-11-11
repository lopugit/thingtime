import { nativeSyncTasks } from '~/fileSync/nativeSyncTasks.client';
import { SyncConditionsWait } from '~/fileSync/foregroundSyncContext';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { requestMobileFolders, supportsMobileFolders, type FolderRequest, type MobileFolder } from '~/fileSync/mobileFolders.client';
import type { FolderHost } from '~/fileSync/desktopFolders.client';
import { getNativeBridge } from '~/utils/nativeBridge';
import { rootIdentity } from '~/utils/rootIdentity';
import { MobileSyncConnections } from './MobileSyncConnections';
import { newlyGrantedFolder } from './syncFolderEditor';
const cached = new Map<string, MobileFolder[]>();
type FolderAccessProps = { ownerId: string; deviceId: string; host?: FolderHost; active?: boolean };
export function MobileFolderAccess({ ownerId, deviceId, host, active = true }: FolderAccessProps) {
	const identity = useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	if (identity.pending || (!host && !supportsMobileFolders())) return null;
	const scopeKey = JSON.stringify([host?.origin() ?? window.location.origin, ownerId, deviceId, identity.generation]);
	return (
		<FolderAccess
			key={scopeKey}
			scopeKey={scopeKey}
			generation={identity.generation}
			ownerId={ownerId}
			deviceId={deviceId}
			active={active}
			host={host}
		/>
	);
}
function FolderAccess({ ownerId, deviceId, host, active = true, scopeKey: key, generation }: FolderAccessProps & { scopeKey: string; generation: number }) {
	const requestFolders = host?.request ?? requestMobileFolders;
	const [roots, setRoots] = useState<MobileFolder[]>(() => cached.get(key) ?? []),
		[busy, setBusy] = useState(false),
		[error, setError] = useState(''),
		[waiting, setWaiting] = useState(false);
	const [rootsReady, setRootsReady] = useState(() => cached.has(key));
	const [picked, setPicked] = useState<MobileFolder>();
	const rootsRef = useRef(roots);
	const [checked, setChecked] = useState<Record<string, string>>({});
	const pending = useRef<AbortController | null>(null);
	const needsForegroundRead = useRef(true);
	const foregroundDuringRequest = useRef(false);
	const mobile = !host && getNativeBridge()?.platform === 'ios';
	const task = useSyncExternalStore(nativeSyncTasks.subscribe, nativeSyncTasks.read, nativeSyncTasks.read);
	const [nativePhotoActive, setNativePhotoActive] = useState(false);
	const transferring = !!task?.active || nativePhotoActive;
	const transferBusy = useRef(transferring);
	transferBusy.current = transferring;
	const run = useCallback(
		async function checkFolders(request: FolderRequest, retryAfterWake = true): Promise<void> {
			if (pending.current || (request.action !== 'list' && (nativeSyncTasks.read()?.active || transferBusy.current)) || (mobile && document.visibilityState === 'hidden')) return;
			const controller = new AbortController();
			pending.current = controller;
			foregroundDuringRequest.current = false;
			setBusy(true);
			setError('');
			setWaiting(false);
			let retry = false;
			try {
				const result = await requestFolders(ownerId, request, controller.signal);
				const identity = rootIdentity.read();
				if (controller.signal.aborted || identity.pending || identity.generation !== generation) return;
				needsForegroundRead.current = false;
				const added = request.action === 'choose' && newlyGrantedFolder(rootsRef.current, result.roots);
				rootsRef.current = result.roots;
				setRoots(result.roots);
				if (added) setPicked(added);
				setRootsReady(true);
				cached.set(key, result.roots);
				if (cached.size > 32) cached.delete(cached.keys().next().value!);
				if (request.action === 'scan') {
					const count = result.entries!.filter((e) => e.kind === 'file').length;
					setChecked((previous) => ({ ...previous, [request.rootId]: `${count} ${count === 1 ? 'file' : 'files'} checked` }));
				}
				if (request.action === 'remove')
					setChecked((previous) => {
						const next = { ...previous };
						delete next[request.rootId];
						return next;
					});
			} catch (cause) {
				if (!controller.signal.aborted) {
					if (mobile && request.action === 'list' && cause instanceof SyncConditionsWait && cause.reason === 'inactive') {
						needsForegroundRead.current = true;
						setWaiting(true);
						retry = retryAfterWake && foregroundDuringRequest.current && document.visibilityState === 'visible';
					} else {
						needsForegroundRead.current = false;
						setError(cause instanceof Error ? cause.message : 'Folder access failed. Try again.');
					}
				}
			} finally {
				if (pending.current === controller) {
					pending.current = null;
					if (!controller.signal.aborted) setBusy(false);
				}
			}
			if (retry && !controller.signal.aborted) await checkFolders({ action: 'list' }, false);
		},
		[ownerId, key, requestFolders, mobile, generation]
	);
	useEffect(() => {
		setBusy(false);
		if (!transferBusy.current) void run({ action: 'list' });
		const wake = () => {
			if (document.visibilityState !== 'visible' || transferBusy.current) return;
			if (pending.current) foregroundDuringRequest.current = true;
			else if (needsForegroundRead.current) void run({ action: 'list' });
		};
		if (mobile) {
			document.addEventListener('visibilitychange', wake);
			window.addEventListener('pageshow', wake);
			window.addEventListener('focus', wake);
		}
		return () => {
			document.removeEventListener('visibilitychange', wake);
			window.removeEventListener('pageshow', wake);
			window.removeEventListener('focus', wake);
			const controller = pending.current;
			pending.current = null;
			controller?.abort();
		};
	}, [run, mobile]);
	useEffect(() => {
		if (!transferring && needsForegroundRead.current) void run({ action: 'list' });
	}, [transferring, run]);
	return <MobileSyncConnections active={active} ownerId={ownerId} deviceId={deviceId} roots={roots}
		rootsReady={rootsReady} host={host} onNativePhotoActivity={setNativePhotoActive}
		folderManagement={{ run, busy, transferring, error, waiting, checked, picked }} />;
}
