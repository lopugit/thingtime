// Shared wire contract. Jobs execute once on the server; workers only observe.
export const AI_TASK_PATH = '/api/v1/lopu/tasks';
export const AI_TASK_HEADER = 'X-Thingtime-Background-Id';
export const AI_TASK_OWNER_HEADER = 'X-Thingtime-Task-Owner';
export const AI_TASK_KIND = 'lopu-background-task';
export const AI_TASK_MAX_MS = 260_000;
export const AI_TASK_MAX_BYTES = 2 * 1024 * 1024;
export const AI_TASK_OPERATIONS: Record<string, { method: string; label: string; feature: string }> = {
	'/api/v1/lopu/chats/reply': { method: 'POST', label: 'Lopu chat', feature: 'api.lopu-chats-reply' },
	'/api/v1/lopu/voice/reply': { method: 'POST', label: 'Voice reply', feature: 'api.lopu-voice-reply' },
	'/api/v1/lopu/musing': { method: 'GET', label: 'Lopu musing', feature: 'api.lopu-musing' },
	'/api/v1/ai/complete': { method: 'POST', label: 'AI completion', feature: 'api.ai-complete' }
};
export type AiTaskStatus = 'running' | 'completed' | 'needs-attention' | 'stopped';
export type AiBackgroundTask = {
	id: string;
	requestId: string;
	label: string;
	path: string;
	chatId: string | null;
	status: AiTaskStatus;
	stage: string;
	createdAt: string;
	updatedAt: string;
	retryAfter?: string | null;
 responseStatus: number | null;
	contentType: string;
	error: string | null;
};
export const validAiTaskRequestId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
export const taskNeedsAttention = (stopReason: unknown) =>
	['error', 'max_tokens', 'tool_limit', 'hop_limit', 'time_limit'].includes(String(stopReason));
