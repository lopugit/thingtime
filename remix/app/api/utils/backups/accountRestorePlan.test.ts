import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKUP_FORMAT, backupJson, type BackupItem } from '../../../backups/manifest';
import type { AccountRestoreDestination, AccountRestoreRecord } from '../../../backups/accountRestore';
import { openLocalBackupStore } from './localBackupStore';
import { prepareBackup, sealBackup, copySealedBackup, type BackupObjectStore } from './portableBackup';
import { retainBackupThingSnapshot } from './thingSnapshots';
import { thingContentSnapshot } from '../timeline/recordMutation';
import { prepareAccountRestorePlan, openAccountRestorePlan } from './accountRestorePlan';

const scope = { apiOrigin: 'https://backup.test', ownerId: 'owner', dataPlane: 'home' };
const access = { scope, authorize: async () => {} };
const destination: AccountRestoreDestination = { scope: { ...scope, ownerId: 'recovery-owner' }, rootId: 'recovery-folder', rootRevision: 'head-1', capabilities: { 'api.things': '1.50.0' } };
const hash = (value: unknown) => createHash('sha256').update(backupJson(value)).digest('hex');
async function fixture(count = 0, extras: BackupItem[] = []) {
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-account-restore-'));
	const source = await openLocalBackupStore(join(directory, 'source'));
	const independent = await openLocalBackupStore(join(directory, 'independent'));
	const plans = await openLocalBackupStore(join(directory, 'plans'));
	const snapshotId = randomUUID();
	const rows: any[] = [
		{ shareId: 'a-folder', thingtime: ['folder'], crystal: { name: 'Recovered' } },
		{ shareId: 'b-action', thingtime: ['action'], crystal: { actionKey: 'first', steps: [{ op: 'actions.invoke', action: 'c-action' }] } },
		{ shareId: 'c-action', thingtime: ['action'], crystal: { actionKey: 'second', steps: [{ op: 'actions.invoke', action: 'first' }] } },
		{ shareId: 'd-schema', thingtime: ['schema'], crystal: { name: 'saved-schema' } },
		{ shareId: 'e-data', thingtime: ['data'], folderId: 'a-folder', crystal: { schemaId: 'saved-schema', text: 'Saved ✨'.repeat(25_000) } },
		{ shareId: 'f-component', thingtime: ['component'], crystal: { componentKey: 'saved-component', render: { tag: 'button', ttAction: 'b-action', children: 'Restore review' } } },
		{ shareId: 'g-page', thingtime: ['webpage'], crystal: { blocks: [{ id: 'block', type: 'component', component: 'f-component' }] } }
	];
	for (let i = 0; i < count; i++) rows.push({ shareId: 'z-data-' + String(i).padStart(6, '0'), thingtime: ['data'], crystal: { value: i } });
	await writeFile(join(directory, 'live-records.json'), JSON.stringify(rows), { mode: 0o600 });
	async function* items() {
		let ordinal = 0;
		for (const row of rows) yield await retainBackupThingSnapshot(source, snapshotId, ordinal++, { ...row, ownerId: scope.ownerId }, access);
		for (const item of extras) yield { ...item, ordinal: ordinal++ };
	}
	await prepareBackup(source, { format: BACKUP_FORMAT, snapshotId, scope,
		boundary: { kind: 'point-in-time', token: 'fixture-frozen', startedAt: '2026-11-06T00:00:00.000Z', completedAt: '2026-11-06T00:00:00.000Z' },
		coverage: { selectionId: 'owned-things:owner', description: 'A generated mixed graph; prose does not establish full coverage' }
	}, items(), access);
	const sourceSeal = await sealBackup(source, snapshotId, access);
	await copySealedBackup(source, independent, snapshotId, access);
	await rm(join(directory, 'source'), { recursive: true });
	await rm(join(directory, 'live-records.json'));
	return { directory, source: independent, plans, snapshotId, sourceSeal, clean: () => rm(directory, { recursive: true, force: true }) };
}
async function collect(plan: Awaited<ReturnType<typeof openAccountRestorePlan>>) {
	const records: AccountRestoreRecord[] = [];
	try {
		for await (const record of plan.records) records.push(record);
		return records;
	} finally { await plan.close(); }
}

test('real independent sealed mixed graph survives live-source loss and plan reopen; cycles map without granting writer readiness', async () => {
	const f = await fixture();
	try {
		const planId = randomUUID();
		const sealed = await prepareAccountRestorePlan(f.source, f.plans, f.snapshotId, planId, destination, access);
		assert.equal(sealed.planIntegrity, 'verified');
		assert.equal(sealed.coverage.sourceCoverage, 'unknown');
		assert.equal(sealed.coverage.referenceDiscovery, 'partial');
		assert.deepEqual(sealed.coverage.sourceFormatLimitations, [{ adapter: 'thing-content|backup-thing-content', reason: 'legacy-record-json-processing-budget', maxNodes: 100_000, maxPayloadBytes: 128 * 1024 * 1024 }]);
		assert.equal(sealed.coverage.writerReadiness, 'unavailable');
		assert.equal(sealed.coverage.wholeAccountReady, false);
		const expected = { reviewHash: sealed.reviewHash, sourceSealHash: hash(f.sourceSeal), destination };
		const reopened = await openAccountRestorePlan(await openLocalBackupStore(join(f.directory, 'plans'), { create: false }), planId, access, expected);
		const records = await collect(reopened);
		const entries = records.filter(record => record.kind === 'entry');
		assert.equal(entries.length, 7);
		const first = entries.find(row => row.sourceId === 'b-action')!;
		const second = entries.find(row => row.sourceId === 'c-action')!;
		assert(records.some(row => row.kind === 'dependency' && row.sourceId === first.sourceId && row.targetId === second.targetId));
		assert(records.some(row => row.kind === 'dependency' && row.sourceId === second.sourceId && row.targetId === first.targetId));
		assert(!records.some(row => row.kind === 'issue' && row.code === 'structural-cycle'));
		assert(!records.some(row => row.kind === 'issue' && row.code === 'unavailable-dependency'));
		assert.equal(new Set(entries.map(row => row.targetId)).size, entries.length);
		assert(entries.every(row => row.targetId !== row.sourceId));
		assert.deepEqual(await prepareAccountRestorePlan(f.source, f.plans, f.snapshotId, planId, destination, access), sealed);
		const otherId = randomUUID();
		const other = await prepareAccountRestorePlan(f.source, f.plans, f.snapshotId, otherId, destination, access);
		const otherRecords = await collect(await openAccountRestorePlan(f.plans, otherId, access, { ...expected, reviewHash: other.reviewHash }));
		const otherEntry = otherRecords.find(row => row.kind === 'entry' && row.sourceId === 'b-action');
		assert(otherEntry?.kind === 'entry');
		assert.notEqual(otherEntry.targetId, first.targetId);
		await assert.rejects(openAccountRestorePlan(f.plans, planId, access, { ...expected, destination: { ...destination, rootRevision: 'changed-head' } }), /review/);
		await assert.rejects(openAccountRestorePlan(f.plans, planId, access, { ...expected, sourceSealHash: '0'.repeat(64) }), /review/);
		await assert.rejects(prepareAccountRestorePlan(f.source, f.plans, f.snapshotId, planId, { ...destination, rootId: 'another-folder' }, access));
	} finally { await f.clean(); }
});

test('unsupported adapters/versions and external references remain explicit admission failures', async () => {
	const f = await fixture(0, [
		{ ordinal: 0, thingId: 'w-foreign', revision: 'v1', snapshot: thingContentSnapshot({ thingtime: ['action'], crystal: { steps: [{ op: 'things.get', id: 'foreign-private' }] } }), content: null },
		{ ordinal: 0, thingId: 'x-unknown', revision: 'v1', snapshot: { adapter: 'future-managed-security', version: 1, value: {} }, content: null },
		{ ordinal: 1, thingId: 'y-future', revision: 'v2', snapshot: { adapter: 'thing-content', version: 99, value: {} }, content: null }
	]);
	try {
		const planId = randomUUID();
		const sealed = await prepareAccountRestorePlan(f.source, f.plans, f.snapshotId, planId, destination, access);
		const records = await collect(await openAccountRestorePlan(f.plans, planId, access, { reviewHash: sealed.reviewHash, sourceSealHash: hash(f.sourceSeal), destination }));
		assert.equal(records.filter(row => row.kind === 'issue' && row.code === 'unsupported-adapter').length, 2);
		assert.equal(sealed.coverage.observedFamilies['other-managed'], 2);
		assert(records.some(row => row.kind === 'issue' && row.code === 'unavailable-dependency' && row.reference === 'foreign-private'));
		assert.equal(sealed.coverage.wholeAccountReady, false);
	} finally { await f.clean(); }
});

test('accepted page interruption resumes immutable review pages without repeated inventory scans per entry', async () => {
	const f = await fixture(300);
	try {
		let interrupted = false, sourceReads = 0;
		const source: BackupObjectStore = { ...f.source, read: async (...args) => { sourceReads++; return f.source.read(...args); } };
		const plans: BackupObjectStore = { ...f.plans, put: async (key, bytes) => {
			await f.plans.put(key, bytes);
			if (!interrupted && key.endsWith('/pages/1.json')) { interrupted = true; throw Error('Lost accepted plan page'); }
		} };
		const planId = randomUUID();
		await assert.rejects(prepareAccountRestorePlan(source, plans, f.snapshotId, planId, destination, access), /Lost accepted/);
		assert.equal(await f.plans.read(`restore-plans/${planId}/sealed.json`, 131072), null);
		const retained = await f.plans.read(`restore-plans/${planId}/pages/0.json`, 4 * 1024 * 1024);
		const sealed = await prepareAccountRestorePlan(source, f.plans, f.snapshotId, planId, destination, access);
		assert.deepEqual(await f.plans.read(`restore-plans/${planId}/pages/0.json`, 4 * 1024 * 1024), retained);
		assert.equal(sealed.entries, 307);
		assert(sealed.pages >= 3);
		assert(sourceReads < 100, 'Sealed metadata traversals stay constant, not one scan per entry');
		const plan = await openAccountRestorePlan(f.plans, planId, access, { reviewHash: sealed.reviewHash, sourceSealHash: hash(f.sourceSeal), destination });
		assert.equal((await collect(plan)).filter(row => row.kind === 'entry').length, 307);
	} finally { await f.clean(); }
});

test('corrupt retained source bytes and cancelled access never publish a sealed plan', async () => {
	const f = await fixture();
	try {
		const planId = randomUUID();
		const corrupt: BackupObjectStore = { ...f.source, read: async (key, max) => {
			const value = await f.source.read(key, max);
			return key.startsWith('chunks/') && value ? Buffer.alloc(value.length) : value;
		} };
		await assert.rejects(prepareAccountRestorePlan(corrupt, f.plans, f.snapshotId, planId, destination, access));
		assert.equal(await f.plans.read(`restore-plans/${planId}/sealed.json`, 131072), null);
		const controller = new AbortController(); controller.abort();
		await assert.rejects(prepareAccountRestorePlan(f.source, f.plans, f.snapshotId, randomUUID(), destination, { ...access, signal: controller.signal }));
	} finally { await f.clean(); }
});

test('no record from a page changed between validation and iteration escapes the reviewed plan', async () => {
	const f = await fixture();
	try {
		const planId = randomUUID();
		const sealed = await prepareAccountRestorePlan(f.source, f.plans, f.snapshotId, planId, destination, access);
		let pageReads = 0, yielded = 0;
		const changed: BackupObjectStore = { ...f.plans, read: async (key, max) => {
			const bytes = await f.plans.read(key, max);
			if (key.endsWith('/pages/0.json') && ++pageReads === 2) {
				const page = JSON.parse(Buffer.from(bytes!).toString());
				page.records[0].targetId = 'unreviewed-target';
				return Buffer.from(backupJson(page));
			}
			return bytes;
		} };
		const plan = await openAccountRestorePlan(changed, planId, access, { reviewHash: sealed.reviewHash, sourceSealHash: hash(f.sourceSeal), destination });
		try {
			await assert.rejects(async () => { for await (const _row of plan.records) yielded++; }, /changed after review/);
			assert.equal(yielded, 0);
		} finally { await plan.close(); }
	} finally { await f.clean(); }
});

test('folder containment cycles are refused while executable cycles remain representable', async () => {
	const f = await fixture(0, [
		{ ordinal: 0, thingId: 'h-folder', revision: 'v1', snapshot: thingContentSnapshot({ thingtime: ['folder'], crystal: { name: 'H' }, folderId: 'i-folder' }), content: null },
		{ ordinal: 0, thingId: 'i-folder', revision: 'v1', snapshot: thingContentSnapshot({ thingtime: ['folder'], crystal: { name: 'I' }, folderId: 'h-folder' }), content: null }
	]);
	try {
		const planId = randomUUID(), sealed = await prepareAccountRestorePlan(f.source, f.plans, f.snapshotId, planId, destination, access);
		const rows = await collect(await openAccountRestorePlan(f.plans, planId, access, { reviewHash: sealed.reviewHash, sourceSealHash: hash(f.sourceSeal), destination }));
		assert(rows.some(row => row.kind === 'issue' && row.code === 'structural-cycle'));
	} finally { await f.clean(); }
});

test('canonical file closure checks owner, metadata-only descriptor and exact attachment fingerprint before sealing', async () => {
	const { backupAttachmentFixture } = await import('./attachmentRecords.fixtures');
	const { backupAttachmentFromDoc, backupAttachmentItem } = await import('./attachmentRecords');
	const { captureBackup } = await import('./portableBackup');
	for (const mode of ['valid', 'mismatch', 'inline', 'foreign']) {
		const directory = await mkdtemp(join(tmpdir(), 'thingtime-restore-file-'));
		try {
			const source = await openLocalBackupStore(join(directory, 'source')), independent = await openLocalBackupStore(join(directory, 'independent')),
				plans = await openLocalBackupStore(join(directory, 'plans')), snapshotId = randomUUID(), planId = randomUUID();
			const fixture = await backupAttachmentFixture();
			const attachment = await backupAttachmentFromDoc(fixture.doc, scope.ownerId, Date.parse('2026-11-06T00:00:00.000Z'), async () => fixture.head);
			if (mode === 'foreign') attachment.ownerId = 'foreign-owner';
			const content = { ...fixture.content, ...(mode === 'mismatch' ? { version: '0'.repeat(64) } : {}) };
			const items: BackupItem[] = [backupAttachmentItem(attachment, 0), { ordinal: 1, thingId: 'file-one', revision: 'v1',
				snapshot: { adapter: 'file-content', version: 1, value: { id: 'file-one', revision: 'v1', name: 'Recovered.bin', folderId: null, trashed: false, content } },
				content: mode === 'inline' ? { size: fixture.bytes.length, fingerprint: fixture.content.fingerprint } : null }];
			await prepareBackup(source, { format: BACKUP_FORMAT, snapshotId, scope,
				boundary: { kind: 'point-in-time', token: 'fixture-file', startedAt: '2026-11-06T00:00:00.000Z', completedAt: '2026-11-06T00:00:00.000Z' },
				coverage: { selectionId: 'owned-things:owner', description: 'File closure fixture, not full account coverage' }
			}, (async function* () { yield* items; })(), access);
			await captureBackup(source, snapshotId, { read: async (_item, at, length) => fixture.bytes.subarray(at, at + length) }, access);
			await sealBackup(source, snapshotId, access); await copySealedBackup(source, independent, snapshotId, access);
			await rm(join(directory, 'source'), { recursive: true }); fixture.bytes.fill(0);
			if (mode === 'valid') {
				const plan = await prepareAccountRestorePlan(independent, plans, snapshotId, planId, destination, access);
				assert.equal(plan.coverage.observedFamilies.files, 1); assert.equal(plan.coverage.observedFamilies.attachments, 1);
			} else {
				await assert.rejects(prepareAccountRestorePlan(independent, plans, snapshotId, planId, destination, access));
				assert.equal(await plans.read(`restore-plans/${planId}/sealed.json`, 131072), null);
			}
		} finally { await rm(directory, { recursive: true, force: true }); }
	}
});

test('review scratch closes on early break, cancellation, identity change and an unused handle', async () => {
	const f = await fixture();
	try {
		const planId = randomUUID(), sealed = await prepareAccountRestorePlan(f.source, f.plans, f.snapshotId, planId, destination, access);
		const expected = { reviewHash: sealed.reviewHash, sourceSealHash: hash(f.sourceSeal), destination };
		const scratch = join(f.directory, 'scratch'); await mkdir(scratch, { mode: 0o700 });
		const early = await openAccountRestorePlan(f.plans, planId, access, expected, { temporaryDirectory: scratch });
		assert.equal((await readdir(scratch)).length, 1);
		for await (const _record of early.records) break;
		assert.deepEqual(await readdir(scratch), []);
		await early.close();
		const unused = await openAccountRestorePlan(f.plans, planId, access, expected, { temporaryDirectory: scratch });
		await unused.close(); await unused.close();
		assert.deepEqual(await readdir(scratch), []);
		for (const mode of ['identity', 'cancel']) {
			const controller = new AbortController(), changingAccess = { ...access, scope: { ...scope }, signal: controller.signal };
			let reads = 0, yielded = 0;
			const store: BackupObjectStore = { ...f.plans, read: async (key, max) => {
				const value = await f.plans.read(key, max);
				if (key.endsWith('/pages/0.json') && ++reads === 2) {
					if (mode === 'identity') changingAccess.scope.ownerId = 'changed-owner'; else controller.abort();
				}
				return value;
			} };
			const plan = await openAccountRestorePlan(store, planId, changingAccess, expected, { temporaryDirectory: scratch });
			await assert.rejects(async () => { for await (const _row of plan.records) yielded++; });
			assert.equal(yielded, 0); assert.deepEqual(await readdir(scratch), []);
		}
	} finally { await f.clean(); }
});
