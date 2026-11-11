// Synthetic fresh-process durability witness, not native/API acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BSON, Binary, ObjectId } from 'mongodb';
import { openSqliteDocumentStore } from './sqliteStore.ts';

const [mode, path] = process.argv.slice(2);
assert.ok(mode === 'write' || mode === 'read');
const expected = BSON.serialize({
	text: 'cold process durable document',
	created: new Date('2026-11-11T00:00:00.000Z'),
	binary: new Binary(Buffer.from([0, 1, 255]), 128),
	id: new ObjectId('0123456789abcdef01234567'),
});
const store = await openSqliteDocumentStore(path);
await store.transaction(session => {
	if (mode === 'write') session.insert({ collection: 'things', key: 'private-test' }, expected);
	else assert.deepEqual(session.read({ collection: 'things', key: 'private-test' }), Uint8Array.from(expected));
});
if (mode === 'read') await store.close();
console.log(JSON.stringify({ mode, sha256: createHash('sha256').update(expected).digest('hex') }));
// Writer deliberately exits without close/checkpoint: the committed WAL must be
// recoverable by the independent reader, not just by the original connection.
process.exit(0);
