import { randomUUID } from 'node:crypto';

import { JsonlRpcProcess, LocalConnectorError, type JsonRpcTransport, type RpcId, type RpcMessage } from './jsonlRpc.js';
import { CODEX_INTERNAL_CONTEXT_STREAM_MARKER, cleanCodexVisibleText, type CodexLocalHistory } from './codexLocalHistory.js';
import { LocalProjectRegistry } from './projectRegistry.js';
import {
	AsyncEventQueue,
	type ApprovalDecision,
	type LiveConnector,
	type LiveConnectorCapability,
	type LiveConnectorEvent,
	type LiveSession,
	type LiveSessionEntry,
	type LiveSessionPage,
	type SendMessageRequest,
	type SendMessageResult
} from './types.js';

type CodexThread = {
	id: string;
	preview?: string;
	createdAt?: number;
	updatedAt?: number;
	cwd?: string;
	source?: string;
	name?: string | null;
	status?: { type?: string; activeFlags?: string[]; activeTurnId?: string | null };
};

type CodexTurn = { id: string; status?: string; items?: unknown[] };
type CommandExecution = { fingerprint: string; result: Promise<unknown> };
type DeltaGuard = { pending: string; blocked: boolean };
type SessionIdleWaiter = {
	resolve: () => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};

const STREAM_GUARD_TAIL_CHARS = 128;
const MAX_PENDING_APPROVALS = 128;
const APPROVAL_REQUEST_TTL_MS = 5 * 60 * 1_000;
const MAX_BLOCKED_QUEUE_SENDS = 128;
const QUEUE_WAIT_TIMEOUT_MS = 30 * 60 * 1_000;

const CONNECTOR_WARNING_MESSAGES = {
	connector_reported_error: 'Codex reported an error.',
	queue_delivery_failed: 'A queued message could not be delivered.'
} as const;

type ConnectorWarningCode = keyof typeof CONNECTOR_WARNING_MESSAGES;

const connectorWarning = (code: ConnectorWarningCode, commandId?: string): { message: string; commandId?: string } => ({
	message: CONNECTOR_WARNING_MESSAGES[code],
	...(commandId ? { commandId } : {})
});

const textInput = (text: string) => [{ type: 'text', text, text_elements: [] }];
const isoFromSeconds = (value: unknown): string | null => {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return new Date(value * 1_000).toISOString();
};

const threadStatus = (thread: CodexThread): LiveSession['status'] => {
	if (thread.status?.activeFlags?.includes('waitingOnApproval')) return 'waiting-approval';
	if (thread.status?.type === 'active') return 'running';
	if (thread.status?.type === 'idle' || thread.status?.type === 'notLoaded') return 'idle';
	return 'unknown';
};

const turnEntryStatus = (status: unknown): Extract<LiveSessionEntry, { type: 'message' }>['status'] => {
	if (status === 'inProgress') return 'streaming';
	if (status === 'interrupted') return 'interrupted';
	if (status === 'failed') return 'failed';
	return 'complete';
};

const record = (value: unknown): Record<string, any> | null =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;

const userText = (content: unknown): string => {
	const text = (Array.isArray(content) ? content : [])
		.map((part) => record(part))
		.filter((part): part is Record<string, any> => Boolean(part))
		.filter((part) => part.type === 'text' && typeof part.text === 'string')
		.map((part) => part.text)
		.join('\n');
	return cleanCodexVisibleText(text);
};

const safeTurnEvent = (value: unknown) => {
	const turn = record(value);
	return turn && typeof turn.id === 'string'
		? { id: turn.id.slice(0, 512), status: typeof turn.status === 'string' ? turn.status.slice(0, 64) : 'unknown' }
		: null;
};

const safeItemEvent = (value: unknown): Record<string, unknown> | null => {
	const item = record(value);
	if (!item || typeof item.type !== 'string') return null;
	const id = typeof item.id === 'string' ? item.id.slice(0, 512) : null;
	if (item.type === 'agentMessage') {
		const text = typeof item.text === 'string' ? cleanCodexVisibleText(item.text) : '';
		return text ? { id, type: 'agentMessage', text } : null;
	}
	if (item.type === 'userMessage') {
		const text = userText(item.content);
		return text ? { id, type: 'userMessage', text } : null;
	}
	const activity: Record<string, string> = {
		plan: 'Plan updated',
		commandExecution: 'Command execution',
		fileChange: 'File change',
		mcpToolCall: 'Tool call',
		dynamicToolCall: 'Tool call',
		webSearch: 'Web search'
	};
	const label = activity[item.type];
	if (!label) return null;
	return {
		id,
		type: 'activity',
		activity: item.type,
		label,
		status: typeof item.status === 'string' ? item.status.slice(0, 64) : 'unknown'
	};
};

export class CodexAppServerConnector implements LiveConnector {
	readonly id = 'codex-app-server';
	readonly label = 'Codex';
	readonly capabilities: LiveConnectorCapability[] = [
		{ id: 'read-history', available: true, requiresLocalApproval: false },
		{ id: 'create-session', available: true, requiresLocalApproval: false },
		{ id: 'send-message', available: true, requiresLocalApproval: false },
		{ id: 'steer-turn', available: true, requiresLocalApproval: false },
		{ id: 'interrupt-turn', available: true, requiresLocalApproval: false },
		{ id: 'review-approval', available: true, requiresLocalApproval: true }
	];

	private readonly eventQueue = new AsyncEventQueue<LiveConnectorEvent>();
	private sequence = 0;
	private started = false;
	private unsubscribe: (() => void) | null = null;
	private activeTurns = new Map<string, string>();
	private busySessions = new Set<string>();
	private approvalRequests = new Map<
		string,
		{
			rpcId: RpcId;
			sessionId: string | null;
			turnId: string | null;
			itemId: string | null;
			createdAt: number;
		}
	>();
	private approvalPruneTimer: NodeJS.Timeout | null = null;
	private deltaGuards = new Map<string, DeltaGuard>();
	private commandExecutions = new Map<string, CommandExecution>();
	private sessionStateKnown = new Set<string>();
	private sessionIdleWaiters = new Map<string, Set<SessionIdleWaiter>>();
	private sessionSendTails = new Map<string, Promise<void>>();
	private blockedQueueSendCount = 0;

	constructor(
		private readonly transport: JsonRpcTransport = new JsonlRpcProcess(process.env.THINGTIME_CODEX_BIN || 'codex', ['app-server', '--stdio'], {
			timeoutMs: 60_000
		}),
		private readonly localHistory: Pick<CodexLocalHistory, 'read'> | null = null,
		private readonly projects: LocalProjectRegistry = new LocalProjectRegistry(),
		private readonly approvalRequestTtlMs = APPROVAL_REQUEST_TTL_MS,
		private readonly queueWaitTimeoutMs = QUEUE_WAIT_TIMEOUT_MS
	) {}

	async start(): Promise<void> {
		if (this.started) return;
		this.unsubscribe = this.transport.onMessage((message) => this.handleMessage(message));
		await this.transport.start();
		await this.transport.call('initialize', {
			clientInfo: { name: 'thingtime-node', title: 'Thingtime Node', version: '0.1.0' },
			capabilities: { experimentalApi: true, requestAttestation: false }
		});
		await this.transport.notify('initialized');
		this.started = true;
		this.emit('connector.ready', null, null, null, { transport: 'local-stdio' });
	}

	async stop(): Promise<void> {
		if (!this.started) return;
		this.started = false;
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.rejectSessionIdleWaiters(new Error('Connector stopped before the queued message could be delivered.'));
		this.busySessions.clear();
		this.activeTurns.clear();
		this.sessionStateKnown.clear();
		if (this.approvalPruneTimer) clearTimeout(this.approvalPruneTimer);
		this.approvalPruneTimer = null;
		const pendingApprovals = [...this.approvalRequests.values()];
		this.approvalRequests.clear();
		await Promise.allSettled(pendingApprovals.map((pending) => this.transport.respond(pending.rpcId, { decision: 'cancel' })));
		this.deltaGuards.clear();
		await this.transport.stop();
		this.emit('connector.stopped', null, null, null, {});
	}

	/**
	 * A single state-db-backed page is enough to make recent Codex working
	 * directories available on a fresh node. `toSession` registers each cwd
	 * locally, while callers only receive opaque ids and basename labels from
	 * the registry. Keep this to one bounded page so startup metadata discovery
	 * cannot turn into an unbounded history scan.
	 */
	async refreshProjects(): Promise<void> {
		await this.listSessions({ limit: 100 });
	}

	async listSessions(options: { cursor?: string | null; limit?: number; search?: string | null } = {}) {
		this.requireStarted();
		const response = await this.transport.call<{ data: CodexThread[]; nextCursor?: string | null }>('thread/list', {
			cursor: options.cursor ?? null,
			limit: Math.min(Math.max(options.limit ?? 50, 1), 100),
			sortKey: 'updated_at',
			sortDirection: 'desc',
			searchTerm: options.search ?? null,
			useStateDbOnly: true
		});
		return {
			sessions: response.data.map((thread) => this.toSession(thread)),
			nextCursor: response.nextCursor ?? null
		};
	}

	async readSession(request: { sessionId: string; cursor?: string | null; limit?: number }): Promise<LiveSessionPage> {
		this.requireStarted();
		if (request.cursor?.startsWith('local:')) {
			const localPage = await this.localHistory?.read(request);
			if (localPage) return localPage;
			throw new Error('That local history page is no longer available.');
		}
		try {
			const response = await this.transport.call<{
				data: Array<CodexTurn & { startedAt?: number | null; completedAt?: number | null }>;
				nextCursor?: string | null;
				backwardsCursor?: string | null;
			}>('thread/turns/list', {
				threadId: request.sessionId,
				cursor: request.cursor ?? null,
				limit: Math.min(Math.max(request.limit ?? 30, 1), 100),
				sortDirection: 'desc',
				itemsView: 'full'
			});
			const entries = [...response.data].reverse().flatMap((turn) => this.turnEntries(turn));
			const newestTurn = response.data[0];
			if (newestTurn?.status === 'inProgress') {
				this.sessionStateKnown.add(request.sessionId);
				this.busySessions.add(request.sessionId);
				this.activeTurns.set(request.sessionId, newestTurn.id);
			} else {
				this.markSessionIdle(request.sessionId);
			}
			return {
				sessionId: request.sessionId,
				entries,
				nextCursor: response.nextCursor ?? null,
				backwardsCursor: response.backwardsCursor ?? null,
				source: 'native'
			};
		} catch (error) {
			const localPage = await this.localHistory?.read(request);
			if (!localPage) throw error;
			this.emit('connector.warning', request.sessionId, null, null, { reason: 'native-history-fallback' });
			return localPage;
		}
	}

	async createSession(request: { commandId: string; projectPath: string; prompt?: string | null }): Promise<LiveSession> {
		this.requireStarted();
		return this.runCommand(request.commandId, request, async () => {
			const response = await this.transport.call<{ thread: CodexThread }>('thread/start', {
				cwd: request.projectPath,
				ephemeral: false,
				threadSource: 'user'
			});
			const session = this.toSession(response.thread);
			this.emit('session.started', session.id, null, null, { commandId: request.commandId, session });
			if (request.prompt?.trim()) {
				await this.sendMessage({
					commandId: `${request.commandId}:initial`,
					sessionId: session.id,
					text: request.prompt,
					mode: 'queue'
				});
			}
			return session;
		});
	}

	async sendMessage(request: SendMessageRequest): Promise<SendMessageResult> {
		this.requireStarted();
		const text = request.text.trim();
		if (!text) throw new Error('Message text is required.');
		const normalizedRequest = { ...request, text };
		return this.runCommand(request.commandId, normalizedRequest, async () => {
			if (request.mode === 'steer') {
				const expectedTurnId = request.expectedTurnId || this.activeTurns.get(request.sessionId);
				if (!expectedTurnId) throw new Error('Steering requires the currently active turn id.');
				const response = await this.transport.call<{ turnId: string }>('turn/steer', {
					threadId: request.sessionId,
					clientUserMessageId: request.commandId,
					input: textInput(text),
					expectedTurnId
				});
				this.emit('message.submitted', request.sessionId, response.turnId, null, {
					commandId: request.commandId,
					mode: 'steer',
					text
				});
				return { status: 'steered', turnId: response.turnId, queuePosition: null };
			}

			try {
				return await this.startQueuedTurn(normalizedRequest);
			} catch (error) {
				this.emit('connector.warning', request.sessionId, this.activeTurns.get(request.sessionId) ?? null, null, {
					...connectorWarning('queue_delivery_failed', request.commandId)
				});
				throw error;
			}
		});
	}

	async interrupt(request: { commandId: string; sessionId: string; turnId: string }): Promise<void> {
		this.requireStarted();
		await this.runCommand(request.commandId, request, async () => {
			await this.transport.call('turn/interrupt', { threadId: request.sessionId, turnId: request.turnId });
			this.emit('turn.interrupted', request.sessionId, request.turnId, null, { commandId: request.commandId });
		});
	}

	async respondToApproval(request: { commandId: string; requestId: string | number; decision: ApprovalDecision }): Promise<void> {
		this.requireStarted();
		await this.pruneApprovalRequests();
		await this.runCommand(request.commandId, request, async () => {
			const key = String(request.requestId);
			const pending = this.approvalRequests.get(key);
			if (!pending) throw new Error('Approval request is no longer pending.');
			this.approvalRequests.delete(key);
			try {
				await this.transport.respond(pending.rpcId, { decision: request.decision });
			} finally {
				this.scheduleApprovalPrune();
			}
			this.emit('approval.responded', pending.sessionId, pending.turnId, pending.itemId, {
				requestId: key,
				decision: request.decision,
				commandId: request.commandId
			});
		});
	}

	events(): AsyncIterable<LiveConnectorEvent> {
		return this.eventQueue;
	}

	private async startTurn(request: SendMessageRequest): Promise<SendMessageResult> {
		let response: { turn: CodexTurn };
		try {
			response = await this.transport.call<{ turn: CodexTurn }>('turn/start', {
				threadId: request.sessionId,
				clientUserMessageId: request.commandId,
				input: textInput(request.text)
			});
		} catch (error) {
			if (
				error instanceof LocalConnectorError &&
				(error.code === 'connector_timeout' || error.code === 'connector_unavailable' || error.code === 'connector_stopped')
			) {
				throw new LocalConnectorError('command_outcome_uncertain');
			}
			throw error;
		}
		this.sessionStateKnown.add(request.sessionId);
		this.activeTurns.set(request.sessionId, response.turn.id);
		this.busySessions.add(request.sessionId);
		this.emit('message.submitted', request.sessionId, response.turn.id, null, {
			commandId: request.commandId,
			mode: 'queue',
			text: request.text
		});
		return { status: 'started', turnId: response.turn.id, queuePosition: null };
	}

	private async handleMessage(message: RpcMessage): Promise<void> {
		if (!message.method) return;
		const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, any>;
		const sessionId = typeof params.threadId === 'string' ? params.threadId : null;
		const turnId = typeof params.turnId === 'string' ? params.turnId : typeof params.turn?.id === 'string' ? params.turn.id : null;
		const itemId = typeof params.itemId === 'string' ? params.itemId : typeof params.item?.id === 'string' ? params.item.id : null;

		if (message.id !== undefined && message.method.includes('requestApproval')) {
			await this.pruneApprovalRequests();
			if (this.approvalRequests.size >= MAX_PENDING_APPROVALS) {
				await this.transport.respond(message.id, { decision: 'cancel' });
				return;
			}
			const requestId = `approval-${randomUUID()}`;
			this.approvalRequests.set(requestId, { rpcId: message.id, sessionId, turnId, itemId, createdAt: Date.now() });
			this.scheduleApprovalPrune();
			this.emit('approval.requested', sessionId, turnId, itemId, {
				requestId,
				label: message.method.includes('commandExecution')
					? 'Codex wants to run a command'
					: message.method.includes('fileChange')
					? 'Codex wants to change files'
					: 'Codex requests approval'
			});
			return;
		}

		switch (message.method) {
			case 'turn/started':
				if (sessionId) {
					this.sessionStateKnown.add(sessionId);
					this.busySessions.add(sessionId);
				}
				if (sessionId && turnId) this.activeTurns.set(sessionId, turnId);
				this.emit('turn.started', sessionId, turnId, itemId, { turn: safeTurnEvent(params.turn) });
				break;
			case 'turn/completed':
				if (sessionId) {
					this.markSessionIdle(sessionId);
				}
				this.clearDeltaGuards(sessionId, turnId);
				this.emit('turn.completed', sessionId, turnId, itemId, { turn: safeTurnEvent(params.turn) });
				break;
			case 'item/agentMessage/delta':
				this.handleAgentDelta(sessionId, turnId, itemId, String(params.delta ?? '').slice(0, 32_000));
				break;
			case 'item/started': {
				const item = safeItemEvent(params.item);
				if (item) this.emit('item.started', sessionId, turnId, itemId, { item });
				break;
			}
			case 'item/completed': {
				this.handleItemCompleted(sessionId, turnId, itemId, params.item);
				break;
			}
			case 'error':
				this.emit('connector.warning', sessionId, turnId, itemId, connectorWarning('connector_reported_error'));
				break;
		}
	}

	private deltaGuardKey(sessionId: string | null, turnId: string | null, itemId: string | null): string | null {
		return sessionId && itemId ? `${sessionId}\u0000${turnId ?? ''}\u0000${itemId}` : null;
	}

	private handleAgentDelta(sessionId: string | null, turnId: string | null, itemId: string | null, delta: string): void {
		const key = this.deltaGuardKey(sessionId, turnId, itemId);
		if (!key || !delta) return;
		const guard = this.deltaGuards.get(key) ?? { pending: '', blocked: false };
		if (guard.blocked) return;
		guard.pending += delta;
		if (CODEX_INTERNAL_CONTEXT_STREAM_MARKER.test(guard.pending)) {
			guard.pending = '';
			guard.blocked = true;
			this.deltaGuards.set(key, guard);
			return;
		}
		const characters = Array.from(guard.pending);
		if (characters.length > STREAM_GUARD_TAIL_CHARS) {
			const visible = characters.slice(0, -STREAM_GUARD_TAIL_CHARS).join('');
			guard.pending = characters.slice(-STREAM_GUARD_TAIL_CHARS).join('');
			if (visible) this.emit('message.delta', sessionId, turnId, itemId, { delta: visible });
		}
		this.deltaGuards.set(key, guard);
	}

	private handleItemCompleted(sessionId: string | null, turnId: string | null, itemId: string | null, rawItem: unknown): void {
		const key = this.deltaGuardKey(sessionId, turnId, itemId);
		const guard = key ? this.deltaGuards.get(key) : null;
		if (key) this.deltaGuards.delete(key);
		const item = safeItemEvent(rawItem);
		if (!item || guard?.blocked) return;
		if (item.type === 'agentMessage' && guard?.pending) {
			this.emit('message.delta', sessionId, turnId, itemId, { delta: guard.pending });
		}
		this.emit('item.completed', sessionId, turnId, itemId, { item });
	}

	private clearDeltaGuards(sessionId: string | null, turnId: string | null): void {
		if (!sessionId) return;
		const prefix = `${sessionId}\u0000${turnId ?? ''}\u0000`;
		for (const key of this.deltaGuards.keys()) {
			if (key.startsWith(prefix)) this.deltaGuards.delete(key);
		}
	}

	private async startQueuedTurn(request: SendMessageRequest): Promise<SendMessageResult> {
		if (this.blockedQueueSendCount >= MAX_BLOCKED_QUEUE_SENDS) {
			throw new Error('The connector queue is full; delivery was not accepted.');
		}
		this.blockedQueueSendCount += 1;
		const deadline = Date.now() + this.queueWaitTimeoutMs;
		const previous = this.sessionSendTails.get(request.sessionId) ?? Promise.resolve();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.catch(() => {}).then(() => gate);
		this.sessionSendTails.set(request.sessionId, tail);
		try {
			await this.waitForQueuePredecessor(previous, deadline);
			this.requireStarted();
			await this.ensureSessionStateKnown(request.sessionId);
			await this.waitForSessionIdle(request.sessionId, deadline);
			this.requireStarted();
			return await this.startTurn(request);
		} finally {
			release();
			this.blockedQueueSendCount -= 1;
			if (this.sessionSendTails.get(request.sessionId) === tail) this.sessionSendTails.delete(request.sessionId);
		}
	}

	private waitForQueuePredecessor(previous: Promise<void>, deadline: number): Promise<void> {
		const remaining = deadline - Date.now();
		if (remaining <= 0) return Promise.reject(new Error('Queued message delivery timed out before reaching the active session.'));
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Queued message delivery timed out before reaching the active session.')), remaining);
			timer.unref();
			void previous.then(
				() => {
					clearTimeout(timer);
					resolve();
				},
				() => {
					clearTimeout(timer);
					resolve();
				}
			);
		});
	}

	private async ensureSessionStateKnown(sessionId: string): Promise<void> {
		if (this.sessionStateKnown.has(sessionId)) return;
		const response = await this.transport.call<{ data: CodexTurn[] }>('thread/turns/list', {
			threadId: sessionId,
			cursor: null,
			limit: 1,
			sortDirection: 'desc',
			itemsView: 'full'
		});
		const newestTurn = response.data[0];
		if (newestTurn?.status === 'inProgress') {
			this.sessionStateKnown.add(sessionId);
			this.busySessions.add(sessionId);
			this.activeTurns.set(sessionId, newestTurn.id);
		} else {
			this.markSessionIdle(sessionId);
		}
	}

	private waitForSessionIdle(sessionId: string, deadline: number): Promise<void> {
		this.requireStarted();
		if (!this.activeTurns.has(sessionId) && !this.busySessions.has(sessionId)) return Promise.resolve();
		const remaining = deadline - Date.now();
		if (remaining <= 0) return Promise.reject(new Error('Queued message delivery timed out while the session remained busy.'));
		return new Promise<void>((resolve, reject) => {
			let waiter!: SessionIdleWaiter;
			const timer = setTimeout(() => {
				const waiters = this.sessionIdleWaiters.get(sessionId);
				waiters?.delete(waiter);
				if (!waiters?.size) this.sessionIdleWaiters.delete(sessionId);
				reject(new Error('Queued message delivery timed out while the session remained busy.'));
			}, remaining);
			timer.unref();
			waiter = { resolve, reject, timer };
			const waiters = this.sessionIdleWaiters.get(sessionId) ?? new Set<SessionIdleWaiter>();
			waiters.add(waiter);
			this.sessionIdleWaiters.set(sessionId, waiters);
		});
	}

	private markSessionIdle(sessionId: string): void {
		this.sessionStateKnown.add(sessionId);
		this.activeTurns.delete(sessionId);
		this.busySessions.delete(sessionId);
		const waiters = this.sessionIdleWaiters.get(sessionId);
		if (!waiters) return;
		this.sessionIdleWaiters.delete(sessionId);
		for (const waiter of waiters) {
			clearTimeout(waiter.timer);
			waiter.resolve();
		}
	}

	private rejectSessionIdleWaiters(error: Error): void {
		const waiters = [...this.sessionIdleWaiters.values()].flatMap((values) => [...values]);
		this.sessionIdleWaiters.clear();
		for (const waiter of waiters) {
			clearTimeout(waiter.timer);
			waiter.reject(error);
		}
	}

	private async pruneApprovalRequests(now = Date.now()): Promise<void> {
		const expired = [...this.approvalRequests.entries()].filter(([, pending]) => now - pending.createdAt >= this.approvalRequestTtlMs);
		for (const [requestId] of expired) this.approvalRequests.delete(requestId);
		await Promise.allSettled(expired.map(([, pending]) => this.transport.respond(pending.rpcId, { decision: 'cancel' })));
		for (const [requestId, pending] of expired) {
			this.emit('approval.responded', pending.sessionId, pending.turnId, pending.itemId, {
				requestId,
				decision: 'cancel',
				reason: 'expired'
			});
		}
		this.scheduleApprovalPrune();
	}

	private scheduleApprovalPrune(): void {
		if (this.approvalPruneTimer) clearTimeout(this.approvalPruneTimer);
		this.approvalPruneTimer = null;
		if (!this.started || !this.approvalRequests.size) return;
		const earliestExpiry = Math.min(...[...this.approvalRequests.values()].map((pending) => pending.createdAt + this.approvalRequestTtlMs));
		const timer = setTimeout(() => {
			this.approvalPruneTimer = null;
			void this.pruneApprovalRequests().catch(() => {});
		}, Math.max(0, earliestExpiry - Date.now()));
		timer.unref();
		this.approvalPruneTimer = timer;
	}

	private runCommand<T>(commandId: string, payload: unknown, operation: () => Promise<T>): Promise<T> {
		const fingerprint = JSON.stringify(payload);
		const previous = this.commandExecutions.get(commandId);
		if (previous) {
			if (previous.fingerprint !== fingerprint) {
				return Promise.reject(new Error('That command id was already used with different input.'));
			}
			return previous.result as Promise<T>;
		}
		const result = operation().catch((error) => {
			this.commandExecutions.delete(commandId);
			throw error;
		});
		this.commandExecutions.set(commandId, { fingerprint, result });
		while (this.commandExecutions.size > 1_000) {
			const oldest = this.commandExecutions.keys().next().value;
			if (oldest === undefined) break;
			this.commandExecutions.delete(oldest);
		}
		return result;
	}

	private toSession(thread: CodexThread): LiveSession {
		const activeTurnId =
			thread.status?.type === 'active' ? thread.status.activeTurnId ?? this.activeTurns.get(thread.id) ?? null : thread.status?.activeTurnId ?? null;
		if (thread.status?.type === 'active' || activeTurnId) {
			this.sessionStateKnown.add(thread.id);
			this.busySessions.add(thread.id);
			if (activeTurnId) this.activeTurns.set(thread.id, activeTurnId);
		} else {
			this.markSessionIdle(thread.id);
		}
		let project: { projectId: string; projectLabel: string } | null = null;
		if (thread.cwd) {
			try {
				project = this.projects.register(thread.cwd);
			} catch {
				project = null;
			}
		}
		const safeName = cleanCodexVisibleText(thread.name ?? '', 120);
		const safePreview = cleanCodexVisibleText(thread.preview ?? '', 500);
		return {
			id: thread.id,
			connectorId: this.id,
			title: safeName || safePreview.split('\n')[0]?.slice(0, 120) || 'Untitled Codex chat',
			preview: safePreview,
			projectId: project?.projectId ?? null,
			projectLabel: project?.projectLabel ?? null,
			createdAt: isoFromSeconds(thread.createdAt),
			updatedAt: isoFromSeconds(thread.updatedAt),
			activeTurnId,
			status: threadStatus(thread),
			source: thread.source ?? null
		};
	}

	private turnEntries(turn: CodexTurn & { startedAt?: number | null; completedAt?: number | null }): LiveSessionEntry[] {
		const observedAt = isoFromSeconds(turn.completedAt ?? turn.startedAt);
		const messageStatus = turnEntryStatus(turn.status);
		return (Array.isArray(turn.items) ? turn.items : []).flatMap((rawItem): LiveSessionEntry[] => {
			const item = record(rawItem);
			if (!item || typeof item.id !== 'string') return [];
			if (item.type === 'userMessage') {
				const text = userText(item.content);
				return text ? [{ id: item.id, turnId: turn.id, type: 'message', role: 'user', text, status: messageStatus, observedAt }] : [];
			}
			if (item.type === 'agentMessage' && typeof item.text === 'string') {
				const text = cleanCodexVisibleText(item.text);
				return text ? [{ id: item.id, turnId: turn.id, type: 'message', role: 'assistant', text, status: messageStatus, observedAt }] : [];
			}
			if (item.type === 'plan') {
				return [{ id: item.id, turnId: turn.id, type: 'activity', activity: 'plan', label: 'Plan updated', status: messageStatus, observedAt }];
			}
			if (item.type === 'commandExecution') {
				return [
					{
						id: item.id,
						turnId: turn.id,
						type: 'activity',
						activity: 'command',
						label: 'Command execution',
						status: String(item.status ?? messageStatus),
						observedAt
					}
				];
			}
			if (item.type === 'fileChange') {
				const count = Array.isArray(item.changes) ? item.changes.length : 0;
				return [
					{
						id: item.id,
						turnId: turn.id,
						type: 'activity',
						activity: 'file-change',
						label: count === 1 ? '1 file changed' : `${count} files changed`,
						status: String(item.status ?? messageStatus),
						observedAt
					}
				];
			}
			if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall' || item.type === 'collabAgentToolCall') {
				return [
					{
						id: item.id,
						turnId: turn.id,
						type: 'activity',
						activity: 'tool',
						label: 'Tool activity',
						status: String(item.status ?? messageStatus),
						observedAt
					}
				];
			}
			if (item.type === 'webSearch') {
				return [{ id: item.id, turnId: turn.id, type: 'activity', activity: 'web-search', label: 'Web search', status: messageStatus, observedAt }];
			}
			return [];
		});
	}

	private emit(
		type: LiveConnectorEvent['type'],
		sessionId: string | null,
		turnId: string | null,
		itemId: string | null,
		payload: Record<string, unknown>
	): void {
		this.eventQueue.push({
			connectorId: this.id,
			sequence: ++this.sequence,
			observedAt: new Date().toISOString(),
			sessionId,
			turnId,
			itemId,
			type,
			payload
		});
	}

	private requireStarted(): void {
		if (!this.started) throw new Error('Codex connector is not started.');
	}
}
