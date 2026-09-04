export type LiveConnectorPermission =
	| 'read-history'
	| 'create-session'
	| 'send-message'
	| 'steer-turn'
	| 'interrupt-turn'
	| 'review-approval'
	| 'accessibility'
	| 'screen-recording';

export type LiveConnectorCapability = {
	id: LiveConnectorPermission;
	available: boolean;
	requiresLocalApproval: boolean;
	detail?: string | null;
};

export type LiveSession = {
	id: string;
	connectorId: string;
	title: string;
	preview: string;
	projectId: string | null;
	projectLabel: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	activeTurnId: string | null;
	status: 'idle' | 'running' | 'waiting-approval' | 'unknown';
	source: string | null;
};

export type LiveSessionEntry =
	| {
			id: string;
			turnId: string;
			type: 'message';
			role: 'user' | 'assistant';
			text: string;
			status: 'streaming' | 'complete' | 'interrupted' | 'failed';
			observedAt: string | null;
	  }
	| {
			id: string;
			turnId: string;
			type: 'activity';
			activity: 'command' | 'file-change' | 'tool' | 'web-search' | 'plan' | 'other';
			label: string;
			status: string;
			observedAt: string | null;
	  };

export type LiveSessionPage = {
	sessionId: string;
	entries: LiveSessionEntry[];
	nextCursor: string | null;
	backwardsCursor: string | null;
	source: 'native' | 'local-fallback';
};

export type LiveConnectorEvent = {
	connectorId: string;
	sequence: number;
	observedAt: string;
	sessionId: string | null;
	turnId: string | null;
	itemId: string | null;
	type:
		| 'connector.ready'
		| 'connector.stopped'
		| 'session.started'
		| 'message.queued'
		| 'message.submitted'
		| 'turn.started'
		| 'turn.completed'
		| 'turn.interrupted'
		| 'message.delta'
		| 'item.started'
		| 'item.completed'
		| 'approval.requested'
		| 'approval.responded'
		| 'connector.warning';
	payload: Record<string, unknown>;
};

export type SendMessageRequest = {
	commandId: string;
	sessionId: string;
	text: string;
	mode: 'queue' | 'steer';
	expectedTurnId?: string | null;
};

export type SendMessageResult = {
	status: 'started' | 'queued' | 'steered';
	turnId: string | null;
	queuePosition: number | null;
};

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

export type LiveConnector = {
	readonly id: string;
	readonly label: string;
	readonly capabilities: LiveConnectorCapability[];
	start(): Promise<void>;
	stop(): Promise<void>;
	/**
	 * Refreshes the connector's local project registry without returning local
	 * working directories across the runtime wire. Implementations must keep
	 * discovery bounded and expose only their path-free registry references.
	 */
	refreshProjects?(): Promise<void>;
	listSessions(options?: { cursor?: string | null; limit?: number; search?: string | null }): Promise<{
		sessions: LiveSession[];
		nextCursor: string | null;
	}>;
	readSession(request: { sessionId: string; cursor?: string | null; limit?: number }): Promise<LiveSessionPage>;
	createSession(request: { commandId: string; projectPath: string; prompt?: string | null }): Promise<LiveSession>;
	sendMessage(request: SendMessageRequest): Promise<SendMessageResult>;
	interrupt(request: { commandId: string; sessionId: string; turnId: string }): Promise<void>;
	respondToApproval(request: { commandId: string; requestId: string | number; decision: ApprovalDecision }): Promise<void>;
	events(): AsyncIterable<LiveConnectorEvent>;
};

export class AsyncEventQueue<T> implements AsyncIterable<T> {
	private values: T[] = [];
	private waiters: Array<(result: IteratorResult<T>) => void> = [];
	private closed = false;

	push(value: T): void {
		if (this.closed) return;
		const waiter = this.waiters.shift();
		if (waiter) waiter({ value, done: false });
		else this.values.push(value);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as T, done: true });
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: () => {
				const value = this.values.shift();
				if (value !== undefined) return Promise.resolve({ value, done: false });
				if (this.closed) return Promise.resolve({ value: undefined as T, done: true });
				return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
			}
		};
	}
}
