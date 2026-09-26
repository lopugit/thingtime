// One-time authoring of a Builder app as ordinary saved Things. The runtime
// never imports this file: after installation every screen and request is
// independently editable, copyable JSON. Legacy endpoint names are compatibility
// details; they do not create a new application kind.
import { deriveRequiredCapabilities } from '../components/Actions/actionInspect';
import { styledApp, icon } from './workspaceAppAppearance';
import { SERVICE_FIELDS, SERVICE_KINDS, SERVICE_LABELS, SERVICE_SINGULAR } from './serviceWorkspace';

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
const link = (label: string, href: string, className?: string): Json =>
	e('a', [label], {
		href: /view=(new-|edit)/.test(href) ? href + '&returnView={result.screenView}&returnId={result.record.id}' : href,
		...(className ? { className } : {})
	});
const button = (label: string, action: string, inputs: Json = {}): Json => ({
	...e('button', [label], {
		type: 'button',
		className: ''
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
			[
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
				'threadId',
				'returnView'
			]
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
				...(['read', 'snapshot', 'set-field', 'reorder'].includes(name) ? { expressionLimits: { nodes: 1000000, listItems: 5000 } } : {}),
				inputs,
				capabilities: deriveRequiredCapabilities(steps),
				limits: { timeoutMs: 30000, maxOperations: 100, maxChildActions: 20, maxResultBytes: 4194304 },
				steps
			}
		});
	const component = (name: string, label: string, children: Json[], view?: string) => {
		const body = e('div', children, {
			...(name === 'planner-board' ? { style: { paddingTop: 0 } } : {}),
			className: name === 'navigation' || name === 'footer' || name.startsWith('form-') ? '' : 'sw-main'
		});
		definitions.push({
			thingtime: ['component'],
			crystal: {
				name: label,
				componentKey: key(name),
				description: 'Editable Builder composition. Layout, styles, fields and Action bindings are saved in this Component.',
				args: [s('rootId', { default: rootId }), s('pagePath', { default: '' })],
				source,
				render: styledApp(e('section', view ? [equal('result.screenView', view, body)] : [body], { className: 'service-workspace' }))
			}
		});
	};
	const buttonLink = (label: string, href: string, primary = false) => link(label, href, 'sw-link-button' + (primary ? ' sw-primary' : ''));
	const heading = (label: string, add?: Json) =>
		e(
			'div',
			[e('div', [e('p', ['{result.dateLabel}'], { className: 'sw-eyebrow' }), e('h2', [label])]), ...(add ? [test('result.canEdit', add)] : [])],
			{ className: 'sw-page-heading' }
		);
	const createLink = (label: string, kind: string) => ({
		...buttonLink(label, `{pagePath}?view=new-${kind}`, true),
		children: [icon('plus', 16), label]
	});
	const recordMenu = test(
		'result.canEdit',
		test(
			'item.values.workspaceOwner',
			'',
			e(
				'details',
				[
					e('summary', ['•••'], { 'aria-label': 'Options for {item.title}' }),
					e('nav', [
						link('Edit', '{pagePath}?view=edit&id={item.id}'),
						equal('item.kind', 'member', '', link('Duplicate', '{pagePath}?view=new-{item.kind}&copyId={item.id}')),
						e(
							'tt-dialog',
							[
								e('p', ['Move this record to Trash? Related history is preserved.']),
								button('Delete', key('archive'), { rootId: '{rootId}', id: '{item.id}', expectedUpdatedAt: '{item.updatedAt}' })
							],
							{ name: 'Delete', title: 'Move to Trash', closeOnAction: key('archive') }
						)
					])
				],
				{ className: 'sw-record-menu' }
			)
		)
	);
	const recordContext = e(
		'span',
		[
			each(
				'item.context',
				e(
					'span',
					[
						{ ttMap: { arg: 'item.icon', values: Object.fromEntries(['address', 'customer', 'member'].map((kind) => [kind, icon(kind, 14)])) } },
						e('span', ['{item.text}'])
					],
					{ className: 'sw-context-row' }
				),
				''
			)
		],
		{ className: 'sw-job-context' }
	);
	const recordCard = e(
		'article',
		[
			e(
				'a',
				[
					test(
						'item.avatar',
						e(
							'span',
							[
								test(
									'item.values.thumbnailId',
									e('img', [], { src: '/api/v1/attachments/content?id={item.values.thumbnailId}', alt: '', loading: 'lazy' }),
									'{item.initials}'
								)
							],
							{ className: 'sw-avatar sw-avatar-{item.kind}' }
						)
					),
					e('span', [e('strong', ['{item.title}']), e('small', ['{item.subtitle}']), recordContext])
				],
				{ href: '{pagePath}?view=detail&id={item.id}&returnView={result.screenView}', className: 'sw-record-main' }
			),
			recordMenu
		],
		{ className: 'sw-record' }
	);
	const collection = (path: string, label: string, empty: string, compact = false) =>
		e('tt-collection', [], {
			itemsPath: path,
			label,
			empty,
			className: compact ? 'sw-record-list' : 'sw-record-grid',
			itemTemplate: { ttTemplate: recordCard },
			filters: [
				{ path: 'values.status', label: 'Status' },
				{ path: 'values.category', label: 'Category' },
				{ path: 'values.role', label: 'Role' },
				{ path: 'employeeName', label: 'Employee' }
			]
		});
	const visitPanel = (label: string, path: string, count: string) =>
		e(
			'section',
			[
				e('div', [e('h2', [label, e('span', [`{result.${count}}`], { className: 'sw-count' })])], { className: 'sw-section-heading' }),
				collection(path, label, `No ${label.toLowerCase()} yet.`, true)
			],
			{ className: 'sw-panel' }
		);
	const mapRecords = (list: Json) =>
		x(
			'map',
			list,
			x('merge', '$item', {
				title: title('$item'),
				avatar: x('includes', ['customer', 'address', 'equipment'], '$item.kind'),
				initials: x('upper', x('slice', title('$item'), 0, 2)),
				subtitle: x(
					'get',
					{
						customer: x(
							'join',
							x('filter', ['$item.values.contact', x('coalesce', '$item.values.email', '$item.values.phone')], x('not', x('isEmpty', '$item'))),
							' · '
						),
						address: '$item.values.address',
						job: x('if', '$item.values.estimatedMinutes', x('concat', '$item.values.estimatedMinutes', ' min estimated'), 'Job template'),
						visit: x('join', x('filter', ['$item.values.date', '$item.values.time', '$item.values.status'], x('not', x('isEmpty', '$item'))), ' · '),
						equipment: x('join', x('filter', ['$item.values.category', '$item.values.serialNumber'], x('not', x('isEmpty', '$item'))), ' · '),
						member: '$item.values.role',
						time: x('concat', '$item.values.minutes', ' minutes'),
						subjob: '$item.values.description'
					},
					'$item.kind',
					''
				)
			})
		);
	const activeKind = (kind: string) => x('filter', '$step.2.records', x('and', x('eq', '$item.kind', kind), x('not', '$item.values.archived')));
	const related = (kind: string, predicate: Json) => x('filter', `$step.7.${kind}`, predicate);
	const matchesRecord = (field: string) => x('eq', `$item.values.${field}`, '$step.3.id');
	const linkedIds = (field: string, idField: string) => x('map', related('link', matchesRecord(field)), `$item.values.${idField}`);
	// Resolve joins once per selected record. Every candidate comes from the
	// server's role-filtered snapshot; no reference can fetch hidden records.
	const relationGroups = [
		{
			owner: 'customer',
			key: 'properties',
			label: 'Properties',
			kind: 'address',
			match: x('includes', '$step.13.addressIds', '$item.id'),
			create: 'link',
			createLabel: 'Link property'
		},
		{ owner: 'customer', key: 'links', label: 'Customer address links', kind: 'link', match: matchesRecord('customerId') },
		{
			owner: 'address',
			key: 'customers',
			label: 'Customers',
			kind: 'customer',
			match: x('includes', '$step.13.customerIds', '$item.id'),
			create: 'link',
			createLabel: 'Link customer'
		},
		{ owner: 'address', key: 'jobs', label: 'Jobs', kind: 'job', match: matchesRecord('addressId'), create: 'job', createLabel: 'Create job' },
		{ owner: 'address', key: 'visits', label: 'Visit history', kind: 'visit', match: x('includes', '$step.13.jobIds', '$item.values.jobId') },
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
			match: x('includes', ['$item.values.equipmentId', '$item.values.batteryId', '$item.values.vehicleId'], '$step.3.id')
		}
	];
	const view = '$step.2.view';
	const screenView = '$step.2.screenView';
	const requestedView = x('coalesce', '$input.view', 'overview');
	const periodDays = x('if', x('eq', '$input.period', 'day'), 1, 7);
	const todayDate = x('concat', '$step.8.year', '-', x('padStart', '$step.8.month', 2, '0'), '-', x('padStart', '$step.8.day', 2, '0'));
	const selectedDate = x('coalesce', '$input.date', todayDate);
	const fieldDescriptors = Object.fromEntries(
		SERVICE_KINDS.map((kind) => [kind, SERVICE_FIELDS[kind].map(({ key, label, ref }) => ({ key, label, ...(ref ? { ref } : {}) }))])
	);
	// Store field descriptors once, then resolve references from the authorized
	// snapshot. Reusing the normalized title avoids repeating a full join three
	// times per field in the saved Action and its signed review preview.
	const fieldValue = x('get', '$step.3.values', '$item.key');
	const fieldTarget = x('get', '$step.2.recordsById', fieldValue);
	const recordFields = x(
		'map',
		x('map', x('get', '$step.2.fieldDescriptors', '$step.3.kind', []), {
			label: '$item.label',
			ref: '$item.ref',
			value: fieldValue,
			target: x('if', '$item.ref', fieldTarget, null)
		}),
		{
			label: '$item.label',
			value: x(
				'if',
				'$item.ref',
				x(
					'if',
					x('and', '$item.target', x('eq', '$item.target.kind', '$item.ref')),
					'$item.target.title',
					x('if', x('isEmpty', '$item.value'), '', 'Unavailable record')
				),
				'$item.value'
			),
			id: x('if', x('and', '$item.target', x('eq', '$item.target.kind', '$item.ref')), '$item.target.id', null)
		}
	);
	// Saved general-purpose lookup/group calculations replace the original
	// native relationship helper. Only already-authorized snapshot rows are used.
	const lookup = (id: Json) => x('get', '$step.3.records', id);
	const property = x('get', '$step.3.records', '$item.contextJob.values.addressId');
	action(
		'snapshot',
		[s('rootId', { required: true })],
		[
			req(),
			calc(mapRecords('$step.1.records')),
			calc({ records: x('indexBy', '$step.2', '$item.id'), team: x('indexBy', x('coalesce', '$step.1.team', []), '$item.id') }),
			calc({
				links: x(
					'groupBy',
					x(
						'filter',
						'$step.2',
						x(
							'and',
							x('eq', '$item.kind', 'link'),
							x('not', '$item.values.archived'),
							'$item.values.addressId',
							x('eq', x('get', lookup('$item.values.customerId'), 'kind'), 'customer'),
							x('not', x('get', x('get', lookup('$item.values.customerId'), 'values'), 'archived'))
						)
					),
					'$item.values.addressId'
				),
				visits: x(
					'groupBy',
					x(
						'filter',
						'$step.2',
						x(
							'and',
							x('eq', '$item.kind', 'visit'),
							x('not', '$item.values.archived'),
							'$item.values.jobId',
							'$item.values.employeeId',
							x('ne', '$item.values.status', 'Cancelled')
						)
					),
					'$item.values.jobId'
				)
			}),
			calc(
				x(
					'map',
					'$step.2',
					x('merge', '$item', {
						employeeName: x('get', x('get', '$step.3.team', '$item.values.employeeId'), 'name', ''),
						contextJob: x('if', x('eq', '$item.kind', 'job'), '$item', lookup('$item.values.jobId'))
					})
				)
			),
			calc(
				x(
					'map',
					'$step.5',
					x('merge', x('omit', '$item', ['contextJob']), {
						context: x(
							'if',
							x('includes', ['job', 'visit'], '$item.kind'),
							{
								property: x(
									'if',
									x('and', x('eq', '$item.contextJob.kind', 'job'), x('eq', x('get', property, 'kind'), 'address')),
									x('join', x('uniq', x('filter', [x('get', property, 'title'), x('get', x('get', property, 'values'), 'address')], '$item')), ' · '),
									'Property unavailable'
								),
								customers: x(
									'join',
									x(
										'uniq',
										x('map', x('get', '$step.4.links', '$item.contextJob.values.addressId', []), x('get', lookup('$item.values.customerId'), 'title'))
									),
									', '
								),
								crew: x(
									'join',
									x(
										'filter',
										x(
											'map',
											x(
												'if',
												x('eq', '$item.kind', 'visit'),
												['$item.values.employeeId'],
												x('uniq', x('pluck', x('map', x('get', '$step.4.visits', '$item.id', []), '$item.values'), 'employeeId'))
											),
											x('get', x('get', '$step.3.team', '$item'), 'name')
										),
										'$item'
									),
									', '
								)
							},
							null
						)
					})
				)
			),
			ret(
				x('merge', '$step.1', {
					fieldDescriptors,
					records: x(
						'map',
						'$step.6',
						x('merge', '$item', {
							context: x(
								'if',
								'$item.context',
								x(
									'filter',
									[
										{ icon: 'address', text: '$item.context.property' },
										x('if', '$item.context.customers', { icon: 'customer', text: x('concat', 'Customers: ', '$item.context.customers') }, null),
										{ icon: 'member', text: x('concat', 'Assigned crew: ', x('coalesce', '$item.context.crew', 'Unassigned')) }
									],
									'$item'
								),
								[]
							)
						})
					)
				})
			)
		]
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
				'threadId',
				'returnView'
			].map((name) => s(name))
		],
		[
			{ op: 'actions.invoke', action: key('snapshot'), inputs: { rootId: '$input.rootId' } },
			calc(
				x('merge', '$step.1', {
					recordsById: x('indexBy', '$step.1.records', '$item.id'),
					view: requestedView,
					screenView: x(
						'if',
						x('or', x('startsWith', requestedView, 'new-'), x('eq', requestedView, 'edit')),
						x('coalesce', '$input.returnView', 'overview'),
						requestedView
					)
				})
			),
			calc(x('find', '$step.2.records', x('eq', '$item.id', '$input.id'))),
			calc(
				x(
					'filter',
					'$step.2.records',
					x(
						'and',
						x(
							'if',
							x('eq', screenView, 'trash'),
							'$item.values.archived',
							x(
								'and',
								x('not', '$item.values.archived'),
								x('eq', '$item.kind', x('if', x('eq', screenView, 'planner'), 'visit', x('if', x('eq', screenView, 'maps'), 'address', screenView)))
							)
						),
						x(
							'includes',
							x(
								'lower',
								x(
									'concat',
									'$item.title',
									' ',
									'$item.subtitle',
									' ',
									x('join', x('values', '$item.values'), ' '),
									' ',
									x('join', x('pluck', '$item.context', 'text'), ' ')
								)
							),
							x('lower', x('coalesce', '$input.q', ''))
						),
						x('or', x('isEmpty', '$input.status'), x('eq', '$item.values.status', '$input.status')),
						x('or', x('isEmpty', '$input.employee'), x('eq', x('coalesce', '$item.values.employeeId', '__unassigned__'), '$input.employee'))
					)
				)
			),
			calc(x('sortBy', '$step.4', x('coalesce', '$item.values.date', '$item.title'))),
			calc(x('max', 1, x('min', x('coalesce', x('toNumber', '$input.page'), 1), x('ceil', x('div', x('length', '$step.5'), 12))))),
			calc({
				...Object.fromEntries(SERVICE_KINDS.map((kind) => [kind, activeKind(kind)])),
				member: x('map', x('coalesce', '$step.2.team', []), { id: '$item.id', title: x('concat', '$item.name', ' · ', '$item.role') }),
				battery: x('filter', activeKind('equipment'), x('eq', '$item.values.category', 'Battery')),
				vehicle: x('filter', activeKind('equipment'), x('eq', '$item.values.category', 'Vehicle'))
			}),
			calc(x('dateParts', '$now', '$step.2.timeZone')),
			calc({
				date: selectedDate,
				today: todayDate,
				visitsByDate: x('groupBy', x('filter', '$step.5', '$item.values.date'), '$item.values.date'),
				start: x(
					'if',
					x('eq', '$input.period', 'day'),
					selectedDate,
					x('isoDate', x('dateAdd', selectedDate, x('mul', -1, x('mod', x('add', x('get', x('dateParts', selectedDate), 'weekday'), 6), 7)), 'day'))
				)
			}),
			calc({
				view,
				screenView,
				dateLabel: x(
					'concat',
					x('formatDate', '$now', 'weekday', '$step.2.timeZone'),
					' ',
					'$step.8.day',
					' ',
					x(
						'get',
						['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
						x('sub', '$step.8.month', 1)
					)
				),
				allRecords: '$step.5',
				rootId: '$input.rootId',
				name: '$step.2.name',
				role: '$step.2.role',
				timeZone: '$step.2.timeZone',
				owner: '$step.2.owner',
				canEdit: x(
					'and',
					x('includes', ['Admin', 'Employee', 'Lopu'], '$step.2.role'),
					x('not', '$step.3.values.archived'),
					x('or', x('eq', '$step.2.role', 'Admin'), x('and', x('ne', view, 'member'), x('ne', view, 'new-member'), x('ne', '$step.3.kind', 'member')))
				),
				record: '$step.3',
				recordTitle: '$step.3.title',
				recordFields,
				records: x('slice', '$step.5', x('mul', x('sub', '$step.6', 1), 12), x('mul', '$step.6', 12)),
				total: x('length', '$step.5'),
				page: '$step.6',
				previous: x('max', 1, x('sub', '$step.6', 1)),
				next: x('add', '$step.6', 1),
				hasNext: x('gt', x('length', '$step.5'), x('mul', '$step.6', 12)),
				options: '$step.7',
				counts: Object.fromEntries(SERVICE_KINDS.map((kind) => [kind, x('length', `$step.7.${kind}`)])),
				mapsConfigured: '$step.2.mapsConfigured',
				mapsEnvironmentId: '$step.2.mapsEnvironmentId',
				mapsEnvironments: '$step.2.mapsEnvironments',
				mapsBrowserKey: '$step.2.mapsBrowserKey',
				team: '$step.2.team',
				date: '$step.9.date',
				today: '$step.9.today',
				startLabel: x('formatDate', '$step.9.start', 'date'),
				period: x('if', x('eq', '$input.period', 'day'), 'day', 'week'),
				previousDate: x('isoDate', x('dateAdd', '$step.9.date', x('mul', -1, periodDays), 'day')),
				nextDate: x('isoDate', x('dateAdd', '$step.9.date', periodDays, 'day')),
				days: x('map', x('map', x('range', periodDays), x('isoDate', x('dateAdd', '$step.9.start', '$item', 'day'))), {
					date: '$item',
					label: x('concat', x('formatDate', '$item', 'weekday'), ' ', x('get', x('dateParts', '$item'), 'day')),
					records: x('sortBy', x('get', '$step.9.visitsByDate', '$item', []), x('coalesce', '$item.values.order', 0)),
					today: x('eq', '$item', '$step.9.today'),
					total: x('length', x('get', '$step.9.visitsByDate', '$item', []))
				})
			}),
			{
				op: 'each',
				action: key('place'),
				list: x('filter', '$step.10.records', '$item.values.placeId'),
				inputs: { rootId: '$input.rootId', recordId: '$item.id', title: '$item.title' },
				max: 12,
				when: x('and', x('eq', view, 'maps'), '$step.2.mapsConfigured')
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
				addressIds: x('if', x('eq', '$step.3.kind', 'customer'), linkedIds('customerId', 'addressId'), []),
				customerIds: x('if', x('eq', '$step.3.kind', 'address'), linkedIds('addressId', 'customerId'), []),
				jobIds: x('if', x('eq', '$step.3.kind', 'address'), x('map', related('job', matchesRecord('addressId')), '$item.id'), []),
				parent: x('find', '$step.2.records', x('and', x('eq', '$item.id', '$input.parentId'), x('not', '$item.values.archived'))),
				copy: x(
					'find',
					'$step.2.records',
					x('and', x('eq', '$item.id', '$input.copyId'), x('eq', view, x('concat', 'new-', '$item.kind')), x('ne', '$item.kind', 'member'))
				)
			}),
			calc(
				x(
					'filter',
					relationGroups.map((group) =>
						x(
							'if',
							x('eq', '$step.3.kind', group.owner),
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
					'$step.14',
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
				formId: x('if', x('eq', view, 'edit'), '$step.3.id', ''),
				formRevision: x('if', x('eq', view, 'edit'), '$step.3.updatedAt', ''),
				formValues: x(
					'if',
					x('eq', view, 'edit'),
					'$step.3.values',
					x(
						'if',
						'$step.13.copy',
						x(
							'merge',
							x('omit', '$step.13.copy.values', ['thumbnailId', 'bannerId', 'archived', 'userId', 'order']),
							x('if', '$step.13.copy.values.title', { title: x('concat', '$step.13.copy.values.title', ' (copy)') }, {})
						),
						x(
							'merge',
							{ date: '$step.9.date', status: 'Scheduled' },
							x('if', x('eq', '$step.13.parent.kind', 'customer'), { customerId: '$step.13.parent.id' }, {}),
							x('if', x('eq', '$step.13.parent.kind', 'address'), { addressId: '$step.13.parent.id' }, {}),
							x('if', x('eq', '$step.13.parent.kind', 'job'), { jobId: '$step.13.parent.id', title: '$step.13.parent.values.title' }, {}),
							x(
								'if',
								x('eq', '$step.13.parent.kind', 'visit'),
								{ visitId: '$step.13.parent.id', title: '$step.13.parent.values.title', employeeId: '$step.13.parent.values.employeeId' },
								{}
							)
						)
					)
				),
				loggedMinutes: x(
					'if',
					x('eq', '$step.3.kind', 'visit'),
					x('sum', related('time', matchesRecord('visitId')), x('toNumber', '$item.values.minutes')),
					0
				),
				relatedGroups: x(
					'map',
					'$step.15',
					x('merge', x('omit', '$item', ['all']), {
						items: x('slice', '$item.all', x('mul', x('sub', '$item.page', 1), 6), x('mul', '$item.page', 6)),
						previous: x('max', 1, x('sub', '$item.page', 1)),
						next: x('add', '$item.page', 1),
						hasNext: x('gt', '$item.total', x('mul', '$item.page', 6))
					})
				),
				todayVisits: x('filter', '$step.7.visit', x('eq', '$item.values.date', '$step.9.date')),
				upcomingVisits: x(
					'sortBy',
					x(
						'filter',
						'$step.7.visit',
						x('and', x('gt', '$item.values.date', '$step.9.date'), x('not', x('includes', ['Completed', 'Cancelled'], '$item.values.status')))
					),
					'$item.values.date'
				)
			}),
			ret(
				x('merge', '$step.10', '$step.16', {
					todayCount: x('length', '$step.16.todayVisits'),
					upcomingCount: x('length', '$step.16.upcomingVisits'),
					mapPoints: '$step.11',
					media: '$step.12.things',
					commentTarget: x('coalesce', '$input.threadId', '$input.id'),
					showMedia: x('and', '$step.3', x('isEmpty', '$input.threadId')),
					mediaCursor: '$step.12.nextCursor',
					mediaGroups: ['Before', 'After', 'Gallery'].map((stage) => ({
						title: stage,
						items: x(
							'filter',
							x('filter', x('coalesce', '$step.12.things', []), x('not', x('isEmpty', '$item.attachments'))),
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
				e('div', [icon('leaf', 24)], { className: 'sw-brand-mark' }),
				e('div', [e('p', ['FRANCHISE WORKSPACE']), e('h1', [test('result.name', '{result.name}', 'Jim’s Mowing')])]),
				e('span', ['{result.role}'], { className: 'sw-role' }),
				{ ...button('', '$refresh'), props: { type: 'button', 'aria-label': 'Refresh workspace' }, children: [icon('refresh')] }
			],
			{ className: 'sw-brand' }
		),
		e(
			'nav',
			[
				['overview', 'Overview'],
				['planner', 'Planner'],
				['customer', 'Customers'],
				['address', 'Properties'],
				['job', 'Jobs'],
				['equipment', 'Equipment'],
				['maps', 'Map'],
				['member', 'Team'],
				['setup', 'Setup'],
				['trash', 'Trash']
			].map(([view, label]) => {
				const tab = e('a', [icon(view), e('span', [label])], {
					href: `{pagePath}?view=${view}`,
					'aria-current': equal('result.screenView', view, 'page', false)
				});
				return view === 'member' ? equal('result.role', 'Admin', tab) : view === 'trash' ? test('result.canEdit', tab) : tab;
			}),
			{ className: 'sw-nav', 'aria-label': 'Franchise navigation' }
		),
		equal('state', 'error', e('p', ['{error}'], { role: 'alert', className: 'sw-error' })),
		equal('state', 'signed-out', link('Sign in', '/login')),
		equal(
			'state',
			'not-installed',
			e(
				'div',
				[
					e('p', ['Make your editable copy to use this app. Your team access still controls which records you can read and change.']),
					test('installAvailable', button('Make an editable copy', '$install'))
				],
				{ className: 'sw-warning' }
			)
		)
	]);
	component(
		'overview',
		'Overview',
		[
			heading('Overview'),
			e(
				'section',
				[
					e('div', [
						e('span', ['A GOOD DAY STARTS HERE'], { className: 'sw-eyebrow' }),
						e('h3', ['Ready for the next lawn.']),
						e('p', ['Your customers, properties and crew, all in one place.'])
					]),
					test('result.canEdit', createLink('Schedule a visit', 'visit'))
				],
				{ className: 'sw-welcome' }
			),
			e(
				'div',
				[
					['Today’s visits', 'todayCount', 'planner'],
					['Customers', 'counts.customer', 'customer'],
					['Properties', 'counts.address', 'address'],
					['Equipment', 'counts.equipment', 'equipment']
				].map(([label, path, view]) => ({
					...buttonLink(label, `{pagePath}?view=${view}`),
					children: [e('span', [label]), e('strong', [`{result.${path}}`])]
				})),
				{ className: 'sw-stats' }
			),
			visitPanel('Today’s visits', 'result.todayVisits', 'todayCount'),
			visitPanel('Upcoming visits', 'result.upcomingVisits', 'upcomingCount')
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
				heading(SERVICE_LABELS[kind], createLink(`Add ${SERVICE_SINGULAR[kind]}`, kind)),
				e('div', [buttonLink('Trash', `{pagePath}?view=trash&kind=${kind}`)], { className: 'sw-buttons' }),
				collection('result.allRecords', SERVICE_LABELS[kind], `Add your first ${SERVICE_SINGULAR[kind]} to get started.`)
			],
			kind
		);
		const fieldNodes = fields.map((field) => {
			const props: Json = {
				name: field.key,
				required: !!field.required,
				value:
					field.key === 'address'
						? draft('addressDraft', 'result.formValues.address')
						: kind === 'visit' && field.key === 'title'
						? draft('titleDraft', 'result.formValues.title')
						: arg(`result.formValues.${field.key}`),
				style: inputStyle,
				...(field.key === 'username' ? { readOnly: arg('result.editing') } : {})
			};
			const child = field.ref
				? e('tt-select', [], {
						...props,
						title: field.label,
						compact: true,
						...(kind === 'visit' && field.key === 'jobId'
							? { fills: [{ key: 'titleDraft', path: 'title', current: draft('titleDraft', 'result.formValues.title'), whenEmpty: true }] }
							: {}),
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
					field.key === 'address'
						? { ...child, ttAction: '$ui', ttActionInputs: { op: 'set', key: 'addressDraft', clear: ['placeDraft'] } }
						: kind === 'visit' && field.key === 'title'
						? local('titleDraft', child)
						: child
				],
				{ className: field.type === 'textarea' ? 'sw-wide' : '' }
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
					e(
						'div',
						[
							...fieldNodes,
							e(
								'div',
								[
									{ ...button('Save', key(`save-${kind}`)), props: { type: 'button', className: 'sw-primary' } },
									button('Cancel', '$ui', { op: 'query', params: { view: '{result.screenView}', id: '{query.returnId}' } })
								],
								{ className: 'sw-buttons sw-wide' }
							)
						],
						{ className: 'sw-form sw-form-grid' }
					),
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
		const modal = e('tt-dialog', [...(kind === 'address' ? [addressSearch] : []), form], {
			title: `${SERVICE_SINGULAR[kind]}`,
			autoOpen: true,
			className: 'service-workspace sw-modal',
			closeQuery: { view: '{result.screenView}', id: '{query.returnId}' },
			closeOnAction: key(`save-${kind}`)
		});
		component(`form-${kind}`, `${SERVICE_LABELS[kind]} form`, [
			equal('result.view', `new-${kind}`, { ...modal, props: { ...modal.props, title: `Add ${SERVICE_SINGULAR[kind]}` } }),
			equal(
				'result.view',
				'edit',
				equal('result.record.kind', kind, { ...modal, props: { ...modal.props, title: `Edit ${SERVICE_SINGULAR[kind]}` } })
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

	action(
		'reorder',
		[
			s('rootId', { required: true }),
			s('id', { required: true }),
			s('expectedUpdatedAt', { required: true }),
			s('date', { required: true }),
			s('beforeId')
		],
		[
			{ ...ret({ silent: true }), when: x('eq', '$input.id', '$input.beforeId') },
			req(),
			calc(
				x('find', '$step.2.records', x('and', x('eq', '$item.id', '$input.id'), x('eq', '$item.kind', 'visit'), x('not', '$item.values.archived')))
			),
			calc(
				x(
					'sortBy',
					x(
						'filter',
						'$step.2.records',
						x(
							'and',
							x('eq', '$item.kind', 'visit'),
							x('eq', '$item.values.date', '$input.date'),
							x('ne', '$item.id', '$input.id'),
							x('not', '$item.values.archived')
						)
					),
					x('coalesce', '$item.values.order', 0)
				)
			),
			calc(x('if', '$input.beforeId', x('findIndex', '$step.4', x('eq', '$item.id', '$input.beforeId')), x('length', '$step.4'))),
			{ op: 'fail', message: 'This visit changed. Refresh the planner before moving it.', when: x('or', x('not', '$step.3'), x('lt', '$step.5', 0)) },
			calc({
				previous: x(
					'if',
					x('gt', '$step.5', 0),
					x('coalesce', x('get', x('get', x('get', '$step.4', x('sub', '$step.5', 1)), 'values'), 'order'), 0),
					null
				),
				next: x(
					'if',
					x('lt', '$step.5', x('length', '$step.4')),
					x('coalesce', x('get', x('get', x('get', '$step.4', '$step.5'), 'values'), 'order'), 0),
					null
				)
			}),
			req({
				operation: 'move',
				rootId: '$input.rootId',
				id: '$input.id',
				expectedUpdatedAt: '$input.expectedUpdatedAt',
				date: '$input.date',
				time: '$step.3.values.time',
				order: x(
					'if',
					x('isEmpty', '$step.7.previous'),
					x('sub', x('coalesce', '$step.7.next', 1024), 1024),
					x('if', x('isEmpty', '$step.7.next'), x('add', '$step.7.previous', 1024), x('div', x('add', '$step.7.previous', '$step.7.next'), 2))
				)
			}),
			ret({ silent: true, message: 'Visit moved' })
		]
	);
	const plannerParams = {
		view: 'planner',
		date: '{result.date}',
		period: '{result.period}',
		q: '{query.q}',
		status: '{query.status}',
		employee: '{query.employee}',
		size: '{query.size}'
	};
	const plannerQuery = (label: string, params: Json, props: Json = {}) => ({
		...button(label, '$ui', { op: 'query', params: { ...plannerParams, ...params } }),
		props: { type: 'button', ...props }
	});
	const change = (control: Json, actionKey: string, inputs: Json, inputPath: string, props: Json = {}) => ({
		...e('tt-change', [control], { inputPath, ...props }),
		ttAction: actionKey,
		ttActionInputs: inputs
	});
	const plannerFilter = (name: string, control: Json, props: Json = {}) =>
		change(control, '$ui', { op: 'query', params: plannerParams }, 'params.' + name, props);
	const moveInputs = { rootId: '{rootId}', id: '{item.id}', expectedUpdatedAt: '{item.updatedAt}', date: '{item.values.date}' };
	const plannerVisit = {
		...e(
			'tt-drop',
			[
				e(
					'tt-drag',
					[
						e(
							'a',
							[
								e('strong', ['{item.title}']),
								e('span', ['{item.values.time} · {item.values.status}'], { className: 'sw-visit-time' }),
								recordContext
							],
							{ href: '{pagePath}?view=detail&id={item.id}&returnView=planner', className: 'sw-card-open' }
						),
						recordMenu,
						test(
							'result.canEdit',
							e(
								'div',
								[
									{
										...button('↑', key('reorder'), { ...moveInputs, beforeId: '{collection.previous.id}' }),
										props: { type: 'button', 'aria-label': 'Move {item.title} up', disabled: test('collection.previous', false, true) }
									},
									{
										...button('↓', key('reorder'), { ...moveInputs, beforeId: '{collection.afterNext.id}' }),
										props: { type: 'button', 'aria-label': 'Move {item.title} down', disabled: test('collection.next', false, true) }
									},
									e('label', [
										'Move to',
										change(
											e('input', [], { type: 'date', value: '{item.values.date}', 'aria-label': 'Move {item.title} to date' }),
											key('reorder'),
											{ ...moveInputs, beforeId: '' },
											'date',
											{ allowEmpty: false }
										)
									])
								],
								{ className: 'sw-move-controls' }
							)
						)
					],
					{
						group: key('planner'),
						inputs: { id: '{item.id}', expectedUpdatedAt: '{item.updatedAt}' },
						disabled: test('result.canEdit', false, true),
						className: 'sw-visit'
					}
				)
			],
			{ group: key('planner'), sourceInputs: ['id', 'expectedUpdatedAt'], disabled: test('result.canEdit', false, true) }
		),
		ttAction: key('reorder'),
		ttActionInputs: { rootId: '{rootId}', date: '{item.values.date}', beforeId: '{item.id}' }
	};
	component(
		'planner',
		'Planner',
		[
			heading('Planner', createLink('Schedule a visit', 'visit')),
			e(
				'section',
				[
					e(
						'div',
						[
							e(
								'div',
								[
									plannerQuery('←', { date: '{result.previousDate}' }, { 'aria-label': 'Previous period' }),
									plannerQuery('Today', { date: '{result.today}' }),
									plannerQuery('→', { date: '{result.nextDate}' }, { 'aria-label': 'Next period' })
								],
								{ className: 'sw-buttons' }
							),
							e('h2', ['{result.startLabel}']),
							e(
								'div',
								[
									...['day', 'week'].map((period) =>
										plannerQuery(period === 'day' ? 'Day' : 'Week', { period }, { 'aria-pressed': equal('result.period', period, true, false) })
									),
									e(
										'label',
										['Planner date', plannerFilter('date', e('input', [], { type: 'date', value: '{result.date}' }), { allowEmpty: false })],
										{ className: 'sw-sr' }
									)
								],
								{ className: 'sw-buttons' }
							)
						],
						{ className: 'sw-toolbar' }
					),
					e(
						'p',
						[
							'{result.timeZone} · ',
							test('result.canEdit', 'Drag visits between days or use the move controls. Open a visit to set its time.', 'Your upcoming visits.')
						],
						{ className: 'sw-muted' }
					),
					e(
						'div',
						[
							e(
								'div',
								[
									e(
										'label',
										[
											plannerFilter(
												'q',
												e('input', [], {
													type: 'search',
													'aria-label': 'Search planner',
													placeholder: 'Search jobs, addresses, customers or crew…',
													value: draft('plannerSearch', 'query.q')
												}),
												{ stateKey: 'plannerSearch', debounceMs: 350 }
											)
										],
										{ className: 'tt-collection-search' }
									),
									e(
										'label',
										[
											'Status',
											plannerFilter(
												'status',
												e(
													'select',
													[
														e('option', ['All'], { value: '' }),
														...SERVICE_FIELDS.visit.find((f) => f.key === 'status')!.options!.map((value) => e('option', [value], { value }))
													],
													{ 'aria-label': 'Planner status', value: '{query.status}' }
												)
											)
										],
										{ className: 'tt-collection-field' }
									),
									e(
										'label',
										[
											'Employee',
											plannerFilter(
												'employee',
												e(
													'select',
													[
														e('option', ['All'], { value: '' }),
														e('option', ['Unassigned'], { value: '__unassigned__' }),
														each('result.team', e('option', ['{item.name}'], { value: '{item.id}' }), '')
													],
													{ 'aria-label': 'Planner employee', value: '{query.employee}' }
												)
											)
										],
										{ className: 'tt-collection-field' }
									),
									e(
										'label',
										[
											'Show',
											plannerFilter(
												'size',
												e(
													'select',
													[5, 10, 15, 20, 'infinite'].map((value) =>
														e('option', [value === 'infinite' ? 'Infinite scrolling' : String(value)], { value })
													),
													{ 'aria-label': 'Show visits per day', value: test('query.size', '{query.size}', '10') }
												)
											)
										],
										{ className: 'tt-collection-field' }
									),
									test(
										'query.q',
										plannerQuery('Clear planner filters', { q: '', status: '', employee: '' }),
										test(
											'query.status',
											plannerQuery('Clear planner filters', { q: '', status: '', employee: '' }),
											test('query.employee', plannerQuery('Clear planner filters', { q: '', status: '', employee: '' }))
										)
									)
								],
								{ className: 'tt-collection-controls' }
							)
						],
						{ className: 'tt-collection' }
					)
				],
				{ 'aria-label': 'Job planner' }
			)
		],
		'planner'
	);
	component(
		'planner-board',
		'Planner days',
		[
			e(
				'div',
				[
					each('result.days', {
						...e(
							'tt-drop',
							[
								e('header', [e('h3', ['{item.label}']), e('span', ['{item.total}'])]),
								e('tt-collection', [], {
									itemsPath: 'result.days.{index}.records',
									itemTemplate: { ttTemplate: plannerVisit },
									label: 'Visits on {item.date}',
									empty: 'No matching visits',
									hideSearch: true,
									hideSize: true,
									size: '{query.size}'
								}),
								test('result.canEdit', { ...link('+ Schedule visit', '{pagePath}?view=new-visit&date={item.date}', 'sw-add-day sw-link-button') })
							],
							{
								className: test('item.today', 'sw-day sw-day-today', 'sw-day'),
								group: key('planner'),
								sourceInputs: ['id', 'expectedUpdatedAt'],
								disabled: test('result.canEdit', false, true)
							}
						),
						ttAction: key('reorder'),
						ttActionInputs: { rootId: '{rootId}', date: '{item.date}', beforeId: '' }
					})
				],
				{ className: 'sw-planner sw-planner-{result.period}' }
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
	component('footer', 'App footer', [
		e(
			'footer',
			[
				icon('leaf', 14),
				'{result.name}',
				e('span', ['{result.timeZone}']),
				link('Privacy', '/legal/privacy-policy'),
				link('Terms', '/legal/terms-of-service')
			],
			{ className: 'sw-footer' }
		),
		test(
			'installAvailable',
			e('details', [e('summary', ['Builder']), button('Make an editable copy', '$install')], { style: { padding: '12px 28px' } })
		)
	]);
	const componentKeys = definitions.filter((d) => d.thingtime[0] === 'component').map((d) => d.crystal.componentKey);
	const blocks = [
		{
			id: key('layout'),
			type: 'container',
			direction: 'column',
			align: 'center',
			maxWidth: 1400,
			gap: 0,
			css: {
				padding: '0',
				width: '100%',
				'box-sizing': 'border-box',
				border: '1px solid #dce5de',
				'border-radius': '18px',
				overflow: 'clip',
				background: '#f6f8f3',
				'--app-ink': '#18392d',
				'--app-muted': '#6b7870',
				'--app-green': '#176340',
				'--app-line': '#dce5de',
				'--app-bg': '#f6f8f3'
			},
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
