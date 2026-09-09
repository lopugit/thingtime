import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { enforceSubscriptionRateLimit } from '~/api/utils/rateLimit/subscription';
import {
	listRecordingAutomation,
	getRecordingSettings,
	queueRecordingPost,
	retryRecordingJob,
	setRecordingSettings
} from '~/api/utils/lopu/recordingsStore';
import { recordingConnectionStatus, validateRecordingConnections } from '~/api/utils/lopu/recordingsConnections';
import { parseRecordingSettingsPatch } from '~/api/utils/lopu/recordingsCore';
import { updateRecordingTodo } from '~/api/utils/lopu/recordingsReminders';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const reply = (body: unknown, status = 200) => json(body, { status, headers });

export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user || user.temporary) return reply({ ok: false, error: 'Sign in to manage your recordings.' }, 401);
	return runWithMongoEndpoint(null, async () =>
		reply({ ok: true, ownerId: user.id, ...(await listRecordingAutomation(user.id)), provider: await recordingConnectionStatus(user.id) })
	);
};

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return reply({ ok: false, error: 'Method not allowed.' }, 405);
	if (!isSameOriginAttachmentRequest(request)) return reply({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
		return reply({ ok: false, error: 'Use application/json.' }, 415);
	const user = await getCurrentUser(request);
	if (!user || user.temporary || user.accountKind !== 'user') return reply({ ok: false, error: 'Sign in to manage your recordings.' }, 401);
	const limit = await enforceSubscriptionRateLimit(request, 'lopu.recordings', user.id);
	if (limit.unavailable) return reply({ ok: false, error: 'Your account allowance is temporarily unavailable. Please retry.' }, 503);
	if (!limit.allowed) {
		const init = rateLimitedResponseInit(limit);
		const limitedHeaders = new Headers(init.headers);
		for (const [key, value] of Object.entries(headers)) limitedHeaders.set(key, value);
		return json({ ok: false, error: 'Please wait a moment and retry.' }, { ...init, headers: limitedHeaders });
	}
	const body = await readJsonBody(request, 16 * 1024);
	if (body?.op === 'settings') {
		try {
			parseRecordingSettingsPatch(body.settings);
		} catch {
			return reply({ ok: false, error: 'Choose valid recording settings, time zone and reminder hour.' }, 400);
		}
	}
	return runWithMongoEndpoint(null, async () => {
		try {
			if (body?.op === 'settings') {
				const patch = parseRecordingSettingsPatch(body.settings);
				await validateRecordingConnections(user.id, patch);
				const next = { ...await getRecordingSettings(user.id), ...patch };
				if (next.enabled && !(await recordingConnectionStatus(user.id, next)).configured)
					return reply({ ok: false, error: 'Select available API connections for transcription and notes/todos first.' }, 503);
				await setRecordingSettings(user.id, body.settings);
			} else if (body?.op === 'retry') {
				if (!(await getRecordingSettings(user.id)).enabled) return reply({ ok: false, error: 'Enable recording automation first.' }, 409);
				if (typeof body.id !== 'string' || body.id.length > 160 || !(await retryRecordingJob(user.id, body.id)))
					return reply({ ok: false, error: 'No retryable recording was found.' }, 404);
			} else if (body?.op === 'queue') {
				if (!(await getRecordingSettings(user.id)).enabled) return reply({ ok: false, error: 'Enable recording automation first.' }, 409);
				if (typeof body.postId !== 'string' || body.postId.length > 160) return reply({ ok: false, error: 'Choose a recording post.' }, 400);
				if (!(await queueRecordingPost(user.id, body.postId))) return reply({ ok: false, error: 'This post has no ready audio recording.' }, 400);
			} else if (body?.op === 'todo') {
				if (typeof body.id !== 'string' || body.id.length > 160) return reply({ ok: false, error: 'Choose a recording todo.' }, 400);
				const result = await updateRecordingTodo(user.id, body.id, body);
				if (result.ok === false) return reply(result, result.status);
			} else return reply({ ok: false, error: 'Unknown recording operation.' }, 400);
			return reply({ ok: true, ownerId: user.id, ...(await listRecordingAutomation(user.id)), provider: await recordingConnectionStatus(user.id) });
		} catch (error) {
			if (error instanceof TypeError) return reply({ ok: false, error: 'Choose your own compatible provider connections or a private Apple Watch recording post.' }, 400);
			return reply({ ok: false, error: 'Recording service is temporarily unavailable. Please retry.' }, 503);
		}
	});
};
