import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudInventoryService, createCloudPathService } from './inventory';
import { contentPartPlan } from '../../../fileSync/contentFingerprint';
const date = new Date('2026-10-17T00:00:00Z');
const folder = (id: string, parent: string | null, name = id) => ({
	shareId: id,
	ownerId: 'owner',
	thingtime: ['folder'],
	folderId: parent,
	acl: ['tt:user'],
	updatedAt: date,
	crystal: { name }
});
const file = (id: string, parent: string, name = id) => ({
	...folder(id, parent, name),
	thingtime: ['file'],
	timelineHeadId: 'revision-' + id,
	crystal: {
		name,
		trashed: false,
		content: {
			attachmentId: 'attachment-' + id,
			version: 'a'.repeat(64),
			size: 4,
			fingerprint: { algorithm: 'sha256-parts-v1', ...contentPartPlan(4), sha256: 'b'.repeat(64) }
		}
	}
});
function fixture(input = [folder('root', null), folder('nested', 'root'), file('file', 'nested')], maxEntries = 10_000) {
	const docs: any[] = structuredClone(input);
	let session: any,
		reads = 0,
		closed = 0,
		afterRead = () => {},
		time = 0;
	const check = (options: any) => {
		assert.equal(options.session, session);
		assert.ok(options.maxTimeMS > 0 && options.maxTimeMS <= 5000);
		assert.equal(options.projection._id, 0);
	};
	const collection = {
		async findOne(filter: any, options: any) {
			check(options);
			return session.docs.find((d: any) => d.shareId === filter.shareId && d.ownerId === filter.ownerId);
		},
		find(filter: any, options: any) {
			check(options);
			reads++;
			let count = Infinity;
			const matches = session.docs.filter(
				(d: any) =>
					d.ownerId === filter.ownerId &&
					filter.folderId.$in.includes(d.folderId) &&
					(d.thingtime.includes('folder') ||
						(d.thingtime.includes('file') && !d.crystal.trashed) ||
						(d.thingtime.length === 1 && d.thingtime[0] === 'data' && (d.crystal.kind === 'folder' || d.crystal.type === 'folder')))
			);
			afterRead();
			return {
				sort() {
					return this;
				},
				limit(n: number) {
					count = n;
					return this;
				},
				batchSize(n: number) {
					assert.equal(n, 100);
					return this;
				},
				async *[Symbol.asyncIterator]() {
					for (const doc of matches.slice(0, count)) yield doc;
				},
				async close() {
					closed++;
				}
			};
		}
	};
	const dependencies = {
		collection: async () => collection,
		customPlane: () => false,
		transaction: async (work: (session: any) => Promise<any>) => {
			session = { docs: structuredClone(docs) };
			return work(session);
		},
		now: () => time,
		maxEntries
	};
	return {
		read: createCloudInventoryService(dependencies),
		bounded: (overrides: Parameters<typeof createCloudPathService>[0] = {}) => createCloudPathService({ ...dependencies, ...overrides }),
		docs,
		stats: () => ({ reads, closed }),
		onRead: (f: () => void) => {
			afterRead = f;
		},
		clock: (value: number) => {
			time = value;
		}
	};
}
test('one snapshot scans a private subtree breadth-first with no per-file queries', async () => {
	const f = fixture([
		folder('root', null),
		folder('a', 'root'),
		folder('b', 'root'),
		file('one', 'a'),
		file('two', 'b'),
		file('outside', 'elsewhere')
	]);
	const result = await f.read('owner', 'root');
	assert.equal(result.ok, true);
	assert.deepEqual(
		result.inventory.nodes.map((n: any) => n.path),
		['a', 'b', 'a/one', 'b/two']
	);
	assert.deepEqual(f.stats(), { reads: 2, closed: 2 });
});
test('mutations between traversal levels do not mix live state into a snapshot', async () => {
	const f = fixture();
	f.onRead(() => {
		f.docs[1].crystal.name = 'renamed';
		f.docs[2].folderId = 'root';
	});
	const result = await f.read('owner', 'root');
	assert.equal(result.ok, true);
	assert.deepEqual(
		result.inventory.nodes.map((n: any) => n.path),
		['nested', 'nested/file']
	);
	const next = await f.read('owner', 'root');
	assert.deepEqual(
		next.inventory.nodes.map((n: any) => n.path),
		['renamed', 'file']
	);
});
test('empty inventory is explicit; Trash and ordinary non-filesystem Things do not masquerade as live files', async () => {
	const trashed = file('old', 'root');
	trashed.crystal.trashed = true;
	const note = { ...folder('note', 'root'), thingtime: ['data'], crystal: { name: 'note' } };
	const f = fixture([folder('root', null), trashed, note]);
	const result = await f.read('owner', 'root');
	assert.equal(result.ok, true);
	assert.deepEqual(result.inventory.nodes, []);
});
test('root and descendant authorization failures never return a partial inventory', async () => {
	for (const patch of [
		{ ownerId: 'other' },
		{ thingtime: ['folder', 'file'] },
		{ acl: ['tt:all'] },
		{ appId: 'app' },
		{ targetId: 'parent' },
		{ sandbox: true }
	]) {
		const f = fixture();
		Object.assign(f.docs[0], patch);
		const result = await f.read('owner', 'root');
		assert.equal(result.ok, false);
		assert.equal(result.inventory, undefined);
	}
	for (const patch of [{ acl: ['tt:all'] }, { appId: 'app' }, { sandboxSpace: 'sandbox' }, { targetId: 'parent' }, { timelineHeadId: undefined }]) {
		const f = fixture();
		Object.assign(f.docs[2], patch);
		assert.equal((await f.read('owner', 'root')).ok, false);
	}
});
test('legacy folders and inherited private descendants use the same inventory contract', async () => {
	const f = fixture();
	f.docs[1].thingtime = ['data'];
	f.docs[1].crystal.kind = 'folder';
	f.docs[1].acl = ['tt:inherit'];
	assert.equal((await f.read('owner', 'root')).ok, true);
});
test('missing ancestors, cycles, malformed paths and case/Unicode collisions fail closed', async () => {
	for (const change of [
		(f: ReturnType<typeof fixture>) => {
			f.docs[0].folderId = 'missing';
		},
		(f: ReturnType<typeof fixture>) => {
			f.docs[0].folderId = 'nested';
		},
		(f: ReturnType<typeof fixture>) => {
			f.docs[2].crystal.name = '../outside';
		},
		(f: ReturnType<typeof fixture>) => {
			f.docs.push(file('second', 'nested', 'FILE'));
		},
		(f: ReturnType<typeof fixture>) => {
			f.docs[2].crystal.name = 'café';
			f.docs.push(file('second', 'nested', 'cafe\u0301'));
		}
	]) {
		const f = fixture();
		change(f);
		const result = await f.read('owner', 'root');
		assert.equal(result.ok, false);
		assert.equal(result.inventory, undefined);
	}
});
test('entry, byte, depth and time bounds discard all progress and close cursors', async () => {
	const small = fixture(undefined, 1);
	assert.equal((await small.read('owner', 'root')).status, 413);
	assert.equal(small.stats().reads, small.stats().closed);
	const huge = fixture();
	huge.docs[2].crystal.name = 'x'.repeat(8 * 1024 * 1024);
	assert.equal((await huge.read('owner', 'root')).status, 413);
	assert.equal(huge.stats().reads, huge.stats().closed);
	const deep = fixture();
	deep.docs.splice(1);
	for (let i = 1; i < 66; i++) deep.docs.push(folder('f' + i, i === 1 ? 'root' : 'f' + (i - 1)));
	assert.equal((await deep.read('owner', 'root')).status, 409);
	const slow = fixture();
	slow.onRead(() => slow.clock(20_001));
	assert.equal((await slow.read('owner', 'root')).status, 503);
	assert.equal(slow.stats().reads, slow.stats().closed);
});
test('custom storage and invalid roots fail before opening the home database', async () => {
	let touched = false;
	const read = createCloudInventoryService({
		customPlane: () => true,
		collection: async () => {
			touched = true;
		}
	});
	assert.equal((await read('owner', 'root')).ok, false);
	assert.equal(touched, false);
	const f = fixture();
	assert.equal((await f.read('owner', '../root')).status, 400);
	assert.equal(f.stats().reads, 0);
});

test('transaction retries share the original total deadline rather than restarting the budget', async () => {
	let time = 0,
		reads = 0;
	const collection = {
		async findOne() {
			reads++;
			return folder('root', null);
		},
		find() {
			return {
				sort() {
					return this;
				},
				limit() {
					return this;
				},
				batchSize() {
					return this;
				},
				async *[Symbol.asyncIterator]() {},
				async close() {}
			};
		}
	};
	const read = createCloudInventoryService({
		collection: async () => collection,
		customPlane: () => false,
		now: () => time,
		transaction: async (work) => {
			assert.equal((await work({})).ok, true);
			time = 20_001;
			return work({});
		}
	});
	const result = await read('owner', 'root');
	assert.equal(result.ok, false);
	assert.equal(result.status, 503);
	assert.equal(result.inventory, undefined);
	assert.equal(reads, 1);
});

test('fresh path checks traverse matching ancestors, see replacements, and return explicit absence', async () => {
	const f = fixture([folder('root', null), folder('nested', 'root'), folder('unrelated', 'root'),
		file('file', 'nested'), file('unreadable', 'unrelated')]);
	f.docs[4].acl = ['tt:all'];
	const found = await f.read('owner', 'root', 'nested/file');
	assert.equal(found.ok, true); assert.equal(found.observation.entry.id, 'file');
	assert.equal(found.inventory, undefined); assert.deepEqual(f.stats(), { reads: 2, closed: 2 });
	assert.equal((await f.read('owner', 'root', 'nested/gone')).observation.entry, null);
	assert.equal((await f.read('owner', 'root', 'gone/child')).observation.entry, null);
	assert.equal(f.stats().reads, 5);
	f.docs.push(file('replacement', 'nested', 'gone'));
	assert.equal((await f.read('owner', 'root', 'nested/gone')).observation.entry.id, 'replacement');
	f.docs[1].crystal.name = 'moved';
	assert.equal((await f.read('owner', 'root', 'nested/file')).observation.entry, null);
	assert.equal((await f.read('owner', 'root', 'moved/file')).observation.entry.id, 'file');
});
test('path checks refuse unavailable roots, invalid siblings, aliases and file ancestors', async () => {
	for (const change of [
		(f: ReturnType<typeof fixture>) => { f.docs[0].folderId = 'gone'; },
		(f: ReturnType<typeof fixture>) => { f.docs[1].acl = ['tt:all']; },
		(f: ReturnType<typeof fixture>) => { f.docs[1].crystal.name = 'NESTED'; },
		(f: ReturnType<typeof fixture>) => { f.docs.push(folder('alias', 'root', 'NESTED')); },
		(f: ReturnType<typeof fixture>) => { f.docs[1] = file('nested', 'root'); },
		(f: ReturnType<typeof fixture>) => { f.docs[2].timelineHeadId = undefined; }
	]) {
		const f = fixture(); change(f);
		const result = await f.read('owner', 'root', 'nested/file');
		assert.equal(result.ok, false); assert.equal(result.observation, undefined);
	}
	const unicode = fixture([folder('root', null), folder('cafe', 'root', 'cafe\u0301')]);
	assert.equal((await unicode.read('owner', 'root', 'café/missing')).ok, false);
	const huge = fixture(undefined, 1);
	assert.equal((await huge.read('owner', 'root', 'nested/missing')).observation.entry, null); // Path checks no longer inherit whole-tree entry bounds.
	for (const path of ['', '../file', 'nested//file', 'a/'.repeat(64) + 'a'])
		assert.equal((await fixture().read('owner', 'root', path)).status, 400);
});
test('path observations share one snapshot and deadline without claiming a complete inventory', async () => {
	const f = fixture();
	f.onRead(() => { f.docs[1].crystal.name = 'moved'; });
	const first = await f.read('owner', 'root', 'nested/file');
	assert.equal(first.observation.entry.id, 'file'); assert.equal(first.inventory, undefined);
	assert.equal((await f.read('owner', 'root', 'nested/file')).observation.entry, null);
	const slow = fixture(); slow.onRead(() => slow.clock(20_001));
	const result = await slow.read('owner', 'root', 'missing');
	assert.equal(result.status, 503); assert.equal(result.observation, undefined);
	assert.equal(slow.stats().reads, slow.stats().closed);
});


test('wide path observations stream more than 10,000 siblings and reject late ambiguity', async () => {
 const name = (i: number) => 'Entry-' + '界'.repeat(180) + '-' + String(i).padStart(5, '0');
 const docs = [folder('root', null), ...Array.from({ length: 10_001 }, (_, i) => file('f' + i, 'root', name(i)))];
 assert.ok(Buffer.byteLength(JSON.stringify(docs)) > 8 * 1024 * 1024);
 const f = fixture(docs);
 const result = await f.read('owner', 'root', name(0));
 assert.equal(result.ok, true); assert.equal(result.observation.entry.id, 'f0'); assert.equal(result.inventory, undefined);
 assert.deepEqual(f.stats(), { reads: 1, closed: 1 });
 f.docs.push(file('duplicate', 'root', name(9999).toUpperCase()));
 const ambiguous = await f.read('owner', 'root', name(0));
 assert.equal(ambiguous.status, 409); assert.equal(ambiguous.observation, undefined);
 assert.deepEqual(f.stats(), { reads: 2, closed: 2 });
});

test('path proof rejects duplicate identities across levels and unrelated sibling aliases', async () => {
 for (const extra of [file('file', 'root', 'other-id'), file('alias', 'root', 'NESTED')]) {
  const f = fixture(); f.docs.push(extra);
  assert.equal((await f.read('owner', 'root', 'nested/file')).status, 409);
 }
 const f = fixture(); f.docs.push(file('other-a', 'root', 'café'), file('other-b', 'root', 'cafe\u0301'));
 assert.equal((await f.read('owner', 'root', 'absent')).status, 409);
});

test('scratch failure, cancellation and data-plane changes cannot become successful path absence', async () => {
 const f = fixture(); let closed = 0;
 const denied = f.bounded({ workspace: async () => ({ add: async () => { throw Error('private path must not leak'); }, close: async () => { closed++; } }) });
 const failure = await denied('owner', 'root', 'absent');
 assert.equal(failure.status, 503); assert.equal(failure.observation, undefined); assert.doesNotMatch(failure.error, /private path/); assert.equal(closed, 1);
 const abort = new AbortController(); f.onRead(() => abort.abort());
 assert.equal((await f.bounded()('owner', 'root', 'absent', abort.signal)).status, 503);
 assert.equal(f.stats().reads, f.stats().closed);
 let plane = false; f.onRead(() => { plane = true; });
 assert.equal((await f.bounded({ customPlane: () => plane })('owner', 'root', 'absent')).status, 409);
});

test('path transaction retries get a fresh uniqueness index but retain the original deadline', async () => {
 const f = fixture([folder('root', null)]); let attempts = 0, opened = 0, closed = 0;
 const read = f.bounded({
  collection: async () => ({ findOne: async () => folder('root', null), find: () => ({ sort() { return this; }, batchSize() { return this; }, async *[Symbol.asyncIterator]() {}, async close() {} }) }),
  transaction: async work => { await work({}); attempts++; return work({}); },
  workspace: async () => { opened++; const seen = new Set<string>(); return { add: async key => { assert.equal(seen.has(key), false); seen.add(key); return true; }, close: async () => { closed++; } }; }
 });
 assert.equal((await read('owner', 'root', 'absent')).ok, true);
 assert.deepEqual({ attempts, opened, closed }, { attempts: 1, opened: 2, closed: 2 });
 const expired = f.bounded({ collection: async () => { throw Error('should not read'); } }); f.clock(0);
 // Cancellation before acquiring a collection must not open scratch space.
 const signal = new AbortController(); signal.abort(); assert.equal((await expired('owner', 'root', 'absent', signal.signal)).status, 503);
});


test('path scan admission and workspace close are part of completion', async () => {
 const f = fixture(); let opened = 0, closed = 0, release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 const collection = { findOne: async () => folder('root', null), find: () => ({ sort() { return this; }, batchSize() { return this; }, async *[Symbol.asyncIterator]() {}, async close() {} }) };
 const read = f.bounded({ collection: async () => collection, workspace: async () => {
  opened++; await gate; return { add: async () => true, close: async () => { closed++; } };
 } });
 const first = read('owner', 'root', 'absent'), second = read('owner', 'root', 'absent');
 assert.equal((await read('owner', 'root', 'absent')).status, 503);
 release(); assert.equal((await first).ok, true); assert.equal((await second).ok, true);
 assert.deepEqual({ opened, closed }, { opened: 2, closed: 2 });
 assert.equal((await read('owner', 'root', 'absent')).ok, true);
 const brokenClose = f.bounded({ collection: async () => collection, workspace: async () => ({ add: async () => true, close: async () => { throw Error('private scratch path'); } }) });
 const result = await brokenClose('owner', 'root', 'absent');
 assert.equal(result.status, 503); assert.equal(result.observation, undefined); assert.doesNotMatch(result.error, /private scratch/);
 let attempts = 0;
 const timed = f.bounded({ collection: async () => collection, transaction: async work => {
  await work({}); attempts++; f.clock(20_001); return work({});
 } });
 f.clock(0); assert.equal((await timed('owner', 'root', 'absent')).status, 503); assert.equal(attempts, 1);
});
