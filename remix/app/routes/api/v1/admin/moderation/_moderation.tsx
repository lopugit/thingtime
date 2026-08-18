import { json, readJsonBody } from '~/api/http';

import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { listModerationOverview, reviewAttachmentModeration, sweepUnanalyzedAttachments } from '~/api/utils/moderation/moderationAdmin';

// GET  /api/v1/admin/moderation — flag review queue + unanalyzed counts.
// POST /api/v1/admin/moderation — admin only:
//   { action: 'review', attachmentId, verdict: 'clear' | 'nsfw' | 'block' }
//     — override the pipeline's verdict; blocked media stops being served
//       immediately, cleared media serves again.
//   { action: 'sweep' } — analyze up to a bounded batch of ready attachments
//     the async kickoff missed (pending/unstamped); run repeatedly to drain.
export const loader = async ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
		return json({ ok: true, ...(await listModerationOverview()) });
	});

export const action = async ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

		const body = await readJsonBody(request, 16 * 1024);
		const actionKind = typeof body?.action === 'string' ? body.action : '';

		if (actionKind === 'sweep') {
			return json({ ok: true, sweep: await sweepUnanalyzedAttachments() });
		}

		if (actionKind === 'review') {
			const attachmentId = typeof body?.attachmentId === 'string' ? body.attachmentId : '';
			if (!attachmentId) return json({ ok: false, error: 'attachmentId is required' }, { status: 400 });
			const verdict = typeof body?.verdict === 'string' ? body.verdict : '';
			if (verdict !== 'clear' && verdict !== 'nsfw' && verdict !== 'block') {
				return json({ ok: false, error: 'verdict must be clear, nsfw, or block' }, { status: 400 });
			}
			const result = await reviewAttachmentModeration(attachmentId, verdict, gate.user.id);
			if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
			return json({ ok: true, attachmentId: result.attachmentId, moderationStatus: result.moderationStatus });
		}

		return json({ ok: false, error: 'action must be review or sweep' }, { status: 400 });
	});
