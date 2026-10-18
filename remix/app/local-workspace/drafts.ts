import { binaryBlob, sameBinary } from './binary';
import { draftConflict, validateDraftContent, validDraftId, type AccountDraft, type DraftContent } from '../drafts/draftCore';
import { localPostProjection } from './posts';
import { postDraftFromPost, remapPostDraftAttachments } from '../drafts/postDraft';
import { toAttachmentPublicMetadata } from '../api/utils/attachments/attachmentCore';
import { isLocalAttachment, localAttachmentExpired, LOCAL_ATTACHMENT_DRAFT_MS, reapLocalAttachmentDrafts, type LocalAttachment } from './attachments';
import { LocalThings, type LocalThing } from './things';
import { type WorkspaceDatabase, WorkspaceError, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

export type StoredDraft = { draft: AccountDraft; writeId: string; deleted: boolean; source?: { kind: 'template' | 'draft' | 'post'; id: string } };
export type LocalDraftHooks = {
 readFile?: (id: string) => ReturnType<LocalThings['readFileBlob']>;
 assertFileReadable?: (tx: WorkspaceTransaction, id: string) => Promise<void>;
 copiedFile?: (tx: WorkspaceTransaction, row: LocalAttachment) => Promise<void>;
 changed?: (tx: WorkspaceTransaction, row: StoredDraft, previous?: StoredDraft) => Promise<void>;
};
type PreparedFiles = Map<string, Awaited<ReturnType<LocalThings['readFileBlob']>>>;
const fail = (status: number, message: string): never => { throw new WorkspaceError('LOCAL_DRAFT_ERROR', message, status); };
/** Canonical draft snapshots and revision/tombstone semantics. Metadata, media
 * binding, byte copies and quota accounting commit together in the scoped store. */
export class LocalDrafts {
 constructor(private db: WorkspaceDatabase, private scope: WorkspaceScope, private lease: WorkspaceLease, private uuid = () => crypto.randomUUID(), private hooks: LocalDraftHooks = {}) {}
 private transaction<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) { return this.db.transaction(this.scope, mode, this.lease, run); }
 private async prepare(content: DraftContent): Promise<PreparedFiles> {
  const files: PreparedFiles = new Map();
  const things = new LocalThings(this.db, this.scope, this.lease);
  for (const id of content.attachmentIds) {
   try { files.set(id, await (this.hooks.readFile ? this.hooks.readFile(id) : things.readFileBlob(id))); }
   catch { this.lease.assertCurrent(); return fail(400, 'Draft attachment is not in this workspace or its bytes are unavailable'); }
  }
  return files;
 }
 private async file(tx: WorkspaceTransaction, id: string, prepared: PreparedFiles) {
  const expected = prepared.get(id), row = await tx.get<LocalThing>('things', id), snapshot = await tx.getBinary(id);
  // The asynchronous checksum ran before the IDB transaction. Recheck exact
  // metadata and the storage revision in IDB; never await Blob I/O there.
  if (!expected || !row || !isLocalAttachment(row) || localAttachmentExpired(row) || JSON.stringify(row) !== JSON.stringify(expected.row) || !sameBinary(snapshot, expected.snapshot)) return fail(409, 'Draft attachment changed. Retry with the current files.');
  await this.hooks.assertFileReadable?.(tx, id);
  return { row, snapshot: snapshot!, blob: binaryBlob(snapshot!.value) };
 }
 async releaseFiles(tx: WorkspaceTransaction, draftId: string, kept: string[]) {
  for (const { value: row } of await tx.list<LocalThing>('things')) if (isLocalAttachment(row) && row.localAttachment.draftId === draftId && !kept.includes(row.id)) {
   const next = { ...row, localAttachment: { ...row.localAttachment } };
   delete next.localAttachment.draftId;
   if (!row.targetId) next.localAttachment.expiresAt = new Date(Date.now() + LOCAL_ATTACHMENT_DRAFT_MS).toISOString();
   await tx.put('things', row.id, next);
  }
 }
 private async copy(tx: WorkspaceTransaction, source: DraftContent, prepared: PreparedFiles) {
  const mapping = new Map<string, string>(), files: PreparedFiles = new Map();
  for (const sourceId of source.attachmentIds) {
   const { row, blob } = await this.file(tx, sourceId, prepared);
   const id = `local-file-${this.uuid()}`, stamp = new Date().toISOString();
   const copy: LocalAttachment = { id, thingtime: ['attachment'], crystal: { ...row.crystal }, createdAt: stamp, updatedAt: stamp, revision: 1,
    localAttachment: { ...(this.scope.kind === 'account' ? { requestId: this.uuid() } : {}), purpose: source.surface === 'comment' ? 'comment' : 'post', sha256: row.localAttachment.sha256, order: mapping.size, expiresAt: new Date(Date.now() + LOCAL_ATTACHMENT_DRAFT_MS).toISOString() } };
   await tx.put('things', id, copy); await tx.putBlob(id, blob);
   await this.hooks.copiedFile?.(tx, copy);
   mapping.set(sourceId, id); files.set(id, { row: copy, blob, snapshot: (await tx.getBinary(id))! });
  }
  return { content: { ...source, attachmentIds: [...mapping.values()], snapshot: remapPostDraftAttachments(source.snapshot, mapping) }, files };
 }
 private async save(tx: WorkspaceTransaction, input: { id?: unknown; writeId?: unknown; revision?: unknown; content?: unknown }, prepared: PreparedFiles, mode: 'draft' | 'template' = 'draft', source?: StoredDraft['source']) {
  if (!validDraftId(input.id) || !validDraftId(input.writeId)) return fail(400, 'A draft id and write id are required');
  const content = validateDraftContent(input.content), previous = await tx.get<StoredDraft>('drafts', input.id);
  if (previous?.deleted) return fail(410, 'This draft was already discarded or published');
  if (previous && previous.draft.mode !== mode) return fail(409, 'Templates are reusable; start a new draft to edit one');
  const decision = draftConflict(previous?.draft.revision || 0, input.revision, previous?.writeId, input.writeId);
  if (decision === 'conflict') return fail(409, 'This draft changed elsewhere. Your local edits are still available.');
  if (decision === 'retry') return previous!.draft;
  for (const [order, id] of content.attachmentIds.entries()) {
   const { row } = await this.file(tx, id, prepared);
   const purpose = content.surface === 'comment' ? 'comment' : 'post';
   if (row.targetId || row.localAttachment.purpose !== purpose || (row.localAttachment.draftId && row.localAttachment.draftId !== input.id)) return fail(409, 'Draft files belong to another Thing or draft. Create an independent copy.');
   const next = { ...row, localAttachment: { ...row.localAttachment, draftId: input.id, order } };
   delete next.localAttachment.expiresAt;
   await tx.put('things', id, next);
  }
  await this.releaseFiles(tx, input.id, content.attachmentIds);
  const stamp = new Date().toISOString();
  const draft: AccountDraft = { ...content, id: input.id, mode, revision: (previous?.draft.revision || 0) + 1, createdAt: previous?.draft.createdAt || stamp, updatedAt: stamp };
  const stored: StoredDraft = { draft, deleted: false, writeId: input.writeId, ...(source ? { source } : {}) };
  await tx.put('drafts', input.id, stored);
  await this.hooks.changed?.(tx, stored, previous || undefined);
  return draft;
 }
 async request(input?: Record<string, unknown>, query: Record<string, string> = {}): Promise<any> {
  this.lease.assertCurrent();
  if (!input) return this.transaction('readonly', async tx => {
   if (query.id) {
    const row = await tx.get<StoredDraft>('drafts', query.id);
    if (!row || row.deleted) return fail(404, 'Draft not found');
    const attachments = [];
    for (const id of row.draft.attachmentIds) {
     const file = await tx.get<LocalThing>('things', id);
     if (!file || !isLocalAttachment(file) || file.localAttachment.draftId !== row.draft.id) return fail(409, 'Draft files are unavailable. Recover an independent copy before editing.');
     const metadata = toAttachmentPublicMetadata(file.id, file.crystal);
     if (!metadata) return fail(400, 'Invalid local attachment metadata');
     attachments.push(metadata);
    }
    return { ok: true, draft: row.draft, attachments };
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
  input = JSON.parse(JSON.stringify(input));
  if (input.operation === 'from-post') {
   if (!validDraftId(input.id) || !validDraftId(input.postId) || (input.name !== undefined && typeof input.name !== 'string')) return fail(400, 'Valid template and post ids are required');
   const things = new LocalThings(this.db, this.scope, this.lease), row = await things.get(input.postId);
   if (!row.thingtime.includes('post')) return fail(400, 'Select a local post');
   const post = localPostProjection(row, await things.snapshot(), 'local-workspace');
   const draft = await this.createTemplate(input.id, { name: String(input.name || post.title || post.text || 'Post template').slice(0,160), surface: 'post', context: 'post:new:', snapshot: JSON.stringify(postDraftFromPost(post)), attachmentIds: post.attachments.map(file => file.id) }, { kind: 'post', id: input.postId });
   return { ok: true, draft };
  }
  let content: DraftContent | undefined;
  if (input.operation === 'save' || input.operation === 'recover') content = validateDraftContent(input.content);
  if (input.operation === 'instantiate') {
   if (!validDraftId(input.sourceId)) return fail(400, 'Invalid source id');
   const source = await this.transaction('readonly', tx => tx.get<StoredDraft>('drafts', input!.sourceId as string));
   if (source && !source.deleted && source.draft.mode === 'template') content = source.draft;
  }
  // Exact retry success does not depend on bytes subsequently donated to a post.
  if (validDraftId(input.id)) {
   const existing = await this.transaction('readonly', tx => tx.get<StoredDraft>('drafts', input!.id as string));
   if (existing && input.operation === 'instantiate' && input.context !== undefined && existing.draft.context !== input.context) return fail(409, 'This template copy belongs to another editor context.');
   if (existing && !existing.deleted && ((input.operation === 'save' && existing.draft.mode === 'draft' && existing.writeId === input.writeId) ||
    ((input.operation === 'instantiate' || input.operation === 'recover') && existing.source?.id === input.sourceId && existing.source.kind === (input.operation === 'instantiate' ? 'template' : 'draft')))) return { ok: true, draft: existing.draft };
  }
  const prepared = content ? await this.prepare(content) : new Map();
  return this.transaction('readwrite', async tx => {
   await reapLocalAttachmentDrafts(tx);
   if (input!.operation === 'save') return { ok: true, draft: await this.save(tx, input!, prepared) };
   if (input!.operation === 'delete') {
    if (!validDraftId(input!.id)) return fail(400, 'Invalid draft id');
    const previous = await tx.get<StoredDraft>('drafts', input!.id);
    if (!previous) return fail(404, 'Draft not found');
    if (previous.deleted) return { ok: true };
    if (previous.draft.revision !== input!.revision) return fail(409, 'Draft changed elsewhere; refresh before discarding');
    await this.releaseFiles(tx, input!.id, []);
    const stored: StoredDraft = { ...previous, deleted: true, draft: { ...previous.draft, revision: previous.draft.revision + 1, snapshot: '{}', attachmentIds: [] } };
    await tx.put('drafts', input!.id, stored);
    await this.hooks.changed?.(tx, stored, previous);
    return { ok: true };
   }
   if (input!.operation === 'instantiate' || input!.operation === 'recover') {
    if (!validDraftId(input!.id) || !validDraftId(input!.sourceId) || input!.id === input!.sourceId) return fail(400, 'Valid distinct source and draft ids are required');
    const kind = input!.operation === 'instantiate' ? 'template' : 'draft';
    const existing = await tx.get<StoredDraft>('drafts', input!.id);
    if (existing) {
     if (existing.deleted) return fail(410, 'This draft was already discarded or published');
     if (existing.source?.kind !== kind || existing.source.id !== input!.sourceId) return fail(409, 'Draft id is already in use');
     if (input!.operation === 'instantiate' && input!.context !== undefined && existing.draft.context !== input!.context) return fail(409, 'This template copy belongs to another editor context.');
     return { ok: true, draft: existing.draft };
    }
    const source = await tx.get<StoredDraft>('drafts', input!.sourceId);
    if (input!.sourceRevision !== undefined && source?.draft.revision !== input!.sourceRevision) return fail(409, 'The source draft changed. Review it again.');
    if (!source || (kind === 'template' && (source.deleted || source.draft.mode !== 'template'))) return fail(404, 'Draft source not found');
    if (kind === 'template' && JSON.stringify(content) !== JSON.stringify(source.draft)) return fail(409, 'Template changed. Retry with its current contents.');
    const destination = input!.operation === 'instantiate' && input!.context !== undefined
     ? validateDraftContent({ ...content, context: input!.context }) : content!;
    if (input!.operation === 'instantiate' && input!.context !== undefined && JSON.parse(destination.snapshot).pendingSubmission) return fail(409, 'This template contains an unfinished submission. Recover it in its original workspace.');
    const copied = await this.copy(tx, destination, prepared);
    return { ok: true, draft: await this.save(tx, { id: input!.id, writeId: input!.id, revision: 0, content: copied.content }, copied.files, 'draft', { kind, id: input!.sourceId }) };
   }
   return fail(400, 'Unknown local draft operation');
  });
 }
 async createTemplate(id: string, input: DraftContent, source?: StoredDraft['source']) {
  const content = validateDraftContent(input), prepared = await this.prepare(content);
  return this.transaction('readwrite', async tx => {
   const existing = await tx.get<StoredDraft>('drafts', id);
   if (existing) { if (JSON.stringify(existing.source) !== JSON.stringify(source)) return fail(409, 'Template id is already in use'); return this.save(tx, { id, content, writeId: id, revision: 0 }, prepared, 'template', source); }
   const copied = await this.copy(tx, content, prepared);
   return this.save(tx, { id, content: copied.content, writeId: id, revision: 0 }, copied.files, 'template', source);
  });
 }
}
