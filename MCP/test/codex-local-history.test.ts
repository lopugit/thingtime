import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { CodexLocalHistory } from '../src/live/codexLocalHistory.js';

test('reads bounded local Codex messages and rejects rollout paths outside the session root', async () => {
	const root = await mkdtemp(join(tmpdir(), 'thingtime-codex-history-'));
	const sessions = join(root, 'sessions');
	const state = join(root, 'state.sqlite');
	const rollout = join(sessions, 'rollout.jsonl');
	await mkdir(sessions, { recursive: true });
	await writeFile(
		rollout,
		[
			{ type: 'turn_context', payload: { turn_id: 'turn-1' } },
			{
				type: 'response_item',
				timestamp: '2026-01-01T00:00:00.000Z',
				payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }
			},
			{
				type: 'response_item',
				timestamp: '2026-01-01T00:00:00.100Z',
				payload: {
					type: 'message',
					role: 'user',
					content: [{ type: 'input_text', text: 'visible prefix <codex_internal_context>private local context</codex_internal_context>' }]
				}
			},
			{
				type: 'response_item',
				timestamp: '2026-01-01T00:00:00.200Z',
				payload: {
					type: 'message',
					role: 'user',
					content: [{ type: 'input_text', text: 'visible prefix\n<environment_context>unclosed private context' }]
				}
			},
			{
				type: 'response_item',
				timestamp: '2026-01-01T00:00:00.300Z',
				payload: {
					type: 'message',
					role: 'assistant',
					content: [
						{ type: 'output_text', text: 'apparently visible' },
						{ type: 'reasoning', text: 'private reasoning' }
					]
				}
			},
			{
				type: 'response_item',
				timestamp: '2026-01-01T00:00:00.400Z',
				payload: { type: 'message', role: 'developer', content: [{ type: 'output_text', text: 'private developer instructions' }] }
			},
			{
				type: 'response_item',
				timestamp: '2026-01-01T00:00:01.000Z',
				payload: { type: 'reasoning', content: [{ type: 'output_text', text: 'hidden' }] }
			},
			{
				type: 'response_item',
				timestamp: '2026-01-01T00:00:02.000Z',
				payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Review app permissions before continuing.' }] }
			}
		]
			.map((value) => JSON.stringify(value))
			.join('\n')
	);
	const database = new DatabaseSync(state);
	database.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)');
	database.prepare('INSERT INTO threads (id, rollout_path) VALUES (?, ?)').run('thread-1', rollout);
	database.prepare('INSERT INTO threads (id, rollout_path) VALUES (?, ?)').run('thread-outside', join(root, 'outside.jsonl'));
	database.close();
	await writeFile(
		join(root, 'outside.jsonl'),
		JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'text', text: 'private' }] } })
	);

	try {
		const history = new CodexLocalHistory(state, sessions);
		const complete = await history.read({ sessionId: 'thread-1', limit: 100 });
		assert.deepEqual(
			complete?.entries.map((entry) => (entry.type === 'message' ? entry.text : '')),
			['hello', 'Review app permissions before continuing.']
		);
		assert.doesNotMatch(JSON.stringify(complete), /private local context|unclosed private context|private reasoning|private developer instructions/u);
		const page = await history.read({ sessionId: 'thread-1', limit: 1 });
		assert.equal(page?.source, 'local-fallback');
		assert.deepEqual(
			page?.entries.map((entry) => (entry.type === 'message' ? entry.text : '')),
			['Review app permissions before continuing.']
		);
		assert.equal(page?.nextCursor, 'local:1');
		const older = await history.read({ sessionId: 'thread-1', cursor: page?.nextCursor, limit: 1 });
		assert.deepEqual(
			older?.entries.map((entry) => (entry.type === 'message' ? entry.text : '')),
			['hello']
		);
		assert.equal(await history.read({ sessionId: 'thread-outside' }), null);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
