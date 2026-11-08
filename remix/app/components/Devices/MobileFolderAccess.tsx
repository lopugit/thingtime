import { supportsNativeSourcePaths, validNativeSourcePath } from '~/fileSync/mobileFolders.client';
import { nativeSyncTasks } from '~/fileSync/nativeSyncTasks.client';
import { SyncConditionsWait } from '~/fileSync/foregroundSyncContext';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Button, Flex, Spinner, Text } from '@chakra-ui/react';
import { requestMobileFolders, supportsMobileFolders, type FolderRequest, type MobileFolder } from '~/fileSync/mobileFolders.client';
import type { FolderHost } from '~/fileSync/desktopFolders.client';
import { getNativeBridge } from '~/utils/nativeBridge';
import { rootIdentity } from '~/utils/rootIdentity';
import { SyncFolderCard } from './SyncFolderCard';
import { MobileSyncConnections } from './MobileSyncConnections';
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
	const cardTransport = React.useMemo(() => host ? { origin: host.origin(), fetch: host.fetch, currentOrigin: host.origin } : undefined, [host]);
	const [roots, setRoots] = useState<MobileFolder[]>(() => cached.get(key) ?? []),
		[busy, setBusy] = useState(false),
		[error, setError] = useState(''),
		[waiting, setWaiting] = useState(false);
	const [rootsReady, setRootsReady] = useState(() => cached.has(key));
	const [checked, setChecked] = useState<Record<string, string>>({});
	const pending = useRef<AbortController | null>(null);
	const needsForegroundRead = useRef(true);
	const foregroundDuringRequest = useRef(false);
	const mobile = !host && getNativeBridge()?.platform === 'ios';
	const task = useSyncExternalStore(nativeSyncTasks.subscribe, nativeSyncTasks.read, nativeSyncTasks.read);
	const transferring = !!task?.active;
	const run = useCallback(
		async function checkFolders(request: FolderRequest, retryAfterWake = true): Promise<void> {
			if (pending.current || nativeSyncTasks.read()?.active || (mobile && document.visibilityState === 'hidden')) return;
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
				setRoots(result.roots);
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
		if (!transferring) void run({ action: 'list' });
		const wake = () => {
			if (document.visibilityState !== 'visible' || transferring) return;
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
	}, [run, transferring, mobile]);
	return (
		<Box borderTop="1px solid var(--tt-border, #ececef)" marginTop={3} paddingTop={3}>
			<Flex align="center" justify="space-between" gap={2} wrap="wrap">
				<Box flex="1" minWidth={{ base: '100%', sm: '180px' }}>
					<Text fontSize="13px" fontWeight={700}>
						Folder access {busy ? <Spinner as="span" size="xs" marginLeft={2} role="status" aria-label="Refreshing folder access" /> : null}
					</Text>
					<Text fontSize="12px" color="var(--tt-muted, #71717a)">
						Choose folders this account can use on this device. Selection alone does not start uploads.
					</Text>
				</Box>
				<Button size="sm" minHeight="40px" variant="outline" isDisabled={busy || transferring} onClick={() => void run({ action: 'choose' })}>
					Choose folder
				</Button>
			</Flex>
			{roots.map((root) => (
				<SyncFolderCard key={root.id} title={root.name} scopeKey={`${key}:${root.id}`} accountTransport={cardTransport}
                    description="Folder access granted · configure a sync connection below"
                    path={root.sourceKind === 'photos' ? root.name : supportsNativeSourcePaths(host?.capabilities ?? getNativeBridge()) && validNativeSourcePath(root.sourcePath) && root.sourceKind !== 'photos' ? root.sourcePath : 'Folder path unavailable'}
                    stats={checked[root.id] || 'Not checked'}>
                <Flex gap={2} align="center" wrap="wrap">
					<Box flex="1" minWidth="140px" overflowWrap="anywhere">
						<Text fontSize="13px">{root.name}</Text>
						{checked[root.id] ? (
							<Text fontSize="12px" color="var(--tt-muted, #71717a)">
								{checked[root.id]}
							</Text>
						) : null}
					</Box>
					<Flex gap={2}>
						<Button size="xs" minHeight="40px" variant="outline" isDisabled={busy || transferring} onClick={() => void run({ action: 'scan', rootId: root.id })}>
							Check folder
						</Button>
						<Button size="xs" minHeight="40px" variant="ghost" isDisabled={busy || transferring} onClick={() => void run({ action: 'remove', rootId: root.id })}>
							Remove access
						</Button>
					</Flex>
				</Flex></SyncFolderCard>
			))}
			{waiting && !busy && <Text role="status" fontSize="12px" marginTop={2}>Folder access will refresh when Thingtime is active.</Text>}
			{error ? (
				<Text role="alert" color="orange.600" fontSize="12px" marginTop={2}>
					{error}
				</Text>
			) : null}
			<MobileSyncConnections active={active} ownerId={ownerId} deviceId={deviceId} roots={roots} rootsReady={rootsReady} host={host} />
		</Box>
	);
}
