import { createHash } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import {
	ACCOUNT_RESTORE_PLAN_FORMAT, ACCOUNT_RESTORE_FAMILIES, accountRestoreDestination, parseAccountRestoreRecord,
	type AccountRestoreDestination, type AccountRestoreCoverage, type AccountRestoreFamily,
	type AccountRestoreRecord, type AccountRestoreIssue
} from '../../../backups/accountRestore';
import { BACKUP_PAGE_BYTES, BACKUP_PAGE_ITEMS, backupJson, backupId, parseBackupHeader, parseBackupSeal } from '../../../backups/manifest';
import { timelineScopeKey } from '../../../timeline/contract';
import { compositionReferences } from '../actions/sharedCompositionCore';
import { rewriteComposition } from '../actions/forkCompositionCore';
import { compositionAttachmentIds } from '../actions/compositionMediaCore';
import { renderComponentDeclaration } from '../../../components/Thingtime/renderComponentDeclaration';
import { openBackupWorkspace, type BackupWorkspaceOptions } from './backupWorkspace';
import { BACKUP_THING_CONTENT_MAX_NODES } from './thingSnapshots';
import { BACKUP_RETAINED_PAYLOAD_BYTES, openSealedBackup, type BackupAccess, type BackupObjectStore } from './portableBackup';
import { verifyBackupFileReference } from './attachmentRecords';
import { readAccountRestoreRecord } from './accountRestoreRecord';

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => backupJson(value, BACKUP_PAGE_BYTES);
const prefix = (planId: string) => {
	if (!backupId(planId)) throw Error('Invalid account restore plan identity');
	return `restore-plans/${planId}`;
};
const contracts = { plan: 1, sourceFormat: 'thingtime-backup-v1', compositionReferences: 1, writerCoordinator: null } as const;
const freshId = (planId: string, sourceId: string, destination: AccountRestoreDestination) =>
	'restore-' + digest(json({ planId, sourceId, destination }));
function guardFor(access: BackupAccess) {
	const scopeKey = timelineScopeKey(access.scope);
	return async () => {
		access.signal?.throwIfAborted();
		if (timelineScopeKey(access.scope) !== scopeKey) throw Error('Restore source account changed');
		await access.authorize();
		access.signal?.throwIfAborted();
		if (timelineScopeKey(access.scope) !== scopeKey) throw Error('Restore source account changed');
	};
}
async function write(store: BackupObjectStore, key: string, value: unknown, guard: () => Promise<void>) {
	await guard();
	const bytes = Buffer.from(json(value));
	await store.put(key, bytes);
	await guard();
	const saved = await store.read(key, BACKUP_PAGE_BYTES);
	if (!saved || !Buffer.from(saved).equals(bytes)) throw Error('Restore plan durable readback failed');
	await guard();
}
async function read(store: BackupObjectStore, key: string) {
	const bytes = await store.read(key, BACKUP_PAGE_BYTES);
	if (!bytes) throw Error('Restore plan is incomplete');
	const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	if (json(value) !== Buffer.from(bytes).toString('utf8')) throw Error('Restore plan is not canonical');
	return value;
}

/** Local/native worker only. SQLite is disposable graph preparation scratch;
 * immutable object-store pages are the sole durable reviewed plan. This never
 * calls a destination writer, grants access or replays archived receipts. */
export async function prepareAccountRestorePlan(
	source: BackupObjectStore, plans: BackupObjectStore, snapshotId: string, planId: string,
	destinationInput: AccountRestoreDestination, access: BackupAccess, options: BackupWorkspaceOptions = {}
) {
	const root = prefix(planId), guard = guardFor(access), destination = accountRestoreDestination(destinationInput);
	await guard();
	const backup = await openSealedBackup(source, snapshotId, access);
	const header = {
		format: ACCOUNT_RESTORE_PLAN_FORMAT, planId, sourceHeader: backup.header, sourceSeal: backup.seal,
		destination, contracts
	};
	const headerHash = digest(json(header));
	// Same plan ID can only resume the same source, destination and contracts.
	await write(plans, `${root}/header.json`, header, guard);
	const workspace = await openBackupWorkspace({ ...options, diskBudget: 'available' }), db = workspace.db;
	let entries = 0, dependencies = 0, issues = 0, pages = 0, previous: string | null = null;
	let pending: AccountRestoreRecord[] = [];
	const observed: Partial<Record<AccountRestoreFamily, number>> = {};
	const flush = async () => {
		if (!pending.length) return;
		const page = { format: ACCOUNT_RESTORE_PLAN_FORMAT, planId, ordinal: pages, previous, records: pending };
		await write(plans, `${root}/pages/${pages}.json`, page, guard);
		previous = digest(json(page)); pages++; pending = [];
	};
	const append = async (record: AccountRestoreRecord) => {
		if (pending.length && (pending.length === BACKUP_PAGE_ITEMS || Buffer.byteLength(json(pending)) + Buffer.byteLength(json(record)) + 1024 > BACKUP_PAGE_BYTES)) await flush();
		pending.push(record);
	};
	const issue = async (code: AccountRestoreIssue['code'], sourceId: string | null = null, reference: string | null = null) => {
		issues++; await append({ kind: 'issue', code, sourceId, reference });
	};
	try {
		db.exec(`CREATE TABLE entries(ordinal INTEGER PRIMARY KEY,sourceId TEXT UNIQUE NOT NULL,targetId TEXT UNIQUE NOT NULL,family TEXT NOT NULL,kinds TEXT NOT NULL);
			CREATE TABLE refs(sourceId TEXT NOT NULL,reference TEXT NOT NULL,kind TEXT NOT NULL,UNIQUE(sourceId,reference,kind));
			CREATE TABLE aliases(kind TEXT NOT NULL,name TEXT NOT NULL,sourceId TEXT NOT NULL,UNIQUE(kind,name,sourceId));
			CREATE INDEX reference_names ON aliases(kind,name);
			CREATE TABLE folders(sourceId TEXT PRIMARY KEY,parentId TEXT,done INTEGER NOT NULL DEFAULT 0);
			CREATE TABLE fileRefs(sourceId TEXT PRIMARY KEY,attachmentId TEXT NOT NULL,content TEXT NOT NULL);
			CREATE TABLE attachments(sourceId TEXT PRIMARY KEY,value TEXT NOT NULL);`);
		const putRef = db.prepare('INSERT OR IGNORE INTO refs(sourceId,reference,kind) VALUES (?,?,?)');
		const add = (sourceId: string, reference: unknown, kind: string) => {
			if (reference === null || reference === undefined) return;
			if (typeof reference !== 'string' || !reference) throw Error('Invalid archived dependency identity');
			putRef.run(sourceId, reference, kind);
		};
		for await (const { item, ranges } of backup.entries) {
			await guard();
			const decoded = await readAccountRestoreRecord(item, ranges, backup.header.scope.ownerId);
			const family = decoded?.family ?? 'other-managed';
			const targetId = family === 'account-content' ? destination.scope.ownerId : freshId(planId, item.thingId, destination);
			db.prepare('INSERT INTO entries VALUES (?,?,?,?,?)').run(item.ordinal, item.thingId, targetId, family, json(decoded?.kinds ?? []));
			observed[family] = (observed[family] ?? 0) + 1;
			entries++;
			await append({ kind: 'entry', sourceId: item.thingId, targetId, ordinal: item.ordinal, family, adapter: item.snapshot.adapter, version: item.snapshot.version, itemHash: digest(backupJson(item)) });
			if (!decoded) { await issue('unsupported-adapter', item.thingId); continue; }
			const { kinds, crystal, value } = decoded;
			if (family === 'ordinary') {
				add(item.thingId, value.folderId, 'folder'); add(item.thingId, value.targetId, 'thing');
				if (kinds.includes('data')) add(item.thingId, crystal.parentId, 'thing');
				for (const ref of compositionReferences(kinds, crystal)) {
					add(item.thingId, ref.ref, ref.kind);
					// Context-dependent traversal needs a future full closure adapter.
					if (ref.args) await issue('incomplete-reference-discovery', item.thingId, ref.ref);
				}
				rewriteComposition(kinds, crystal, (kind, ref) => { add(item.thingId, ref, kind); return ref; });
				for (const attachmentId of compositionAttachmentIds(kinds, crystal)) add(item.thingId, attachmentId, 'attachment');
				const renderer = renderComponentDeclaration(crystal);
				if (renderer?.kind === 'reference') add(item.thingId, renderer.id, 'component');
				if (renderer?.kind === 'invalid' || renderer?.kind === 'embedded' || kinds.some(kind => ['webpage', 'component', 'schema'].includes(kind)))
					await issue('incomplete-reference-discovery', item.thingId);
				for (const kind of ['component', 'action', 'schema']) if (kinds.includes(kind)) {
					const name = crystal[kind === 'schema' ? 'name' : kind + 'Key'];
					if (typeof name === 'string') db.prepare('INSERT OR IGNORE INTO aliases VALUES (?,?,?)').run(kind, name, item.thingId);
				}
				if (kinds.includes('folder')) db.prepare('INSERT INTO folders(sourceId,parentId) VALUES (?,?)').run(item.thingId, value.folderId ?? null);
			} else if (family === 'files') {
				add(item.thingId, value.folderId, 'folder'); add(item.thingId, value.content.attachmentId, 'attachment');
				db.prepare('INSERT INTO fileRefs VALUES (?,?,?)').run(item.thingId, value.content.attachmentId, json(value.content));
			} else if (family === 'attachments') {
				db.prepare('INSERT INTO attachments VALUES (?,?)').run(item.thingId, json(value));
				add(item.thingId, value.snapshot.value.folderId, 'folder'); add(item.thingId, value.snapshot.value.targetId, 'thing');
				if (value.linked) await issue('incomplete-reference-discovery', item.thingId);
			} else if (family === 'themes') add(item.thingId, value.folderId, 'folder');
			else if (family === 'drafts') {
				if (!value.deleted) for (const attachmentId of value.value.attachmentIds) add(item.thingId, attachmentId, 'attachment');
				await issue('incomplete-reference-discovery', item.thingId);
			} else if (family === 'account-content') {
				for (const key of ['avatarAttachmentId', 'bannerAttachmentId']) add(item.thingId, value.profile[key], 'attachment');
				add(item.thingId, value.preferences.activeThemeId, 'theme'); add(item.thingId, value.preferences.activeFeedAlgorithmId, 'feed-algorithm');
			} else await issue('incomplete-reference-discovery', item.thingId);
			if (entries % BACKUP_PAGE_ITEMS === 0) await yieldToEventLoop();
		}
		// Reuse the canonical account file/attachment closure verifier. Missing
		// attachments become explicit dependency issues below; contradictions refuse.
		const fileRefs = db.prepare(`SELECT sourceId,content,attachmentId FROM fileRefs WHERE sourceId>? ORDER BY sourceId LIMIT ${BACKUP_PAGE_ITEMS}`);
		let lastFile = '';
		for (;;) {
			await guard(); const batch = fileRefs.all(lastFile); if (!batch.length) break;
			for (const row of batch) {
				lastFile = row.sourceId as string;
				const attachment = db.prepare('SELECT value FROM attachments WHERE sourceId=?').get(row.attachmentId);
				if (attachment) verifyBackupFileReference(JSON.parse(row.content as string), lastFile, JSON.parse(attachment.value as string));
			}
			await yieldToEventLoop();
		}
		const exact = db.prepare('SELECT sourceId,targetId,kinds FROM entries WHERE sourceId=?');
		const alias = db.prepare('SELECT e.sourceId,e.targetId,e.kinds FROM aliases a JOIN entries e ON e.sourceId=a.sourceId WHERE a.kind=? AND a.name=? ORDER BY e.ordinal LIMIT 2');
		const refs = db.prepare(`SELECT rowid,sourceId,reference,kind FROM refs WHERE rowid>? ORDER BY rowid LIMIT ${BACKUP_PAGE_ITEMS}`);
		let cursor = 0;
		for (;;) {
			await guard();
			const batch = refs.all(cursor);
			if (!batch.length) break;
			for (const row of batch) {
				cursor = Number(row.rowid);
				let found = exact.get(row.reference);
				if (found && row.kind !== 'thing' && !JSON.parse(found.kinds as string).includes(row.kind)) found = undefined;
				const candidates = found ? [found] : alias.all(row.kind, row.reference);
				const resolved = candidates.length === 1 ? candidates[0] : undefined;
				dependencies++;
				await append({ kind: 'dependency', sourceId: row.sourceId as string, reference: row.reference as string, referenceKind: row.kind as string, targetSourceId: resolved?.sourceId as string ?? null, targetId: resolved?.targetId as string ?? null });
				if (!resolved) await issue(candidates.length > 1 ? 'ambiguous-dependency' : 'unavailable-dependency', row.sourceId as string, row.reference as string);
			}
			await yieldToEventLoop();
		}
		// Peel folder ancestry in bounded batches. Executable cycles remain legal.
		const ready = db.prepare(`SELECT f.sourceId FROM folders f LEFT JOIN folders p ON p.sourceId=f.parentId WHERE f.done=0 AND (p.sourceId IS NULL OR p.done=1) ORDER BY f.sourceId LIMIT ${BACKUP_PAGE_ITEMS}`);
		for (;;) {
			await guard(); const batch = ready.all(); if (!batch.length) break;
			db.exec('BEGIN'); for (const row of batch) db.prepare('UPDATE folders SET done=1 WHERE sourceId=?').run(row.sourceId); db.exec('COMMIT');
			await yieldToEventLoop();
		}
		if (db.prepare('SELECT 1 FROM folders WHERE done=0 LIMIT 1').get()) await issue('structural-cycle');
		await issue('unverified-coverage'); await issue('incomplete-reference-discovery'); await issue('writers-unavailable');
		await flush();
		const coverage: AccountRestoreCoverage = { formatVersion: 1, selection: 'whole-account', sourceCoverage: 'unknown', referenceDiscovery: 'partial', requiredFamilies: ACCOUNT_RESTORE_FAMILIES, observedFamilies: observed, sourceFormatLimitations: [{ adapter: 'thing-content|backup-thing-content', reason: 'legacy-record-json-processing-budget', maxNodes: BACKUP_THING_CONTENT_MAX_NODES, maxPayloadBytes: BACKUP_RETAINED_PAYLOAD_BYTES }], writerReadiness: 'unavailable', wholeAccountReady: false };
		const summary = { format: ACCOUNT_RESTORE_PLAN_FORMAT, planId, headerHash, pages, headHash: previous, entries, dependencies, issues, coverage, planIntegrity: 'verified' as const };
		const seal = { ...summary, reviewHash: digest(json(summary)) };
		await write(plans, `${root}/sealed.json`, seal, guard);
		return seal;
	} finally { await workspace.close(); }
}

/** Verify durable plan pages before exposing a bounded second-pass iterator.
 * A review is allocation intent only. The future writer coordinator must obtain
 * fresh destination authority and re-negotiate every required capability. */
export async function openAccountRestorePlan(
	plans: BackupObjectStore, planId: string, access: BackupAccess,
	expected: { reviewHash: string; sourceSealHash: string; destination: AccountRestoreDestination },
	options: BackupWorkspaceOptions = {}
) {
	const root = prefix(planId), guard = guardFor(access);
	await guard();
	const header = await read(plans, `${root}/header.json`), seal = await read(plans, `${root}/sealed.json`);
	parseBackupHeader(header.sourceHeader); parseBackupSeal(header.sourceSeal);
	if (Object.keys(header).sort().join(',') !== 'contracts,destination,format,planId,sourceHeader,sourceSeal' ||
		header.sourceHeader.snapshotId !== header.sourceSeal.snapshotId || header.format !== ACCOUNT_RESTORE_PLAN_FORMAT || header.planId !== planId ||
		timelineScopeKey(header.sourceHeader.scope) !== timelineScopeKey(access.scope) || json(header.contracts) !== json(contracts) ||
		json(header.destination) !== json(accountRestoreDestination(expected.destination)) || digest(json(header.sourceSeal)) !== expected.sourceSealHash ||
		seal.headerHash !== digest(json(header))) throw Error('Restore review source, destination or contracts changed');
	const { reviewHash, ...summary } = seal;
	if (reviewHash !== expected.reviewHash || digest(json(summary)) !== reviewHash || seal.format !== ACCOUNT_RESTORE_PLAN_FORMAT || seal.planId !== planId ||
		seal.planIntegrity !== 'verified' || !Number.isSafeInteger(seal.pages) || seal.pages < 1 || seal.coverage?.wholeAccountReady !== false ||
		seal.coverage?.sourceCoverage !== 'unknown' || seal.coverage?.referenceDiscovery !== 'partial' || seal.coverage?.writerReadiness !== 'unavailable') throw Error('Invalid sealed restore plan review');
	const workspace = await openBackupWorkspace({ ...options, diskBudget: 'available' });
	workspace.db.exec('CREATE TABLE pages(ordinal INTEGER PRIMARY KEY,hash TEXT NOT NULL)');
	let closed = false;
	const close = async () => { closed = true; await workspace.close(); };
	async function* records(verify = false) {
		if (closed) throw Error('Restore review is closed');
		let previous: string | null = null, entries = 0, dependencies = 0, issues = 0;
		for (let ordinal = 0; ordinal < seal.pages; ordinal++) {
			await guard(); const page = await read(plans, `${root}/pages/${ordinal}.json`);
			if (page.format !== ACCOUNT_RESTORE_PLAN_FORMAT || page.planId !== planId || page.ordinal !== ordinal || page.previous !== previous ||
				!Array.isArray(page.records) || page.records.length < 1 || page.records.length > BACKUP_PAGE_ITEMS) throw Error('Restore plan page changed');
			previous = digest(json(page));
			if (verify) workspace.db.prepare('INSERT INTO pages VALUES (?,?)').run(ordinal, previous);
			else if (workspace.db.prepare('SELECT hash FROM pages WHERE ordinal=?').get(ordinal)?.hash !== previous)
				throw Error('Restore plan page changed after review');
			for (const raw of page.records) {
				const record = parseAccountRestoreRecord(raw);
				await guard();
				if (closed) throw Error('Restore review is closed');
				if (record.kind === 'entry') { if (record.targetId !== (record.family === 'account-content' ? header.destination.scope.ownerId : freshId(planId, record.sourceId, header.destination)) || record.ordinal !== entries++) throw Error('Restore plan entry order changed'); }
				else if (record.kind === 'dependency') dependencies++;
				else if (record.kind === 'issue') issues++;
				else throw Error('Invalid restore plan record');
				yield record;
			}
		}
		await guard();
		if (previous !== seal.headHash || entries !== seal.entries || dependencies !== seal.dependencies || issues !== seal.issues) throw Error('Restore plan completeness changed');
	}
	try {
		for await (const _record of records(true)) { /* pin every verified page before exposing records */ }
		const iterate = async function* () {
			try { yield* records(); } finally { await close(); }
		};
		return { header, seal, records: iterate(), close };
	} catch (error) { await close(); throw error; }
}
