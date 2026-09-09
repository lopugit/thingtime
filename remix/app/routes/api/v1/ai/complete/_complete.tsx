import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { enforceSubscriptionRateLimit } from '~/api/utils/rateLimit/subscription';
import { completeWithAiConnections } from '~/api/utils/ai/completion';
import { parseAiCompletionInput } from '~/api/utils/ai/completionCore';
import { AiWaterfallFailure } from '~/api/utils/ai/providerWaterfall';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const reply = (body: unknown, status = 200) => json(body, { status, headers });

export const createAiCompletionHandlers = (dependencies: {
	getUser: typeof getCurrentUser;
	limit: typeof enforceSubscriptionRateLimit;
	complete: typeof completeWithAiConnections;
}) => ({
	action: async ({ request }: { request: Request }) => {
		if (request.method !== 'POST') return reply({ ok: false, error: 'Method not allowed.' }, 405);
		if (!isSameOriginAttachmentRequest(request) || request.headers.get('Sec-Fetch-Site') === 'cross-site')
			return reply({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
		if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
			return reply({ ok: false, error: 'Use application/json.' }, 415);
		const user = await dependencies.getUser(request);
		if (!user || user.temporary || user.accountKind !== 'user')
			return reply({ ok: false, error: 'Sign in with a full account to use your AI connections.' }, 401);
		const limit = await dependencies.limit(request, 'ai.complete', user.id);
		if (limit.unavailable) return reply({ ok: false, error: 'Your account allowance is temporarily unavailable. Please retry.' }, 503);
		if (!limit.allowed) {
			const init = rateLimitedResponseInit(limit);
			const limitedHeaders = new Headers(init.headers);
			for (const [key, value] of Object.entries(headers)) limitedHeaders.set(key, value);
			return json({ ok: false, error: 'Please wait before requesting another completion.' }, { ...init, headers: limitedHeaders });
		}
		let input;
		try { input = parseAiCompletionInput(await readJsonBody(request, 192 * 1024)); }
		catch { return reply({ ok: false, error: 'Provide text and one to four owned connection IDs; inline endpoints and credentials are not accepted.' }, 400); }
		try {
			return reply({ ok: true, ...await runWithMongoEndpoint(null, () => dependencies.complete(user.id, input, request.signal)) });
		} catch (error) {
			if (request.signal.aborted) return reply({ ok: false, error: 'Completion cancelled.' }, 408);
			if (error instanceof AiWaterfallFailure) return reply({ ok: false, error: error.message, attempts: error.attempts }, 503);
			if (error instanceof TypeError) return reply({ ok: false, error: 'Choose your own compatible endpoint connections.' }, 400);
			return reply({ ok: false, error: 'The AI completion could not be completed.' }, 502);
		}
	}
});

export const action = createAiCompletionHandlers({ getUser: getCurrentUser, limit: enforceSubscriptionRateLimit, complete: completeWithAiConnections }).action;
