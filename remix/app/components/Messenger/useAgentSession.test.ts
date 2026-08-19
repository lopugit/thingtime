import assert from 'node:assert/strict';
import test from 'node:test';

import { deviceEventToAgentEvent } from './useAgentSession';
import type { LiveAiSource } from './messengerTypes';

const source: LiveAiSource = {
	access: 'live',
	provider: 'chatgpt',
	sourceId: 'source-1',
	label: 'Codex',
	connector: 'thingtime-node',
	readOnly: false,
	deviceId: 'device-1',
	connectorId: 'codex-app-server',
	sessionId: 'session-1',
	capabilities: ['send-message']
};

test('maps only live session event envelopes for the selected source', () => {
	const event = deviceEventToAgentEvent(source, {
		cursor: 'cursor',
		id: 'event-1',
		type: 'ai.session-event',
		deviceId: 'device-1',
		resourceId: 'session-1',
		revision: null,
		at: '2026-08-18T00:00:00.000Z',
		payload: {
			connectorId: 'codex-app-server',
			sessionId: 'session-1',
			sequence: 7,
			observedAt: '2026-08-18T00:00:00.000Z',
			turnId: 'turn-1',
			itemId: 'item-1',
			type: 'message.delta',
			payload: { delta: 'hello' }
		}
	});
	assert.equal(event?.sequence, 7);
	assert.equal(event?.payload.delta, 'hello');
	assert.equal(
		deviceEventToAgentEvent(
			{ ...source, sessionId: 'other' },
			{
				cursor: 'cursor',
				id: 'event-1',
				type: 'ai.session-event',
				deviceId: 'device-1',
				resourceId: null,
				revision: null,
				at: '2026-08-18T00:00:00.000Z',
				payload: {
					connectorId: 'codex-app-server',
					sessionId: 'session-1',
					sequence: 7,
					observedAt: '2026-08-18T00:00:00.000Z',
					turnId: null,
					itemId: null,
					type: 'message.delta',
					payload: { delta: 'hello' }
				}
			}
		),
		null
	);
});

test('rejects unknown event types and malformed sequence values', () => {
	const base = {
		cursor: 'cursor',
		id: 'event-1',
		type: 'ai.session-event',
		deviceId: 'device-1',
		resourceId: null,
		revision: null,
		at: '2026-08-18T00:00:00.000Z'
	};
	assert.equal(
		deviceEventToAgentEvent(source, {
			...base,
			payload: {
				connectorId: 'codex-app-server',
				sessionId: 'session-1',
				sequence: 0,
				observedAt: 'now',
				turnId: null,
				itemId: null,
				type: 'private.tool-output',
				payload: {}
			}
		}),
		null
	);
});
