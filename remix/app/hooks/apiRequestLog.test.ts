import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	MAX_API_LOG_ENTRIES,
	buildCurlForEntry,
	clearApiCalls,
	describeApiStatus,
	getApiCalls,
	recordApiCall,
	redactSensitive,
	redactUriCredentials,
	subscribeApiCalls
} from './apiRequestLog.ts';

const baseEntry = { at: 1, method: 'GET', url: '/api/v1/health', status: 200, ok: true, durationMs: 12 };

// A fixture for the position a credential occupies in a URI (`user:HERE@host`).
// Deliberately not credential-shaped: every assertion below only checks that
// whatever sits in that position is gone afterwards, so a self-describing
// sentinel proves exactly as much as a realistic-looking credential would —
// without this file tripping secret scanners on every push, which it has twice.
const uriSentinel = (label: string) => `redact-me-${label}`;

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
	// the cookie NAME must be the one authCookie.ts issues, or a caller who
	// pastes their real value still sends an anonymous request
	assert.match(curl, /-b 'tt_auth=<your session cookie>'/);
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

test('a cancelled request reads as cancelled, not as a network failure', () => {
	clearApiCalls();
	// what an unmounting poller produces: status 0, but deliberately aborted
	recordApiCall({ ...baseEntry, url: '/api/v1/admin/ci', status: 0, ok: false, aborted: true });
	const [logged] = getApiCalls();
	assert.equal(logged.aborted, true);
	assert.deepEqual(describeApiStatus(logged), { label: 'cancelled', tone: 'muted' });
});

test('describeApiStatus separates cancellation from the statuses that are real', () => {
	assert.deepEqual(describeApiStatus({ status: 0 }), { label: '✕', tone: 'danger' });
	assert.deepEqual(describeApiStatus({ status: 500 }), { label: '500', tone: 'danger' });
	assert.deepEqual(describeApiStatus({ status: 404 }), { label: '404', tone: 'warn' });
	assert.deepEqual(describeApiStatus({ status: 200 }), { label: '200', tone: 'ok' });
	// an abort wins over the status it carries — it is not a 0-status failure
	assert.deepEqual(describeApiStatus({ status: 0, aborted: true }), { label: 'cancelled', tone: 'muted' });
});

test('a curl copied from the log carries no credential', () => {
	clearApiCalls();
	const fakeToken = ['tt', 'not', 'real'].join('_');
	recordApiCall({ ...baseEntry, url: `/api/v1/get?token=${fakeToken}&op=self` });
	const curl = buildCurlForEntry(getApiCalls()[0], 'https://thingtime.com');
	assert.ok(!curl.includes(fakeToken), 'copy-as-curl must not leak the token');
	assert.ok(curl.includes('token=•••'));
});

test('a connection string stored under a plain key keeps its credential out of the log', () => {
	clearApiCalls();
	// exactly what MongoEndpointConfig posts via useApi mongodb.endpoints.add:
	// the credential rides in the VALUE, under the unremarkable key `url`
	const userinfoFixture = uriSentinel('mongo-userinfo');
	// assembled piecewise, per this file's convention, so no scanner ever sees a
	// literal `scheme://user:pass@host` connection string in source
	const connectionString = ['mongodb+srv://svcuser', ':', userinfoFixture, '@', 'cluster0.abc.mongodb.net/thingtime'].join('');
	recordApiCall({
		...baseEntry,
		method: 'POST',
		url: '/api/v1/mongodb/endpoints',
		body: { name: 'prod', url: connectionString }
	});
	const [logged] = getApiCalls();
	assert.deepEqual(logged.body, { name: 'prod', url: 'mongodb+srv://•••@cluster0.abc.mongodb.net/thingtime' });
	const curl = buildCurlForEntry(logged, 'https://thingtime.com');
	assert.ok(!curl.includes(userinfoFixture), 'copy-as-curl must not leak a connection-string password');
	assert.ok(!curl.includes('svcuser'), 'the userinfo username goes with it');
	// the row must still say which endpoint was configured — exact-shape, per the
	// convention the `@`-tail test below states: asserting the whole redacted URI
	// pins that the credential was replaced *and* that scheme/host/db survived,
	// where a bare host substring would also pass if the match had over- or
	// under-consumed around it.
	assert.ok(curl.includes('mongodb+srv://•••@cluster0.abc.mongodb.net/thingtime'));
});

test('userinfo redaction leaves ordinary urls — including @handle paths — intact', () => {
	// this app puts @handles in paths; over-redacting would gut the panel
	assert.equal(redactUriCredentials('https://thingtime.com/@lopu'), 'https://thingtime.com/@lopu');
	assert.equal(redactUriCredentials('https://example.com/a?to=x@y.com'), 'https://example.com/a?to=x@y.com');
	assert.equal(redactUriCredentials('/api/v1/things/feed'), '/api/v1/things/feed');
	assert.equal(redactUriCredentials('not a url at all'), 'not a url at all');
	// but a bare userinfo, in any scheme, still goes — assembled piecewise, per
	// this file's convention, so no scanner ever sees a literal userinfo pair in
	// source (a literal here regressed that convention once already)
	const bareUserinfo = ['https://', uriSentinel('bare'), '@', 'example.com/x'].join('');
	assert.equal(redactUriCredentials(bareUserinfo), 'https://•••@example.com/x');
	const otherScheme = ['postgres://', uriSentinel('other-scheme-user'), ':', uriSentinel('other-scheme'), '@', 'db.internal:5432/app'].join('');
	assert.equal(redactUriCredentials(otherScheme), 'postgres://•••@db.internal:5432/app');
});

test('an absolute request url with userinfo is scrubbed before it is stored', () => {
	clearApiCalls();
	const userinfoFixture = uriSentinel('absolute-url');
	const absolute = ['https://admin', ':', userinfoFixture, '@', 'internal.thingtime.com/api/v1/health?ok=1'].join('');
	recordApiCall({ ...baseEntry, url: absolute });
	const [logged] = getApiCalls();
	assert.equal(logged.url, 'https://•••@internal.thingtime.com/api/v1/health?ok=1');
	assert.ok(!logged.url.includes(userinfoFixture));
});

test('an unencoded @ inside the credential does not leave its tail in the log', () => {
	// Atlas issues passwords containing `@`, and percent-encoding it before
	// pasting the URI is the step people skip. Userinfo runs to the LAST `@` of
	// the authority (RFC 3986); matching to the first one stopped at the `@`
	// *inside* the credential, so everything after it stayed in the row —
	// `mongodb+srv://•••@tail-that-must-not-survive@cluster0...` — and copied
	// straight out as curl.
	const tail = 'tail-that-must-not-survive';
	const credential = ['head', '@', tail].join('');
	// assembled piecewise, per this file's convention, so no scanner ever sees a
	// literal `scheme://user:pass@host` connection string in source
	const connectionString = ['mongodb+srv://svcuser', ':', credential, '@', 'cluster0.abc.mongodb.net/thingtime'].join('');
	assert.equal(
		redactUriCredentials(connectionString),
		'mongodb+srv://•••@cluster0.abc.mongodb.net/thingtime'
	);

	clearApiCalls();
	recordApiCall({
		...baseEntry,
		method: 'POST',
		url: '/api/v1/mongodb/endpoints',
		body: { name: 'prod', url: connectionString }
	});
	const [logged] = getApiCalls();
	// exact-shape, not a host substring check: greediness is the risk this
	// change introduces, so assert precisely how much the match consumed
	assert.deepEqual(logged.body, { name: 'prod', url: 'mongodb+srv://•••@cluster0.abc.mongodb.net/thingtime' });
	const curl = buildCurlForEntry(logged, 'https://thingtime.com');
	assert.ok(!curl.includes(tail), 'no part of the credential may survive into a copied curl');
});
