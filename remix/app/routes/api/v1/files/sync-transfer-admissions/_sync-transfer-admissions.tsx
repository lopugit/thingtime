import { json, readJsonBody } from '~/api/http';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { resolveDeviceActor } from '~/api/utils/devices/deviceAuth';
import { resolveTransferOwner, transferAdmission } from '~/api/utils/files/transferAdmissions';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const action = async ({ request }: { request: Request }) =>
	withAttachmentPrivateResponse(async () => {
		if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
		if (!isSameOriginAttachmentRequest(request)) return json({ ok: false, error: 'Cross-origin transfer admission is not allowed' }, { status: 403 });
		if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
			return json({ ok: false, error: 'Use application/json' }, { status: 415 });
		const raw = await readJsonBody(request, 64 * 1024);
		if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !['admit', 'parts', 'complete', 'publish', 'revoke', 'open-photo-run', 'reserve-photo-original', 'revoke-photo-run', 'check-photo-run', 'observe-photo-index', 'read-source-index', 'discard-source-index', 'list-source-indexes'].includes(raw.action))
			return json({ ok: false, error: 'Invalid transfer admission request' }, { status: 400 });
		const opens = raw.action === 'admit' || raw.action === 'open-photo-run';
		const owner = opens || raw.action === 'list-source-indexes' || raw.action === 'read-source-index' || raw.action === 'discard-source-index' || raw.action === 'revoke' || raw.action === 'revoke-photo-run' ? await resolveTransferOwner(request) : null;
		const device = !opens && !owner ? await resolveDeviceActor(request) : null;
		if (!owner && !device) return json({ ok: false, error: 'An owning browser session or paired device credential is required' }, { status: 401 });
		// Keep the same quota for ordinary and delegated multipart operations.
		const key = raw.action === 'parts' ? 'attachments.parts' : raw.action === 'complete' ? 'attachments.complete' : raw.action === 'publish' ? 'things.write' : raw.action === 'reserve-photo-original' ? 'attachments.start' : 'files.sync-transfer-admit';
		const limit = await enforceRateLimit(request, key, `user:${(owner ?? device)!.userId}`, { failClosed: true });
		if (!limit.allowed) {
			if (limit.unavailable) return json({ ok: false, error: 'Transfer admission service is temporarily unavailable' }, { status: 503 });
			return json({ ok: false, error: 'Too many transfer admission requests' }, rateLimitedResponseInit(limit));
		}
		try {
			const result = await transferAdmission({
				raw,
				origin: new URL(request.url).origin,
				owner,
				device,
				signal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)])
			});
			return json(result, { status: result.ok === false ? result.status : 200 });
		} catch {
			return json({ ok: false, error: 'Transfer admission service is temporarily unavailable' }, { status: 503 });
		}
	});
