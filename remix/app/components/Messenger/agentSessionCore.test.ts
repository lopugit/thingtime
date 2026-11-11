import assert from 'node:assert/strict';
import test from 'node:test';

import { cacheableAgentSession, initialAgentSession, reduceAgentSession, type AgentSessionEvent } from './agentSessionCore';

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

test('reconciles queued prompts and rejects duplicate or out-of-order events', () => {
	let state = initialAgentSession('session-1');
	state = reduceAgentSession(state, event(1, 'turn.started'));
	state = reduceAgentSession(state, event(2, 'message.queued', { commandId: 'command-1', text: 'next', queuePosition: 1 }));
	assert.equal(state.queueDepth, 1);
	assert.equal(state.messages[0].delivery, 'queued');
	const duplicate = reduceAgentSession(state, event(2, 'message.queued', { commandId: 'command-1', text: 'duplicate', queuePosition: 2 }));
	assert.strictEqual(duplicate, state);
	state = reduceAgentSession(state, event(3, 'message.submitted', { commandId: 'command-1' }, { turnId: 'turn-2' }));
	assert.equal(state.queueDepth, 0);
	assert.equal(state.messages[0].delivery, 'submitted');
	assert.equal(state.messages[0].turnId, 'turn-2');
});

test('coalesces deltas and keeps terminal messages immutable', () => {
	let state = initialAgentSession('session-1');
	state = reduceAgentSession(state, event(1, 'turn.started'));
	state = reduceAgentSession(state, event(2, 'message.delta', { delta: 'hel' }, { itemId: 'agent-1' }));
	state = reduceAgentSession(state, event(3, 'message.delta', { delta: 'lo' }, { itemId: 'agent-1' }));
	state = reduceAgentSession(state, event(4, 'item.completed', { item: { type: 'agentMessage', text: 'hello' } }, { itemId: 'agent-1' }));
	state = reduceAgentSession(state, event(5, 'message.delta', { delta: ' ignored' }, { itemId: 'agent-1' }));
	assert.equal(state.messages[0].text, 'hello');
	assert.equal(state.messages[0].delivery, 'complete');
});

test('does not duplicate completed user or activity items as assistant messages', () => {
	let state = initialAgentSession('session-1');
	state = reduceAgentSession(state, event(1, 'message.submitted', { commandId: 'command-1', text: 'run it' }));
	state = reduceAgentSession(state, event(2, 'item.completed', { item: { type: 'userMessage', text: 'run it' } }, { itemId: 'user-1' }));
	state = reduceAgentSession(
		state,
		event(
			3,
			'item.started',
			{
				item: { id: 'activity-1', type: 'activity', activity: 'fileChange', label: 'Editing a file', status: 'running' }
			},
			{ itemId: 'activity-1' }
		)
	);
	state = reduceAgentSession(
		state,
		event(
			4,
			'item.completed',
			{
				item: { id: 'activity-1', type: 'activity', activity: 'fileChange', label: 'Edited a file', status: 'completed' }
			},
			{ itemId: 'activity-1' }
		)
	);
	assert.equal(state.messages.length, 1);
	assert.equal(state.messages[0].role, 'user');
	assert.deepEqual(
		state.activities.map(({ id, label, status }) => ({ id, label, status })),
		[{ id: 'activity-1', label: 'Edited a file', status: 'completed' }]
	);
});

test('tracks approvals and caches completed messages only without command ids', () => {
	let state = initialAgentSession('session-1');
	state = reduceAgentSession(state, event(1, 'message.submitted', { commandId: 'command-1', text: 'run it' }));
	state = reduceAgentSession(state, event(2, 'approval.requested', { requestId: 'approval-1', label: 'Run command' }, { itemId: 'tool-1' }));
	assert.equal(state.status, 'waiting-approval');
	state = reduceAgentSession(state, event(3, 'approval.responded', { requestId: 'approval-1', decision: 'accept' }));
	state = reduceAgentSession(state, event(4, 'turn.completed', { turn: { status: 'completed' } }));
	const cached = cacheableAgentSession(state);
	assert.equal(cached.messages.length, 1);
	assert.equal('commandId' in cached.messages[0], false);
	assert.equal('sequence' in cached, false);
	assert.equal(JSON.stringify(cached).includes('approval-1'), false);
});

test('marks an expired approval terminal and clears the waiting state', () => {
	let state = initialAgentSession('session-1');
	state = reduceAgentSession(state, event(1, 'approval.requested', { requestId: 'approval-1', label: 'Run command' }, { itemId: 'tool-1' }));
	state = reduceAgentSession(state, event(2, 'approval.responded', { requestId: 'approval-1', decision: 'cancel', reason: 'expired' }));
	assert.equal(state.approvals[0]?.status, 'expired');
	assert.equal(state.status, 'idle');
});

test('fails an optimistic queued message when restart-safe delivery is rejected', () => {
	let state = initialAgentSession('session-1');
	state = reduceAgentSession(state, event(1, 'message.queued', { commandId: 'command-1', text: 'next', queuePosition: 1 }));
	state = reduceAgentSession(
		state,
		event(2, 'connector.warning', {
			message: 'A queued message could not be delivered.',
			commandId: 'command-1'
		})
	);
	assert.equal(state.messages[0]?.delivery, 'failed');
	assert.equal(state.messages[0]?.queuePosition, null);
	assert.equal(state.queueDepth, 0);
	assert.equal(state.status, 'failed');
	assert.equal(state.warning, 'A queued message could not be delivered.');
});
