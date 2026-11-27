import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { iterateStoredCompositionReferences, type CompositionReference } from '../actions/sharedCompositionCore';
import { iterateStoredCompositionMedia } from '../actions/compositionMediaCore';
import { renderComponentDeclaration } from '../../../components/Thingtime/renderComponentDeclaration';
import { StoredReferenceUnsupportedError } from '../../../components/ComponentsLibrary/componentTemplate';
import { openBackupWorkspace, type BackupWorkspaceOptions } from './backupWorkspace';
import type { BackupAttachment } from './attachmentRecords';
import type { TimelineSnapshot } from '../../../timeline/contract';
import { createHash } from 'node:crypto';
import { canonicalJsonBytes } from '../../../utils/canonicalJsonStream';
import { BACKUP_METADATA_BYTES } from '../../../backups/manifest';

export { StoredReferenceUnsupportedError };

/** Reusable stored-only extraction for capture and reviewed restore. Explicit
 * presentation declarations extend the canonical composition vocabulary; raw
 * prose, query values and arbitrary ID-looking scalars are never scanned. */
export function* iterateBackupThingReferences(kinds: string[], crystal: Record<string, any>, options: { args?: Record<string, unknown>; signal?: AbortSignal } = {}): Generator<CompositionReference | null> {
	yield* iterateStoredCompositionReferences(kinds, crystal, options);
	const declaration = renderComponentDeclaration(crystal);
	if (declaration?.kind === 'invalid') throw new StoredReferenceUnsupportedError('Invalid explicit render Component declaration');
	if (declaration?.kind === 'reference') {
		if (declaration.id.length > 200 || /[{}$\s]/.test(declaration.id)) throw new StoredReferenceUnsupportedError('Render Component identity is outside the supported reference protocol', declaration.id);
		yield { kind: 'component', ref: declaration.id };
	}
	if (declaration?.kind === 'embedded') yield* iterateStoredCompositionReferences(['component'], declaration.component, options);
}
export function* iterateBackupThingMedia(kinds: string[], crystal: Record<string, any>, options: { args?: Record<string, unknown>; signal?: AbortSignal } = {}): Generator<string | null> {
	yield* iterateStoredCompositionMedia(kinds, crystal, options);
	const declaration = renderComponentDeclaration(crystal);
	if (declaration?.kind === 'invalid') throw new StoredReferenceUnsupportedError('Invalid explicit render Component declaration');
	if (declaration?.kind === 'embedded') yield* iterateStoredCompositionMedia(['component'], declaration.component, options);
}

/** Scratch is private and disposable. Every row comes from the caller's SAME
 * owner-authorized source snapshot. This index does no network/database reads,
 * supplies no grant and never mixes current records into pinned source state.
 * Source records and deduped component contexts live on disk; only one record
 * and one iterator ancestry are resident. Available disk, not a product item
 * limit, bounds preparation. Normal exits always remove scratch in close(). */
export type BackupReferenceIssue = { sourceId: string; code: 'unresolved-owned-or-external' | 'ambiguous-alias' | 'unsupported-traversal' | 'recursive-context' | 'excluded-authority-state'; kind: string; reference: string | null; referenceDiagnostic?: { encoding: 'utf8'; bytes: number; sha256: string } };
export type BackupReferenceCoverage = { census: 'owned-home-content'; referenceDomain: 'ordinary-composition-and-account-selections'; discovery: 'complete' | 'unsupported'; resolution: 'closed' | 'unresolved'; unresolved: number; unsupported: number; excluded: number; wholeAccountReady: false };
export const BACKUP_REFERENCE_COVERAGE_ADAPTER = 'backup-reference-coverage';
export const BACKUP_SOURCE_EXCLUSION_ADAPTER = 'backup-source-exclusion';
export function parseBackupSourceExclusion(snapshot: TimelineSnapshot): { family: string; reason: 'live-entitlement-authority' | 'live-worker-authority' | 'unsupported-managed-adapter' } {
	const value = snapshot.value as any;
	const legacy = snapshot.version === 1 && value?.family === 'subscription' && value?.reason === 'live-entitlement-authority';
	const selected = snapshot.version === 2 && value && typeof value.family === 'string' && /^[a-z][a-z0-9-]*(?:\+[a-z][a-z0-9-]*)*$/.test(value.family) &&
		(value.reason === 'unsupported-managed-adapter' || (['backup-job', 'backup-job-event'].includes(value.family) && value.reason === 'live-worker-authority'));
	if (snapshot.adapter !== BACKUP_SOURCE_EXCLUSION_ADAPTER || !value || Object.keys(value).sort().join(',') !== 'family,reason' || (!legacy && !selected)) throw Error('Invalid backup source exclusion');
	return value;
}
export type BackupReferenceEvidence = { coverage: BackupReferenceCoverage; issues: BackupReferenceIssue[]; page: number };
/** Descriptive evidence only. It supplies no ownership, executable content,
 * destination grant, backup job authority or whole-account readiness. */
export function parseBackupReferenceEvidence(snapshot: TimelineSnapshot): BackupReferenceEvidence {
	const value = snapshot.value as any, coverage = value?.coverage;
	const keys = (v: any, expected: string) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === expected;
	const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
	if (snapshot.adapter !== BACKUP_REFERENCE_COVERAGE_ADAPTER || snapshot.version !== 1 ||
		!keys(value, 'coverage,issues,page') ||
		!keys(coverage, 'census,discovery,excluded,referenceDomain,resolution,unresolved,unsupported,wholeAccountReady') ||
		coverage.census !== 'owned-home-content' || coverage.referenceDomain !== 'ordinary-composition-and-account-selections' ||
		!['complete', 'unsupported'].includes(coverage.discovery) || !['closed', 'unresolved'].includes(coverage.resolution) ||
		coverage.wholeAccountReady !== false || ![coverage.excluded, coverage.unresolved, coverage.unsupported, value.page].every(count) ||
		(coverage.discovery === 'complete') !== (coverage.unsupported === 0) ||
		(coverage.resolution === 'closed') !== (coverage.unresolved === 0) ||
		!Array.isArray(value.issues) || value.issues.length > 128) throw Error('Invalid backup reference coverage evidence');
	for (const issue of value.issues) {
		if (!(keys(issue, 'code,kind,reference,sourceId') || keys(issue, 'code,kind,reference,referenceDiagnostic,sourceId')) || typeof issue.sourceId !== 'string' || !issue.sourceId || issue.sourceId.length > 200 ||
			typeof issue.kind !== 'string' || !issue.kind || issue.kind.length > 64 ||
			!['unresolved-owned-or-external', 'ambiguous-alias', 'unsupported-traversal', 'recursive-context', 'excluded-authority-state'].includes(issue.code) ||
			(issue.reference !== null && (typeof issue.reference !== 'string' || !issue.reference || issue.reference.length > 200))) throw Error('Invalid backup dependency evidence');
		if (Object.prototype.hasOwnProperty.call(issue, 'referenceDiagnostic') && (!keys(issue.referenceDiagnostic, 'bytes,encoding,sha256') || issue.reference !== null || issue.referenceDiagnostic.encoding !== 'utf8' || !count(issue.referenceDiagnostic.bytes) || typeof issue.referenceDiagnostic.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(issue.referenceDiagnostic.sha256))) throw Error('Invalid backup reference diagnostic');
	}
	return value;
}
const contextJson = (value: unknown) => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
export async function openBackupReferenceIndex(ownerId: string, options: BackupWorkspaceOptions = {}) {
	const workspace = await openBackupWorkspace({ ...options, diskBudget: 'available' }), db = workspace.db;
	db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
		CREATE TABLE identities(id TEXT PRIMARY KEY,kinds TEXT NOT NULL);
		CREATE TABLE content(id TEXT PRIMARY KEY,kinds TEXT NOT NULL,crystal TEXT NOT NULL);
		CREATE TABLE aliases(kind TEXT NOT NULL,name TEXT NOT NULL,id TEXT NOT NULL,UNIQUE(kind,name,id));
		CREATE INDEX alias_lookup ON aliases(kind,name);
		CREATE TABLE contexts(id TEXT NOT NULL,args TEXT NOT NULL,parent INTEGER,done INTEGER NOT NULL DEFAULT 0,UNIQUE(id,args));
		CREATE INDEX pending_contexts ON contexts(done);
		CREATE TABLE selections(sourceId TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,UNIQUE(sourceId,kind,id));
		CREATE TABLE attachments(id TEXT PRIMARY KEY,value TEXT NOT NULL,durable INTEGER NOT NULL);
		CREATE TABLE issues(sourceId TEXT NOT NULL,code TEXT NOT NULL,kind TEXT NOT NULL,reference TEXT NOT NULL,diagnostic TEXT NOT NULL,UNIQUE(sourceId,code,kind,reference,diagnostic));`);
	let closed = false, coverage: BackupReferenceCoverage | null = null;
	const ensure = () => { if (closed) throw Error('Backup reference index is closed'); };
	const issue = (sourceId: string, code: BackupReferenceIssue['code'], kind: string, reference: string | null) => {
		let diagnostic = '';
		if (reference !== null && reference.length > 200) {
			const hash = createHash('sha256'); let bytes = 0;
			for (let offset = 0; offset < reference.length;) {
				let end = Math.min(reference.length, offset + 8192);
				const last = reference.charCodeAt(end - 1);
				if (end < reference.length && last >= 0xd800 && last <= 0xdbff) end--;
				const part = reference.slice(offset, end); hash.update(part, 'utf8'); bytes += Buffer.byteLength(part); offset = end;
			}
			diagnostic = JSON.stringify({ encoding: 'utf8', bytes, sha256: hash.digest('hex') }); reference = null;
		}
		db.prepare('INSERT OR IGNORE INTO issues VALUES (?,?,?,?,?)').run(sourceId, code, kind, reference ?? '', diagnostic);
	};
	const context = db.prepare('INSERT OR IGNORE INTO contexts(id,args,parent) VALUES (?,?,?)');
	const exact = db.prepare('SELECT kinds FROM identities WHERE id=?');
	const resolve = (sourceId: string, kind: string, reference: string, optional = false, exactOnly = false): string | null => {
		const found = exact.get(reference);
		if (found && JSON.parse(found.kinds as string).includes(kind)) return reference;
		if (kind !== 'data' && !exactOnly) {
			// Runtime entry points differ in their tie-break ordering (shared
			// composition uses updatedAt; direct Action execution uses createdAt).
			// Preserve every owner row, but never certify an inferred winner.
			const named = db.prepare('SELECT id FROM aliases WHERE kind=? AND name=? ORDER BY id LIMIT 2').all(kind, reference);
			if (named.length === 1) return named[0].id as string;
			if (named.length > 1) { issue(sourceId, 'ambiguous-alias', kind, reference); return null; }
		}
		if (!optional) issue(sourceId, 'unresolved-owned-or-external', kind, reference);
		return null;
	};
	return {
		addIdentity(id: string, kinds: string[]) { ensure(); db.prepare('INSERT INTO identities VALUES (?,?)').run(id, JSON.stringify(kinds)); },
		addContent(doc: { shareId: string; ownerId: string; thingtime: string[]; crystal?: any }) {
			ensure(); if (doc.ownerId !== ownerId) throw Error('Backup reference source owner changed');
			const crystal = doc.crystal ?? {};
			db.prepare('INSERT INTO content VALUES (?,?,?)').run(doc.shareId, JSON.stringify(doc.thingtime), JSON.stringify(crystal));
			context.run(doc.shareId, '{}', null);
			for (const kind of ['component', 'action', 'schema']) {
				if (!doc.thingtime.includes(kind)) continue;
				const name = crystal[kind === 'schema' ? 'name' : `${kind}Key`];
				if (typeof name === 'string') db.prepare('INSERT INTO aliases VALUES (?,?,?)').run(kind, name, doc.shareId);
			}
		},
		addSelection(sourceId: string, kind: string, id: unknown) { ensure(); if (id != null) { if (typeof id !== 'string') throw Error('Invalid backup selection reference'); db.prepare('INSERT OR IGNORE INTO selections VALUES (?,?,?)').run(sourceId, kind, id); } },
		addExcludedAuthority(sourceId: string, kind: string) { ensure(); issue(sourceId, 'excluded-authority-state', kind, null); },
		addAttachment(value: BackupAttachment, durable: boolean) { ensure(); if (value.ownerId !== ownerId) throw Error('Backup attachment owner changed'); db.prepare('INSERT INTO attachments VALUES (?,?,?)').run(value.id, JSON.stringify(value), durable ? 1 : 0); },
		async validate(check: () => Promise<void>, signal?: AbortSignal, policy: { requireOptionalReferences?: boolean; requireExactReferences?: boolean } = {}): Promise<BackupReferenceCoverage> {
			ensure(); signal?.throwIfAborted();
			let ticks = 0;
			const tick = async () => { signal?.throwIfAborted(); if (++ticks % 128 === 0) { await yieldToEventLoop(); await check(); ensure(); } };
			await check(); signal?.throwIfAborted();
			for (const row of db.prepare('SELECT sourceId,kind,id FROM selections ORDER BY sourceId,kind,id').iterate()) {
				resolve(row.sourceId as string, row.kind as string, row.id as string, false, policy.requireExactReferences); await tick();
			}
			for (;;) {
				await check(); ensure();
				const row = db.prepare('SELECT rowid,id,args FROM contexts WHERE done=0 ORDER BY rowid LIMIT 1').get();
				if (!row) break;
				const stored = db.prepare('SELECT kinds,crystal FROM content WHERE id=?').get(row.id);
				if (!stored) throw Error('Pinned backup reference source is missing');
				const kinds = JSON.parse(stored.kinds as string), crystal = JSON.parse(stored.crystal as string), args = JSON.parse(row.args as string) ?? undefined;
				try {
					for (const reference of iterateBackupThingReferences(kinds, crystal, { args, signal })) {
						await tick(); if (!reference) continue;
						const target = resolve(row.id as string, reference.kind, reference.ref, reference.optional && !policy.requireOptionalReferences, policy.requireExactReferences);
						if (target && reference.kind === 'component' && reference.args) {
							const next = contextJson(reference.args);
							if (db.prepare('SELECT 1 FROM contexts WHERE id=? AND args=?').get(target, next)) continue;
							const recursive = db.prepare(`WITH RECURSIVE ancestry(rowid,id,parent) AS (SELECT rowid,id,parent FROM contexts WHERE rowid=? UNION ALL SELECT c.rowid,c.id,c.parent FROM contexts c JOIN ancestry a ON c.rowid=a.parent) SELECT 1 FROM ancestry WHERE id=? LIMIT 1`).get(row.rowid, target);
							if (recursive) issue(row.id as string, 'recursive-context', 'component', target);
							else context.run(target, next, row.rowid);
						}
					}
					for (const attachmentId of iterateBackupThingMedia(kinds, crystal, { args, signal })) {
						await tick(); if (!attachmentId || !resolve(row.id as string, 'attachment', attachmentId)) continue;
						const attachment = db.prepare('SELECT value,durable FROM attachments WHERE id=?').get(attachmentId);
						if (!attachment || !attachment.durable) { issue(row.id as string, 'unresolved-owned-or-external', 'durable-attachment', attachmentId); continue; }
						const value: BackupAttachment = JSON.parse(attachment.value as string);
						if (value.linked || !value.snapshot.value || !(value.snapshot.value as any).targetId || !exact.get((value.snapshot.value as any).targetId)) issue(row.id as string, 'unresolved-owned-or-external', 'bound-attachment', attachmentId);
					}
				} catch (error) {
					if (!(error instanceof StoredReferenceUnsupportedError)) throw error;
					issue(row.id as string, 'unsupported-traversal', 'stored-composition', error.reference ?? null);
				}
				db.prepare('UPDATE contexts SET done=1 WHERE rowid=?').run(row.rowid);
			}
			await check(); signal?.throwIfAborted();
			const unresolved = Number(db.prepare("SELECT count(*) AS n FROM issues WHERE code IN ('unresolved-owned-or-external','ambiguous-alias')").get()!.n);
			const unsupported = Number(db.prepare("SELECT count(*) AS n FROM issues WHERE code IN ('unsupported-traversal','recursive-context')").get()!.n);
			const excluded = Number(db.prepare("SELECT count(*) AS n FROM issues WHERE code='excluded-authority-state'").get()!.n);
			coverage = { census: 'owned-home-content', referenceDomain: 'ordinary-composition-and-account-selections', discovery: unsupported ? 'unsupported' : 'complete', resolution: unresolved ? 'unresolved' : 'closed', unresolved, unsupported, excluded, wholeAccountReady: false };
			return coverage;
		},
		async *evidencePages() {
			ensure(); if (!coverage) throw Error('Backup references have not been checked');
			let cursor = 0, bytes = 2, emitted = false;
			let issues: BackupReferenceIssue[] = [];
			for (;;) {
				const rows = db.prepare('SELECT rowid,sourceId,code,kind,reference,diagnostic FROM issues WHERE rowid>? ORDER BY rowid LIMIT 128').all(cursor);
				for (const row of rows) {
					const entry: BackupReferenceIssue = { sourceId: row.sourceId as string, code: row.code as BackupReferenceIssue['code'], kind: row.kind as string, reference: row.reference === '' ? null : row.reference as string, ...(row.diagnostic ? { referenceDiagnostic: JSON.parse(row.diagnostic as string) } : {}) };
					let size = 0; for (const chunk of canonicalJsonBytes(entry)) size += chunk.length;
					if (issues.length && (issues.length === 128 || bytes + size + 1 > BACKUP_METADATA_BYTES - 2048)) { yield { coverage, issues }; emitted = true; issues = []; bytes = 2; }
					issues.push(entry); bytes += size + 1; cursor = Number(row.rowid);
				}
				if (rows.length < 128) break;
			}
			if (issues.length || !emitted) yield { coverage, issues };
		},
		hasIdentity(id: string) { ensure(); return !!exact.get(id); },
		async close() { if (closed) return; closed = true; await workspace.close(); }
	};
}
