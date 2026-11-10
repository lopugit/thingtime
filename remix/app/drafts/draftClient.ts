import { characterDraftWorkspace } from '../local-workspace/characterDrafts.client';
import { LocalDrafts } from '../local-workspace/drafts';
import { accountWorkspaceWorker } from '../local-workspace/accountApi.client';
import { currentAccountWorkspace, anonymousWorkspaceDatabase, anonymousWorkspaceLease, LOCAL_WORKSPACE_OWNER } from '../local-workspace/runtime.client';
import type { AccountDraft, DraftSummary } from './draftCore';
import type { WorkspaceLease } from '../local-workspace/storage';
export class DraftRequestError extends Error {
 constructor(public status:number,message:string){super(message);}
}
export async function draftRequest<T = { ok: true; draft: AccountDraft }>(
	actor: string,
	input?: Record<string, unknown>,
	query?: Record<string, string>
): Promise<T> {
	if (actor === LOCAL_WORKSPACE_OWNER) return new LocalDrafts(anonymousWorkspaceDatabase(), { kind: 'anonymous' }, anonymousWorkspaceLease()).request(input, query);
	const scope = currentAccountWorkspace();
	if (scope) { if (scope.ownerId !== actor) throw new DraftRequestError(409, 'Draft account changed'); assertAccountSyncAllowed(scope); }
	await requireThingtimeCapability('api.drafts', '1.0.0');
	if (scope) assertAccountSyncAllowed(scope);
	const response = await fetch(`/api/v1/drafts${query ? `?${new URLSearchParams(query)}` : ''}`, {
		credentials: 'include',
		method: input ? 'POST' : 'GET',
		headers: { 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: actor, 'X-Thingtime-Character': actor },
		...(input ? { body: JSON.stringify({ ...input, expectedActor: actor }) } : {}),
		signal: AbortSignal.timeout(['instantiate', 'from-post', 'recover'].includes(String(input?.operation)) ? 120_000 : 20_000)
	});
	const data = await response.json();
	if (!response.ok || !data?.ok) throw new DraftRequestError(response.status, data?.error || 'Draft saving failed');
	return data;
}
