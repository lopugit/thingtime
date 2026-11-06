import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { NativeScanSkip, NativeSkippedPage } from '~/fileSync/nativeInventory';

const text = (id: string, tag: string, content: string, props: Record<string, unknown> = {}): WebpageBlock =>
	({ id, type: 'element', tag, text: content, props, css: { 'overflow-wrap': 'anywhere', 'min-width': '0' } });
const button = (id: string, label: string, operation: string, disabled: string): WebpageBlock => ({
	...text(id, 'button', label, { type: 'button', disabled, 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } }),
	css: { 'min-height': '40px', padding: '6px 10px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px' }
});
export const backupCoverageBlocks: WebpageBlock[] = [{ id: 'backup-coverage', type: 'element', tag: 'section',
	props: { 'aria-label': 'Backup coverage' }, css: { 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px' }, children: [
		text('backup-coverage-title', 'h3', 'Backup coverage'),
		text('backup-coverage-status', 'p', '{coverage.status}', { role: 'status' }),
		text('backup-coverage-help', 'p', 'This backup observes each file separately, so files can come from different moments. Skipped items are not saved by this run. Existing cloud copies are kept; future checks retry eligible items.'),
		text('backup-coverage-error', 'p', '{coverage.error}', { role: 'alert' }),
		text('backup-coverage-range', 'p', '{coverage.range}'),
		{ id: 'backup-skips', type: 'collection', props: { itemsPath: 'coverage.rows', label: 'Skipped items', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: 'No skipped items on this page.' }, children: [
			{ id: 'backup-skip-row', type: 'container', direction: 'column', gap: 4, css: { padding: '8px 0', 'min-width': '0', 'border-bottom': '1px solid var(--tt-border, #ddd)' }, children: [
				text('backup-skip-path', 'p', '{item.path}'), text('backup-skip-reason', 'p', '{item.reason}'), text('backup-skip-scope', 'p', '{item.scope}')
			] }
		] },
		{ id: 'backup-coverage-controls', type: 'container', direction: 'row', gap: 8, css: { 'flex-wrap': 'wrap' }, children: [
			button('backup-coverage-refresh', 'Refresh coverage', 'refresh', '{coverage.busy}'),
			button('backup-coverage-first', 'First skipped items', 'first', '{coverage.firstDisabled}'),
			button('backup-coverage-next', 'Next skipped items', 'next', '{coverage.nextDisabled}')
		] }
	] }];
const reasons: Record<NativeScanSkip['reason'], string> = {
	symlink: 'Symbolic link — target not followed', special: 'Unsupported filesystem entry', fifo: 'Named pipe — live stream not read',
	socket: 'Socket — live process state not read', device: 'Device entry — device not opened', unreadable: 'Unreadable', changed: 'Changed during indexing',
	'invalid-path': 'Filename cannot yet be represented safely', 'duplicate-identity': 'Shared file identity requires hard-link support', 'path-collision': 'Filename collision requires review'
};
export function backupCoverageDisplay(page: NativeSkippedPage | null | undefined, busy: boolean, error = '') {
	return { coverage: {
		status: page ? page.capture.coverage === 'partial' ? `Partial backup · ${page.totalSkipped.toLocaleString()} skipped observations. This is not a complete backup.`
			: 'No skipped entries in this file-by-file capture.' : 'Reading saved backup coverage…',
		error, busy, firstDisabled: busy || !page?.offset, nextDisabled: busy || page?.nextOffset == null,
		range: page?.skipped.length ? `Skipped observations ${page.offset + 1}–${page.offset + page.skipped.length} of ${page.totalSkipped.toLocaleString()}` : '',
		rows: (page?.skipped ?? []).map(skip => ({ id: String(skip.ordinal), path: skip.path ?? (skip.scope === 'root' ? 'Selected root folder' : 'Filename unavailable'),
			reason: reasons[skip.reason], scope: skip.scope === 'root' ? 'Whole root may contain unobserved changes' : skip.scope === 'subtree' ? 'Folder and descendants may be missing' : 'This entry was skipped' }))
	} };
}
