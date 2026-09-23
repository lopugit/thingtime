import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceAppComposition } from './workspaceAppComposition';
import { validateThingtimeCrystal } from './registry';
import { executeBrowserAction, type BrowserActionHost } from '../components/Actions/browserActionRuntime';
import type { PreparedBrowserAction } from './browserActions';
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
