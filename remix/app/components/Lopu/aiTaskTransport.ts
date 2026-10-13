import { AI_TASK_HEADER, AI_TASK_OWNER_HEADER, AI_TASK_PATH, type AiBackgroundTask } from '~/api/utils/lopu/backgroundTaskCore';
export type AiTaskRequest = { url: string; method: string; headers: Record<string, string>; body?: string; requestId: string; ownerId: string };
export type AiTaskFrame =
	| { type: 'head'; retryAfter?: string | null; status: number; contentType: string; task: AiBackgroundTask }
	| { type: 'chunk'; text: string }
	| { type: 'end' }
	| { type: 'error'; message: string };
class TaskObserverEnded extends Error {}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// SharedWorker and direct fallback use this exact transport. Network retries
// reuse the immutable operation id; polling never repeats a provider request.
export const observeAiTask = async (input: AiTaskRequest, emit: (frame: AiTaskFrame) => void, fetcher: typeof fetch = fetch, wait: (ms: number) => Promise<unknown> = pause) => {
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
			await wait(500 * (attempt + 1));
		}
	}
	if (!task) throw new Error('The task could not be started.');
	let offset = 0,
		head = false,
		failures = 0;
	for (;;) {
		try {
			const response = await fetcher(`${AI_TASK_PATH}?id=${encodeURIComponent(task.id)}&offset=${offset}`, {
				credentials: 'include',
				headers: ownerHeaders,
				cache: 'no-store'
			});
			if (!response.ok) {
				// Authentication changes detach this observer; the accepted job continues.
				if (response.status >= 400 && response.status < 500 && response.status !== 429) throw new TaskObserverEnded('This task belongs to another session or is unavailable.');
				throw new Error('Task status is temporarily unavailable.');
			}
			const result = await response.json();
			if (result.ownerId !== input.ownerId) throw new TaskObserverEnded('The active account changed.');
			task = result.task;
			failures = 0;
			if (!head && task!.responseStatus !== null) {
				emit({ type: 'head', status: task!.responseStatus!, contentType: task!.contentType, retryAfter: task!.retryAfter, task: task! });
				head = true;
			}
			if (head && result.output) emit({ type: 'chunk', text: result.output });
			offset = result.offset;
			if (task!.status !== 'running' && offset >= result.length) {
				if (!head) throw new TaskObserverEnded(task!.error || 'This task stopped before replying.');
				if (task!.status === 'needs-attention' && !task!.contentType.includes('json')) throw new TaskObserverEnded(task!.error || 'Task interrupted.');
				emit({ type: 'end' });
				return;
			}
			if (offset < result.length) continue;
		} catch (error) {
			if (error instanceof TaskObserverEnded) throw error;
   failures++;
		}
		await wait(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
	}
};
