import { json, readJsonBody } from '~/api/http';

import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import {
	getModerationSettingsView,
	listModerationOverview,
	reviewAttachmentModeration,
	reviewTextModeration,
	sweepUnanalyzedAttachments,
	updateModerationSettings
} from '~/api/utils/moderation/moderationAdmin';

// GET  /api/v1/admin/moderation — flag review queue + unanalyzed counts +
//   the AI-moderation settings (per-surface provider choices and what each
//   surface effectively runs after env fallback).
// POST /api/v1/admin/moderation — admin only:
//   { action: 'review', attachmentId, verdict: 'clear' | 'nsfw' | 'block',
//     targetKind?: 'attachment' | 'text' }
//     — override the pipeline's verdict; blocked media/text stops being
//       served immediately, cleared media/text serves again. 'text' rows
//       review the post/comment thing the flag points at.
//   { action: 'sweep' } — analyze up to a bounded batch of ready attachments
//     the async kickoff missed (pending/unstamped); run repeatedly to drain.
//   { action: 'settings', settings: { mediaProvider, textProvider } }
//     — save the Admin AI-moderation provider choices (validated strictly).
export const loader = async ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
		const [overview, settingsView] = await Promise.all([listModerationOverview(), getModerationSettingsView()]);
		return json({ ok: true, ...overview, ...settingsView });
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

		if (actionKind === 'settings') {
			try {
				return json({ ok: true, ...(await updateModerationSettings(body?.settings, gate.user.id)) });
			} catch (error) {
				if (error instanceof TypeError) return json({ ok: false, error: error.message }, { status: 400 });
				throw error;
			}
		}

		if (actionKind === 'review') {
			const attachmentId = typeof body?.attachmentId === 'string' ? body.attachmentId : '';
			if (!attachmentId) return json({ ok: false, error: 'attachmentId is required' }, { status: 400 });
			const verdict = typeof body?.verdict === 'string' ? body.verdict : '';
			if (verdict !== 'clear' && verdict !== 'nsfw' && verdict !== 'block') {
				return json({ ok: false, error: 'verdict must be clear, nsfw, or block' }, { status: 400 });
			}
			const result =
				body?.targetKind === 'text'
					? await reviewTextModeration(attachmentId, verdict, gate.user.id)
					: await reviewAttachmentModeration(attachmentId, verdict, gate.user.id);
			if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
			return json({ ok: true, attachmentId: result.attachmentId, moderationStatus: result.moderationStatus });
		}

		return json({ ok: false, error: 'action must be review, sweep, or settings' }, { status: 400 });
	});
