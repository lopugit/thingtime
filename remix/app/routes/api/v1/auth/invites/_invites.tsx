import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { resolveTrustedOrigin } from '~/api/utils/auth/appOrigin';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { closeInvite, createInvite, listInvites, previewInvite } from '~/api/utils/invites/invites';
import { InviteError } from '~/api/utils/invites/inviteCore';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers });
	if (!isSameOriginAttachmentRequest(request)) return json({ ok: false, error: 'Use the same origin for invitations.' }, { status: 403, headers });
	if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json')
		return json({ ok: false, error: 'Use application/json.' }, { status: 415, headers });
	const user = await getCurrentUser(request);
	const limit = await enforceRateLimit(request, 'invites.read', user?.id || null, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Too many invite requests. Try again shortly.' }, rateLimitedResponseInit(limit));
	const body = await readJsonBody(request, 48 * 1024);
	try {
		if (body?.intent === 'preview') return json({ ok: true, invite: await previewInvite(body.token) }, { headers });
		if (!user || user.temporary || user.accountKind !== 'user')
			return json({ ok: false, error: 'Sign in to create or manage invitations.' }, { status: 401, headers });
		if (body?.intent === 'list') return json({ ok: true, invites: await listInvites(user.id) }, { headers });
		if (body?.intent === 'cancel') {
			if (typeof body.id !== 'string' || body.id.length > 100) throw new InviteError(400, 'Choose an invite to cancel.');
			await closeInvite(body.id, user.id);
			return json({ ok: true }, { headers });
		}
		if (body?.intent !== 'create') throw new InviteError(400, 'Choose create, preview, list or cancel.');
		const createLimit = await enforceRateLimit(request, 'invites.create', user.id, { failClosed: true });
		if (!createLimit.allowed) return json({ ok: false, error: 'Too many new invites. Try again later.' }, rateLimitedResponseInit(createLimit));
		const invite = await createInvite(user.id, body);
		const url = `${resolveTrustedOrigin(request.headers.get('Origin') ? new Request(request.headers.get('Origin')!) : request)}/invite#${
			invite.token
		}`;
		return json({ ok: true, invite: { id: invite.id, expiresAt: invite.expiresAt, credits: invite.credits }, url }, { headers });
	} catch (error) {
		if (error instanceof InviteError) return json({ ok: false, error: error.message }, { status: error.status, headers });
		throw error;
	}
};
