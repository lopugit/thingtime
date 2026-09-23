import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceAppComposition } from './workspaceAppComposition';
import { validateThingtimeCrystal } from './registry';
import { executeBrowserAction, type BrowserActionHost } from '../components/Actions/browserActionRuntime';
import type { PreparedBrowserAction } from './browserActions';
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
	assert.equal(result.mapPoints[0].href, '/p/existing-page?view=detail&id=address-12');
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
						{ id: 'b', crystal: { text: '[Before] Lawn' } },
						{ id: 'a', crystal: { text: '[After] Lawn' } },
						{ id: 'g', crystal: { text: 'Existing file' } }
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
		result: { view: 'setup', owner: true, mapsEnvironmentId: null, mapsEnvironments: [] }
	});
	const encoded = JSON.stringify(rendered);
	assert.ok(encoded.includes('Ungrouped'));
	assert.ok(!encoded.includes('Disabled'));
	assert.ok(encoded.includes('"name":"environmentId","value":""'));
});
