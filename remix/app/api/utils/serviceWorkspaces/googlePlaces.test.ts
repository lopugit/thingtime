import assert from 'node:assert/strict';
import test from 'node:test';
import { GooglePlacesError, requestGooglePlaces } from './googlePlaces';

test('Places preserves suggestions and sends credentials only in the fixed provider header', async (t) => {
	const result = { suggestions: [{ placePrediction: { placeId: 'place', text: { text: 'Public library' } } }] };
	t.mock.method(globalThis, 'fetch', async (url, init) => {
		assert.equal(url, 'https://places.googleapis.com/v1/places:autocomplete');
		assert.equal(init.headers['X-Goog-Api-Key'], 'synthetic-key');
		assert.equal(init.redirect, 'error');
		return Response.json(result);
	});
	assert.deepEqual(await requestGooglePlaces('synthetic-key', 'places:autocomplete', 'suggestions', { input: 'library' }), result);
});
test('Places returns actionable configuration guidance without reflecting provider secrets', async (t) => {
	for (const [reason, expected] of [
		['SERVICE_DISABLED', /Enable Places API \(New\)/],
		['API_KEY_HTTP_REFERRER_BLOCKED', /website restrictions/],
		['API_KEY_SERVICE_BLOCKED', /API restrictions/],
		['API_KEY_IP_ADDRESS_BLOCKED', /IP restrictions/],
		['BILLING_DISABLED', /Enable billing/],
		['API_KEY_INVALID', /valid Google Places server key/],
		['unknown-sensitive-reason', /Google Places rejected/]
	] as const) {
		t.mock.method(globalThis, 'fetch', async () =>
			Response.json(
				{ error: { message: 'SECRET_KEY_AND_PROJECT', details: [{ reason, metadata: { key: 'SECRET_KEY_AND_PROJECT' } }] } },
				{ status: 403 }
			)
		);
		await assert.rejects(requestGooglePlaces('synthetic-key', 'places:autocomplete', 'suggestions'), (error) => {
			assert.ok(error instanceof GooglePlacesError);
			assert.equal(error.status, 409);
			assert.match(error.message, expected);
			assert.doesNotMatch(error.message, /SECRET_KEY_AND_PROJECT|unknown-sensitive-reason/);
			return true;
		});
		t.mock.restoreAll();
	}
});
test('Places handles quota, gateway HTML, oversized bodies and transport failures safely', async (t) => {
	for (const [response, status, message] of [
		[() => Response.json({ error: {} }, { status: 429 }), 429, /quota/],
		[() => new Response('<html>private gateway details</html>', { status: 502 }), 502, /temporarily unavailable/],
		[() => new Response('x'.repeat(129 * 1024)), 502, /could not be reached/],
		[
			() => {
				throw new Error('private request details');
			},
			502,
			/could not be reached/
		]
	] as const) {
		t.mock.method(globalThis, 'fetch', async () => response());
		await assert.rejects(requestGooglePlaces('synthetic-key', 'places/place', 'id'), (error) => {
			assert.ok(error instanceof GooglePlacesError);
			assert.equal(error.status, status);
			assert.match(error.message, message);
			assert.doesNotMatch(error.message, /private/);
			return true;
		});
		t.mock.restoreAll();
	}
});
