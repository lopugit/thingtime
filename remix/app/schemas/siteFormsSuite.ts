import type { BehaviourSuite, SuiteComponentDef, SuiteActionDef } from './behaviourSuites';

export const SITE_FORMS_KEY = 'site-forms';
export const SITE_FORM_REFS = ['demo-site-forms-newsletter', 'demo-site-forms-contact', 'demo-site-forms-request', 'demo-site-forms-media'];

const fieldStyle = {
	width: '100%',
	minWidth: 0,
	padding: '10px 12px',
	border: '1px solid var(--tt-border, #ddd)',
	borderRadius: '10px',
	background: 'var(--tt-card, #fff)',
	color: 'var(--tt-ink, #16161a)',
	boxSizing: 'border-box'
};
const field = (name: string, label: string, type = 'text', maxLength = 200) => ({
	tag: 'label',
	props: { style: { display: 'grid', gap: '5px', fontSize: '14px' } },
	children: [
		label,
		{
			tag: type === 'textarea' ? 'textarea' : 'input',
			props: { name, ...(type === 'textarea' ? { rows: 4 } : { type }), required: true, maxLength, style: fieldStyle }
		}
	]
});

const form = (key: 'newsletter' | 'contact'): SuiteComponentDef => ({
	key,
	name: key === 'newsletter' ? 'Newsletter signup' : 'Contact form',
	description: 'Saves a private record in your Things through an Action. Delivery requires your own integration.',
	args: [{ name: 'brand', type: 'string', label: 'Organisation', default: 'My site', maxLength: 120 }],
	render: (refs) => ({
		tag: 'fieldset',
		props: { style: { display: 'grid', gap: '12px', border: 'none', padding: 0, minWidth: 0 } },
		children: [
			...(key === 'contact' ? [field('name', 'Your name', 'text', 80)] : []),
			field('email', 'Email address', 'email'),
			...(key === 'contact' ? [field('message', 'Message', 'textarea', 2000)] : []),
			{
				tag: 'button',
				props: {
					type: 'button',
					style: { ...fieldStyle, background: 'var(--tt-ink, #16161a)', color: 'var(--tt-card, #fff)', fontWeight: 700, cursor: 'pointer' }
				},
				ttAction: refs.actionKey(key),
				ttActionInputs: { brand: '{brand}' },
				children: [key === 'newsletter' ? 'Save signup' : 'Save message']
			},
			{
				tag: 'p',
				props: { style: { fontSize: '12px', color: 'var(--tt-text, #555)', margin: 0 } },
				children: ['Saved privately in your Things. This demo does not send email or contact a fictional business.']
			}
		]
	})
});

const requestAction: SuiteActionDef = {
	key: 'request',
	name: 'Save site request',
	category: 'forms',
	description: 'Saves a private request; does not book, purchase, or contact anyone.',
	inputs: [
		{ name: 'brand', label: 'Organisation', type: 'string', maxLength: 120 },
		{ name: 'intent', label: 'Request', type: 'string', required: true, maxLength: 200 }
	],
	steps: (refs) => [
		{ op: 'things.create', schema: refs.schema('request'), values: { brand: '$input.brand', intent: '$input.intent', createdAt: '$now' } },
		{ op: 'return', value: { id: '$step.1.id', message: 'Request saved. A configured integration is needed to carry it out.' } }
	],
	capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('request')] }]
};
const requestControl: SuiteComponentDef = {
	key: 'request',
	name: 'Site request',
	description: 'Saves a private request as a Thing.',
	args: [
		{ name: 'brand', label: 'Organisation', type: 'string', default: 'My site', maxLength: 120 },
		{ name: 'intent', label: 'Request', type: 'string', default: 'Get started', maxLength: 200 }
	],
	render: (refs) => ({
		tag: 'div',
		children: [
			{
				tag: 'button',
				props: { type: 'button', style: { ...fieldStyle, cursor: 'pointer', fontWeight: 700 } },
				ttAction: refs.actionKey('request'),
				ttActionInputs: { brand: '{brand}', intent: '{intent}' },
				children: ['{intent} · save request']
			},
			{ tag: 'small', children: ['Saves a private request. A configured integration carries it out.'] }
		]
	})
};

const mediaControl: SuiteComponentDef = {
	key: 'media',
	name: 'Video player',
	description: 'A native video player with an editable media URL.',
	args: [{ name: 'mediaUrl', type: 'string', label: 'Video URL', default: '', maxLength: 500 }],
	render: () => ({
		tag: 'div',
		props: { style: { display: 'grid', gap: '12px', minWidth: 0 } },
		children: [
			{
				tag: 'label',
				children: [
					'Video URL',
					{
						tag: 'input',
						props: { type: 'url', value: '{mediaUrl}', maxLength: 500, style: fieldStyle },
						ttAction: '$ui',
						ttActionInputs: { op: 'set', key: 'mediaUrl' }
					}
				]
			},
			{ ttIf: { arg: 'mediaUrl', then: { tag: 'video', props: { src: '{mediaUrl}', controls: true, preload: 'metadata', style: { width: '100%', maxHeight: '480px' } } } } },
			{ tag: 'small', children: ['Add a playable video URL to play, pause, seek, adjust volume, and use fullscreen.'] }
		]
	})
};

export const siteFormsSuite: BehaviourSuite = {
	key: SITE_FORMS_KEY,
	title: 'Site forms',
	emoji: '📮',
	tone: 'paper',
	description: 'Working newsletter and contact forms backed by your own private Things.',
	story: [
		'Enter your details and save a signup or message. Inspect the saved Thing or list your records.',
		'Connect an email or CRM integration separately when using the forms on a real site.'
	],
	schemas: [
		{
			key: 'request',
			description: 'A saved request from a site demo.',
			fields: [
				{ name: 'brand', type: 'string', maxLength: 120 },
				{ name: 'intent', type: 'string', required: true, maxLength: 200 },
				{ name: 'createdAt', type: 'date' }
			]
		},
		{
			key: 'signup',
			description: 'A saved newsletter signup.',
			fields: [
				{ name: 'brand', type: 'string', maxLength: 120 },
				{ name: 'email', type: 'string', required: true, maxLength: 200 },
				{ name: 'createdAt', type: 'date' }
			]
		},
		{
			key: 'message',
			description: 'A saved contact message.',
			fields: [
				{ name: 'brand', type: 'string', maxLength: 120 },
				{ name: 'name', type: 'string', required: true, maxLength: 80 },
				{ name: 'email', type: 'string', required: true, maxLength: 200 },
				{ name: 'message', type: 'string', required: true, maxLength: 2000 },
				{ name: 'createdAt', type: 'date' }
			]
		}
	],
	components: [
		mediaControl,
		requestControl,
		form('newsletter'),
		form('contact'),
		{
			key: 'records',
			name: 'Saved form records',
			description: 'Read saved signups and messages.',
			args: [],
			render: (refs) => ({
				tag: 'div',
				props: { style: { display: 'flex', flexWrap: 'wrap', gap: '12px' } },
				children: ['newsletter', 'contact'].map((kind) => ({
					tag: 'button',
					props: { type: 'button', style: fieldStyle },
					ttAction: refs.actionKey(`${kind}-records`),
					ttActionInputs: {},
					children: [kind === 'newsletter' ? 'Read signups' : 'Read messages']
				}))
			})
		}
	],
	actions: [
		requestAction,
		...['newsletter', 'contact'].flatMap((kind) => {
			const schema = kind === 'newsletter' ? 'signup' : 'message';
			return [
				{
					key: kind,
					name: kind === 'newsletter' ? 'Save newsletter signup' : 'Save contact message',
					category: 'forms',
					description: 'Creates a private form record. Does not send email.',
					inputs: [
						{ name: 'brand', label: 'Organisation', type: 'string' as const, default: 'My site', maxLength: 120 },
						{ name: 'email', label: 'Email', type: 'string' as const, required: true, maxLength: 200 },
						...(kind === 'contact'
							? [
									{ name: 'name', label: 'Name', type: 'string' as const, required: true, maxLength: 80 },
									{ name: 'message', label: 'Message', type: 'text' as const, required: true, maxLength: 2000 }
							  ]
							: [])
					],
					steps: (refs: Parameters<SuiteComponentDef['render']>[0]) => [
						{
							op: 'things.create',
							schema: refs.schema(schema),
							values: {
								brand: '$input.brand',
								email: '$input.email',
								createdAt: '$now',
								...(kind === 'contact' ? { name: '$input.name', message: '$input.message' } : {})
							}
						},
						{
							op: 'return',
							value: { id: '$step.1.id', message: kind === 'newsletter' ? 'Signup saved in your Things.' : 'Message saved in your Things.' }
						}
					],
					capabilities: (refs: Parameters<SuiteComponentDef['render']>[0]) => [{ capability: 'things.create', schemas: [refs.schema(schema)] }]
				},
				{
					key: `${kind}-records`,
					name: `Read ${kind} records`,
					description: 'Reads your latest twenty private records.',
					category: 'forms',
					inputs: [],
					steps: (refs: Parameters<SuiteComponentDef['render']>[0]) => [
						{ op: 'things.search', schema: refs.schema(schema), limit: 20 },
						{ op: 'return', value: '$step.1' }
					],
					capabilities: (refs: Parameters<SuiteComponentDef['render']>[0]) => [{ capability: 'things.read', schemas: [refs.schema(schema)] }]
				}
			];
		})
	],
	data: [],
	page: (ctx, refs) =>
		['newsletter', 'contact', 'request', 'media', 'records'].map((key) => ({ id: ctx.id(key), type: 'component', component: refs.component(key) }))
};
