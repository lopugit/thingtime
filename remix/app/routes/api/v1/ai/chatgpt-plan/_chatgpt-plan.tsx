import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { chatGPTPlanFailure, chatGPTPlanScope } from '~/api/utils/ai/chatgptPlanScope';
import { ChatGPTPlanRuntimeError, getChatGPTPlanRuntime } from '~/api/utils/ai/chatgptPlanRuntime';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const PRIVATE = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const defaults = { getCurrentUser, getRuntime: getChatGPTPlanRuntime, scope: chatGPTPlanScope, enforceRateLimit };

export const createChatGPTPlanHandlers = (dependencies = defaults) => {
	const handle = async (request: Request, mutation: boolean) => {
		if (request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
			(mutation && request.headers.get('Origin') !== new URL(request.url).origin))
			return json({ ok: false, error: 'Use the same Thingtime origin.' }, { status: 403, headers: PRIVATE });
		// Revalidation must observe the session's current identity rather than a
		// request override captured before an OAuth callback or connection move.
		if (request.headers.has('X-Thingtime-Character'))
			return json({ ok: false, error: 'Manage ChatGPT connections using the current session identity.' }, { status: 409, headers: PRIVATE });
		const user = await dependencies.getCurrentUser(request);
		if (!user) return json({ ok: false, error: 'Sign in to Thingtime first.' }, { status: 401, headers: PRIVATE });
		const expectedUser = request.headers.get('X-Thingtime-Expected-User');
		if (expectedUser && expectedUser !== user.id)
			return json({ ok: false, error: 'The active Thingtime account changed.' }, { status: 409, headers: PRIVATE });
		if (user.temporary || user.accountKind === 'service')
			return json({ ok: false, error: 'Use a personal Thingtime account.' }, { status: 403, headers: PRIVATE });
		if (mutation) {
			const unsupported = requireJsonContentType(request);
			if (unsupported) return unsupported;
		}
		const limit = await dependencies.enforceRateLimit(request, 'ai.chatgpt-plan', `user:${user.id}`, { failClosed: true });
		if (!limit.allowed) return json({ ok: false, error: 'Try again shortly.' }, { ...rateLimitedResponseInit(limit), headers: PRIVATE });
		try {
			const runtime = dependencies.getRuntime();
			if (!runtime) return json({ ok: !mutation, available: false, accounts: [], attempts: [],
				error: mutation ? 'ChatGPT plan usage requires a configured local or self-hosted Thingtime runtime.' : undefined
			}, { status: mutation ? 503 : 200, headers: PRIVATE });
			const scope = await dependencies.scope(request, user.id);
			if (!mutation) return json({ ok: true, available: true, ...(await runtime.status(scope)) }, { headers: PRIVATE });
			const body = await readJsonBody(request, 128 * 1024);
			const revalidate = async () => {
				const current = await dependencies.getCurrentUser(request);
				return current?.id === user.id && !current.temporary && current.accountKind !== 'service';
			};
			let result: unknown;
			switch (body?.action) {
				case 'begin':
					result = await runtime.begin(scope, revalidate, body.id);
					break;
				case 'cancel': result = await runtime.cancel(scope, body.attemptId); break;
				case 'select-model': result = await runtime.selectModel(scope, body.id, body.model); break;
				case 'refresh-models': result = await runtime.refreshModels(scope, body.id, revalidate); break;
				case 'disconnect': result = await runtime.disconnect(scope, body.id); break;
				case 'prepare-import': result = await runtime.prepareImport(scope, revalidate); break;
				case 'move-account': result = await runtime.moveAccount(scope, body.id, body.recipient, revalidate); break;
				case 'import-account': result = await runtime.importAccount(scope, body.bundle, revalidate); break;
				default: return json({ ok: false, error: 'Unknown ChatGPT plan action.' }, { status: 400, headers: PRIVATE });
			}
			return json({ ok: true, result }, { headers: PRIVATE });
		} catch (error) {
			return json({ ok: false, ...chatGPTPlanFailure(error) }, { status: error instanceof ChatGPTPlanRuntimeError ? error.status : 400, headers: PRIVATE });
		}
	};
	return {
		loader: ({ request }: { request: Request }) => handle(request, false),
		action: ({ request }: { request: Request }) => request.method === 'POST' ? handle(request, true) :
			json({ ok: false, error: 'Method not allowed.' }, { status: 405, headers: { ...PRIVATE, Allow: 'GET, POST' } })
	};
};

export const { loader, action } = createChatGPTPlanHandlers();
