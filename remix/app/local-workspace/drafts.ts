import { draftConflict, validateDraftContent, validDraftId, type AccountDraft, type DraftContent } from '../drafts/draftCore';
import { WorkspaceDatabase, WorkspaceError, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

type StoredDraft = { draft: AccountDraft; writeId: string; deleted: boolean; source?: { kind: 'template' | 'draft'; id: string } };
const fail = (status: number, message: string): never => { throw new WorkspaceError('LOCAL_DRAFT_ERROR', message, status); };
/** Shared draft content, optimistic revision and tombstone semantics. Local
 * templates are immutable sources; instantiation creates an independent draft. */
export class LocalDrafts {
	constructor(private db: WorkspaceDatabase, private scope: WorkspaceScope, private lease: WorkspaceLease) {}
	private transaction<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) { return this.db.transaction(this.scope, mode, this.lease, run); }
	private async save(tx: WorkspaceTransaction, input: { id?: unknown; writeId?: unknown; revision?: unknown; content?: unknown }, mode: 'draft' | 'template' = 'draft', source?: StoredDraft['source']) {
		if (!validDraftId(input.id) || !validDraftId(input.writeId)) return fail(400, 'A draft id and write id are required');
		const content = validateDraftContent(input.content);
		// File handling is delegated to the local attachment adapter, never cloud
		// IDs inferred from an imported snapshot or a previous account.
		for (const id of content.attachmentIds) if (!await tx.get('attachments', id)) fail(400, 'Draft attachment is not in this workspace');
		const previous = await tx.get<StoredDraft>('drafts', input.id);
		if (previous?.deleted) return fail(410, 'This draft was already discarded or published');
		if (previous && previous.draft.mode !== mode) return fail(409, 'Templates are reusable; start a new draft to edit one');
		const decision = draftConflict(previous?.draft.revision || 0, input.revision, previous?.writeId, input.writeId);
		if (decision === 'conflict') return fail(409, 'This draft changed elsewhere. Your local edits are still available.');
		if (decision === 'retry') return previous!.draft;
		const stamp = new Date().toISOString();
		const draft: AccountDraft = { ...content, id: input.id, mode, revision: (previous?.draft.revision || 0) + 1, createdAt: previous?.draft.createdAt || stamp, updatedAt: stamp };
		await tx.put('drafts', input.id, { draft, deleted: false, writeId: input.writeId, ...(source ? { source } : {}) } satisfies StoredDraft);
		return draft;
	}
	async request(input?: Record<string, unknown>, query: Record<string, string> = {}): Promise<any> {
		if (!input) return this.transaction('readonly', async tx => {
			if (query.id) {
				const row = await tx.get<StoredDraft>('drafts', query.id);
				if (!row || row.deleted) return fail(404, 'Draft not found');
				return { ok: true, draft: row.draft, attachments: [] };
			}
			let rows = (await tx.list<StoredDraft>('drafts')).map(row => row.value).filter(row => !row.deleted &&
				(!query.context || row.draft.context === query.context) && (!query.surface || row.draft.surface === query.surface))
				.sort((a, b) => b.draft.createdAt.localeCompare(a.draft.createdAt) || a.draft.id.localeCompare(b.draft.id));
			if (query.cursor) {
				const index = rows.findIndex(row => row.draft.id === query.cursor);
				if (index < 0) return fail(400, 'Draft list changed. Refresh to continue.');
				rows = rows.slice(index + 1);
			}
			return { ok: true, drafts: rows.slice(0, 30).map(({ draft: { snapshot: _snapshot, attachmentIds: _files, ...summary } }) => summary), nextCursor: rows.length > 30 ? rows[29].draft.id : null };
		});
		return this.transaction('readwrite', async tx => {
			if (input.operation === 'save') return { ok: true, draft: await this.save(tx, input) };
			if (input.operation === 'delete') {
				if (!validDraftId(input.id)) return fail(400, 'Invalid draft id');
				const previous = await tx.get<StoredDraft>('drafts', input.id);
				if (!previous) return fail(404, 'Draft not found');
				if (previous.deleted) return { ok: true };
				if (previous.draft.revision !== input.revision) return fail(409, 'Draft changed elsewhere; refresh before discarding');
				await tx.put('drafts', input.id, { ...previous, deleted: true, draft: { ...previous.draft, snapshot: '{}', attachmentIds: [] } });
				return { ok: true };
			}
			if (input.operation === 'instantiate' || input.operation === 'recover') {
				if (!validDraftId(input.id) || !validDraftId(input.sourceId) || input.id === input.sourceId) return fail(400, 'Valid distinct source and draft ids are required');
				const kind = input.operation === 'instantiate' ? 'template' : 'draft';
				const existing = await tx.get<StoredDraft>('drafts', input.id);
				if (existing && !existing.deleted) {
					if (existing.source?.kind !== kind || existing.source.id !== input.sourceId) return fail(409, 'Draft id is already in use');
					return { ok: true, draft: existing.draft };
				}
				const source = await tx.get<StoredDraft>('drafts', input.sourceId);
				if (!source || (kind === 'template' && (source.deleted || source.draft.mode !== 'template'))) return fail(404, 'Draft source not found');
				const content = kind === 'template' ? source.draft : validateDraftContent(input.content);
				if (content.attachmentIds.length) return fail(400, 'Copy draft attachments before creating the independent draft');
				return { ok: true, draft: await this.save(tx, { id: input.id, writeId: input.id, revision: 0, content }, 'draft', { kind, id: input.sourceId }) };
			}
			return fail(400, 'Unknown local draft operation');
		});
	}
	async createTemplate(id: string, content: DraftContent) { return this.transaction('readwrite', tx => this.save(tx, { id, content, writeId: id, revision: 0 }, 'template')); }
}
