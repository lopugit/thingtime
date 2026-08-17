import { timingSafeEqual } from 'node:crypto';

import { json } from '~/api/http';
import { reapExpiredAttachments } from '~/api/utils/attachments/attachments';
import { withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';

type CleanupDependencies = {
	getSecret: () => string | undefined;
	reap: typeof reapExpiredAttachments;
};

const defaultDependencies: CleanupDependencies = {
	getSecret: () => process.env.CRON_SECRET,
	reap: reapExpiredAttachments
};

const exactSecretHeader = (authorization: string | null, secret: string): boolean => {
	const provided = Buffer.from(authorization || '', 'utf8');
	const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
	return provided.length === expected.length && timingSafeEqual(provided, expected);
};

export const createAttachmentCleanupLoader = (overrides: Partial<CleanupDependencies> = {}) => {
	const dependencies = { ...defaultDependencies, ...overrides };
	return async ({ request }: { request: Request }) =>
		withAttachmentPrivateResponse(async () => {
			if (request.method.toUpperCase() !== 'GET') {
				return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
			}
			const secret = dependencies.getSecret();
			if (!secret) {
				return json({ ok: false, error: 'Attachment cleanup is not configured' }, { status: 503 });
			}
			if (!exactSecretHeader(request.headers.get('Authorization'), secret)) {
				return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
			}

			const result = await dependencies.reap();
			return result.ok === false ? json({ ok: false, error: result.error }, { status: result.status }) : json(result);
		});
};

export const loader = createAttachmentCleanupLoader();

export const action = async () =>
	withAttachmentPrivateResponse(async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } }));
