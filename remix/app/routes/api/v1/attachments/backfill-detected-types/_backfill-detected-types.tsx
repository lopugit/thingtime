import { json, readJsonBody } from '~/api/http';
import {
	ATTACHMENT_JSON_BODY_BYTES,
	attachmentPostOnlyLoader,
	isSameOriginAttachmentRequest,
	withAttachmentPrivateResponse
} from '~/api/utils/attachments/attachmentResponses';
import { backfillAttachmentDetectedTypes } from '~/api/utils/attachments/attachments';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

type DetectionBackfillDependencies = {
	admin: typeof requireAdmin;
	enforceLimit: typeof enforceRateLimit;
	readBody: typeof readJsonBody;
	service: typeof backfillAttachmentDetectedTypes;
};

const defaultDependencies: DetectionBackfillDependencies = {
	admin: requireAdmin,
	enforceLimit: enforceRateLimit,
	readBody: readJsonBody,
	service: backfillAttachmentDetectedTypes
};

// POST /api/v1/attachments/backfill-detected-types — admin-only bounded sweep
// that re-runs magic-byte detection for ready attachments finalized before
// detection existed and publishes what completion would have. The gate is
// requireAdmin rather than the user mutation factory: this operates on other
// accounts' rows, so an ordinary full-user session must never reach it.
export const createAttachmentDetectionBackfillAction = (overrides: Partial<DetectionBackfillDependencies> = {}) => {
	const dependencies = { ...defaultDependencies, ...overrides };
	return async ({ request }: { request: Request }) =>
		withAttachmentPrivateResponse(async () => {
			if (request.method.toUpperCase() !== 'POST') {
				return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
			}
			if (!isSameOriginAttachmentRequest(request)) {
				return json({ ok: false, error: 'Cross-origin attachment requests are not allowed' }, { status: 403 });
			}
			const mediaType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
			if (mediaType !== 'application/json') {
				return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
			}
			const gate = await dependencies.admin(request);
			if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
			const limit = await dependencies.enforceLimit(request, 'attachments.detectionBackfill', `user:${gate.user.id}`, { failClosed: true });
			if (!limit.allowed) {
				if (limit.unavailable) {
					return json({ ok: false, error: 'Attachment service is temporarily unavailable' }, { status: 503 });
				}
				return json({ ok: false, error: 'Too many attachment requests' }, rateLimitedResponseInit(limit));
			}

			const body = await dependencies.readBody(request, ATTACHMENT_JSON_BODY_BYTES);
			const result = await dependencies.service(body);
			if (result.ok === false) {
				const { status, ...bodyResult } = result;
				return json(bodyResult, { status });
			}
			return json(result);
		});
};

export const action = createAttachmentDetectionBackfillAction();

export const loader = attachmentPostOnlyLoader;
