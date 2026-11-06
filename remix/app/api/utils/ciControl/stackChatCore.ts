export const STACK_CHAT_VERSION = '1.0.0';
export const STACK_CHAT_LEASE_MS = 4 * 60_000;
export const STACK_CHAT_ONLINE_MS = 150_000;
export const STACK_CHAT_ID = /^feature-stack-run-[0-9a-f-]{36}$/;
export const STACK_CHAT_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const chatRunActive = (status: unknown) =>
	['requested', 'accepted', 'running', 'queued', 'in_progress', 'waiting', 'pending'].includes(String(status ?? '').toLowerCase());
export function chatOnline(dispatch: any, now = Date.now()) {
	const at = new Date(dispatch?.crystal?.chatPollAt ?? '').getTime();
	return (
		dispatch?.crystal?.chatAvailable !== false &&
		chatRunActive(dispatch?.crystal?.runStatus ?? dispatch?.crystal?.status) &&
		Number.isFinite(at) &&
		now >= at &&
		now - at < STACK_CHAT_ONLINE_MS
	);
}
export function parseStackChatQuestion(body: any) {
	if (
		!body ||
		typeof body !== 'object' ||
		!STACK_CHAT_ID.test(body.runId) ||
		!STACK_CHAT_REQUEST_ID.test(body.requestId) ||
		typeof body.question !== 'string' ||
		!body.question.trim() ||
		body.question.length > 2000
	)
		return null;
	return { runId: body.runId as string, requestId: body.requestId as string, question: body.question.trim() };
}
export function parseStackChatWorker(body: any, repository: string, now = Date.now()) {
	if (
		!body ||
		typeof body !== 'object' ||
		body.repository !== repository ||
		!STACK_CHAT_ID.test(body.runId) ||
		!Number.isSafeInteger(body.workflowRunId) ||
		body.workflowRunId < 1 ||
		!Number.isSafeInteger(body.runAttempt) ||
		body.runAttempt < 1 ||
		body.runAttempt > 999 ||
		!Number.isFinite(Date.parse(body.at)) ||
		Math.abs(now - Date.parse(body.at)) > 60_000
	)
		return null;
	if (
		body.reply &&
		(typeof body.reply.id !== 'string' ||
			!/^ci-stack-chat-[0-9a-f]{48}$/.test(body.reply.id) ||
			!STACK_CHAT_REQUEST_ID.test(body.reply.lease) ||
			!['answered', 'failed'].includes(body.reply.status) ||
			typeof body.reply.answer !== 'string' ||
			!body.reply.answer.trim() ||
			body.reply.answer.length > 8000)
	)
		return null;
	return {
		repository,
		runId: body.runId as string,
		workflowRunId: body.workflowRunId as number,
		runAttempt: body.runAttempt as number,
		reply: body.reply ?? null,
		available: body.available === true
	};
}
