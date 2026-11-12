import assert from 'node:assert/strict';
import test from 'node:test';

import { cacheableAgentSession, initialAgentSession, reduceAgentSession, type AgentSessionEvent } from './agentSessionCore';
import { agentSessionCacheKey, restoreAgentSessionCache } from './agentSessionCache';

const event = (
	sequence: number,
	type: AgentSessionEvent['type'],
	payload: Record<string, unknown> = {},
	extra: Partial<AgentSessionEvent> = {}
): AgentSessionEvent => ({
	id: `event-${sequence}`,
	sequence,
	observedAt: `2026-01-01T00:00:0${sequence}.000Z`,
	sessionId: 'session-1',
	turnId: 'turn-1',
	itemId: null,
	type,
	payload,
	...extra
});

test('agent session cache keys are scoped to user, device, connector, and session', () => {
	assert.notEqual(agentSessionCacheKey('user-1', 'device-1', 'codex', 'session-1'), agentSessionCacheKey('user-1', 'device-2', 'codex', 'session-1'));
	assert.match(agentSessionCacheKey('user@example.com', 'device/1', 'codex', 'session'), /^tt-agent-session:/);
});

test('cache projection excludes pending commands and approval state', () => {
	const state = initialAgentSession('session-1');
	state.messages.push({
		id: 'pending',
		commandId: 'secret-command',
		turnId: null,
		role: 'user',
		text: 'pending',
		delivery: 'queued',
		queuePosition: 1,
		observedAt: '2026-01-01T00:00:00.000Z'
	});
	state.messages.push({
		id: 'complete',
		commandId: 'secret-command-2',
		turnId: 'turn-1',
		role: 'assistant',
		text: 'done',
		delivery: 'complete',
		queuePosition: null,
		observedAt: '2026-01-01T00:00:01.000Z'
	});
	state.approvals.push({
		id: 'secret-approval',
		turnId: 'turn-1',
		itemId: 'tool-1',
		status: 'pending',
		label: 'Sensitive approval',
		observedAt: '2026-01-01T00:00:01.000Z'
	});
	const cached = cacheableAgentSession(state);
	const serialized = JSON.stringify(cached);
	assert.equal(cached.messages.length, 1);
	assert.doesNotMatch(serialized, /secret-command|secret-approval|Sensitive approval|pending/);
	assert.equal('sequence' in cached, false);
	assert.equal('status' in cached, false);
});

test('reload replays a pending approval without duplicating durable messages', () => {
	const retainedEvents = [
		event(1, 'message.queued', { commandId: 'command-1', text: 'run it', queuePosition: 1 }),
		event(2, 'message.submitted', { commandId: 'command-1', text: 'run it' }),
		event(3, 'message.delta', { delta: 'done' }, { itemId: 'agent-1' }),
		event(4, 'item.completed', { item: { type: 'agentMessage', text: 'done' } }, { itemId: 'agent-1' }),
		event(5, 'turn.completed', { turn: { status: 'completed' } }),
		event(6, 'turn.started', {}, { turnId: 'turn-2' }),
		event(7, 'approval.requested', { requestId: 'approval-2', label: 'Run a command' }, { itemId: 'tool-2', turnId: 'turn-2' })
	];
	const beforeReload = retainedEvents.slice(0, 5).reduce(reduceAgentSession, initialAgentSession('session-1'));
	const cached = {
		version: 2,
		writtenAt: '2026-01-01T00:00:06.000Z',
		...cacheableAgentSession(beforeReload)
	};
	const restored = restoreAgentSessionCache('session-1', cached);
	assert.equal(restored.sequence, 0);
	assert.equal(restored.status, 'idle');
	assert.equal(restored.approvals.length, 0);

	const replayed = retainedEvents.reduce(reduceAgentSession, restored);
	assert.equal(replayed.sequence, 7);
	assert.equal(replayed.status, 'waiting-approval');
	assert.deepEqual(
		replayed.approvals.map(({ id, status }) => ({ id, status })),
		[{ id: 'approval-2', status: 'pending' }]
	);
	assert.deepEqual(
		replayed.messages.map(({ id, role, text, delivery }) => ({ id, role, text, delivery })),
		[
			{ id: 'command:command-1', role: 'user', text: 'run it', delivery: 'complete' },
			{ id: 'agent-1', role: 'assistant', text: 'done', delivery: 'complete' }
		]
	);
});
