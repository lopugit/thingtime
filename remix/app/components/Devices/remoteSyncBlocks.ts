import type { WebpageBlock } from '../Builder/webpageBlocks';

const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}): WebpageBlock => ({ id, type: 'element', tag, text, props });
const action = (operation: string, inputs: Record<string, unknown> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const control = { 'min-height': '40px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'max-width': '100%', 'white-space': 'normal' };
const button = (id: string, text: string, operation: string, disabled: string, inputs: Record<string, unknown> = {}): WebpageBlock =>
	({ ...element(id, 'button', text, { type: 'button', disabled, ...action(operation, inputs) }), css: control });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg, equals: true }, children });
const row = (id: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'align-items': 'center' }, children });

/** Every repeated field and control is an ordinary editable block. Bindings
 * supply display state only; actions recheck owned records in the adapter. */
export const remoteSyncBlocks: WebpageBlock[] = [{ id: 'remote-sync', type: 'element', tag: 'section',
	props: { 'aria-label': 'Manage device sync' }, css: { display: 'grid', gap: '12px', 'min-width': '0', 'overflow-wrap': 'anywhere', 'font-size': '14px' }, children: [
		element('remote-sync-title', 'h3', 'Sync connections'),
		element('remote-sync-help', 'p', 'Manage this device from any browser. Transfers continue on the device while Thingtime is running there. Folder selection, download approval and file recovery may ask for confirmation on that device.'),
		element('remote-sync-status', 'p', '{remote.status}', { role: 'status', 'aria-live': 'polite' }),
		element('remote-sync-notice', 'p', '{remote.notice}', { role: 'status' }),
		element('remote-sync-error', 'p', '{remote.error}', { role: 'alert' }),
		row('remote-sync-toolbar', [button('remote-sync-refresh-settings', 'Refresh settings', 'refreshSettings', '{remote.busy}'),
			button('remote-sync-refresh-device', 'Refresh device', 'refreshDevice', '{remote.checking}'),
			button('remote-sync-add', 'Add connection', 'add', '{remote.addDisabled}'),
			button('remote-sync-choose', 'Choose device folder', 'choose', '{remote.deviceDisabled}')]),
		{ id: 'remote-sync-roots', type: 'collection', props: { itemsPath: 'remote.roots', label: 'Device folders', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: '{remote.rootsEmpty}' }, children: [
			row('remote-sync-root', [element('remote-sync-root-name', 'p', '{item.name}'), button('remote-sync-root-remove', 'Remove folder access', 'remove', '{remote.deviceDisabled}', { rootId: '{item.id}' })])
		] },
		{ id: 'remote-sync-connections', type: 'collection', props: { itemsPath: 'remote.connections', label: 'Saved sync connections', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: '{remote.empty}' }, children: [
			{ id: 'remote-sync-connection', type: 'element', tag: 'article', css: { display: 'grid', gap: '8px', padding: '16px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', 'min-width': '0' }, children: [
				element('remote-sync-connection-name', 'h4', '{item.name}'),
				element('remote-sync-connection-mode', 'p', '{item.mode}'),
				element('remote-sync-connection-status', 'p', '{item.status}', { role: 'status' }),
				element('remote-sync-connection-progress', 'p', '{item.progress}'),
				element('remote-sync-connection-speed', 'p', '{item.speed}'),
				row('remote-sync-connection-actions', [button('remote-sync-edit', 'Edit', 'edit', '{remote.editDisabled}', { id: '{item.id}' }),
					button('remote-sync-start', 'Sync now', 'start', '{item.startDisabled}', { id: '{item.id}' }),
					button('remote-sync-pause', 'Pause sync', 'pause', '{item.pauseDisabled}', { id: '{item.id}' }),
					button('remote-sync-details', 'Progress, coverage & priorities', 'details', '{remote.deviceDisabled}', { id: '{item.id}' }),
					{ ...element('remote-sync-files', 'a', 'Browse synced files', { href: '{item.href}' }), css: control }]),
				element('remote-sync-automatic-status', 'p', '{item.automatic}'),
				row('remote-sync-automation', [
					{ id: 'remote-sync-interval', type: 'element', tag: 'select', props: { 'aria-label': 'Automatic sync interval for {item.name}', value: '{item.interval}', disabled: '{item.startDisabled}', ...action('interval', { id: '{item.id}' }) }, css: control,
						children: [['60000', 'Every minute'], ['300000', 'Every 5 minutes'], ['900000', 'Every 15 minutes'], ['3600000', 'Every hour']].map(([value, label]) => element('remote-sync-interval-' + value, 'option', label, { value })) },
					button('remote-sync-automatic-start', 'Start automatic sync', 'automatic', '{item.startDisabled}', { id: '{item.id}' })
				])
			] }
		] },
		when('remote-sync-more-state', 'remote.hasMore', [button('remote-sync-more', 'More connections', 'more', '{remote.busy}')])
	] }];

export const remoteSyncEditorBlocks: WebpageBlock[] = [{ id: 'remote-editor-actions', type: 'element', tag: 'section', css: { display: 'grid', gap: '8px', 'margin-top': '12px' }, children: [
	element('remote-editor-status', 'p', '{editor.status}', { role: 'status' }),
	element('remote-editor-error', 'p', '{editor.error}', { role: 'alert' }),
	row('remote-editor-buttons', [button('remote-editor-save', '{editor.saveLabel}', 'save', '{editor.saveDisabled}'),
		button('remote-editor-discard', 'Discard draft', 'discard', '{editor.discardDisabled}'),
		when('remote-editor-conflict-state', 'editor.hasConflict', [button('remote-editor-reload', 'Replace draft with saved version', 'reload', '{editor.busy}')]),
		when('remote-editor-folders-state', 'editor.hasMoreFolders', [button('remote-editor-folders', 'More cloud folders', 'moreFolders', '{editor.busy}')])])
] }];
