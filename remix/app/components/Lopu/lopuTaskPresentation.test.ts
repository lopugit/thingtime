import assert from 'node:assert/strict';
import test from 'node:test';
import { presentLopuTasks } from './lopuTaskPresentation';
const root = {
	id: 'root',
	chatId: 'chat',
	createdAt: '2026-01-01',
	status: 'needs-attention',
	workflowStatus: 'running',
	stage: 'Paused',
	error: 'Paused',
	management: 'server'
} as any;
const child = { ...root, id: 'child', rootTaskId: 'root', createdAt: '2026-01-02', workflowStatus: null, status: 'running', stage: 'Writing' } as any;
test('durable children have one root row with current progress, output and Stop identity', () => {
	const tasks = presentLopuTasks([child, root]);
	assert.equal(tasks.length, 1);
	assert.equal(tasks[0].id, 'root');
	assert.equal(tasks[0].status, 'running');
	assert.equal(tasks[0].stage, 'Writing');
	assert.equal(tasks[0].error, null);
	assert.equal(tasks[0].resultTask.id, 'child');
});
test('workflow completion replaces first checkpoint attention and gaps remain active', () => {
	let row = presentLopuTasks([{ ...child, status: 'needs-attention' }, root])[0];
	assert.equal(row.status, 'running');
	assert.equal(row.stage, 'Continuing');
	row = presentLopuTasks([child, { ...root, workflowStatus: 'completed' }])[0];
	assert.equal(row.status, 'completed');
	assert.equal(row.error, null);
	row = presentLopuTasks([child, { ...root, workflowStatus: 'stopped' }])[0];
	assert.equal(row.status, 'stopped');
});
