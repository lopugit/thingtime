/** Disposable replica only: production signup, Things and Files Request handlers.
 * No injected auth, document seeding or direct database reads/writes. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { readCloudFolderInventoryPages } from '../app/fileSync/cloudInventoryPages.client';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
import { thingtimeCapabilityManifest } from '../app/api/utils/capabilities/thingtimeCapabilities';
const directory = process.env.THINGTIME_CLOUD_INVENTORY_TEST_DIRECTORY;
assert.ok(directory && /^mongodb:\/\/127\.0\.0\.1:\d+\/thingtime\?replicaSet=cloud-inventory-pages$/.test(process.env.MONGODB_CONNECTION_STRING || ''));
assert.equal(process.env.THINGTIME_EMAIL_PROVIDER, 'console');
const actual = await realpath(directory!); assert.equal(dirname(actual), await realpath(tmpdir()));
assert.ok(basename(actual).startsWith('thingtime-cloud-inventory-pages-'));
const mode = await stat(actual); assert.equal(mode.uid, process.getuid!()); assert.equal(mode.mode & 0o077, 0);
const base = 'http://127.0.0.1:28242';
process.env.APP_URL = base; process.env.JWT_SECRET = randomUUID() + randomUUID(); process.env.NODE_ENV = 'test';
const register = await import('../app/routes/api/v1/auth/register/_register');
const things = await import('../app/routes/api/v1/things/_things');
const files = await import('../app/routes/api/v1/files/_files');
const logout = await import('../app/routes/api/v1/auth/logout/_logout');
let cookie = '';
const request = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => new Request(base + path,
	{ method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const call = async (handler: any, path: string, body?: unknown, method?: string) => {
	let response: Response = await handler({ request: request(path, body, method) });
	for (let retry = 0; response.status === 429 && retry < 3; retry++) {
		const seconds = Number(response.headers.get('Retry-After'));
		assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 60, 'Bounded fixture Retry-After');
		await response.body?.cancel(); await new Promise(resolve => setTimeout(resolve, seconds * 1000 + 100));
		response = await handler({ request: request(path, body, method) });
	}
	assert.equal(response.status, 200, path.split('?')[0] + ' status');
	const data = await response.json(); assert.notEqual(data.ok, false); return { response, data };
};
const username = 'inventory-' + randomUUID().slice(0, 8);
const registered = await call(register.action, '/api/v1/auth/register', {
	username, password: randomUUID() + '-Disposable!', email: username + '@example.invalid', displayName: 'Inventory acceptance'
});
cookie = registered.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const root = (await call(things.action, '/api/v1/things', { thingtime: ['folder'], acl: ['tt:user'], crystal: { name: 'Inventory root' } })).data.thing;
const expected = new Map<string, string>(); let lastId = '';
for (let i = 0; i < 135; i++) {
	const name = 'Folder-' + String(i).padStart(3, '0');
	const row = (await call(things.action, '/api/v1/things', { thingtime: ['folder'], acl: ['tt:user'], folderId: root.id, crystal: { name } })).data.thing;
	expected.set(name, row.id); lastId = row.id;
}
const scope = { origin: base, ownerId: registered.data.user.id, dataPlane: 'home', deviceId: 'fixture', rootId: 'connection' };
const journal = await openSyncJournal(new IDBFactory(), 'cloud-inventory-integration', IDBKeyRange);
const inventory = journal.inventory({ scope, currentScope: () => scope });
const capture = { id: randomUUID(), generation: randomUUID(), source: 'remote' as const };
let pages = 0;
try {
	for await (const page of readCloudFolderInventoryPages(scope, root.id, {
		currentScope: () => scope, origin: () => scope.origin,
		requireCapability: async (feature, minimum) => {
			const manifest = thingtimeCapabilityManifest(base); assert.equal(manifest.origin, base);
			assert.ok(capabilitySatisfies(manifest.features[feature]?.version, minimum));
		},
		fetch: async (url, init) => {
			const response = await files.loader({ request: new Request(String(url), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Cookie: cookie } }) });
			assert.match(response.headers.get('cache-control')!, /private.*no-store/); return response;
		}
	})) {
		if (pages++ === 0) {
			await inventory.beginCloud(capture, page);
			await call(things.action, '/api/v1/things', { id: lastId, crystal: { name: 'Later name' } }, 'PATCH');
		}
		for (const node of page.nodes) { assert.equal(node.kind, 'folder'); assert.equal((node as any).id, expected.get(node.path)); }
		await inventory.appendCloud(capture, { ordinal: page.ordinal, nodes: page.nodes,
			...(page.totalEntries === undefined ? {} : { totalEntries: page.totalEntries }) });
	}
	await inventory.seal(capture); assert.equal(pages, 2); assert.equal((await inventory.read(capture)).totalEntries, 135);
	assert.equal((await inventory.cloudNode(capture, 'Folder-134'))?.kind, 'folder'); assert.equal(await inventory.cloudNode(capture, 'Later name'), null);
	const current = (await call(files.loader, '/api/v1/files?rootId=' + root.id)).data.inventory;
	assert.ok(current.nodes.some((node: any) => node.path === 'Later name'));
	await call(logout.action, '/api/v1/auth/logout', {});
	assert.equal((await files.loader({ request: request('/api/v1/files?rootId=' + root.id + '&pages=1') })).status, 401);
	console.log(JSON.stringify({ cloudInventoryPagesProof: true, pages, capturedEntries: 135,
		checks: ['real-signup-and-Things-writers', 'private-Files-handler', 'single-snapshot-concurrent-rename', 'sealed-journal', 'logout-refusal'],
		boundary: 'Production Request handlers and Mongo replica; not HTTP/browser, installed-device or byte-transfer acceptance' }));
} finally { journal.close(); }
process.exit(0);
