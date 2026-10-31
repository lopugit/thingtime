import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexAppServerConnector } from '../src/live/codexAppServer.js';
import {
	JsonlRpcProcess,
	LocalConnectorError,
	publicConnectorError,
	sanitizeLocalConnectorError,
	type JsonRpcTransport,
	type RpcId,
	type RpcMessage,
	type RpcMessageHandler
} from '../src/live/jsonlRpc.js';

class FakeTransport implements JsonRpcTransport {
	calls: Array<{ method: string; params: any }> = [];
	responses: Array<{ id: RpcId; result: unknown }> = [];
	handlers = new Set<RpcMessageHandler>();
	nextTurn = 1;
	listedStatus: Record<string, unknown> = { type: 'idle' };
	latestTurnStatus = 'completed';
	turnStartError: Error | null = null;

	async start() {}
	async stop() {}
	async notify() {}
	onMessage(handler: RpcMessageHandler) {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}
	async respond(id: RpcId, result: unknown) {
		this.responses.push({ id, result });
	}
	async emit(message: RpcMessage) {
		for (const handler of this.handlers) await handler(message);
	}

	async call<T>(method: string, params: any = {}): Promise<T> {
		this.calls.push({ method, params });
		if (method === 'initialize') return {} as T;
		if (method === 'thread/list')
			return { data: [{ id: 'thread-1', preview: 'Build Thingtime', cwd: '/tmp/project', status: this.listedStatus }], nextCursor: null } as T;
		if (method === 'thread/turns/list')
			return {
				data: [
					{
						id: 'turn-old',
						status: this.latestTurnStatus,
						startedAt: 1_700_000_000,
						completedAt: 1_700_000_001,
						items: [
							{
								type: 'userMessage',
								id: 'user-1',
								content: [
									{ type: 'text', text: 'hello', text_elements: [] },
									{ type: 'localImage', path: '/private/image.png' }
								]
							},
							{
								type: 'userMessage',
								id: 'user-internal',
								content: [{ type: 'text', text: 'visible prefix <environment_context>private native context</environment_context>' }]
							},
							{ type: 'reasoning', id: 'reasoning-1', summary: ['private'], content: ['private'] },
							{ type: 'commandExecution', id: 'command-1', command: 'secret-command', aggregatedOutput: 'secret-output', status: 'completed' },
							{ type: 'agentMessage', id: 'agent-1', text: 'hi there' }
						]
					}
				],
				nextCursor: 'older',
				backwardsCursor: 'newer'
			} as T;
		if (method === 'thread/start') return { thread: { id: 'thread-new', preview: '', cwd: params.cwd, status: { type: 'idle' } } } as T;
		if (method === 'turn/start') {
			if (this.turnStartError) throw this.turnStartError;
			return { turn: { id: `turn-${this.nextTurn++}`, status: 'inProgress', items: [] } } as T;
		}
		if (method === 'turn/steer') return { turnId: params.expectedTurnId } as T;
		if (method === 'turn/interrupt') return {} as T;
		throw new Error(`Unexpected call ${method}`);
	}
}

test('lists Codex sessions and creates a project-scoped thread', async () => {
	const transport = new FakeTransport();
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	const list = await connector.listSessions();
	assert.equal(list.sessions[0].id, 'thread-1');
	assert.match(list.sessions[0].projectId || '', /^local-/);
	assert.equal(list.sessions[0].projectLabel, 'project');
	assert.doesNotMatch(JSON.stringify(list), /\/tmp\/project/);
	const created = await connector.createSession({ commandId: 'command-1', projectPath: '/tmp/new' });
	assert.equal(created.id, 'thread-new');
	assert.equal(transport.calls.find((entry) => entry.method === 'thread/start')?.params.cwd, '/tmp/new');
	await connector.stop();
});

test('refreshes a fresh project registry through one bounded session page', async () => {
	const transport = new FakeTransport();
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	await connector.refreshProjects();
	const listCall = transport.calls.find((entry) => entry.method === 'thread/list');
	assert.equal(listCall?.params.limit, 100);
	assert.equal(
		transport.calls.filter((entry) => entry.method === 'thread/list').length,
		1
	);
	const sessions = await connector.listSessions({ limit: 1 });
	assert.equal(sessions.sessions[0].projectLabel, 'project');
	assert.match(sessions.sessions[0].projectId || '', /^local-[a-f0-9]{32}$/);
	assert.doesNotMatch(JSON.stringify(sessions.sessions[0]), /\/tmp\/project/u);
	await connector.stop();
});

test('holds a busy-session queue command until app-server accepts the next turn', async () => {
	const transport = new FakeTransport();
	transport.listedStatus = { type: 'active', activeFlags: [] };
	transport.latestTurnStatus = 'inProgress';
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	const events = connector.events()[Symbol.asyncIterator]();
	assert.equal((await events.next()).value.type, 'connector.ready');
	const sessions = await connector.listSessions();
	assert.equal(sessions.sessions[0].status, 'running');
	const pending = connector.sendMessage({ commandId: 'busy-message', sessionId: 'thread-1', text: 'later', mode: 'queue' });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		transport.calls.some((entry) => entry.method === 'turn/start'),
		false
	);
	await transport.emit({
		method: 'turn/completed',
		params: { threadId: 'thread-1', turn: { id: 'turn-old', status: 'completed', items: [] } }
	});
	const result = await pending;
	assert.equal(result.status, 'started');
	assert.equal(transport.calls.find((entry) => entry.method === 'turn/start')?.params.clientUserMessageId, 'busy-message');
	assert.equal((await events.next()).value.type, 'turn.completed');
	const submitted = (await events.next()).value;
	assert.equal(submitted.type, 'message.submitted');
	assert.equal(submitted.payload.commandId, 'busy-message');
	await connector.stop();
});

test('times out a blocked queue command without acknowledging delivery', async () => {
	const transport = new FakeTransport();
	transport.listedStatus = { type: 'active', activeFlags: [] };
	transport.latestTurnStatus = 'inProgress';
	const connector = new CodexAppServerConnector(transport, null, undefined, 5 * 60 * 1_000, 10);
	await connector.start();
	const events = connector.events()[Symbol.asyncIterator]();
	assert.equal((await events.next()).value.type, 'connector.ready');
	await connector.listSessions();
	await assert.rejects(connector.sendMessage({ commandId: 'timed-out-message', sessionId: 'thread-1', text: 'later', mode: 'queue' }), /timed out/);
	const warning = (await events.next()).value;
	assert.equal(warning.type, 'connector.warning');
	assert.deepEqual(warning.payload, {
		message: 'A queued message could not be delivered.',
		commandId: 'timed-out-message'
	});
	assert.equal(
		transport.calls.some((entry) => entry.method === 'turn/start'),
		false
	);
	await connector.stop();
});

test('reads paged transcripts without exposing reasoning, local paths, commands, or tool output', async () => {
	const transport = new FakeTransport();
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	const page = await connector.readSession({ sessionId: 'thread-1', limit: 20 });
	assert.equal(page.nextCursor, 'older');
	assert.equal(page.source, 'native');
	assert.deepEqual(
		page.entries.map((entry) => (entry.type === 'message' ? `${entry.role}:${entry.text}` : entry.label)),
		['user:hello', 'Command execution', 'assistant:hi there']
	);
	const serialized = JSON.stringify(page);
	assert.doesNotMatch(serialized, /private|secret-command|secret-output|image\.png/);
	await connector.stop();
});

test('redacts local paths from connector errors', () => {
	const safe = sanitizeLocalConnectorError('failed to read /Users/person/.codex/sessions/private.jsonl and file:///private/tmp/debug.txt');
	assert.equal(safe, 'failed to read [local path] and [local path]');

	const pathsWithSpaces = sanitizeLocalConnectorError(
		'failed at "/Users/person/Library/Application Support/Codex/private session.jsonl" and ~/Library/Application Support/Codex/other session.jsonl before retrying https://thingtime.com/api'
	);
	assert.equal(pathsWithSpaces, 'failed at "[local path]" and [local path] before retrying https://thingtime.com/api');
});

test('uses enumerated generic connector errors instead of source messages', () => {
	assert.deepEqual(publicConnectorError(new LocalConnectorError('connector_request_rejected')), {
		code: 'connector_request_rejected',
		message: 'The local AI connector rejected the request.'
	});
	assert.equal(publicConnectorError(new Error('failed in /Users/person/Private Project with secret output')), null);
	assert.deepEqual(publicConnectorError(new LocalConnectorError('command_outcome_uncertain')), {
		code: 'command_outcome_uncertain',
		message: 'The local AI connector may have accepted the request; its outcome requires review.'
	});
});

test('classifies a transport loss during turn start as an uncertain outcome', async () => {
	const transport = new FakeTransport();
	transport.turnStartError = new LocalConnectorError('connector_timeout');
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	await assert.rejects(
		connector.sendMessage({ commandId: 'uncertain-message', sessionId: 'thread-1', text: 'run it', mode: 'queue' }),
		(error: unknown) => error instanceof LocalConnectorError && error.code === 'command_outcome_uncertain'
	);
	await connector.stop();
});

test('discards JSON-RPC error messages before they leave the local transport', async () => {
	const child = new JsonlRpcProcess(
		process.execPath,
		[
			'-e',
			[
				"process.stdin.setEncoding('utf8')",
				"process.stdin.once('data', (line) => {",
				'  const request = JSON.parse(line)',
				"  process.stdout.write(JSON.stringify({ id: request.id, error: { code: -32602, message: 'failed at ~/Private Project/secret.txt with tool output' } }) + '\\n')",
				'})'
			].join(';')
		],
		{ timeoutMs: 2_000 }
	);
	await child.start();
	try {
		await assert.rejects(
			child.call('thread/list'),
			(error) =>
				error instanceof LocalConnectorError &&
				error.code === 'connector_request_rejected' &&
				error.message === 'The local AI connector rejected the request.'
		);
	} finally {
		await child.stop();
	}
});

test('fails closed without an unhandled error when a child closes its stdin pipe', async () => {
	const child = new JsonlRpcProcess(
		process.execPath,
		['-e', 'process.exit(0)'],
		{ timeoutMs: 2_000 }
	);
	await child.start();
	try {
		await assert.rejects(
			child.call('thread/list'),
			(error) => error instanceof LocalConnectorError && error.code === 'connector_unavailable'
		);
	} finally {
		await child.stop();
	}
});

test('does not forward raw Codex error text into cloud-visible events', async () => {
	const transport = new FakeTransport();
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	const events = connector.events()[Symbol.asyncIterator]();
	assert.equal((await events.next()).value.type, 'connector.ready');
	await transport.emit({
		method: 'error',
		params: {
			threadId: 'thread-1',
			message: 'failed in ~/Library/Application Support/Codex/private session.jsonl: secret tool output'
		}
	});
	const warning = (await events.next()).value;
	assert.equal(warning.type, 'connector.warning');
	assert.deepEqual(warning.payload, { message: 'Codex reported an error.' });
	assert.doesNotMatch(JSON.stringify(warning), /Library|private session|secret tool output/u);
	await connector.stop();
});

test('maps queue and steer to separate Codex turn operations', async () => {
	const transport = new FakeTransport();
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	const first = await connector.sendMessage({ commandId: 'm1', sessionId: 'thread-1', text: 'first', mode: 'queue' });
	assert.equal(first.status, 'started');
	const secondPending = connector.sendMessage({ commandId: 'm2', sessionId: 'thread-1', text: 'second', mode: 'queue' });
	const steered = await connector.sendMessage({
		commandId: 'm3',
		sessionId: 'thread-1',
		text: 'change course',
		mode: 'steer',
		expectedTurnId: 'turn-1'
	});
	assert.equal(steered.status, 'steered');
	assert.deepEqual(
		transport.calls.filter((entry) => entry.method === 'turn/start').map((entry) => entry.params.clientUserMessageId),
		['m1']
	);
	await transport.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] } } });
	const second = await secondPending;
	assert.equal(second.status, 'started');
	assert.deepEqual(
		transport.calls.filter((entry) => entry.method === 'turn/start').map((entry) => entry.params.clientUserMessageId),
		['m1', 'm2']
	);
	await assert.rejects(connector.sendMessage({ commandId: 'm1', sessionId: 'thread-1', text: 'different', mode: 'queue' }), /different input/);
	await connector.stop();
});

test('forwards streamed deltas and approval responses with monotonic sequence numbers', async () => {
	const transport = new FakeTransport();
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	const events = connector.events()[Symbol.asyncIterator]();
	assert.equal((await events.next()).value.type, 'connector.ready');
	await transport.emit({
		method: 'item/completed',
		params: {
			threadId: 'thread-1',
			turnId: 'turn-1',
			item: {
				id: 'user-internal',
				type: 'userMessage',
				content: [{ type: 'text', text: '<skills_instructions>private live context</skills_instructions>' }]
			}
		}
	});
	await transport.emit({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'hello' } });
	await transport.emit({
		method: 'item/completed',
		params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', item: { id: 'item-1', type: 'agentMessage', text: 'hello' } }
	});
	const delta = (await events.next()).value;
	assert.equal(delta.type, 'message.delta');
	assert.equal(delta.sequence, 2);
	const completed = (await events.next()).value;
	assert.equal(completed.type, 'item.completed');
	await transport.emit({
		id: 90,
		method: 'item/commandExecution/requestApproval',
		params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-2', command: 'git status' }
	});
	const approval = (await events.next()).value;
	assert.equal(approval.type, 'approval.requested');
	assert.doesNotMatch(JSON.stringify(approval), /git status|commandExecution.*requestApproval|private/);
	await connector.respondToApproval({ commandId: 'approval-1', requestId: approval.payload.requestId as string, decision: 'accept' });
	await connector.respondToApproval({ commandId: 'approval-1', requestId: approval.payload.requestId as string, decision: 'accept' });
	assert.deepEqual(transport.responses, [{ id: 90, result: { decision: 'accept' } }]);
	const approvalResponse = (await events.next()).value;
	assert.equal(approvalResponse.type, 'approval.responded');
	assert.equal(approvalResponse.payload.decision, 'accept');
	await transport.emit({
		method: 'item/completed',
		params: {
			threadId: 'thread-1',
			turnId: 'turn-1',
			item: { id: 'command-private', type: 'commandExecution', command: 'cat /private/file', aggregatedOutput: 'secret', status: 'completed' }
		}
	});
	const safeActivity = (await events.next()).value;
	assert.deepEqual(safeActivity.payload.item, {
		id: 'command-private',
		type: 'activity',
		activity: 'commandExecution',
		label: 'Command execution',
		status: 'completed'
	});
	assert.doesNotMatch(JSON.stringify(safeActivity), /cat |private\/file|secret/);
	await connector.stop();
});

test('buffers streamed text across chunks and drops split internal context markers', async () => {
	const transport = new FakeTransport();
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	const events = connector.events()[Symbol.asyncIterator]();
	assert.equal((await events.next()).value.type, 'connector.ready');
	await transport.emit({
		method: 'item/agentMessage/delta',
		params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-private', delta: '<environ' }
	});
	await transport.emit({
		method: 'item/agentMessage/delta',
		params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-private', delta: 'ment_context>private' }
	});
	await transport.emit({
		method: 'item/completed',
		params: {
			threadId: 'thread-1',
			turnId: 'turn-1',
			itemId: 'item-private',
			item: { id: 'item-private', type: 'agentMessage', text: '<environment_context>private</environment_context>' }
		}
	});
	await transport.emit({ method: 'error', params: { threadId: 'thread-1' } });
	const next = (await events.next()).value;
	assert.equal(next.type, 'connector.warning');
	assert.equal(next.sequence, 2);
	assert.doesNotMatch(JSON.stringify(next), /environment_context|private/u);
	await connector.stop();
});

test('cancels and clears unanswered local approval requests on stop', async () => {
	const transport = new FakeTransport();
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	await transport.emit({
		id: 77,
		method: 'item/commandExecution/requestApproval',
		params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1' }
	});
	await connector.stop();
	assert.deepEqual(transport.responses, [{ id: 77, result: { decision: 'cancel' } }]);
});

test('actively expires unanswered local approval requests without another connector call', async () => {
	const transport = new FakeTransport();
	const connector = new CodexAppServerConnector(transport, null, undefined, 10);
	await connector.start();
	const events = connector.events()[Symbol.asyncIterator]();
	assert.equal((await events.next()).value.type, 'connector.ready');
	await transport.emit({
		id: 78,
		method: 'item/commandExecution/requestApproval',
		params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1' }
	});
	const approval = (await events.next()).value;
	assert.equal(approval.type, 'approval.requested');
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.deepEqual(transport.responses, [{ id: 78, result: { decision: 'cancel' } }]);
	const expired = (await events.next()).value;
	assert.equal(expired.type, 'approval.responded');
	assert.deepEqual(expired.payload, {
		requestId: approval.payload.requestId,
		decision: 'cancel',
		reason: 'expired'
	});
	await assert.rejects(
		connector.respondToApproval({ commandId: 'late-response', requestId: approval.payload.requestId as string, decision: 'accept' }),
		/no longer pending/
	);
	await connector.stop();
});

test('caps local pending approval requests and cancels overflow fail closed', async () => {
	const transport = new FakeTransport();
	const connector = new CodexAppServerConnector(transport);
	await connector.start();
	for (let index = 0; index < 129; index += 1) {
		await transport.emit({
			id: 1_000 + index,
			method: 'item/commandExecution/requestApproval',
			params: { threadId: 'thread-1', turnId: 'turn-1', itemId: `item-${index}` }
		});
	}
	assert.deepEqual(transport.responses, [{ id: 1_128, result: { decision: 'cancel' } }]);
	await connector.stop();
	assert.equal(transport.responses.length, 129);
	assert.equal(transport.responses.filter((entry) => (entry.result as { decision?: string }).decision === 'cancel').length, 129);
});
