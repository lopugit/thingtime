import { json, readJsonBody } from '~/api/http';
import { resolveDeviceActor } from '~/api/utils/devices/deviceAuth';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { enforceSubscriptionRateLimit } from '~/api/utils/rateLimit/subscription';
import { rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { assertPersonalRecordingAuthority, PersonalRecordingUnavailable } from '~/api/utils/lopu/personalRecordingAuth';
import { parsePersonalRecordingRequest, PERSONAL_RECORDING_CAPABILITY } from '~/api/utils/lopu/personalRecordingCore';
import {
	claimPersonalRecording, completePersonalRecording, failPersonalRecording,
	heartbeatPersonalRecording, readPersonalRecordingAudio
} from '~/api/utils/lopu/personalRecordingStore';

const privateHeaders = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
const reply = (body: unknown, status = 200) => json(body, { status, headers: privateHeaders });

const handle = async (request: Request) => runWithMongoEndpoint(null, async () => {
	if (request.method !== 'GET' && request.method !== 'POST') return reply({ ok: false, error: 'Method not allowed.' }, 405);
	if (!isSameOriginAttachmentRequest(request)) return reply({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
	try {
		// No browser-cookie, admin, app or CI credentials can act as this worker.
		const actor = await resolveDeviceActor(request);
		if (!actor) return reply({ ok: false, error: 'Pair a personal Thingtime device first.' }, 401);
		if (!actor.capabilities.includes(PERSONAL_RECORDING_CAPABILITY))
			return reply({ ok: false, error: 'This device does not support personal recordings.' }, 403);
		await assertPersonalRecordingAuthority(actor);
		if (request.method === 'POST' && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
			return reply({ ok: false, error: 'Use application/json.' }, 415);
		const limit = await enforceSubscriptionRateLimit(request, 'lopu.recordings', actor.userId);
		if (limit.unavailable) return reply({ ok: false, error: 'Your account allowance is temporarily unavailable.' }, 503);
		if (!limit.allowed) {
			const init = rateLimitedResponseInit(limit);
			const headers = new Headers(init.headers);
			for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
			return json({ ok: false, error: 'Please wait before checking recordings again.' }, { ...init, headers });
		}
		if (request.method === 'GET') {
			const query = new URL(request.url).searchParams;
			const audio = await readPersonalRecordingAudio(actor, { op: 'heartbeat', jobId: query.get('jobId'), leaseId: query.get('leaseId') });
			return new Response(new Uint8Array(audio.bytes), { headers: {
				...privateHeaders, 'Content-Type': audio.type, 'Content-Length': String(audio.bytes.byteLength),
				'Content-Disposition': 'attachment; filename="recording"'
			} });
		}
		const input = parsePersonalRecordingRequest(await readJsonBody(request, 512 * 1024));
		if (input.op === 'claim') return reply(await claimPersonalRecording(actor));
		if (input.op === 'heartbeat') return reply(await heartbeatPersonalRecording(actor, input));
		if (input.op === 'failed') return reply(await failPersonalRecording(actor, input));
		return reply(await completePersonalRecording(actor, input));
	} catch (error) {
		if (error instanceof Response) {
			const headers = new Headers(error.headers);
			for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value);
			return new Response(error.body, { status: error.status, statusText: error.statusText, headers });
		}
		if (error instanceof TypeError) return reply({ ok: false, error: 'Choose a valid bounded recording operation and result.' }, 400);
		if (error instanceof PersonalRecordingUnavailable)
			return reply({ ok: false, error: 'Check your selected device, recording consent and current lease.' }, 409);
		return reply({ ok: false, error: 'The personal recording service is temporarily unavailable. Please retry.' }, 503);
	}
});

export const loader = ({ request }: { request: Request }) => handle(request);
export const action = ({ request }: { request: Request }) => handle(request);
