import { parseSyncResourceStatus } from '~/fileSync/resourceGovernor';
import { parsePriorityReadiness } from '~/fileSync/priorityReadiness';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { ForegroundSyncProgress } from '~/fileSync/foregroundSync';
import { syncProgressMetrics, type SyncProgressPage, type SyncProgressState, type SyncProgressTotals } from '~/fileSync/progressProjection';

const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}, css: Record<string, string> = {}): WebpageBlock =>
	({ id, type: 'element', tag, text, props, css });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg, equals: true }, children });
const button = (id: string, text: string, operation: string, inputs: Record<string, unknown> = {}, props: Record<string, unknown> = {}): WebpageBlock =>
	element(id, 'button', text, { type: 'button', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs }, ...props },
		{ 'min-height': '40px', padding: '6px 10px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'max-width': '100%' });

/** Every label, count, progress bar, control and repeated row field remains
 * an ordinary selectable Builder block. The document stores no runtime paths. */
export const syncProgressBlocks: WebpageBlock[] = [{ id: 'sync-progress', type: 'element', tag: 'section',
	props: { 'aria-label': 'File sync progress' }, css: { 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', 'overflow-wrap': 'anywhere' }, children: [
		element('sync-progress-title', 'h3', 'Sync progress', {}, { 'font-weight': '600' }),
		element('sync-index-title', 'h4', '1. Index file structure', {}, { 'font-weight': '600', 'margin-top': '8px' }),
		element('sync-index-description', 'p', '{sync.indexDescription}', { 'aria-live': 'polite' }),
		element('sync-upload-title', 'h4', '{sync.transferTitle}', {}, { 'font-weight': '600', 'margin-top': '12px' }),
		element('sync-upload-description', 'p', '{sync.uploadDescription}', { 'aria-live': 'polite' }),
		element('sync-progress-current', 'p', '{sync.current}', {}, { 'font-size': '12px', 'overflow-wrap': 'anywhere' }),
		element('sync-progress-help', 'p', 'Folder totals include their children. Bytes count file copies only; unchanged and excluded items are shown separately.', {}, { 'font-size': '12px', color: 'var(--tt-muted, #71717a)' }),
		when('sync-progress-error-state', 'sync.hasError', [element('sync-progress-error', 'p', '{sync.error}', { role: 'alert' })]),
		button('sync-progress-refresh', '{sync.refreshLabel}', 'refresh', {}, { disabled: '{sync.busy}' }),
		element('sync-folder-heading', 'h4', '{sync.currentFolder}', {}, { 'font-weight': '600', 'margin-top': '12px', 'overflow-wrap': 'anywhere' }),
		element('sync-folder-summary', 'p', '{sync.folderSummary}', {}, { 'font-size': '12px' }),
		{ id: 'sync-folder-navigation', type: 'container', direction: 'row', gap: 8, css: { 'flex-wrap': 'wrap' }, children: [
			button('sync-folder-root', 'Root folder', 'root', {}, { disabled: '{sync.atRoot}' }),
			button('sync-folder-up', 'Parent folder', 'up', {}, { disabled: '{sync.atRoot}' })
		] },
		{ id: 'sync-progress-rows', type: 'collection', props: { itemsPath: 'sync.rows', label: 'File structure', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: 'The indexed hierarchy will appear here.' }, children: [
			{ id: 'sync-progress-row', type: 'element', tag: 'div', css: { 'min-width': '0', padding: '8px 0', 'border-bottom': '1px solid var(--tt-border, #eee)' }, children: [
				when('sync-node-state', 'item.node', [
					{ id: 'sync-node-heading', type: 'container', direction: 'row', gap: 6, css: { 'align-items': 'center', 'min-width': '0', 'flex-wrap': 'wrap' }, children: [
						element('sync-node-indent', 'span', '{item.indent}', { 'aria-hidden': true }, { 'white-space': 'pre', 'font-family': 'monospace', 'font-size': '12px' }),
						when('sync-folder-control-state', 'item.folder', [button('sync-folder-toggle', '{item.toggle}', 'toggle', { path: '{item.path}' }, { 'aria-label': '{item.toggleLabel}', 'aria-expanded': '{item.expanded}' })]),
						when('sync-folder-open-state', 'item.folder', [button('sync-folder-open', 'Open folder', 'open', { path: '{item.path}' }, { 'aria-label': 'Open {item.path}' })]),
						element('sync-node-icon', 'span', '{item.icon}', { 'aria-hidden': true }),
						element('sync-node-name', 'span', '{item.name}', {}, { 'font-weight': '600', 'overflow-wrap': 'anywhere', 'min-width': '0' }),
						element('sync-node-status', 'span', '{item.status}', {}, { 'font-size': '12px' }),
						when('sync-priority-enabled', 'sync.prioritiesEnabled', [button('sync-priority-next', 'Upload next', 'prioritize', { path: '{item.path}' }, { 'aria-label': 'Upload {item.path} next', disabled: '{sync.prioritiesDisabled}' })])
					] },
					element('sync-node-path', 'p', '{item.path}', {}, { 'font-size': '11px', 'overflow-wrap': 'anywhere', color: 'var(--tt-muted, #71717a)' }),
					element('sync-node-percent', 'p', '{item.percentLabel}', {}, { 'font-size': '12px' }),
					when('sync-node-bar-state', 'item.showPercent', [{ ...element('sync-node-bar', 'div', '', { role: 'progressbar', 'aria-valuenow': { ttArg: 'item.percent' }, 'aria-valuemin': 0, 'aria-valuemax': 100,
						'aria-label': 'Transfer progress for {item.path}' }, { width: '100%', height: '8px', background: '#e4e4e7', 'border-radius': '4px', overflow: 'hidden' }),
						children: [element('sync-node-bar-fill', 'div', '', { 'aria-hidden': true, style: { width: '{item.percent}%' } }, { height: '100%', background: '#71717a' })] }]),
					element('sync-node-counts', 'p', '{item.counts}', {}, { 'font-size': '12px' }),
					element('sync-node-bytes', 'p', '{item.bytes}', {}, { 'font-size': '12px' })
				]),
				when('sync-pager-state', 'item.pager', [
					element('sync-page-label', 'p', '{item.pageLabel}', {}, { 'font-size': '12px', 'overflow-wrap': 'anywhere' }),
					{ id: 'sync-page-buttons', type: 'container', direction: 'row', gap: 8, css: { 'flex-wrap': 'wrap' }, children: [
						button('sync-page-previous', 'Previous items', 'previous', { parent: '{item.parent}' }, { disabled: '{item.previousDisabled}' }),
						button('sync-page-next', 'Next items', 'next', { parent: '{item.parent}' }, { disabled: '{item.nextDisabled}' })
					] }
				]),
				when('sync-branch-error-state', 'item.hasError', [element('sync-branch-error', 'p', '{item.error}', { role: 'alert' })])
			] }
		] }
	] }];

export type SyncProgressBranch = { page?: SyncProgressPage; history: (string | null)[]; busy: boolean; error?: string };
export const progressBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes.toLocaleString()} B`;
	const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB']; let value = bytes / 1024, index = 0;
	while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[index]}`;
};
export function syncProgressNodeDisplay(value: SyncProgressTotals, progress: ForegroundSyncProgress | undefined, state: SyncProgressState) {
	const result = syncProgressMetrics(value, progress, state);
	const folders = value.kind === 'folder' && value.path ? Math.max(0, value.folders - 1) : value.folders;
	return { percent: result.percent ?? 0, showPercent: result.percent !== null, status: result.status === 'Uploading' && progress?.direction === 'download' ? 'Downloading' : result.status,
		percentLabel: result.percent === null ? 'Excluded from this sync' : `${result.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% · ${value.confirmed.toLocaleString()} / ${value.operations.toLocaleString()} operations confirmed`,
		counts: `${value.files.toLocaleString()} files · ${folders.toLocaleString()} ${value.kind === 'folder' && value.path ? 'subfolders' : 'folders'} · ${value.unchanged.toLocaleString()} unchanged · ${value.excluded.toLocaleString()} excluded`,
		bytes: `${progressBytes(result.bytes)} / ${progressBytes(value.bytesTotal)} to copy · ${value.confirmedFiles.toLocaleString()} / ${value.transferFiles.toLocaleString()} files confirmed · ${progressBytes(value.indexedBytes)} indexed` };
}
export function syncProgressDisplay(branches: Record<string, SyncProgressBranch>, progress: ForegroundSyncProgress | undefined, state: SyncProgressState, hasIndex: boolean, message = '', focusedFolder = '', prioritiesEnabled = false, prioritiesDisabled = false) {
	const rows: Record<string, unknown>[] = [];
	const append = (parent: string, depth: number) => {
		const branch = branches[parent]; if (!branch) return;
		for (const node of branch.page?.rows || []) {
			const expanded = !!branches[node.path];
			rows.push({ id: node.path, node: true, path: node.path, name: node.path.split('/').at(-1), folder: node.kind === 'folder', icon: node.kind === 'folder' ? '▱' : '·',
				indent: '│ '.repeat(Math.min(depth, 8)), expanded, toggle: expanded ? '−' : '+', toggleLabel: `${expanded ? 'Collapse' : 'Expand'} ${node.path}`, ...syncProgressNodeDisplay(node, progress, state) });
			if (expanded) append(node.path, depth + 1);
		}
		rows.push({ id: `page:${parent}`, pager: true, parent, pageLabel: `${parent || 'Root folder'}${branch.busy ? ' · Refreshing…' : ''}${branch.page?.rows.length === 0 ? ' · No child items' : ''}`,
			previousDisabled: branch.busy || branch.history.length === 0, nextDisabled: branch.busy || !branch.page?.next, hasError: !!branch.error, error: branch.error || '' });
	};
	append(focusedFolder, 0);
	const root = branches[''], summary = root?.page?.parent, busy = Object.values(branches).some(branch => branch.busy);
	const focused = branches[focusedFolder]?.page?.parent;
	const focusDisplay = focused ? syncProgressNodeDisplay(focused, progress, state) : null;
	const liveIndex = progress?.indexState === 'indexing' || progress?.indexState === 'watching';
	const growingTotal = liveIndex || progress?.totalFinal === false;
	const stoppedIndex = (liveIndex || !hasIndex) && ['error', 'paused', 'cancelled'].includes(state);
	const download = progress?.direction === 'download';
	const preparation = progress?.preparation;
	const preparationLabels: Record<NonNullable<ForegroundSyncProgress['preparation']>['phase'], string> = {
		'validate-local': 'Validating device structure', 'read-remote': 'Reading cloud structure', 'validate-remote': 'Validating cloud structure',
		'index-plan': 'Checking changed folders', plan: 'Planning changes', review: 'Checking conflicts', operations: 'Preparing file operations', cloud: 'Preparing cloud destinations'
	};
	const preparationText = preparation ? `${preparationLabels[preparation.phase]}${preparation.completed === undefined ? '…' :
		` · ${preparation.completed.toLocaleString()}${preparation.total === undefined ? ' items processed' : ` / ${preparation.total.toLocaleString()} items processed`}.`}` : '';
	const indexed = stoppedIndex ? `Indexing ${state === 'error' ? 'stopped' : state} before completion.${progress?.indexed !== undefined ? ` ${progress.indexed.toLocaleString()} entries observed.` : ''}`
		: liveIndex ? `${progress?.indexState === 'watching' ? 'Initial scan finished. Watching for new and changed files.' : 'Indexing while files transfer. Total still being discovered.'}${progress?.indexed === undefined ? '' : ` ${progress.indexed.toLocaleString()} index observations saved.`}`
		: progress?.indexState === 'complete' && progress.totalFinal === false ? 'Initial scan finished. Preparing remaining indexed entries while files transfer.'
		: hasIndex ? summary ? `${summary.files.toLocaleString()} files and ${summary.folders.toLocaleString()} folders indexed.` : 'Structure indexed. Reading saved totals…'
		: progress?.indexed !== undefined ? `${progress.indexed.toLocaleString()} entries indexed${progress.indexTotal === undefined ? ' · Total still being discovered.' : ` of ${progress.indexTotal.toLocaleString()}.${preparation ? '' : ' Validating structure…'}`}`
		: preparation ? 'Preparing saved index.'
		: progress?.stage === 'checking' ? 'Checking access…' : 'Indexing files… Total still being discovered.';
	const coverage = progress?.coverage === 'partial' ? ` Partial backup · ${(progress.skipped ?? 0).toLocaleString()} skipped observations. Review backup coverage below.` : '';
	const globalState = state === 'error' ? 'Error' : state === 'cancelled' ? 'Cancelled' : state === 'paused' ? 'Paused' : progress?.stage === 'complete' || state === 'complete' ? progress?.coverage === 'partial' ? 'Supported items complete · Partial backup' : 'Complete'
		: preparation ? `Preparing ${download ? 'download' : 'upload'}` : progress?.stage === 'verifying' ? `Verifying ${download ? 'downloaded' : 'uploaded'} files`
		: progress?.indexState === 'watching' && progress.confirmed === progress.total && !progress.path ? 'Waiting for new indexed files'
		: progress?.stage === 'transferring' || hasIndex ? download ? 'Downloading' : 'Uploading' : 'Waiting for the first indexed file';
	return { sync: { ...priorityReadinessDisplay(progress, state), prioritiesEnabled, prioritiesDisabled, transferTitle: `2. ${download ? 'Download' : 'Upload'} files and folders`, indexDescription: indexed + (!stoppedIndex && preparationText ? ` ${preparationText}` : '') + coverage, uploadDescription: `${globalState}${progress ? ` · ${progress.confirmed.toLocaleString()} / ${progress.total.toLocaleString()} operations confirmed${growingTotal ? ' so far · Total may grow' : ''}` : ''}${summary ? ` · ${syncProgressNodeDisplay(summary, progress, state).bytes}` : ''}`,
		currentFolder: focusedFolder || 'Root folder', atRoot: !focusedFolder,
		folderSummary: focusDisplay ? `${focusDisplay.percentLabel} · ${focusDisplay.counts} · ${focusDisplay.bytes}${growingTotal ? ' · Based on files prepared so far' : ''}` : hasIndex ? 'Reading folder totals…' : 'Folder totals become available as files are indexed.',
		current: progress?.path ? `Current file: ${progress.path}${progress.bytes !== undefined && progress.size !== undefined ? ` · ${progressBytes(progress.bytes)} / ${progressBytes(progress.size)}` : ''}` : message,
		hasError: !!root?.error, error: root?.error || '', busy, refreshLabel: busy ? 'Refreshing progress…' : 'Refresh progress', rows } };
}

/** Separate editable layout keeps diagnostics visible without replacing any
 * previously saved custom file-progress document. Runtime data stays in progress. */
export const priorityReadinessBlocks: WebpageBlock[] = [{ id: 'sync-priority-readiness', type: 'element', tag: 'section',
 props: { 'aria-label': 'Upload priority readiness' }, css: { 'min-width': '0', 'margin-top': '12px', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', 'overflow-wrap': 'anywhere' }, children: [
 element('sync-priority-readiness-title', 'h4', 'Upload priority readiness', {}, { 'font-weight': '600' }),
 element('sync-priority-readiness-gate', 'p', '{sync.priorityGate}', {}, { 'font-size': '12px' }),
 element('sync-priority-readiness-proof', 'p', '{sync.priorityProof}', {}, { 'font-size': '12px' }),
 element('sync-priority-readiness-candidate', 'p', '{sync.priorityCandidate}', {}, { 'font-size': '12px' }),
 element('sync-priority-readiness-status', 'p', '{sync.priorityStatus}', { role: 'status' }, { 'font-size': '12px' })
]}];
export function priorityReadinessDisplay(progress: ForegroundSyncProgress | undefined, state: SyncProgressState) {
	const readiness = parsePriorityReadiness(progress?.priorityReadiness);
	const savedObservation = state !== 'running' ? 'Saved observation · ' : '';
	const readinessStatus = !readiness ? '' : readiness.gate === 'unsupported'
		? 'Preparing unplanned priorities requires a supported trusted native adapter. Existing prepared operations keep their normal scheduler.'
		: !readiness.measured ? 'Waiting for the scheduler to check priority readiness. No completion is inferred.'
		: readiness.blocker === 'proof-pending' ? 'Priority preparation is waiting for legacy index validation to reach the candidate.'
		: readiness.blocker === 'not-indexed' ? 'The last check found no eligible unprepared input. It may not be indexed yet or may already be processed; this does not prove backup completion.'
		: readiness.blocker === 'reserved-or-in-flight' ? 'A prepared or active operation must finish safely before another priority revision can run.'
		: readiness.blocker === 'ready' ? 'The last checked priority candidate is ready for preparation.'
		: readiness.preferencesCount === 0 ? 'No upload priorities are saved for this connection.' : 'No candidate was selected by the last scheduling check.';
	const reservationLabels = { none: 'none', operation: 'individual original operation', 'file-batch': 'file batch', 'folder-batch': 'folder batch', 'file-recovery': 'original file-batch recovery', 'folder-recovery': 'original folder-batch recovery' };
	const folderGateLabels = { enabled: 'negotiated and enabled', 'not-negotiated': 'not negotiated by this adapter/server', 'custom-policy': 'disabled by the custom mutation policy' };
	const folderGate = readiness?.folderBatchGate ? folderGateLabels[readiness.folderBatchGate] : 'UNKNOWN (not measured)';
	const reservation = readiness?.reservationKind === undefined ? 'UNKNOWN (not measured)'
		: `${reservationLabels[readiness.reservationKind]} · ${readiness.reservationRemaining!.toLocaleString()} original operations remaining`;
	const recovery = readiness?.reservationKind?.endsWith('-recovery') ? ' New batches wait for original-operation recovery.' : '';
	const queueStatus = !readiness ? '' : ` Folder batches: ${folderGate}. Journal reservation: ${reservation}.${recovery} These are last observed gates, not uploaded counts.`;
	return { hasPriorityReadiness: !!readiness,
		priorityGate: readiness ? `${savedObservation}Priority preparation ${readiness.gate === 'enabled' ? 'enabled by the trusted native adapter' : 'unsupported by this adapter'} · ${readiness.preferencesCount.toLocaleString()} saved priorities · revision ${readiness.preferencesRevision.toLocaleString()}.` : '',
		priorityProof: readiness ? readiness.proofCursor === null || readiness.proofCutoff === null ? 'Legacy index validation has not been measured.' : `Legacy index validation: ${readiness.proofCursor.toLocaleString()} / ${readiness.proofCutoff.toLocaleString()} fixed observations checked. This is not an upload count.` : '',
		priorityCandidate: readiness ? `Last checked candidate: ${readiness.candidateOrdinal === null ? 'not measured' : `saved priority ${readiness.candidateOrdinal.toLocaleString()}`}${readiness.candidateSequence === null ? '' : ` · input observation ${readiness.candidateSequence.toLocaleString()}`}.${readiness.reserved ? ' An operation is reserved or in flight.' : ''}` : '',
		priorityStatus: savedObservation + readinessStatus + queueStatus,
 };
}

/** Separate saved document so adding resource diagnostics preserves existing
 * customized progress layouts. Each effective field is selectable in Builder. */
export const syncResourceStatusBlocks: WebpageBlock[] = [{ id: 'sync-resource-status', type: 'element', tag: 'section', props: { 'aria-label': 'Effective sync resources' }, css: { 'min-width': '0', 'overflow-wrap': 'anywhere', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px' }, children: [
 element('sync-resource-status-title', 'h4', 'Effective sync resources'),
 element('sync-resource-status-cpu', 'p', '{syncResources.cpu}'),
 element('sync-resource-status-transfers', 'p', '{syncResources.transfers}'),
 element('sync-resource-status-indexing', 'p', '{syncResources.indexing}'),
 element('sync-resource-status-upload', 'p', '{syncResources.upload}'),
 element('sync-resource-status-download', 'p', '{syncResources.download}'),
 element('sync-resource-status-help', 'p', '{syncResources.help}')
]}];
export function syncResourceStatusDisplay(progress: ForegroundSyncProgress | undefined, state: SyncProgressState) {
 let resources: ReturnType<typeof parseSyncResourceStatus> | undefined;
 try { if (progress?.resources) resources = parseSyncResourceStatus(progress.resources); } catch { /* Invalid saved data stays unknown. */ }
 const saved = state !== 'running', prefix = saved ? 'Last reported ' : '';
 const pace = (value?: number) => value === undefined ? 'No reported rate cap' : `${value.toLocaleString(undefined, { maximumSignificantDigits: 6 })} bytes/s cap`;
 return { syncResources: {
  cpu: resources?.cpuStatus === 'measured' ? `${prefix}sync CPU: ${resources.cpuPercent!.toLocaleString(undefined, { maximumFractionDigits: 2 })}% of total CPU capacity.` : 'Sync CPU measurement unavailable; unrelated app or device CPU is not substituted.',
  transfers: resources ? `${prefix}effective simultaneous file/folder transfers: ${resources.effectiveTransferConcurrency.toLocaleString()}.` : 'Effective transfer concurrency unavailable.',
  indexing: resources ? `${prefix}effective indexing workers: ${resources.effectiveIndexingConcurrency.toLocaleString()}.` : 'Effective indexing concurrency unavailable.',
  upload: `${prefix}upload pace: ${pace(resources?.uploadBytesPerSecond)}.`,
  download: `${prefix}download pace: ${pace(resources?.downloadBytesPerSecond)}.`,
  help: resources ? `${saved ? 'Saved observation; this is not a current CPU measurement. ' : ''}Effective ceilings may be lower than your settings because of hardware, safety or CPU backpressure. Pace caps are ceilings, not measured throughput.` : 'No effective resource observation has been reported for this run.'
 } };
}
