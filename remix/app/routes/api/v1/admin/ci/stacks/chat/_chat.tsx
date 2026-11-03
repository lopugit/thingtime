import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { enforceRateLimit } from '~/api/utils/rateLimit/enforce';
import { enqueueStackQuestion, readStackChat } from '~/api/utils/ciControl/stackChat';
import { parseStackChatQuestion } from '~/api/utils/ciControl/stackChatCore';

const handle = (request: Request, write: boolean) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
		try {
			if (!write) return json({ ok: true, ...(await readStackChat(new URL(request.url).searchParams.get('runId') ?? '')) });
			const input = parseStackChatQuestion(await readJsonBody(request, 12 * 1024));
			if (!input) return json({ ok: false, error: 'Enter a question of up to 2,000 characters and a valid message/run ID.' }, { status: 400 });
			const rate = await enforceRateLimit(request, 'ci.stack-chat', `user:${gate.user.id}`, { failClosed: true });
			if (!rate.allowed) return json({ ok: false, error: 'Too many questions. Please wait a minute before trying again.' }, { status: 429 });
			return json({ ok: true, message: await enqueueStackQuestion(input, gate.user.id) }, { status: 202 });
		} catch (error) {
			if (error instanceof Response) throw error;
			return json(
				{ ok: false, error: 'The stack conversation could not be loaded or updated. Refresh its status and retry the same message.' },
				{ status: 409 }
			);
		}
	});
export const loader = ({ request }: { request: Request }) => handle(request, false);
export const action = ({ request }: { request: Request }) => handle(request, true);
