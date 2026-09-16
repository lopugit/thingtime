import { AI_TASK_HEADER, AI_TASK_OWNER_HEADER, AI_TASK_PATH, type AiBackgroundTask } from '~/api/utils/lopu/backgroundTaskCore';
export type AiTaskRequest = { url: string; method: string; headers: Record<string, string>; body?: string; requestId: string; ownerId: string };
export type AiTaskFrame =
	| { type: 'head'; retryAfter?: string | null; status: number; contentType: string; task: AiBackgroundTask }
	| { type: 'chunk'; text: string }
	| { type: 'end' }
	| { type: 'error'; message: string };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// SharedWorker and direct fallback use this exact transport. Network retries
// reuse the immutable operation id; polling never repeats a provider request.
export const observeAiTask = async (input: AiTaskRequest, emit: (frame: AiTaskFrame) => void, fetcher: typeof fetch = fetch) => {
	const ownerHeaders = { [AI_TASK_OWNER_HEADER]: input.ownerId };
	const headers = { ...input.headers, ...ownerHeaders, [AI_TASK_HEADER]: input.requestId };
	let task: AiBackgroundTask | undefined;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const response = await fetcher(input.url, { method: input.method, headers, body: input.body, credentials: 'include' });
			if (response.status !== 202) {
				emit({ type: 'head', status: response.status, retryAfter: response.headers.get('Retry-After'), contentType: response.headers.get('content-type') || 'application/json', task: null as any });
				emit({ type: 'chunk', text: await response.text() });
				emit({ type: 'end' });
				return;
			}
			const result = await response.json();
			task = result.task;
			if (!task?.id) throw new Error('The task could not be identified.');
			break;
		} catch (error) {
			if (attempt === 2) throw error;
			await pause(500 * (attempt + 1));
		}
	}
	if (!task) throw new Error('The task could not be started.');
	let offset = 0,
		head = false,
		failures = 0;
	const deadline = Date.now() + 310_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetcher(`${AI_TASK_PATH}?id=${encodeURIComponent(task.id)}&offset=${offset}`, {
				credentials: 'include',
				headers: ownerHeaders,
				cache: 'no-store'
			});
			if (!response.ok) {
				// Authentication changes detach this observer; the accepted job continues.
				if (response.status === 401 || response.status === 404) throw new Error('This task belongs to another session or is unavailable.');
				throw new Error('Task status is temporarily unavailable.');
			}
			const result = await response.json();
			if (result.ownerId !== input.ownerId) throw new Error('The active account changed.');
			task = result.task;
			failures = 0;
			if (!head && task!.responseStatus !== null) {
				emit({ type: 'head', status: task!.responseStatus!, contentType: task!.contentType, retryAfter: task!.retryAfter, task: task! });
				head = true;
			}
			if (head && result.output) emit({ type: 'chunk', text: result.output });
			offset = result.offset;
			if (task!.status !== 'running' && offset >= result.length) {
				if (!head) throw new Error(task!.error || 'This task stopped before replying.');
				if (task!.status === 'needs-attention' && !task!.contentType.includes('json')) throw new Error(task!.error || 'Task interrupted.');
				emit({ type: 'end' });
				return;
			}
			if (offset < result.length) continue;
		} catch (error) {
			if (++failures >= 3) throw error;
		}
		await pause(1000);
	}
	throw new Error('This task is taking longer than expected. Check Background tasks for its saved progress.');
};
