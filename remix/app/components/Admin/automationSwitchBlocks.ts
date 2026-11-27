import type { WebpageBlock } from '../Builder/webpageBlocks';
import { AUTOMATION_SURFACES, AUTOMATION_SWITCHES } from '~/automation/automationSwitches';

// Editable Builder blocks for Admin → Automation. Every heading, summary,
// checkbox and list item is its own block, so administrators can restyle or
// rearrange the page in the Builder. Each switch is a collapsed <details>
// section whose heading carries the on/off checkbox, so a switch can be
// flipped without expanding it.
type Props = Record<string, unknown>;

/** Binding-safe scope key for a switch id (`web.timeline` → `web_timeline`). */
export const automationSwitchScopeKey = (id: string) => id.replace(/[^A-Za-z0-9]/g, '_');
/** Block ids are lowercase, dashed and at most 40 characters
 * (`desktop.fileSync` → `desktop-filesync`, `scheduled.models-sync` → `job-models-sync`). */
const blockKey = (id: string) => id.replace(/^scheduled\./, 'job.').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 25).replace(/-+$/, '');

function element(id: string, tag: string, text?: string, props: Props = {}, children?: WebpageBlock[], css: Record<string, string> = {}): WebpageBlock {
	const base: Record<string, string> = {};
	if (tag === 'button')
		Object.assign(base, { 'min-height': '44px', 'max-width': '100%', 'min-width': '0', padding: '7px 12px', 'border-radius': '8px',
			border: '1px solid var(--tt-border, #ddd)', background: 'var(--tt-card, #fff)', color: 'inherit', cursor: 'pointer' });
	if (tag === 'input' && props.type === 'checkbox') Object.assign(base, { width: '22px', height: '22px', 'flex-shrink': '0', 'accent-color': 'var(--tt-accent, #805ad5)' });
	if (tag === 'h2') Object.assign(base, { 'font-size': '18px', 'font-weight': '600' });
	if (tag === 'h3') Object.assign(base, { 'font-size': '15px', 'font-weight': '600', 'margin-top': '8px' });
	if (tag === 'p') Object.assign(base, { 'overflow-wrap': 'anywhere' });
	return { css: { ...base, ...css }, id: 'auto-' + id, type: 'element', tag, ...(text === undefined ? {} : { text }), props, ...(children ? { children } : {}) };
}
const action = (operation: string, inputs: Record<string, unknown> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });

function switchSection(entry: (typeof AUTOMATION_SWITCHES)[number]): WebpageBlock {
	const key = automationSwitchScopeKey(entry.id);
	const id = blockKey(entry.id);
	const label = `${entry.title} — ${entry.id}`;
	return element(id, 'details', undefined, { 'data-automation-switch': entry.id }, [
		element(id + '-summary', 'summary', undefined, {}, [
			element(id + '-toggle', 'input', undefined, {
				type: 'checkbox', 'aria-label': `Turn ${entry.title} on`, checked: `{auto.${key}}`, disabled: '{auto.disabled}', ...action('toggle', { id: entry.id })
			}),
			element(id + '-title', 'span', entry.title, {}, undefined, { 'font-weight': '600', 'min-width': '0', 'overflow-wrap': 'anywhere' }),
			element(id + '-state', 'span', `{auto.${key}_label}`, { 'aria-hidden': 'true' }, undefined, { 'margin-left': 'auto', 'font-size': '13px', opacity: '0.75', 'flex-shrink': '0' })
		], { display: 'flex', 'align-items': 'center', gap: '10px', 'min-height': '44px', cursor: 'pointer', 'list-style-position': 'outside' }),
		element(id + '-about', 'p', entry.summary, {}, undefined, { 'margin-top': '6px' }),
		element(id + '-covers', 'ul', undefined, { 'aria-label': `${label}: what stops when off` },
			entry.covers.map((item, index) => element(`${id}-covers-${index}`, 'li', item)), { 'padding-left': '20px', 'margin-top': '6px' }),
		element(id + '-id', 'p', `Switch id: ${entry.id}`, {}, undefined, { 'font-size': '12px', opacity: '0.7', 'margin-top': '6px' })
	], { padding: '6px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '10px', 'min-width': '0' });
}

export const AUTOMATION_SWITCH_BLOCKS: WebpageBlock[] = [
	element('section', 'section', undefined, { 'aria-label': 'Automation switches', 'aria-busy': '{auto.busy}' }, [
		element('heading', 'h2', 'Automation switches'),
		element('intro', 'p', 'Every automatic, repeating or scheduled feature has its own switch. Off stops the repeating work everywhere; a page still loads its data once when someone opens it. Apps pick up a change the next time they start or come back to the foreground, within about five minutes.'),
		element('summary', 'p', '{auto.summary}', { role: 'status' }),
		element('actions', 'div', undefined, {}, [
			element('all-off', 'button', 'Turn everything off', { type: 'button', disabled: '{auto.disabled}', ...action('all', { enabled: false }) }),
			element('reload', 'button', 'Reload', { type: 'button', disabled: '{auto.busy}', ...action('reload') })
		], { display: 'flex', 'flex-wrap': 'wrap', gap: '8px' }),
		{ id: 'automation-loading', type: 'condition', condition: { arg: 'auto.busy', equals: true },
			children: [element('progress', 'progress', undefined, { 'aria-label': 'Updating automation switches' }, undefined, { width: '100%' })] },
		element('notice', 'p', '{auto.notice}', { role: 'alert' }),
		...AUTOMATION_SURFACES.flatMap((surface) => {
			const entries = AUTOMATION_SWITCHES.filter((entry) => entry.surface === surface.id);
			if (!entries.length) return [];
			return [element(`group-${surface.id}`, 'div', undefined, { role: 'group', 'aria-label': surface.title }, [
				element(`group-${surface.id}-heading`, 'h3', surface.title),
				...entries.map(switchSection)
			], { display: 'grid', gap: '8px', 'min-width': '0' })];
		})
	], { display: 'grid', gap: '12px', padding: '18px', 'min-width': '0', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px' })
];
