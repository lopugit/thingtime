import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { ConflictReviewView } from '~/fileSync/conflictReviewController';
import { conflictCopySides } from '~/fileSync/conflictResolution';
import type { SyncMode, SyncSide } from '~/fileSync/reconcile';

const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}, css: Record<string, string> = {}): WebpageBlock =>
	({ id, type: 'element', tag, text, props, css });
const action = (operation: string, inputs: Record<string, unknown> = {}) =>
	({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const button = (id: string, text: string, operation: string, disabled: string): WebpageBlock => element(id, 'button', text,
	{ type: 'button', disabled, ...action(operation) }, { 'min-height': '40px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px' });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg, equals: true }, children });

/** The saved document contains only authored blocks/bindings. Paths, choices,
 * cursors and journal authority are supplied by the transient host at runtime. */
export const syncConflictReviewBlocks: WebpageBlock[] = [{ id: 'review', type: 'element', tag: 'section',
	props: { role: 'region', 'aria-label': 'Review sync conflicts' },
	css: { width: '100%', 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', 'overflow-wrap': 'anywhere' }, children: [
		element('review-title', 'h3', '{review.title}', {}, { 'font-weight': '600' }),
		element('review-help', 'p', 'Choose the version to use in both folders. No files change until you apply all choices.'),
		element('review-recovery', 'p', 'Choices save on this device as you make them. If interrupted, retry sync to resume. Files and settings are checked again before copying.', {}, { 'font-size': '12px' }),
		element('review-retention', 'p', '{review.retentionMessage}', {}, { color: 'var(--tt-muted, #71717a)', 'font-size': '13px' }),
		when('review-error-state', 'review.hasError', [element('review-error', 'p', '{review.error}', { role: 'alert' }), button('review-reload', 'Reload review', 'reload', '{review.busy}')]),
		{ id: 'review-rows', type: 'collection', props: { itemsPath: 'review.rows', label: 'Conflicts', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: 'Preparing your saved conflict review…' }, children: [
			{ id: 'review-row', type: 'element', tag: 'div', css: { 'min-width': '0', padding: '8px 0' }, children: [
				element('review-path', 'p', '{item.path}', {}, { 'font-weight': '600', 'overflow-wrap': 'anywhere' }),
				element('review-sizes', 'p', 'Device: {item.localDescription} · Cloud: {item.remoteDescription}', {}, { 'font-size': '12px' }),
				when('review-history-state', 'item.hasHistory', [element('review-history', 'button', 'Cloud version history', { type: 'button', disabled: '{review.busy}', ...action('history', { path: '{item.path}', revision: { ttArg: 'item.revision' } }) }, { 'min-height': '40px', 'text-decoration': 'underline' })]),
				when('review-choice-state', 'item.selectable', [{ id: 'review-choice', type: 'element', tag: 'select',
					props: { value: '{item.choice}', 'aria-label': 'Version to keep for {item.path}', disabled: '{review.busy}', ...action('choose', { path: '{item.path}', revision: { ttArg: 'item.revision' } }) },
					css: { 'min-height': '40px', width: '100%', 'max-width': '100%', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px' }, children: [
						element('review-choice-empty', 'option', 'Choose a version', { value: '' }),
						{ id: 'review-choice-options', type: 'collection', props: { itemsPath: 'item.options', transparent: true }, children: [element('review-choice-option', 'option', '{item.label}', { value: '{item.value}' })] }
					] }]),
				when('review-blocked-state', 'item.blocked', [element('review-blocked', 'p', 'Resolve this folder, file-type or direction conflict in the source folders, then retry. Neither copy will be deleted here.')])
			] }
		] },
		{ id: 'review-paging', type: 'container', direction: 'row', gap: 8, css: { 'flex-wrap': 'wrap' }, children: [
			button('review-previous', 'Previous conflicts', 'previous', '{review.previousDisabled}'),
			element('review-range', 'p', '{review.range}', { 'aria-live': 'polite' }),
			button('review-next', 'Next conflicts', 'next', '{review.nextDisabled}')
		] },
		element('review-progress', 'p', '{review.progress}', { 'aria-live': 'polite' }, { 'font-size': '12px' }),
		{ id: 'review-actions', type: 'container', direction: 'row', gap: 8, css: { 'flex-wrap': 'wrap' }, children: [
			button('review-apply', 'Apply choices and sync', 'resolve', '{review.resolveDisabled}'),
			button('review-retain', 'Save versions and ignore', 'retain', '{review.retainDisabled}'),
			button('review-cancel', 'Cancel review', 'cancel', '{review.busy}')
		] },
		element('review-cancel-help', 'p', 'Cancel discards the saved choices for this review. Both folders stay as they are.', {}, { 'font-size': '12px', color: 'var(--tt-muted, #71717a)' })
	] }];

export function syncConflictReviewDisplay(view: ConflictReviewView, mode: SyncMode) {
	const page = view.page, progress = page?.progress, count = progress?.count ?? 0;
	const ready = !!progress && progress.phase === 'reviewing' && count > 0 && !view.closed;
	const unavailable = !ready || view.busy || !!view.error;
	return { review: {
		title: page ? `Review ${count.toLocaleString()} sync conflict${count === 1 ? '' : 's'}` : 'Review sync conflicts',
		busy: view.busy || view.closed, hasError: !!view.error, error: view.error || '',
		retentionMessage: ready && !progress?.retentionBlocked
			? 'Choose “Save versions and ignore” to keep both versions in your private Timeline with IDs built from their contents. After saving, you can download or restore either version later, even while this conflict remains unresolved.'
			: 'Your existing data stays in its current folders. Folder and missing-file conflicts need changes in the source folders before both versions can be saved.',
		range: page ? `${page.start + 1}–${page.start + page.rows.length} of ${count.toLocaleString()}` : 'Loading review',
		progress: `${progress?.selected ?? 0} of ${count} choices ready${progress?.blocked ? ' · Some conflicts need changes in the source folders.' : ''}`,
		previousDisabled: view.busy || view.closed || !page?.previous,
		nextDisabled: view.busy || view.closed || !page?.next,
		resolveDisabled: unavailable || !!progress?.blocked || progress?.selected !== count,
		retainDisabled: unavailable || !!progress?.retentionBlocked,
		rows: (page?.rows || []).map(({ conflict, from, revision }) => {
			const sides = conflictCopySides(conflict, mode);
			const describe = (side: SyncSide) => { const entry = conflict[side]; return !entry ? 'Missing' : entry.kind === 'folder' ? 'Folder' : `${entry.size.toLocaleString()} bytes`; };
			return { id: conflict.path, path: conflict.path, revision, choice: from || '', selectable: sides.length > 0, blocked: !sides.length,
				localDescription: describe('local'), remoteDescription: describe('remote'), hasHistory: conflict.remote?.kind === 'file',
				options: sides.map(value => ({ value, label: value === 'local' ? 'Keep device version' : 'Keep cloud version' })) };
		})
	} };
}
