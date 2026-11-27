import assert from 'node:assert/strict';
import test from 'node:test';
import { backupJson } from '../../../backups/manifest';
import { randomUUID } from 'node:crypto';
import { openAccountInventoryReferences } from './accountInventoryReferences';
import { openBackupReferenceIndex, parseBackupReferenceEvidence } from './storedReferences';
import type { BackupObjectStore } from './portableBackup';
import { backupAttachmentFixture } from './attachmentRecords.fixtures';
import { backupAttachmentFromDoc } from './attachmentRecords';
import { immutableReferenceIndex } from './immutableReferenceIndex';
const doc = (id: string, kinds: string[], crystal: any = {}) => ({ shareId: id, ownerId: 'owner', thingtime: kinds, crystal });
async function fixture(records: ReturnType<typeof doc>[], selection?: { kind: string; id: string }, attachment?: { value: any; durable: boolean }) {
	const objects = new Map<string, Uint8Array>(),
		id = randomUUID();
	const store: BackupObjectStore = {
		read: async (key, max) => {
			const bytes = objects.get(key);
			if (bytes) assert.ok(bytes.length <= max);
			return bytes ?? null;
		},
		put: async (key, bytes) => {
			if (objects.has(key)) assert.deepEqual(objects.get(key), bytes);
			else objects.set(key, bytes.slice());
		}
	};
	const fresh = (hash: string | null) => openAccountInventoryReferences(store, id, 'owner', hash, async () => {});
	let index = await fresh(null);
	for (const record of records) {
		await index.identity(record.shareId, record.thingtime);
		await index.presentation(record);
		if (!record.thingtime.includes('file')) await index.content(record);
	}
	if (attachment) {
		await index.identity(attachment.value.id, ['attachment']);
		await index.attachment(attachment.value, attachment.durable);
	}
	if (selection) await index.selection('owner', selection.kind, selection.id);
	await index.closeCensus();
	let hash = await index.save();
	const pages: any[] = [];
	const advance = async () => {
		index = await fresh(hash);
		const page = await index.advance();
		hash = await index.save();
		if (page) {
			parseBackupReferenceEvidence({ adapter: 'backup-reference-coverage', version: 1, value: page });
			pages.push(page);
		}
		return { hash, page, done: index.phase() === 'done' };
	};
	const finish = async () => {
		for (let units = 0; units < 10000; units++) {
			const result = await advance();
			if (result.done) return pages;
		}
		throw Error('Fixture did not terminate');
	};
	return { fresh, advance, finish, objects, store, id, hash: () => hash };
}
async function canonical(records: ReturnType<typeof doc>[], selection?: { kind: string; id: string }, attachment?: { value: any; durable: boolean }) {
	const index = await openBackupReferenceIndex('owner');
	try {
		for (const record of records) {
			index.addIdentity(record.shareId, record.thingtime);
			index.addContent(record);
		}
		if (attachment) {
			index.addIdentity(attachment.value.id, ['attachment']);
			index.addAttachment(attachment.value, attachment.durable);
		}
		if (selection) index.addSelection('owner', selection.kind, selection.id);
		const coverage = await index.validate(async () => {}),
			issues: any[] = [];
		for await (const page of index.evidencePages()) issues.push(...page.issues);
		return { coverage, issues };
	} finally {
		await index.close();
	}
}
const sorted = (issues: any[]) => issues.map((issue) => backupJson(issue)).sort();
test('retained descriptors distinguish duplicate filenames without consulting changed primary content', async () => {
	const records: Array<ReturnType<typeof doc> & { folderId?: string }> = [
		doc('root', ['folder'], { name: 'Projects' }),
		{ ...doc('left', ['folder'], { name: 'Alpha' }), folderId: 'root' },
		{ ...doc('right', ['folder'], { name: 'Beta' }), folderId: 'root' },
		{ ...doc('one', ['file'], { name: 'same.svg' }), folderId: 'left' },
		{ ...doc('two', ['file'], { name: 'same.svg' }), folderId: 'right' }
	];
	const f = await fixture(records);
	records[1].crystal.name = 'Changed after capture';
	records[3].folderId = 'right';
	await f.finish();
	const retained = await f.fresh(f.hash());
	const path = async (id: string) => {
		const names: string[] = [];
		for (let current: string | null = id; current !== null;) {
			const descriptor = await retained.descriptor(current); assert.ok(descriptor);
			names.unshift(descriptor.name); current = descriptor.parentId;
		}
		return names.join('/');
	};
	assert.equal(await path('one'), 'Projects/Alpha/same.svg');
	assert.equal(await path('two'), 'Projects/Beta/same.svg');
	assert.deepEqual(await retained.descriptor('one'), { id: 'one', parentId: 'left', name: 'same.svg', kind: 'file' });
	assert.equal(await retained.descriptor('absent'), null);
	await assert.rejects(retained.presentation(records[0]), /census is closed/);
	await assert.rejects(openAccountInventoryReferences(f.store, f.id, 'other-owner', f.hash(), async () => {}), /Invalid pinned reference continuation/);
	let revoked = false;
	const authorized = await openAccountInventoryReferences(f.store, f.id, 'owner', f.hash(), async () => { if (revoked) throw Error('Revoked'); });
	await authorized.descriptor('one'); revoked = true;
	await assert.rejects(authorized.descriptor('one'), /Revoked/, 'cached metadata must still enforce current authorization');
});

test('large descriptor names round-trip through bounded immutable chunks and reject corrupted bytes', async () => {
	const name = '🦄'.repeat(100000), f = await fixture([doc('large-name', ['folder'], { name })]);
	await f.finish(); const retained = await f.fresh(f.hash());
	assert.equal((await retained.descriptor('large-name'))?.name, name);
	const blobs = [...f.objects.keys()].filter(key => key.includes('/blobs/'));
	assert.ok(blobs.length > 1);
	for (const key of blobs) assert.ok(f.objects.get(key)!.byteLength <= 65536);
	// Every chunk is task-owned synthetic evidence. Corruption must fail closed,
	// never fall back to a live name or a truncated presentation.
	for (const key of blobs) f.objects.set(key, new Uint8Array(f.objects.get(key)!.length).fill(32));
	await assert.rejects(retained.descriptor('large-name'));
});

test('compressed immutable index avoids catalogue scans and preserves prior roots', async () => {
	const objects = new Map<string, Uint8Array>();
	let reads = 0;
	const store: BackupObjectStore = {
		read: async (key) => {
			reads++;
			return objects.get(key) ?? null;
		},
		put: async (key, bytes) => {
			if (objects.has(key)) assert.deepEqual(objects.get(key), bytes);
			else objects.set(key, bytes.slice());
		}
	};
	const index = immutableReferenceIndex(store, 'test', async () => {});
	let root: string | null = null,
		old: string | null = null;
	for (let n = 0; n < 1000; n++) {
		root = await index.set(root, index.key(['alias', `name-${n}`]), { id: `thing-${n}` });
		if (n === 499) old = root;
	}
	reads = 0;
	for (let n = 0; n < 1000; n++) assert.deepEqual(await index.get(root, index.key(['alias', `name-${n}`])), { id: `thing-${n}` });
	assert.ok(reads < 6000, `1000 lookups used ${reads} immutable reads`);
	assert.equal(await index.get(old, index.key(['alias', 'name-999'])), null);
	const blob = await index.blob({ large: 'x'.repeat(300000) });
	assert.ok(blob.chunks > 1);
	assert.deepEqual(await index.openBlob(blob), { large: 'x'.repeat(300000) });
});
test('fresh-worker aliases, selections, action cycles and media match canonical closure', async () => {
	const attachment = await backupAttachmentFixture('owner', 'media', Buffer.from('pinned'), 'post', 'widget'),
		value = await backupAttachmentFromDoc(attachment.doc, 'owner', Date.now(), async () => attachment.head);
	const records = [
		doc('page', ['webpage'], { blocks: [{ type: 'component', component: 'widget-name', args: { action: 'other' } }] }),
		doc('widget', ['component'], {
			componentKey: 'widget-name',
			version: 2,
			savedArgs: { action: 'action' },
			render: { tag: 'button', ttAction: '{action}', props: { backgroundImage: "url('/api/v1/attachments/content?id=media')" } }
		}),
		doc('action', ['action'], {
			steps: [
				{ op: 'things.get', id: 'data', schema: 'schema-name' },
				{ op: 'actions.invoke', action: 'other' }
			]
		}),
		doc('other', ['action'], { steps: [{ op: 'actions.invoke', action: 'action' }] }),
		doc('schema', ['schema'], { name: 'schema-name' }),
		doc('data', ['data'], { schemaId: 'schema' }),
		doc('theme', ['theme'])
	];
	const selected = { kind: 'theme', id: 'theme' },
		media = { value, durable: true },
		expected = await canonical(records, selected, media),
		f = await fixture(records, selected, media),
		pages = await f.finish();
	assert.deepEqual(pages[0].coverage, expected.coverage);
	assert.deepEqual(sorted(pages.flatMap((page) => page.issues)), sorted(expected.issues));
	assert.equal(pages[0].coverage.resolution, 'closed');
});
test('duplicate aliases, wrong-kind exact IDs, missing references and unsupported contexts match canonical evidence', async () => {
	const records = [
		doc('page', ['webpage'], { blocks: [{ type: 'component', component: 'same-name', args: { action: 'missing' } }] }),
		doc('old', ['component'], { componentKey: 'same-name', render: { ttAction: 'missing' } }),
		doc('new', ['component'], { componentKey: 'same-name', render: { ttAction: '{query.id}' } }),
		doc('same-name', ['data']),
		doc('selected', ['component'], { render: { ttAction: 'absent' } })
	];
	const selected = { kind: 'theme', id: 'missing-theme' },
		expected = await canonical(records, selected),
		f = await fixture(records, selected),
		pages = await f.finish();
	assert.deepEqual(pages[0].coverage, expected.coverage);
	assert.deepEqual(sorted(pages.flatMap((page) => page.issues)), sorted(expected.issues));
	assert.ok(expected.issues.some((issue) => issue.code === 'ambiguous-alias'));
});
test('changed-argument recursion and identical-context cycles preserve canonical ancestry semantics', async () => {
	for (const changed of [false, true]) {
		const records = [
				doc('recursive', ['webpage', 'component'], {
					render: { tag: 'div' },
					blocks: [{ type: 'component', component: 'recursive', args: changed ? { changed: true } : {} }]
				})
			],
			expected = await canonical(records),
			f = await fixture(records),
			pages = await f.finish();
		assert.deepEqual(pages[0].coverage, expected.coverage);
		assert.deepEqual(sorted(pages.flatMap((page) => page.issues)), sorted(expected.issues));
		assert.equal(pages[0].coverage.discovery, changed ? 'unsupported' : 'complete');
	}
});
test('large args, multiple evidence pages and context queues survive restart and immutable replay', async () => {
	const records = [
		doc('page', ['webpage'], {
			blocks: Array.from({ length: 700 }, (_, n) => ({
				type: 'component',
				component: 'widget',
				args: { action: `absent-${n}`, large: 'x'.repeat(n === 0 ? 150000 : 1) }
			}))
		}),
		doc('widget', ['component'], { version: 2, savedArgs: { action: 'absent-root' }, render: { ttAction: '{action}' } })
	];
	const expected = await canonical(records),
		f = await fixture(records),
		previous = f.hash(),
		first = await f.advance(),
		replay = await f.fresh(previous),
		samePage = await replay.advance(),
		sameHash = await replay.save();
	assert.deepEqual(samePage, first.page);
	assert.equal(sameHash, first.hash);
	const pages = await f.finish();
	assert.ok(pages.length > 1);
	assert.ok(pages.every((page) => page.issues.length <= 128));
	assert.deepEqual(pages[0].coverage, expected.coverage);
	assert.deepEqual(sorted(pages.flatMap((page) => page.issues)), sorted(expected.issues));
});

test('pure serialization uses cheap cancellation ticks rather than one authorization transaction per JSON token', async () => {
	const objects = new Map<string, Uint8Array>();
	let authorizations = 0,
		ticks = 0;
	const store: BackupObjectStore = {
		read: async (key) => objects.get(key) ?? null,
		put: async (key, bytes) => {
			if (objects.has(key)) assert.deepEqual(objects.get(key), bytes);
			else objects.set(key, bytes.slice());
		}
	};
	const index = immutableReferenceIndex(
		store,
		'test',
		async () => {
			authorizations++;
		},
		() => {
			ticks++;
		}
	);
	const value = { rows: Array.from({ length: 10000 }, (_, n) => ({ n, text: 'inert scalar' })) },
		blob = await index.blob(value);
	assert.ok(ticks > blob.chunks, `Expected cheap traversal checks beyond ${blob.chunks} protected writes; observed ${ticks}`);
	assert.ok(authorizations <= blob.chunks * 2 + 2, `Pure JSON used ${authorizations} protected IO guards for ${blob.chunks} chunks`);
	assert.deepEqual(await index.openBlob(blob), value);
});

test('lost bundle acknowledgement regenerates identical bounded bytes under the same accepted input identity', async () => {
	const objects = new Map<string, Uint8Array>();
	let lose = true;
	const store: BackupObjectStore = {
		read: async (key) => objects.get(key) ?? null,
		put: async (key, bytes) => {
			if (objects.has(key)) assert.deepEqual(objects.get(key), bytes);
			else objects.set(key, bytes.slice());
			if (lose && key.includes('/bundles/')) {
				lose = false;
				throw Error('Synthetic bundle acknowledgement lost');
			}
		}
	};
	const id = randomUUID(),
		records = [doc('page', ['component'], { render: { tag: 'div' } })];
	const build = async () => {
		const index = await openAccountInventoryReferences(store, id, 'owner', null, async () => {});
		for (const record of records) {
			await index.identity(record.shareId, record.thingtime);
			await index.content(record);
		}
		await index.closeCensus();
		return index.save();
	};
	await assert.rejects(build(), /acknowledgement lost/);
	const bundle = [...objects.entries()].find(([key]) => key.includes('/bundles/'))!;
	const state = await build();
	assert.equal(typeof state, 'string');
	assert.deepEqual(objects.get(bundle[0]), bundle[1]);
	const changed = bundle[1].slice();
	changed[changed.length - 1] = 0;
	objects.set(bundle[0], changed);
	const fresh = await openAccountInventoryReferences(store, id, 'owner', state, async () => {});
	await assert.rejects(fresh.advance());
});

test('reference state and bundles cannot cross owner or snapshot namespaces', async () => {
	const f = await fixture([doc('source', ['data'])]);
	await assert.rejects(
		openAccountInventoryReferences(f.store, f.id, 'foreign-owner', f.hash(), async () => {}),
		/continuation/
	);
	const originalPrefix = `snapshots/${f.id}/references`,
		foreignPrefix = `snapshots/${randomUUID()}/references`;
	const state = JSON.parse(Buffer.from(f.objects.get(`${originalPrefix}/nodes/${f.hash()}`)!).toString());
	for (const [key, bytes] of [...f.objects]) if (key.includes('/bundles/')) f.objects.set(key.replace(originalPrefix, foreignPrefix), bytes);
	const wrong = immutableReferenceIndex(f.store, foreignPrefix, async () => {});
	await assert.rejects(wrong.get(state.root, wrong.key(['identity', 'source'])), /bundle changed/);
	const own = immutableReferenceIndex(f.store, originalPrefix, async () => {}),
		valid = own.key(['identity', 'source']);
	await assert.rejects(own.get(state.root, { ...valid, encoded: 'different original key' }), /hash collision/);
});
