import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import type { AccountDraft, DraftSummary } from './draftCore';
export class DraftRequestError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}
export async function draftRequest<T = { ok: true; draft: AccountDraft }>(
	actor: string,
	input?: Record<string, unknown>,
	query?: Record<string, string>
): Promise<T> {
	await requireThingtimeCapability('api.drafts', '1.0.0');
	const response = await fetch(`/api/v1/drafts${query ? `?${new URLSearchParams(query)}` : ''}`, {
		credentials: 'include',
		method: input ? 'POST' : 'GET',
		headers: { 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: actor },
		...(input ? { body: JSON.stringify({ ...input, expectedActor: actor }) } : {}),
		signal: AbortSignal.timeout(['instantiate', 'from-post', 'recover'].includes(String(input?.operation)) ? 120_000 : 20_000)
	});
	const data = await response.json();
	if (!response.ok || !data?.ok) throw new DraftRequestError(response.status, data?.error || 'Draft saving failed');
	return data;
}
export const listAccountDrafts = (actor: string, query: Record<string, string> = {}) =>
	draftRequest<{ drafts: DraftSummary[]; nextCursor: string | null }>(actor, undefined, query);
