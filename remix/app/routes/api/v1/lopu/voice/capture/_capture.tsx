import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { enforceSubscriptionRateLimit } from '~/api/utils/rateLimit/subscription';
import { parseVoiceCapture, saveVoiceCapture } from '~/api/utils/lopu/voiceCapture';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return reply({ ok: false, error: 'Method not allowed.' }, 405);
	if (!isSameOriginAttachmentRequest(request)) return reply({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
	const unsupported = requireJsonContentType(request); if (unsupported) return unsupported;
	const user = await getCurrentUser(request);
	if (!user || user.temporary || user.accountKind !== 'user') return reply({ ok: false, error: 'Sign in to save voice transcripts.' }, 401);
	const limit = await enforceSubscriptionRateLimit(request, 'lopu.recordings', user.id);
	if (!limit.allowed) return reply({ ok: false, error: 'Voice transcript saving is temporarily unavailable. Retry shortly.' }, limit.unavailable ? 503 : 429);
	const body = await readJsonBody(request, 64 * 1024);
	if (body?.ownerId !== user.id) return reply({ ok: false, error: 'This voice transcript belongs to a different account. Switch back before retrying.' }, 409);
	let input;
	try { input = parseVoiceCapture(body); } catch (error) { return reply({ ok: false, error: (error as Error).message }, 400); }
	try {
		return await runWithMongoEndpoint(null, async () => {
			const saved = await saveVoiceCapture(user.id, input);
			return reply(saved, saved.ok === false ? saved.status : 200);
		});
	} catch { return reply({ ok: false, error: 'Could not save the voice transcript. Retry with the same event ID.' }, 503); }
};
