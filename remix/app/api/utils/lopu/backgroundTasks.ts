import { createHash } from 'node:crypto';
import { Binary } from 'mongodb';
import { waitUntil } from '@vercel/functions';
import { json, readJsonBody } from '../../http';
import { resolvePublicOrigin } from '../auth/publicOrigin';
import { backgroundTaskScopeFor as scopeFor } from './backgroundTaskScope';
import { getCurrentUser } from '../auth/getCurrentUser';
import { getHomeThingsCollection } from '../mongodb/collections';
import { enforceRateLimit, rateLimitedResponseInit } from '../rateLimit/enforce';
import { getLopuChat, persistLopuUserTurn } from '../messenger/lopuChats';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import {
	AI_TASK_HEADER,
	AI_TASK_OWNER_HEADER,
	AI_TASK_KIND,
	AI_TASK_LEASE_MS,
 AI_TASK_ADMISSION_LEASE_MS,
	AI_TASK_MAX_BYTES,
	AI_TASK_OPERATIONS,
	validAiTaskRequestId,
	taskNeedsAttention,
	type AiBackgroundTask
} from './backgroundTaskCore';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const fail = (error: string, status = 400) => json({ ok: false, error }, { status, headers });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const taskIdFor = (owner: string, scope: string, requestId: string) => `lopu-background-${hash(`${owner}:${scope}:${requestId}`)}`;
// A task cannot follow a user to another deployment or selected data source.
export const taskViewer = async (request: Request) => {
	const origin = request.headers.get('Origin');
	if ((origin && origin !== resolvePublicOrigin(request).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return null;
	const user = await getCurrentUser(request);
	if (!user || user.temporary || user.accountKind !== 'user') return null;
	const expected = request.headers.get(AI_TASK_OWNER_HEADER);
	if (expected && expected !== user.id) return null;
	return user;
};
const textOf = (row: any): string => (row.secure instanceof Binary ? Buffer.from(row.secure.value()).toString('utf8') : '');
export const publicBackgroundTask = (row: any): AiBackgroundTask => ({
	id: row.shareId,
	requestId: row.crystal.requestId,
	label: row.crystal.label,
	path: row.crystal.path,
	chatId: row.targetId || null,
	status: row.crystal.status,
	stage: row.crystal.stage,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	responseStatus: row.crystal.responseStatus, retryAfter: row.crystal.retryAfter || null,
	contentType: row.crystal.contentType,
	error: row.crystal.error || null,
 management: row.crystal.management === 'server' ? 'server' : 'client',
 rootTaskId: row.rootTaskId || null,
 workflowStatus: row.crystal.workflowStatus || null
});
const stale = async (filter: any) => {
	const things = await getHomeThingsCollection();
 // Admission and worker claim race through this same cancellation/status fence.
 // A delayed scheduler delivery cannot execute a root reclaimed here.
 await things.updateMany({ ...filter, rootTaskId: { $exists: false }, 'crystal.management': 'server', 'crystal.workflowStatus': 'running', 'crystal.status': 'running', workerStarted: { $ne: true }, activeWorkerRequestId: { $exists: false }, deadlineAt: { $lt: new Date() } }, {
  $set: { cancelRequested: true, 'crystal.status': 'needs-attention', 'crystal.workflowStatus': 'needs-attention', 'crystal.stage': 'Could not start', 'crystal.error': 'The server did not start this task. Review its saved progress before sending again.', updatedAt: new Date() },
  $unset: { uniqueKeys: '', workflowInput: '' }
 });
	await things.updateMany(
		{ ...filter, 'crystal.status': 'running', 'crystal.management': { $ne: 'server' }, deadlineAt: { $lt: new Date() } },
		{
			$set: {
				'crystal.status': 'needs-attention',
				'crystal.stage': 'Interrupted',
				'crystal.error': 'This task stopped before completion. Its saved output is kept. Review it before continuing.',
				updatedAt: new Date()
			},
			$unset: { uniqueKeys: '' }
		}
	);
};

export const readBackgroundTasks = async (request: Request) => {
	const user = await taskViewer(request);
	if (!user) return fail('Sign in with the account that started this task.', 401);
	const scope = await scopeFor(request),
		url = new URL(request.url),
		id = url.searchParams.get('id');
	const filter = { ownerId: user.id, thingtime: AI_TASK_KIND, taskScope: scope };
	await stale(filter);
	const retention = await getHomeThingsCollection();
	await retention.updateMany(
		{ ...filter, 'crystal.outputExpired': false, outputExpiresAt: { $lt: new Date() } },
		{ $set: { secure: new Binary(Buffer.alloc(0)), 'crystal.outputExpired': true } }
	);
	const things = await getHomeThingsCollection();
	if (!id) {
		const rows = await things
			.find(filter, { projection: { secure: 0, workflowInput: 0 } })
			.sort({ createdAt: -1 })
			.limit(100)
			.toArray();
		// A long workflow can have more than a page of child checkpoints. Keep its
  // active root visible so Stop and aggregate status never disappear.
  const activeRoots = await things.find({ ...filter, $or: [{ 'crystal.workflowStatus': 'running' }, { workflowFinalStatus: { $exists: true }, workflowFinalizedAt: { $exists: false } }] }, { projection: { secure: 0, workflowInput: 0 } }).sort({ createdAt: -1 }).limit(100).toArray();
  const visible = [...new Map([...rows, ...activeRoots].map(row => [row.shareId, row])).values()].sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime());
  return json({ ok: true, ownerId: user.id, contextKey: scope, tasks: visible.map(publicBackgroundTask) }, { headers });
	}
	const row = await things.findOne({ ...filter, shareId: id });
	if (!row) return fail('Task not found.', 404);
	const offset = Number(url.searchParams.get('offset') || 0);
	if (!Number.isSafeInteger(offset) || offset < 0) return fail('Invalid output offset.');
	if (row.targetId) {
		const access = await getLopuChat(user.id, row.targetId);
		if (access.ok === false) return fail('Task conversation is no longer available.', 404);
	}
	if (row.outputExpiresAt && row.outputExpiresAt < new Date())
		return fail('This task result has expired. Chat replies remain in the conversation.', 410);
	const output = textOf(row);
	let end = Math.min(output.length, offset + 65536);
	if (end < output.length && /[\uD800-\uDBFF]/.test(output[end - 1])) end--;
	return json(
		{
			ok: true,
			ownerId: user.id,
   contextKey: scope,
			task: publicBackgroundTask(row),
			output: output.slice(offset, end),
			offset: end,
			length: output.length
		},
		{ headers }
	);
};
export const stopBackgroundTask = async (request: Request) => {
	if (request.method !== 'POST' || request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return fail('Use a JSON POST.', 415);
	const user = await taskViewer(request);
	if (!user) return fail('Sign in with the account that started this task.', 401);
	const input = await readJsonBody(request, 40_000);
 if (input?.action === 'note') {
  if (typeof input.id !== 'string' || typeof input.text !== 'string' || !input.text.trim() || Array.from(input.text).length > 8000 || typeof input.noteId !== 'string' || !/^[a-zA-Z0-9-]{1,36}$/.test(input.noteId)) return fail('Provide a task id, noteId and up to 8000 characters.');
  const scope = await scopeFor(request), things = await getHomeThingsCollection();
  const row = await things.findOne({ ownerId: user.id, thingtime: AI_TASK_KIND, taskScope: scope, shareId: input.id });
  if (!row?.targetId || row.crystal.path !== '/api/v1/lopu/chats/reply') return fail('Conversation task not found.', 404);
  // Do not abort, change the lease or launch another billed turn. A late note
  // remains in history for the next reply if the provider has already finished.
  const limit = await enforceRateLimit(request, 'lopu.chat', `background-note:${user.id}`, { failClosed: true });
  if (!limit.allowed) return json({ ok: false, error: 'Please wait before sending another note.' }, rateLimitedResponseInit(limit));
  const result = await persistLopuUserTurn(user.id, { chatId: row.targetId, requestId: `note:${hash(row.crystal.requestId).slice(0, 32)}:${input.noteId}`, text: input.text });
  return result.ok === true ? json({ ok: true, messages: result.messages, active: row.crystal.status === 'running' }, { headers }) : fail(result.error, result.status);
 }
	if (input?.action !== 'stop' || (typeof input.id !== 'string' && !validAiTaskRequestId(input.requestId)))
		return fail('Provide a task id or requestId and action=stop.');
	const scope = await scopeFor(request),
		things = await getHomeThingsCollection();
	const id = typeof input.id === 'string' ? input.id : taskIdFor(user.id, scope, input.requestId);
	const filter = { ownerId: user.id, thingtime: AI_TASK_KIND, taskScope: scope, shareId: id };
	const stoppedRow = await things.findOne(filter, { projection: { rootTaskId: 1, crystal: 1 } });
 // No worker exists to observe cancellation before initial dispatch. Retire an
 // unclaimed root atomically so Stop also releases its conversation claim.
 const stoppedBeforeStart = await things.updateOne({ ...filter, rootTaskId: { $exists: false }, 'crystal.management': 'server', 'crystal.workflowStatus': 'running', workerStarted: { $ne: true }, activeWorkerRequestId: { $exists: false } }, {
  $set: { cancelRequested: true, 'crystal.status': 'stopped', 'crystal.workflowStatus': 'stopped', 'crystal.stage': 'Stopped before starting', updatedAt: new Date() },
  $unset: { uniqueKeys: '', workflowInput: '' }
 });
 if (stoppedBeforeStart.matchedCount) return json({ ok: true }, { headers });
 if (stoppedRow?.rootTaskId) await things.updateOne({ shareId: stoppedRow.rootTaskId, ownerId: user.id, thingtime: AI_TASK_KIND, taskScope: scope }, { $set: { cancelRequested: true, 'crystal.stage': 'Stopping', updatedAt: new Date() } });
 if (stoppedRow?.crystal?.status === 'needs-attention' && stoppedRow.crystal.workflowStatus !== 'running') {
  await things.updateOne(filter, { $set: { cancelRequested: true, 'crystal.status': 'stopped', 'crystal.stage': 'Stopped', updatedAt: new Date() } });
  return json({ ok: true }, { headers });
 }
	let result = await things.updateOne({ ...filter, $or: [{ 'crystal.status': 'running' }, { 'crystal.status': 'needs-attention' }, { 'crystal.workflowStatus': 'running' }] }, { $set: { cancelRequested: true, 'crystal.stage': 'Stopping', updatedAt: new Date() } });
	if (!result.matchedCount && validAiTaskRequestId(input.requestId) && !(await things.findOne(filter))) {
		const limit = await enforceRateLimit(request, 'lopu.chat', `background-cancel:${user.id}`, { failClosed: true });
		if (!limit.allowed) return json({ ok: false, error: 'Please wait before stopping another pending request.' }, rateLimitedResponseInit(limit));
		// Stop can race admission. A tombstone closes that race without ever starting
		// inference, even if the original request reaches this server much later.
		const now = new Date();
		try {
			await things.insertOne({
				...filter,
				thingtime: [AI_TASK_KIND],
				schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
				storageClass: 'control',
				acl: [ACL_OWNER],
				tags: [],
				cancelRequested: true,
				digest: null,
				secure: new Binary(Buffer.alloc(0)),
				createdAt: now,
				updatedAt: now,
				crystal: {
					requestId: input.requestId,
					label: 'Stopped request',
					path: '',
					status: 'stopped',
					stage: 'Stopped before starting',
					responseStatus: 409,
					contentType: 'application/json',
					error: null
				}
			});
			return json({ ok: true }, { headers });
		} catch (error: any) {
			if (error?.code !== 11000) throw error;
		}
		result = await things.updateOne({ ...filter, $or: [{ 'crystal.status': 'running' }, { 'crystal.status': 'needs-attention' }, { 'crystal.workflowStatus': 'running' }] }, { $set: { cancelRequested: true, 'crystal.stage': 'Stopping', updatedAt: new Date() } });
	}
	return result.matchedCount ? json({ ok: true }, { headers }) : fail('Task is already finished or unavailable.', 409);
};

// Optional transport wrapper: all validation, tools, billing and transcript
// writes stay in the canonical handler. A unique operation claim precedes it.
export const startBackgroundTask = async (request: Request, execute: (request: Request) => Promise<Response>, internal?: { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; scope: string; rootTaskId: string; wait: true }): Promise<Response> => {
	const url = new URL(request.url),
		operation = AI_TASK_OPERATIONS[url.pathname];
	const requestId = request.headers.get(AI_TASK_HEADER);
	if (!operation || request.method !== operation.method || !validAiTaskRequestId(requestId)) return fail('Unsupported background operation.');
	const user = internal?.user ?? await taskViewer(request);
	if (!user) return fail('Sign in with a full account to run background tasks.', 401);
	if (request.method !== 'GET' && request.headers.get('Content-Type')?.split(';')[0] !== 'application/json')
		return fail('Use application/json.', 415);
	const input = request.method === 'GET' ? undefined : await readJsonBody(request, 256 * 1024);
	const body = input === undefined ? undefined : JSON.stringify(input);
	const scope = internal?.scope ?? await scopeFor(request);
	const id = taskIdFor(user.id, scope, requestId);
	const digest = hash(JSON.stringify([url.pathname + url.search, request.method, body]));
	const things = await getHomeThingsCollection();
	const filter = { shareId: id, ownerId: user.id, thingtime: AI_TASK_KIND, taskScope: scope };
	const existing = await things.findOne(filter);
	if (existing?.cancelRequested && existing.digest === null) return fail('This request was stopped before it started.', 409);
	if (existing)
		return existing.digest === digest
			? json({ ok: true, task: publicBackgroundTask(existing) }, { status: 202, headers })
			: fail('This operation id belongs to a different request.', 409);
	const limit = await enforceRateLimit(request, 'lopu.chat', `background:${user.id}`, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Please wait before starting another background task.' }, rateLimitedResponseInit(limit));
	const now = new Date();
	let existingChatId: string | null = null;
	if (url.pathname === '/api/v1/lopu/chats/reply' && input?.chatId) {
		const chat = await getLopuChat(user.id, input.chatId);
		if (chat.ok === false) return fail(chat.error, chat.status);
		existingChatId = input.chatId;
	}
	const chatClaim = existingChatId && !internal ? new Binary(Buffer.from(`lopu-background-chat:${hash(`${user.id}:${scope}:${existingChatId}`)}`)) : null;
	await stale({ ownerId: user.id, thingtime: AI_TASK_KIND, taskScope: scope });
	const serverManaged = input?.management === 'server' && url.pathname === '/api/v1/lopu/chats/reply';
 const row: any = {
		...filter,
  ...(internal ? { rootTaskId: internal.rootTaskId, workerStarted: true } : {}),
		thingtime: [AI_TASK_KIND],
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		storageClass: 'control',
		acl: [ACL_OWNER],
		tags: [],
		targetId: existingChatId,
		...(chatClaim ? { uniqueKeys: [chatClaim] } : {}),
		digest,
		secure: new Binary(Buffer.alloc(0)),
		createdAt: now,
		updatedAt: now,
		deadlineAt: new Date(now.getTime() + (serverManaged && !internal ? AI_TASK_ADMISSION_LEASE_MS : AI_TASK_LEASE_MS)),
		outputExpiresAt: new Date(now.getTime() + 7 * 86_400_000),
		crystal: {
			outputExpired: false,
   management: serverManaged ? 'server' : 'client',
   ...(serverManaged && !internal ? { workflowStatus: 'running' } : {}),
			requestId,
			label: operation.label,
			path: url.pathname,
			status: 'running',
			stage: 'Starting',
			responseStatus: null,
			contentType: '',
			error: null
		}
	};
	try {
		await things.insertOne(row);
	} catch (error: any) {
		if (error?.code !== 11000) throw error;
		const winner = await things.findOne(filter);
		return winner?.digest === digest
			? json({ ok: true, task: publicBackgroundTask(winner) }, { status: 202, headers })
			: fail('A reply is already running in this conversation. Open Background tasks to reconnect.', 409);
	}

 if (serverManaged && !internal) {
  let admitted: { ok: boolean; error?: string };
  try {
   const { admitLopuWorkflow } = await import('./continuationAdmission.server');
   admitted = await admitLopuWorkflow(request, row, input, user);
  } catch {
   admitted = { ok: false, error: 'Server management could not confirm startup. Review this task before trying again.' };
  }
  if (!admitted.ok) {
   const error = admitted.error || 'Server management could not start.';
   // A scheduler error can be an ambiguous acknowledgment. Cancel first. If
   // its worker already claimed the root, let that worker stop and retain the
   // conversation lock until its durable workflow finalizer runs.
   await things.updateOne(filter, { $set: { cancelRequested: true, 'crystal.error': error, updatedAt: new Date() } });
   await things.updateOne({ ...filter, workerStarted: { $ne: true }, activeWorkerRequestId: { $exists: false }, 'crystal.workflowStatus': 'running' }, { $set: { 'crystal.status': 'needs-attention', 'crystal.workflowStatus': 'needs-attention', 'crystal.stage': 'Could not start' }, $unset: { uniqueKeys: '', workflowInput: '' } });
   return fail(error, 409);
  }
  return json({ ok: true, task: publicBackgroundTask(row) }, { status: 202, headers });
 }
 const running = executeBackgroundTask(request, execute, row, user, body);
 if (internal?.wait) await running;
 else waitUntil(running.catch(() => {}));
 return json({ ok: true, task: publicBackgroundTask(row) }, { status: 202, headers });
};

// The durable workflow invokes this same drain after acquiring the task claim.
export const executeBackgroundTask = async (request: Request, execute: (request: Request) => Promise<Response>, row: any, user: { id: string }, body?: string) => {
 const things = await getHomeThingsCollection();
 const filter = { shareId: row.shareId, ownerId: user.id, thingtime: AI_TASK_KIND, taskScope: row.taskScope };
 const existingChatId = row.targetId || null;
	const abort = new AbortController();
	const detachedHeaders = new Headers(request.headers);
	detachedHeaders.delete(AI_TASK_HEADER);
	detachedHeaders.delete('content-length');
	const detached = new Request(request.url, { method: request.method, headers: detachedHeaders, body, signal: abort.signal });
	const work = async () => {
		let output = '',
			pendingLine = '',
			stage = 'Thinking',
			chatId: string | null = existingChatId;
		let responseStatus: number | null = null,
			contentType = '', retryAfter: string | null = null,
			taskError: string | null = null;
		let status = 'running',
			stopped = false,
			sawDone = false,
   executionSettled = false,
   finalSaveAcknowledged = false,
   outputTruncated = false,
			lastSave = 0,
			saving = Promise.resolve();
		const save = () => {
			const terminal = status !== 'running';
			const update = {
    ...(terminal && executionSettled ? {workerFinishedAt:new Date()} : {}),
				secure: new Binary(Buffer.from(output)),
				targetId: chatId,
				updatedAt: new Date(),
				'crystal.status': status,
				'crystal.stage': stage,
				'crystal.responseStatus': responseStatus, 'crystal.retryAfter': retryAfter,
				'crystal.contentType': contentType,
				'crystal.error': taskError,
    ...(!row.rootTaskId && row.crystal.workflowStatus === 'running' && chatId ? { uniqueKeys: [new Binary(Buffer.from(`lopu-background-chat:${hash(`${user.id}:${row.taskScope}:${chatId}`)}`))] } : {}),
    deadlineAt: new Date(Date.now() + AI_TASK_LEASE_MS)
			};
			saving = saving.then(async () => {
				const saved = await things.updateOne({ ...filter, 'crystal.status': 'running' }, { $set: update, ...(terminal && !(row.crystal.management === 'server' && !row.rootTaskId) ? { $unset: { uniqueKeys: '' } } : {}) });
    if (terminal && executionSettled && saved.matchedCount) finalSaveAcknowledged = true;
    await import('./liveActivity').then(m => m.refreshLopuLiveActivitiesForOwner(user.id, row.taskScope)).catch(() => {});
			});
			return saving;
		};
		let checking = false;
		const heartbeat = setInterval(async () => {
			if (checking) return;
			checking = true;
			try {
				const current = await things.findOne(filter, { projection: { cancelRequested: 1 } });
				const root = row.rootTaskId ? await things.findOne({ shareId: row.rootTaskId, ownerId: user.id, thingtime: AI_TASK_KIND }, { projection: { cancelRequested: 1 } }) : current;
				if (!current || current.cancelRequested || !root || root.cancelRequested) {
					stopped = true;
					abort.abort();
				} else {
     const renewed = await things.updateOne({ ...filter, 'crystal.status': 'running' }, { $set: { deadlineAt: new Date(Date.now() + AI_TASK_LEASE_MS) } });
     if (!renewed.matchedCount) abort.abort();
    }
			} catch {
				abort.abort();
			} finally {
				checking = false;
			}
		}, 1500);
		try {
   // Admission can be delayed after its root reservation. Check persisted
   // cancellation before invoking a handler; the heartbeat alone is too late.
   const current = await things.findOne(filter);
   const root = row.rootTaskId ? await things.findOne({shareId:row.rootTaskId,ownerId:user.id,taskScope:row.taskScope,thingtime:AI_TASK_KIND}) : current;
   if (!current || current.cancelRequested || !root || root.cancelRequested) {
    stopped = true; executionSettled = true; status = 'stopped'; stage = 'Stopped before starting';
    responseStatus = 409; contentType = 'application/json';
    output = JSON.stringify({ok:false,error:'This task was stopped before execution.'});
    return;
   }
			let response: Response;
			try {
				response = await execute(detached);
			} catch (error) {
				if (error instanceof Response) response = error;
				else throw error;
			}
			responseStatus = response.status; retryAfter = response.headers.get('Retry-After');
			contentType = response.headers.get('content-type') || 'application/json';
			await save();
			const reader = response.body?.getReader(),
				decoder = new TextDecoder();
   if (!reader) executionSettled = true;
			if (reader)
				for (;;) {
					const result = await reader.read();
					const chunk = result.done ? decoder.decode() : decoder.decode(result.value, { stream: true });
					if (Buffer.byteLength(output) + Buffer.byteLength(chunk) > AI_TASK_MAX_BYTES) {
						abort.abort();
      outputTruncated = true;
      taskError = 'Output limit reached. The worker is stopping; saved conversation receipts are kept.';
					}
     // Cancellation alone does not acknowledge side-effect completion. Drain
     // to the handler close even after the stored-output limit is reached.
     if (!outputTruncated) output += chunk;
					if (!outputTruncated && contentType.includes('ndjson')) {
						pendingLine += chunk;
						const lines = pendingLine.split('\n');
						pendingLine = lines.pop() || '';
						for (const line of lines) {
							let event: any;
							try {
								event = JSON.parse(line);
							} catch {
								continue;
							}
							if (event.type === 'meta' && typeof event.chatId === 'string') chatId = event.chatId;
							if (event.type === 'delta') stage = 'Writing';
							if (event.type === 'tool_use' || event.type === 'tool_use_start') stage = 'Using tools';
							if (event.type === 'tool_result') stage = 'Thinking';
							if (event.type === 'error') taskError = 'This reply was interrupted. Open its saved output for details.';
							if (event.type === 'done') sawDone = true;
							if (event.type === 'done' && taskNeedsAttention(event.stopReason))
								taskError ||= 'This reply paused before completing. Review the saved output and continue.';
							if (event.type === 'done' && event.stopReason === 'aborted') stopped = true;
						}
					}
					if (Date.now() - lastSave >= 1000) {
						await save();
						lastSave = Date.now();
					}
					if (result.done) { executionSettled = true; break; }
				}
			if (response.ok && contentType.includes('ndjson') && !sawDone)
				taskError ||= 'The reply connection ended before completion. Review its saved output and continue.';
			if (!response.ok) taskError ||= 'This request could not complete. Open its saved result for details.';
			if (abort.signal.aborted && !stopped) taskError ||= 'This task lost its worker connection. Its saved output is kept.';
			status = stopped ? 'stopped' : taskError ? 'needs-attention' : 'completed';
			stage = stopped ? 'Stopped' : taskError ? 'Needs attention' : 'Completed';
		} catch {
			status = stopped ? 'stopped' : 'needs-attention';
			stage = stopped ? 'Stopped' : 'Interrupted';
			taskError = stopped ? null : 'The connection to the AI stopped. Saved output is kept; review it before continuing.';
			if (responseStatus === null) {
				responseStatus = 503;
				contentType = 'application/json';
				output = JSON.stringify({ ok: false, error: taskError || 'Task stopped.' });
			}
		} finally {
			clearInterval(heartbeat);
			abort.abort();
			await save();
   if (row.crystal.management === 'server' && finalSaveAcknowledged) {
    const rootId = row.rootTaskId || row.shareId;
    await things.updateOne({shareId:rootId,ownerId:user.id,taskScope:row.taskScope,thingtime:AI_TASK_KIND,activeWorkerRequestId:row.crystal.requestId},{$unset:{activeWorkerRequestId:''}});
    const root = await things.findOne({shareId:rootId,ownerId:user.id,taskScope:row.taskScope,thingtime:AI_TASK_KIND});
    if (root?.workflowFinalStatus) {
     const {finalizeLopuWorkflow} = await import('./continuationFinalization.server');
     await finalizeLopuWorkflow(rootId,root.workflowFinalStatus);
    }
   }
		}
	};
 await work();
};
