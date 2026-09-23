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
const draft = (name: string, fallback: string): Json => ({ ttArg: name, fallback });
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
			['view', 'id', 'page', 'q', 'date', 'status', 'employee', 'period', 'mediaCursor', 'related', 'relatedPage', 'parentId', 'copyId', 'threadId']
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
				...(['read', 'set-field'].includes(name) ? { expressionLimits: { nodes: 1000000, listItems: 5000 } } : {}),
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
				args: [s('rootId', { default: rootId }), s('pagePath', { default: '' })],
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
			test(
				'item.values.thumbnailId',
				e('img', [], {
					src: '/api/v1/attachments/content?id={item.values.thumbnailId}',
					alt: '',
					loading: 'lazy',
					style: { width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px' }
				})
			),
			e('strong', ['{item.title}']),
			e('span', ['{item.values.date} {item.values.time} · {item.values.status}']),
			e('p', ['{item.values.description}']),
			e('div', [link('Open', '{pagePath}?view=detail&id={item.id}'), editable], { style: row })
		],
		{ style: cardStyle }
	);
	const mapRecords = (list: Json) => x('map', list, x('merge', '$item', { title: title('$item') }));
	const activeKind = (kind: string) => x('filter', '$step.1.records', x('and', x('eq', '$item.kind', kind), x('not', '$item.values.archived')));
	const related = (kind: string, predicate: Json) => x('filter', `$step.6.${kind}`, predicate);
	const matchesRecord = (field: string) => x('eq', `$item.values.${field}`, '$step.2.id');
	const linkedIds = (field: string, idField: string) => x('map', related('link', matchesRecord(field)), `$item.values.${idField}`);
	// Resolve joins once per selected record. Every candidate comes from the
	// server's role-filtered snapshot; no reference can fetch hidden records.
	const relationGroups = [
		{
			owner: 'customer',
			key: 'properties',
			label: 'Properties',
			kind: 'address',
			match: x('includes', '$step.12.addressIds', '$item.id'),
			create: 'link',
			createLabel: 'Link property'
		},
		{ owner: 'customer', key: 'links', label: 'Customer address links', kind: 'link', match: matchesRecord('customerId') },
		{
			owner: 'address',
			key: 'customers',
			label: 'Customers',
			kind: 'customer',
			match: x('includes', '$step.12.customerIds', '$item.id'),
			create: 'link',
			createLabel: 'Link customer'
		},
		{ owner: 'address', key: 'jobs', label: 'Jobs', kind: 'job', match: matchesRecord('addressId'), create: 'job', createLabel: 'Create job' },
		{ owner: 'address', key: 'visits', label: 'Visit history', kind: 'visit', match: x('includes', '$step.12.jobIds', '$item.values.jobId') },
		{ owner: 'address', key: 'links', label: 'Customer address links', kind: 'link', match: matchesRecord('addressId') },
		{
			owner: 'job',
			key: 'visits',
			label: 'Scheduled visits & history',
			kind: 'visit',
			match: matchesRecord('jobId'),
			create: 'visit',
			createLabel: 'Schedule visit'
		},
		{ owner: 'job', key: 'subjobs', label: 'Sub-jobs', kind: 'subjob', match: matchesRecord('jobId'), create: 'subjob', createLabel: 'Add sub-job' },
		{ owner: 'visit', key: 'times', label: 'Time logs', kind: 'time', match: matchesRecord('visitId'), create: 'time', createLabel: 'Log time' },
		{
			owner: 'visit',
			key: 'usage',
			label: 'Tools, batteries & travel',
			kind: 'usage',
			match: matchesRecord('visitId'),
			create: 'usage',
			createLabel: 'Log usage'
		},
		{
			owner: 'equipment',
			key: 'usage',
			label: 'Usage history',
			kind: 'usage',
			match: x('includes', ['$item.values.equipmentId', '$item.values.batteryId', '$item.values.vehicleId'], '$step.2.id')
		}
	];
	const view = x('coalesce', '$input.view', 'overview');
	const periodDays = x('if', x('eq', '$input.period', 'day'), 1, 7);
	const recordFields = x(
		'get',
		Object.fromEntries(
			SERVICE_KINDS.map((kind) => [
				kind,
				x(
					'if',
					x('eq', '$step.2.kind', kind),
					SERVICE_FIELDS[kind].map((field) => {
						const value = `$step.2.values.${field.key}`;
						const target = field.ref ? x('find', '$step.1.records', x('and', x('eq', '$item.id', value), x('eq', '$item.kind', field.ref))) : null;
						return {
							label: field.label,
							value: field.ref
								? x('if', target, x('first', x('map', [target], title('$item'))), x('if', x('isEmpty', value), '', 'Unavailable record'))
								: value,
							id: field.ref ? x('get', target, 'id') : null
						};
					}),
					[]
				)
			])
		),
		'$step.2.kind'
	);
	action(
		'read',
		[
			s('rootId', { required: true }),
			...[
				'view',
				'id',
				'page',
				'q',
				'date',
				'status',
				'employee',
				'period',
				'mediaCursor',
				'related',
				'relatedPage',
				'parentId',
				'copyId',
				'threadId'
			].map((name) => s(name))
		],
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
			calc({
				...Object.fromEntries(SERVICE_KINDS.map((kind) => [kind, mapRecords(activeKind(kind))])),
				member: x('map', x('coalesce', '$step.1.team', []), { id: '$item.id', title: x('concat', '$item.name', ' · ', '$item.role') }),
				battery: mapRecords(x('filter', activeKind('equipment'), x('eq', '$item.values.category', 'Battery'))),
				vehicle: mapRecords(x('filter', activeKind('equipment'), x('eq', '$item.values.category', 'Vehicle')))
			}),
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
					x('not', '$step.2.values.archived'),
					x('or', x('eq', '$step.1.role', 'Admin'), x('and', x('ne', view, 'member'), x('ne', view, 'new-member'), x('ne', '$step.2.kind', 'member')))
				),
				record: '$step.2',
				recordTitle: title('$step.2'),
				recordFields,
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
				period: x('if', x('eq', '$input.period', 'day'), 'day', 'week'),
				previousDate: x('isoDate', x('dateAdd', '$step.8', x('mul', -1, periodDays), 'day')),
				nextDate: x('isoDate', x('dateAdd', '$step.8', periodDays, 'day')),
				days: x(
					'slice',
					Array.from({ length: 7 }, (_, i) => {
						const date = x('isoDate', x('dateAdd', '$step.8', i, 'day'));
						return {
							date,
							label: x('formatDate', date, 'weekday'),
							records: x('slice', x('filter', '$step.4', x('eq', '$item.values.date', date)), 0, 12),
							total: x('count', '$step.4', x('eq', '$item.values.date', date))
						};
					}),
					0,
					periodDays
				)
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
				query: { target: x('coalesce', '$input.threadId', '$input.id'), thingtime: 'comment', limit: 12, cursor: '$input.mediaCursor' },
				when: x('and', x('eq', view, 'detail'), x('not', x('isEmpty', '$input.id')))
			},
			calc({
				addressIds: x('if', x('eq', '$step.2.kind', 'customer'), linkedIds('customerId', 'addressId'), []),
				customerIds: x('if', x('eq', '$step.2.kind', 'address'), linkedIds('addressId', 'customerId'), []),
				jobIds: x('if', x('eq', '$step.2.kind', 'address'), x('map', related('job', matchesRecord('addressId')), '$item.id'), []),
				parent: x('find', '$step.1.records', x('and', x('eq', '$item.id', '$input.parentId'), x('not', '$item.values.archived'))),
				copy: x(
					'find',
					'$step.1.records',
					x('and', x('eq', '$item.id', '$input.copyId'), x('eq', view, x('concat', 'new-', '$item.kind')), x('ne', '$item.kind', 'member'))
				)
			}),
			calc(
				x(
					'filter',
					relationGroups.map((group) =>
						x(
							'if',
							x('eq', '$step.2.kind', group.owner),
							{
								key: group.key,
								label: group.label,
								create: group.create || '',
								createLabel: group.createLabel || '',
								records: x('sortBy', related(group.kind, group.match), x('concat', '$item.values.date', ' ', '$item.values.time', ' ', '$item.title'))
							},
							null
						)
					),
					'$item'
				)
			),
			calc(
				x(
					'map',
					'$step.13',
					x('merge', x('omit', '$item', ['records']), {
						total: x('length', '$item.records'),
						page: x(
							'max',
							1,
							x(
								'min',
								x('ceil', x('div', x('length', '$item.records'), 6)),
								x('if', x('eq', '$input.related', '$item.key'), x('coalesce', x('toNumber', '$input.relatedPage'), 1), 1)
							)
						),
						all: '$item.records'
					})
				)
			),
			calc({
				editing: x('eq', view, 'edit'),
				formId: x('if', x('eq', view, 'edit'), '$step.2.id', ''),
				formRevision: x('if', x('eq', view, 'edit'), '$step.2.updatedAt', ''),
				formValues: x(
					'if',
					x('eq', view, 'edit'),
					'$step.2.values',
					x(
						'if',
						'$step.12.copy',
						x(
							'merge',
							x('omit', '$step.12.copy.values', ['thumbnailId', 'bannerId', 'archived', 'userId', 'order']),
							x('if', '$step.12.copy.values.title', { title: x('concat', '$step.12.copy.values.title', ' (copy)') }, {})
						),
						x(
							'merge',
							{ date: '$step.8', status: 'Scheduled' },
							x('if', x('eq', '$step.12.parent.kind', 'customer'), { customerId: '$step.12.parent.id' }, {}),
							x('if', x('eq', '$step.12.parent.kind', 'address'), { addressId: '$step.12.parent.id' }, {}),
							x('if', x('eq', '$step.12.parent.kind', 'job'), { jobId: '$step.12.parent.id', title: '$step.12.parent.values.title' }, {}),
							x(
								'if',
								x('eq', '$step.12.parent.kind', 'visit'),
								{ visitId: '$step.12.parent.id', title: '$step.12.parent.values.title', employeeId: '$step.12.parent.values.employeeId' },
								{}
							)
						)
					)
				),
				loggedMinutes: x(
					'if',
					x('eq', '$step.2.kind', 'visit'),
					x('sum', related('time', matchesRecord('visitId')), x('toNumber', '$item.values.minutes')),
					0
				),
				relatedGroups: x(
					'map',
					'$step.14',
					x('merge', x('omit', '$item', ['all']), {
						items: x('slice', '$item.all', x('mul', x('sub', '$item.page', 1), 6), x('mul', '$item.page', 6)),
						previous: x('max', 1, x('sub', '$item.page', 1)),
						next: x('add', '$item.page', 1),
						hasNext: x('gt', '$item.total', x('mul', '$item.page', 6))
					})
				),
				todayVisits: x('slice', x('filter', '$step.6.visit', x('eq', '$item.values.date', '$step.8')), 0, 12),
				upcomingVisits: x(
					'slice',
					x(
						'sortBy',
						x(
							'filter',
							'$step.6.visit',
							x('and', x('gt', '$item.values.date', '$step.8'), x('not', x('includes', ['Completed', 'Cancelled'], '$item.values.status')))
						),
						'$item.values.date'
					),
					0,
					12
				)
			}),
			ret(
				x('merge', '$step.9', '$step.15', {
					mapPoints: '$step.10',
					media: '$step.11.things',
					commentTarget: x('coalesce', '$input.threadId', '$input.id'),
					showMedia: x('and', '$step.2', x('isEmpty', '$input.threadId')),
					mediaCursor: '$step.11.nextCursor',
					mediaGroups: ['Before', 'After', 'Gallery'].map((stage) => ({
						title: stage,
						items: x(
							'filter',
							x('filter', x('coalesce', '$step.11.things', []), x('not', x('isEmpty', '$item.attachments'))),
							stage === 'Gallery'
								? x('and', x('not', x('startsWith', '$item.crystal.text', '[Before]')), x('not', x('startsWith', '$item.crystal.text', '[After]')))
								: x('startsWith', '$item.crystal.text', `[${stage}]`)
						)
					}))
				})
			)
		]
	);
	component('navigation', 'App navigation', [
		e(
			'header',
			[
				e('h1', [test('result.name', '{result.name}', 'Open this app')], { style: { fontSize: '28px', fontWeight: 750 } }),
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
							].map(([view, label]) => link(label, `{pagePath}?view=${view}`)).concat([button('Refresh records', '$refresh')]),
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
		test('installAvailable', e('div', [button('Make an editable copy', '$install')], { style: grid })),
		equal('state', 'loading', e('p', ['Opening app…'], { role: 'status' }))
	]);
	component(
		'overview',
		'Overview',
		[
			e('h2', ['Overview']),
			e('h3', ['Today']),
			each('result.todayVisits', recordCard, 'No visits scheduled for today.'),
			e('h3', ['Upcoming visits']),
			each('result.upcomingVisits', recordCard, 'No upcoming visits.'),
			link('Browse all visits', '{pagePath}?view=visit'),
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
	action(
		'search-addresses',
		[s('rootId', { required: true }), s('query', { required: true, maxLength: 200 }), s('sessionToken')],
		[
			req({ operation: 'searchAddresses', rootId: '$input.rootId', query: '$input.query', sessionToken: '$input.sessionToken' }),
			ret({ operation: 'search-addresses', suggestions: '$step.1.suggestions', silent: true })
		]
	);
	const addressSearch = test(
		'result.canEdit',
		e(
			'section',
			[
				e(
					'tt-form',
					[
						hidden('rootId', '{rootId}'),
						e('label', [
							'Find an address',
							e('input', [], {
								name: 'query',
								type: 'search',
								required: true,
								minLength: 3,
								maxLength: 200,
								placeholder: 'Street address',
								style: inputStyle
							})
						]),
						button('Find address', key('search-addresses'))
					],
					{ identityName: 'sessionToken' }
				),
				equal(
					'last.result.operation',
					'search-addresses',
					test(
						'last.ok',
						e(
							'div',
							[
								each(
									'last.result.suggestions',
									button('{item.text}', '$ui', { op: 'patch', values: { addressDraft: '{item.text}', placeDraft: '{item.id}' } }),
									'No matching addresses. You can enter one manually.'
								),
								e('img', [], {
									src: 'https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png',
									alt: 'Powered by Google',
									width: 120,
									height: 14
								})
							],
							{ style: grid }
						)
					)
				),
				e('p', ['Search is optional. You can also enter the street address manually.'])
			],
			{ style: grid }
		)
	);
	for (const kind of SERVICE_KINDS) {
		const fields = SERVICE_FIELDS[kind];
		const mediaFields = ['customer', 'address', 'equipment'].includes(kind)
			? ['thumbnailId', 'bannerId', ...(kind === 'address' ? ['placeId'] : [])]
			: [];
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
			ret({ operation: `save-${kind}`, silent: true, id: '$step.1.id', message: `${SERVICE_LABELS[kind]} saved`, title: 'Saved' })
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
							e('input', [], {
								type: 'search',
								'aria-label': 'Search records',
								placeholder: 'Search records',
								value: draft('filter', 'query.q'),
								style: inputStyle
							})
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
			const props: Json = {
				name: field.key,
				required: !!field.required,
				value: field.key === 'address' ? draft('addressDraft', 'result.formValues.address') : arg(`result.formValues.${field.key}`),
				style: inputStyle,
				...(field.key === 'username' ? { readOnly: arg('result.editing') } : {})
			};
			const child = field.ref
				? e('tt-select', [], {
						...props,
						title: field.label,
						optionsPath: `result.options.${field.key === 'batteryId' ? 'battery' : field.key === 'vehicleId' ? 'vehicle' : field.ref}`
				  })
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
			return e(
				'label',
				[
					field.label + (field.required ? ' *' : ''),
					field.key === 'address' ? { ...child, ttAction: '$ui', ttActionInputs: { op: 'set', key: 'addressDraft', clear: ['placeDraft'] } } : child
				],
				{ style: grid }
			);
		});
		const form = test(
			'result.canEdit',
			e(
				'tt-form',
				[
					hidden('rootId', '{rootId}'),
					...mediaFields.map((name) =>
						hidden(name, name === 'placeId' ? draft('placeDraft', 'result.formValues.placeId') : `{result.formValues.${name}}`)
					),
					...fieldNodes,
					button('Save', key(`save-${kind}`)),
					equal('last.result.operation', `save-${kind}`, test('last.ok', link('Open saved record', '{pagePath}?view=detail&id={last.result.id}')))
				],
				{
					identityName: 'id',
					identity: '{result.formId}',
					revisionName: 'expectedUpdatedAt',
					revision: '{result.formRevision}',
					resetKey: '{formVersion}'
				}
			),
			e('p', ['Your role can view these records. Editing is available to authorized team members.'])
		);
		component(`form-${kind}`, `${SERVICE_LABELS[kind]} form`, [
			equal(
				'result.view',
				`new-${kind}`,
				e(
					'div',
					[
						e('h2', [`Add ${kind}`]),
						...(kind === 'address' ? [addressSearch] : []),
						form,
						test('result.canEdit', button('Start another', '$ui', { op: 'increment', key: 'formVersion', clear: ['addressDraft', 'placeDraft'] }))
					],
					{ style: cardStyle }
				)
			),
			equal(
				'result.view',
				'edit',
				equal(
					'result.record.kind',
					kind,
					e('div', [e('h2', ['Edit {result.recordTitle}']), ...(kind === 'address' ? [addressSearch] : []), form], { style: cardStyle })
				)
			)
		]);
	}
	// A field update re-reads authorized values, but keeps the revision the user
	// actually saw. A stale screen must fail rather than overwrite newer work.
	action(
		'set-field',
		[
			s('rootId', { required: true }),
			s('id', { required: true }),
			s('expectedUpdatedAt', { required: true }),
			s('field', { required: true }),
			s('value')
		],
		[
			req(),
			calc(x('find', '$step.1.records', x('eq', '$item.id', '$input.id'))),
			{
				op: 'fail',
				message: 'This record changed or is unavailable. Refresh before retrying.',
				when: x('or', x('not', '$step.2'), x('ne', '$step.2.updatedAt', '$input.expectedUpdatedAt'))
			},
			{
				op: 'fail',
				message: 'This field cannot be changed here.',
				when: x(
					'not',
					x(
						'or',
						x(
							'and',
							x('eq', '$step.2.kind', 'visit'),
							x('eq', '$input.field', 'status'),
							x('includes', ['Scheduled', 'In progress', 'Completed', 'Cancelled'], '$input.value')
						),
						x('and', x('includes', ['customer', 'address', 'equipment'], '$step.2.kind'), x('eq', '$input.field', 'thumbnailId')),
						x('and', x('eq', '$step.2.kind', 'address'), x('eq', '$input.field', 'bannerId'))
					)
				)
			},
			req({
				operation: 'save',
				rootId: '$input.rootId',
				kind: '$step.2.kind',
				id: '$input.id',
				expectedUpdatedAt: '$input.expectedUpdatedAt',
				values: x(
					'merge',
					'$step.2.values',
					x(
						'if',
						x('eq', '$input.field', 'status'),
						{ status: '$input.value' },
						x('if', x('eq', '$input.field', 'thumbnailId'), { thumbnailId: '$input.value' }, { bannerId: '$input.value' })
					)
				)
			}),
			ret({ message: 'Record updated', operation: 'set-field', silent: true, id: '$input.id' })
		]
	);
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
						test(
							'result.record.values.bannerId',
							e('img', [], {
								src: '/api/v1/attachments/content?id={result.record.values.bannerId}',
								alt: '{result.recordTitle}',
								style: { width: '100%', maxHeight: '280px', objectFit: 'cover', borderRadius: '10px' }
							})
						),
						test(
							'result.record.values.thumbnailId',
							e('img', [], {
								src: '/api/v1/attachments/content?id={result.record.values.thumbnailId}',
								alt: '',
								style: { width: '96px', height: '96px', objectFit: 'cover', borderRadius: '8px' }
							})
						),
						e('dl', [
							each(
								'result.recordFields',
								e(
									'div',
									[
										e('dt', ['{item.label}']),
										e('dd', [
											test('item.id', link('{item.value}', '{pagePath}?view=detail&id={item.id}'), { ttFormat: { arg: 'item.value', kind: 'text' } })
										])
									],
									{ style: grid }
								)
							)
						]),
						test(
							'result.canEdit',
							e(
								'div',
								[
									link('Edit', '{pagePath}?view=edit&id={result.record.id}'),
									equal('result.record.kind', 'member', '', link('Duplicate', '{pagePath}?view=new-{result.record.kind}&copyId={result.record.id}')),
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
						equal(
							'result.record.kind',
							'visit',
							e(
								'section',
								[
									e('h3', ['Total logged time']),
									e('strong', ['{result.loggedMinutes} min']),
									test(
										'result.canEdit',
										e(
											'div',
											['Scheduled', 'In progress', 'Completed', 'Cancelled'].map((status) =>
												button(status, key('set-field'), {
													rootId: '{rootId}',
													id: '{result.record.id}',
													expectedUpdatedAt: '{result.record.updatedAt}',
													field: 'status',
													value: status
												})
											),
											{ style: row }
										)
									)
								],
								{ style: grid }
							)
						),
						each(
							'result.relatedGroups',
							e(
								'section',
								[
									e('h3', ['{item.label}']),
									e('p', ['{item.total} records · page {item.page}']),
									test(
										'result.canEdit',
										test('item.create', link('{item.createLabel}', '{pagePath}?view=new-{item.create}&parentId={result.record.id}'))
									),
									each('item.items', recordCard),
									e(
										'div',
										[
											link('Previous', '{pagePath}?view=detail&id={result.record.id}&related={item.key}&relatedPage={item.previous}'),
											test('item.hasNext', link('Next', '{pagePath}?view=detail&id={result.record.id}&related={item.key}&relatedPage={item.next}'))
										],
										{ style: row }
									)
								],
								{ style: grid }
							),
							''
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
			e('p', ['{result.timeZone} · {result.period} view']),
			e(
				'div',
				[
					button('Previous', '$ui', {
						op: 'query',
						params: {
							view: 'planner',
							date: '{result.previousDate}',
							period: '{result.period}',
							q: '{query.q}',
							status: '{query.status}',
							employee: '{query.employee}'
						}
					}),
					local(
						'plannerDate',
						e('input', [], { type: 'date', value: draft('plannerDate', 'result.date'), 'aria-label': 'Planner date', style: inputStyle })
					),
					button('Go', '$ui', {
						op: 'query',
						params: {
							view: 'planner',
							date: draft('plannerDate', 'result.date'),
							period: '{result.period}',
							q: '{query.q}',
							status: '{query.status}',
							employee: '{query.employee}'
						}
					}),
					button('Next', '$ui', {
						op: 'query',
						params: {
							view: 'planner',
							date: '{result.nextDate}',
							period: '{result.period}',
							q: '{query.q}',
							status: '{query.status}',
							employee: '{query.employee}'
						}
					}),
					...['day', 'week'].map((period) =>
						button(period === 'day' ? 'Day' : 'Week', '$ui', {
							op: 'query',
							params: { view: 'planner', date: '{result.date}', period, q: '{query.q}', status: '{query.status}', employee: '{query.employee}' }
						})
					),
					test('result.canEdit', link('Schedule a visit', '{pagePath}?view=new-visit'))
				],
				{ style: row }
			),
			e(
				'div',
				[
					local('filter', e('input', [], { type: 'search', placeholder: 'Search visits', value: draft('filter', 'query.q'), style: inputStyle })),
					local(
						'plannerStatus',
						e(
							'select',
							[
								e('option', ['All statuses'], { value: '' }),
								...SERVICE_FIELDS.visit.find((f) => f.key === 'status')!.options!.map((status) => e('option', [status], { value: status }))
							],
							{ 'aria-label': 'Visit status', value: draft('plannerStatus', 'query.status'), style: inputStyle }
						)
					),
					e('tt-select', [], {
						title: 'Assigned employee',
						optionsPath: 'result.options.member',
						value: draft('plannerEmployee', 'query.employee'),
						stateKey: 'plannerEmployee'
					}),
					button('Filter', '$ui', {
						op: 'query',
						params: {
							view: 'planner',
							q: draft('filter', 'query.q'),
							date: '{result.date}',
							period: '{result.period}',
							status: draft('plannerStatus', 'query.status'),
							employee: draft('plannerEmployee', 'query.employee')
						}
					})
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
				environmentId: x('if', x('eq', '$input.environmentId', ''), null, '$input.environmentId')
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
									e('option', ['Ungrouped'], { value: '' }),
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
				href: x('concat', '?view=detail&id=', '$input.recordId')
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
	action(
		'save-comment',
		[s('id', { required: true }), s('shareId', { required: true }), s('text', { required: true, maxLength: 3000 })],
		[
			{
				op: 'http.request',
				method: 'POST',
				path: '/api/v1/things/comment',
				feature: 'api.things-comment',
				minimumVersion: '1.7.0',
				body: { id: '$input.id', shareId: '$input.shareId', text: '$input.text' }
			},
			ret({ operation: 'save-comment', silent: true, message: 'Comment saved' })
		]
	);
	component(
		'comments',
		'Record discussion',
		[
			test(
				'result.record',
				e(
					'section',
					[
						e('h2', ['Comments & updates']),
						test('query.threadId', link('Back to record discussion', '{pagePath}?view=detail&id={result.record.id}')),
						each(
							'result.media',
							e(
								'article',
								[
									e('p', ['{item.crystal.text}']),
									e('tt-media', [], { attachments: arg('item.attachments'), postId: '{item.id}' }),
									e(
										'div',
										[link('Replies', '{pagePath}?view=detail&id={result.record.id}&threadId={item.id}'), link('Open comment', '/thing/{item.id}')],
										{ style: row }
									)
								],
								{ style: cardStyle }
							),
							'No comments on this page.'
						),
						test(
							'result.mediaCursor',
							link('More comments', '{pagePath}?view=detail&id={result.record.id}&threadId={query.threadId}&mediaCursor={result.mediaCursor}')
						),
						e(
							'tt-form',
							[
								hidden('id', '{result.commentTarget}'),
								e('label', ['Add a comment', e('textarea', [], { name: 'text', required: true, maxLength: 3000, style: inputStyle })]),
								button('Post comment', key('save-comment'))
							],
							{ identityName: 'shareId', resetKey: '{commentVersion}' }
						),
						button('Start another comment', '$ui', { op: 'increment', key: 'commentVersion' })
					],
					{ style: grid }
				)
			)
		],
		'detail'
	);
	const imagePicker = test(
		'result.canEdit',
		each(
			'item.attachments',
			equal(
				'item.mediaKind',
				'image',
				e(
					'div',
					[
						e('span', ['{item.name}']),
						...['customer', 'address', 'equipment'].map((kind) =>
							equal(
								'result.record.kind',
								kind,
								button(kind === 'customer' ? 'Use as profile photo' : 'Use as thumbnail', key('set-field'), {
									rootId: '{rootId}',
									id: '{result.record.id}',
									expectedUpdatedAt: '{result.record.updatedAt}',
									field: 'thumbnailId',
									value: '{item.id}'
								})
							)
						),
						equal(
							'result.record.kind',
							'address',
							button('Use as banner', key('set-field'), {
								rootId: '{rootId}',
								id: '{result.record.id}',
								expectedUpdatedAt: '{result.record.updatedAt}',
								field: 'bannerId',
								value: '{item.id}'
							})
						)
					],
					{ style: row }
				)
			),
			''
		)
	);
	const mediaEntry = e(
		'article',
		[
			e('p', ['{item.crystal.text}']),
			e('tt-media', [], { attachments: arg('item.attachments'), postId: '{item.id}' }),
			// Keep independent image actions out of the nearby upload form's fields.
			e('fieldset', [imagePicker], { style: { border: 0, padding: 0, margin: 0, minWidth: 0 } })
		],
		{ style: cardStyle }
	);
	component(
		'media',
		'Record media',
		[
			test(
				'result.showMedia',
				e(
					'div',
					[
						e('h2', ['Photos & attachments']),
						e(
							'div',
							[
								each(
									'result.mediaGroups',
									e('section', [e('h3', ['{item.title}']), each('item.items', mediaEntry, 'No media in this group on this page.')], { style: grid })
								)
							],
							{ style: grid }
						),
						e(
							'div',
							[
								button('First media page', '$ui', { op: 'query', params: { view: 'detail', id: '{result.record.id}' } }),
								test(
									'result.mediaCursor',
									button('More media', '$ui', {
										op: 'query',
										params: { view: 'detail', id: '{result.record.id}', threadId: '{query.threadId}', mediaCursor: '{result.mediaCursor}' }
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
				args: { rootId, pagePath: '' }
			}))
		}
	];
	return { definitions, componentKeys, blocks, rootId, pagePath };
}
