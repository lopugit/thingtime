import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { requestMobileFolders, supportsMobileFolders, type FolderRequest, type MobileFolder } from '~/fileSync/mobileFolders.client';
import type { FolderHost } from '~/fileSync/desktopFolders.client';
import { MobileSyncConnections } from './MobileSyncConnections';
const cached = new Map<string, MobileFolder[]>();
type FolderAccessProps = { ownerId: string; deviceId: string; host?: FolderHost };
export function MobileFolderAccess({ ownerId, deviceId, host }: FolderAccessProps) {
	if (!host && !supportsMobileFolders()) return null;
	return (
		<FolderAccess
			key={JSON.stringify([host?.origin() ?? window.location.origin, ownerId, deviceId])}
			ownerId={ownerId}
			deviceId={deviceId}
			host={host}
		/>
	);
}
function FolderAccess({ ownerId, deviceId, host }: FolderAccessProps) {
	const key = JSON.stringify([host?.origin() ?? window.location.origin, ownerId, deviceId]);
	const requestFolders = host?.request ?? requestMobileFolders;
	const [roots, setRoots] = useState<MobileFolder[]>(() => cached.get(key) ?? []),
		[busy, setBusy] = useState(false),
		[error, setError] = useState('');
	const [checked, setChecked] = useState<Record<string, string>>({});
	const pending = useRef<AbortController | null>(null);
	const run = useCallback(
		async (request: FolderRequest) => {
			if (pending.current) return;
			const controller = new AbortController();
			pending.current = controller;
			setBusy(true);
			setError('');
			try {
				const result = await requestFolders(ownerId, request, controller.signal);
				if (controller.signal.aborted) return;
				setRoots(result.roots);
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
		void run({ action: 'list' });
		return () => {
			const controller = pending.current;
			pending.current = null;
			controller?.abort();
		};
	}, [run]);
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
				<Button size="sm" minHeight="40px" variant="outline" isDisabled={busy} onClick={() => void run({ action: 'choose' })}>
					Choose folder
				</Button>
			</Flex>
			{roots.map((root) => (
				<Flex key={root.id} marginTop={3} gap={2} align="center" wrap="wrap">
					<Box flex="1" minWidth="140px" overflowWrap="anywhere">
						<Text fontSize="13px">{root.name}</Text>
						{checked[root.id] ? (
							<Text fontSize="12px" color="var(--tt-muted, #71717a)">
								{checked[root.id]}
							</Text>
						) : null}
					</Box>
					<Flex gap={2}>
						<Button size="xs" minHeight="40px" variant="outline" isDisabled={busy} onClick={() => void run({ action: 'scan', rootId: root.id })}>
							Check folder
						</Button>
						<Button size="xs" minHeight="40px" variant="ghost" isDisabled={busy} onClick={() => void run({ action: 'remove', rootId: root.id })}>
							Remove access
						</Button>
					</Flex>
				</Flex>
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
			<MobileSyncConnections ownerId={ownerId} deviceId={deviceId} roots={roots} host={host} />
		</Box>
	);
}
