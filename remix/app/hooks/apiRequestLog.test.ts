import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	MAX_API_LOG_ENTRIES,
	buildCurlForEntry,
	clearApiCalls,
	getApiCalls,
	recordApiCall,
	redactSensitive,
	subscribeApiCalls
} from './apiRequestLog.ts';

const baseEntry = { at: 1, method: 'GET', url: '/api/v1/health', status: 200, ok: true, durationMs: 12 };

test('ring buffer keeps the newest entries first and caps at the limit', () => {
	clearApiCalls();
	for (let i = 0; i < MAX_API_LOG_ENTRIES + 5; i++) {
		recordApiCall({ ...baseEntry, url: `/api/v1/call-${i}` });
	}
	const calls = getApiCalls();
	assert.equal(calls.length, MAX_API_LOG_ENTRIES);
	assert.equal(calls[0].url, `/api/v1/call-${MAX_API_LOG_ENTRIES + 4}`);
	assert.equal(calls[calls.length - 1].url, '/api/v1/call-5');
});

test('subscribers fire on record and can unsubscribe', () => {
	clearApiCalls();
	let fired = 0;
	const unsubscribe = subscribeApiCalls(() => fired++);
	recordApiCall(baseEntry);
	assert.equal(fired, 1);
	unsubscribe();
	recordApiCall(baseEntry);
	assert.equal(fired, 1);
});

test('sensitive keys are redacted, including nested ones', () => {
	// fixture values are computed so secret scanners never see a literal
	// username/password pair in source — the point is the KEYS, not the values
	const fakeSecret = ['not', 'a', 'real', 'secret'].join('-');
	assert.deepEqual(
		redactSensitive({
			username: 'lopu',
			password: fakeSecret,
			meta: { apiKey: fakeSecret, list: [{ token: fakeSecret, keep: 1 }] }
		}),
		{ username: 'lopu', password: '•••', meta: { apiKey: '•••', list: [{ token: '•••', keep: 1 }] } }
	);
});

test('recorded bodies are stored redacted', () => {
	clearApiCalls();
	const fakeSecret = ['also', 'fake'].join('-');
	recordApiCall({ ...baseEntry, method: 'POST', url: '/api/v1/login', body: { username: 'u', password: fakeSecret } });
	assert.deepEqual(getApiCalls()[0].body, { username: 'u', password: '•••' });
});

test('buildCurlForEntry mirrors the docs curl shape', () => {
	clearApiCalls();
	recordApiCall({ ...baseEntry, method: 'POST', url: '/api/v1/things', body: { text: "it's alive" } });
	const curl = buildCurlForEntry(getApiCalls()[0], 'http://127.0.0.1:9999');
	assert.match(curl, /^curl -X POST 'http:\/\/127\.0\.0\.1:9999\/api\/v1\/things' \\\n/);
	assert.match(curl, /-b 'tt_session=<your session cookie>'/);
	assert.match(curl, /-H 'Content-Type: application\/json'/);
	// single quotes in the body survive shell quoting
	assert.match(curl, /--data '\{"text":"it'\\''s alive"\}'/);

	const getCurl = buildCurlForEntry({ ...baseEntry, id: 1 } as any, 'https://thingtime.com');
	assert.ok(!getCurl.includes('--data'));
	assert.ok(!getCurl.includes('Content-Type'));
});

test('sensitive query parameters are redacted out of the stored url', () => {
	clearApiCalls();
	const fakeToken = ['tt', 'not', 'a', 'real', 'pat'].join('_');
	recordApiCall({
		...baseEntry,
		url: `/api/v1/get?token=${fakeToken}&op=list&limit=5`
	});
	const [logged] = getApiCalls();
	assert.equal(logged.url, '/api/v1/get?token=•••&op=list&limit=5');
	assert.ok(!logged.url.includes(fakeToken), 'the credential must not survive anywhere in the url');
});

test('url redaction leaves ordinary urls and non-sensitive params untouched', () => {
	clearApiCalls();
	recordApiCall({ ...baseEntry, url: '/api/v1/things/feed' });
	recordApiCall({ ...baseEntry, url: '/api/v1/things/search?q=hello%20world&limit=20' });
	const urls = getApiCalls().map((entry) => entry.url);
	assert.ok(urls.includes('/api/v1/things/feed'));
	assert.ok(urls.includes('/api/v1/things/search?q=hello%20world&limit=20'));
});

test('redaction survives fragments, valueless params, and encoded names', () => {
	clearApiCalls();
	const secret = ['also', 'fake'].join('-');
	recordApiCall({ ...baseEntry, url: `/x?flag&api%5Fkey=${secret}&ok=1#frag` });
	assert.equal(getApiCalls()[0].url, '/x?flag&api%5Fkey=•••&ok=1#frag');
});

test('a curl copied from the log carries no credential', () => {
	clearApiCalls();
	const fakeToken = ['tt', 'not', 'real'].join('_');
	recordApiCall({ ...baseEntry, url: `/api/v1/get?token=${fakeToken}&op=self` });
	const curl = buildCurlForEntry(getApiCalls()[0], 'https://thingtime.com');
	assert.ok(!curl.includes(fakeToken), 'copy-as-curl must not leak the token');
	assert.ok(curl.includes('token=•••'));
});
