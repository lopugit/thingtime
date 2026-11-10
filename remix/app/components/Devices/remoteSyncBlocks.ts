import { syncConnectionGlanceBlocks } from './syncConnectionGlanceBlocks';
import { findBlock, type WebpageBlock } from '../Builder/webpageBlocks';

const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}): WebpageBlock => ({ id, type: 'element', tag, text, props });
const action = (operation: string, inputs: Record<string, unknown> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const control = { 'min-height': '44px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'max-width': '100%', 'white-space': 'normal' };
const button = (id: string, text: string, operation: string, disabled: string, inputs: Record<string, unknown> = {}): WebpageBlock =>
	({ ...element(id, 'button', text, { type: 'button', disabled, ...action(operation, inputs) }), css: control });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg, equals: true }, children });
const row = (id: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'align-items': 'center' }, children });
const connectionActivityBlocks: WebpageBlock[] = [
 when('remote-sync-last-activity-visible', 'item.hasActivity', [
  row('remote-sync-receipt-summary', [
   element('remote-sync-last-activity', 'span', '{item.lastActivity}'),
   element('remote-sync-bytes-sent', 'span', 'Sent: {item.sent}'),
   element('remote-sync-bytes-received', 'span', 'Received: {item.received}')
  ])
 ]),
 when('remote-sync-history-visible', 'item.canShowHistory', [
  { ...button('remote-sync-history', '{item.historyLabel}', 'history', '{remote.deviceDisabled}', { id: '{item.id}' }),
   props: { ...button('remote-sync-history', '', 'history', '{remote.deviceDisabled}', { id: '{item.id}' }).props, 'aria-expanded': '{item.historyOpen}' } },
  element('remote-sync-history-slot', 'div', '', { id: '{item.historySlotId}' })
 ])
];
const legacyRemoteHelp = 'Manage this device from any browser. Transfers continue on the device while Thingtime is running there. Folder selection, download approval and file recovery may ask for confirmation on that device.';

/** Every repeated field and control is an ordinary editable block. Bindings
 * supply display state only; actions recheck owned records in the adapter. */
export const remoteSyncBlocks: WebpageBlock[] = [{ id: 'remote-sync', type: 'element', tag: 'section',
	props: { 'aria-label': 'Manage device sync' }, css: { display: 'grid', gap: '12px', 'min-width': '0', 'overflow-wrap': 'anywhere', 'font-size': '14px' }, children: [
		element('remote-sync-title', 'h3', 'Folders & sync configs'),
		element('remote-sync-help', 'p', '{remote.help}'),
		element('remote-sync-status', 'p', '{remote.status}', { role: 'status', 'aria-live': 'polite' }),
		element('remote-sync-notice', 'p', '{remote.notice}', { role: 'status' }),
		element('remote-sync-error', 'p', '{remote.error}', { role: 'alert' }),
		row('remote-sync-toolbar', [button('remote-sync-refresh-settings', 'Refresh settings', 'refresh-settings', '{remote.busy}'),
			button('remote-sync-refresh-device', 'Refresh device', 'refresh-device', '{remote.checking}'),
			button('remote-sync-choose', 'Add folder', 'choose', '{remote.deviceDisabled}')]),
		{ id: 'remote-sync-roots', type: 'collection', props: { itemsPath: 'remote.roots', label: 'Device folders', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: '{remote.rootsEmpty}' }, children: [
			{ id: 'remote-sync-root', type: 'element', tag: 'details', css: { padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px' }, children: [element('remote-sync-root-name', 'summary', '{item.name}'), element('remote-sync-root-path', 'p', '{item.path}'), element('remote-sync-root-description', 'p', '{item.accessDescription}'), button('remote-sync-root-remove', 'Remove folder access', 'remove', '{remote.deviceDisabled}', { rootId: '{item.id}' })] }
		] },
		{ id: 'remote-sync-connections', type: 'collection', props: { itemsPath: 'remote.connections', label: 'Saved sync configs', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: '{remote.empty}' }, children: [
			{ id: 'remote-sync-connection', type: 'element', tag: 'article', css: { display: 'grid', gap: '4px', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', 'min-width': '0' }, children: [
				row('remote-sync-card-header', [
                    { ...element('remote-sync-connection-name', 'h4', '{item.name}'), css: { flex: '1', 'min-width': '0', 'font-weight': '600' } },
                    { ...button('remote-sync-expand', '{item.toggleGlyph}', 'expand', '{remote.editDisabled}', { id: '{item.id}' }), props: { type: 'button', 'aria-label': '{item.expandLabel}', 'aria-expanded': '{item.expanded}', disabled: '{remote.editDisabled}', ...action('expand', { id: '{item.id}' }) }, css: { ...control, 'min-width': '44px', 'min-height': '44px', 'font-size': '20px', padding: '4px 8px' } }
                ]),
				{ ...element('remote-sync-connection-path', 'p', '{item.destination}'), css: { 'font-size': '12px', color: 'var(--tt-muted, #71717a)' } },
                { ...row('remote-sync-card-stats', [element('remote-sync-connection-mode', 'span', '{item.mode}'), element('remote-sync-connection-summary', 'span', '{item.summaryStatus}', { role: 'status' }), element('remote-sync-connection-progress', 'span', '{item.quickStats}')]), css: { display: 'flex', 'flex-wrap': 'wrap', gap: '4px 10px', 'font-size': '12px', color: 'var(--tt-muted, #71717a)' } },
                ...syncConnectionGlanceBlocks('item.glance', 'remote-sync-glance'),
				when('remote-sync-selected-controls', 'item.expanded', [element('remote-sync-connection-status', 'p', '{item.status}', { role: 'status' }), element('remote-sync-connection-speed', 'p', '{item.speed}'),
				row('remote-sync-connection-actions', [button('remote-sync-edit', 'Edit', 'edit', '{remote.editDisabled}', { id: '{item.id}' }),
					button('remote-sync-start', '{item.startLabel}', 'start', '{item.startDisabled}', { id: '{item.id}' }),
					button('remote-sync-pause', 'Pause sync', 'pause', '{item.pauseDisabled}', { id: '{item.id}' }),
					button('remote-sync-details', 'Progress, coverage & priorities', 'details', '{remote.deviceDisabled}', { id: '{item.id}' }),
					{ ...element('remote-sync-files', 'a', 'Browse synced files', { href: '{item.href}' }), css: control }]),
				element('remote-sync-automatic-status', 'p', '{item.automatic}'),
				when('remote-sync-enrollment-supported', 'item.canEnroll', [{ id: 'remote-sync-automatic-options', type: 'element', tag: 'details', children: [element('remote-sync-automatic-summary', 'summary', 'Automatic sync'),
				row('remote-sync-automation', [
					{ id: 'remote-sync-interval', type: 'element', tag: 'select', props: { 'aria-label': 'Automatic sync interval for {item.name}', value: '{item.interval}', disabled: '{item.startDisabled}', ...action('interval', { id: '{item.id}' }) }, css: control,
						children: [['60000', 'Every minute'], ['300000', 'Every 5 minutes'], ['900000', 'Every 15 minutes'], ['3600000', 'Every hour']].map(([value, label]) => element('remote-sync-interval-' + value, 'option', label, { value })) },
					button('remote-sync-automatic-start', 'Start automatic sync', 'automatic', '{item.startDisabled}', { id: '{item.id}' })
				])] }])
				]),
                { id: 'remote-sync-editor-slot', type: 'element', tag: 'div', props: { id: '{item.editorSlotId}', hidden: '{item.editorHidden}' } }
			] }
		] },
		when('remote-sync-more-state', 'remote.hasMore', [button('remote-sync-more', 'More sync configs', 'more', '{remote.busy}')])
	] }];

export const remoteSyncEditorBlocks: WebpageBlock[] = [{ id: 'remote-editor-actions', type: 'element', tag: 'section', css: { display: 'grid', gap: '8px', 'margin-top': '12px' }, children: [
	element('remote-editor-status', 'p', '{editor.status}', { role: 'status' }),
	element('remote-editor-error', 'p', '{editor.error}', { role: 'alert' }),
	row('remote-editor-buttons', [
		when('remote-editor-save-sync-visible', 'editor.canSync', [button('remote-editor-save-sync', '{editor.syncLabel}', 'save-sync', '{editor.saveDisabled}')]),
		when('remote-editor-save-visible', 'editor.canSave', [button('remote-editor-save', '{editor.saveLabel}', 'save', '{editor.saveDisabled}')]),
		when('remote-editor-keep-visible', 'editor.canKeepSaved', [button('remote-editor-keep', 'Keep saved config', 'keep-saved', '{editor.busy}')]),
		button('remote-editor-discard', 'Discard draft', 'discard', '{editor.discardDisabled}'),
		when('remote-editor-conflict-state', 'editor.hasConflict', [button('remote-editor-reload', 'Replace draft with saved version', 'reload', '{editor.busy}')]),
		when('remote-editor-folders-state', 'editor.hasMoreFolders', [button('remote-editor-folders', 'More cloud folders', 'more-folders', '{editor.busy}')])])
] }];

/** Move the existing repeatable card into its source group without replacing
 * saved card fields, styles or their stable Builder IDs. */
export function groupRemoteSyncBlocks(blocks: WebpageBlock[]): WebpageBlock[] {
 const configs = findBlock(blocks, 'remote-sync-connections');
 if (!configs || !findBlock(blocks, 'remote-sync-root') || findBlock(blocks, 'remote-sync-source-drafts')) return blocks;
 const visit = (block: WebpageBlock): WebpageBlock | undefined => {
  if (block.id === 'remote-sync-connections' || block.id === 'remote-sync-add') return;
  const next = { ...block, ...(block.children ? { children: block.children.flatMap(child => { const value = visit(child); return value ? [value] : []; }) } : {}) };
  if (block.id === 'remote-sync-title' && block.text === 'Sync connections') next.text = 'Folders & sync configs';
  if (block.id === 'remote-sync-choose' && block.text === 'Choose device folder') next.text = 'Add folder';
  if (block.id === 'remote-sync-roots') next.props = { ...next.props, itemsPath: 'remote.groups', empty: '{remote.empty}' };
  if (block.id !== 'remote-sync-root') return next;
  const actions = row('remote-sync-root-actions', [
   when('remote-sync-source-add-visible', 'item.canManage', [button('remote-sync-source-add', '{item.addLabel}', 'add', '{remote.addDisabled}', { rootId: '{item.id}' })]),
   ...(next.children ?? []).filter(child => child.id === 'remote-sync-root-remove').map(child => when('remote-sync-source-remove-visible', 'item.canManage', [child]))
  ]);
  return { ...next, tag: next.tag === 'details' ? 'section' : next.tag, props: { ...next.props, 'aria-label': '{item.name}' }, children: [
   ...(next.children ?? []).filter(child => child.id !== 'remote-sync-root-remove').map(child => child.id === 'remote-sync-root-name' && child.tag === 'summary' ? { ...child, tag: 'h4', css: { ...child.css, 'font-weight': '600' } } : child),
   actions,
   { ...configs, props: { ...configs.props, itemsPath: 'item.configs', label: 'Saved sync configs', empty: '' } },
   { id: 'remote-sync-source-drafts', type: 'collection', props: { itemsPath: 'item.drafts', label: 'Sync config drafts', hideSearch: true, hideSize: true, hideCount: true, size: 'all', transparent: true, empty: '' }, children: [
    { id: 'remote-sync-draft', type: 'element', tag: 'article', css: { 'border-top': '1px solid var(--tt-border, #ddd)', 'padding-block': '8px', 'min-width': '0' }, children: [
     element('remote-sync-draft-title', 'h4', '{item.name}'),
     button('remote-sync-draft-edit', 'Edit draft', 'edit-draft', '{remote.editDisabled}', { id: '{item.id}' }),
     element('remote-sync-draft-editor-slot', 'div', '', { id: '{item.editorSlotId}', hidden: '{item.editorHidden}' })
    ] }
   ] }
  ] };
 };
 return blocks.flatMap(block => { const next = visit(block); return next ? [next] : []; });
}

export function remoteSyncAuthoringBlocks(blocks: WebpageBlock[]): WebpageBlock[] {
 const visit = (block: WebpageBlock): WebpageBlock => {
  if (block.id === 'remote-sync-connection-path' && block.text === '{item.path}') return { ...block, text: '{item.destination}' };
  const children = block.children?.map(visit) ?? [];
  if (block.id === 'remote-sync-connection' && !findBlock([block], 'remote-sync-history-slot')) children.push(...connectionActivityBlocks);
  return block.children || children.length ? { ...block, children } : block;
 };
 return groupRemoteSyncBlocks(blocks).map(visit);
}

export function remoteSyncSaveActions(blocks: WebpageBlock[]): WebpageBlock[] {
 const additions = ['remote-editor-save-sync-visible', 'remote-editor-keep-visible'].flatMap(id => {
  const block = findBlock(remoteSyncEditorBlocks, id);
  return block && !findBlock(blocks, id) ? [block] : [];
 });
 const wrapSave = !findBlock(blocks, 'remote-editor-save-visible');
 const visit = (block: WebpageBlock): WebpageBlock => {
  if (wrapSave && block.id === 'remote-editor-save') return when('remote-editor-save-visible', 'editor.canSave', [block]);
  return block.children ? { ...block, children: [
   ...(block.id === 'remote-editor-buttons' ? additions : []), ...block.children.map(visit)
  ] } : block;
 };
 return blocks.map(visit);
}

/** Existing personal layouts keep their authored fields. Add the missing core
 * disclosure when upgrading an older saved layout; guard operational blocks
 * at render time as well as in the command adapter. */
export function remoteSyncDisclosureBlocks(blocks: WebpageBlock[]): WebpageBlock[] {
 const operations = new Set(['edit', 'start', 'pause', 'details', 'interval', 'automatic']);
 const liveOperations = new Set(['refresh-device', 'add', 'choose', 'remove', 'quick', 'start', 'pause', 'details', 'interval', 'automatic']);
 const liveBlocks = new Set([ 'remote-sync-automatic-status', 'remote-sync-automatic-options', 'remote-sync-quick-error']);
 const visit = (block: WebpageBlock, inConnection = false): WebpageBlock => {
  const connection = inConnection || block.id === 'remote-sync-connection';
  const next = { ...block, ...(block.children ? { children: block.children.map(child => visit(child, connection)) } : {}) };
  if (block.id === 'remote-sync-connection' && !JSON.stringify(block).includes('"operation":"expand"')) {
   next.children = [...(next.children ?? []), button('remote-sync-expand', '{item.expandLabel}', 'expand', '{remote.editDisabled}', { id: '{item.id}' })];
  }
  if (block.id === 'remote-sync-connection' && !JSON.stringify(block).includes('remote-sync-glance')) next.children = [...(next.children ?? []), ...syncConnectionGlanceBlocks('item.glance', 'remote-sync-glance')];
  if (block.id === 'remote-sync-connection' && !JSON.stringify(block).includes('remote-sync-editor-slot')) next.children = [...(next.children ?? []), { id: 'remote-sync-editor-slot', type: 'element', tag: 'div', props: { id: '{item.editorSlotId}', hidden: '{item.editorHidden}' } }];
  if (block.id === 'remote-sync-connection' && !JSON.stringify(block).includes('remote-sync-quick')) next.children = [...(next.children ?? []),
  visit(element('remote-sync-quick-error', 'p', '{item.quickError}', { role: 'alert' }), true),
  visit(button('remote-sync-quick', '{item.quickLabel}', 'quick', '{item.quickDisabled}', { id: '{item.id}' }), true)];
 if (block.id === 'remote-sync-help' && block.text === legacyRemoteHelp) next.text = '{remote.help}';
 if (block.id === 'remote-sync-start' || block.id === 'remote-sync-pause') next.props = { ...next.props, hidden: true };
 const inputs = block.props?.['data-tt-action-inputs'];
 const binding = inputs && typeof inputs === 'object' ? inputs as { operation?: unknown } : undefined;
 let operation = String(binding?.operation ?? '');
 // Earlier saved defaults used names that the transient adapter rejects.
 if (operation === 'refreshSettings' || operation === 'refreshDevice') {
  operation = operation === 'refreshSettings' ? 'refresh-settings' : 'refresh-device';
  next.props = { ...next.props, 'data-tt-action-inputs': { ...binding, operation } };
 }
 const selected = connection && operations.has(operation) ? when(`${block.id}-selection`, 'item.expanded', [next]) : next;
 return liveBlocks.has(block.id) || liveOperations.has(operation) ? when(`${block.id}-live`, 'remote.hasLiveControls', [selected]) : selected;
 };
 return remoteSyncAuthoringBlocks(blocks).map(block => visit(block));
}
