import assert from 'node:assert/strict';
import test from 'node:test';

// The client half of marketing publishing (marketingPublicationsStore.tsx).
// Its pure neighbours are covered elsewhere — publishing.test.ts pins the key
// grammar and the visibility resolver, marketingPublications.test.ts the
// server projection, and both route tests the gates — but the browser store
// carries logic none of those reach: which of the two endpoints' payloads is
// allowed into localStorage, request deduplication, the freshness window, and
// what an admin write leaves behind when the server refuses it.
//
// The audit trail is the reason this file exists. `audit` (who switched each
// key, and when) is admin-only, and the store is the THIRD place it could
// escape: the server projection withholds it from non-admins, the public
// route never asks for it — and then an admin's own response passes through
// `cachePublications`, which writes to a `tt-*` localStorage key that every
// later visitor on that browser reads back, signed in or not. The projection
// and the routes are both tested; that last hop was not.
//
// `window` has to exist before the module is evaluated (localCache is a no-op
// without it, which would make the cache assertions vacuously pass), so the
// import is dynamic and happens inside the tests — a static one would be
// hoisted above the stub, and these tests run as CJS, so it cannot be awaited
// at the top level either.

const CACHE_KEY = 'tt-marketing-publications';
const PUBLIC_ENDPOINT = '/api/v1/marketing/publications';
const ADMIN_ENDPOINT = '/api/v1/admin/marketing/publications';

const storage = new Map<string, string>();
(globalThis as any).window = {
	localStorage: {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => void storage.set(key, String(value)),
		removeItem: (key: string) => void storage.delete(key)
	},
	addEventListener: () => {},
	removeEventListener: () => {}
};

// @ts-ignore Node executes this TypeScript test directly and requires the extension.
const loadStore = () => import('./marketingPublicationsStore.tsx');

const WITH_AUDIT = {
	published: ['hub', 'category:landing'],
	hidden: ['section:landing/feed#faq'],
	updatedAt: '2026-09-10T12:00:00.000Z',
	audit: { hub: { at: '2026-09-10T12:00:00.000Z', by: 'nik' } }
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Records every call and answers each endpoint from `routes`. */
const stubFetch = (routes: { get?: () => Response; post?: () => Response }) => {
	const calls: { method: string; url: string }[] = [];
	(globalThis as any).fetch = async (url: string, init: RequestInit) => {
		const method = String(init?.method ?? 'GET');
		calls.push({ method, url });
		const handler = method === 'POST' ? routes.post : routes.get;
		if (!handler) throw new Error(`unexpected ${method} ${url}`);
		return handler();
	};
	return calls;
};

const readCache = () => JSON.parse(storage.get(CACHE_KEY) ?? 'null');

test('an admin read keeps the audit trail in memory and out of the shared browser cache', async () => {
	const { refreshMarketingPublications } = await loadStore();
	storage.clear();
	stubFetch({ get: () => jsonResponse({ ok: true, publications: WITH_AUDIT }) });

	const publications = await refreshMarketingPublications({ force: true });

	// the admin session itself still gets it — that is what the panel renders
	assert.equal(publications?.audit?.hub?.by, 'nik', 'an admin response keeps its audit trail in memory');

	const cached = readCache();
	assert.deepEqual(Object.keys(cached).sort(), ['hidden', 'published', 'updatedAt']);
	assert.ok(!('audit' in cached), 'who published what must never be written to a localStorage key the next visitor reads');
	assert.deepEqual(cached.published, WITH_AUDIT.published, 'the publish state itself is still seeded for the first paint');
	assert.deepEqual(cached.hidden, WITH_AUDIT.hidden);
});

test('concurrent readers share one request', async () => {
	const { refreshMarketingPublications } = await loadStore();
	const calls = stubFetch({ get: () => jsonResponse({ ok: true, publications: WITH_AUDIT }) });

	const [first, second] = await Promise.all([refreshMarketingPublications({ force: true }), refreshMarketingPublications({ force: true })]);

	assert.equal(calls.length, 1, 'the drawer and the route mount together — that is one fetch, not two');
	assert.equal(first, second, 'both callers resolve to the same snapshot');
});

test('a read inside the freshness window is reused, and force refetches', async () => {
	const { refreshMarketingPublications } = await loadStore();
	const calls = stubFetch({ get: () => jsonResponse({ ok: true, publications: WITH_AUDIT }) });

	await refreshMarketingPublications({ force: true });
	assert.equal(calls.length, 1);

	await refreshMarketingPublications();
	assert.equal(calls.length, 1, 'a second consumer mounting straight after reuses the live snapshot');

	await refreshMarketingPublications({ force: true });
	assert.equal(calls.length, 2, 'force always goes to the server (login/logout re-resolves the audit trail)');
});

test('an empty change list never reaches the network', async () => {
	const { applyMarketingPublicationChanges } = await loadStore();
	const calls = stubFetch({});

	await applyMarketingPublicationChanges([]);

	assert.equal(calls.length, 0, '"publish all" with nothing left to publish must not POST');
});

test('a refused admin write throws and reconciles against the server', async () => {
	const { applyMarketingPublicationChanges, refreshMarketingPublications } = await loadStore();
	storage.clear();
	const calls = stubFetch({
		post: () => jsonResponse({ ok: false, error: 'Admin only' }, 403),
		get: () => jsonResponse({ ok: true, publications: { published: [], hidden: [], updatedAt: null } })
	});

	await assert.rejects(
		() => applyMarketingPublicationChanges([{ key: 'hub', state: 'published' }]),
		/Admin only/,
		'the caller is told, so the toast is an error rather than a silent no-op'
	);

	// the catch refetches without awaiting; join whatever is still in flight
	await refreshMarketingPublications();

	assert.deepEqual(
		calls.map((call) => `${call.method} ${call.url}`),
		[`POST ${ADMIN_ENDPOINT}`, `GET ${PUBLIC_ENDPOINT}`],
		'a failed write is followed by a read of server truth'
	);
	assert.deepEqual(readCache().published, [], 'the optimistic key does not survive the refusal');
});
