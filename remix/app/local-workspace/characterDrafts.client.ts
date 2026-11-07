import { validDraftId } from '../drafts/draftCore';
import { accountWorkspaceWorker } from './accountApi.client';
import { accountWorkspaceLease } from './runtime.client';
import { WorkspaceError, type WorkspaceScope } from './storage';

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;

/** Drafts, attachments and published content share the canonical worker and
 * principal/actor partition. Its independent draft pump cannot block posting. */
export function characterDraftWorkspace(principal: AccountScope, actor: string) {
 accountWorkspaceLease(principal).assertCurrent();
 if (principal.delegatedBy !== undefined || !validDraftId(actor) || actor === principal.ownerId || actor === 'local-workspace')
  throw new WorkspaceError('INVALID_CHARACTER', 'Choose a Character belonging to this account.',409);
 const scope: AccountScope = {...principal,ownerId:actor,delegatedBy:principal.ownerId};
 const worker = accountWorkspaceWorker(scope);
 return {...worker,scope,client:worker.draftClient};
}
