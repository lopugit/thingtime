import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceAppComposition } from './workspaceAppComposition';
import { validateThingtimeCrystal } from './registry';
import { executeBrowserAction, type BrowserActionHost } from '../components/Actions/browserActionRuntime';
import type { PreparedBrowserAction } from './browserActions';
import { normalizeLimitlessMutationOperations, buildLimitlessMutationPreview } from '../api/utils/chatgpt/pluginLimitlessCore';
import { resolveTemplate } from '../components/ComponentsLibrary/componentTemplate';
const app = workspaceAppComposition({ namespace: 'qa-builder', rootId: 'existing-root', pagePath: '/p/existing-page' });
function prepare(key: string, inputs: Record<string, unknown>): PreparedBrowserAction {
	const definition = app.definitions.find((d) => d.crystal.actionKey === key);
	assert.ok(definition, key);
	return { ok: true, status: 'prepared', execution: 'browser', actionId: key, viewer: { id: 'owner' }, program: definition.crystal, inputs };
}
const record = (i: number) => ({
	id: `customer-${i}`,
	kind: 'customer',
	values: { firstName: 'Customer', lastName: String(i), phone: '0400000000' },
	updatedAt: '2026-09-23T00:00:00.000Z'
});
function host(records: any[], requests: any[] = []): BrowserActionHost {
	return {
		assertIdentity: (id) => assert.equal(id, 'owner'),
		prepare: async (action, inputs) => prepare(action, inputs),
		request: async (step) => {
			requests.push(step);
			if (step.path === '/api/v1/things') return { things: [], nextCursor: null };
			if ((step.body as any)?.operation === 'place') return { location: { latitude: -37, longitude: 145 } };
			return { records, nextCursor: null, role: 'Admin', owner: true, timeZone: 'Australia/Melbourne', mapsConfigured: true, name: 'Existing app' };
		}
	};
}

test('app definitions survive the actual save sanitizer with their source bindings and no opaque native block', () => {
	for (const definition of app.definitions) {
		const result = validateThingtimeCrystal(definition.thingtime, definition.crystal);
		assert.equal(result.ok, true, `${definition.crystal.name}: ${JSON.stringify(result)}`);
		if (result.ok && definition.thingtime[0] === 'component')
			assert.deepEqual(result.crystal.source, { action: 'qa-builder-read', inputs: definition.crystal.source.inputs });
	}
	assert.ok(app.definitions.some((d) => d.crystal.componentKey === 'qa-builder-map'));
	assert.ok(app.definitions.some((d) => d.crystal.componentKey === 'qa-builder-media'));
	assert.ok(!JSON.stringify(app.blocks).includes('service-workspace'));
	assert.equal(app.rootId, 'existing-root');
});

test('read actions retain every record while exposing a bounded page', async () => {
	const records = Array.from({ length: 5000 }, (_, i) => record(i));
	const result: any = await executeBrowserAction(prepare('qa-builder-read', { rootId: app.rootId, view: 'customer', page: '400' }), host(records));
	assert.equal(result.total, 5000);
	assert.equal(result.page, 400);
	assert.equal(result.records.length, 12);
	assert.equal(result.counts.customer, 5000);
	assert.equal(result.options.customer.length, 5000);
});

test('map composition requests coordinates only for the visible address page', async () => {
	const records = Array.from({ length: 30 }, (_, i) => ({
		id: `address-${i}`,
		kind: 'address',
		values: { title: `Property ${String(i).padStart(2, '0')}`, placeId: 'place' },
		updatedAt: 'stamp'
	}));
	const requests: any[] = [];
	const result: any = await executeBrowserAction(
		prepare('qa-builder-read', { rootId: app.rootId, view: 'maps', page: '2' }),
		host(records, requests)
	);
	assert.equal(result.mapPoints.length, 12);
	assert.equal(requests.filter((r) => r.body?.operation === 'place').length, 12);
	assert.equal(result.mapPoints[0].href, '?view=detail&id=address-12');
});

test('visit and job cards retain authorized property, customer and crew context without missing-reference fallback', async () => {
	const rows = [
		{ id: 'address', kind: 'address', values: { title: 'Garden', address: '24 Example St' } },
		{ id: 'customer', kind: 'customer', values: { firstName: 'Alex', lastName: 'Green' } },
		{ id: 'archived', kind: 'customer', values: { firstName: 'Archived', archived: true } },
		{ id: 'link', kind: 'link', values: { customerId: 'customer', addressId: 'address' } },
		{ id: 'duplicate-link', kind: 'link', values: { customerId: 'customer', addressId: 'address' } },
		{ id: 'archived-link', kind: 'link', values: { customerId: 'archived', addressId: 'address' } },
		{ id: 'job', kind: 'job', values: { title: 'Hedges', addressId: 'address' } },
		{ id: 'visit', kind: 'visit', values: { title: 'Trim', jobId: 'job', employeeId: 'crew', status: 'Scheduled' } },
		{ id: 'cancelled', kind: 'visit', values: { jobId: 'job', employeeId: 'other', status: 'Cancelled' } },
		{ id: 'missing', kind: 'visit', values: { jobId: 'unavailable', employeeId: 'unknown' } }
	];
	const gateway = host(rows);
	const request = gateway.request;
	gateway.request = async (...args) => ({
		...((await request(...args)) as Record<string, unknown>),
		team: [
			{ id: 'crew', name: 'Sam' },
			{ id: 'other', name: 'Cancelled crew' }
		]
	});
	const result: any = await executeBrowserAction(prepare('qa-builder-snapshot', { rootId: app.rootId }), gateway);
	const expected = ['Garden · 24 Example St', 'Customers: Alex Green', 'Assigned crew: Sam'];
	for (const id of ['job', 'visit'])
		assert.deepEqual(
			result.records.find((row: any) => row.id === id).context.map((row: any) => row.text),
			expected
		);
	assert.equal(result.records.find((row: any) => row.id === 'visit').employeeName, 'Sam');
	assert.deepEqual(
		result.records.find((row: any) => row.id === 'missing').context.map((row: any) => row.text),
		['Property unavailable', 'Assigned crew: Unassigned']
	);
	assert.ok(result.records.every((row: any) => !('contextJob' in row)));
});

test('media reads remain scoped to the selected record and carry the requested cursor', async () => {
	const requests: any[] = [];
	await executeBrowserAction(
		prepare('qa-builder-read', { rootId: app.rootId, view: 'detail', id: 'customer-1', mediaCursor: 'next-page' }),
		host([record(1)], requests)
	);
	assert.deepEqual(requests.find((r) => r.path === '/api/v1/things').query, {
		target: 'customer-1',
		thingtime: 'comment',
		limit: 12,
		cursor: 'next-page'
	});
});

test('save keeps caller-supplied operation identity and revision for retry and concurrency checks', async () => {
	let sent: any;
	const gateway = host([]);
	gateway.request = async (step) => {
		sent = step.body;
		return { id: 'stable-operation' };
	};
	await executeBrowserAction(
		prepare('qa-builder-save-customer', {
			rootId: app.rootId,
			id: 'stable-operation',
			expectedUpdatedAt: 'original-revision',
			firstName: 'Edited',
			phone: '0400000012'
		}),
		gateway
	);
	assert.equal(sent.id, 'stable-operation');
	assert.equal(sent.expectedUpdatedAt, 'original-revision');
	assert.equal(sent.values.phone, '0400000012');
});

test('component sources reject unsafe or malformed references instead of silently disappearing', () => {
	const original = app.definitions.find((d) => d.thingtime[0] === 'component')!;
	for (const source of [
		{ action: 'https://example.test' },
		{ action: 'read', inputs: { query: { bad: true } } },
		{ action: 'read', refresh: 'everywhere' }
	])
		assert.equal(validateThingtimeCrystal(['component'], { ...original.crystal, source }).ok, false);
});

test('planner day/week navigation and filters use the saved Action contract', async () => {
	const records = [
		{ id: 'v1', kind: 'visit', values: { title: 'Trim', date: '2026-09-23', status: 'Scheduled', employeeId: 'm1' } },
		{ id: 'v2', kind: 'visit', values: { title: 'Cut', date: '2026-09-24', status: 'Completed', employeeId: 'm2' } }
	];
	const day: any = await executeBrowserAction(
		prepare('qa-builder-read', { rootId: app.rootId, view: 'planner', date: '2026-09-23', period: 'day', status: 'Scheduled', employee: 'm1' }),
		host(records)
	);
	assert.equal(day.days.length, 1);
	assert.equal(day.previousDate, '2026-09-22');
	assert.equal(day.nextDate, '2026-09-24');
	assert.deepEqual(
		day.days[0].records.map((r: any) => r.id),
		['v1']
	);
	const week: any = await executeBrowserAction(
		prepare('qa-builder-read', { rootId: app.rootId, view: 'planner', date: '2026-09-23' }),
		host(records)
	);
	assert.equal(week.days.length, 7);
	assert.equal(week.nextDate, '2026-09-30');
});

test('detail references show authorized titles and category-specific equipment choices', async () => {
	const records = [
		{ id: 'property', kind: 'address', values: { title: 'Garden' } },
		{ id: 'job', kind: 'job', values: { title: 'Trim', addressId: 'property' } },
		{ id: 'battery', kind: 'equipment', values: { title: 'Pack', category: 'Battery' } },
		{ id: 'van', kind: 'equipment', values: { title: 'Van', category: 'Vehicle' } }
	];
	const result: any = await executeBrowserAction(prepare('qa-builder-read', { rootId: app.rootId, view: 'detail', id: 'job' }), host(records));
	assert.deepEqual(
		result.recordFields.find((f: any) => f.label === 'Address'),
		{ label: 'Address', value: 'Garden', id: 'property' }
	);
	assert.deepEqual(
		result.options.battery.map((r: any) => r.id),
		['battery']
	);
	assert.deepEqual(
		result.options.vehicle.map((r: any) => r.id),
		['van']
	);
	const hidden: any = await executeBrowserAction(
		prepare('qa-builder-read', { rootId: app.rootId, view: 'detail', id: 'job' }),
		host(records.filter((r) => r.id !== 'property'))
	);
	assert.equal(hidden.recordFields.find((f: any) => f.label === 'Address').value, 'Unavailable record');
});

test('customer and non-admin member forms contain no Save controls', async () => {
	for (const [role, view, form] of [
		['Customer', 'new-address', 'form-address'],
		['Employee', 'new-member', 'form-member']
	]) {
		const gateway = host([]),
			request = gateway.request;
		gateway.request = async (...args) => ({ ...((await request(...args)) as Record<string, unknown>), role });
		const result = await executeBrowserAction(prepare('qa-builder-read', { rootId: app.rootId, view }), gateway);
		const definition = app.definitions.find((d) => d.crystal.componentKey === 'qa-builder-' + form)!;
		const rendered = JSON.stringify(resolveTemplate(definition.crystal.render, { result }));
		assert.ok(rendered.includes('Your role can view'));
		assert.ok(!rendered.includes('data-tt-action'));
	}
});

test('media stage groups preserve unlabelled gallery files and requested page', async () => {
	const gateway = host([record(1)]),
		request = gateway.request;
	gateway.request = async (...args) =>
		args[0].path === '/api/v1/things'
			? {
					things: [
						{ id: 'b', attachments: [{ id: 'image-b' }], crystal: { text: '[Before] Lawn' } },
						{ id: 'a', attachments: [{ id: 'image-a' }], crystal: { text: '[After] Lawn' } },
						{ id: 'g', attachments: [{ id: 'image-g' }], crystal: { text: 'Existing file' } }
					],
					nextCursor: 'more'
			  }
			: request(...args);
	const result: any = await executeBrowserAction(prepare('qa-builder-read', { rootId: app.rootId, view: 'detail', id: 'customer-1' }), gateway);
	assert.deepEqual(
		result.mediaGroups.map((g: any) => [g.title, g.items.map((r: any) => r.id)]),
		[
			['Before', ['b']],
			['After', ['a']],
			['Gallery', ['g']]
		]
	);
	assert.equal(result.mediaCursor, 'more');
});

test('ungrouped map credentials retain the existing null environment contract', async () => {
	const requests: any[] = [];
	await executeBrowserAction(prepare('qa-builder-maps-setup', { rootId: app.rootId, environmentId: '' }), host([], requests));
	assert.equal(requests[0].body.environmentId, null);
	const setup = app.definitions.find((d) => d.crystal.componentKey === 'qa-builder-setup')!;
	const rendered: any = resolveTemplate(setup.crystal.render, {
		result: { view: 'setup', screenView: 'setup', owner: true, mapsEnvironmentId: null, mapsEnvironments: [] }
	});
	const encoded = JSON.stringify(rendered);
	assert.ok(encoded.includes('Ungrouped'));
	assert.ok(!encoded.includes('Disabled'));
	assert.ok(encoded.includes('"name":"environmentId","value":""'));
});

const relatedFixture: any[] = [
	{ id: 'c', kind: 'customer', values: { firstName: 'Sam' } },
	{ id: 'p', kind: 'address', values: { title: 'Garden' } },
	{ id: 'l', kind: 'link', values: { customerId: 'c', addressId: 'p' } },
	{ id: 'j', kind: 'job', values: { title: 'Mow', addressId: 'p' } },
	{
		id: 'v',
		kind: 'visit',
		values: { title: 'Mow today', jobId: 'j', employeeId: 'crew', status: 'Scheduled', date: '2026-09-23' },
		updatedAt: 'seen'
	},
	{ id: 't', kind: 'time', values: { visitId: 'v', title: 'Lawn', minutes: 25 } },
	{ id: 'old-time', kind: 'time', values: { visitId: 'v', minutes: 100, archived: true } },
	{ id: 'battery', kind: 'equipment', values: { title: 'Battery', category: 'Battery' } },
	{ id: 'u', kind: 'usage', values: { visitId: 'v', equipmentId: 'tool', batteryId: 'battery', vehicleId: 'van' } }
];

test('linked records, reverse links and time totals use only active authorized records', async () => {
	const read = async (id: string) =>
		executeBrowserAction(prepare('qa-builder-read', { rootId: app.rootId, view: 'detail', id }), host(relatedFixture)) as Promise<any>;
	const customer = await read('c');
	assert.deepEqual(
		customer.relatedGroups.find((g: any) => g.key === 'properties').items.map((r: any) => r.id),
		['p']
	);
	const property = await read('p');
	assert.deepEqual(
		property.relatedGroups.find((g: any) => g.key === 'customers').items.map((r: any) => r.id),
		['c']
	);
	assert.deepEqual(
		property.relatedGroups.find((g: any) => g.key === 'visits').items.map((r: any) => r.id),
		['v']
	);
	const visit = await read('v');
	assert.equal(visit.loggedMinutes, 25);
	assert.deepEqual(
		visit.relatedGroups.find((g: any) => g.key === 'times').items.map((r: any) => r.id),
		['t']
	);
	const battery = await read('battery');
	assert.deepEqual(
		battery.relatedGroups[0].items.map((r: any) => r.id),
		['u']
	);
	const restricted: any = await executeBrowserAction(
		prepare('qa-builder-read', { rootId: app.rootId, view: 'detail', id: 'c' }),
		host(relatedFixture.filter((r) => r.id !== 'p'))
	);
	assert.equal(restricted.relatedGroups.find((g: any) => g.key === 'properties').total, 0);
});

test('related sections page every matching record independently', async () => {
	const records = [
		...relatedFixture,
		...Array.from({ length: 19 }, (_, i) => ({
			id: `visit-${i}`,
			kind: 'visit',
			values: { jobId: 'j', date: `2026-10-${String(i + 1).padStart(2, '0')}` }
		}))
	];
	const ids = new Set();
	for (const relatedPage of ['1', '2', '3', '4']) {
		const result: any = await executeBrowserAction(
			prepare('qa-builder-read', { rootId: app.rootId, view: 'detail', id: 'j', related: 'visits', relatedPage }),
			host(records)
		);
		const group = result.relatedGroups.find((g: any) => g.key === 'visits');
		assert.ok(group.items.length <= 6);
		group.items.forEach((r: any) => ids.add(r.id));
		assert.equal(group.hasNext, relatedPage !== '4');
	}
	assert.equal(ids.size, 20);
});

test('child defaults and duplication never reuse record identity or private media bindings', async () => {
	const read = async (inputs: any, records = relatedFixture) =>
		executeBrowserAction(prepare('qa-builder-read', { rootId: app.rootId, ...inputs }), host(records)) as Promise<any>;
	const visit = await read({ view: 'new-visit', parentId: 'j', date: '2026-09-23' });
	assert.equal(visit.formId, '');
	assert.equal(visit.formRevision, '');
	assert.equal(visit.formValues.jobId, 'j');
	assert.equal(visit.formValues.title, 'Mow');
	const time = await read({ view: 'new-time', parentId: 'v' });
	assert.equal(time.formValues.visitId, 'v');
	assert.equal(time.formValues.employeeId, 'crew');
	const copy = await read(
		{ view: 'new-equipment', copyId: 'battery' },
		relatedFixture.map((r) =>
			r.id === 'battery' ? { ...r, values: { ...r.values, thumbnailId: 'private-image', userId: 'someone', archived: true } } : r
		)
	);
	assert.equal(copy.formValues.title, 'Battery (copy)');
	assert.equal(copy.formValues.thumbnailId, undefined);
	assert.equal(copy.formValues.userId, undefined);
	assert.equal(copy.formValues.archived, undefined);
	const missing = await read({ view: 'new-time', parentId: 'hidden' });
	assert.equal(missing.formValues.visitId, undefined);
	const wrongKind = await read({ view: 'new-equipment', copyId: 'j' });
	assert.equal(wrongKind.formValues.title, undefined);
});

test('quick field updates retain original concurrency stamp and reject unrelated fields before writing', async () => {
	const inputs = { rootId: app.rootId, id: 'v', expectedUpdatedAt: 'seen', field: 'status', value: 'Completed' };
	const requests: any[] = [];
	await executeBrowserAction(prepare('qa-builder-set-field', inputs), host(relatedFixture, requests));
	assert.equal(requests.length, 2);
	assert.equal(requests[1].body.values.title, 'Mow today');
	assert.equal(requests[1].body.values.status, 'Completed');
	assert.equal(requests[1].body.expectedUpdatedAt, 'seen');
	for (const changed of [
		{ expectedUpdatedAt: 'old' },
		{ field: 'role', value: 'Admin' },
		{ field: 'bannerId', value: 'image' },
		{ value: 'bad-status' },
		{ id: 'hidden' }
	]) {
		const calls: any[] = [];
		await assert.rejects(executeBrowserAction(prepare('qa-builder-set-field', { ...inputs, ...changed }), host(relatedFixture, calls)));
		assert.ok(calls.every((call) => call.method === 'GET'));
	}
});

test('thread reads and comment writes keep target and retry identity explicit', async () => {
	const calls: any[] = [];
	const result: any = await executeBrowserAction(
		prepare('qa-builder-read', { rootId: app.rootId, view: 'detail', id: 'v', threadId: 'comment-thread', mediaCursor: 'cursor' }),
		host(relatedFixture, calls)
	);
	assert.equal(result.commentTarget, 'comment-thread');
	assert.equal(calls.find((c) => c.path === '/api/v1/things').query.target, 'comment-thread');
	await executeBrowserAction(
		prepare('qa-builder-save-comment', { id: 'comment-thread', shareId: 'retry-id', text: 'Note' }),
		host(relatedFixture, calls)
	);
	assert.deepEqual(calls.at(-1).body, { id: 'comment-thread', shareId: 'retry-id', text: 'Note' });
});

test('copied app navigation and save receipts are independent of original page and Action keys', async () => {
	const { rewriteComposition } = await import('../api/utils/actions/forkCompositionCore');
	const copied = app.definitions.map((def) => ({ ...def, crystal: rewriteComposition(def.thingtime, def.crystal, (_kind, key) => 'copy-' + key) }));
	assert.ok(!JSON.stringify(app.blocks).includes('/p/existing-page'));
	assert.ok(!JSON.stringify(app.definitions).includes('/p/existing-page'));
	const form = copied.find((def) => def.crystal.componentKey === 'qa-builder-form-customer')!;
	const rendered = JSON.stringify(
		resolveTemplate(form.crystal.render, {
			pagePath: '',
			result: { view: 'new-customer', canEdit: true, formValues: {} },
			last: { action: 'copy-qa-builder-save-customer', ok: true, result: { operation: 'save-customer', id: 'saved' } }
		})
	);
	assert.ok(rendered.includes('copy-qa-builder-save-customer'));
	assert.ok(rendered.includes('Open saved record'));
	assert.ok(rendered.includes('?view=detail&id=saved'));
	const read = copied.find((def) => def.crystal.actionKey === 'qa-builder-read')!;
	assert.equal(read.crystal.steps.find((step: any) => step.op === 'each').action, 'copy-qa-builder-place');
	assert.equal(form.crystal.source.action, 'copy-qa-builder-read');
});

test('upcoming visits omit completed and cancelled work', async () => {
	const records = ['Scheduled', 'In progress', 'Completed', 'Cancelled'].map((status) => ({
		id: status,
		kind: 'visit',
		values: { date: '2026-09-24', status }
	}));
	const result: any = await executeBrowserAction(prepare('qa-builder-read', { rootId: app.rootId, date: '2026-09-23' }), host(records));
	assert.deepEqual(
		result.upcomingVisits.map((r: any) => r.id),
		['Scheduled', 'In progress']
	);
});

test('quick updates can find a record beyond the default expression list limit', async () => {
	const records = [...Array.from({ length: 4999 }, (_, i) => record(i)), ...relatedFixture.filter((r) => r.id === 'v')];
	const requests: any[] = [];
	await executeBrowserAction(
		prepare('qa-builder-set-field', { rootId: app.rootId, id: 'v', expectedUpdatedAt: 'seen', field: 'status', value: 'Completed' }),
		host(records, requests)
	);
	assert.equal(requests.at(-1).body.id, 'v');
});

test('every saved definition fits a signed mutation preview at maximum app identifier lengths', () => {
	const portable = workspaceAppComposition({ namespace: 'x'.repeat(36), rootId: 'r'.repeat(160), pagePath: '/p/' + 'p'.repeat(120) });
	for (const definition of portable.definitions) {
		const id = definition.crystal.actionKey || definition.crystal.componentKey;
		const operations = normalizeLimitlessMutationOperations([
			{
				action: 'create',
				thing: {
					...definition,
					shareId: id,
					acl: ['tt:user', 'tt:custom', 'tt:service-workspace'],
					extended: { serviceWorkspaceId: portable.rootId }
				}
			}
		]);
		assert.ok(operations.ok);
		if (!operations.ok) continue;
		const preview = buildLimitlessMutationPreview({ accountId: 'a'.repeat(36), operations: operations.value, beforeById: new Map() });
		assert.equal(preview.ok, true, `${id}: ${preview.ok === false ? preview.error : ''}`);
	}
});

test('record field projection preserves values and refuses missing or wrong-kind reference labels', async () => {
	const rows = [
		{ id: 'property', kind: 'address', values: { address: 'Archived property', archived: true } },
		{ id: 'job', kind: 'job', values: { title: 'Work', addressId: 'property', estimatedMinutes: 0, description: '' } }
	];
	const read = async (records: any[]) =>
		executeBrowserAction(prepare('qa-builder-read', { rootId: app.rootId, view: 'detail', id: 'job' }), host(records)) as Promise<any>;
	const result = await read(rows);
	assert.equal(result.recordTitle, 'Work');
	assert.deepEqual(
		result.recordFields.find((f: any) => f.label === 'Address'),
		{ label: 'Address', value: 'Archived property', id: 'property' }
	);
	assert.equal(result.recordFields.find((f: any) => f.label === 'Estimated total minutes').value, 0);
	assert.equal(result.recordFields.find((f: any) => f.label === 'Description').value, '');
	for (const references of [[], [{ ...rows[0], kind: 'customer' }], [{ ...rows[0], id: 'unrelated-property' }]]) {
		const missing = await read([rows[1], ...references]);
		assert.deepEqual(
			missing.recordFields.find((f: any) => f.label === 'Address'),
			{ label: 'Address', value: 'Unavailable record', id: null }
		);
	}
});

test('planner weeks start on Monday including Sunday and retain every daily visit', async () => {
	const rows = Array.from({ length: 30 }, (_, index) => ({
		id: `visit-${index}`,
		kind: 'visit',
		values: { title: `Visit ${index}`, date: '2026-09-27', order: 30 - index }
	}));
	const result: any = await executeBrowserAction(prepare('qa-builder-read', { rootId: app.rootId, view: 'planner', date: '2026-09-27' }), host(rows));
	assert.equal(result.days[0].date, '2026-09-21');
	assert.equal(result.days[6].records.length, 30);
	assert.equal(result.days[6].records[0].id, 'visit-29');
});

test('planner reorder calculates insertion positions and preserves the displayed concurrency revision', async () => {
	const rows = [
		{ id: 'moved', kind: 'visit', updatedAt: 'fresh-but-not-displayed', values: { date: '2026-09-21', time: '10:30', order: 0 } },
		{ id: 'first', kind: 'visit', values: { date: '2026-09-22', order: 1024 } },
		{ id: 'last', kind: 'visit', values: { date: '2026-09-22', order: 3072 } }
	];
	const inputs = { rootId: app.rootId, id: 'moved', expectedUpdatedAt: 'displayed-revision', date: '2026-09-22' };
	for (const [beforeId, expectedOrder] of [
		['first', 0],
		['last', 2048],
		['', 4096]
	] as const) {
		const requests: any[] = [];
		await executeBrowserAction(prepare('qa-builder-reorder', { ...inputs, beforeId }), host(rows, requests));
		const body = requests.find((step) => step.method === 'POST').body;
		assert.deepEqual(body, {
			operation: 'move',
			rootId: app.rootId,
			id: 'moved',
			expectedUpdatedAt: 'displayed-revision',
			date: '2026-09-22',
			time: '10:30',
			order: expectedOrder
		});
	}
	const requests: any[] = [];
	await executeBrowserAction(prepare('qa-builder-reorder', { ...inputs, beforeId: 'moved' }), host(rows, requests));
	assert.equal(requests.length, 0);
	await assert.rejects(
		executeBrowserAction(prepare('qa-builder-reorder', { ...inputs, beforeId: 'missing' }), host(rows, requests)),
		/Refresh the planner/
	);
	assert.equal(requests.filter((step) => step.method === 'POST').length, 0);
});
