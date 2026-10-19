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
		element('sync-upload-title', 'h4', '2. Upload files and folders', {}, { 'font-weight': '600', 'margin-top': '12px' }),
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
						element('sync-node-status', 'span', '{item.status}', {}, { 'font-size': '12px' })
					] },
					element('sync-node-path', 'p', '{item.path}', {}, { 'font-size': '11px', 'overflow-wrap': 'anywhere', color: 'var(--tt-muted, #71717a)' }),
					element('sync-node-percent', 'p', '{item.percentLabel}', {}, { 'font-size': '12px' }),
					when('sync-node-bar-state', 'item.showPercent', [{ ...element('sync-node-bar', 'div', '', { role: 'progressbar', 'aria-valuenow': { ttArg: 'item.percent' }, 'aria-valuemin': 0, 'aria-valuemax': 100,
						'aria-label': 'Upload progress for {item.path}' }, { width: '100%', height: '8px', background: '#e4e4e7', 'border-radius': '4px', overflow: 'hidden' }),
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
	return { percent: result.percent ?? 0, showPercent: result.percent !== null, status: result.status,
		percentLabel: result.percent === null ? 'Excluded from this sync' : `${result.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% · ${value.confirmed.toLocaleString()} / ${value.operations.toLocaleString()} operations confirmed`,
		counts: `${value.files.toLocaleString()} files · ${folders.toLocaleString()} ${value.kind === 'folder' && value.path ? 'subfolders' : 'folders'} · ${value.unchanged.toLocaleString()} unchanged · ${value.excluded.toLocaleString()} excluded`,
		bytes: `${progressBytes(result.bytes)} / ${progressBytes(value.bytesTotal)} to copy · ${value.confirmedFiles.toLocaleString()} / ${value.transferFiles.toLocaleString()} files confirmed · ${progressBytes(value.indexedBytes)} indexed` };
}
export function syncProgressDisplay(branches: Record<string, SyncProgressBranch>, progress: ForegroundSyncProgress | undefined, state: SyncProgressState, hasIndex: boolean, message = '', focusedFolder = '') {
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
	const stoppedIndex = !hasIndex && ['error', 'paused', 'cancelled'].includes(state);
	const indexed = stoppedIndex ? `Indexing ${state === 'error' ? 'stopped' : state} before completion.${progress?.indexed !== undefined ? ` ${progress.indexed.toLocaleString()} entries observed.` : ''}` : hasIndex ? summary ? `${summary.files.toLocaleString()} files and ${summary.folders.toLocaleString()} folders indexed.` : 'Structure indexed. Reading saved totals…'
		: progress?.indexed !== undefined ? `${progress.indexed.toLocaleString()} entries indexed${progress.indexTotal === undefined ? ' · Total still being discovered.' : ` of ${progress.indexTotal.toLocaleString()}. Validating structure…`}`
		: progress?.stage === 'checking' ? 'Checking access…' : 'Indexing files… Total still being discovered.';
	const globalState = state === 'error' ? 'Error' : state === 'cancelled' ? 'Cancelled' : state === 'paused' ? 'Paused' : progress?.stage === 'complete' || state === 'complete' ? 'Complete'
		: progress?.stage === 'verifying' ? 'Verifying uploaded files' : hasIndex ? 'Uploading' : 'Waiting for indexed structure';
	return { sync: { indexDescription: indexed, uploadDescription: `${globalState}${progress ? ` · ${progress.confirmed.toLocaleString()} / ${progress.total.toLocaleString()} operations confirmed` : ''}${summary ? ` · ${syncProgressNodeDisplay(summary, progress, state).bytes}` : ''}`,
		currentFolder: focusedFolder || 'Root folder', atRoot: !focusedFolder,
		folderSummary: focusDisplay ? `${focusDisplay.percentLabel} · ${focusDisplay.counts} · ${focusDisplay.bytes}` : 'Reading folder totals…',
		current: progress?.path ? `Current file: ${progress.path}${progress.bytes !== undefined && progress.size !== undefined ? ` · ${progressBytes(progress.bytes)} / ${progressBytes(progress.size)}` : ''}` : message,
		hasError: !!root?.error, error: root?.error || '', busy, refreshLabel: busy ? 'Refreshing progress…' : 'Refresh progress', rows } };
}
