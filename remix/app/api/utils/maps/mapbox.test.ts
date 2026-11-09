import assert from 'node:assert/strict';
import test from 'node:test';
import { mapboxBrowserConfig, mapboxGeocode, mapboxOptimize, MapsError } from './mapbox';

const reveal = async (owner: string, id: string) => {
	assert.equal(owner, 'owner-1');
	assert.equal(id, 'vault-1');
	return 'sk.synthetic-token';
};
const stops = [
	{ id: 'start', coordinates: [144.96, -37.81] },
	{ id: 'stop', coordinates: [144.97, -37.82] },
	{ id: 'middle', coordinates: [144.975, -37.825] },
	{ id: 'end', coordinates: [144.98, -37.83] }
];

test('geocoding keeps autocomplete transient and validates permanent selected ID', async () => {
	const transport = (async (url: URL, init: RequestInit) => {
		assert.equal(url.origin, 'https://api.mapbox.com');
		assert.equal(url.pathname, '/search/geocode/v6/forward');
		assert.equal(url.searchParams.get('access_token'), 'sk.synthetic-token');
		assert.equal(init.redirect, 'error');
		return Response.json({ features: [{ properties: { mapbox_id: 'place-1', name: 'Place', full_address: '1 Example Street' }, geometry: { coordinates: [144.96, -37.81] } }] });
	}) as typeof fetch;
	const preview = await mapboxGeocode('owner-1', { vaultId: 'vault-1', query: 'Example' }, transport, reveal);
	assert.equal(preview.cachePolicy, 'transient');
	assert.deepEqual(preview.suggestions[0].coordinates, [144.96, -37.81]);
	const saved = await mapboxGeocode('owner-1', { vaultId: 'vault-1', query: 'Example', permanent: true, expectedId: 'place-1' }, transport, reveal);
	assert.equal(saved.cachePolicy, 'permanent-geocoding-only');
	await assert.rejects(mapboxGeocode('owner-1', { vaultId: 'vault-1', query: 'Example', permanent: true, expectedId: 'other' }, transport, reveal), (error: any) => error instanceof MapsError && error.status === 409);
});

test('optimization returns transient ordered GeoJSON and never reflects provider errors', async () => {
	const transport = (async (url: URL, init: RequestInit) => {
		assert.equal(url.origin, 'https://api.mapbox.com');
		assert.match(url.pathname, /^\/optimized-trips\/v1\/mapbox\/driving\//);
		assert.equal(url.searchParams.get('roundtrip'), 'false');
		assert.equal(url.searchParams.get('source'), 'first');
		assert.equal(url.searchParams.get('destination'), 'last');
		assert.equal(init.redirect, 'error');
		return Response.json({ code: 'Ok', trips: [{ geometry: { type: 'LineString', coordinates: [[144.96, -37.81], [144.975, -37.825], [144.97, -37.82], [144.98, -37.83]] }, distance: 1800, duration: 320 }], waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }, { waypoint_index: 3 }] });
	}) as typeof fetch;
	const result = await mapboxOptimize('owner-1', { vaultId: 'vault-1', stops, roundtrip: false }, transport, reveal);
	assert.deepEqual(result.orderedStopIds, ['start', 'middle', 'stop', 'end']);
	assert.equal(result.cachePolicy, 'transient');
	assert.equal(result.distanceMeters, 1800);
	await assert.rejects(mapboxOptimize('owner-1', { vaultId: 'vault-1', stops }, (async () => new Response('SECRET provider message', { status: 403 })) as typeof fetch, reveal), (error: any) => {
		assert.equal(error.status, 409);
		assert.doesNotMatch(error.message, /SECRET|synthetic-token/);
		return true;
	});
});

test('malformed optimization geometry, estimates and fixed endpoints fail closed', async () => {
	const valid = { code: 'Ok', trips: [{ geometry: { type: 'LineString', coordinates: [[144.96, -37.81], [144.98, -37.83]] }, distance: 100, duration: 60 }], waypoints: stops.map((_, index) => ({ waypoint_index: index })) };
	for (const mutate of [
		(data: any) => { data.trips[0].geometry.type = 'Polygon'; },
		(data: any) => { data.trips[0].geometry.coordinates = []; },
		(data: any) => { data.trips[0].duration = -1; },
		(data: any) => { data.trips[0].distance = -1; },
		(data: any) => { data.waypoints = [1, 0, 2, 3].map(waypoint_index => ({ waypoint_index })); },
		(data: any) => { data.waypoints = [0, 1, 3, 2].map(waypoint_index => ({ waypoint_index })); }
	]) {
		const data = structuredClone(valid);
		mutate(data);
		await assert.rejects(mapboxOptimize('owner-1', { vaultId: 'vault-1', stops, roundtrip: false }, (async () => Response.json(data)) as typeof fetch, reveal), (error: any) => error instanceof MapsError && error.status === 502);
	}
});

test('invalid stops fail before credential reveal, and browser config reveals only public tokens', async () => {
	let revealed = false;
	await assert.rejects(mapboxOptimize('owner-1', { vaultId: 'vault-1', stops: [{ id: 'one', coordinates: [0, 0] }] }, fetch, async () => { revealed = true; return 'pk.example'; }), (error: any) => error.status === 400);
	assert.equal(revealed, false);
	await assert.rejects(mapboxBrowserConfig('owner-1', { vaultId: 'vault-1' }, reveal), (error: any) => error.status === 409);
	assert.deepEqual(await mapboxBrowserConfig('owner-1', { vaultId: 'vault-1' }, async () => 'pk.synthetic-token'), { ok: true, publicToken: 'pk.synthetic-token' });
});

test('complete-address lookups preserve street and allowlisted match quality without provider extras', async () => {
	const result = await mapboxGeocode('owner-1', { vaultId: 'vault-1', query: '12 Example Road', autocomplete: false }, (async (url: URL) => {
		assert.equal(url.searchParams.get('autocomplete'), 'false');
		assert.equal(url.searchParams.get('permanent'), 'false');
		return Response.json({ features: [{ geometry: { coordinates: [144.96, -37.81] }, properties: {
			mapbox_id: 'address-1', name: '12 Example Road', place_formatted: 'Example Town', feature_type: 'address',
			coordinates: { accuracy: 'rooftop', private: 'DO_NOT_PROJECT' },
			match_code: { confidence: 'exact', address_number: 'matched', street: 'matched', country: 'inferred', postcode: 'unknown-value', secret: 'DO_NOT_PROJECT' },
			private: 'DO_NOT_PROJECT'
		} }] });
	}) as typeof fetch, reveal);
	assert.deepEqual(result.suggestions![0], {
		id: 'address-1', label: '12 Example Road', address: '12 Example Road, Example Town', coordinates: [144.96, -37.81],
		featureType: 'address', accuracy: 'rooftop', matchCode: { confidence: 'exact', address_number: 'matched', street: 'matched', country: 'inferred' }
	});
	assert.equal(result.cachePolicy, 'transient');
	assert.doesNotMatch(JSON.stringify(result), /DO_NOT_PROJECT|unknown-value/);
});

test('batch geocoding deduplicates provider queries, chunks processing, and retains caller identity/order', async () => {
	const queries = Array.from({ length: 53 }, (_, n) => ({ id: `row-${n}`, query: `${n} Example Street` }));
	queries.push({ id: 'same-address', query: queries[0].query });
	const sizes: number[] = [];
	const result = await mapboxGeocode('owner-1', { vaultId: 'vault-1', autocomplete: false, queries }, (async (url: URL, init: RequestInit) => {
		assert.equal(url.origin, 'https://api.mapbox.com');
		assert.equal(url.pathname, '/search/geocode/v6/batch');
		assert.equal(url.searchParams.get('permanent'), 'false');
		assert.equal(init.method, 'POST');
		assert.equal(init.redirect, 'error');
		assert.equal(init.cache, 'no-store');
		const body = JSON.parse(String(init.body));
		sizes.push(body.length);
		assert.ok(body.every((q: any) => q.autocomplete === false && q.limit === 8 && !q.id && !q.expectedId));
		return Response.json({ batch: body.map((q: any) => ({ features: [{ properties: { mapbox_id: q.q, full_address: q.q }, geometry: { coordinates: [144.96, -37.81] } }] })) });
	}) as typeof fetch, reveal);
	assert.deepEqual(sizes, [50, 3]);
	assert.deepEqual(result.results!.map(row => row.id), queries.map(row => row.id));
	assert.equal(result.results![53].suggestions[0].id, queries[0].query);
	assert.equal(result.cachePolicy, 'transient');
});

test('batch input and permanent selection checks cannot bypass validation or reveal provider details', async () => {
	for (const invalid of [
		{ autocomplete: 'false', query: 'Example' },
		{ query: 'Example', queries: [] },
		{ queries: [{ id: 'same', query: 'First' }, { id: 'same', query: 'Second' }] },
		{ queries: [{ id: 'row', query: '  ' }] },
		{ permanent: true, queries: [{ id: 'row', query: 'Example' }] }
	]) {
		let revealed = false;
		await assert.rejects(mapboxGeocode('owner-1', { vaultId: 'vault-1', ...invalid }, fetch, async () => { revealed = true; return 'sk.synthetic-token'; }), (error: any) => error.status === 400);
		assert.equal(revealed, false);
	}
	const input = { vaultId: 'vault-1', permanent: true, queries: [{ id: 'row', query: 'Example', expectedId: 'chosen' }] };
	const transport = (async (url: URL, init: RequestInit) => {
		assert.equal(url.searchParams.get('permanent'), 'true');
		assert.equal(JSON.parse(String(init.body))[0].autocomplete, false);
		return Response.json({ batch: [{ features: [{ properties: { mapbox_id: 'other', full_address: 'Example' }, geometry: { coordinates: [0, 0] } }] }] });
	}) as typeof fetch;
	await assert.rejects(mapboxGeocode('owner-1', input, transport, reveal), (error: any) => error.status === 409);
	await assert.rejects(mapboxGeocode('owner-1', input, (async () => Response.json({ batch: [] })) as typeof fetch, reveal), (error: any) => error.status === 502);
});

test('cancelled address batches never publish a partial success or start a further chunk', async () => {
	const controller = new AbortController();
	let calls = 0;
	await assert.rejects(mapboxGeocode('owner-1', { vaultId: 'vault-1', queries: Array.from({ length: 51 }, (_, n) => ({ id: String(n), query: `Example ${n}` })) }, (async (_url: URL, init: RequestInit) => {
		calls++;
		const body = JSON.parse(String(init.body));
		controller.abort();
		return Response.json({ batch: body.map(() => ({ features: [] })) });
	}) as typeof fetch, reveal, controller.signal), (error: any) => error.status === 499);
	assert.equal(calls, 1);
});


test('cancellation during the last batch or single result cannot publish success', async () => {
 for (const input of [{ query: 'Example' }, { queries: [{ id: 'one', query: 'Example' }] }]) {
  const controller = new AbortController();
  await assert.rejects(mapboxGeocode('owner-1', { vaultId: 'vault-1', ...input }, (async () => {
   controller.abort();
   return Response.json({ features: [], batch: [{ features: [] }] });
  }) as typeof fetch, reveal, controller.signal), (error: any) => error.status === 499);
 }
});
