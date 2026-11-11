import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { resolveActor } from '~/api/utils/auth/resolveActor';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { StorageMutationError } from '~/api/utils/storage/storageCore';
import { AttachmentBindingError } from '~/api/utils/attachments/attachmentStore';
import {
	DraftError,
	getDraft,
	listDrafts,
	saveDraft,
	discardDraft,
	recoverDraft,
	instantiateTemplate,
	templateFromPost,
	draftAttachmentMetadata
} from '~/api/utils/drafts/drafts';
import { DRAFT_MAX_BYTES, validDraftId } from '~/drafts/draftCore';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' };
export function createDraftHandler(
	deps = {
		resolveActor,
		enforceRateLimit,
		getDraft,
		listDrafts,
		saveDraft,
		discardDraft,
		recoverDraft,
		instantiateTemplate,
		templateFromPost,
		draftAttachmentMetadata
	}
) {
	return async ({ request }: { request: Request }) => {
		const actor = await deps.resolveActor(request, { thingsScope: 'things.read' });
		if (actor instanceof Response) return actor;
		if (actor.kind !== 'user') return json({ ok: false, error: 'Sign in to use your account drafts' }, { status: 401, headers });
		const user = actor.user,
			method = request.method;
		if (!['GET', 'POST'].includes(method))
			return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
		const limit = await deps.enforceRateLimit(request, method === 'GET' ? 'drafts.read' : 'drafts.write', `user:${user.id}`, { failClosed: true });
		if (!limit.allowed)
			return json(
				{ ok: false, error: 'Draft saving is busy; your local changes are retained' },
				{ ...rateLimitedResponseInit(limit), headers: { ...Object.fromEntries(new Headers(rateLimitedResponseInit(limit).headers)), ...headers } }
			);
		try {
			if (method === 'GET') {
				const params = new URL(request.url).searchParams,
					id = params.get('id');
				if (id) {
					if (!validDraftId(id)) throw new DraftError(400, 'Invalid draft id');
					const draft = await deps.getDraft(user.id, id);
					return json({ ok: true, draft, attachments: await deps.draftAttachmentMetadata(user.id, id, draft.attachmentIds) }, { headers });
				}
				return json(
					{
						ok: true,
						...(await deps.listDrafts(user.id, { context: params.get('context'), surface: params.get('surface'), cursor: params.get('cursor') }))
					},
					{ headers }
				);
			}
			const invalidType = requireJsonContentType(request);
			if (invalidType) return invalidType;
			const input = await readJsonBody(request, DRAFT_MAX_BYTES * 2 + 32768);
			if (input?.expectedActor !== user.id) throw new DraftError(409, 'The active account changed; your draft stays with the original account');
			if (input.operation === 'delete') {
				await deps.discardDraft(user.id, input.id, input.revision);
				return json({ ok: true }, { headers });
			}
			const draft =
				input.operation === 'from-post'
					? await deps.templateFromPost(user, input, request.signal)
					: input.operation === 'instantiate'
					? await deps.instantiateTemplate(user.id, input, request.signal)
					: input.operation === 'recover'
					? await deps.recoverDraft(user.id, input, request.signal)
					: input.operation === 'save'
					? await deps.saveDraft(user.id, input)
					: null;
			if (!draft) throw new DraftError(400, 'Unknown draft operation');
			return json({ ok: true, draft }, { headers });
		} catch (error) {
			if (error instanceof Response) return error;
			if (error instanceof DraftError || error instanceof StorageMutationError || error instanceof AttachmentBindingError) {
				return json({ ok: false, error: error.message }, { status: error.status, headers });
			}
			if ((error as any)?.code === 11000)
				return json({ ok: false, error: 'Draft changed while saving; retry with the same draft id' }, { status: 409, headers });
			return json({ ok: false, error: 'Account draft saving is unavailable. Your local edits are retained.' }, { status: 503, headers });
		}
	};
}
export const loader = createDraftHandler();
export const action = loader;
