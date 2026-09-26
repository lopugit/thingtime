import type { BehaviourSuite, SuiteComponentDef } from '../behaviourSuites';
const text = (tag: string, children: unknown[], style: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => ({
	tag,
	props: { style, ...props },
	children
});
const link = (label: string, href: string, style: Record<string, unknown> = {}) =>
	text('a', [label], { color: 'inherit', textDecoration: 'none', ...style }, { href });
const fieldStyle = {
	width: '100%',
	minWidth: 0,
	boxSizing: 'border-box',
	fontSize: '14px',
	padding: '10px 12px',
	border: '1px solid #d4d4d8',
	borderRadius: '8px',
	background: '#fff',
	color: '#18181b'
};
const each = (arg: string, node: unknown, max = 40) => ({ ttEach: { arg, node, max } });
const iff = (arg: string, then: unknown, otherwise?: unknown) => ({ ttIf: { arg, then, ...(otherwise === undefined ? {} : { else: otherwise }) } });
const button = (label: string, ttAction: string, ttActionInputs: unknown, solid = false) => ({
	tag: 'button',
	props: {
		type: 'button',
		style: { ...fieldStyle, width: 'auto', cursor: 'pointer', background: solid ? '#18181b' : '#fff', color: solid ? '#fff' : '#18181b' }
	},
	ttAction,
	ttActionInputs,
	children: [label]
});
const nav: SuiteComponentDef = {
	key: 'navigation',
	name: 'Web standards navigation',
	description: 'Reusable navigation links and an editable standards introduction.',
	args: [],
	render: () =>
		text(
			'header',
			[
				text(
					'div',
					[
						link('Thingtime / Web standards', '/p/web-standards'),
						text('span', ['2026 EDITION'], { fontSize: '10px', letterSpacing: '0.15em', color: '#71717a' })
					],
					{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }
				),
				text('h1', ['The web, made of Things.'], {
					fontSize: 'clamp(32px, 5vw, 58px)',
					fontWeight: 650,
					letterSpacing: '-0.055em',
					lineHeight: 1.06,
					margin: '30px 0 12px'
				}),
				text(
					'p',
					['Explore HTML, CSS, JavaScript and Web APIs. Try a feature, change its inputs, and reuse its editable Component and Action definitions.'],
					{ maxWidth: '650px', fontSize: '17px', lineHeight: 1.65, color: '#71717a', margin: 0 }
				),
				text(
					'nav',
					[
						link('All features', '/p/web-standards'),
						link('HTML', '/p/web-standards?language=html'),
						link('CSS', '/p/web-standards?language=css'),
						link('JavaScript', '/p/web-standards?language=javascript'),
						link('Web APIs', '/p/web-standards?language=webapi'),
						link('Interactive demos', '/p/web-standards?coverage=interactive')
					],
					{ display: 'flex', gap: '20px', flexWrap: 'wrap', padding: '24px 0', borderBottom: '1px solid #e4e4e7', fontSize: '14px' }
				)
			],
			{ color: '#18181b' }
		)
};
const explorer: SuiteComponentDef = {
	key: 'explorer',
	name: 'Standards catalogue',
	description: 'Search, language filters, coverage filters and pagination are authored Thingtime controls backed by a reusable catalogue Action.',
	args: [],
	render: () =>
		text(
			'section',
			[
				text(
					'fieldset',
					[
						text(
							'label',
							[
								'Search features',
								text('input', [], fieldStyle, { name: 'q', value: '{result.q}', placeholder: 'Try grid, dialog, Array, WebSocket…' })
							],
							{ display: 'grid', gap: '6px', flex: '2 1 260px', fontSize: '12px', color: '#52525b' }
						),
						text(
							'label',
							[
								'Language',
								text(
									'select',
									[
										text('option', ['All languages'], {}, { value: '' }),
										...['html', 'css', 'javascript', 'webapi'].map((name) => text('option', [name], {}, { value: name }))
									],
									fieldStyle,
									{ name: 'language', value: '{result.language}' }
								)
							],
							{ display: 'grid', gap: '6px', flex: '1 1 140px', fontSize: '12px', color: '#52525b' }
						),
						text(
							'label',
							[
								'Examples',
								text(
									'select',
									[
										text('option', ['All coverage'], {}, { value: '' }),
										text('option', ['Interactive demos'], {}, { value: 'interactive' }),
										text('option', ['Inspection only'], {}, { value: 'inspection' }),
										text('option', ['Needs context'], {}, { value: 'requires-context' })
									],
									fieldStyle,
									{ name: 'coverage', value: '{result.coverage}' }
								)
							],
							{ display: 'grid', gap: '6px', flex: '1 1 160px', fontSize: '12px', color: '#52525b' }
						),
						button('Explore', '$ui', { op: 'query', form: true, params: { q: '{q}', language: '{language}', coverage: '{coverage}' } }, true)
					],
					{ border: 0, padding: 0, margin: '24px 0', display: 'flex', alignItems: 'end', gap: '12px', flexWrap: 'wrap', minWidth: 0 }
				),
				iff(
					'result.selected',
					link('← Back to results', '{result.back}', { fontSize: '13px' }),
					text('div', [
						text(
							'div',
							[
								text('span', ['{result.matched} entries'], { fontWeight: 600 }),
								text('span', ['Page {result.page} of {result.pages} · snapshot {result.generatedAt}'], { color: '#71717a', fontSize: '12px' })
							],
							{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }
						),
						text(
							'div',
							[
								each(
									'result.cards',
									text(
										'a',
										[
											text(
												'div',
												[
													text('span', ['{item.language} / {item.kind}'], {
														fontSize: '10px',
														textTransform: 'uppercase',
														letterSpacing: '0.08em',
														color: '#71717a'
													}),
													text('span', ['↗'], { fontSize: '12px' })
												],
												{ display: 'flex', justifyContent: 'space-between', gap: '10px' }
											),
											text('strong', ['{item.name}'], { fontSize: '16px', fontWeight: 600, overflowWrap: 'anywhere' }),
											text('span', ['{item.group}'], { fontSize: '12px', color: '#71717a', overflowWrap: 'anywhere' }),
											text('span', ['{item.coverage}'], { fontSize: '11px', color: '#52525b', paddingTop: '10px' })
										],
										{
											display: 'grid',
											gap: '8px',
											padding: '18px',
											border: '1px solid #e4e4e7',
											borderRadius: '12px',
											color: '#18181b',
											textDecoration: 'none',
											minWidth: 0
										},
										{ href: '{item.href}' }
									),
									18
								)
							],
							{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: '12px' }
						),
						text(
							'nav',
							[iff('result.hasPrevious', link('← Previous', '{result.previous}')), iff('result.hasNext', link('Next →', '{result.next}'))],
							{ display: 'flex', justifyContent: 'space-between', padding: '24px 0', fontSize: '14px' }
						)
					])
				),
				text(
					'details',
					[
						text('summary', ['About this inventory'], { cursor: 'pointer', fontSize: '13px' }),
						text(
							'p',
							[
								'Standards status and browser support are different. Published drafts are labelled as drafts. Internal specification clauses are references, not public APIs. “Inspection” and “needs context” entries are coverage gaps, not completed demonstrations.'
							],
							{ fontSize: '13px', color: '#71717a' }
						),
						text('div', [each('result.standards', link('{item.name} ↗', '{item.href}', { fontSize: '12px', textDecoration: 'underline' }), 5)], {
							display: 'flex',
							gap: '14px',
							flexWrap: 'wrap'
						})
					],
					{ marginTop: '24px' }
				)
			],
			{ minWidth: 0 }
		)
};
const detail: SuiteComponentDef = {
	key: 'workbench',
	name: 'Feature workbench',
	description:
		'A reusable feature detail layout. The isolated Web Platform primitive receives a complete editable program from the catalogue Action.',
	args: [],
	render: (refs) =>
		text('section', [
			iff(
				'result.selected',
				text(
					'article',
					[
						text('div', ['{result.selected.language} / {result.selected.kind}'], {
							fontSize: '11px',
							letterSpacing: '0.12em',
							textTransform: 'uppercase',
							color: '#71717a'
						}),
						text('h2', ['{result.selected.name}'], {
							fontSize: 'clamp(24px, 4vw, 36px)',
							letterSpacing: '-0.04em',
							margin: 0,
							overflowWrap: 'anywhere'
						}),
						text('p', ['{result.selected.description}'], { color: '#52525b', margin: 0 }),
						text(
							'div',
							[
								text('span', ['{result.selected.status}'], { fontSize: '12px' }),
								link('Read the standard ↗', '{result.selected.spec}', { fontSize: '12px', textDecoration: 'underline' })
							],
							{ display: 'flex', gap: '20px', flexWrap: 'wrap' }
						),
						text('p', ['{result.selected.note}'], {
							fontSize: '13px',
							color: '#71717a',
							padding: '12px 14px',
							background: '#f4f4f5',
							borderRadius: '8px'
						}),
						{ tag: 'tt-web-platform', props: { program: { ttArg: 'result.selected.program' }, name: 'program' } },
						text(
							'div',
							[
								button('Save edited component', refs.actionKey('save-draft'), {}, true),
								iff('last.result.id', link('Open saved Thing →', '/thing/{last.result.id}', { fontSize: '13px', textDecoration: 'underline' }))
							],
							{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', paddingTop: '20px', borderTop: '1px solid #e4e4e7' }
						),
						text('p', ['Save your edited program and current inputs as a private Component Thing, then add it to any builder page.'], {
							fontSize: '12px',
							color: '#71717a'
						}),
						text('details', [
							text('summary', ['Definition and source links'], { cursor: 'pointer', fontSize: '13px' }),
							text('pre', [{ ttFormat: { arg: 'result.selected.program', kind: 'json' } }], {
								fontSize: '11px',
								whiteSpace: 'pre-wrap',
								overflowWrap: 'anywhere',
								maxHeight: '260px',
								overflow: 'auto'
							}),
							each(
								'result.selected.references',
								text('a', [{ ttArg: 'item' }], { display: 'block', fontSize: '11px', overflowWrap: 'anywhere' }, { href: { ttArg: 'item' } }),
								8
							)
						])
					],
					{ display: 'grid', gap: '16px', padding: '28px 0', minWidth: 0 }
				)
			)
		])
};
export const webStandardsSuite: BehaviourSuite = {
	key: 'web-standards',
	title: 'Web standards',
	emoji: '🧩',
	description: 'HTML, CSS, JavaScript and Web APIs as searchable, editable Thingtime programs. Coverage and browser support are explicit.',
	story: [
		'Browse the versioned standards inventory.',
		'Run interactive examples with editable inputs.',
		'Save a private reusable Component Thing and compose it in Builder.'
	],
	tone: 'paper',
	app: { entry: 'home', tagline: 'The web, made of Things.' },
	schemas: [],
	components: [nav, explorer, detail],
	data: [],
		actions: [
		{
			key: 'catalogue',
			name: 'Browse web standards',
			description: 'Pure read-only search over the versioned standards snapshot; returns metadata and a declarative demo program.',
			category: 'Web standards',
			inputs: [
				{ name: 'q', type: 'string', label: 'Search', default: '' },
				{ name: 'language', type: 'string', label: 'Language', default: '' },
				{ name: 'coverage', type: 'string', label: 'Coverage', default: '' },
				{ name: 'page', type: 'number', label: 'Page', default: 1 },
				{ name: 'feature', type: 'string', label: 'Feature ID', default: '' }
			],
			steps: () => [
				{
					op: 'return',
					value: {
						ttExpr: [
							'webstandards.browse',
							{ q: '$input.q', language: '$input.language', coverage: '$input.coverage', page: '$input.page', feature: '$input.feature' }
						]
					}
				}
			],
			capabilities: () => [],
			limits: { maxResultBytes: 65536 }
		},
		{
			key: 'save-component',
			name: 'Save web standard component',
			description: 'Create one private, editable component using the chosen standard feature’s full declarative program.',
			category: 'Web standards',
			runtime: 'browser',
			inputs: [{ name: 'feature', type: 'string', label: 'Feature ID', required: true }],
			steps: (refs) => [
				{
					op: 'http.request',
					method: 'POST',
					path: '/api/v1/actions/run',
					feature: 'api.actions-run',
					minimumVersion: '1.10.0',
					query: {},
					body: { action: refs.actionKey('catalogue'), inputs: { feature: '$input.feature' } }
				},
				{
					op: 'http.request',
					method: 'POST',
					path: '/api/v1/things',
					feature: 'api.things',
					minimumVersion: '1.31.0',
					query: {},
					body: { thingtime: ['component'], acl: ['tt:user'], crystal: '$step.1.result.selected.component' }
				},
				{ op: 'return', value: { id: '$step.2.thing.id', name: '$step.2.thing.crystal.name', silent: true } }
			],
			capabilities: () => [{ capability: 'http.request', endpoints: ['POST /api/v1/actions/run', 'POST /api/v1/things'] }]
		},
		{
			key: 'save-draft',
			name: 'Save edited web component',
			description: 'Save the complete authored Web Platform program, with current inputs as defaults, as a private reusable Component.',
			category: 'Web standards',
			runtime: 'browser',
			inputs: [{ name: 'program', type: 'json', label: 'Web Platform program', required: true }],
			limits: { maxInputBytes: 65536 },
			steps: () => [
				{
					op: 'http.request',
					method: 'POST',
					path: '/api/v1/things',
					feature: 'api.things',
					minimumVersion: '1.32.0',
					query: {},
					body: {
						thingtime: ['component'], acl: ['tt:user'],
						crystal: {
							name: { ttExpr: ['slice', { ttExpr: ['coalesce', { ttExpr: ['get', '$input.program', 'title'] }, 'Web Platform program'] }, 0, 60] },
							description: 'An editable Web Platform program with saved input defaults.',
							category: 'Web standards', args: [],
							render: { tag: 'tt-web-platform', props: { program: '$input.program' } }
						}
					}
				},
				{ op: 'return', value: { id: '$step.1.thing.id', name: '$step.1.thing.crystal.name', silent: true } }
			],
			capabilities: () => [{ capability: 'http.request', endpoints: ['POST /api/v1/things'] }]
		}
	],
	pages: [
		{
			key: 'home',
			name: 'Web standards',
			description: 'Explore the web platform through reusable Thingtime components.',
			blocks: (ctx, refs) => [
				{
					id: ctx.id('shell'),
					type: 'container',
					direction: 'column',
					gap: 0,
					maxWidth: 1120,
					align: 'center',
					css: { padding: '28px 20px 80px', width: '100%', 'min-width': '0', color: '#18181b', background: '#fff' },
					children: [
						{ id: ctx.id('navigation'), type: 'component', component: refs.component('navigation') },
						...['explorer', 'workbench'].map((key) => ({
							id: ctx.id(key),
							type: 'component' as const,
							component: refs.component(key),
							source: {
								action: refs.actionKey('catalogue'),
								inputs: {
									q: '{query.q}',
									language: '{query.language}',
									coverage: '{query.coverage}',
									page: '{query.page}',
									feature: '{query.feature}'
								}
							}
						}))
					]
				}
			]
		}
	]
};
