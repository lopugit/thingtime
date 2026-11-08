import type { WebpageBlock } from '../Builder/webpageBlocks';
const muted = 'var(--tt-muted, #6b6873)', border = '1px solid var(--tt-border, #e7e5eb)';
const action = (operation: string, inputs: Record<string, unknown> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const text = (id: string, tag: string, content: string, props: Record<string, unknown> = {}): WebpageBlock => ({ id, type: 'element', tag, text: content, props, css: { margin: '0', 'min-width': '0', 'overflow-wrap': 'anywhere', 'line-height': '1.5', 'font-size': tag === 'h2' ? '20px' : tag === 'h3' ? '16px' : '14px', 'font-weight': ['h2', 'h3', 'h4'].includes(tag) ? '600' : '400' } });
const button = (id: string, label: string, operation: string, disabled = '{backup.busy}', inputs: Record<string, unknown> = {}): WebpageBlock => ({ ...text(id, 'button', label, { type: 'button', disabled, ...action(operation, inputs) }), css: { 'min-height': '44px', padding: '7px 12px', border, 'border-radius': '9px', background: 'var(--tt-card, #fff)', color: 'inherit', 'font-size': '13px', cursor: 'pointer' } });
const row = (id: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'element', tag: 'div', css: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap', 'align-items': 'center', 'min-width': '0' }, children });
const card = (id: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'element', tag: 'section', css: { display: 'flex', 'flex-direction': 'column', gap: '8px', padding: '14px', border, 'border-radius': '12px', 'min-width': '0' }, children });
const disclosure = (id: string, summary: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'element', tag: 'details', css: { border, 'border-radius': '12px', padding: '14px', 'min-width': '0' }, children: [text(id + '-summary', 'summary', summary, { style: { cursor: 'pointer', 'min-height': '44px' } }), ...children] });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg, equals: true }, children });
const collection = (id: string, path: string, empty: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'collection', props: { itemsPath: path, label: id, hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty }, children });
/** Ordinary editable intrinsic blocks, including each repeated item field. */
export const backupWorkspaceBlocks: WebpageBlock[] = [{ id: 'backup-workspace', type: 'container', direction: 'column', gap: 3, css: { 'min-width': '0', width: '100%', color: 'var(--tt-text, inherit)' }, children: [
 row('backup-heading', [text('backup-title', 'h2', 'Backups'), button('backup-refresh', 'Refresh', 'refresh')]),
 text('backup-description', 'p', 'Browse saved contents and restore a reviewed selection to Things.'),
 text('backup-status', 'span', '{backup.status}', { role: 'status', 'aria-live': 'polite', style: { display: '{backup.statusDisplay}' } }),
 text('backup-error', 'p', '{backup.error}', { role: 'alert', style: { display: '{backup.errorDisplay}' } }),
 card('backup-readiness', [text('backup-storage', 'p', '{backup.storage}'), text('backup-worker', 'p', '{backup.worker}'), text('backup-scope-note', 'p', '{backup.coverageNote}')]),
 card('backup-create', [text('backup-create-title', 'h3', 'Create independent snapshot'), text('backup-create-note', 'p', 'Retain a separate copy in configured backup storage. A saved sync connection is not a snapshot.'),
  text('backup-storage-label', 'p', 'Snapshot storage: {backup.storageLabel}'),
  collection('backup-storage-options', 'backup.storageOptions', '{backup.storageEmpty}', [button('backup-storage-option', '{item.name}', 'storage', '{backup.busy}', { id: '{item.id}' })]), button('backup-create-snapshot', 'Create snapshot', 'snapshot', '{backup.createDisabled}')
 ]),
 disclosure('backup-snapshots', 'Saved snapshots', [
  collection('backup-snapshot-list', 'backup.snapshots', '{backup.snapshotEmpty}', [card('backup-snapshot-row', [
   text('backup-snapshot-name', 'h4', '{item.name}'), text('backup-snapshot-date', 'p', '{item.createdAt}'),
   text('backup-snapshot-integrity', 'p', 'Integrity: {item.integrity}'), text('backup-snapshot-coverage', 'p', 'Coverage: {item.coverage}'),
   text('backup-snapshot-description', 'p', '{item.description}'), button('backup-snapshot-open', 'Browse contents', 'browse', '{backup.busy}', { id: '{item.id}' })
  ])]), button('backup-snapshots-next', 'More snapshots', 'next-snapshots', '{backup.snapshotsNextDisabled}')
 ]),
 when('backup-contents-visible', 'backup.hasSnapshot', [card('backup-contents', [text('backup-contents-title', 'h3', '{backup.contentsTitle}'), text('backup-path-help', 'p', 'Choose one file, data item or folder graph. A folder includes its supported descendants and dependencies; unsupported families stay excluded.'),
  collection('backup-entry-list', 'backup.entries', 'No saved entries on this page.', [card('backup-entry-row', [
   row('backup-entry-choice', [{ id: 'backup-entry-check', type: 'element', tag: 'input', props: { type: 'checkbox', checked: '{item.selected}', disabled: '{item.disabled}', 'aria-label': 'Select {item.path}', ...action('select', { id: '{item.id}' }) }, css: { width: '18px', height: '18px', 'flex-shrink': '0' } }, text('backup-entry-path', 'p', '{item.path}')]),
   text('backup-entry-kind', 'p', '{item.kind}'), text('backup-entry-bytes', 'p', '{item.size}'), text('backup-entry-history', 'p', '{item.history}'), text('backup-entry-reason', 'p', '{item.reason}')
  ])]), row('backup-entry-controls', [button('backup-entry-next', 'More contents', 'next-entries', '{backup.entriesNextDisabled}'), text('backup-selection-count', 'p', '{backup.selectionCount}')]),
  row('backup-destination-controls', [button('backup-choose-destination', 'Choose destination', 'destination'), text('backup-destination-path', 'p', '{backup.destination}')]),
  when('backup-folder-picker-visible', 'backup.picker', [card('backup-folder-picker', [text('backup-folder-title', 'h4', 'Restore destination'), text('backup-folder-path', 'p', '{backup.folderPath}'),
   button('backup-folder-close', 'Close folder picker', 'folder-close'),
   { id: 'backup-folder-shared-browser', type: 'element', tag: 'div', props: { id: '{backup.pickerSlotId}' }, css: { 'min-width': '0', 'max-width': '100%' } },
   button('backup-folder-confirm', 'Restore into this folder', 'folder-confirm', '{backup.folderConfirmDisabled}')
  ]) ]),
  text('backup-review-status', 'p', '{backup.reviewStatus}'),
  button('backup-review', 'Review restore', 'review', '{backup.reviewDisabled}')
 ]) ]),
 when('backup-review-visible', 'backup.hasReview', [card('backup-review-card', [text('backup-review-title', 'h3', 'Review restore'), text('backup-review-summary', 'p', '{backup.review.summary}'), text('backup-review-destination', 'p', '{backup.review.destination}'),
  text('backup-review-coverage', 'p', '{backup.review.coverage}'), text('backup-review-history', 'p', '{backup.review.history}'),
  { id: 'backup-review-advanced', type: 'element', tag: 'details', children: [text('backup-review-advanced-title', 'summary', 'Details & limitations'), text('backup-review-id', 'p', 'Review: {backup.review.id}'), text('backup-review-snapshot-id', 'p', 'Snapshot: {backup.review.snapshotId}'), text('backup-review-root-id', 'p', 'Source root: {backup.review.sourceRootId}'), text('backup-review-hash', 'p', 'Integrity reference: {backup.review.hash}'),
   collection('backup-review-limits', 'backup.review.limitations', 'No additional limitations reported.', [text('backup-review-limit', 'p', '{item.label}')])
  ], css: { color: muted, 'font-size': '13px', 'overflow-wrap': 'anywhere' } },
  row('backup-review-actions', [button('backup-execute', 'Restore selection', 'execute', '{backup.executeDisabled}'), button('backup-review-close', 'Close review', 'close-review')])
 ]) ]),
 disclosure('backup-jobs', 'Backup & restore activity', [ text('backup-jobs-help', 'p', 'Accepted jobs run independently of this view. Refresh to check saved progress.'),
  collection('backup-job-list', 'backup.jobs', '{backup.jobsEmpty}', [card('backup-job-row', [text('backup-job-name', 'h4', '{item.name}'), text('backup-job-phase', 'p', '{item.phase} · {item.status}'), text('backup-job-progress', 'p', '{item.progress}'), text('backup-job-detail', 'p', '{item.detail}'),
   row('backup-job-actions', [button('backup-job-pause', 'Pause', 'pause', '{item.pauseDisabled}', { id: '{item.id}' }), button('backup-job-resume', 'Resume', 'resume', '{item.resumeDisabled}', { id: '{item.id}' }), button('backup-job-retry', 'Retry', 'retry', '{item.retryDisabled}', { id: '{item.id}' }), button('backup-job-cancel', 'Cancel job', 'cancel', '{item.cancelDisabled}', { id: '{item.id}' }), button('backup-job-review', 'Open saved review', 'open-review', '{item.reviewDisabled}', { id: '{item.id}' })])
  ])]), button('backup-jobs-next', 'More activity', 'next-jobs', '{backup.jobsNextDisabled}')
 ])
]}];

/** Add one editable disclosure around an account's existing authored layout.
 * Nested text/controls and saved customizations remain the same blocks. */
export function backupWorkspaceDisclosureBlocks(blocks: WebpageBlock[]): WebpageBlock[] {
 if (blocks.length === 1 && blocks[0].id === 'backup-workspace-disclosure') return blocks;
 return [disclosure('backup-workspace-disclosure', 'Independent backups', [{ id: 'backup-workspace-disclosure-body', type: 'container', direction: 'column', gap: 3, css: { 'min-width': '0', 'padding-top': '8px' }, children: blocks }])];
}
