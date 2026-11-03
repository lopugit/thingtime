import { supportsNativeSourcePaths, validNativeSourcePath } from '~/fileSync/mobileFolders.client';
import { nativeSyncTasks } from '~/fileSync/nativeSyncTasks.client';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { requestMobileFolders, supportsMobileFolders, type FolderRequest, type MobileFolder } from '~/fileSync/mobileFolders.client';
import type { FolderHost } from '~/fileSync/desktopFolders.client';
import { getNativeBridge } from '~/utils/nativeBridge';
import { SyncFolderCard } from './SyncFolderCard';
import { MobileSyncConnections } from './MobileSyncConnections';
const cached = new Map<string, MobileFolder[]>();
type FolderAccessProps = { ownerId: string; deviceId: string; host?: FolderHost; active?: boolean };
export function MobileFolderAccess({ ownerId, deviceId, host, active = true }: FolderAccessProps) {
	if (!host && !supportsMobileFolders()) return null;
	return (
		<FolderAccess
			key={JSON.stringify([host?.origin() ?? window.location.origin, ownerId, deviceId])}
			ownerId={ownerId}
			deviceId={deviceId}
			active={active}
			host={host}
		/>
	);
}
function FolderAccess({ ownerId, deviceId, host, active = true }: FolderAccessProps) {
	const key = JSON.stringify([host?.origin() ?? window.location.origin, ownerId, deviceId]);
	const requestFolders = host?.request ?? requestMobileFolders;
	const cardTransport = React.useMemo(() => host ? { origin: host.origin(), fetch: host.fetch, currentOrigin: host.origin } : undefined, [host]);
	const [roots, setRoots] = useState<MobileFolder[]>(() => cached.get(key) ?? []),
		[busy, setBusy] = useState(false),
		[error, setError] = useState('');
	const [rootsReady, setRootsReady] = useState(() => cached.has(key));
	const [checked, setChecked] = useState<Record<string, string>>({});
	const pending = useRef<AbortController | null>(null);
	const task = useSyncExternalStore(nativeSyncTasks.subscribe, nativeSyncTasks.read, nativeSyncTasks.read);
	const transferring = !!task?.active;
	const run = useCallback(
		async (request: FolderRequest) => {
			if (pending.current || nativeSyncTasks.read()?.active || (getNativeBridge()?.platform === 'ios' && document.visibilityState === 'hidden')) return;
			const controller = new AbortController();
			pending.current = controller;
			setBusy(true);
			setError('');
			try {
				const result = await requestFolders(ownerId, request, controller.signal);
				if (controller.signal.aborted) return;
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
				if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Folder access failed. Try again.');
			} finally {
				if (pending.current === controller) {
					pending.current = null;
					if (!controller.signal.aborted) setBusy(false);
				}
			}
		},
		[ownerId, key, requestFolders]
	);
	useEffect(() => {
		setBusy(false);
		if (!transferring) void run({ action: 'list' });
		return () => {
			const controller = pending.current;
			pending.current = null;
			controller?.abort();
		};
	}, [run, transferring]);
	return (
		<Box borderTop="1px solid var(--tt-border, #ececef)" marginTop={3} paddingTop={3}>
			<Flex align="center" justify="space-between" gap={2} wrap="wrap">
				<Box flex="1" minWidth={{ base: '100%', sm: '180px' }}>
					<Text fontSize="13px" fontWeight={700}>
						Folder access
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
                    path={supportsNativeSourcePaths(host?.capabilities ?? getNativeBridge()) && validNativeSourcePath(root.sourcePath) && root.sourceKind !== 'photos' ? root.sourcePath : 'Folder path unavailable'}
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
			{busy ? (
				<Text fontSize="12px" marginTop={2}>
					Checking folder access…
				</Text>
			) : null}
			{error ? (
				<Text role="alert" color="orange.600" fontSize="12px" marginTop={2}>
					{error}
				</Text>
			) : null}
			<MobileSyncConnections active={active} ownerId={ownerId} deviceId={deviceId} roots={roots} rootsReady={rootsReady} host={host} />
		</Box>
	);
}
