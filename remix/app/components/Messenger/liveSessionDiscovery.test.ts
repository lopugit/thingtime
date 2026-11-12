import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagedLiveSessionList, waitForLiveDeviceCommand } from './liveSessionDiscovery';

test('waits for terminal command state and aborts without leaking a timer', async () => {
	const states = ['needs-approval', 'running', 'succeeded'] as const;
	let index = 0;
	const result = await waitForLiveDeviceCommand({
		command: { id: 'command-1', status: 'needs-approval', outputRef: null, error: null },
		loadCommands: async () => [
			{ id: 'command-1', status: states[Math.min(++index, states.length - 1)], outputRef: null, error: null }
		],
		signal: new AbortController().signal,
		intervalMs: 0,
		maximumPolls: 4,
		sleep: async () => {}
	});
	assert.equal(result.status, 'succeeded');
	assert.equal(index, 2);

	const controller = new AbortController();
	const aborted = await waitForLiveDeviceCommand({
		command: { id: 'command-2', status: 'queued', outputRef: null, error: null },
		loadCommands: async () => [],
		signal: controller.signal,
		sleep: async () => controller.abort()
	});
	assert.equal(aborted.status, 'aborted');
});

test('consumes bounded session.list cursors with deterministic page request ids', async () => {
	const calls: Array<{ requestId: string; cursor?: string }> = [];
	const createCommand = async (request: any) => {
		calls.push({ requestId: request.requestId, cursor: request.input.cursor });
		return {
			command: {
				id: `command-${calls.length}`,
				status: 'succeeded' as const,
				outputRef: request.input.cursor ? null : 'opaque/page+2==',
				error: null
			}
		};
	};
	const run = () =>
		runPagedLiveSessionList({
			deviceId: 'device-1',
			connectorId: 'codex-app-server',
			requestId: 'root-request-id',
			requiresApproval: false,
			createCommand,
			loadCommands: async () => [],
			signal: new AbortController().signal
		});

	const first = await run();
	assert.equal(first.status, 'succeeded');
	assert.equal(first.pages, 2);
	assert.deepEqual(
		calls.map(({ cursor }) => cursor),
		[undefined, 'opaque/page+2==']
	);
	assert.equal(calls[0]?.requestId, 'root-request-id');
	assert.match(calls[1]?.requestId || '', /^live-list-[a-f0-9]{16}$/u);

	const firstPageIds = calls.map(({ requestId }) => requestId);
	await run();
	assert.deepEqual(
		calls.slice(2).map(({ requestId }) => requestId),
		firstPageIds
	);
});

test('bounds cursor pagination and rejects cycles', async () => {
	let created = 0;
	const limited = await runPagedLiveSessionList({
		deviceId: 'device-1',
		connectorId: 'codex-app-server',
		requestId: 'root',
		requiresApproval: false,
		createCommand: async () => ({
			command: { id: `command-${++created}`, status: 'succeeded', outputRef: `cursor-${created}`, error: null }
		}),
		loadCommands: async () => [],
		signal: new AbortController().signal,
		maximumPages: 2
	});
	assert.equal(limited.status, 'page-limit');
	assert.equal(limited.pages, 2);
	assert.equal(created, 2);

	created = 0;
	const cycled = await runPagedLiveSessionList({
		deviceId: 'device-1',
		connectorId: 'codex-app-server',
		requestId: 'root',
		requiresApproval: false,
		createCommand: async () => ({
			command: { id: `cycle-${++created}`, status: 'succeeded', outputRef: 'same-cursor', error: null }
		}),
		loadCommands: async () => [],
		signal: new AbortController().signal
	});
	assert.equal(cycled.status, 'cursor-cycle');
	assert.equal(cycled.pages, 2);
});
