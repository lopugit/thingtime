import { json } from '~/api/http';

import { actorCors, actorPat, actorUser, resolveActor } from '~/api/utils/auth/resolveActor';
import { appDataPreflight, readJsonBodyWithCors } from '~/api/utils/apps/cors';
import { createReadyAttachmentCommentInsertHook, inspectReadyAttachmentsForComment } from '~/api/utils/attachments/attachments';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { attachmentPostActorAllowed, bodyHasAttachmentIds, postBodyWithoutAttachmentIds } from '~/api/utils/attachments/postCreate';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { addComment, viewerOf, withLinkKeys } from '~/api/utils/things/things';

// POST /api/v1/things/comment — { id, text } for a simple text comment, or
// { id, type, text?, images?, listing?, thing?, tags? } for a rich comment (a
// full ["post","comment"] thing — comments share the post schema, so the post
// crystal rules apply and the response comment carries the post vocabulary).
// Rate-limited per user (admin-configurable, see the admin panel).
// App tokens comment only on things inside their namespace; the comment is
// stamped + budgeted and the returned count is namespace-fenced.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request);
  if (preflight) return preflight;

  const actor = await resolveActor(request, { thingsScope: 'things.comment' });
  if (actor instanceof Response) return actor;
  if (actor.kind === 'anonymous') {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const user = actorUser(actor)!;
  const app = actor.kind === 'app' ? actor.scope : null;
  const cors = actorCors(actor);

	const limit = await enforceRateLimit(request, 'things.comment', actor.kind === 'app' ? actor.rateIdentity : `user:${user.id}`);
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
		return json({ ok: false, error: 'You’re commenting too fast — take a breather 🌸' }, { ...init, headers: { ...init.headers, ...cors } });
  }

  // same ceiling as post creation — rich comments carry image URL lists
  const body = await readJsonBodyWithCors(request, 256 * 1024, cors);
	let bodyForComment = body || {};
	let commentOptions: Parameters<typeof addComment>[4] | undefined;
  if (bodyHasAttachmentIds(body)) {
		const attachmentIds = (body as Record<string, unknown>).attachmentIds;
		if (!Array.isArray(attachmentIds)) {
			return json({ ok: false, error: 'attachmentIds must be a list' }, { status: 400, headers: cors });
  }
		if (attachmentIds.length && (typeof (body as Record<string, unknown>).shareId !== 'string' || !(body as Record<string, unknown>).shareId)) {
			return json({ ok: false, error: 'Attachment comments require a stable shareId' }, { status: 400, headers: cors });
		}
		if (!attachmentPostActorAllowed(actor.kind, user.accountKind)) {
			return json({ ok: false, error: 'Attachments require a full user session' }, { status: 403, headers: cors });
		}
		if (!isSameOriginAttachmentRequest(request)) {
			return json({ ok: false, error: 'Cross-origin attachment requests are not allowed' }, { status: 403, headers: cors });
		}
		const mediaType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
		if (mediaType !== 'application/json') {
			return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415, headers: cors });
		}
		const inspected = await inspectReadyAttachmentsForComment(user.id, attachmentIds, (body as Record<string, unknown>).shareId);
		if (inspected.ok === false) {
			return json({ ok: false, error: inspected.error }, { status: inspected.status, headers: cors });
		}
		const ids = attachmentIds as readonly string[];
		commentOptions = {
			attachments: inspected.attachments,
			attachmentIds: ids as readonly string[],
			createHooks: {
				postAttachments: { hasAny: inspected.hasAny, hasVisual: inspected.hasVisual },
				...(ids.length ? { afterInsert: createReadyAttachmentCommentInsertHook(ids) } : {})
			}
		};
		bodyForComment = postBodyWithoutAttachmentIds(body as Record<string, unknown>);
	}
	const { id, ...rest } = bodyForComment as Record<string, unknown>;
	// body.key admits hidden-link holders to the thread their key reveals
	const result = await addComment(
		withLinkKeys(viewerOf(user, actorPat(actor)), [typeof (rest as any)?.key === 'string' ? (rest as any).key : '']),
		id,
		rest,
		app,
		commentOptions
	);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
  }
  return json({ ok: true, comment: result.comment, commentCount: result.commentCount }, { headers: cors });
};
