import { accountReadRefusals } from './accountReadRevocation';
import { validateDraftContent, validDraftId, type AccountDraft, type DraftContent } from '../drafts/draftCore';
import { LocalDrafts, type LocalDraftHooks, type StoredDraft } from './drafts';
import { accountSyncDeadline, type SyncState } from './accountSync';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import { ACCOUNT_SUITE_PARTS } from './accountSuites';

const COLLECTION = 'account-drafts';
type Command = { operation: 'save'; id: string; revision: number; writeId: string; mode: AccountDraft['mode']; content: DraftContent } |
 { operation: 'delete'; id: string; revision: number };
type State = {
 id: string; baseRevision: number | null; state: SyncState; version: number;
 pending?: { command: Command; version: number };
 claim?: { token: string; expiresAt: number }; attempts: number; retryAt: number;
 observedAt?: number; mutationAt?: number; error?: string;
};
export type AccountDraftTransport = {
 read(id: string, signal?: AbortSignal): Promise<AccountDraft>;
 write(command: Command, signal: AbortSignal): Promise<{ ok: true; draft?: AccountDraft }>;
};
export type AccountDraftHooks = Omit<LocalDraftHooks, 'changed'> & {
 /** Resolve only already confirmed file receipts, inside the snapshot transaction. */
 prepare?: (tx: WorkspaceTransaction, draft: AccountDraft) => Promise<DraftContent | null>;
};
export const validateAccountDraft = (input: AccountDraft, id = input?.id): AccountDraft => {
 let content: DraftContent;
 try { content = validateDraftContent(input); } catch { throw new WorkspaceError('INVALID_ACCOUNT_DRAFT', 'The account returned an invalid draft snapshot.', 502); }
 if (!validDraftId(input.id) || input.id !== id || !['draft','template'].includes(input.mode) ||
  !Number.isSafeInteger(input.revision) || input.revision < 1 || !Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.updatedAt)))
  throw new WorkspaceError('INVALID_ACCOUNT_DRAFT', 'The account returned an invalid draft.', 502);
 return { ...content, id: input.id, mode: input.mode, revision: input.revision, createdAt: input.createdAt, updatedAt: input.updatedAt };
};
const checked = validateAccountDraft;

/** Local draft revisions belong to the editor. Remote revisions and frozen
 * retries belong to this separate, account-scoped queue. Neither blocks posting. */
export class AccountDraftSync {
 readonly drafts: LocalDrafts;
 constructor(private db: WorkspaceDatabase, readonly scope: WorkspaceScope, private lease: WorkspaceLease,
  private hooks: AccountDraftHooks = {}, private now = () => Date.now(), private uuid = () => crypto.randomUUID()) {
  if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous drafts never synchronize.', 403);
  this.drafts = new LocalDrafts(db, scope, lease, uuid, { ...hooks, changed: (tx, row) => this.enqueue(tx, row) });
 }
 private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) { return this.db.transaction(this.scope, mode, this.lease, run); }
 private async enqueue(tx: WorkspaceTransaction, row: StoredDraft) {
  const prior = await tx.get<State>(COLLECTION, row.draft.id);
  const state: State = { id: row.draft.id, baseRevision: null, state: 'pending', attempts: 0, retryAt: 0, ...prior,
   version: row.draft.revision, mutationAt: this.now() };
  if (row.deleted && state.baseRevision === null && !state.pending) state.state = 'synced';
  else if (state.state !== 'conflict') { state.state = 'pending'; state.retryAt = 0; state.error = undefined; }
  await tx.put(COLLECTION, state.id, state);
 }
 /** Caller must first validate and prepare every account file. Admission and
  * the complete draft snapshot commit together, never an incomplete read cache. */
 async remember(remote: AccountDraft, startedAt = this.now(), localContent: DraftContent = remote, admit?: (tx: WorkspaceTransaction) => Promise<void>) {
  const draft = checked(remote), content = validateDraftContent(localContent);
  if (!Number.isFinite(startedAt) || content.context !== draft.context || content.surface !== draft.surface)
   throw new WorkspaceError('INVALID_ACCOUNT_DRAFT', 'Draft context changed while retaining it.', 409);
  return this.tx('readwrite', async tx => {
   const state = await tx.get<State>(COLLECTION, draft.id), prior = await tx.get<StoredDraft>('drafts', draft.id);
   if (prior?.deleted || (state && (state.state !== 'synced' || (state.observedAt ?? -1) > startedAt || (state.mutationAt ?? -1) >= startedAt || (state.baseRevision ?? 0) > draft.revision))) return false;
   if (content.attachmentIds.length && !admit) throw new WorkspaceError('DRAFT_FILES_INCOMPLETE', 'Save all draft files on this device before opening offline.', 409);
   if (((await accountReadRefusals(tx)).get(draft.id)?.at ?? -1) >= startedAt) throw new WorkspaceError('DRAFT_ACCESS_REFUSED', 'Draft access changed while loading. Reopen it online.', 409);
   await this.drafts.releaseFiles(tx, draft.id, content.attachmentIds);
   await admit?.(tx);
   const same = prior && JSON.stringify(validateDraftContent(prior.draft)) === JSON.stringify(content) && prior.draft.mode === draft.mode;
   const local = { ...draft, ...content, revision: same ? prior.draft.revision : (prior?.draft.revision || 0) + 1 };
   await tx.put('drafts', draft.id, { draft: local, deleted: false, writeId: same ? prior.writeId : this.uuid() } satisfies StoredDraft);
   await tx.put(COLLECTION, draft.id, { id: draft.id, baseRevision: draft.revision, state: 'synced', version: local.revision,
    observedAt: startedAt, mutationAt: state?.mutationAt, attempts: 0, retryAt: 0 } satisfies State);
   return !same;
  });
 }
 async status() {
  return this.tx('readonly', async tx => Promise.all((await tx.list<State>(COLLECTION)).map(async ({ value }) => {
   const draft = await tx.get<StoredDraft>('drafts', value.id);
   return { id: value.id, name: draft?.draft.name || 'Draft', deleted: !!draft?.deleted, state: value.state, error: value.error, retryAt: value.retryAt };
  })));
 }
 async retry(id: string) {
  return this.tx('readwrite', async tx => {
   const row = await tx.get<State>(COLLECTION, id);
   if (!row || row.state === 'synced' || (row.claim && row.claim.expiresAt > this.now())) return;
   if (row.state === 'conflict') throw new WorkspaceError('DRAFT_CONFLICT', 'Review the account draft or save an independent copy before retrying.', 409);
   await tx.put(COLLECTION, id, { ...row, state: 'pending', retryAt: 0, error: undefined });
  });
 }
 private async readRemote(transport: AccountDraftTransport, id: string) {
  this.lease.assertCurrent();
  const controller = new AbortController(), off = this.lease.onInvalidate(() => controller.abort());
  try {
   const remote = await accountSyncDeadline(signal => transport.read(id, signal), controller.signal);
   this.lease.assertCurrent(); controller.signal.throwIfAborted();
   return checked(remote, id);
  } finally { off(); }
 }
 async inspect(transport: AccountDraftTransport, id: string) {
  let remote: AccountDraft | null;
  try { remote = await this.readRemote(transport, id); } catch (error) { if (Number((error as any)?.status) !== 404) throw error; remote = null; }
  return this.tx('readonly', async tx => {
   const state = await tx.get<State>(COLLECTION, id), local = await tx.get<StoredDraft>('drafts', id);
   if (!state || !local) throw new WorkspaceError('DRAFT_MISSING', 'Device draft is unavailable.', 404);
   return { id, local: local.draft, deleted: local.deleted, localRevision: local.draft.revision, remote };
  });
 }
 /** Explicit reviewed replacement, never an automatic conflict overwrite. */
 async keepLocal(transport: AccountDraftTransport, input: { id: string; localRevision: number; remoteRevision: number }) {
  const remote = await this.readRemote(transport, input.id);
  if (remote.revision !== input.remoteRevision) throw new WorkspaceError('DRAFT_REVIEW_STALE', 'The account draft changed. Review it again.', 409);
  return this.tx('readwrite', async tx => {
   const state = await tx.get<State>(COLLECTION, input.id), local = await tx.get<StoredDraft>('drafts', input.id);
   if (!state || state.state !== 'conflict' || !local || local.draft.revision !== input.localRevision || remote.mode !== local.draft.mode)
    throw new WorkspaceError('DRAFT_REVIEW_STALE', 'The device draft changed. Review it again.', 409);
   if (remote.mode === 'template' && !local.deleted) throw new WorkspaceError('DRAFT_TEMPLATE', 'Templates stay reusable. Create an independent copy.', 409);
   await tx.put(COLLECTION, state.id, { ...state, baseRevision: remote.revision, state: 'pending', pending: undefined, claim: undefined, error: undefined, attempts: 0, retryAt: 0 });
  });
 }
 async acceptReviewed(remote: AccountDraft, localRevision:number, remoteRevision:number, startedAt:number,
  localContent:DraftContent=remote, admit?:(tx:WorkspaceTransaction)=>Promise<void>) {
  const draft=checked(remote),content=validateDraftContent(localContent);
  if(draft.revision!==remoteRevision||content.context!==draft.context||content.surface!==draft.surface||!Number.isFinite(startedAt))throw new WorkspaceError('DRAFT_REVIEW_STALE','The account draft changed. Review it again.',409);
  return this.tx('readwrite',async tx=>{
   const state=await tx.get<State>(COLLECTION,draft.id),local=await tx.get<StoredDraft>('drafts',draft.id);
   if(!state||state.state!=='conflict'||!local||local.draft.revision!==localRevision)throw new WorkspaceError('DRAFT_REVIEW_STALE','The device draft changed. Review it again.',409);
   if(((await accountReadRefusals(tx)).get(draft.id)?.at??-1)>=startedAt)throw new WorkspaceError('DRAFT_ACCESS_REFUSED','Draft access changed. Reopen it online.',409);
   if(content.attachmentIds.length&&!admit)throw new WorkspaceError('DRAFT_FILES_INCOMPLETE','Save all draft originals before replacing this device version.',409);
   await this.drafts.releaseFiles(tx,draft.id,content.attachmentIds);await admit?.(tx);
   const replacement={...draft,...content,revision:local.draft.revision+1};
   await tx.put('drafts',draft.id,{draft:replacement,writeId:this.uuid(),deleted:false} satisfies StoredDraft);
   await tx.put(COLLECTION,draft.id,{id:draft.id,baseRevision:draft.revision,version:replacement.revision,state:'synced',observedAt:startedAt,attempts:0,retryAt:0} satisfies State);
   return replacement;
  });
 }
 async sync(transport: AccountDraftTransport, signal = new AbortController().signal, max = 10) {
  let completed = 0;
  for (let n = 0; n < Math.min(20, Math.max(0, max)); n++) {
   this.lease.assertCurrent(); signal.throwIfAborted();
   const claimed = await this.tx('readwrite', async tx => {
    for (const { value: row } of await tx.list<State>(COLLECTION)) {
     if (!['pending','syncing'].includes(row.state) || row.retryAt > this.now() || (row.claim && row.claim.expiresAt > this.now())) continue;
     const local = await tx.get<StoredDraft>('drafts', row.id);
     if (!local) throw new WorkspaceError('DRAFT_MISSING', 'Queued draft content is unavailable.', 409);
     const holds=await tx.list(ACCOUNT_SUITE_PARTS);
     const frozen=row.pending?.command.operation==='save'?row.pending.command.content:local.draft;
     if(holds.some(({id})=>frozen.context.split(':').includes(id)||frozen.snapshot.includes(JSON.stringify(id))))continue;
     let pending = row.pending;
     if (!pending) {
      if (local.deleted && row.baseRevision === null) { await tx.put(COLLECTION, row.id, { ...row, state: 'synced' }); continue; }
      let command: Command;
      if (local.deleted) command = { operation: 'delete', id: row.id, revision: row.baseRevision! };
      else {
       let content: DraftContent | null;
       try { content = this.hooks.prepare ? await this.hooks.prepare(tx, local.draft) : local.draft.attachmentIds.length ? null : validateDraftContent(local.draft); }
       catch (error) {
        this.lease.assertCurrent();
        await tx.put(COLLECTION, row.id, { ...row, state: 'error', error: error instanceof Error ? error.message.slice(0, 1000) : 'Draft files are unavailable. Your local edits remain saved.' });
        continue;
       }
       if (!content) continue;
       command = { operation: 'save', id: row.id, mode: local.draft.mode, revision: row.baseRevision || 0, writeId: this.uuid(), content: validateDraftContent(content) };
      }
      pending = { command, version: local.draft.revision };
     }
     const next: State = { ...row, pending, state: 'syncing', claim: { token: this.uuid(), expiresAt: this.now() + 60_000 } };
     await tx.put(COLLECTION, row.id, next); return next;
    }
    return null;
   });
   if (!claimed) break;
   const parent = new AbortController(), abort = () => parent.abort(), off = this.lease.onInvalidate(abort);
   signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
   const { command, version } = claimed.pending!;
   try {
    const response = await accountSyncDeadline(child => transport.write(structuredClone(command), child), parent.signal);
    this.lease.assertCurrent(); parent.signal.throwIfAborted();
    let remote: AccountDraft | undefined;
    if (!response?.ok) throw new WorkspaceError('DRAFT_SYNC_RESPONSE', 'Draft synchronization was not confirmed.', 503);
    if (command.operation === 'save') {
     remote = checked(response.draft!, command.id);
     if (remote.mode !== command.mode || remote.revision !== command.revision + 1 || JSON.stringify(validateDraftContent(remote)) !== JSON.stringify(command.content))
      throw new WorkspaceError('DRAFT_SYNC_RESPONSE', 'Account draft acknowledgement did not match this save.', 503);
    }
    await this.tx('readwrite', async tx => {
     const latest = await tx.get<State>(COLLECTION, claimed.id), local = await tx.get<StoredDraft>('drafts', claimed.id);
     if (!latest || latest.claim?.token !== claimed.claim!.token || !local) throw new WorkspaceError('DRAFT_SYNC_CLAIM', 'Draft synchronization changed. Local edits remain saved.', 409);
     await tx.put(COLLECTION, latest.id, { ...latest, state: local.draft.revision === version ? 'synced' : 'pending',
      baseRevision: remote?.revision ?? command.revision + 1, pending: undefined, claim: undefined, mutationAt: this.now(), attempts: 0, retryAt: 0, error: undefined });
    });
    completed++;
   } catch (error) {
    this.lease.assertCurrent();
    await this.tx('readwrite', async tx => {
     const latest = await tx.get<State>(COLLECTION, claimed.id);
     if (!latest || latest.claim?.token !== claimed.claim!.token) return;
     const status = Number((error as any)?.status), conflict = [404,409,410].includes(status), permanent = [400,403,413,422].includes(status);
     const attempts = latest.attempts + 1;
     const retryAfter = Number((error as any)?.retryAfterMs);
     const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(86_400_000, retryAfter) : Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
     await tx.put(COLLECTION, latest.id, { ...latest, state: conflict ? 'conflict' : permanent ? 'error' : 'pending', claim: undefined,
      // Only a definitive validation rejection can release an unsent body.
      pending: permanent ? undefined : latest.pending, attempts,
      retryAt: this.now() + delay,
      error: error instanceof Error ? error.message.slice(0, 1000) : 'Account draft sync is unavailable. Your device draft is saved.' });
    });
   } finally { signal.removeEventListener('abort', abort); off(); }
  }
  return { completed };
 }
}
