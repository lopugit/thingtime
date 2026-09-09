import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { createLopuReminder, listLopuReminders, setLopuReminderEnabled } from '~/api/utils/lopu/reminders';
import { enforceSubscriptionRateLimit } from '~/api/utils/rateLimit/subscription';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user || user.temporary || user.accountKind !== 'user') return reply({ ok: false, error: 'Sign in to manage reminders.' }, 401);
	return runWithMongoEndpoint(null, async () => reply({ ok: true, ownerId: user.id, reminders: await listLopuReminders(user.id) }));
};
export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return reply({ ok: false, error: 'Method not allowed.' }, 405);
	if (!isSameOriginAttachmentRequest(request)) return reply({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
	const unsupported = requireJsonContentType(request); if (unsupported) return unsupported;
	const user = await getCurrentUser(request);
	if (!user || user.temporary || user.accountKind !== 'user') return reply({ ok: false, error: 'Sign in to manage reminders.' }, 401);
	const limit = await enforceSubscriptionRateLimit(request, 'lopu.recordings', user.id);
	if (!limit.allowed) return reply({ ok: false, error: 'Please wait and retry.' }, limit.unavailable ? 503 : 429);
	const body = await readJsonBody(request, 8192);
	return runWithMongoEndpoint(null, async () => {
		try {
			let result;
			if (body?.op === 'create') result = await createLopuReminder(user.id, body);
			else if (body?.op === 'set-enabled' && typeof body.id === 'string' && body.id.length <= 160 && typeof body.enabled === 'boolean') result = await setLopuReminderEnabled(user.id, body.id, body.enabled);
			else return reply({ ok: false, error: 'Choose create or set-enabled.' }, 400);
			return reply(result, result.ok ? 200 : result.status);
		} catch (error) { return reply({ ok: false, error: error instanceof TypeError ? error.message : 'Reminder service is unavailable. Please retry.' }, error instanceof TypeError ? 400 : 503); }
	});
};
