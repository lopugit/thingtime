import type { WebpageBlock } from '../Builder/webpageBlocks';

const stack = { display: 'flex', 'flex-direction': 'column', gap: '10px', 'min-width': '0' };
const control = {
	'min-height': '44px',
	'box-sizing': 'border-box',
	'max-width': '100%',
	padding: '8px 12px',
	border: '1px solid var(--tt-border, #ddd)',
	'border-radius': '8px',
	color: 'inherit',
	background: 'var(--tt-card, white)'
};
function el(
	id: string,
	tag: string,
	text?: string,
	props: Record<string, unknown> = {},
	children?: WebpageBlock[],
	css: Record<string, string> = {}
): WebpageBlock {
	return { id: 'deployment-profile-' + id.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), type: 'element', tag, text, props, children, css };
}
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({
	id: 'deployment-profile-' + id,
	type: 'condition',
	condition: { arg, equals: true },
	children
});
const action = (operation: string, inputs = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const button = (id: string, label: string, operation: string, disabled = '{profiles.busy}', inputs = {}) =>
	el(id, 'button', label, { type: 'button', disabled, ...action(operation, inputs) }, undefined, {
		...control,
		cursor: 'pointer',
		'align-self': 'flex-start'
	});
export const PROFILE_FIELDS = {
	id: 'Profile ID',
	label: 'Display name',
	teamId: 'Vercel team ID',
	teamSlug: 'Vercel team slug',
	projectId: 'Vercel project ID',
	projectName: 'Vercel project name',
	testOrigin: 'Test URL'
};
const field = (name: keyof typeof PROFILE_FIELDS) =>
	el(
		name + '-group',
		'label',
		undefined,
		{},
		[
			el(name + '-label', 'span', PROFILE_FIELDS[name]),
			el(
				name + '-input',
				'input',
				undefined,
				{
					name,
					type: name === 'testOrigin' ? 'url' : 'text',
					value: '{profiles.draft.' + name + '}',
					disabled: name === 'id' ? '{profiles.idLocked}' : ['teamId', 'projectId'].includes(name) ? '{profiles.identityLocked}' : '{profiles.busy}',
					...action('profile.field', { name })
				},
				undefined,
				control
			)
		],
		stack
	);
export const DEPLOYMENT_PROFILE_BLOCKS: WebpageBlock[] = [
	el(
		'panel',
		'section',
		undefined,
		{},
		[
			el('heading', 'h2', 'Deployment profiles'),
			el('description', 'p', 'Manage where GitHub publishes Thingtime. Parallel projects use their own Vercel test URLs.'),
			when('status-visible', 'profiles.busy', [el('status', 'span', '{profiles.status}', { role: 'status' })]),
			when('error-visible', 'profiles.hasError', [el('error', 'p', '{profiles.error}', { role: 'alert' })]),
			when('empty-visible', 'profiles.empty', [
				el('empty', 'p', 'The existing production publisher is active by default. Add a parallel profile to test another project.')
			]),
			{
				id: 'deployment-profile-list',
				type: 'collection',
				props: { itemsPath: 'profiles.rows', size: 'all', transparent: true },
				children: [
					el(
						'entry',
						'article',
						undefined,
						{},
						[
							el('name', 'h3', '{item.label}'),
							el('target', 'p', '{item.destination}'),
							el('state', 'p', '{item.status}'),
							button('edit', 'Edit profile', 'profile.edit', '{profiles.refreshDisabled}', { id: '{item.id}' })
						],
						{ ...stack, padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px' }
					)
				]
			},
			when('toolbar-visible', 'profiles.showActions', [
				button('new', 'Add parallel deployment', 'profile.new'),
				when('legacy-visible', 'profiles.needsLegacy', [button('legacy', 'Configure existing publisher', 'profile.legacy')])
			]),
			when('form-visible', 'profiles.editing', [
				el(
					'form',
					'div',
					undefined,
					{},
					[
						el('form-heading', 'h3', '{profiles.formTitle}'),
						...(['id', 'label', 'teamId', 'teamSlug', 'projectId', 'projectName'] as const).map(field),
						when('alias-visible', 'profiles.parallel', [field('testOrigin')]),
						el(
							'enabled-field',
							'label',
							undefined,
							{},
							[
								el('enabled-input', 'input', undefined, {
									type: 'checkbox',
									checked: '{profiles.draft.enabled}',
									disabled: '{profiles.busy}',
									...action('profile.enable')
								}),
								el('enabled-label', 'span', 'Publish future builds to this project')
							],
							{ display: 'flex', gap: '8px', 'align-items': 'center', 'min-height': '44px' }
						),
						button('save', 'Save deployment profile', 'profile.save', '{profiles.saveDisabled}'),
						button('cancel', 'Cancel', 'profile.cancel')
					],
					stack
				)
			]),
			button('refresh', 'Refresh profiles', 'profile.refresh', '{profiles.refreshDisabled}')
		],
		{ ...stack, padding: '16px' }
	)
];
