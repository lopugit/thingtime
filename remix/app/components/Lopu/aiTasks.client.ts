import { AI_TASK_OPERATIONS, AI_TASK_OWNER_HEADER, AI_TASK_PATH, type AiBackgroundTask } from '~/api/utils/lopu/backgroundTaskCore';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { observeAiTask, type AiTaskFrame, type AiTaskRequest } from './aiTaskTransport';
let ownerId: string | null = null;
let ownerGeneration = 0;
let contextKey = 'unresolved';
export const getAiTaskContextKey = () => contextKey;
let taskState: 'idle' | 'ready' | 'unavailable' = 'idle';
export const getAiTaskState = () => taskState;
export const getServerAiTaskState = () => 'idle' as const;
const fallbacks = new Map<string, () => void>();
let worker: SharedWorker | null = null;
const receivers = new Map<string, (frame: AiTaskFrame) => void>();
let tasks: AiBackgroundTask[] = [];
const listeners = new Set<() => void>();
export const subscribeAiTasks = (fn: () => void) => {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
};
export const getAiTasks = () => tasks;
const empty: AiBackgroundTask[] = [];
export const getServerAiTasks = () => empty;
const publish = (next: AiBackgroundTask[]) => {
	tasks = next;
	listeners.forEach((fn) => fn());
};
const connect = () => {
	if (worker || typeof SharedWorker === 'undefined') return;
	try {
		worker = new SharedWorker(new URL('./aiTasks.worker.ts', import.meta.url), { type: 'module', name: 'thingtime-ai-tasks-v1' });
		worker.port.onmessage = ({ data }) => receivers.get(data.id)?.(data.frame);
		worker.onerror = () => {
			worker?.port.close();
			worker = null;
			[...fallbacks.values()].forEach((resume) => resume());
		};
		worker.port.start();
	} catch {
		worker = null;
	}
};
export const bindAiTaskOwner = (next: string | null) => {
	connect();
	if (next === ownerId) return;
	ownerId = next;
	ownerGeneration++;
 contextKey = 'unresolved';
	taskState = 'idle';
	tasks = [];
	queueMicrotask(() => listeners.forEach((fn) => fn()));
};
let refreshing: Promise<void> | null = null;
export const refreshAiTasks = (): Promise<void> => {
	if (!ownerId) return Promise.resolve();
	if (refreshing) return refreshing;
	const owner = ownerId,
		generation = ownerGeneration;
	const work = async () => {
		await requireThingtimeCapability('api.lopu-background-tasks', '1.3.0');
		const response = await fetch(AI_TASK_PATH, { credentials: 'include', cache: 'no-store', headers: { [AI_TASK_OWNER_HEADER]: owner } });
		if (!response.ok) throw new Error('Task status is temporarily unavailable.');
		const result = await response.json();
		if (ownerId === owner && generation === ownerGeneration && result.ownerId === owner && Array.isArray(result.tasks)) {
			contextKey = typeof result.contextKey === 'string' ? result.contextKey : 'legacy';
			taskState = 'ready';
			publish(result.tasks);
		}
	};
	refreshing = work()
		.catch((error) => {
			if (generation === ownerGeneration) {
				taskState = 'unavailable';
				publish(tasks);
			}
			throw error;
		})
		.finally(() => {
			refreshing = null;
		});
	return refreshing;
};
export const stopAiTask = async (id: string) => {
	if (!ownerId) return;
	const response = await fetch(AI_TASK_PATH, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', [AI_TASK_OWNER_HEADER]: ownerId },
		body: JSON.stringify({ id, action: 'stop' })
	});
	if (!response.ok && response.status !== 409) throw new Error('Could not stop this task. Try again.');
	// A successful Stop must not fail just because the following status read is offline.
	await refreshAiTasks().catch(() => {});
};
export const stopAiTaskRequest = async (requestId: string) => {
	if (!ownerId) return;
	const response = await fetch(AI_TASK_PATH, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', [AI_TASK_OWNER_HEADER]: ownerId },
		body: JSON.stringify({ requestId, action: 'stop' })
	});
	if (!response.ok && response.status !== 409) throw new Error('Could not stop this task. Try again.');
	// A successful Stop must not fail just because the following status read is offline.
	await refreshAiTasks().catch(() => {});
};
export const readAiTaskOutput = async (task: AiBackgroundTask) => {
	const owner = ownerId,
		generation = ownerGeneration;
	if (!owner) return null;
	let output = '',
		offset = 0;
	do {
		const response = await fetch(`${AI_TASK_PATH}?id=${encodeURIComponent(task.id)}&offset=${offset}`, {
			credentials: 'include',
			cache: 'no-store',
			headers: { [AI_TASK_OWNER_HEADER]: owner }
		});
		if (!response.ok || owner !== ownerId || generation !== ownerGeneration) return null;
		const result = await response.json();
		if (result.ownerId !== owner) return null;
		output += result.output;
		offset = result.offset;
		if (offset >= result.length) return { task: result.task as AiBackgroundTask, output };
	} while (output.length < 2 * 1024 * 1024);
	return null;
};

export const aiTaskFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
	const target = typeof location === 'undefined' ? null : new URL(url, location.href);
 if (target && target.origin !== location.origin) return fetch(url, init);
 const pathname = target?.pathname ?? url.split('?')[0];
	const operation = AI_TASK_OPERATIONS[pathname];
	const owner = ownerId,
		generation = ownerGeneration;
	if (!operation || !owner || (init.method || 'GET') !== operation.method || (init.body && typeof init.body !== 'string')) return fetch(url, init);
	await requireThingtimeCapability('api.lopu-background-tasks', '1.3.0');
	const versions: Record<string, string> = {
		'api.lopu-chats-reply': '1.14.0',
		'api.lopu-voice-reply': '1.4.0',
		'api.lopu-musing': '1.1.0',
		'api.ai-complete': '1.2.0'
	};
	await requireThingtimeCapability(operation.feature, versions[operation.feature]);
	init.signal?.throwIfAborted();
	let body: any;
	try {
		body = JSON.parse(String(init.body));
	} catch {
		/* musing GET */
	}
	const id = typeof body?.requestId === 'string' ? body.requestId : crypto.randomUUID();
	const input: AiTaskRequest = {
		url,
		method: operation.method,
		headers: Object.fromEntries(new Headers(init.headers)),
		body: init.body as string | undefined,
		ownerId: owner,
		requestId: id
	};
	connect();
	return new Promise<Response>((resolve, reject) => {
		let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
		let closed = false,
			receivedHead = false,
			receivedChars = 0,
			fallbackStarted = false;
		const receiverId = crypto.randomUUID();
		const dispose = () => {
			closed = true;
			receivers.delete(receiverId);
			fallbacks.delete(receiverId);
			init.signal?.removeEventListener('abort', detach);
		};
		const detach = () => {
			if (closed) return;
			const error = new DOMException('Observer detached', 'AbortError');
			if (receivedHead) streamController?.error(error);
			else reject(error);
			dispose();
		};
		init.signal?.addEventListener('abort', detach, { once: true });
		const receive = (frame: AiTaskFrame) => {
			if (closed) return;
			if (ownerId !== owner || generation !== ownerGeneration) {
				detach();
				return;
			}
			if (frame.type === 'head') {
				if (receivedHead) return;
				receivedHead = true;
				if (frame.task) publish([frame.task, ...tasks.filter((task) => task.id !== frame.task.id)]);
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						streamController = controller;
					},
					cancel() {
						dispose();
					}
				});
				resolve(new Response(stream, { status: frame.status, headers: { 'Content-Type': frame.contentType, ...(frame.retryAfter ? { 'Retry-After': frame.retryAfter } : {}) } }));
			} else if (frame.type === 'chunk') {
				receivedChars += frame.text.length;
				streamController?.enqueue(new TextEncoder().encode(frame.text));
			} else if (frame.type === 'end') {
				streamController?.close();
				dispose();
				void refreshAiTasks().catch(() => {});
			} else {
				const error = new Error(frame.message);
				if (receivedHead) streamController?.error(error);
				else reject(error);
				dispose();
				void refreshAiTasks().catch(() => {});
			}
		};
		const resume = () => {
			if (closed || fallbackStarted) return;
			fallbackStarted = true;
			let skip = receivedChars;
			void observeAiTask(input, (frame) => {
				if (frame.type === 'chunk' && skip) {
					const length = frame.text.length;
					frame = { ...frame, text: frame.text.slice(skip) };
					skip = Math.max(0, skip - length);
					if (!frame.text) return;
				}
				receive(frame);
			}).catch((error) => receive({ type: 'error', message: error instanceof Error ? error.message : 'Task connection interrupted.' }));
		};
		receivers.set(receiverId, receive);
		fallbacks.set(receiverId, resume);
		if (worker) {
			try {
				worker.port.postMessage({ id: receiverId, input });
			} catch {
				resume();
			}
		} else resume();
	});
};

export const sendAiTaskNote = async (id: string, noteId: string, text: string) => {
 const owner = ownerId, generation = ownerGeneration;
 if (!owner) throw new Error('Sign in to send a note.');
 await requireThingtimeCapability('api.lopu-background-tasks', '1.2.0');
 await requireThingtimeCapability('api.lopu-chats-reply', '1.13.0');
 const response = await fetch(AI_TASK_PATH, { method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', [AI_TASK_OWNER_HEADER]: owner },
  body: JSON.stringify({ action: 'note', id, noteId, text }) });
 const result = await response.json();
 if (owner !== ownerId || generation !== ownerGeneration) throw new Error('The account changed.');
 if (!response.ok || !result.ok) throw new Error(result.error || 'Could not send this note.');
 return result;
};
