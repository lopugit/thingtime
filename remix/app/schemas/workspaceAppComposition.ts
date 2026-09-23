// One-time authoring of a Builder app as ordinary saved Things. The runtime
// never imports this file: after installation every screen and request is
// independently editable, copyable JSON. Legacy endpoint names are compatibility
// details; they do not create a new application kind.
import { deriveRequiredCapabilities } from '../components/Actions/actionInspect';
import { SERVICE_FIELDS, SERVICE_KINDS, SERVICE_LABELS } from './serviceWorkspace';

type Json = any;
const e = (tag: string, children: Json[] = [], props: Json = {}): Json => ({ tag, props, children });
const x = (name: string, ...args: Json[]): Json => ({ ttExpr: [name, ...args] });
const arg = (name: string): Json => ({ ttArg: name });
const test = (name: string, then: Json, otherwise?: Json): Json => ({
	ttIf: { arg: name, then, ...(otherwise === undefined ? {} : { else: otherwise }) }
});
const equal = (name: string, value: Json, then: Json, otherwise?: Json): Json => ({
	ttIf: { arg: name, equals: value, then, ...(otherwise === undefined ? {} : { else: otherwise }) }
});
const each = (name: string, node: Json, empty: Json = 'No matching records.'): Json => ({ ttEach: { arg: name, max: 40, node, empty } });
const grid = { display: 'grid', gap: '12px', minWidth: 0 };
const row = { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' };
const inputStyle = { width: '100%', minWidth: 0, padding: '10px', border: '1px solid #cbd5cd', borderRadius: '8px', boxSizing: 'border-box' };
const cardStyle = { ...grid, padding: '18px', border: '1px solid #dce5df', borderRadius: '14px', background: '#fff', overflowWrap: 'anywhere' };
const link = (label: string, href: string): Json =>
	e('a', [label], { href, style: { color: '#24583d', textDecoration: 'underline', padding: '5px 0' } });
const button = (label: string, action: string, inputs: Json = {}): Json => ({
	...e('button', [label], {
		type: 'button',
		style: { padding: '10px 14px', border: '1px solid #bacdbf', borderRadius: '8px', background: '#eff6f0' }
	}),
	ttAction: action,
	ttActionInputs: inputs
});
const local = (name: string, control: Json): Json => ({ ...control, ttAction: '$ui', ttActionInputs: { op: 'set', key: name } });
const hidden = (name: string, value: Json): Json => e('input', [], { type: 'hidden', name, value });
const s = (name: string, extra: Json = {}): Json => ({ name, type: 'string', ...extra });
const title = (record: string): Json =>
	x(
		'coalesce',
		`${record}.values.title`,
		x('trim', x('concat', `${record}.values.firstName`, ' ', `${record}.values.lastName`)),
		`${record}.values.username`,
		`${record}.values.address`,
		`${record}.kind`
	);
const endpoint = '/api/v1/builder/workspaces';
const req = (body?: Json): Json => ({
	op: 'http.request',
	method: body ? 'POST' : 'GET',
	path: endpoint,
	feature: 'api.builder-workspaces',
	minimumVersion: '1.0.1',
	...(body
		? { body }
		: {
				query: { rootId: '$input.rootId' },
				pagination: { cursorParam: 'cursor', cursorPath: 'nextCursor', itemsPath: 'records', itemKey: 'id', maxPages: 20, maxItems: 5000 }
		  })
});
const calc = (value: Json): Json => ({ op: 'compute', value });
const ret = (value: Json): Json => ({ op: 'return', value });

export type WorkspaceAppDefinition = { thingtime: ['action'] | ['component']; crystal: Record<string, any> };
export function workspaceAppComposition({ namespace, rootId, pagePath }: { namespace: string; rootId: string; pagePath: string }) {
	if (!/^[a-z][a-z0-9-]{0,35}$/.test(namespace) || !/^[A-Za-z0-9_-]{1,160}$/.test(rootId) || !/^\/p\/[A-Za-z0-9_-]+$/.test(pagePath))
		throw new Error('Use a namespace, existing root id and Builder page path');
	const definitions: WorkspaceAppDefinition[] = [];
	const key = (name: string) => `${namespace}-${name}`;
	const source = {
		action: key('read'),
		inputs: Object.fromEntries(
			['view', 'id', 'page', 'q', 'date', 'status', 'employee', 'period', 'mediaCursor']
				.map((name) => [name, `{query.${name}}`])
				.concat([['rootId', '{rootId}']])
		),
		refresh: 'load'
	};
	const action = (name: string, inputs: Json[], steps: Json[]) =>
		definitions.push({
			thingtime: ['action'],
			crystal: {
				name,
				actionKey: key(name),
				runtime: 'browser',
				...(name === 'read' ? { expressionLimits: { nodes: 1000000, listItems: 5000 } } : {}),
				inputs,
				capabilities: deriveRequiredCapabilities(steps),
				limits: { timeoutMs: 30000, maxOperations: 100, maxChildActions: 20, maxResultBytes: 4194304 },
				steps
			}
		});
	const component = (name: string, label: string, children: Json[], view?: string) =>
		definitions.push({
			thingtime: ['component'],
			crystal: {
				name: label,
				componentKey: key(name),
				description: 'Editable Builder composition. Layout, labels, fields and Action bindings are saved in this Component.',
				args: [s('rootId', { default: rootId }), s('pagePath', { default: pagePath })],
				source,
				render: e('section', view ? [equal('result.view', view, e('div', children, { style: grid }))] : children, {
					style: { ...grid, color: '#203e2c', fontFamily: 'system-ui, sans-serif' }
				})
			}
		});
	const editable = test('result.canEdit', link('Edit', '{pagePath}?view=edit&id={item.id}'));
	const recordCard = e(
		'article',
		[
			e('strong', ['{item.title}']),
			e('span', ['{item.values.date} {item.values.time} · {item.values.status}']),
			e('p', ['{item.values.description}']),
			e('div', [link('Open', '{pagePath}?view=detail&id={item.id}'), editable], { style: row })
		],
		{ style: cardStyle }
	);
	const mapRecords = (list: Json) => x('map', list, x('merge', '$item', { title: title('$item') }));
	const activeKind = (kind: string) => x('filter', '$step.1.records', x('and', x('eq', '$item.kind', kind), x('not', '$item.values.archived')));
	const view = x('coalesce', '$input.view', 'overview');
	action(
		'read',
		[s('rootId', { required: true }), ...['view', 'id', 'page', 'q', 'date', 'status', 'employee', 'period', 'mediaCursor'].map((name) => s(name))],
		[
			req(),
			calc(x('find', '$step.1.records', x('eq', '$item.id', '$input.id'))),
			calc(
				x(
					'filter',
					'$step.1.records',
					x(
						'and',
						x(
							'if',
							x('eq', view, 'trash'),
							'$item.values.archived',
							x(
								'and',
								x('not', '$item.values.archived'),
								x('eq', '$item.kind', x('if', x('eq', view, 'planner'), 'visit', x('if', x('eq', view, 'maps'), 'address', view)))
							)
						),
						x('includes', x('lower', x('join', x('values', '$item.values'), ' ')), x('lower', x('coalesce', '$input.q', ''))),
						x('or', x('isEmpty', '$input.status'), x('eq', '$item.values.status', '$input.status')),
						x('or', x('isEmpty', '$input.employee'), x('eq', '$item.values.employeeId', '$input.employee'))
					)
				)
			),
			calc(mapRecords(x('sortBy', '$step.3', x('coalesce', '$item.values.date', title('$item'))))),
			calc(x('max', 1, x('min', x('coalesce', x('toNumber', '$input.page'), 1), x('ceil', x('div', x('length', '$step.4'), 12))))),
			calc(Object.fromEntries(SERVICE_KINDS.map((kind) => [kind, mapRecords(activeKind(kind))]))),
			calc(x('dateParts', '$now', '$step.1.timeZone')),
			calc(
				x(
					'coalesce',
					'$input.date',
					x('concat', '$step.7.year', '-', x('padStart', '$step.7.month', 2, '0'), '-', x('padStart', '$step.7.day', 2, '0'))
				)
			),
			calc({
				view,
				rootId: '$input.rootId',
				name: '$step.1.name',
				role: '$step.1.role',
				timeZone: '$step.1.timeZone',
				owner: '$step.1.owner',
				canEdit: x(
					'and',
					x('includes', ['Admin', 'Employee', 'Lopu'], '$step.1.role'),
					x('or', x('eq', '$step.1.role', 'Admin'), x('and', x('ne', view, 'member'), x('ne', view, 'new-member'), x('ne', '$step.2.kind', 'member')))
				),
				record: '$step.2',
				recordTitle: title('$step.2'),
				recordFields: x(
					'map',
					x(
						'get',
						Object.fromEntries(SERVICE_KINDS.map((kind) => [kind, SERVICE_FIELDS[kind].map((field) => ({ key: field.key, label: field.label }))])),
						'$step.2.kind'
					),
					{ label: '$item.label', value: x('get', '$step.2.values', '$item.key') }
				),
				records: x('slice', '$step.4', x('mul', x('sub', '$step.5', 1), 12), x('mul', '$step.5', 12)),
				total: x('length', '$step.4'),
				page: '$step.5',
				previous: x('max', 1, x('sub', '$step.5', 1)),
				next: x('add', '$step.5', 1),
				hasNext: x('gt', x('length', '$step.4'), x('mul', '$step.5', 12)),
				options: '$step.6',
				counts: Object.fromEntries(SERVICE_KINDS.map((kind) => [kind, x('length', `$step.6.${kind}`)])),
				mapsConfigured: '$step.1.mapsConfigured',
				mapsEnvironmentId: '$step.1.mapsEnvironmentId',
				mapsEnvironments: '$step.1.mapsEnvironments',
				mapsBrowserKey: '$step.1.mapsBrowserKey',
				team: '$step.1.team',
				date: '$step.8',
				previousDate: x('isoDate', x('dateAdd', '$step.8', -7, 'day')),
				nextDate: x('isoDate', x('dateAdd', '$step.8', 7, 'day')),
				days: Array.from({ length: 7 }, (_, i) => {
					const date = x('isoDate', x('dateAdd', '$step.8', i, 'day'));
					return {
						date,
						label: x('formatDate', date, 'weekday'),
						records: x('slice', x('filter', '$step.4', x('eq', '$item.values.date', date)), 0, 12),
						total: x('count', '$step.4', x('eq', '$item.values.date', date))
					};
				})
			}),
			{
				op: 'each',
				action: key('place'),
				list: x('filter', '$step.9.records', '$item.values.placeId'),
				inputs: { rootId: '$input.rootId', recordId: '$item.id', title: '$item.title' },
				max: 12,
				when: x('and', x('eq', view, 'maps'), '$step.1.mapsConfigured')
			},
			{
				op: 'http.request',
				method: 'GET',
				path: '/api/v1/things',
				feature: 'api.things',
				minimumVersion: '1.24.0',
				query: { target: '$input.id', thingtime: 'comment', limit: 12, cursor: '$input.mediaCursor' },
				when: x('and', x('eq', view, 'detail'), x('not', x('isEmpty', '$input.id')))
			},
			ret(x('merge', '$step.9', { mapPoints: '$step.10', media: '$step.11.things', mediaCursor: '$step.11.nextCursor' }))
		]
	);
	component('navigation', 'App navigation', [
		e(
			'header',
			[
				e('h1', ['{result.name}'], { style: { fontSize: '28px', fontWeight: 750 } }),
				e('p', ['{result.timeZone}']),
				e(
					'tt-dialog',
					[
						e(
							'nav',
							[
								['overview', 'Overview'],
								['planner', 'Planner'],
								...SERVICE_KINDS.map((kind) => [kind, SERVICE_LABELS[kind]]),
								['maps', 'Map'],
								['setup', 'Setup'],
								['trash', 'Trash']
							].map(([view, label]) => link(label, `{pagePath}?view=${view}`)),
							{ style: grid, 'aria-label': 'App navigation' }
						)
					],
					{ name: 'Menu', title: 'Navigate', type: 'drawer' }
				)
			],
			{ style: grid }
		),
		equal('state', 'error', e('p', ['{error}'], { role: 'alert' })),
		equal('state', 'signed-out', link('Sign in', '/login')),
		equal('state', 'not-installed', e('p', ['Copy this app to your account to use its Actions.'])),
		equal('state', 'loading', e('p', ['Opening app…'], { role: 'status' }))
	]);
	component(
		'overview',
		'Overview',
		[
			e('h2', ['Overview']),
			e(
				'div',
				SERVICE_KINDS.map((kind) =>
					e('article', [e('h3', [SERVICE_LABELS[kind]]), e('strong', [`{result.counts.${kind}}`]), link('Open', `{pagePath}?view=${kind}`)], {
						style: cardStyle
					})
				),
				{ style: { ...grid, gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' } }
			)
		],
		'overview'
	);
	for (const kind of SERVICE_KINDS) {
		const fields = SERVICE_FIELDS[kind];
		const mediaFields = ['customer', 'address', 'equipment'].includes(kind) ? ['thumbnailId', 'bannerId', 'placeId'] : [];
		const inputs = [
			s('rootId', { required: true }),
			s('id', { required: true }),
			s('expectedUpdatedAt'),
			...fields.map((field) => s(field.key, { required: !!field.required, maxLength: field.type === 'textarea' ? 10000 : 500 })),
			...mediaFields.map((name) => s(name))
		];
		action(`save-${kind}`, inputs, [
			req({
				operation: 'save',
				rootId: '$input.rootId',
				kind,
				id: '$input.id',
				expectedUpdatedAt: '$input.expectedUpdatedAt',
				values: Object.fromEntries([...fields.map((field) => field.key), ...mediaFields].map((name) => [name, `$input.${name}`]))
			}),
			ret({ id: '$step.1.id', message: `${SERVICE_LABELS[kind]} saved`, title: 'Saved' })
		]);
		component(
			`list-${kind}`,
			SERVICE_LABELS[kind],
			[
				e('h2', [SERVICE_LABELS[kind]]),
				test('result.canEdit', link('Add record', `{pagePath}?view=new-${kind}`)),
				e(
					'div',
					[
						local(
							'filter',
							e('input', [], { type: 'search', 'aria-label': 'Search records', placeholder: 'Search records', value: '{filter}', style: inputStyle })
						),
						button('Search', '$ui', { op: 'query', params: { view: kind, q: '{filter}' } })
					],
					{ style: row }
				),
				e('p', ['{result.total} records · page {result.page}']),
				each('result.records', recordCard),
				e(
					'div',
					[
						button('Previous', '$ui', { op: 'query', params: { view: kind, page: '{result.previous}', q: '{query.q}' } }),
						test('result.hasNext', button('Next', '$ui', { op: 'query', params: { view: kind, page: '{result.next}', q: '{query.q}' } }))
					],
					{ style: row }
				)
			],
			kind
		);
		const fieldNodes = fields.map((field) => {
			const props: Json = { name: field.key, required: !!field.required, value: arg(`result.record.values.${field.key}`), style: inputStyle };
			const child = field.ref
				? e('tt-select', [], { ...props, title: field.label, optionsPath: `result.options.${field.ref}` })
				: field.options
				? e(
						'select',
						[
							e('option', ['Choose…'], { value: '' }),
							...(field.options
								? field.options.map((value) => e('option', [value], { value }))
								: [each(`result.options.${field.ref}`, e('option', ['{item.title}'], { value: '{item.id}' }), '')])
						],
						props
				  )
				: e(field.type === 'textarea' ? 'textarea' : 'input', [], {
						...props,
						type: field.type || 'text',
						maxLength: field.type === 'textarea' ? 10000 : 500,
						...(field.min === undefined ? {} : { min: field.min }),
						...(field.max === undefined ? {} : { max: field.max }),
						...(field.type === 'number' ? { step: 'any' } : {})
				  });
			return e('label', [field.label + (field.required ? ' *' : ''), child], { style: grid });
		});
		const form = e(
			'tt-form',
			[
				hidden('rootId', '{rootId}'),
				...mediaFields.map((name) => hidden(name, `{result.record.values.${name}}`)),
				...fieldNodes,
				button('Save', key(`save-${kind}`)),
				test('last.ok', link('Open saved record', '{pagePath}?view=detail&id={last.result.id}'))
			],
			{
				identityName: 'id',
				identity: '{result.record.id}',
				revisionName: 'expectedUpdatedAt',
				revision: '{result.record.updatedAt}',
				resetKey: '{formVersion}'
			}
		);
		component(`form-${kind}`, `${SERVICE_LABELS[kind]} form`, [
			equal(
				'result.view',
				`new-${kind}`,
				e('div', [e('h2', [`Add ${kind}`]), form, button('Start another', '$ui', { op: 'increment', key: 'formVersion' })], { style: cardStyle })
			),
			equal('result.view', 'edit', equal('result.record.kind', kind, e('div', [e('h2', ['Edit {result.recordTitle}']), form], { style: cardStyle })))
		]);
	}
	action(
		'archive',
		[
			s('rootId', { required: true }),
			s('id', { required: true }),
			s('expectedUpdatedAt', { required: true }),
			{ name: 'archived', type: 'boolean', default: true }
		],
		[
			req({
				operation: 'archive',
				rootId: '$input.rootId',
				id: '$input.id',
				expectedUpdatedAt: '$input.expectedUpdatedAt',
				archived: '$input.archived'
			}),
			ret({ message: 'Record updated' })
		]
	);
	component(
		'detail',
		'Record detail',
		[
			test(
				'result.record',
				e(
					'article',
					[
						e('h2', ['{result.recordTitle}']),
						e('dl', [
							each(
								'result.recordFields',
								e('div', [e('dt', ['{item.label}']), e('dd', [{ ttFormat: { arg: 'item.value', kind: 'text' } }])], { style: grid })
							)
						]),
						test(
							'result.canEdit',
							e(
								'div',
								[
									link('Edit', '{pagePath}?view=edit&id={result.record.id}'),
									e(
										'tt-dialog',
										[
											e('p', ['Archive this record? You can restore it from Trash.']),
											button('Archive', key('archive'), {
												rootId: '{rootId}',
												id: '{result.record.id}',
												expectedUpdatedAt: '{result.record.updatedAt}'
											})
										],
										{ name: 'Archive…', title: 'Archive record' }
									)
								],
								{ style: row }
							)
						),
						link('Open Thing', '/thing/{result.record.id}')
					],
					{ style: cardStyle }
				),
				e('p', ['This record is unavailable.'])
			)
		],
		'detail'
	);
	component(
		'trash',
		'Trash',
		[
			e('h2', ['Trash']),
			each(
				'result.records',
				e(
					'article',
					[
						e('strong', ['{item.title}']),
						test(
							'result.canEdit',
							button('Restore', key('archive'), { rootId: '{rootId}', id: '{item.id}', expectedUpdatedAt: '{item.updatedAt}', archived: false })
						)
					],
					{ style: cardStyle }
				)
			),
			test('result.hasNext', link('Next', '{pagePath}?view=trash&page={result.next}'))
		],
		'trash'
	);

	action(
		'move',
		[
			s('rootId', { required: true }),
			s('id', { required: true }),
			s('expectedUpdatedAt', { required: true }),
			s('date', { required: true }),
			s('time'),
			{ name: 'order', type: 'number', required: true }
		],
		[
			req({
				operation: 'move',
				rootId: '$input.rootId',
				id: '$input.id',
				expectedUpdatedAt: '$input.expectedUpdatedAt',
				date: '$input.date',
				time: '$input.time',
				order: '$input.order'
			}),
			ret({ message: 'Visit moved' })
		]
	);
	component(
		'planner',
		'Planner',
		[
			e('h2', ['Planner']),
			e('p', ['{result.timeZone} · choose a date to view seven days.']),
			e(
				'div',
				[
					link('Previous week', '{pagePath}?view=planner&date={result.previousDate}'),
					local('plannerDate', e('input', [], { type: 'date', value: '{result.date}', 'aria-label': 'Planner date', style: inputStyle })),
					button('Go', '$ui', { op: 'query', params: { view: 'planner', date: '{plannerDate}' } }),
					link('Next week', '{pagePath}?view=planner&date={result.nextDate}'),
					test('result.canEdit', link('Schedule a visit', '{pagePath}?view=new-visit'))
				],
				{ style: row }
			),
			e(
				'div',
				[
					local('filter', e('input', [], { type: 'search', placeholder: 'Search visits', value: '{filter}', style: inputStyle })),
					button('Filter', '$ui', { op: 'query', params: { view: 'planner', q: '{filter}', date: '{result.date}' } })
				],
				{ style: row }
			),
			e(
				'div',
				[
					each(
						'result.days',
						e(
							'section',
							[
								e('h3', ['{item.label}']),
								e('p', ['{item.date} · {item.total} visits']),
								each('item.records', recordCard, 'No matching visits.'),
								e('p', ['Use Visits to browse every matching record.'])
							],
							{ style: cardStyle }
						)
					)
				],
				{ style: { ...grid, gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))' } }
			)
		],
		'planner'
	);
	component(
		'move-form',
		'Reschedule visit',
		[
			equal(
				'result.record.kind',
				'visit',
				test(
					'result.canEdit',
					e(
						'tt-dialog',
						[
							e(
								'tt-form',
								[
									hidden('rootId', '{rootId}'),
									hidden('id', '{result.record.id}'),
									e('label', [
										'Date',
										e('input', [], { type: 'date', name: 'date', required: true, value: '{result.record.values.date}', style: inputStyle })
									]),
									e('label', ['Time', e('input', [], { type: 'time', name: 'time', value: '{result.record.values.time}', style: inputStyle })]),
									e('label', [
										'Order within day',
										e('input', [], { type: 'number', name: 'order', step: 'any', value: '{result.record.values.order}', style: inputStyle })
									]),
									button('Move visit', key('move'))
								],
								{ revisionName: 'expectedUpdatedAt', revision: '{result.record.updatedAt}', identity: '{result.record.id}' }
							)
						],
						{ name: 'Move visit…', title: 'Move visit' }
					)
				)
			)
		],
		'detail'
	);
	action(
		'maps-setup',
		[s('rootId', { required: true }), s('environmentId')],
		[
			req({
				operation: 'configureMaps',
				rootId: '$input.rootId',
				environmentId: x('if', x('eq', '$input.environmentId', '__disabled__'), null, '$input.environmentId')
			}),
			ret({ message: 'Map environment saved' })
		]
	);
	component(
		'setup',
		'App setup',
		[
			e('h2', ['Setup']),
			e('p', ['Records use {result.timeZone}.']),
			test(
				'result.owner',
				e(
					'fieldset',
					[
						hidden('rootId', '{rootId}'),
						e('label', [
							'Map environment',
							e(
								'select',
								[
									e('option', ['Automatic'], { value: '__auto__' }),
									e('option', ['Disabled'], { value: '__disabled__' }),
									each('result.mapsEnvironments', e('option', ['{item.name}'], { value: '{item.id}' }), '')
								],
								{ name: 'environmentId', value: '{result.mapsEnvironmentId}', style: inputStyle }
							)
						]),
						button('Save map environment', key('maps-setup')),
						link('Manage Vault environments', '/vault')
					],
					{ style: cardStyle }
				),
				e('p', ['Only the app owner can change map configuration.'])
			)
		],
		'setup'
	);
	action(
		'place',
		[s('rootId', { required: true }), s('recordId', { required: true }), s('title')],
		[
			req({ operation: 'place', rootId: '$input.rootId', recordId: '$input.recordId' }),
			ret({
				lat: '$step.1.location.latitude',
				lng: '$step.1.location.longitude',
				title: '$input.title',
				href: x('concat', pagePath, '?view=detail&id=', '$input.recordId')
			})
		]
	);
	component(
		'map',
		'Map',
		[
			e('h2', ['Map']),
			test(
				'result.mapsConfigured',
				e(
					'div',
					[
						e(
							'div',
							[
								local('filter', e('input', [], { type: 'search', placeholder: 'Search addresses', value: '{filter}', style: inputStyle })),
								button('Search', '$ui', { op: 'query', params: { view: 'maps', q: '{filter}' } })
							],
							{ style: row }
						),
						e('p', ['{result.total} matching addresses · page {result.page}. Only addresses with a selected map location have markers.']),
						e('tt-map', [], {
							apiKey: arg('result.mapsBrowserKey'),
							points: arg('result.mapPoints'),
							title: 'Address map',
							latitude: -37.81,
							longitude: 144.96,
							zoom: 11
						}),
						each('result.records', recordCard),
						e(
							'div',
							[
								button('Previous', '$ui', { op: 'query', params: { view: 'maps', page: '{result.previous}', q: '{query.q}' } }),
								test('result.hasNext', button('Next', '$ui', { op: 'query', params: { view: 'maps', page: '{result.next}', q: '{query.q}' } }))
							],
							{ style: row }
						)
					],
					{ style: grid }
				),
				e('p', [link('Choose a map environment in Setup', '{pagePath}?view=setup')])
			)
		],
		'maps'
	);
	action(
		'save-media',
		[
			s('id', { required: true }),
			s('shareId', { required: true }),
			s('stage'),
			s('title'),
			s('description', { maxLength: 3000 }),
			s('attachmentIds', { required: true })
		],
		[
			{ op: 'fail', message: 'Choose at least one attachment.', when: x('isEmpty', '$input.attachmentIds') },
			{
				op: 'http.request',
				method: 'POST',
				path: '/api/v1/things/comment',
				feature: 'api.things-comment',
				minimumVersion: '1.7.0',
				body: {
					id: '$input.id',
					shareId: '$input.shareId',
					text: x(
						'concat',
						'[',
						x('coalesce', '$input.stage', 'Gallery'),
						'] ',
						x('coalesce', '$input.title', 'Media'),
						'\n',
						x('coalesce', '$input.description', '')
					),
					attachmentIds: x('split', '$input.attachmentIds', ',')
				}
			},
			ret({ targetId: '$input.id', committedIds: x('split', '$input.attachmentIds', ','), message: 'Media saved', silent: true })
		]
	);
	const mediaEntry = e(
		'article',
		[e('p', ['{item.crystal.text}']), e('tt-media', [], { attachments: arg('item.attachments'), postId: '{item.id}' })],
		{ style: cardStyle }
	);
	component(
		'media',
		'Record media',
		[
			test(
				'result.record',
				e(
					'div',
					[
						e('h2', ['Photos & attachments']),
						e('div', [each('result.media', mediaEntry, 'No media on this page.')], { style: grid }),
						e(
							'div',
							[
								button('First media page', '$ui', { op: 'query', params: { view: 'detail', id: '{result.record.id}' } }),
								test(
									'result.mediaCursor',
									button('More media', '$ui', {
										op: 'query',
										params: { view: 'detail', id: '{result.record.id}', mediaCursor: '{result.mediaCursor}' }
									})
								)
							],
							{ style: row }
						),
						test(
							'result.canEdit',
							e(
								'details',
								[
									e('summary', ['Add media']),
									e(
										'tt-form',
										[
											hidden('id', '{result.record.id}'),
											e('label', ['Title', e('input', [], { name: 'title', maxLength: 200, style: inputStyle })]),
											e('label', [
												'Stage',
												e(
													'select',
													['Gallery', 'Before', 'After'].map((value) => e('option', [value], { value })),
													{ name: 'stage', style: inputStyle }
												)
											]),
											e('label', ['Description', e('textarea', [], { name: 'description', maxLength: 3000, style: inputStyle })]),
											e('tt-attachments', [], {
												name: 'attachmentIds',
												purpose: 'comment',
												targetId: '{result.record.id}',
												maxFiles: 12,
												committedTargetId: '{last.result.targetId}',
												committedIds: arg('last.result.committedIds')
											}),
											button('Save media', key('save-media'))
										],
										{ identityName: 'shareId', resetKey: '{mediaVersion}' }
									),
									button('Start another media entry', '$ui', { op: 'increment', key: 'mediaVersion' })
								],
								{ style: cardStyle }
							)
						)
					],
					{ style: grid }
				)
			)
		],
		'detail'
	);
	const componentKeys = definitions.filter((d) => d.thingtime[0] === 'component').map((d) => d.crystal.componentKey);
	const blocks = [
		{
			id: key('layout'),
			type: 'container',
			direction: 'column',
			align: 'center',
			maxWidth: 1100,
			gap: 0,
			css: { padding: '24px 16px', width: '100%', 'box-sizing': 'border-box' },
			children: componentKeys.map((component, index) => ({
				id: key(`screen-${index}`),
				type: 'component',
				component,
				align: 'stretch',
				args: { rootId, pagePath }
			}))
		}
	];
	return { definitions, componentKeys, blocks, rootId, pagePath };
}
