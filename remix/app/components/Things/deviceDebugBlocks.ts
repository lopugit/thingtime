import type { WebpageBlock } from '../Builder/webpageBlocks';

const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}): WebpageBlock => ({ id, type: 'element', tag, text, props });
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const control = { 'min-height': '44px', padding: '9px 12px', border: '1px solid var(--tt-border, #dedee6)', 'border-radius': '10px', background: 'var(--tt-card, white)', color: 'inherit', 'font-size': '14px', 'max-width': '100%', 'min-width': '0' };
const select = (id: string, label: string, value: string, operation: string, options: string[][]): WebpageBlock => ({ id, type: 'element', tag: 'label', css: { display: 'grid', gap: '5px', 'min-width': '0', flex: '1 1 140px' }, children: [
	element(id + '-label', 'span', label),
	{ id: id + '-input', type: 'element', tag: 'select', props: { value, 'aria-label': label, ...action(operation) }, css: control,
		children: options.map(([v, name]) => element(id + '-option-' + (v || 'all'), 'option', name, { value: v })) }
] });
const button = (id: string, label: string, operation: string, disabled = '{debug.busy}'): WebpageBlock => ({ ...element(id, 'button', label, { type: 'button', disabled, ...action(operation) }), css: control });

/** Every label, filter, event field and disclosure is an ordinary editable block.
 * Public display bindings never contain native payloads or credentials. */
export const deviceDebugBlocks: WebpageBlock[] = [{ id: 'debug-page', type: 'element', tag: 'section', props: { 'aria-label': 'Private device debug log' },
	css: { display: 'grid', gap: '18px', color: 'var(--tt-ink, #202027)', 'font-size': '14px', 'line-height': '1.55', 'min-width': '0', 'overflow-wrap': 'anywhere' }, children: [
		{ ...element('debug-back', 'a', 'Back to Things', { href: '/things' }), css: { color: 'var(--tt-muted, #646474)', 'justify-self': 'start', 'min-height': '44px', display: 'inline-flex', 'align-items': 'center' } },
		{ id: 'debug-intro', type: 'element', tag: 'header', css: { display: 'grid', gap: '7px' }, children: [
			{ ...element('debug-eyebrow', 'p', 'PRIVATE · DEVICE ACTIVITY'), css: { 'font-size': '12px', 'letter-spacing': '0.08em', color: 'var(--tt-muted, #646474)', margin: '0' } },
			{ ...element('debug-title', 'h1', 'Debug'), css: { 'font-size': '32px', 'font-weight': '650', 'line-height': '1.2', margin: '0' } },
			element('debug-description', 'p', 'See what your devices reported during a test, including progress, waits and errors. This private folder stays out of your usual Things lists.'),
			{ ...element('debug-privacy', 'p', 'Only safe event codes and counters are recorded. File names, paths, URLs, credentials and raw error messages are excluded.'), css: { color: 'var(--tt-muted, #646474)', margin: '0' } }
		] },
		{ id: 'debug-toolbar', type: 'element', tag: 'fieldset', css: { border: '0', padding: '0', margin: '0', 'min-width': '0', display: 'flex', 'flex-wrap': 'wrap', gap: '12px', 'align-items': 'end' }, children: [
			element('debug-filters-title', 'legend', 'Filter activity'),
			select('debug-level', 'Severity', '{debug.level}', 'level', [['', 'All severities'], ['info', 'Info'], ['warning', 'Warning'], ['error', 'Error']]),
			select('debug-category', 'Source', '{debug.category}', 'category', [['', 'All sources'], ...['lifecycle', 'sync', 'upload', 'index', 'network', 'storage', 'permission'].map(v => [v, v[0].toUpperCase() + v.slice(1)])]),
			{ id: 'debug-device-filter', type: 'element', tag: 'label', css: { display: 'grid', gap: '5px', flex: '2 1 240px', 'min-width': '0' }, children: [
				element('debug-device-label', 'span', 'Device ID'),
				{ ...element('debug-device-input', 'input', '', { type: 'text', value: '{debug.deviceId}', 'aria-label': 'Device ID', placeholder: 'All devices', ...action('device') }), css: control }
			] },
			button('debug-refresh', 'Refresh', 'refresh'),
			button('debug-export', 'Export shown events', 'export', '{debug.exportDisabled}')
		] },
		{ id: 'debug-settings', type: 'element', tag: 'details', css: { border: '1px solid var(--tt-border, #dedee6)', 'border-radius': '12px', padding: '4px 14px' }, children: [
			{ ...element('debug-settings-title', 'summary', 'Diagnostics settings'), css: { cursor: 'pointer', 'min-height': '44px', 'align-content': 'center' } },
			element('debug-settings-description', 'p', '{debug.captureDescription}'),
			button('debug-capture', '{debug.captureLabel}', 'capture', '{debug.settingsDisabled}'),
			{ id: 'debug-clear-panel', type: 'element', tag: 'details', children: [element('debug-clear-title', 'summary', 'Clear diagnostic history'), element('debug-clear-warning', 'p', 'Remove events saved through the last loaded snapshot. New arrivals are kept. This does not delete your files or change sync settings.'), button('debug-clear', '{debug.clearLabel}', 'clear', '{debug.settingsDisabled}'), { id: 'debug-clear-confirmation', type: 'condition', condition: { arg: 'debug.clearArmed', equals: true }, children: [button('debug-clear-cancel', 'Keep saved events', 'cancel-clear', '{debug.busy}')] }] },
			element('debug-settings-note', 'p', 'Changing capture does not pause sync or remove previously saved events. Manage individual records through their normal Thing controls.')
		] },
		{ id: 'debug-state', type: 'element', tag: 'div', props: { 'aria-busy': '{debug.busy}' }, css: { display: 'flex', gap: '8px', 'align-items': 'center' }, children: [
			{ ...element('debug-loading', 'span', '{debug.loadingIcon}', { 'aria-hidden': true }), css: { 'font-size': '18px' } },
			element('debug-status', 'p', '{debug.status}', { role: 'status', 'aria-live': 'polite' })
		] },
		{ id: 'debug-error-state', type: 'condition', condition: { arg: 'debug.hasError', equals: true }, children: [element('debug-error', 'p', '{debug.error}', { role: 'alert' }), button('debug-retry', 'Try again', 'refresh', '{debug.retryDisabled}')] },
		{ id: 'debug-events', type: 'collection', props: { itemsPath: 'debug.rows', label: 'Saved device events', hideSearch: true, hideCount: true, hideSize: true, size: 'all', empty: '{debug.empty}' }, children: [
			{ id: 'debug-event', type: 'element', tag: 'article', css: { border: '1px solid var(--tt-border, #dedee6)', 'border-radius': '12px', background: 'var(--tt-card, white)', padding: '14px 16px', 'margin-bottom': '10px', 'min-width': '0', 'overflow-wrap': 'anywhere' }, children: [
				{ id: 'debug-event-heading', type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', gap: '8px 16px', 'justify-content': 'space-between', 'align-items': 'baseline' }, children: [
					{ ...element('debug-event-title', 'h2', '{item.title}'), css: { 'font-size': '15px', 'font-weight': '650', margin: '0' } },
					{ ...element('debug-event-time', 'span', '{item.time}', { 'aria-label': '{item.occurredAt}' }), css: { color: 'var(--tt-muted, #646474)', 'font-size': '13px' } }
				] },
				element('debug-event-state', 'p', '{item.stateLine}'),
				{ ...element('debug-event-progress', 'p', '{item.progress}'), css: { 'font-variant-numeric': 'tabular-nums', margin: '6px 0' } },
				{ id: 'debug-event-details', type: 'element', tag: 'details', children: [
					{ ...element('debug-event-summary', 'summary', 'Event details'), css: { cursor: 'pointer', 'min-height': '44px', 'align-content': 'center' } },
					{ id: 'debug-event-fields', type: 'element', tag: 'dl', css: { display: 'grid', 'grid-template-columns': 'minmax(60px, 90px) minmax(0, 1fr)', gap: '7px 12px', margin: '8px 0', 'font-size': '13px' }, children: [
						...([['device', 'Device', '{item.deviceId}'], ['runtime', 'Build', '{item.runtimeLabel}'], ['phase', 'Phase', '{item.phaseLabel}'], ['reason', 'Reason', '{item.reasonLabel}'], ['operation', 'Operation', '{item.operationLabel}'], ['system', 'System error', '{item.errorLabel}'], ['background', 'Background', '{item.backgroundLabel}'], ['config', 'Sync config', '{item.configurationLabel}'], ['retry-source', 'Retry source', '{item.retrySourceLabel}'], ['code', 'Code', '{item.code}'], ['retry', 'Retry', '{item.retryLabel}'], ['received', 'Received', '{item.receivedLabel}']] as const).flatMap(([key, label, value]) => [element('debug-field-' + key + '-label', 'dt', label), { ...element('debug-field-' + key, 'dd', value), css: { margin: '0', 'min-width': '0', 'overflow-wrap': 'anywhere' } }])
					] },
					{ ...element('debug-event-open', 'a', 'Open saved Thing', { href: '{item.href}' }), css: { 'min-height': '44px', display: 'inline-flex', 'align-items': 'center' } }
				] }
			] }
		] },
		{ id: 'debug-more-state', type: 'condition', condition: { arg: 'debug.hasMore', equals: true }, children: [button('debug-older', 'Load older events', 'older', '{debug.olderDisabled}')] }
	] }];
