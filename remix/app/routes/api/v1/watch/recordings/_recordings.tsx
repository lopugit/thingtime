import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { resolveWatchDevice } from '~/api/utils/watch/watchPairing';
import { requestRecordingHandoff } from '~/api/utils/lopu/recordingHandoff';
import { enforceSubscriptionRateLimit } from '~/api/utils/rateLimit/subscription';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';
const headers = { 'Cache-Control': 'private, no-store' };
export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false }, { status: 405, headers });
	const unsupported = requireJsonContentType(request); if (unsupported) return unsupported;
	const context = await resolveWatchDevice(request, 'watch.things.create');
	if (!context) return json({ ok: false, error: 'Connect your Watch account.' }, { status: 401, headers });
	const limit = await enforceSubscriptionRateLimit(request, 'lopu.recordings', context.user.id);
	if (!limit.allowed) return json({ ok: false, error: 'Please wait and retry.' }, { status: limit.unavailable ? 503 : 429, headers });
	const body = await readJsonBody(request, 1024);
	if (body?.op !== 'send-to-lopu' || typeof body.postId !== 'string' || body.postId.length > 160) return json({ ok: false, error: 'Choose a recording.' }, { status: 400, headers });
	return runWithMongoEndpoint(null, async () => {
		const result = await requestRecordingHandoff(context.user.id, body.postId);
		return json(result, { status: result.ok ? 202 : result.status, headers });
	});
};
export const loader = async () => json({ ok: false }, { status: 405, headers });
