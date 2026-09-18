import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedOperationAllowed } from './sharedCompositionCore';
import { runLookup } from './lookup';
import { validateThingtimeCrystal, sanitizeActionCrystal, deriveActionEffects } from '../../../schemas/registry';
import { builderGuideSections, builderFormExample, builderLookupExample, builderSaveExample } from '../../../docs/builderGuide';
import { deriveRequiredCapabilities, actionCannotAccess } from '../../../components/Actions/actionInspect';

const request = { provider: 'google-geocoding', query: '10 Example Street & key=evil', credential: 'test-secret', deadline: Date.now() + 60000 };
const transport = (data: unknown) =>
	(async (input, init) => {
		const url = new URL(String(input));
		assert.equal(url.origin, 'https://maps.googleapis.com');
		assert.equal(url.pathname, '/maps/api/geocode/json');
		assert.equal(url.searchParams.get('address'), request.query);
		assert.equal(url.searchParams.get('key'), 'test-secret');
		assert.equal(init?.redirect, 'error');
		return Response.json(data);
	}) as typeof fetch;

test('lookup uses a fixed endpoint, encodes entered text and returns a bounded public projection', async () => {
	const result = await runLookup(
		request,
		transport({
			status: 'OK',
			results: Array.from({ length: 10 }, () => ({
				formatted_address: 'Example',
				place_id: 'place',
				secret: 'omit',
				geometry: { location: { lat: -37, lng: 145 } }
			}))
		})
	);
	assert.equal(result.items.length, 5);
	assert.deepEqual(result.items[0], { address: 'Example', placeId: 'place', latitude: -37, longitude: 145 });
	assert.equal(result.attribution, 'Google Maps');
	assert.ok(!JSON.stringify(result).includes('test-secret'));
});
test('zero matches succeed and provider failures never echo credentials', async () => {
	assert.equal((await runLookup(request, transport({ status: 'ZERO_RESULTS', results: [] }))).empty, true);
	for (const fetcher of [
		transport({ status: 'REQUEST_DENIED', error_message: 'test-secret' }),
		(async () => {
			throw new Error('https://example/?key=test-secret');
		}) as typeof fetch
	]) {
		await assert.rejects(
			runLookup(request, fetcher),
			(error: Error) => error.message.includes('lookup failed') && !error.message.includes('test-secret')
		);
	}
});
test('lookup refuses unknown providers, oversized input, expired budget and oversized response', async () => {
	const never = (async () => {
		assert.fail('transport must not run');
	}) as typeof fetch;
	await assert.rejects(runLookup({ ...request, provider: '__proto__' }, never));
	await assert.rejects(runLookup({ ...request, query: 'x'.repeat(501) }, never));
	await assert.rejects(runLookup({ ...request, deadline: 0 }, never));
	await assert.rejects(runLookup(request, (async () => new Response('x'.repeat(128 * 1024 + 1))) as typeof fetch), /lookup failed/);
});
test('docs action examples validate, lookup needs explicit provider scope and literal Vault identity', () => {
	for (const example of [builderLookupExample, builderSaveExample]) assert.equal(sanitizeActionCrystal(example).ok, true);
	assert.equal(sanitizeActionCrystal({ ...builderLookupExample, capabilities: [] }).ok, false);
	assert.equal(
		sanitizeActionCrystal({ ...builderLookupExample, capabilities: [{ capability: 'lookup', providers: ['https://private'] }] }).ok,
		false
	);
	assert.equal(
		sanitizeActionCrystal({ ...builderLookupExample, steps: [{ ...builderLookupExample.steps[0], credentialId: '$input.key' }] }).ok,
		false
	);
	assert.deepEqual(deriveActionEffects(builderLookupExample.steps).lookups, ['google-geocoding']);
	assert.deepEqual(deriveRequiredCapabilities(builderLookupExample.steps), builderLookupExample.capabilities);
	assert.equal(actionCannotAccess(builderLookupExample.capabilities).includes('No network'), false);
});

test('shared execution never admits external lookups', () => assert.equal(sharedOperationAllowed('lookup'), false));

test('published schema and component examples pass the real saved-Thing grammar', () => {
 for (const [kind, example] of [['schema', builderGuideSections[0].example], ['component', builderFormExample]] as const) {
  const result = validateThingtimeCrystal([kind], example);
  assert.equal(result.ok, true, JSON.stringify(result));
 }
});
