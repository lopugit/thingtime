import React from 'react';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { TransientBlockActions } from '../Builder/transientBlockActions';
import type { WebpageBlock } from '../Builder/webpageBlocks';

export const syncElement = (id: string, tag: string, text: string, props?: Record<string, unknown>, css?: Record<string, string>): WebpageBlock =>
	({ id, type: 'element', tag, text, props, css });
export const syncWhen = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock =>
	({ id, type: 'condition', condition: { arg, equals: true }, children });
const present = (id: string, arg: string, child: WebpageBlock): WebpageBlock =>
	({ id, type: 'condition', condition: { arg }, children: [child] });
export const syncAction = (operation: string, inputs: Record<string, unknown> = {}) =>
	({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
export const syncControlStyle = { 'min-height': '44px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'max-width': '100%', 'box-sizing': 'border-box', 'white-space': 'normal', background: 'var(--tt-card, #fff)' };
const muted = { color: 'var(--tt-muted, #71717a)', 'font-size': '12px' };
export const syncButton = (id: string, label: string, operation: string, disabled: string, inputs?: Record<string, unknown>): WebpageBlock =>
	syncElement(id, 'button', label, { type: 'button', disabled, ...syncAction(operation, inputs) }, syncControlStyle);
export const syncRow = (id: string, children: WebpageBlock[]): WebpageBlock => ({
	id, type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'align-items': 'center' }, children
});

export function SyncEditorBlocks({ documentKey, title, blocks, scopeKey, accountTransport, scope, actions }: {
	documentKey: string; title: string; blocks: WebpageBlock[]; scopeKey: string;
	accountTransport?: SettingsDocumentHostProps['accountTransport'];
	scope: Record<string, unknown>; actions?: TransientBlockActions;
}) {
	return <SettingsDocumentHost documentKey={documentKey} defaultDocument={blocks} title={title} scopeKey={scopeKey} accountTransport={accountTransport}>
		{({ blocks: current, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} scope={scope} actions={actions ?? {}}>
			<WebpageBlocksRenderer blocks={current} chrome={chrome} componentsByRef={{}} />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}

export const syncFolderEditorBlocks: WebpageBlock[] = [
	syncRow('folders-toolbar', [
		syncElement('folders-title', 'h3', 'Folders & sync configs', undefined, { flex: '1 1 185px', 'font-weight': '600', 'font-size': '16px' }),
		syncRow('folders-toolbar-actions', [
			syncWhen('folders-add-visible', 'editor.canChoose', [syncButton('folders-add', 'Add folder', 'choose', '{editor.chooseDisabled}')]),
			syncButton('folders-refresh', 'Refresh', 'refresh', '{editor.busy}')
		])
	]),
	syncElement('folders-description', 'p', '{editor.description}', undefined, muted),
	syncWhen('folders-loading-visible', 'editor.cold', [
		syncElement('folders-loading', 'progress', '', { 'aria-label': 'Loading folders and sync configs' }, { display: 'block', width: '64px', height: '4px', 'margin-block': '8px' })
	]),
	present('folders-notice-visible', 'editor.notice', syncElement('folders-notice', 'p', '{editor.notice}', { role: 'status' }, muted)),
	present('folders-error-visible', 'editor.error', syncElement('folders-error', 'p', '{editor.error}', { role: 'alert' }, muted))
];

export const syncSourceBlocks: WebpageBlock[] = [
	syncRow('sync-source-heading', [
		syncElement('sync-source-name', 'h4', '{source.name}', undefined, { flex: '1', 'font-weight': '600', 'font-size': '15px' }),
		syncElement('sync-source-count', 'span', '{source.count}', undefined, muted)
	]),
	present('sync-source-path-visible', 'source.path', syncElement('sync-source-path', 'p', '{source.path}', undefined, muted)),
	present('sync-source-status-visible', 'source.status', syncElement('sync-source-status', 'p', '{source.status}', undefined, muted)),
	syncRow('sync-source-actions', [
		syncWhen('source-config-available', 'source.canAdd', [syncButton('source-config-add', '{source.addLabel}', 'add', '{source.disabled}')]),
		syncWhen('source-grant-available', 'source.canManage', [
			syncButton('source-grant-check', 'Check folder', 'scan', '{source.nativeDisabled}'),
			syncButton('source-grant-remove', 'Remove folder access', 'remove', '{source.nativeDisabled}')
		])
	])
];

export const syncLocalEditorActionBlocks: WebpageBlock[] = [
	syncElement('config-save-status', 'p', '{editor.status}', { role: 'status' }, muted),
	syncRow('config-save-actions', [
		syncWhen('config-start-visible', 'editor.canSync', [syncButton('config-save-start', '{editor.syncLabel}', 'save-sync', '{editor.saveDisabled}')]),
		syncWhen('config-save-visible', 'editor.canSave', [syncButton('config-save-only', '{editor.saveLabel}', 'save', '{editor.saveDisabled}')]),
		syncWhen('config-keep-saved-visible', 'editor.canKeepSaved', [syncButton('config-keep-saved', 'Keep saved config', 'keep-saved', '{editor.busy}')]),
	syncWhen('config-discard-visible', 'editor.canDiscard', [syncButton('config-discard', 'Discard draft', 'discard', '{editor.busy}')]),
		syncWhen('config-reload-visible', 'editor.hasConflict', [syncButton('config-reload', '{editor.conflictLabel}', 'reload', '{editor.busy}')]),
		syncWhen('config-more-folders-visible', 'editor.hasMoreFolders', [syncButton('config-more-folders', 'More cloud folders', 'more-folders', '{editor.busy}')])
	])
];

export const syncConfigEditBlocks: WebpageBlock[] = [syncRow('config-edit-actions', [
	syncButton('config-edit', 'Edit', 'edit', '{config.disabled}'),
	syncWhen('config-versions-visible', 'config.retained', [syncElement('config-saved-versions', 'a', 'View saved versions', { href: '/history?storage=home&kind=file' }, syncControlStyle)])
])];

const label = (name: string, text: string) => syncElement(`config-${name}-label`, 'label', text, { for: `{form.ids.${name}}` }, muted);
const field = (name: string, tag: string, props: Record<string, unknown> = {}, children?: WebpageBlock[]): WebpageBlock => ({
	id: `config-${name}`, type: 'element', tag, props: { id: `{form.ids.${name}}`, name, value: `{form.${name}}`, disabled: '{form.disabled}', ...syncAction(name), ...props },
	css: { ...syncControlStyle, width: '100%', 'min-width': '0' }, children
});
const options = (name: string, values: readonly (readonly [string, string])[]) =>
	values.map(([value, text]) => syncElement(`config-${name}-${value}`, 'option', text, { value }));
const stack = (id: string, children: WebpageBlock[]): WebpageBlock =>
	({ id, type: 'element', tag: 'div', css: { display: 'grid', gap: '6px', 'min-width': '0', 'margin-block': '8px' }, children });
const check = (name: string, text: string, disabled = '{form.disabled}'): WebpageBlock => ({
	id: `config-${name}-row`, type: 'element', tag: 'label', css: { display: 'flex', 'align-items': 'center', gap: '8px', 'min-height': '44px' },
	children: [
		{ id: `config-${name}`, type: 'element', tag: 'input', props: { type: 'checkbox', name, checked: `{form.${name}}`, disabled, ...syncAction(name) } },
		syncElement(`config-${name}-label`, 'span', text)
	]
});
export const syncConfigModes = [['two-way', 'Two-way'], ['upload', 'Device to cloud'], ['download', 'Cloud to device'], ['backup', 'Backup to cloud']] as const;
export const syncConfigBasicsBlocks: WebpageBlock[] = [
	stack('config-name-field', [label('name', 'Sync config name'), field('name', 'input', { type: 'text', 'aria-label': 'Sync config name' })]),
	syncWhen('config-source-field-visible', 'form.canChooseSource', [
		stack('config-source-field', [label('source', 'Device folder'), field('source', 'select', { 'aria-label': 'Device folder' }, [
			syncElement('config-source-empty', 'option', 'Choose a device folder', { value: '' }),
			{ id: 'config-source-options', type: 'collection', props: { itemsPath: 'form.roots', transparent: true, size: 'all' }, children: [
				syncElement('config-source-option', 'option', '{item.name}', { value: '{item.id}' })
			] }
		])])
	]),
	syncElement('config-photo-access', 'p', '{form.photoAccess}', undefined, muted)
];
export const syncConfigDirectionBlocks: WebpageBlock[] = [
	stack('config-mode-field', [label('mode', 'Direction'), field('mode', 'select', { disabled: '{form.modeDisabled}', 'aria-label': 'Direction' }, options('mode', syncConfigModes)),
		syncWhen('config-upload-direction-note-visible', 'form.uploadPolicyBackupOnly', [syncElement('config-upload-direction-note', 'p', 'This iPhone supports upload limits for Backup (keep deleted files). The saved direction and limits are retained.', undefined, muted)]),
		syncWhen('config-backup-note-visible', 'form.isBackup', [syncElement('config-backup-note', 'p', 'Keep cloud copies when files are deleted from this device.', undefined, muted)])])
];
export const syncConfigTransferBlocks: WebpageBlock[] = [{
	id: 'config-transfer-options', type: 'element', tag: 'details', children: [
	syncElement('config-transfer-options-title', 'summary', 'Transfer options', undefined, { 'min-height': '44px', cursor: 'pointer', 'align-content': 'center' }),
	stack('config-network-field', [label('network', 'Network'), field('network', 'select', { 'aria-label': 'Network' }, options('network', [['wifi', 'Wi-Fi only'], ['any', 'Any network · mobile data may be used']]))]),
	check('paused', 'Paused'), check('charging-only', 'Only while charging'),
	check('propagate-deletes', 'Move deleted files to Trash on the other side', '{form.deleteDisabled}')
]}];
export const syncConfigExclusionBlocks: WebpageBlock[] = [
	stack('config-exclusions-field', [
		label('exclusions', 'Excluded paths · one per line'),
		field('exclusions', 'textarea', { 'aria-label': 'Excluded paths · one per line', rows: 3, placeholder: 'Private\nDocuments/archive.zip' }),
		syncElement('config-exclusions-help', 'p', 'Paths are relative to the selected folder. A folder exclusion includes its contents. Wildcards are not supported.', undefined, muted)
	])
];
