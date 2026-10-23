import React from 'react';
import type { SavedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import type { RemoteSyncClient } from '~/fileSync/remoteSyncClient.client';
import type { RemoteSyncStatus } from '~/fileSync/remoteSyncProtocol';
import type { RemoteSyncDetails as Details } from '~/fileSync/remoteSyncDetails';
import { parseSyncPriorityPreferences } from '~/fileSync/syncPriorityJournal';
import type { SyncScope } from '~/fileSync/reconcile';
import { sameSyncScope, syncScopeKey } from '~/fileSync/reconcile';
import { rootIdentity } from '~/utils/rootIdentity';
import { SyncProgressViewer, type SyncProgressViewerProps } from './SyncProgressViewer';
import { BackupCoverageViewer } from './BackupCoverageViewer';
import type { UploadPriorityOptions } from './SyncUploadPriorities';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';

const metadataBlocks: WebpageBlock[] = [{ id: 'remote-details-metadata', type: 'element', tag: 'section', children: [
	{ id: 'remote-details-error', type: 'element', tag: 'p', text: '{details.error}', props: { role: 'status' } },
	{ id: 'remote-details-refresh', type: 'element', tag: 'button', text: 'Refresh saved progress',
		props: { type: 'button', disabled: '{details.busy}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'refresh' } },
		css: { 'min-height': '44px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px' } }
] }];

/** Shared viewers, with their journal operations executed by the paired app. */
export function RemoteSyncDetails({ saved, scope, generation, status, command }: {
	saved: SavedFileSyncConfiguration; scope: SyncScope; generation: number; status: RemoteSyncStatus | null; command: RemoteSyncClient['send'];
}) {
	const scopeKey = `${syncScopeKey(scope)}:${generation}`;
	return <RemoteDetailsSession key={scopeKey} saved={saved} scope={scope} generation={generation} status={status} command={command} scopeKey={scopeKey} />;
}
function RemoteDetailsSession({ saved, scope, generation, status, command, scopeKey }: {
	saved: SavedFileSyncConfiguration; scope: SyncScope; generation: number; status: RemoteSyncStatus | null; command: RemoteSyncClient['send']; scopeKey: string;
}) {
	const [metadata, setMetadata] = React.useState<Details>({}), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
	const [refresh, setRefresh] = React.useState(0);
	const mounted = React.useRef(true);
	const scopeJson = JSON.stringify(scope);
	const binding = React.useMemo(() => JSON.parse(scopeJson) as SyncScope, [scopeJson]);
	const currentScope = React.useCallback(() => {
		const identity = rootIdentity.read();
		if (!mounted.current || identity.pending || identity.generation !== generation) throw Error('The sync account changed.');
		return binding;
	}, [binding, generation]);
	React.useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	React.useEffect(() => {
		const controller = new AbortController(); setBusy(true); setError('');
		void command<Details>({ action: 'details', connectionId: saved.id }, { signal: controller.signal }).then(value => {
			currentScope();
			if ((value.progressDescriptor && !sameSyncScope(value.progressDescriptor.scope, binding)) ||
				(value.inventoryDescriptor && !sameSyncScope(value.inventoryDescriptor.scope, binding))) throw Error('The device returned progress for another connection.');
			setMetadata(value);
		}).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Saved progress is unavailable.'); })
			.finally(() => { if (!controller.signal.aborted) setBusy(false); });
		return () => controller.abort();
	}, [command, saved.id, binding, currentScope, refresh]);
	const task = status?.deviceId === binding.deviceId && status.task?.connectionId === saved.id ? status.task : null;
	// The current task's missing descriptors mean indexing has not produced them;
	// using a cached previous run here would fabricate current completion.
	const progressDescriptor = task ? task.progressDescriptor : metadata.progressDescriptor;
	const inventoryDescriptor = task ? task.inventoryDescriptor : metadata.inventoryDescriptor;
	const runId = progressDescriptor?.run.id;
	const readPage = React.useMemo<SyncProgressViewerProps['readPage']>(() => runId ? async request => {
		currentScope();
		const value = await command<Awaited<ReturnType<NonNullable<SyncProgressViewerProps['readPage']>>>>({
			action: 'progress', connectionId: saved.id, runId, parent: request.parent, after: request.after
		}, { signal: request.signal });
		currentScope(); return value;
	} : undefined, [runId, currentScope, command, saved.id]);
	const coverageRead = React.useCallback<NonNullable<Parameters<typeof BackupCoverageViewer>[0]['read']>>(async (descriptor, check, offset, signal) => {
		currentScope();
		if (!sameSyncScope(descriptor.scope, check()) || !sameSyncScope(descriptor.scope, binding)) throw Error('The backup scope changed.');
		const page = await command<Awaited<ReturnType<NonNullable<Parameters<typeof BackupCoverageViewer>[0]['read']>>>>({
			action: 'coverage', connectionId: saved.id, inventoryId: descriptor.inventory.id, generation: descriptor.inventory.generation, offset
		}, { signal });
		currentScope(); return page;
	}, [binding, command, currentScope, saved.id]);
	const priorityTransport = React.useMemo<NonNullable<UploadPriorityOptions['transport']>>(() => ({
		read: async signal => { currentScope(); const result = await command({ action: 'priorities', connectionId: saved.id, operation: 'read' }, { signal }); currentScope(); return parseSyncPriorityPreferences(result); },
		save: async (paths, expectedRevision, signal) => { currentScope(); const result = await command({ action: 'priorities', connectionId: saved.id, operation: 'save', paths, expectedRevision }, { signal }); currentScope(); return parseSyncPriorityPreferences(result); }
	}), [command, currentScope, saved.id]);
	return <>
		<SettingsDocumentHost documentKey="file-sync-remote-details" defaultDocument={metadataBlocks} scopeKey={scopeKey} title="Remote saved progress">
			{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} scope={{ details: { error, busy } }} actions={{ refresh: () => { if (!busy) setRefresh(value => value + 1); } }}>
				<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
			</TransientBlockHost>}
		</SettingsDocumentHost>
		<SyncProgressViewer scopeKey={scopeKey} descriptor={progressDescriptor} progress={task?.progress} currentScope={currentScope}
			status={task?.status ?? 'paused'} message={task?.progress.message} readPage={readPage}
			uploadPriorities={saved.configuration.mode === 'download' ? undefined : { scope: binding, excludedPaths: saved.configuration.excludedPaths, ignoreRules: saved.configuration.ignoreRules, transport: priorityTransport }} />
		{inventoryDescriptor ? <BackupCoverageViewer scopeKey={scopeKey} descriptor={inventoryDescriptor} currentScope={currentScope} read={coverageRead} /> : null}
	</>;
}
