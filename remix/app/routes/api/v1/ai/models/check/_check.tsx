import { json, readJsonBody } from '~/api/http';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { checkAiModel } from '~/api/utils/ai/modelCheck';
import { parseAiModelCheckInput } from '~/api/utils/ai/modelCheckCore';
import { lopuAccessResponse } from '~/api/utils/lopu/access';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/ai/models/check — the Lopu model picker's "Check Models"
// button, one selectable choice per request: { model } (a catalog model id)
// or { providerId } (one of the caller's own provider connections). The
// model is sent the tiny message "Live? Y/N" with no tools, history or
// fallback; the answer is { ok, live, reply | error, latencyMs, … }. The
// Lopu access gate (verified account, credits, in-flight slot) and the usage
// ledger apply exactly as for a chat turn; nothing is saved to a chat.
// Flow: same-origin → JSON → full account → fail-closed rate limit → parse →
// check. See app/api/utils/ai/modelCheck.ts.

const MAX_BODY_BYTES = 2 * 1024;
const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) => json(body, { status, headers: { ...headers, ...extra } });

export const createAiModelCheckHandlers = (dependencies: {
	getUser: typeof getCurrentUser;
	limit: typeof enforceRateLimit;
	check: typeof checkAiModel;
	log?: (message: string, error?: unknown) => void;
}) => {
	const log = dependencies.log ?? ((message: string, error?: unknown) => console.error(message, (error as Error | undefined)?.message ?? ''));
	return {
		loader: async () => reply({ ok: false, error: 'Method not allowed.' }, 405, { Allow: 'POST' }),
		action: async ({ request }: { request: Request }) => {
			if (request.method !== 'POST') return reply({ ok: false, error: 'Method not allowed.' }, 405, { Allow: 'POST' });
			if (!isSameOriginAttachmentRequest(request) || request.headers.get('Sec-Fetch-Site') === 'cross-site')
				return reply({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
			if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
				return reply({ ok: false, error: 'Content-Type must be application/json.' }, 415);
			const user = await dependencies.getUser(request);
			if (!user || user.temporary || user.accountKind !== 'user')
				return reply({ ok: false, error: 'Sign in with a full account to check models.' }, 401);
			const limit = await dependencies.limit(request, 'ai.models.check', `user:${user.id}`, { failClosed: true });
			if (!limit.allowed) {
				const init = rateLimitedResponseInit(limit);
				return reply(
					{ ok: false, error: limit.unavailable ? 'Model checks cannot check their rate limit right now — try again shortly.' : 'Models were checked very recently — try again in a few minutes 🦄' },
					init.status,
					init.headers
				);
			}
			let target;
			try {
				target = parseAiModelCheckInput(await readJsonBody(request, MAX_BODY_BYTES));
			} catch (error) {
				// readJsonBody answers an oversized or unreadable body with its own Response
				if (error instanceof Response) return error;
				return reply({ ok: false, error: error instanceof TypeError ? error.message : 'Send { model } or { providerId } as JSON.' }, 400);
			}
			try {
				const result = await dependencies.check(request, user, target, request.signal);
				if (result.kind === 'refused') return lopuAccessResponse(result.refusal);
				if (result.kind === 'invalid') return reply({ ok: false, error: result.error }, result.status);
				return reply(result.outcome);
			} catch (error) {
				if (request.signal?.aborted) return reply({ ok: false, error: 'Model check cancelled.' }, 408);
				log('[ai-model-check] check failed', error);
				return reply({ ok: false, error: 'The model check could not be completed.' }, 502);
			}
		}
	};
};

const handlers = createAiModelCheckHandlers({ getUser: getCurrentUser, limit: enforceRateLimit, check: checkAiModel });

export const loader = handlers.loader;
export const action = handlers.action;
