import { json } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { verifyCiProviderRouteSignature } from '~/api/utils/ciControl/providerRouter';
import { parseStackChatWorker } from '~/api/utils/ciControl/stackChatCore';
import { pollStackChat } from '~/api/utils/ciControl/stackChat';

export const action = ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const secret = process.env.THINGTIME_CI_ROUTER_SECRET?.trim();
		if (!secret) return json({ ok: false, error: 'Run chat is not configured.' }, { status: 503 });
		const reader = request.body?.getReader();
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		if (reader)
			while (true) {
				const part = await reader.read();
				if (part.done) break;
				bytes += part.value.byteLength;
				if (bytes > 32 * 1024) {
					await reader.cancel();
					return json({ ok: false, error: 'Payload too large.' }, { status: 413 });
				}
				chunks.push(part.value);
			}
		const raw = Buffer.concat(chunks).toString('utf8');
		if (!verifyCiProviderRouteSignature(raw, request.headers.get('x-thingtime-ci-signature'), secret))
			return json({ ok: false, error: 'Invalid signature.' }, { status: 403 });
		let body;
		try {
			body = JSON.parse(raw);
		} catch {
			return json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
		}
		const input = parseStackChatWorker(body, (process.env.THINGTIME_GITHUB_REPOSITORY || 'lopugit/thingtime').trim());
		if (!input) return json({ ok: false, error: 'Invalid or expired run chat request.' }, { status: 400 });
		try {
			return json({ ok: true, ...(await pollStackChat(input)) });
		} catch {
			return json({ ok: false, error: 'The responder could not access this run mailbox.' }, { status: 409 });
		}
	});
