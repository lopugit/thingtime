import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { MAP_SDK_EXAMPLES, MAPBOX_SCRIPT } from './mapSdks';
import { PLATFORM_API_EXAMPLES } from './platformApis';
import { sdkSandbox, validateSdkInput } from './sdkSandbox';
import { buildExampleRequest, LIBRARY_REQUEST_REQUIREMENT } from './request';
import { runLibraryRequest } from '../api/utils/library/request';
import { capabilitySatisfies, thingtimeCapabilityManifest } from '../api/utils/capabilities/thingtimeCapabilities';

test('every new platform has executable, bounded catalogue examples', () => {
	assert.equal(MAP_SDK_EXAMPLES.length, 14);
	assert.equal(PLATFORM_API_EXAMPLES.length, 26);
	for (const provider of ['Mapbox', 'Google Maps', 'Google Places', 'YouTube', 'Spotify', 'Microsoft Graph', 'GitLab', 'Cloudflare', 'Contentful'])
		assert.ok(
			[...MAP_SDK_EXAMPLES, ...PLATFORM_API_EXAMPLES].some((e) => e.provider === provider),
			provider
		);
	for (const e of PLATFORM_API_EXAMPLES) {
		const { url, method } = buildExampleRequest(e, e.input, 'test-fixture');
		assert.equal(url.protocol, 'https:');
		assert.equal(method, e.request!.method || 'GET');
		assert.ok(e.setup && e.credentialLabel && e.request!.accountUrl, e.id);
	}
});
test('Places searches use fixed read-only POST bodies and exact field masks', async () => {
	for (const id of ['google-places-text-search-rest', 'google-places-nearby-cafes-rest']) {
		const e = PLATFORM_API_EXAMPLES.find((e) => e.id === id)!;
		const request = buildExampleRequest(e, { ...e.input, method: 'DELETE', url: 'https://evil.test', apiKey: 'evil' }, 'test-fixture');
		assert.equal(request.url.origin, 'https://places.googleapis.com');
		assert.equal(request.method, 'POST');
		assert.ok(!request.body!.includes('evil'));
		assert.equal(request.headers['X-Goog-Api-Key'], 'test-fixture');
		assert.ok(!request.headers['X-Goog-FieldMask'].includes('*'));
		await runLibraryRequest(e, e.input, 'test-fixture', (async (url, init) => {
			assert.equal(String(url), request.url.toString());
			assert.equal(init!.body, request.body);
			assert.equal(init!.method, 'POST');
			assert.equal(init!.redirect, 'error');
			return new Response('{"places":[],"echo":"test-fixture"}');
		}) as typeof fetch).then((result) => assert.deepEqual(result, { places: [], echo: '[redacted]' }));
	}
	const e = PLATFORM_API_EXAMPLES.find((e) => e.id === 'google-places-nearby-cafes-rest')!;
	const body = JSON.parse(buildExampleRequest(e, e.input, 'fixture').body!);
	assert.equal(typeof body.locationRestriction.circle.center.latitude, 'number');
	assert.equal(typeof body.locationRestriction.circle.radius, 'number');
	assert.deepEqual(LIBRARY_REQUEST_REQUIREMENT, ['api.library-request', '1.2.0']);
	const version = thingtimeCapabilityManifest('https://example.test').features['api.library-request'].version;
	assert.ok(capabilitySatisfies(version, '1.2.0'));
	assert.equal(capabilitySatisfies('1.1.0', '1.2.0'), false);
});
test('browser keys, coordinate bounds and source escaping fail closed before SDK loading', () => {
	const mapbox = MAP_SDK_EXAMPLES.find((e) => e.provider === 'Mapbox')!;
	for (const key of ['sk.secret', '', 'pk.bad\nkey']) assert.throws(() => sdkSandbox(mapbox, mapbox.input, 'run', key));
	for (const input of [{ ...mapbox.input, latitude: 95 }, { ...mapbox.input, longitude: '144' }, {}])
		assert.throws(() => validateSdkInput(mapbox, input, 'pk.fixture'));
	const marker = MAP_SDK_EXAMPLES.find((e) => e.id === 'google-maps-marker-information-window')!;
	const html = sdkSandbox(marker, { ...marker.input, label: '</script><script>evil()</script>' }, 'run', 'AIzaFixture');
	assert.equal(html.match(/<script>/g)?.length, 1);
	assert.ok(!html.includes('</script><script>'));
	assert.ok(!html.includes('allow-same-origin'));
	assert.ok(html.includes('textContent'));
	assert.ok(!html.includes('https://api.mapbox.com'));
	const mapboxHtml = sdkSandbox(mapbox, mapbox.input, 'run', 'pk.fixture');
	assert.ok(mapboxHtml.includes(MAPBOX_SCRIPT));
	assert.ok(!mapboxHtml.includes('maps.googleapis.com'));
});
test('all SDK recipes execute against provider contracts and return real operation results', async () => {
	for (const example of MAP_SDK_EXAMPLES) {
		const operations: string[] = [];
		const node = () => ({ style: { cssText: '' }, append(..._args: unknown[]) {}, textContent: '', href: '' });
		class Map {
			constructor(options: unknown) {
				operations.push('map');
				assert.ok(options);
			}
			addControl() {}
			once(event: string, callback: () => void) {
				if (event === 'load') queueMicrotask(callback);
			}
			getCenter() {
				return { toArray: () => [144, -37], toJSON: () => ({ lat: -37, lng: 144 }) };
			}
			getZoom() {
				return 12;
			}
			fitBounds() {}
			addSource() {
				operations.push('source');
			}
			addLayer() {
				operations.push('layer');
			}
		}
		class Marker {
			constructor(_opts?: unknown) {
				operations.push('marker');
			}
			setLngLat() {
				return this;
			}
			setPopup() {
				return this;
			}
			addTo() {
				return this;
			}
			togglePopup() {
				return this;
			}
			addListener() {}
		}
		class Popup {
			setText() {
				return this;
			}
		}
		class Bounds {
			extend() {
				return this;
			}
		}
		const place = {
			id: 'place-1',
			displayName: 'Cafe',
			formattedAddress: 'Melbourne',
			location: { toJSON: () => ({ lat: -37, lng: 144 }) },
			attributions: [],
			async fetchFields() {
				operations.push('details');
			}
		};
		class Place {
			constructor() {
				return place;
			}
			static async searchByText() {
				operations.push('text-search');
				return { places: [place] };
			}
			static async searchNearby() {
				operations.push('nearby-search');
				return { places: [place] };
			}
		}
		const google = {
			maps: {
				importLibrary: async (name: string) => ({
					Map,
					AdvancedMarkerElement: Marker,
					Place,
					AutocompleteSessionToken: class {},
					AutocompleteSuggestion: {
						fetchAutocompleteSuggestions: async () => {
							operations.push('autocomplete');
							return { suggestions: [{ placePrediction: { toPlace: () => place } }] };
						}
					}
				}),
				event: {
					addListenerOnce(_map: unknown, event: string, cb: () => void) {
						assert.equal(event, 'idle');
						queueMicrotask(cb);
					}
				},
				InfoWindow: class {
					open() {
						operations.push('info');
					}
				},
				Polyline: class {
					constructor() {
						operations.push('polyline');
					}
				},
				Circle: class {
					constructor() {
						operations.push('circle');
					}
				}
			}
		};
		const result = await vm.runInNewContext(`(async()=>{${example.code}})()`, {
			google,
			mapboxgl: { Map, Marker, Popup, LngLatBounds: Bounds, NavigationControl: class {} },
			document: { createElement: node },
			root: node(),
			input: example.input,
			apiKey: 'fixture',
			queueMicrotask
		});
		assert.ok(result, example.id);
		assert.ok(operations.includes('map'), example.id);
		if (example.id.includes('autocomplete')) assert.ok(operations.includes('autocomplete') && operations.includes('details'));
		if (example.id.includes('geojson')) assert.ok(operations.includes('source') && operations.includes('layer'));
	}
});
test('SDK network policy is isolated from ordinary module demos and Vercel validates it', () => {
	const csp = readFileSync(new URL('../../scripts/csp.mjs', import.meta.url), 'utf8');
	const ordinary = csp.split('export const librarySandboxCsp =')[1].split('export const librarySdkCsp =')[0];
	assert.ok(!ordinary.includes('maps.googleapis.com'));
	assert.ok(!ordinary.includes('api.mapbox.com'));
	const entry = readFileSync(new URL('./sandboxEntry.ts', import.meta.url), 'utf8');
	assert.ok(entry.includes('example.request?.auth'));
	assert.ok(entry.includes('event.source !== parent'));
	const verify = readFileSync(new URL('../../scripts/verify-vercel-output.mjs', import.meta.url), 'utf8');
	assert.ok(verify.includes('library/sdk.html'));
	assert.ok(verify.includes('librarySdkCsp'));
});
