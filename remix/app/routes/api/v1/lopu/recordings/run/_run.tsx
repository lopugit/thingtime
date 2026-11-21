import { scheduledJobSecret } from '~/api/utils/automation/scheduledJobSecret';
import { recordScheduledPassResult } from '~/api/utils/automation/scheduledRunContext';
import { timingSafeEqual } from 'node:crypto';
import { json } from '~/api/http';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { runRecordingAutomation } from '~/api/utils/lopu/recordingsWorker';
import { sendRecordingReminders } from '~/api/utils/lopu/recordingsReminders';
import { runLopuReminders } from '~/api/utils/lopu/reminders';
import { runRecordingHandoffs } from '~/api/utils/lopu/recordingHandoff';
import { runUserStorageRecovery } from '~/api/utils/storage/userStorageRecovery';

const headers = { 'Cache-Control': 'private, no-store' };
const cronAuthorized = (request: Request) => {
	const secret = scheduledJobSecret()?.trim();
	if (!secret) return false;
	const provided = Buffer.from(request.headers.get('authorization') || '');
	const expected = Buffer.from(`Bearer ${secret}`);
	return provided.length === expected.length && timingSafeEqual(provided, expected);
};

const run = async () =>
	runWithMongoEndpoint(null, async () => {
		// Storage repair must still run when an unrelated provider worker fails.
		const storageRecovery = await runUserStorageRecovery().catch(() => ({ unavailable: true }));
		// Send due reminders first so a provider outage cannot starve existing todos.
		const reminders = await sendRecordingReminders();
		const scheduledReminders = await runLopuReminders();
		const recordings = await runRecordingAutomation();
		const handoffs = await runRecordingHandoffs();
    recordScheduledPassResult('/api/v1/lopu/recordings/run',{reminders,scheduledReminders,recordings,handoffs,storageRecovery});
		return json({ ok: true, reminders, scheduledReminders, recordings, handoffs, storageRecovery }, { headers });
	});

export const loader = async ({ request }: { request: Request }) => {
	if (!cronAuthorized(request)) return json({ ok: false, error: 'Unauthorized scheduler.' }, { status: 401, headers });
	return run();
};

export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, { status: 405, headers });
	if (!isSameOriginAttachmentRequest(request)) return json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403, headers });
	const gate = await requireAdmin(request);
	if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers });
	return run();
};
