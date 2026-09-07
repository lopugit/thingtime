import { timingSafeEqual } from 'node:crypto';
import { json } from '~/api/http';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { runRecordingAutomation } from '~/api/utils/lopu/recordingsWorker';
import { sendRecordingReminders } from '~/api/utils/lopu/recordingsReminders';

const headers = { 'Cache-Control': 'private, no-store' };
const cronAuthorized = (request: Request) => {
	const secret = process.env.CRON_SECRET?.trim();
	if (!secret) return false;
	const provided = Buffer.from(request.headers.get('authorization') || '');
	const expected = Buffer.from(`Bearer ${secret}`);
	return provided.length === expected.length && timingSafeEqual(provided, expected);
};

const run = async () =>
	runWithMongoEndpoint(null, async () => {
		// Send due reminders first so a provider outage cannot starve existing todos.
		const reminders = await sendRecordingReminders();
		const recordings = await runRecordingAutomation();
		return json({ ok: true, reminders, recordings }, { headers });
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
