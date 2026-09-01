import React from 'react';

import { useDeviceApi, type PublicDeviceEvent } from '~/components/Devices/useDeviceApi';
import { readAgentSessionCache, writeAgentSessionCache } from './agentSessionCache';
import {
	initialAgentSession,
	reduceAgentSession,
	type AgentSessionEvent,
	type AgentSessionMessage,
	type AgentSessionState
} from './agentSessionCore';
import type { AgentSendMode } from './AgentComposerControls';
import {
	MAX_LIVE_SESSION_READ_PAGES_PER_OPEN,
	planLiveSessionRead,
	waitForLiveSessionReadCommand
} from './liveSessionRead';
import type { LiveAiSource } from './messengerTypes';

const EVENT_TYPES = new Set<AgentSessionEvent['type']>([
	'message.queued',
	'message.submitted',
	'message.delta',
	'item.started',
	'item.completed',
	'turn.started',
	'turn.completed',
	'turn.interrupted',
	'approval.requested',
	'approval.responded',
	'connector.warning'
]);

const record = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const deviceEventToAgentEvent = (source: LiveAiSource, event: PublicDeviceEvent): AgentSessionEvent | null => {
	if (event.type !== 'ai.session-event') return null;
	const envelope = record(event.payload);
	const payload = record(envelope?.payload);
	const type = envelope?.type;
	if (
		event.deviceId !== source.deviceId ||
		envelope?.connectorId !== source.connectorId ||
		envelope?.sessionId !== source.sessionId ||
		typeof envelope.sequence !== 'number' ||
		!Number.isSafeInteger(envelope.sequence) ||
		envelope.sequence < 1 ||
		typeof envelope.observedAt !== 'string' ||
		typeof type !== 'string' ||
		!EVENT_TYPES.has(type as AgentSessionEvent['type']) ||
		!payload
	)
		return null;
	return {
		id: event.id,
		sequence: envelope.sequence,
		observedAt: envelope.observedAt,
		sessionId: source.sessionId,
		turnId: typeof envelope.turnId === 'string' ? envelope.turnId : null,
		itemId: typeof envelope.itemId === 'string' ? envelope.itemId : null,
		type: type as AgentSessionEvent['type'],
		payload
	};
};

type SendInput = { text: string; requestId: string; mode: AgentSendMode };

export const useAgentSession = (userId: string | null, source: LiveAiSource | null, onHistoryChanged?: () => void) => {
	const api = useDeviceApi();
	const sourceKey = source ? `${source.deviceId}\u0000${source.connectorId}\u0000${source.sessionId}` : '';
	const [state, setState] = React.useState<AgentSessionState>(() =>
		source ? readAgentSessionCache(userId, source.deviceId, source.connectorId, source.sessionId) : initialAgentSession('')
	);
	const [connected, setConnected] = React.useState(false);
	const stateRef = React.useRef(state);
	const sourceRef = React.useRef(source);
	const approvalRequests = React.useRef(new Map<string, string>());
	const dispatchApprovals = React.useRef(new Map<string, string>());
	const interruptRequests = React.useRef(new Map<string, string>());
	const requestedHistoryPages = React.useRef(new Set<string>());
	const historyPageCount = React.useRef(0);
	const onHistoryChangedRef = React.useRef(onHistoryChanged);
	stateRef.current = state;
	sourceRef.current = source;
	onHistoryChangedRef.current = onHistoryChanged;

	React.useEffect(() => {
		const selected = sourceRef.current;
		setState(selected ? readAgentSessionCache(userId, selected.deviceId, selected.connectorId, selected.sessionId) : initialAgentSession(''));
		setConnected(false);
		approvalRequests.current.clear();
		dispatchApprovals.current.clear();
		interruptRequests.current.clear();
		requestedHistoryPages.current.clear();
		historyPageCount.current = 0;
	}, [sourceKey, userId]);

	React.useEffect(() => {
		const selected = sourceRef.current;
		if (!selected) return;
		writeAgentSessionCache(userId, selected.deviceId, selected.connectorId, state);
	}, [sourceKey, state, userId]);

	React.useEffect(() => {
		const selected = sourceRef.current;
		if (!selected) return;
		let cancelled = false;
		let cursor: string | null = null;
		let controller: AbortController | null = null;
		const poll = async () => {
			while (!cancelled) {
				controller = new AbortController();
				try {
					const page = await api.pollEvents({ deviceId: selected.deviceId, cursor, waitMs: 20_000, limit: 200 }, controller.signal);
					if (cancelled) return;
					cursor = page.cursor;
					setConnected(true);
					const events = page.events
						.map((event) => deviceEventToAgentEvent(selected, event))
						.filter((event): event is AgentSessionEvent => Boolean(event));
					if (events.length) setState((current) => events.reduce(reduceAgentSession, current));
				} catch (error) {
					if (cancelled || (error instanceof Error && error.name === 'AbortError')) return;
					setConnected(false);
					await new Promise((resolve) => window.setTimeout(resolve, 1_500));
				}
			}
		};
		void poll();
		return () => {
			cancelled = true;
			controller?.abort();
		};
	}, [api, sourceKey]);

	const captureDispatchApproval = React.useCallback(
		async (deviceId: string, commandId: string) => {
			const approvals = await api.listApprovals(deviceId);
			const approval = approvals.approvals.find((entry) => entry.commandId === commandId && entry.status === 'pending');
			if (!approval) return;
			const localID = `dispatch:${approval.id}`;
			dispatchApprovals.current.set(localID, approval.id);
			setState((current) =>
				current.approvals.some((entry) => entry.id === localID)
					? current
					: {
							...current,
							status: 'waiting-approval',
							approvals: [
								...current.approvals,
								{
									id: localID,
									turnId: null,
									itemId: commandId,
									status: 'pending',
									label: approval.prompt || 'Allow Thingtime to control the visible desktop chat once',
									observedAt: approval.createdAt
								}
							]
					  }
			);
		},
		[api]
	);

	const notifyHistoryChanged = React.useCallback(() => {
		onHistoryChangedRef.current?.();
	}, []);

	React.useEffect(() => {
		const selected = sourceRef.current;
		const plan = planLiveSessionRead(selected);
		if (
			!selected ||
			!plan ||
			requestedHistoryPages.current.has(plan.pageKey) ||
			historyPageCount.current >= MAX_LIVE_SESSION_READ_PAGES_PER_OPEN
		)
			return;
		requestedHistoryPages.current.add(plan.pageKey);
		historyPageCount.current += 1;
		const controller = new AbortController();
		void api
			.createCommand({ ...plan.command, requestId: plan.requestId }, controller.signal)
			.then(async (response) => {
				if (controller.signal.aborted) return;
				if (response.command.status === 'needs-approval') {
					await captureDispatchApproval(selected.deviceId, response.command.id);
				}
				const outcome = await waitForLiveSessionReadCommand({
					command: response.command,
					loadCommands: async (signal) => (await api.listCommands(selected.deviceId, signal)).commands,
					signal: controller.signal
				});
				if (!controller.signal.aborted && outcome === 'succeeded') notifyHistoryChanged();
			})
			.catch(() => {
				// A deterministic request id makes a remount/retry safe. Do not spin
				// on a known rejection while this chat remains open.
			});
		return () => {
			controller.abort();
		};
	}, [api, captureDispatchApproval, notifyHistoryChanged, source?.historyCursor, source?.historyHasMore, source?.historySyncedAt, sourceKey]);

	const send = React.useCallback(
		async ({ text, requestId, mode }: SendInput) => {
			const selected = sourceRef.current;
			if (!selected) throw new Error('This is not a live agent session.');
			const activeTurnId = stateRef.current.activeTurnId;
			if (mode === 'steer' && !activeTurnId) throw new Error('There is no active turn to steer.');
			const response = await api.createCommand({
				deviceId: selected.deviceId,
				requestId,
				kind: 'session.send',
				input: {
					connectorId: selected.connectorId,
					sessionId: selected.sessionId,
					text,
					delivery: mode,
					...(mode === 'steer' ? { expectedTurnId: activeTurnId } : {})
				},
				requiresApproval: selected.capabilities.includes('explicit-approval')
			});
			const commandId = response.command.id;
			setState((current) => {
				if (current.messages.some((message) => message.commandId === commandId)) return current;
				const optimistic: AgentSessionMessage = {
					id: `command:${commandId}`,
					commandId,
					turnId: mode === 'steer' ? activeTurnId : null,
					role: 'user',
					text,
					delivery: 'queued',
					queuePosition: mode === 'queue' ? current.queueDepth + 1 : null,
					observedAt: new Date().toISOString()
				};
				return {
					...current,
					status: mode === 'steer' ? 'running' : 'queued',
					queueDepth: mode === 'queue' ? current.queueDepth + 1 : current.queueDepth,
					messages: [...current.messages, optimistic]
				};
			});
			if (response.command.status === 'needs-approval') {
				await captureDispatchApproval(selected.deviceId, commandId);
			}
			return response.command;
		},
		[api, captureDispatchApproval]
	);

	const interrupt = React.useCallback(async () => {
		const selected = sourceRef.current;
		if (!selected || !stateRef.current.activeTurnId) return;
		const turnId = stateRef.current.activeTurnId;
		const requestId = interruptRequests.current.get(turnId) || crypto.randomUUID();
		interruptRequests.current.set(turnId, requestId);
		await api.createCommand({
			deviceId: selected.deviceId,
			requestId,
			kind: 'session.interrupt',
			input: { connectorId: selected.connectorId, sessionId: selected.sessionId, turnId },
			requiresApproval: false
		});
	}, [api]);

	const respondToApproval = React.useCallback(
		async (approvalId: string, decision: 'approved' | 'denied') => {
			const selected = sourceRef.current;
			if (!selected) return;
			const dispatchApprovalID = dispatchApprovals.current.get(approvalId);
			if (dispatchApprovalID) {
				await api.decideApproval({ approvalId: dispatchApprovalID, decision });
				dispatchApprovals.current.delete(approvalId);
				setState((current) => ({
					...current,
					status: decision === 'approved' ? 'queued' : 'idle',
					approvals: current.approvals.map((approval) =>
						approval.id === approvalId ? { ...approval, status: decision === 'approved' ? 'accepted' : 'declined' } : approval
					)
				}));
				if (decision === 'approved') notifyHistoryChanged();
				return;
			}
			const key = `${approvalId}:${decision}`;
			const requestId = approvalRequests.current.get(key) || crypto.randomUUID();
			approvalRequests.current.set(key, requestId);
			await api.createCommand({
				deviceId: selected.deviceId,
				requestId,
				kind: 'approval.respond',
				input: { connectorId: selected.connectorId, approvalId, decision },
				requiresApproval: false
			});
		},
		[api, notifyHistoryChanged]
	);

	const capabilities = new Set(source?.capabilities || []);
	const running = state.status === 'running' || state.status === 'queued' || state.status === 'waiting-approval';
	return {
		state,
		connected,
		send,
		interrupt,
		respondToApproval,
		controls: {
			running,
			canQueue: capabilities.has('send-message'),
			canSteer: capabilities.has('steer-turn') && Boolean(state.activeTurnId),
			canInterrupt: capabilities.has('interrupt-turn') && Boolean(state.activeTurnId),
			queueDepth: state.queueDepth
		}
	};
};
