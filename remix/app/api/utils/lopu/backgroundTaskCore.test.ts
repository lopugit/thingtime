import assert from 'node:assert/strict';
import test from 'node:test';
import { isRunningLopuChatTask, type AiBackgroundTask } from './backgroundTaskCore';

const task = (patch: Partial<AiBackgroundTask> = {}): AiBackgroundTask => ({
 id: 'task', requestId: 'request', label: 'Lopu chat', path: '/api/v1/lopu/chats/reply',
 chatId: 'chat', status: 'running', stage: 'replying', createdAt: '', updatedAt: '',
 responseStatus: 200, contentType: 'application/x-ndjson', error: null, ...patch
});

test('only an active reply belonging to a concrete conversation makes its composer busy', () => {
 assert.equal(isRunningLopuChatTask(task(), 'chat'), true);
 assert.equal(isRunningLopuChatTask(task({ status: 'completed', workflowStatus: 'running' }), 'chat'), true);
 for (const chatId of [null, '', 'other']) assert.equal(isRunningLopuChatTask(task(), chatId), false);
 for (const chatId of [null, '']) assert.equal(isRunningLopuChatTask(task({ chatId }), chatId), false);
 for (const path of ['/api/v1/lopu/musing', '/api/v1/ai/complete', '/api/v1/lopu/voice/reply']) {
  assert.equal(isRunningLopuChatTask(task({ path }), 'chat'), false);
 }
 for (const status of ['completed', 'stopped', 'needs-attention'] as const) {
  assert.equal(isRunningLopuChatTask(task({ status }), 'chat'), false);
 }
});
