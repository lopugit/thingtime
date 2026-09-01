export type AgentSessionStatus = 'idle' | 'queued' | 'running' | 'waiting-approval' | 'completed' | 'interrupted' | 'failed';

export type AgentDeliveryStatus = 'queued' | 'submitted' | 'streaming' | 'complete' | 'failed' | 'interrupted';

export type AgentSessionMessage = {
	id: string;
	commandId: string | null;
	turnId: string | null;
	role: 'user' | 'assistant';
	text: string;
	delivery: AgentDeliveryStatus;
	queuePosition: number | null;
	observedAt: string;
};

export type AgentApproval = {
	id: string;
	turnId: string | null;
	itemId: string | null;
	status: 'pending' | 'accepted' | 'declined' | 'expired';
	label: string;
	observedAt: string;
};

export type AgentActivity = {
	id: string;
	turnId: string | null;
	kind: string;
	label: string;
	status: string;
	observedAt: string;
};

export type AgentSessionEvent = {
	id: string;
	sequence: number;
	observedAt: string;
	sessionId: string;
	turnId: string | null;
	itemId: string | null;
	type:
		| 'message.queued'
		| 'message.submitted'
		| 'message.delta'
		| 'item.started'
		| 'item.completed'
		| 'turn.started'
		| 'turn.completed'
		| 'turn.interrupted'
		| 'approval.requested'
		| 'approval.responded'
		| 'connector.warning';
	payload: Record<string, unknown>;
};

export type AgentSessionState = {
	sessionId: string;
	sequence: number;
	status: AgentSessionStatus;
	activeTurnId: string | null;
	queueDepth: number;
	messages: AgentSessionMessage[];
	activities: AgentActivity[];
	approvals: AgentApproval[];
	warning: string | null;
};

export const initialAgentSession = (sessionId: string): AgentSessionState => ({
	sessionId,
	sequence: 0,
	status: 'idle',
	activeTurnId: null,
	queueDepth: 0,
	messages: [],
	activities: [],
	approvals: [],
	warning: null
});

const text = (value: unknown, max = 256_000): string => (typeof value === 'string' ? value.slice(0, max) : '');

const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const terminal = (delivery: AgentDeliveryStatus) => delivery === 'complete' || delivery === 'failed' || delivery === 'interrupted';

const updateMessage = (
	messages: AgentSessionMessage[],
	id: string,
	update: (message: AgentSessionMessage) => AgentSessionMessage
): AgentSessionMessage[] => messages.map((message) => (message.id === id ? update(message) : message));

const assistantId = (event: AgentSessionEvent) => event.itemId || `${event.turnId || 'turn'}:assistant`;

const commandMessageId = (commandId: string) => `command:${commandId}`;

const commandMessage = (messages: AgentSessionMessage[], commandId: string): AgentSessionMessage | undefined => {
	const id = commandMessageId(commandId);
	return messages.find((message) => message.commandId === commandId || message.id === id);
};

const activityFromEvent = (event: AgentSessionEvent): AgentActivity | null => {
	const item = event.payload.item && typeof event.payload.item === 'object' ? (event.payload.item as Record<string, unknown>) : null;
	if (item?.type !== 'activity') return null;
	const id = text(item.id, 160) || event.itemId;
	const kind = text(item.activity, 64);
	const label = text(item.label, 160);
	const status = text(item.status, 64);
	return id && kind && label && status ? { id, turnId: event.turnId, kind, label, status, observedAt: event.observedAt } : null;
};

const upsertActivity = (activities: AgentActivity[], activity: AgentActivity): AgentActivity[] => {
	const existing = activities.findIndex((entry) => entry.id === activity.id);
	const next = existing < 0 ? [...activities, activity] : activities.map((entry, index) => (index === existing ? activity : entry));
	return next.slice(-50);
};

export const reduceAgentSession = (state: AgentSessionState, event: AgentSessionEvent): AgentSessionState => {
	if (event.sessionId !== state.sessionId || event.sequence <= state.sequence) return state;
	let next: AgentSessionState = { ...state, sequence: event.sequence };
	const commandId = text(event.payload.commandId, 512) || null;

	switch (event.type) {
		case 'message.queued': {
			if (!commandId || commandMessage(state.messages, commandId)) return next;
			const queuePosition = number(event.payload.queuePosition) ?? state.queueDepth + 1;
			return {
				...next,
				status: 'queued',
				queueDepth: Math.max(state.queueDepth, queuePosition),
				messages: [
					...state.messages,
					{
						id: commandMessageId(commandId),
						commandId,
						turnId: null,
						role: 'user',
						text: text(event.payload.text),
						delivery: 'queued',
						queuePosition,
						observedAt: event.observedAt
					}
				]
			};
		}
		case 'message.submitted': {
			if (!commandId) return next;
			const existing = commandMessage(state.messages, commandId);
			const submitted: AgentSessionMessage = {
				id: existing?.id || commandMessageId(commandId),
				commandId,
				turnId: event.turnId,
				role: 'user',
				text: existing?.text || text(event.payload.text),
				delivery: 'submitted',
				queuePosition: null,
				observedAt: existing?.observedAt || event.observedAt
			};
			return {
				...next,
				status: 'running',
				activeTurnId: event.turnId,
				queueDepth: existing?.delivery === 'queued' ? Math.max(0, state.queueDepth - 1) : state.queueDepth,
				messages: existing
					? state.messages.map((message) => (message.id === existing.id ? (terminal(existing.delivery) ? existing : submitted) : message))
					: [...state.messages, submitted]
			};
		}
		case 'turn.started':
			return { ...next, status: 'running', activeTurnId: event.turnId || state.activeTurnId };
		case 'message.delta': {
			if (!event.turnId || (state.activeTurnId && event.turnId !== state.activeTurnId)) return next;
			const id = assistantId(event);
			const existing = state.messages.find((message) => message.id === id);
			if (existing && terminal(existing.delivery)) return next;
			const delta = text(event.payload.delta);
			if (!delta) return next;
			const message: AgentSessionMessage = existing
				? { ...existing, text: `${existing.text}${delta}`, delivery: 'streaming' }
				: {
						id,
						commandId: null,
						turnId: event.turnId,
						role: 'assistant',
						text: delta,
						delivery: 'streaming',
						queuePosition: null,
						observedAt: event.observedAt
				  };
			return {
				...next,
				status: 'running',
				activeTurnId: event.turnId,
				messages: existing ? updateMessage(state.messages, id, () => message) : [...state.messages, message]
			};
		}
		case 'item.started': {
			const activity = activityFromEvent(event);
			return activity ? { ...next, status: 'running', activities: upsertActivity(state.activities, activity) } : next;
		}
		case 'item.completed': {
			const item = event.payload.item && typeof event.payload.item === 'object' ? (event.payload.item as Record<string, unknown>) : null;
			const activity = activityFromEvent(event);
			if (activity) return { ...next, activities: upsertActivity(state.activities, activity) };
			// User prompts are reconciled by message.submitted. Activity completions
			// are rendered by the activity timeline, not duplicated as chat bubbles.
			if (item?.type !== 'agentMessage') return next;
			const id = assistantId(event);
			const finalText = text(item?.text);
			const existing = state.messages.find((message) => message.id === id);
			if (!existing && finalText) {
				return {
					...next,
					messages: [
						...state.messages,
						{
							id,
							commandId: null,
							turnId: event.turnId,
							role: 'assistant',
							text: finalText,
							delivery: 'complete',
							queuePosition: null,
							observedAt: event.observedAt
						}
					]
				};
			}
			return {
				...next,
				messages: updateMessage(state.messages, id, (message) =>
					terminal(message.delivery) ? message : { ...message, text: finalText || message.text, delivery: 'complete' }
				)
			};
		}
		case 'approval.requested': {
			const id = text(event.payload.requestId, 512) || event.id;
			if (state.approvals.some((approval) => approval.id === id)) return next;
			return {
				...next,
				status: 'waiting-approval',
				approvals: [
					...state.approvals,
					{
						id,
						turnId: event.turnId,
						itemId: event.itemId,
						status: 'pending',
						label: text(event.payload.label, 160) || 'Approval requested',
						observedAt: event.observedAt
					}
				]
			};
		}
		case 'approval.responded': {
			const id = text(event.payload.requestId, 512);
			const decision = text(event.payload.decision, 64);
			const expired = event.payload.reason === 'expired';
			const approvals = state.approvals.map((approval) =>
				approval.id === id
					? {
							...approval,
							status: expired ? ('expired' as const) : decision === 'decline' || decision === 'cancel' ? ('declined' as const) : ('accepted' as const)
					  }
					: approval
			);
			return {
				...next,
				status: approvals.some((approval) => approval.status === 'pending') ? 'waiting-approval' : state.activeTurnId ? 'running' : 'idle',
				approvals
			};
		}
		case 'turn.completed': {
			const rawStatus = text((event.payload.turn as Record<string, unknown> | undefined)?.status, 64);
			const status: AgentSessionStatus =
				rawStatus === 'failed' ? 'failed' : rawStatus === 'interrupted' ? 'interrupted' : state.queueDepth > 0 ? 'queued' : 'completed';
			const delivery: AgentDeliveryStatus = status === 'failed' ? 'failed' : status === 'interrupted' ? 'interrupted' : 'complete';
			return {
				...next,
				status,
				activeTurnId: null,
				messages: state.messages.map((message) =>
					message.turnId === event.turnId && !terminal(message.delivery) ? { ...message, delivery } : message
				)
			};
		}
		case 'turn.interrupted':
			return {
				...next,
				status: 'interrupted',
				activeTurnId: null,
				messages: state.messages.map((message) =>
					message.turnId === event.turnId && !terminal(message.delivery) ? { ...message, delivery: 'interrupted' } : message
				)
			};
		case 'connector.warning': {
			const failedCommandId = text(event.payload.commandId, 512);
			const queued = failedCommandId
				? state.messages.find((message) => message.commandId === failedCommandId && message.delivery === 'queued')
				: null;
			const queueDepth = queued ? Math.max(0, state.queueDepth - 1) : state.queueDepth;
			return {
				...next,
				status: queued && !state.activeTurnId ? (queueDepth > 0 ? 'queued' : 'failed') : next.status,
				queueDepth,
				messages: queued
					? state.messages.map((message) =>
							message.commandId === failedCommandId ? { ...message, delivery: 'failed', queuePosition: null } : message
					  )
					: state.messages,
				warning: text(event.payload.message, 500) || 'The connector reported a warning.'
			};
		}
		default:
			return next;
	}
};

export const cacheableAgentSession = (state: AgentSessionState) => ({
	sessionId: state.sessionId,
	messages: state.messages
		.filter((message) => message.delivery === 'complete')
		.slice(-200)
		.map(({ commandId: _commandId, queuePosition: _queuePosition, ...message }) => message)
});
