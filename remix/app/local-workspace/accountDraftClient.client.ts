import type { AccountDraftSync, AccountDraftTransport } from './accountDrafts';
import type { AccountDraftCatalog } from './accountDraftCatalog';
import type { AccountFileSync, AccountFileRetentionTransport } from './accountFiles';
import { accountReadRefusals, forgetAccountConversation } from './accountReadRevocation';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';
import type { StoredDraft } from './drafts';
import type { DraftSummary } from '../drafts/draftCore';

type Services = { drafts: AccountDraftSync; catalog: AccountDraftCatalog; files: AccountFileSync; db: WorkspaceDatabase; lease: WorkspaceLease;
 transport: { drafts: AccountDraftTransport & { list(query: Record<string,string>, signal?:AbortSignal): Promise<{ drafts:DraftSummary[];nextCursor:string|null }>; fromPost?(input:Record<string,unknown>):Promise<unknown> }; files: AccountFileRetentionTransport };
 wake():void; };
/** Native draft requests complete in the scoped store. Account discovery and
 * retention never enter an anonymous/unverified transport or block local saves. */
export class AccountDraftClient {
 private refreshes = new Map<string,Promise<void>>();
 private checkedAt = new Map<string,number>();
 constructor(private services: Services, private scope: Extract<WorkspaceScope,{kind:'account'}>, private online:()=>boolean, private changed:()=>void) { services.lease.assertCurrent(); }
 private tx<T>(run: Parameters<WorkspaceDatabase['transaction']>[3]) { return this.services.db.transaction(this.scope,'readonly',this.services.lease,run) as Promise<T>; }
 private ensureOnline() { this.services.lease.assertCurrent(); if (!this.online()) throw new WorkspaceError('DRAFT_OFFLINE', 'This account draft has not been saved on this device. Reconnect to load it.',503); }
 private refresh(key:string, task:()=>Promise<void>) {
  let run=this.refreshes.get(key);
  if (!run) { run=task().finally(()=>this.refreshes.delete(key));this.refreshes.set(key,run); }
  return run;
 }
 private refreshPage(query:Record<string,string>, cursor:string|null) {
  this.ensureOnline(); const filters={...(query.surface?{surface:query.surface}:{}),...(query.context?{context:query.context}:{})};
  return this.refresh('page:'+JSON.stringify([filters,cursor]),async()=>{
   const started=Date.now(), response=await this.services.transport.drafts.list({...filters,...(cursor?{cursor}:{})});
   if(await this.services.catalog.remember(filters,cursor,response,started))this.changed();
  });
 }
 private refreshDraft(id:string) {
  this.ensureOnline();
  return this.refresh('draft:'+id,async()=>{
   const started=Date.now();
   try {
    const remote=await this.services.transport.drafts.read(id);this.services.lease.assertCurrent();
    if(remote.id!==id)throw new WorkspaceError('INVALID_ACCOUNT_DRAFT','The account returned a different draft.',502);
    if(remote.attachmentIds.length) await this.services.files.retainDraft(this.services.transport.files,remote,(content,admit)=>this.services.drafts.remember(remote,started,content,admit));
    else await this.services.drafts.remember(remote,started);
    this.checkedAt.set(id,Date.now());if(this.checkedAt.size>200)this.checkedAt.delete(this.checkedAt.keys().next().value!);
    this.changed();
   } catch(error) {
    this.services.lease.assertCurrent();
    if([403,404,410].includes(Number((error as any)?.status))) {
     await this.services.db.transaction(this.scope,'readwrite',this.services.lease,tx=>forgetAccountConversation(tx,id,Date.now()));this.changed();
    }
    throw error;
   }
  });
 }
 private async load(id:string) {
  const local=await this.tx<StoredDraft|undefined>(tx=>tx.get<StoredDraft>('drafts',id));
  if(local?.deleted)throw new WorkspaceError('DRAFT_DELETED','This draft was discarded on this device.',404);
  if(!local)await this.refreshDraft(id);
  await this.tx(async tx=>{
   const refusal=(await accountReadRefusals(tx)).get(id),state=await tx.get<{observedAt?:number}>('account-drafts',id);
   if(refusal && refusal.at >= (state?.observedAt||0))throw new WorkspaceError('DRAFT_ACCESS_REFUSED','This account draft is no longer available. Your saved edits remain on this device.',409);
  });
  const result=await this.services.drafts.drafts.request(undefined,{id});
  const state=await this.tx<{state:string;baseRevision:number|null}|undefined>(tx=>tx.get('account-drafts',id));
  if(local&&state?.state==='synced'&&state.baseRevision!==null&&this.online()&&Date.now()-(this.checkedAt.get(id)||0)>30_000)void this.refreshDraft(id).catch(()=>{});
  return result;
 }
 async keepAccount(review:Awaited<ReturnType<AccountDraftSync['inspect']>>) {
  this.ensureOnline();if(!review.remote)throw new WorkspaceError('DRAFT_MISSING','The account draft no longer exists. Preserve an independent copy.',404);
  const started=Date.now(),remote=await this.services.transport.drafts.read(review.id);
  const commit=(content=remote,admit?:Parameters<AccountDraftSync['acceptReviewed']>[5])=>this.services.drafts.acceptReviewed(remote,review.localRevision,review.remote!.revision,started,content,admit);
  if(remote.attachmentIds.length)await this.services.files.retainDraft(this.services.transport.files,remote,(content,admit)=>commit({...remote,...content},admit));
  else await commit();this.services.lease.assertCurrent();this.changed();
 }
 async request(input?:Record<string,unknown>,query:Record<string,string>={}) {
  const {lease,drafts,catalog}=this.services;lease.assertCurrent();
  if(!input) {
   if(query.id)return this.load(query.id);
   let result=await catalog.list(query);
   if(result.needsPage){this.ensureOnline();await this.refreshPage(query,result.remoteCursor);result=await catalog.list(query);}
   else if(!result.cached&&!result.drafts.length&&this.online()){await this.refreshPage(query,null);result=await catalog.list(query);}
   else if(!query.cursor&&this.online()&&Date.now()-result.refreshedAt>30_000)void this.refreshPage(query,null).catch(()=>{});
   return {ok:true,drafts:result.drafts,nextCursor:result.nextCursor,partial:!result.complete};
  }
  input=structuredClone(input);
  if(input.operation==='from-post') {
   const source=await this.tx(tx=>tx.get('things',String(input!.postId)));
   if(!source) {
    this.ensureOnline();
    if(!this.services.transport.drafts.fromPost)throw new WorkspaceError('DRAFT_COPY_UNAVAILABLE','Open this post online before saving an independent template.',503);
    // Canonical copying reauthorizes shared/account-only source content and
    // creates independent files. Its caller-supplied ID makes retries stable.
    await this.services.transport.drafts.fromPost(input);lease.assertCurrent();
    await this.refreshDraft(String(input.id));
    return drafts.drafts.request(undefined,{id:String(input.id)});
   }
  }
  if(input.operation==='instantiate'||input.operation==='recover') {
   const source=await this.tx<StoredDraft|undefined>(tx=>tx.get<StoredDraft>('drafts',String(input!.sourceId)));
   if(!source)await this.load(String(input.sourceId));
  }
  if(input.operation==='delete') {
   const local=await this.tx<StoredDraft|undefined>(tx=>tx.get<StoredDraft>('drafts',String(input!.id)));
   if(!local) {
    this.ensureOnline();
    await this.load(String(input.id));
    input.revision=await this.tx(async tx=>{
     const state=await tx.get<{baseRevision:number|null}>('account-drafts',String(input!.id));
     const retained=await tx.get<StoredDraft>('drafts',String(input!.id));
     if(!retained||state?.baseRevision!==input!.revision)throw new WorkspaceError('DRAFT_CHANGED','This account draft changed. Refresh before discarding it.',409);
     return retained.draft.revision;
    });
   }
  }
  const result=await drafts.drafts.request(input,query);lease.assertCurrent();this.changed();this.services.wake();return result;
 }
}
