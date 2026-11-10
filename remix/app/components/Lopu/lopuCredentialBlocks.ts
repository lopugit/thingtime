import type { WebpageBlock } from '../Builder/webpageBlocks';

const stack = { display: 'grid', gap: '8px', 'min-width': '0', 'overflow-wrap': 'anywhere' };
const field = {
	width: '100%',
	'min-width': '0',
	'box-sizing': 'border-box',
	padding: '8px',
	border: '1px solid var(--tt-border, #ddd)',
	'border-radius': '8px',
	background: 'var(--tt-surface, white)',
	color: 'inherit',
	font: 'inherit'
};
const element = (
	id: string,
	tag: string,
	text: string,
	props: Record<string, unknown> = {},
	children?: WebpageBlock[],
	css?: Record<string, string>
): WebpageBlock => ({ id, type: 'element', tag, text, props, ...(children ? { children } : {}), ...(css ? { css } : {}) });
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const options = (id: string, path: string): WebpageBlock => ({
	id,
	type: 'collection',
	props: { itemsPath: path, size: 'all', transparent: true },
	children: [element(`${id}-option`, 'option', '{item.label}', { value: '{item.id}', disabled: '{item.disabled}' })]
});
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg }, children });

/** Only authored labels and binding paths persist; account IDs and live choices
 * are supplied by the private transient host, never copied into the layout. */
export const lopuCredentialBlocks: WebpageBlock[] = [
	element(
		'ai-choice',
		'section',
		'',
		{ 'aria-label': 'AI credential settings' },
		[
			element('ai-heading', 'h3', '{ai.heading}', {}, undefined, { margin: '0', 'font-size': '14px' }),
			element('ai-description', 'p', '{ai.description}', {}, undefined, { margin: '0', 'font-size': '12px' }),
			element(
				'ai-credential-field',
				'label',
				'',
				{},
				[
					element('ai-credential-label', 'span', 'AI credential'),
					element(
						'ai-credential-select',
						'select',
						'',
						{ 'aria-label': 'AI credential', value: '{ai.credential}', disabled: '{ai.disabled}', ...action('ai.credential') },
						[element('ai-credits-option', 'option', 'Thingtime credits', { value: 'credits' }), options('ai-credential-options', 'ai.credentials')],
						field
					)
				],
				stack
			),
			element(
				'ai-endpoint-field',
				'div',
				'',
				{},
				[
					element('ai-endpoint-label', 'strong', 'AI API endpoint'),
					element('ai-endpoint-value', 'p', '{ai.endpoint}', {}, undefined, { margin: '0' })
				],
				stack
			),
			when('ai-credit-models', 'ai.usesCredits', [
				element(
					'ai-model-field',
					'label',
					'',
					{},
					[
						element('ai-model-label', 'span', 'Model'),
						element(
							'ai-model-select',
							'select',
							'',
							{ 'aria-label': 'AI model', value: '{ai.model}', disabled: '{ai.disabled}', ...action('ai.model') },
							[element('ai-model-default', 'option', 'Thingtime default', { value: '' }), options('ai-model-options', 'ai.models')],
							field
						)
					],
					stack
				)
			]),
			when('ai-personal-model', 'ai.usesCredential', [
				element(
					'ai-personal-details',
					'div',
					'',
					{},
					[
						element('ai-credential-name', 'p', '{ai.credentialName}', {}, undefined, { margin: '0', 'overflow-wrap': 'anywhere' }),
						element('ai-personal-model-label', 'strong', 'Saved connection model'),
						element('ai-personal-model-value', 'p', '{ai.providerModel}', {}, undefined, { margin: '0' })
					],
					stack
				)
			]),
			when('ai-effort-visible', 'ai.hasEfforts', [
				element(
					'ai-effort-field',
					'label',
					'',
					{},
					[
						element('ai-effort-label', 'span', 'Reasoning effort'),
						element(
							'ai-effort-select',
							'select',
							'',
							{ 'aria-label': 'AI reasoning effort', value: '{ai.effort}', disabled: '{ai.disabled}', ...action('ai.effort') },
							[element('ai-effort-default', 'option', 'Model default', { value: '' }), options('ai-effort-options', 'ai.efforts')],
							field
						)
					],
					stack
				)
			]),
			when('ai-speed-visible', 'ai.hasSpeeds', [
				element(
					'ai-speed-field',
					'label',
					'',
					{},
					[
						element('ai-speed-label', 'span', 'Speed'),
						element(
							'ai-speed-select',
							'select',
							'',
							{ 'aria-label': 'AI speed', value: '{ai.speed}', disabled: '{ai.disabled}', ...action('ai.speed') },
							[element('ai-speed-default', 'option', 'Model default', { value: '' }), options('ai-speed-options', 'ai.speeds')],
							field
						)
					],
					stack
				)
			]),
			element('ai-billing', 'p', '{ai.billing}', {}, undefined, { margin: '0', 'font-size': '12px' }),
			when('ai-problem', 'ai.problem', [element('ai-problem-message', 'p', '{ai.problem}', { role: 'status' }, undefined, { margin: '0' })]),
			element('ai-manage', 'a', 'Manage saved credentials, models and endpoints', { href: '{ai.manageHref}' }),
			element(
				'ai-refresh',
				'button',
				'',
				{ type: 'button', disabled: '{ai.refreshing}', ...action('ai.refresh') },
				[element('ai-refresh-label', 'span', 'Refresh credentials and models')],
				field
			),
			element('ai-settings-link', 'a', 'Lopu defaults', { href: '/settings?tab=lopu' })
		],
		stack
	)
];
