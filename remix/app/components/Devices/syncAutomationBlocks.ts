import type { WebpageBlock } from '../Builder/webpageBlocks';

const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const text = (id: string, tag: string, content: string, props: Record<string, unknown> = {}): WebpageBlock =>
	({ id, type: 'element', tag, text: content, props });
const control = { 'min-height': '40px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px' };

/** Authored blocks contain no job or permission authority. Each field, label,
 * option and button remains selectable through the ordinary Builder. */
export const syncAutomationBlocks: WebpageBlock[] = [{ id: 'automation', type: 'element', tag: 'fieldset',
	props: { 'aria-label': 'Automatic file sync' }, css: { 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px' }, children: [
		text('automation-title', 'legend', 'Sync this device’s files automatically'),
		text('automation-help', 'p', 'Keep this connection on to resume saved work when this device reconnects and check for new changes. Thingtime can continue with its Mac window closed; after Quit, it resumes when reopened. Your network, power, exclusions and explicit pauses still apply.'),
		text('automation-status', 'p', '{automatic.status}', { role: 'status' }),
		text('automation-error', 'p', '{automatic.error}', { role: 'alert' }),
		text('automation-label', 'p', 'Check for changes'),
		{ id: 'automation-controls', type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'align-items': 'center' }, children: [
			{ id: 'automation-interval', type: 'element', tag: 'select', props: { name: 'interval', 'aria-label': 'Automatic sync interval', value: '{automatic.interval}', disabled: '{automatic.startDisabled}', ...action('interval') }, css: control,
				children: [['60000', 'Every minute'], ['300000', 'Every 5 minutes'], ['900000', 'Every 15 minutes'], ['3600000', 'Every hour']].map(([value, label]) => text('automation-interval-' + value, 'option', label, { value })) },
			{ ...text('automation-start', 'button', 'Start automatic sync', { type: 'button', disabled: '{automatic.startDisabled}', ...action('start') }), css: control },
			{ ...text('automation-stop', 'button', 'Stop automatic sync', { type: 'button', disabled: '{automatic.stopDisabled}', ...action('stop') }), css: control }
		] }
	] }];
