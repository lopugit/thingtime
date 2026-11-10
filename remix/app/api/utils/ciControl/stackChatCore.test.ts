import assert from 'node:assert/strict';
import test from 'node:test';
import { chatOnline, parseStackChatQuestion, parseStackChatWorker } from './stackChatCore';
const runId = 'feature-stack-run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const at = '2026-09-12T01:50:00Z';
const now = Date.parse(at);
test('chat rejects unbounded questions and forged/stale responder scopes', () => {
	assert.ok(parseStackChatQuestion({ runId, requestId, question: 'Why is main waiting?' }));
	for (const patch of [{ requestId: 'invalid' }, { runId: '../../other' }, { question: '' }, { question: 'x'.repeat(2001) }])
		assert.equal(parseStackChatQuestion({ runId, requestId, question: 'why', ...patch }), null);
	const body = { runId, workflowRunId: 123, runAttempt: 1, at, repository: 'owner/repo', available: true };
	assert.ok(parseStackChatWorker(body, 'owner/repo', now));
	for (const patch of [
		{ repository: 'other/repo' },
		{ runAttempt: -1 },
		{ at: '2020-01-01' },
		{ reply: { id: 'fake', lease: requestId, status: 'answered', answer: 'hi' } }
	])
		assert.equal(parseStackChatWorker({ ...body, ...patch }, 'owner/repo', now), null);
});
test('offline and ended responders cannot look available', () => {
	assert.equal(chatOnline({ crystal: { runStatus: 'in_progress', chatPollAt: at } }, now), true);
	assert.equal(chatOnline({ crystal: { runStatus: 'in_progress', chatPollAt: at, chatAvailable: false } }, now), false);
	assert.equal(chatOnline({ crystal: { runStatus: 'in_progress', chatPollAt: at } }, now - 1000), false);
	assert.equal(chatOnline({ crystal: { runStatus: 'success', chatPollAt: at } }, now), false);
	assert.equal(chatOnline({ crystal: { runStatus: 'in_progress', chatPollAt: at } }, now + 151000), false);
});
