import React from 'react';
import { parseBackupCoverageDescriptor, readBackupCoveragePage, type BackupCoverageDescriptor } from '~/fileSync/backupCoverage.client';
import type { NativeSkippedPage } from '~/fileSync/nativeInventory';
import type { SyncScope } from '~/fileSync/reconcile';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { backupCoverageBlocks, backupCoverageDisplay } from './backupCoverageBlocks';

type Props = { scopeKey: string; descriptor: BackupCoverageDescriptor; currentScope(): SyncScope;
	accountTransport?: SettingsDocumentHostProps['accountTransport']; read?: typeof readBackupCoveragePage };
export function BackupCoverageViewer(props: Props) {
	const parsed = React.useMemo(() => {
		try { return parseBackupCoverageDescriptor(props.descriptor); } catch { return null; }
	}, [props.descriptor]);
	return <CoverageSession key={`${props.scopeKey}:${parsed?.inventory.id}:${parsed?.inventory.generation}`} {...props} parsed={parsed} />;
}
function CoverageSession({ scopeKey, parsed, currentScope, accountTransport, read = readBackupCoveragePage }: Props & { parsed: BackupCoverageDescriptor | null }) {
	const [page, setPage] = React.useState<NativeSkippedPage | null>(), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
	const scopeRef = React.useRef(currentScope); scopeRef.current = currentScope;
	const request = React.useRef<AbortController | undefined>(undefined);
	const refresh = React.useCallback(async (offset = 0) => {
		request.current?.abort(); const controller = new AbortController(); request.current = controller;
		setBusy(true); setError('');
		try {
			if (!parsed) throw Error('Invalid saved backup coverage reference.');
			const value = await read(parsed, () => scopeRef.current(), offset, controller.signal);
			if (!controller.signal.aborted) setPage(value);
		} catch {
			if (!controller.signal.aborted) setError('Coverage is not yet available. Refresh after indexing, or resume the connection to recover saved work.');
		} finally { if (request.current === controller && !controller.signal.aborted) setBusy(false); }
	}, [parsed, read]);
	React.useEffect(() => { void refresh(); return () => request.current?.abort(); }, [refresh]);
	// Strict captures do not carry the additional partial-backup contract.
	if (page === null && !error) return null;
	return <SettingsDocumentHost documentKey="file-sync-backup-coverage" defaultDocument={backupCoverageBlocks} scopeKey={scopeKey} title="Backup coverage" accountTransport={accountTransport}>
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={backupCoverageDisplay(page, busy, error)} enabled={!editing}
			actions={{ refresh: () => refresh(page?.offset ?? 0), first: () => { if (!busy) return refresh(); }, next: () => { if (!busy && page?.nextOffset != null) return refresh(page.nextOffset); } }}>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}
