import test from 'node:test';
import assert from 'node:assert/strict';
import { readCloudFolderInventoryPages } from './cloudInventoryPages.client';
import { CLOUD_INVENTORY_PAGE_BYTES, parseCloudInventoryPage } from './cloudInventoryPages';
const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const node = { kind: 'folder', path: 'Café 🌱', id: 'folder', folderId: 'root', revision: 'r1' };
const page = (ordinal = 0, extra = {}) => ({ version: 1, rootId: 'root', rootRevision: 'r1', generation: 'generation', ordinal, nodes: [node], ...extra });
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) + '\n');
function fixture(chunks: Uint8Array[], options: { status?: number; type?: string } = {}) {
	let canceled = 0, requests = 0, current = scope; const required: [string, string][] = [];
	const input = { currentScope: () => current, origin: () => scope.origin,
		requireCapability: async (feature: string, version: string) => { required.push([feature, version]); },
		fetch: async (url: any, init: any) => {
			requests++; assert.equal(new URL(String(url)).searchParams.get('pages'), '1');
			assert.equal(init.headers['X-Thingtime-Expected-Actor'], scope.ownerId); assert.equal(init.redirect, 'error');
			return new Response(new ReadableStream({ start(c) { for (const bytes of chunks) c.enqueue(bytes); c.close(); }, cancel() { canceled++; } }),
				{ status: options.status ?? 200, headers: { 'Content-Type': options.type ?? 'application/x-ndjson' } });
		}
	};
	return { input, required, requests: () => requests, canceled: () => canceled, change: () => { current = { ...scope, ownerId: 'other' }; } };
}
const collect = async (input: Parameters<typeof readCloudFolderInventoryPages>[2]) => {
	const result = []; for await (const row of readCloudFolderInventoryPages(scope, 'root', input)) result.push(row); return result;
};

test('NDJSON pages cross arbitrary UTF-8 chunk boundaries and retain one generation', async () => {
	const bytes = encode(page(0, { totalEntries: 1 }));
	for (const chunks of [[bytes], [...bytes].map(b => new Uint8Array([b]))]) {
		const f = fixture(chunks); assert.deepEqual(await collect(f.input), [page(0, { totalEntries: 1 })]);
		assert.deepEqual(f.required, [['api.files', '1.5.0'], ['api.actions-run', '1.7.0'], ['api.mongodb-endpoint', '1.1.0']]);
	}
	const f = fixture([new Uint8Array([...encode(page()), ...encode(page(1, { nodes: [], totalEntries: 1 }))])]);
	assert.equal((await collect(f.input)).length, 2);
});

test('terminal completion is withheld for truncation, trailing error, malformed framing and mixed generations', async () => {
	const mutations = [[], [encode(page())], [encode(page(0, { totalEntries: 2 }))], [encode(page(1, { totalEntries: 1 }))],
		[encode(page()), encode(page(1, { generation: 'changed', totalEntries: 2 }))],
		[encode(page()), encode(page(1, { rootRevision: 'changed', totalEntries: 2 }))],
		[encode(page(0, { totalEntries: 1 })), encode({ ok: false, error: 'snapshot failed' })],
		[encode(page(0, { totalEntries: 1 })).slice(0, -1)],
		[encode(page(0, { totalEntries: 1 })), new Uint8Array([0xff])],
		[new TextEncoder().encode(' '.repeat(CLOUD_INVENTORY_PAGE_BYTES + 1))],
		[encode(page(0, { rootId: 'foreign', totalEntries: 1 }))]];
	for (const chunks of mutations) {
		const f = fixture(chunks); let terminal = false;
		await assert.rejects(async () => { for await (const p of readCloudFolderInventoryPages(scope, 'root', f.input)) terminal ||= p.totalEntries !== undefined; });
		assert.equal(terminal, false);
	}
});

test('transport failure and identity/capability fences prevent successful inventory', async () => {
	for (const options of [{ status: 403 }, { type: 'application/json' }]) await assert.rejects(collect(fixture([], options).input));
	const f = fixture([encode(page(0, { totalEntries: 1 }))]); f.change(); await assert.rejects(collect(f.input)); assert.equal(f.requests(), 0);
	const g = fixture([]); g.input.requireCapability = async () => { throw Error('old origin'); }; await assert.rejects(collect(g.input)); assert.equal(g.requests(), 0);
	const controller = new AbortController(); controller.abort(); await assert.rejects(collect({ ...fixture([]).input, signal: controller.signal }));
	const h = fixture([encode(page()), encode(page(1, { nodes: [], totalEntries: 1 }))]);
	const stream = readCloudFolderInventoryPages(scope, 'root', h.input); assert.equal((await stream.next()).done, false); h.change(); await assert.rejects(stream.next());
});

test('page parsing rejects impossible counts, versions and unbounded entries', () => {
	for (const value of [page(0, { version: 2 }), page(0, { nodes: [] }), page(0, { totalEntries: -1 }), page(0, { generation: '' }),
		page(0, { nodes: Array(129).fill(node) }), page(-1)]) assert.throws(() => parseCloudInventoryPage(value, 'root'));
});
