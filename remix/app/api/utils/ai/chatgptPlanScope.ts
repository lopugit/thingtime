import { createHash } from 'node:crypto';
import { getAuthToken } from '../auth/authCookie';
import { ChatGPTPlanError } from './chatgptPlanProtocol';
import { ChatGPTPlanRuntimeError } from './chatgptPlanRuntime';

export const isChatGPTPlanProvider = (id: unknown): id is string =>
	typeof id === 'string' && id.startsWith('chatgpt-plan-');

/** The authenticated account and selected origin own the registration. The
 * session fingerprint binds short-lived sign-in attempts without retaining a JWT. */
export const chatGPTPlanScope = async (request: Request, ownerId: string) => ({
	ownerId,
	origin: new URL(request.url).origin,
	sessionId: createHash('sha256').update(await getAuthToken(request) ?? '').digest('hex')
});

export const chatGPTPlanFailure = (error: unknown) => ({
	error: error instanceof ChatGPTPlanError || error instanceof ChatGPTPlanRuntimeError ? error.message : 'ChatGPT plan connection is unavailable. Reconnect it in Settings.',
	code: error instanceof ChatGPTPlanError || error instanceof ChatGPTPlanRuntimeError ? error.code : 'CHATGPT_PLAN_UNAVAILABLE'
});
