import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDeviceNodeLiveSyncRequest } from '../../api/utils/devices/deviceLiveAiCore';
import { publicExternalAiSource } from '../../api/utils/messenger/externalAi';
import { planLiveSessionRead, waitForLiveSessionReadCommand } from './liveSessionRead';
import type { LiveAiSource } from './messengerTypes';

const source = (extra: Partial<LiveAiSource> = {}): LiveAiSource => ({
	access: 'live',
	provider: 'chatgpt',
	sourceId: 'codex-app-server',
	label: 'Codex',
	connector: 'codex-app-server',
	readOnly: false,
	deviceId: 'device-1',
	connectorId: 'codex-app-server',
	sessionId: 'session-1',
	capabilities: ['read-history', 'create-session', 'send-message'],
	...extra
});

test('plans deterministic exact session.read commands from durable transcript cursors', () => {
	const first = planLiveSessionRead(source());
	assert.deepEqual(first?.command, {
		deviceId: 'device-1',
		kind: 'session.read',
		input: { connectorId: 'codex-app-server', sessionId: 'session-1', limit: 100 },
		requiresApproval: false
	});
	assert.equal(planLiveSessionRead(source())?.requestId, first?.requestId);

	const page = normalizeDeviceNodeLiveSyncRequest({
		op: 'transcript.page',
		connectorId: 'codex-app-server',
		sessionId: 'session-1',
		page: { cursor: null, nextCursor: 'page-2', hasMore: true },
		entries: []
	});
	assert.equal(page.ok, true);
	const projected = publicExternalAiSource({
		...source(),
		historyCursor: 'page-2',
		historyHasMore: true,
		historySyncedAt: '2026-08-19T00:00:00.000Z'
	});
	assert.equal(projected?.access, 'live');
	const second = planLiveSessionRead(projected?.access === 'live' ? (projected as LiveAiSource) : null);
	assert.deepEqual(second?.command.input, {
		connectorId: 'codex-app-server',
		sessionId: 'session-1',
		cursor: 'page-2',
		limit: 100
	});
	assert.notEqual(second?.requestId, first?.requestId);
	assert.equal(
		planLiveSessionRead(
			source({ historyCursor: null, historyHasMore: false, historySyncedAt: '2026-08-19T00:01:00.000Z' })
		),
		null
	);
});

test('gates AX reads for approval and does not plan unsupported or incoherent progress', () => {
	assert.equal(planLiveSessionRead(source({ capabilities: ['send-message'] })), null);
	assert.equal(planLiveSessionRead(source({ historySyncedAt: '2026-08-19T00:00:00.000Z' })), null);
	assert.equal(planLiveSessionRead(source({ capabilities: ['read-history', 'explicit-approval'] }))?.command.requiresApproval, true);
});

test('waits for authoritative transcript completion across approval and running states', async () => {
	const states = ['needs-approval', 'queued', 'running', 'succeeded'] as const;
	let index = 0;
	const result = await waitForLiveSessionReadCommand({
		command: { id: 'command-1', status: states[0] },
		loadCommands: async () => [{ id: 'command-1', status: states[Math.min(++index, states.length - 1)] }],
		signal: new AbortController().signal,
		intervalMs: 0,
		maximumPolls: 5,
		sleep: async () => {}
	});
	assert.equal(result, 'succeeded');
	assert.equal(index, 3);
});

test('stops transcript reconciliation on abort and bounds missing commands', async () => {
	const controller = new AbortController();
	const aborted = await waitForLiveSessionReadCommand({
		command: { id: 'command-1', status: 'queued' },
		loadCommands: async () => [],
		signal: controller.signal,
		intervalMs: 0,
		sleep: async () => controller.abort()
	});
	assert.equal(aborted, 'aborted');

	const timedOut = await waitForLiveSessionReadCommand({
		command: { id: 'command-2', status: 'queued' },
		loadCommands: async () => [],
		signal: new AbortController().signal,
		intervalMs: 0,
		maximumPolls: 2,
		sleep: async () => {}
	});
	assert.equal(timedOut, 'timed-out');
});
