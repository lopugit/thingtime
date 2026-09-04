import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { decodeRuntimeRequest, runtimeEvent, runtimeReply } from '../src/live/nodeWire.js';

test('adapts the native Thingtime Node connector wire without widening operations', () => {
	const decoded = decodeRuntimeRequest(
		JSON.stringify({
			type: 'command',
			id: 'command-1',
			operation: 'session.send',
			payload: { connectorId: 'codex-app-server', sessionId: 'thread-1', text: 'hello', mode: 'queue' }
		})
	);
	assert.equal(decoded.wire, 'thingtime-node');
	assert.equal(decoded.request.method, 'session.send');
	assert.equal(decoded.request.params?.sessionId, 'thread-1');
	assert.deepEqual(runtimeReply(decoded.wire, decoded.request.id, { status: 'queued' }), {
		type: 'reply',
		id: 'command-1',
		ok: true,
		result: { status: 'queued' }
	});
	assert.deepEqual(runtimeEvent(decoded.wire, { type: 'message.delta' }), {
		type: 'event',
		event: 'connector/event',
		payload: { type: 'message.delta' }
	});
});

test('preserves the development JSON request wire and rejects malformed native commands', () => {
	const decoded = decodeRuntimeRequest('{"id":7,"method":"connector/list","params":{}}');
	assert.equal(decoded.wire, 'json-rpc');
	assert.deepEqual(runtimeReply(decoded.wire, 7, { ok: true }), { id: 7, result: { ok: true } });
	assert.throws(() => decodeRuntimeRequest('{"type":"command","id":"x","operation":"","payload":{}}'), /operation/);
});

test('connector list exposes only bounded opaque project references when its unavailable local connector exits early', async () => {
	const runtime = fileURLToPath(new URL('../src/nodeRuntime.ts', import.meta.url));
	const child = spawn(process.execPath, ['--import', 'tsx', runtime], {
		cwd: fileURLToPath(new URL('..', import.meta.url)),
			env: {
			...process.env,
			THINGTIME_CODEX_BIN: '/usr/bin/true',
			THINGTIME_NODE_PROJECTS_JSON: JSON.stringify({ thingtime: '/tmp', root: '/' }),
			THINGTIME_NODE_DEFAULT_PROJECT_ID: 'thingtime'
		},
		stdio: ['pipe', 'pipe', 'pipe']
	});
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8').on('data', (chunk) => {
		stdout += chunk;
	});
	child.stderr.setEncoding('utf8').on('data', (chunk) => {
		stderr += chunk;
	});
	child.stdin.end(`${JSON.stringify({ id: 1, method: 'connector/list', params: {} })}\n`);
	const [status] = (await once(child, 'exit')) as [number | null];
	assert.equal(status, 0, stderr);
	const response = JSON.parse(stdout.trim());
	assert.deepEqual(response.result.connectors[0].projects, [
		{ projectId: 'thingtime', projectLabel: 'tmp' },
		{ projectId: 'root', projectLabel: 'Project' }
	]);
	assert.doesNotMatch(stdout, /"\/tmp"|"\/"/u);
});

test('a blocking queued send does not prevent a concurrent steer command', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-node-runtime-'));
	const fakeCodex = join(directory, 'fake-codex.mjs');
	await writeFile(
		fakeCodex,
		`#!/usr/bin/env node
import { createInterface } from 'node:readline';
const write = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method === 'initialize') write({ id: request.id, result: {} });
  if (request.method === 'thread/turns/list') {
    write({ id: request.id, result: { data: [{ id: 'turn-old', status: 'inProgress' }] } });
    setTimeout(() => write({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-old', status: 'completed' } } }), 500);
  }
  if (request.method === 'turn/steer') write({ id: request.id, result: { turnId: request.params.expectedTurnId } });
  if (request.method === 'turn/start') write({ id: request.id, result: { turn: { id: 'turn-next', status: 'inProgress' } } });
}
`
	);
	await chmod(fakeCodex, 0o700);
	const runtime = fileURLToPath(new URL('../src/nodeRuntime.ts', import.meta.url));
	const child = spawn(process.execPath, ['--import', 'tsx', runtime], {
		cwd: fileURLToPath(new URL('..', import.meta.url)),
		env: { ...process.env, THINGTIME_CODEX_BIN: fakeCodex },
		stdio: ['pipe', 'pipe', 'pipe']
	});
	const frames: any[] = [];
	const frameEvents = new EventEmitter();
	let buffer = '';
	let stderr = '';
	child.stderr.setEncoding('utf8').on('data', (chunk) => {
		stderr += chunk;
	});
	child.stdout.setEncoding('utf8').on('data', (chunk) => {
		buffer += chunk;
		while (buffer.includes('\n')) {
			const newline = buffer.indexOf('\n');
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (line) frames.push(JSON.parse(line));
			frameEvents.emit('frame');
		}
	});
	const waitForFrame = async (predicate: (frame: any) => boolean): Promise<any> => {
		for (;;) {
			const index = frames.findIndex(predicate);
			if (index >= 0) return frames.splice(index, 1)[0];
			await once(frameEvents, 'frame', { signal: AbortSignal.timeout(3_000) });
		}
	};
	const write = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
	try {
		write({ id: 'start', method: 'connector/start', params: { connectorId: 'codex-app-server' } });
		assert.deepEqual(await waitForFrame((frame) => frame.id === 'start'), { id: 'start', result: { ok: true } });

		write({
			id: 'queue',
			method: 'session/send',
			params: { connectorId: 'codex-app-server', commandId: 'queue', sessionId: 'thread-1', text: 'later', mode: 'queue' }
		});
		write({
			id: 'steer',
			method: 'session/send',
			params: {
				connectorId: 'codex-app-server',
				commandId: 'steer',
				sessionId: 'thread-1',
				text: 'change course',
				mode: 'steer',
				expectedTurnId: 'turn-old'
			}
		});
		assert.deepEqual(await waitForFrame((frame) => frame.id === 'steer'), {
			id: 'steer',
			result: { status: 'steered', turnId: 'turn-old', queuePosition: null }
		});
		assert.equal(
			frames.some((frame) => frame.id === 'queue'),
			false
		);
		assert.deepEqual(await waitForFrame((frame) => frame.id === 'queue'), {
			id: 'queue',
			result: { status: 'started', turnId: 'turn-next', queuePosition: null }
		});
		child.stdin.end();
		const [status] = (await once(child, 'exit')) as [number | null];
		assert.equal(status, 0, stderr);
	} finally {
		if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
		await rm(directory, { recursive: true, force: true });
	}
});
