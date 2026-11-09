import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let rows: any[] = [], failRead = false, captured: any, pageLimit = 0;
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getHomeThingsCollection: async () => ({
 findOne: async () => ({ shareId: 'device', crystal: { name: 'Device' } }),
 find: (query: any) => { captured = query; return { sort(order: any) { assert.deepEqual(order, { createdAt: -1, shareId: 1 }); return this; }, limit(value: number) { pageLimit = value; return this; }, async toArray() { return rows.slice(0, pageLimit); } }; }
}) } });
mock.module(new URL('../mongodb/dataPlane.ts', import.meta.url).href, { namedExports: { mongoDataPlane: () => 'home' } });
mock.module(new URL('../things/things.ts', import.meta.url).href, { namedExports: {
 getThing: async () => { if (failRead) throw Error('internal database password must never escape'); return { ok: false, status: 404, error: 'Not found' }; },
 createThing: async () => ({ ok: false, status: 402, error: 'Storage admission unavailable' }),
 parseChronoCursor: (value: string) => value === '123_tail' ? { createdAt: new Date(123), id: 'tail' } : null,
 chronoCursorClause: (cursor: any) => ({ $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, shareId: { $gt: cursor.id } }] })
} });
const { ensureDeviceFolders, listDeviceFolderReferences } = await import('./deviceFolders');
beforeEach(() => { rows = []; failRead = false; captured = null; pageLimit = 0; });
test('unknown internal errors are generic while classified canonical refusals retain safe status', async () => {
 failRead = true;
 const unexpected = await ensureDeviceFolders('owner', 'https://example.test', { deviceId: 'device' });
 assert.deepEqual(unexpected, { ok: false, status: 503, error: 'Device folders are unavailable. Please retry.' });
 failRead = false;
 const canonical = await ensureDeviceFolders('owner', 'https://example.test', { deviceId: 'device' });
 assert.deepEqual(canonical, { ok: false, status: 402, error: 'Storage admission unavailable' });
});
test('device folder discovery uses the canonical chronological cursor and finite pages', async () => {
 rows = Array.from({ length: 51 }, (_, index) => ({ shareId: `device-${index}`, createdAt: new Date(1000 - index), crystal: { name: `Device ${index}` } }));
 const first = await listDeviceFolderReferences('owner', 'https://example.test');
 assert.equal(first.ok, true); if (!first.ok) return;
 assert.equal(first.devices.length, 50); assert.equal(first.nextCursor, '951_device-49'); assert.equal(pageLimit, 51);
 assert.equal(captured.ownerId, 'owner'); assert.equal(captured.thingtime, 'device');
 rows = rows.slice(50);
 const next = await listDeviceFolderReferences('owner', 'https://example.test', '123_tail');
 assert.equal(next.ok, true); if (!next.ok) return;
 assert.equal(next.devices.length, 1); assert.equal(next.nextCursor, null); assert.ok(captured.$or);
 assert.equal((await listDeviceFolderReferences('owner', 'https://example.test', 'malformed')).ok, false);
});
