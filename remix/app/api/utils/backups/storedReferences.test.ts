import assert from 'node:assert/strict';
import test from 'node:test';
import { iterateBackupThingReferences, iterateBackupThingMedia, openBackupReferenceIndex, StoredReferenceUnsupportedError } from './storedReferences';
import { compositionReferences } from '../actions/sharedCompositionCore';
import { compositionAttachmentIds } from '../actions/compositionMediaCore';
import { backupAttachmentFixture } from './attachmentRecords.fixtures';
import { backupAttachmentFromDoc } from './attachmentRecords';
import { parseBackupItem, nextBackupCoveragePage } from '../../../backups/manifest';
import { sanitizeShareId } from '../things/things';
import { readAccountRestoreRecord } from './accountRestoreRecord';

const refs = (kinds: string[], crystal: any) => [...iterateBackupThingReferences(kinds, crystal)].filter(Boolean);
const media = (kinds: string[], crystal: any) => [...iterateBackupThingMedia(kinds, crystal)].filter(Boolean);
const doc = (id: string, kinds: string[], crystal: any = {}) => ({ shareId: id, ownerId: 'owner', thingtime: kinds, crystal });

test('worker traversal exceeds renderer node/depth/instance policies without changing renderer policy', () => {
	const render: any = { children: Array.from({ length: 5001 }, (_, index) => ({ tag: 'img', ttAction: `action-${index}`, props: { src: `/api/v1/attachments/content?id=media-${index}` } })) };
	const crystal = { render };
	assert.equal(refs(['component'], crystal).length, 5001);
	assert.equal(media(['component'], crystal).length, 5001);
	assert.ok(compositionReferences(['component'], crystal).length < 5001);
	assert.ok(compositionAttachmentIds(['component'], crystal).size < 5001);
	let deep: any = { ttAction: 'deep-action', props: { src: '/api/v1/attachments/content?id=deep-media' } };
	for (let n = 0; n < 80; n++) deep = { children: [deep] };
	assert.deepEqual(refs(['component'], { render: deep }).map((ref: any) => ref.ref), ['deep-action']);
	assert.deepEqual(media(['component'], { render: deep }), ['deep-media']);
	assert.equal(refs(['component'], { render: { ttRepeat: { count: 700, node: { ttAction: 'repeat-{index}' } } } }).length, 700);
});

test('only executable/render positions create dependencies and dynamic/unsupported formats refuse', () => {
	const crystal = { schemaId: 'schema-owned', note: 'another-id', props: { src: '/api/v1/attachments/content?id=ignored' }, renderComponent: { id: 'explicit-component' } };
	assert.deepEqual(refs(['data'], crystal).map((ref: any) => [ref.kind, ref.ref]), [['schema', 'schema-owned'], ['component', 'explicit-component']]);
	assert.deepEqual(media(['data'], crystal), []);
	assert.throws(() => refs(['component'], { render: { ttAction: '{query.id}' } }), StoredReferenceUnsupportedError);
	assert.throws(() => refs(['component'], { render: { ttMerge: [{ ttAction: 'one' }] } }), StoredReferenceUnsupportedError);
	assert.throws(() => media(['component'], { render: { tag: 'img', props: { src: { ttArg: 'query.image' } } } }), StoredReferenceUnsupportedError);
	const cyclic: any = {}; cyclic.children = [cyclic];
	assert.throws(() => refs(['component'], { render: cyclic }), /Cyclic/);
});

test('HTML, CSS, inactive branches and copied bindings retain stored media past preview budgets', () => {
	const html = Array.from({ length: 2500 }, (_, n) => `<img src="/api/v1/attachments/content?id=html-${n}">`).join('');
	assert.equal(media(['webpage'], { blocks: [{ type: 'html', html }] }).length, 2500);
	const css = Array.from({ length: 2500 }, (_, n) => `url('/api/v1/attachments/content?id=css-${n}')`).join(',');
	assert.equal(media(['webpage'], { blocks: [{ type: 'element', props: { backgroundImage: css } }] }).length, 2500);
	assert.deepEqual(media(['component'], { render: { ttIf: { then: { props: { src: '/api/v1/attachments/content?id=yes' } }, else: { props: { src: '/api/v1/attachments/content?id=no' } } } } }), ['yes', 'no']);
});

test('disk-backed owner closure supports alias precedence, action cycles and more than 512 persisted contexts', async () => {
	const index = await openBackupReferenceIndex('owner');
	try {
		const records = [doc('page', ['webpage'], { blocks: Array.from({ length: 700 }, (_, n) => ({ type: 'component', component: 'widget', args: { action: `action-${n}` } })) }), doc('widget-old', ['component'], { componentKey: 'widget', version: 1, render: { ttAction: 'not-selected' } }), doc('widget-new', ['component'], { componentKey: 'widget', version: 2, render: { ttAction: '{action}' }, savedArgs: { action: 'action-0' } }), ...Array.from({ length: 700 }, (_, n) => doc(`action-${n}`, ['action'], { actionKey: `action-${n}`, steps: [{ op: 'actions.invoke', action: `action-${(n + 1) % 700}` }] })), doc('not-selected', ['action'])];
		for (const record of records) { index.addIdentity(record.shareId, record.thingtime); index.addContent(record); }
		let checks = 0;
		const coverage = await index.validate(async () => { checks++; });
		assert.equal(coverage.resolution, 'unresolved');
		const evidence = []; for await (const page of index.evidencePages()) evidence.push(...page.issues);
		assert.ok(evidence.some(issue => issue.code === 'ambiguous-alias'));
		assert.ok(checks > 10);
	} finally { await index.close(); }
});

test('owned closure distinguishes uncaptured external dependencies and selection gaps from corruption', async () => {
	for (const type of ['missing', 'foreign', 'system', 'active-theme']) {
		const index = await openBackupReferenceIndex('owner');
		try {
			index.addIdentity('root', ['component']);
			index.addContent(doc('root', ['component'], { render: { ttAction: type } }));
			if (type === 'active-theme') index.addSelection('owner', 'theme', 'external-theme');
			const coverage = await index.validate(async () => {});
			assert.equal(coverage.resolution, 'unresolved');
			assert.equal(coverage.wholeAccountReady, false);
			assert.throws(() => index.addContent({ ...doc('foreign', ['component']), ownerId: 'foreign' }), /owner changed/);
		} finally { await index.close(); }
	}
});

test('pinned owner media verifies captured attachment binding and cancellation removes scratch', async () => {
	const fixture = await backupAttachmentFixture('owner', 'media', Buffer.from('pinned media'), 'post', 'root');
	const attachment = await backupAttachmentFromDoc(fixture.doc, 'owner', Date.now(), async () => fixture.head);
	const index = await openBackupReferenceIndex('owner');
	try {
		index.addIdentity('root', ['component']); index.addIdentity('media', ['attachment']);
		index.addContent(doc('root', ['component'], { render: { tag: 'img', props: { src: '/api/v1/attachments/content?id=media' } } }));
		index.addAttachment(attachment, true);
		await index.validate(async () => {});
		const abort = new AbortController(); abort.abort();
		await assert.rejects(index.validate(async () => {}, abort.signal), /abort/i);
	} finally { await index.close(); }
	assert.throws(() => index.addIdentity('later', ['data']), /closed/);
});

test('semantic context recursion is finite, while identical-context component cycles terminate', async () => {
	for (const changed of [false, true]) {
		const index = await openBackupReferenceIndex('owner');
		try {
			index.addIdentity('recursive', ['webpage', 'component']);
			index.addContent(doc('recursive', ['webpage', 'component'], { render: { tag: 'div' }, blocks: [{ type: 'component', component: 'recursive', args: changed ? { changed: true } : {} }] }));
			const coverage = await index.validate(async () => {});
			assert.equal(coverage.discovery, changed ? 'unsupported' : 'complete');
		} finally { await index.close(); }
	}
});

test('reserved evidence is snapshot/page-bound, excluded from source IDs and invalid for other adapters', () => {
	const snapshotId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
	const make = (page: number) => ({ ordinal: page, thingId: `~.backup-coverage:${snapshotId}:${String(page).padStart(16, '0')}`, revision: 'evidence', snapshot: { adapter: 'backup-reference-coverage', version: 1, value: { page } }, content: null });
	const item = parseBackupItem(make(0));
	assert.throws(() => parseBackupItem({ ...make(0), thingId: [make(0).thingId] }), /item/);
	assert.throws(() => parseBackupItem({ ...make(0), thingId: { toString: () => make(0).thingId } }), /item|metadata|json/i);
	assert.equal((sanitizeShareId(item.thingId) as any).ok, false);
	assert.equal(nextBackupCoveragePage(item, snapshotId, 0), 1);
	assert.throws(() => nextBackupCoveragePage(item, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 0), /identity|sequence/);
	assert.throws(() => nextBackupCoveragePage(item, snapshotId, 1), /identity|sequence/);
	assert.throws(() => nextBackupCoveragePage(parseBackupItem(make(1)), snapshotId, 0), /identity|sequence/);
	assert.throws(() => parseBackupItem({ ...make(0), snapshot: { adapter: 'thing-content', version: 1, value: {} } }), /item/);
});

test('unresolved evidence stays paged when references exceed one metadata page', async () => {
	const index = await openBackupReferenceIndex('owner');
	try {
		index.addIdentity('many', ['component']);
		index.addContent(doc('many', ['component'], { render: { children: Array.from({ length: 401 }, (_, n) => ({ ttAction: `absent-${n}` })) } }));
		const coverage = await index.validate(async () => {});
		assert.equal(coverage.unresolved, 401); assert.equal(coverage.discovery, 'complete');
		let pages = 0, count = 0;
		for await (const page of index.evidencePages()) { assert.ok(page.issues.length <= 128); pages++; count += page.issues.length; }
		assert.equal(pages, 4); assert.equal(count, 401);
	} finally { await index.close(); }
});

test('archive coverage and authority exclusions are descriptive restore records, never executable user content', async () => {
	const index = await openBackupReferenceIndex('owner');
	try {
		index.addIdentity('subscription', ['subscription']); index.addExcludedAuthority('subscription', 'subscription');
		const coverage = await index.validate(async () => {});
		assert.equal(coverage.excluded, 1); assert.equal(coverage.wholeAccountReady, false);
		const evidence = (await index.evidencePages().next()).value!;
		const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const item = parseBackupItem({ ordinal: 0, thingId: `~.backup-coverage:${id}:0000000000000000`, revision: 'source-evidence', snapshot: { adapter: 'backup-reference-coverage', version: 1, value: { ...evidence, page: 0 } }, content: null });
		const noBytes = async function* () { yield await Promise.reject<{ read(): Promise<Uint8Array> }>(Error('Descriptive metadata has no content bytes')); };
		assert.equal((await readAccountRestoreRecord(item, noBytes(), 'owner'))?.family, 'source-coverage');
		const exclusion = { ...item, thingId: 'subscription', snapshot: { adapter: 'backup-source-exclusion', version: 1, value: { family: 'subscription', reason: 'live-entitlement-authority' } } };
		assert.equal((await readAccountRestoreRecord(exclusion, noBytes(), 'owner'))?.family, 'source-exclusion');
		await assert.rejects(readAccountRestoreRecord({ ...exclusion, snapshot: { ...exclusion.snapshot, value: { ...exclusion.snapshot.value, authority: 'replay-me' } } }, noBytes(), 'owner'), /exclusion/);
	} finally { await index.close(); }
});
