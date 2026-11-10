import { DRAFT_SURFACES, validDraftId, type DraftSummary } from '../drafts/draftCore';
import type { StoredDraft } from './drafts';
import { accountReadRefusals } from './accountReadRevocation';
import { workspaceScopeKey, WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

const COLLECTION = 'account-draft-pages', PREFIX = 'workspace-drafts:';
type Filters = { surface?: string; context?: string };
type Page = { key: string; cursor: string | null; drafts: DraftSummary[]; nextCursor: string | null; at: number };
type Cursor = { key: string; before: { createdAt: string; id: string }; remote: string | null; generation: number };
const invalid = () => new WorkspaceError('DRAFT_LIST_INVALID', 'Draft list changed or returned invalid data. Refresh the list.', 409);
const summary = (input: any): DraftSummary => {
 if (!input || !validDraftId(input.id) || !['draft','template'].includes(input.mode) || !DRAFT_SURFACES.includes(input.surface) ||
  typeof input.name !== 'string' || input.name.length > 160 || typeof input.context !== 'string' || input.context.length > 300 ||
  !Number.isSafeInteger(input.revision) || input.revision < 1 || !Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.updatedAt))) throw invalid();
 return { id: input.id, mode: input.mode, surface: input.surface, name: input.name, context: input.context, revision: input.revision, createdAt: input.createdAt, updatedAt: input.updatedAt };
};
const compare = (a: {createdAt:string;id:string}, b: {createdAt:string;id:string}) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
export function validateDraftSummaryPage(query: Filters, cursor: string | null, result: { drafts: DraftSummary[]; nextCursor: string | null }) {
 if ((query.surface && !DRAFT_SURFACES.includes(query.surface as any)) || (query.context && query.context.length > 300) ||
  (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 256)) ||
  !Array.isArray(result?.drafts) || result.drafts.length > 30 ||
  (result.nextCursor !== null && (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor.length > 256 || result.nextCursor === cursor))) throw invalid();
 const drafts = result.drafts.map(summary);
 if (new Set(drafts.map(row=>row.id)).size !== drafts.length || drafts.some(row => (query.context && query.context !== row.context) || (query.surface && query.surface !== row.surface))) throw invalid();
 return { drafts, nextCursor: result.nextCursor };
}
const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2,'0')).join('');
/** Bounded summary pages are discovery only. No body, bytes or editable ownership
 * is inferred until the exact canonical draft and its originals are retained. */
export class AccountDraftCatalog {
 constructor(private db: WorkspaceDatabase, private scope: WorkspaceScope, private lease: WorkspaceLease) {
  if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous drafts never query an account.', 403);
 }
 private key(query: Filters) {
  if ((query.surface && !DRAFT_SURFACES.includes(query.surface as any)) || (query.context && query.context.length > 300)) throw invalid();
  return JSON.stringify([workspaceScopeKey(this.scope), query.surface || '', query.context || '']);
 }
 private cursor(query: Filters & {cursor?:string}): Cursor | null {
  if (!query.cursor) return null;
  try {
   if (query.cursor.length > 4096 || !query.cursor.startsWith(PREFIX)) throw invalid();
   const value: Cursor = JSON.parse(query.cursor.slice(PREFIX.length));
   if (value.key !== this.key(query) || !validDraftId(value.before.id) || !Number.isFinite(Date.parse(value.before.createdAt)) || !Number.isFinite(value.generation) || (value.remote !== null && (typeof value.remote !== 'string' || value.remote.length > 256))) throw invalid();
   return value;
  } catch { throw invalid(); }
 }
 async remember(query: Filters, cursor: string | null, result: { drafts: DraftSummary[]; nextCursor: string | null }, startedAt: number) {
  const key = this.key(query), id = await digest(JSON.stringify([key,cursor]));
  if (!Number.isFinite(startedAt)) throw invalid();
  const { drafts } = validateDraftSummaryPage(query, cursor, result);
  return this.db.transaction(this.scope, 'readwrite', this.lease, async tx => {
   const pages = await tx.list<Page>(COLLECTION), previous = pages.find(row => row.id === id)?.value;
   if ((previous?.at ?? -1) > startedAt) return false;
   const first = pages.find(row => row.value.key === key && row.value.cursor === null)?.value;
   if (cursor && (!first || first.at > startedAt)) return false;
   // Refreshing page one invalidates its older continuation chain, not bodies.
   if (!cursor) for (const row of pages) if (row.value.key === key && row.value.cursor) await tx.delete(COLLECTION, row.id);
   const left = (await tx.list<Page>(COLLECTION)).filter(row => row.id !== id).sort((a,b)=>a.value.at-b.value.at);
   while (left.length >= 64) await tx.delete(COLLECTION, left.shift()!.id);
   await tx.put(COLLECTION, id, { key, cursor, drafts, nextCursor: result.nextCursor, at: startedAt } satisfies Page);
   return JSON.stringify(previous?.drafts) !== JSON.stringify(drafts) || previous?.nextCursor !== result.nextCursor;
  });
 }
 async list(query: Filters & { cursor?: string } = {}) {
  const key = this.key(query), continuation = this.cursor(query);
  return this.db.transaction(this.scope, 'readonly', this.lease, async tx => {
   const pages = (await tx.list<Page>(COLLECTION)).map(row=>row.value).filter(row=>row.key===key), first = pages.find(row=>row.cursor===null);
   if (continuation && continuation.generation !== (first?.at || 0)) throw invalid();
   const rows = new Map<string,DraftSummary>(), refusals = await accountReadRefusals(tx);
   const chain = new Set<string>(); let current = first, remote: string | null = null;
   while (current) {
    for (const row of current.drafts) if ((refusals.get(row.id)?.at ?? -1) < current.at) rows.set(row.id,row);
    remote = current.nextCursor;
    if (!remote) break;
    if (chain.has(remote)) throw invalid(); chain.add(remote);
    const next=remote; current = pages.find(row=>row.cursor===next);
   }
   const states=new Map((await tx.list<{observedAt?:number}>('account-drafts')).map(row=>[row.id,row.value]));
   for (const { value: row } of await tx.list<StoredDraft>('drafts')) {
    if (row.deleted || (refusals.get(row.draft.id)?.at ?? -1) >= (states.get(row.draft.id)?.observedAt ?? 0)) { rows.delete(row.draft.id); continue; }
    if ((!query.context || row.draft.context === query.context) && (!query.surface || row.draft.surface === query.surface)) rows.set(row.draft.id, summary(row.draft));
   }
   const available = [...rows.values()].sort(compare).filter(row=>!continuation || compare(row,continuation.before)>0), page = available.slice(0,30);
   const before = page.length ? { id: page.at(-1)!.id, createdAt: page.at(-1)!.createdAt } : continuation?.before;
   const nextCursor = before && (available.length > 30 || remote) ? PREFIX + JSON.stringify({ key, before, remote, generation:first?.at||0 } satisfies Cursor) : null;
   return { drafts:page, nextCursor, remoteCursor:remote, cached:!!first, refreshedAt:first?.at||0,
    needsPage:!!continuation && page.length === 0 && !!remote, complete:!!first && !remote };
  });
 }
}
