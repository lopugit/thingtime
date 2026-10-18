import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { LocalDrafts } from '../local-workspace/drafts';
import { accountWorkspaceWorker } from '../local-workspace/accountApi.client';
import { accountRemoteWorkspaceLease, currentAccountWorkspace, anonymousWorkspaceDatabase, anonymousWorkspaceLease, LOCAL_WORKSPACE_OWNER } from '../local-workspace/runtime.client';
import type { AccountDraft, DraftSummary } from './draftCore';
import type { WorkspaceLease } from '../local-workspace/storage';
export class DraftRequestError extends Error {
 constructor(public status:number,message:string){super(message);}
}
export async function draftRequest<T = { ok:true;draft:AccountDraft }>(actor:string,input?:Record<string,unknown>,query?:Record<string,string>):Promise<T> {
 if(actor===LOCAL_WORKSPACE_OWNER)return new LocalDrafts(anonymousWorkspaceDatabase(),{kind:'anonymous'},anonymousWorkspaceLease()).request(input,query);
 const scope=currentAccountWorkspace();
 if(!scope || !actor)throw new DraftRequestError(409,'Draft account changed. Reopen this editor.');
 if(scope.ownerId!==actor)return delegatedDraftRequest<T>(scope,actor,input,query);
 return accountWorkspaceWorker(scope).draftClient.request(input,query) as Promise<T>;
}
export const listAccountDrafts=(actor:string,query:Record<string,string>={})=>draftRequest<{drafts:DraftSummary[];nextCursor:string|null;partial?:boolean}>(actor,undefined,query);

/** Capture the editor's lease before resolving any current worker. Anonymous
 * content cannot select an account, and an old callback cannot borrow a new one. */
export function accountDraftReview(actor: string, lease: WorkspaceLease) {
 lease.assertCurrent(); const scope = currentAccountWorkspace();
 if (!scope || scope.ownerId !== actor || actor === LOCAL_WORKSPACE_OWNER) throw new DraftRequestError(409, 'Draft account changed. Reopen this editor.');
 const client = accountWorkspaceWorker(scope).draftClient;
 return {
  list: async (context: string, cursor: string | null = null) => { lease.assertCurrent(); const result = await client.reviewList(context, cursor); lease.assertCurrent(); return result; },
  read: async (id: string) => { lease.assertCurrent(); const result = await client.reviewRead(id); lease.assertCurrent(); return result; }
 };
}

/** Server-checked delegation never opens a Character's device partition or
 * queues a write as the principal. Recovery remains scoped to principal+actor. */
async function delegatedDraftRequest<T>(scope: NonNullable<ReturnType<typeof currentAccountWorkspace>>, actor: string, input?: Record<string,unknown>, query?: Record<string,string>): Promise<T> {
 const lease = accountRemoteWorkspaceLease(scope);
 lease.assertCurrent();
 if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new DraftRequestError(503, 'Reconnect to sync this Character draft. Device recovery is kept separately.');
 await requireThingtimeCapability('api.auth-characters','1.0.0');
 await requireThingtimeCapability('api.drafts','1.1.0');
 lease.assertCurrent();
 const controller = new AbortController(), stop = lease.onInvalidate(() => controller.abort());
 try {
  const response = await fetch(`/api/v1/drafts${query ? `?${new URLSearchParams(query)}` : ''}`, {
   credentials: 'same-origin', cache: 'no-store', redirect: 'error', method: input ? 'POST' : 'GET',
   headers: {'Content-Type':'application/json', 'X-Thingtime-Expected-Actor':actor, 'X-Thingtime-Character':actor, [EXPECTED_DATA_PLANE_HEADER]:scope.dataPlane},
   ...(input ? {body:JSON.stringify({...input,expectedActor:actor})} : {}),
   signal: AbortSignal.any([controller.signal, AbortSignal.timeout(['instantiate','from-post','recover'].includes(String(input?.operation)) ? 120_000 : 20_000)])
  });
  const data = await response.json(); lease.assertCurrent();
  if (!response.ok || !data?.ok) throw new DraftRequestError(response.status, data?.error || 'Character draft request failed');
  return data;
 } finally { stop(); }
}
