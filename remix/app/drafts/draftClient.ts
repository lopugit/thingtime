import { characterDraftWorkspace } from '../local-workspace/characterDrafts.client';
import { LocalDrafts } from '../local-workspace/drafts';
import { accountWorkspaceWorker } from '../local-workspace/accountApi.client';
import { currentAccountWorkspace, anonymousWorkspaceDatabase, anonymousWorkspaceLease, LOCAL_WORKSPACE_OWNER } from '../local-workspace/runtime.client';
import type { AccountDraft, DraftSummary } from './draftCore';
import type { WorkspaceLease } from '../local-workspace/storage';
export class DraftRequestError extends Error {
 constructor(public status:number,message:string){super(message);}
}
export async function draftRequest<T = { ok:true;draft:AccountDraft }>(actor:string,input?:Record<string,unknown>,query?:Record<string,string>):Promise<T> {
 if(actor===LOCAL_WORKSPACE_OWNER)return new LocalDrafts(anonymousWorkspaceDatabase(),{kind:'anonymous'},anonymousWorkspaceLease()).request(input,query);
 const scope=currentAccountWorkspace();
 if(!scope || !actor)throw new DraftRequestError(409,'Draft account changed. Reopen this editor.');
 if(scope.ownerId!==actor)return characterDraftWorkspace(scope,actor).client.request(input,query) as Promise<T>;
 return accountWorkspaceWorker(scope).draftClient.request(input,query) as Promise<T>;
}
export const listAccountDrafts=(actor:string,query:Record<string,string>={})=>draftRequest<{drafts:DraftSummary[];nextCursor:string|null;partial?:boolean}>(actor,undefined,query);

/** Capture the editor's lease before resolving any current worker. Anonymous
 * content cannot select an account, and an old callback cannot borrow a new one. */
export function accountDraftReview(actor: string, lease: WorkspaceLease) {
 lease.assertCurrent(); const scope = currentAccountWorkspace();
 if (!scope || !actor || actor === LOCAL_WORKSPACE_OWNER) throw new DraftRequestError(409, 'Draft account changed. Reopen this editor.');
 const client = scope.ownerId === actor ? accountWorkspaceWorker(scope).draftClient : characterDraftWorkspace(scope,actor).client;
 return {
  list: async (context: string, cursor: string | null = null) => { lease.assertCurrent(); const result = await client.reviewList(context, cursor); lease.assertCurrent(); return result; },
  read: async (id: string) => { lease.assertCurrent(); const result = await client.reviewRead(id); lease.assertCurrent(); return result; }
 };
}
