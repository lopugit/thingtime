import { LocalDrafts } from '../local-workspace/drafts';
import { accountWorkspaceWorker } from '../local-workspace/accountApi.client';
import { currentAccountWorkspace, anonymousWorkspaceDatabase, anonymousWorkspaceLease, LOCAL_WORKSPACE_OWNER } from '../local-workspace/runtime.client';
import type { AccountDraft, DraftSummary } from './draftCore';
export class DraftRequestError extends Error {
 constructor(public status:number,message:string){super(message);}
}
export async function draftRequest<T = { ok:true;draft:AccountDraft }>(actor:string,input?:Record<string,unknown>,query?:Record<string,string>):Promise<T> {
 if(actor===LOCAL_WORKSPACE_OWNER)return new LocalDrafts(anonymousWorkspaceDatabase(),{kind:'anonymous'},anonymousWorkspaceLease()).request(input,query);
 const scope=currentAccountWorkspace();
 if(!scope||scope.ownerId!==actor)throw new DraftRequestError(409,'Draft account changed. Reopen this editor.');
 return accountWorkspaceWorker(scope).draftClient.request(input,query) as Promise<T>;
}
export const listAccountDrafts=(actor:string,query:Record<string,string>={})=>draftRequest<{drafts:DraftSummary[];nextCursor:string|null;partial?:boolean}>(actor,undefined,query);
