import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setImmediate as immediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test, { type TestContext } from 'node:test';
import { BSON, Binary, Decimal128, Double, Int32, Long, ObjectId } from 'mongodb';
import type { DocumentStore, DocumentTransaction } from './contract';
import { openSqliteDocumentStore } from './sqliteStore';

const runFile = promisify(execFile);
const address = { collection: 'things', key: 'a' };
const encode = (value: number) => BSON.serialize({ value });
const valueOf = (session: DocumentTransaction, key = 'a') => BSON.deserialize(session.read({ collection: 'things', key })!).value;
const code = (expected: string) => (error: unknown) => (error as { code?: string })?.code === expected;
const gate = () => {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
};
const fixture = async (t: TestContext) => {
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-document-store-'));
	const stores: DocumentStore[] = [];
	t.after(async () => {
		await Promise.all(stores.map(store => store.close()));
		await rm(directory, { recursive: true, force: true });
	});
	return {
		path: join(directory, 'documents.sqlite'),
		open: async (name = 'documents.sqlite') => {
			const store = await openSqliteDocumentStore(join(directory, name));
			stores.push(store);
			return store;
		},
	};
};

test('BSON bytes preserve typed values and buffers never alias stored data', async t => {
	const f = await fixture(t), store = await f.open();
	const original = BSON.serialize({
		date: new Date('2026-11-11T01:02:03.000Z'), binary: new Binary(Buffer.from([0, 255, 1]), 128),
		id: new ObjectId('0123456789abcdef01234567'), long: Long.fromString('9223372036854775807'),
		decimal: Decimal128.fromString('1.2300'), integer: new Int32(9), double: new Double(9),
		nested: { array: [null, true, '中文😀'] },
	});
	const input = Uint8Array.from(original);
	await store.transaction(session => {
		session.insert(address, input);
		input.fill(0);
		const read = session.read(address)!;
		assert.deepEqual(read, Uint8Array.from(original));
		read.fill(0);
		assert.deepEqual(session.read(address), Uint8Array.from(original));
		assert.equal(session.read({ collection: 'things', key: 'missing' }), undefined);
	});
	await store.close();
	const reopened = await f.open();
	await reopened.transaction(session => {
		const bytes = session.read(address)!;
		assert.deepEqual(bytes, Uint8Array.from(original));
		const document = BSON.deserialize(bytes, { promoteValues: false });
		assert.equal(document.date.toISOString(), '2026-11-11T01:02:03.000Z');
		assert.equal(document.binary.sub_type, 128);
		assert.equal(document.id.toHexString(), '0123456789abcdef01234567');
		assert.equal(document.long.toString(), '9223372036854775807');
	});
});

test('keys are unique within explicit collections; duplicate failure rolls back even if caught', async t => {
	const store = await (await fixture(t)).open();
	await store.transaction(session => {
		session.insert(address, encode(1));
		session.insert({ collection: 'sessions', key: 'a' }, encode(2));
		session.insert({ collection: 'things', key: "a'; DELETE FROM documents;--" }, encode(3));
	});
	await assert.rejects(store.transaction(session => {
		session.insert({ collection: 'things', key: 'must-rollback' }, encode(9));
		assert.throws(() => session.insert(address, encode(4)), code('DUPLICATE_DOCUMENT'));
	}), code('DUPLICATE_DOCUMENT'));
	await store.transaction(session => {
		assert.equal(valueOf(session), 1);
		assert.equal(session.read({ collection: 'things', key: 'must-rollback' }), undefined);
		assert.equal(BSON.deserialize(session.read({ collection: 'sessions', key: 'a' })!).value, 2);
		assert.equal(session.scan('things', { limit: 10 }).documents.length, 2);
	});
});

test('rejected async callback atomically rolls back inserts, replacement and deletion across collections', async t => {
	const store = await (await fixture(t)).open();
	await store.transaction(session => { session.insert(address, encode(1)); session.insert({ collection: 'ledger', key: 'owner' }, encode(10)); });
	const failure = new Error('synthetic quota admission refused');
	await assert.rejects(store.transaction(async session => {
		assert.equal(session.delete(address), true);
		session.put({ collection: 'ledger', key: 'owner' }, encode(11));
		session.insert({ collection: 'things', key: 'new' }, encode(2));
		await immediate();
		throw failure;
	}), error => error === failure);
	await store.transaction(session => {
		assert.equal(valueOf(session), 1);
		assert.equal(BSON.deserialize(session.read({ collection: 'ledger', key: 'owner' })!).value, 10);
		assert.equal(session.read({ collection: 'things', key: 'new' }), undefined);
		assert.equal(session.delete({ collection: 'things', key: 'absent' }), false);
	});
});

test('scans page deterministically without truncation or crossing collection boundaries', async t => {
	const store = await (await fixture(t)).open();
	const keys = ['z', 'a', 'A', '中', '😀'];
	await store.transaction(session => {
		for (const [index, key] of keys.entries()) session.insert({ collection: 'things', key }, encode(index));
		session.insert({ collection: 'other', key: 'b' }, encode(99));
	});
	await store.transaction(session => {
		const observed: string[] = [];
		let after: string | undefined;
		do {
			const page = session.scan('things', { after, limit: 2 });
			observed.push(...page.documents.map(document => document.key));
			if (!page.nextAfter) break;
			after = page.nextAfter;
		} while (true);
		assert.deepEqual(observed, [...keys].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
		assert.deepEqual(session.scan('things', { after: '😀', limit: 2 }), { documents: [], nextAfter: null });
		assert.deepEqual(session.scan('empty', { limit: 2 }), { documents: [], nextAfter: null });
	});
});

test('competing async work and a second handle cannot enter or read an uncommitted transaction', { timeout: 5_000 }, async t => {
	const f = await fixture(t), first = await f.open(), second = await f.open();
	await first.transaction(session => session.insert(address, encode(0)));
	const entered = gate(), release = gate();
	let captured!: DocumentTransaction, secondEntered = false;
	const writer = first.transaction(async session => {
		captured = session;
		session.put(address, encode(1));
		entered.resolve();
		await release.promise;
	});
	await entered.promise;
	try {
		assert.throws(() => captured.read(address), code('TRANSACTION_OWNERSHIP'));
		const competitor = second.transaction(session => {
			secondEntered = true;
			assert.equal(valueOf(session), 1);
			session.put(address, encode(2));
		});
		await immediate();
		assert.equal(secondEntered, false);
		release.resolve();
		await Promise.all([writer, competitor]);
		await first.transaction(session => assert.equal(valueOf(session), 2));
	} finally { release.resolve(); await writer; }
});

test('nested, cross-store, foreign-context and escaped sessions fail explicitly', async t => {
	const f = await fixture(t), first = await f.open(), second = await f.open('second.sqlite');
	const late = gate();
	let escaped!: DocumentTransaction, detached!: Promise<void>;
	await first.transaction(async session => {
		escaped = session;
		await assert.rejects(first.transaction(() => undefined), code('TRANSACTION_OWNERSHIP'));
		await assert.rejects(second.transaction(() => undefined), code('TRANSACTION_OWNERSHIP'));
		await assert.rejects(first.close(), code('TRANSACTION_OWNERSHIP'));
		await assert.rejects(openSqliteDocumentStore(f.path), code('TRANSACTION_OWNERSHIP'));
		detached = late.promise.then(() => { assert.throws(() => session.put(address, encode(999)), code('TRANSACTION_OWNERSHIP')); });
		session.insert(address, encode(1));
	});
	late.resolve();
	await detached;
	assert.throws(() => escaped.read(address), code('TRANSACTION_OWNERSHIP'));
	await assert.rejects(second.transaction(() => escaped.delete(address)), code('TRANSACTION_OWNERSHIP'));
	await first.transaction(session => assert.equal(valueOf(session), 1));
});

test('a live session cannot be used by another store transaction while its owner awaits', { timeout: 5_000 }, async t => {
	const f = await fixture(t), first = await f.open(), second = await f.open('other.sqlite');
	const entered = gate(), release = gate();
	let captured!: DocumentTransaction;
	const owner = first.transaction(async session => {
		captured = session;
		session.insert(address, encode(1));
		entered.resolve();
		await release.promise;
	});
	await entered.promise;
	try {
		await assert.rejects(second.transaction(() => captured.put(address, encode(999))), code('TRANSACTION_OWNERSHIP'));
	} finally { release.resolve(); await owner; }
	await first.transaction(session => assert.equal(valueOf(session), 1));
});

test('close drains admitted work, rejects new work, is idempotent, and permits durable reopen', { timeout: 5_000 }, async t => {
	const f = await fixture(t), store = await f.open();
	const entered = gate(), release = gate();
	const writer = store.transaction(async session => { entered.resolve(); await release.promise; session.insert(address, encode(1)); });
	await entered.promise;
	const queued = store.transaction(session => session.put(address, encode(2)));
	const closing = store.close();
	assert.equal(store.close(), closing);
	try { await assert.rejects(store.transaction(() => undefined), code('STORE_CLOSED')); }
	finally { release.resolve(); }
	await Promise.all([writer, queued, closing]);
	const reopened = await f.open();
	await reopened.transaction(session => assert.equal(valueOf(session), 2));
});

test('invalid addresses, scan options and incomplete BSON cannot partially commit', async t => {
	const store = await (await fixture(t)).open();
	for (const invalid of ['', '\0', '\ud800']) {
		await assert.rejects(store.transaction(session => session.insert({ collection: invalid, key: 'a' }, encode(1))), code('INVALID_ADDRESS'));
		await assert.rejects(store.transaction(session => session.read({ collection: 'things', key: invalid })), code('INVALID_ADDRESS'));
	}
	for (const limit of [0, -1, 1.5, Infinity]) await assert.rejects(store.transaction(session => session.scan('things', { limit })), code('INVALID_SCAN'));
	await assert.rejects(store.transaction(session => {
		session.insert(address, encode(1));
		assert.throws(() => session.put({ collection: 'things', key: 'bad' }, encode(2).subarray(0, 6)), code('INVALID_BSON'));
	}), code('INVALID_BSON'));
	await store.transaction(session => assert.equal(session.scan('things', { limit: 10 }).documents.length, 0));
	await assert.rejects(openSqliteDocumentStore(':memory:'), code('INVALID_PATH'));
});

test('a new process recovers exact committed bytes after writer exits without closing/checkpointing', { timeout: 15_000 }, async t => {
	const f = await fixture(t);
	const script = fileURLToPath(new URL('./reopen.fixture.mjs', import.meta.url));
	const run = async (mode: string) => {
		const { stdout } = await runFile(process.execPath, ['--import', 'tsx', script, mode, f.path], { timeout: 5_000, maxBuffer: 16_384 });
		return JSON.parse(stdout);
	};
	const write = await run('write'), read = await run('read');
	assert.equal(write.mode, 'write');
	assert.equal(read.mode, 'read');
	assert.equal(read.sha256, write.sha256);
	const store = await f.open();
	await store.transaction(session => assert.equal(session.scan('things', { limit: 10 }).documents.length, 1));
});

test('opening an unrelated SQLite file is refused without changing its data', async t => {
	const f = await fixture(t);
	const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
	const other = new DatabaseSync(f.path);
	try { other.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES('preserve');"); }
	finally { other.close(); }
	await assert.rejects(openSqliteDocumentStore(f.path), code('STORE_FORMAT'));
	const verification = new DatabaseSync(f.path);
	try {
		assert.equal(verification.prepare('SELECT value FROM unrelated').get().value, 'preserve');
		assert.equal(verification.prepare('PRAGMA application_id').get().application_id, 0);
	} finally { verification.close(); }
});
