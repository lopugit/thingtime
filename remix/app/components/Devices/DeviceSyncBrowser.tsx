import React from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { deviceSyncOverviewBlocks } from './deviceSyncBlocks';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { SettingsSection } from '../Settings/SettingsSection';
import { DesktopFolderAccess } from './DesktopFolderAccess';
import { deviceSyncPageHref } from './deviceNavigation';
import { deviceSyncFolders, deviceSyncedFilesHref, type DeviceSyncFolder } from './deviceSyncNavigation';

const cache = new Map<string, DeviceSyncFolder[]>();
export function DeviceSyncBrowser({ deviceId }: { deviceId: string }) {
	const user = useCurrentUser(),
		plane = useDataPlane(),
		api = useApi(),
		apiRef = React.useRef(api);
	apiRef.current = api;
	const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	const ownerId = user?.id || '',
		allowed = !!ownerId && !user?.temporary && user?.accountKind === 'user' && plane === 'home' && !identity.pending;
	const key = JSON.stringify([typeof window === 'undefined' ? 'server' : window.location.origin, ownerId, plane, deviceId, identity.generation]);
	return <DeviceSyncBrowserContent key={key} {...{ deviceId, ownerId, allowed, scopeKey: key, apiRef }} generation={identity.generation} />;
}
function DeviceSyncBrowserContent({
	deviceId,
	ownerId,
	allowed,
	scopeKey,
	apiRef,
	generation
}: {
	deviceId: string;
	ownerId: string;
	allowed: boolean;
	scopeKey: string;
	apiRef: React.MutableRefObject<ReturnType<typeof useApi>>;
	generation: number;
}) {
	const [folders, setFolders] = React.useState(() => (allowed ? cache.get(scopeKey) ?? [] : [])),
		[error, setError] = React.useState(''),
		[loading, setLoading] = React.useState(allowed),
		[refresh, setRefresh] = React.useState(0);
	React.useEffect(() => {
		if (!allowed) return;
		setLoading(true);
		setError('');
		const controller = new AbortController();
		const check = () => {
			controller.signal.throwIfAborted();
			const current = rootIdentity.read();
			if (current.pending || current.generation !== generation) throw Error('The active account changed.');
		};
		void (async () => {
			await requireThingtimeCapability('api.things', '1.36.0');
			check();
			let cursor: string | undefined;
			const seen = new Set<string>(),
				rows: unknown[] = [];
			for (;;) {
				const result = await apiRef.current.v1.things.list(
					{ thingtime: 'file-sync', limit: 50, cursor },
					{ expectedActor: ownerId, expectedDataPlane: 'home', signal: controller.signal }
				);
				check();
				if (!Array.isArray(result.things)) throw Error('Saved sync folders are unavailable.');
				rows.push(...result.things);
				const next = result.nextCursor || undefined;
				if (!next) {
					const value = deviceSyncFolders(rows, ownerId, deviceId);
					cache.set(scopeKey, value);
					if (cache.size > 16) cache.delete(cache.keys().next().value!);
					setFolders(value);
					return;
				}
				if (seen.has(next)) throw Error('The folder list repeated a page. Try reopening this device.');
				seen.add(next);
				cursor = next;
			}
		})()
			.catch((cause) => {
				if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Saved sync folders are unavailable.');
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [allowed, ownerId, deviceId, generation, scopeKey, apiRef, refresh]);
	const status = !allowed
		? 'Sign in to the Home data plane to browse this device’s saved files.'
		: error
		? folders.length
			? 'Showing saved folders; the latest list could not be checked.'
			: 'The saved folder list could not be loaded.'
		: loading
		? folders.length
			? 'Showing saved folders while checking for updates.'
			: 'Reading saved sync folders…'
		: `${folders.length} saved ${folders.length === 1 ? 'folder' : 'folders'}.`;
	return (
		<SettingsDocumentHost
			documentKey="device-sync-overview"
			defaultDocument={deviceSyncOverviewBlocks}
			scopeKey={scopeKey}
			title="Device files overview"
		>
			{({ blocks, chrome, editing }) => (
				<TransientBlockHost
					scopeKey={scopeKey}
					enabled={!editing}
					scope={{
						deviceSync: {
							folders: folders.map((f) => ({
								...f,
								state: f.paused ? 'Saved configuration: paused' : 'Live transfer status: check this device’s sync settings'
							})),
							status,
							error,
							empty: loading || error || !allowed ? 'No verified folder list is available yet.' : 'No saved sync connections for this device yet.',
							settingsHref: deviceSyncPageHref(deviceId),
							filesHref: deviceSyncedFilesHref(deviceId)
						}
					}}
					actions={{
						refresh: () => {
							if (allowed) setRefresh((value) => value + 1);
						}
					}}
				>
					<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
				</TransientBlockHost>
			)}
		</SettingsDocumentHost>
	);
}
export function DeviceSyncPanel({
	deviceId,
	ownerId,
	pairedDeviceIds = [],
	ownedDeviceIds = []
}: {
	deviceId: string;
	ownerId?: string;
	pairedDeviceIds?: readonly string[];
	ownedDeviceIds?: readonly string[];
}) {
	const [managing, setManaging] = React.useState(true);
	return (
		<Box minWidth={0}>
			<DeviceSyncBrowser deviceId={deviceId} />
			{ownerId && pairedDeviceIds.includes(deviceId) && ownedDeviceIds.includes(deviceId) ? (
				<SettingsSection
					eyebrow="Manage sync connections"
					description="Folders, progress, exclusions and resource limits for this device."
					open={managing}
					onToggle={setManaging}
				>
					{managing ? (
						<DesktopFolderAccess ownerId={ownerId} deviceId={deviceId} pairedDeviceIds={pairedDeviceIds} ownedDeviceIds={ownedDeviceIds} />
					) : null}
				</SettingsSection>
			) : null}
		</Box>
	);
}
export function DeviceSyncedFilesPage({ deviceId }: { deviceId: string }) {
	return (
		<Flex
			justify="center"
			minHeight="100vh"
			width="100%"
			background="var(--tt-surface, #fafafb)"
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 24px)"
			paddingBottom={12}
		>
			<Box width="100%" maxWidth="1100px" padding={{ base: 4, md: 6 }} minWidth={0}>
				<DeviceSyncBrowser deviceId={deviceId} />
			</Box>
		</Flex>
	);
}
