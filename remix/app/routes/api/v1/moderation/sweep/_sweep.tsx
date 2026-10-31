// GET /api/v1/moderation/sweep — scheduled moderation safety net (Vercel
// Cron, CRON_SECRET bearer, same contract as /api/v1/attachments/cleanup).
// One bounded pass per call:
//   text:        analyze a batch of post-family things with real text and no
//                moderation stamp — the fire-and-forget kickoff's losses
//                (process death between post write and verdict stamp,
//                provider outages) plus the backlog from off periods. No-ops
//                when the text surface is off.
//   attachments: the existing ready-attachment sweep (pending/unstamped).
// Idempotent and bounded; failures stay unstamped and retry next run.
import { timingSafeEqual } from 'node:crypto';

import { json } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import {
	shouldContinueModerationSweep,
	sweepUnanalyzedAttachments,
	sweepUnmoderatedTextThings
} from '~/api/utils/moderation/moderationAdmin';
import { startModerationSweepDrain } from '../../../../../../workflows/moderationSweep';

type SweepDependencies = {
	getSecret: () => string | undefined;
	sweepText: typeof sweepUnmoderatedTextThings;
	sweepAttachments: typeof sweepUnanalyzedAttachments;
	startContinuation: () => Promise<string>;
};

const defaultDependencies: SweepDependencies = {
	getSecret: () => process.env.CRON_SECRET,
	sweepText: sweepUnmoderatedTextThings,
	sweepAttachments: sweepUnanalyzedAttachments,
	startContinuation: startModerationSweepDrain
};

const exactSecretHeader = (authorization: string | null, secret: string): boolean => {
	const provided = Buffer.from(authorization || '', 'utf8');
	const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
	return provided.length === expected.length && timingSafeEqual(provided, expected);
};

export const createModerationSweepLoader = (overrides: Partial<SweepDependencies> = {}) => {
	const dependencies = { ...defaultDependencies, ...overrides };
	return async ({ request }: { request: Request }) =>
		withAdminPrivateResponse(async () => {
			if (request.method.toUpperCase() !== 'GET') {
				return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
			}
			const secret = dependencies.getSecret();
			if (!secret) {
				return json({ ok: false, error: 'Moderation sweep is not configured' }, { status: 503 });
			}
			if (!exactSecretHeader(request.headers.get('Authorization'), secret)) {
				return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
			}
			const [text, attachments] = await Promise.all([dependencies.sweepText(), dependencies.sweepAttachments()]);
			const continuationRunId = shouldContinueModerationSweep(text, attachments)
				? await dependencies.startContinuation()
				: null;
			return json({ ok: true, text, attachments, continuationRunId });
		});
};

export const loader = createModerationSweepLoader();

export const action = async () =>
	withAdminPrivateResponse(async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } }));
