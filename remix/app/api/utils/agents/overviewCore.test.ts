import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PAGINATION_CURSOR_CHARS, INVALID_PAGINATION_CURSOR } from '~/schemas/paginationCursor';
import { buildOverview, hierarchyRows, overviewRow, OVERVIEW_ROLES, parseOverviewInput, type OverviewRole, type OverviewThing } from './overviewCore';

const input = () => parseOverviewInput(new URLSearchParams('taskSchema=tasks&projectSchema=projects&agentSchema=agents'));
const records = (): Record<OverviewRole, OverviewThing[]> => Object.fromEntries(OVERVIEW_ROLES.map(role => [role, []])) as Record<OverviewRole, OverviewThing[]>;
const thing = (id: string, crystal: Record<string, unknown> = {}): OverviewThing => ({ id, crystal });

test('overview cursor transport budget agrees with the navigation boundary', () => {
	const params = new URLSearchParams({ taskSchema: 'tasks', cursor: 'a'.repeat(MAX_PAGINATION_CURSOR_CHARS) });
	assert.equal(parseOverviewInput(params).cursor.length, MAX_PAGINATION_CURSOR_CHARS);
	for (const cursor of ['a'.repeat(MAX_PAGINATION_CURSOR_CHARS + 1), INVALID_PAGINATION_CURSOR]) {
		params.set('cursor', cursor);
		assert.throws(() => parseOverviewInput(params), error => (error as any).status === 400 && /transport budget/.test((error as Error).message));
	}
});

test('hierarchy preserves children at page boundaries, detached rows and cycles exactly once', () => {
	const data = records();
	data.project.push(thing('project', { title: 'Project' }));
	for (let i = 0; i < 65; i++) data.task.push(thing(`task-${i}`, { parentId: i ? `task-${i - 1}` : '', projectId: 'project' }));
	data.task.push(thing('orphan', { parentId: 'missing' }), thing('cycle-a', { parentId: 'cycle-b' }), thing('cycle-b', { parentId: 'cycle-a' }));
	data.agent.push(thing('agent', { taskId: 'task-64' }));
	const first = buildOverview(input(), data, true, '2026-01-01T00:00:00Z');
	const second = buildOverview({ ...input(), cursor: first.nextCursor! }, data, true, '2026-01-01T00:00:00Z');
	const rows = [...first.rows, ...second.rows];
	assert.equal(rows.length, 70);
	assert.equal(new Set(rows.map(row => row.id)).size, 70);
	assert.equal(rows.find(row => row.id === 'task-64')?.depth, 65);
	assert.equal(rows.find(row => row.id === 'orphan')?.orphan, true);
	assert.equal(rows.find(row => row.id === 'cycle-a')?.cycle, true);
	assert.equal(rows.find(row => row.id === 'agent')?.depth, 66);
});

test('unknown and measured zero remain distinct; raw crystals and credential fields never escape', () => {
	const row = overviewRow(thing('a', { tokenUsage: 0, progress: 0, password: 'never-project', privateKey: 'never-project', startedAt: 'bad' }), 'task');
	assert.equal(row.tokenUsage, 0); assert.equal(row.hasTokenUsage, true);
	assert.equal(row.progress, 0); assert.equal(row.hasProgress, true);
	assert.equal(row.hasStartedAt, false); assert.equal(row.startedAt, null);
	assert.equal(JSON.stringify(row).includes('never-project'), false);
	assert.equal(overviewRow(thing('b'), 'task').tokenUsage, null);
});

test('chat links project safe HTTPS and site-relative URLs without altering their scope', () => {
	for (const chatUrl of ['https://chatgpt.com/c/abc?model=example#reply', 'https://claude.ai/chat/abc', '/lopu/chat/abc?tab=messages#latest']) {
		assert.equal(overviewRow(thing('task', { chatUrl }), 'task').chatUrl, chatUrl);
	}
});

test('chat links reject credentials, invalid schemes, protocol-relative authorities and control normalization', () => {
	const invalid: unknown[] = [null, 42, {}, '', 'chat/abc', 'https://', 'http://example.com/chat', 'javascript:alert(1)', 'data:text/html,chat',
		'https://user@example.com/chat', 'https://user:password@example.com/chat', '//example.com/chat', '/\\example.com/chat',
		'/\t/example.com/chat', 'https://example.com/\rchat', 'https://example.com/\nchat', 'https://example.com/\u0000chat',
		'https://example.com/\u001fchat', 'https://example.com/\u007fchat', `https://example.com/${'x'.repeat(2048)}`];
	for (const chatUrl of invalid) assert.equal(overviewRow(thing('task', { chatUrl }), 'task').chatUrl, '', JSON.stringify(chatUrl));
	for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
		const chatUrl = `/${String.fromCharCode(code)}/example.com/chat`;
		assert.equal(overviewRow(thing('task', { chatUrl }), 'task').chatUrl, '', `control ${code}`);
	}
});

test('relational children inherit chat links only from their currently authorized task projection', () => {
	const data = records();
	const parentUrl = 'https://chatgpt.com/c/task-chat';
	const ownUrl = 'https://claude.ai/chat/child-chat';
	data.task.push(thing('authorized-task', { chatUrl: parentUrl, externalId: 'task-chat' }));
	for (const role of ['question', 'progress', 'todo'] as const) {
		data[role].push(thing(`${role}-inherited`, { parentId: 'authorized-task' }),
			thing(`${role}-own`, { taskId: 'authorized-task', chatUrl: ownUrl, externalId: 'child-chat' }),
			thing(`${role}-missing-parent`, { parentId: 'unreadable-task' }));
	}
	const result = buildOverview(input(), data, true, 'now');
	for (const rows of [result.questions, result.reports, result.todos]) {
		assert.equal(rows.find(row => row.id.endsWith('-inherited'))?.chatUrl, parentUrl);
		assert.equal(rows.find(row => row.id.endsWith('-inherited'))?.externalId, 'task-chat');
		assert.equal(rows.find(row => row.id.endsWith('-own'))?.chatUrl, ownUrl);
		assert.equal(rows.find(row => row.id.endsWith('-own'))?.externalId, 'child-chat');
		assert.equal(rows.find(row => row.id.endsWith('-missing-parent'))?.chatUrl, '');
		assert.equal(rows.find(row => row.id.endsWith('-missing-parent'))?.externalId, '');
	}
	data.task = [];
	const revoked = buildOverview(input(), data, true, 'now');
	for (const rows of [revoked.questions, revoked.reports, revoked.todos]) {
		assert.equal(rows.find(row => row.id.endsWith('-inherited'))?.chatUrl, '');
		assert.equal(rows.find(row => row.id.endsWith('-inherited'))?.externalId, '');
		assert.equal(rows.find(row => row.id.endsWith('-own'))?.chatUrl, ownUrl);
	}
});

test('selected task children, counts and partial coverage are explicit', () => {
	const data = records();
	data.task.push(thing('one', { title: 'One', status: 'active' }), thing('two', { title: 'Two', status: 'complete' }));
	data.question.push(thing('q', { parentId: 'one', body: 'Which?', answer: '', status: 'open' }));
	data.progress.push(thing('r', { parentId: 'one', body: 'Built' }));
	data.todo.push(thing('todo', { parentId: 'one', title: 'Verify', done: true }));
	const result = buildOverview({ ...input(), taskId: 'one' }, data, false, '2026-01-01T00:00:00Z');
	assert.equal(result.selected?.id, 'one'); assert.equal(result.selected?.questionCount, 1); assert.equal(result.selected?.reportCount, 1);
	assert.equal(result.questions[0].body, 'Which?'); assert.equal(result.todos[0].status, ''); assert.equal(result.todos[0].done, true);
	assert.equal(result.stats.active, 1); assert.equal(result.stats.complete, 1); assert.equal(result.stats.tokenUsage, null);
	assert.equal(result.coverage.complete, false); assert.match(result.coverage.countsLabel, /lower bounds/);
});

test('projection returns raw fields and numeric hierarchy, without presentation labels or CSS', () => {
	const data = records();
	data.task.push(thing('root', { title: 'Root', status: 'In review' }), thing('child', { parentId: 'root', status: 'queued' }));
	data.question.push(thing('question', { parentId: 'root' }));
	data.progress.push(thing('report', { parentId: 'root' }));
	const result = buildOverview(input(), data, true, 'now');
	assert.equal(result.rows.find(row => row.id === 'child')?.depth, 1);
	assert.equal(result.rows.find(row => row.id === 'root')?.status, 'In review');
	assert.equal(result.questions[0].title, ''); assert.equal(result.questions[0].status, ''); assert.equal(result.reports[0].title, '');
	assert.equal(result.rows.some(row => 'indent' in row), false);
	assert.deepEqual(result.columns.map(column => column.status), ['In review', 'queued']);
	assert.equal(result.columns.some(column => 'label' in column), false);
});

test('saved sources configure status classifications without altering raw record statuses', () => {
	const parsed = parseOverviewInput(new URLSearchParams({ taskSchema: 'tasks', activeStatuses: 'Doing, In review,Doing', blockedStatuses: 'Waiting', completeStatuses: 'Shipped' }));
	assert.deepEqual(parsed.activeStatuses, ['Doing', 'In review']);
	const data = records();
	for (const status of ['Doing', 'In review', 'Waiting', 'Shipped', 'active', 'complete']) data.task.push(thing(status, { status }));
	const result = buildOverview(parsed, data, true, 'now');
	assert.equal(result.stats.active, 2); assert.equal(result.stats.blocked, 1); assert.equal(result.stats.complete, 1);
	assert.deepEqual(result.statusGroups, { active: ['Doing', 'In review'], blocked: ['Waiting'], complete: ['Shipped'] });
	assert.equal(result.rows.find(row => row.id === 'active')?.status, 'active');
	const blank = buildOverview(parseOverviewInput(new URLSearchParams({ taskSchema: 'tasks', activeStatuses: '', blockedStatuses: '', completeStatuses: '' })), data, true, 'now');
	assert.equal(blank.stats.active, 0); assert.equal(blank.stats.blocked, 0); assert.equal(blank.stats.complete, 0);
});

test('classification input validates ambiguity and controls, and classification changes invalidate a cursor', () => {
	for (const query of ['activeStatuses=Doing,,Review', 'activeStatuses=Doing%0AReview', 'blockedStatuses=x&blockedStatuses=y', 'completeStatuses=x,%20']) {
		assert.throws(() => parseOverviewInput(new URLSearchParams(`taskSchema=tasks&${query}`)), error => (error as any).status === 400);
	}
	const data = records(); for (let index = 0; index < 51; index++) data.task.push(thing(String(index), { status: 'Doing' }));
	const first = buildOverview(input(), data, true, 'now');
	assert.throws(() => buildOverview({ ...input(), activeStatuses: ['Doing'], cursor: first.nextCursor! }, data, true, 'now'), /pagination changed/);
});

test('view/filter changes and deleted cursor targets refuse stale pagination', () => {
	const data = records(); for (let i = 0; i < 55; i++) data.task.push(thing(String(i), { title: String(i) }));
	const first = buildOverview(input(), data, true, 'now');
	assert.throws(() => buildOverview({ ...input(), q: 'new filter', cursor: first.nextCursor! }, data, true, 'now'), /pagination changed/);
	data.task = data.task.filter(row => row.id !== first.rows.at(-1)?.id);
	assert.throws(() => buildOverview({ ...input(), cursor: first.nextCursor! }, data, true, 'now'), /pagination changed/);
});

test('project, task-status and search filters include relational children through authorized parent tasks', () => {
	const data = records();
	data.project.push(thing('project-one', { recordType: 'agent-project' }), thing('project-two', { recordType: 'agent-project' }));
	data.task.push(thing('root', { title: 'Release', projectId: 'project-one', status: 'active' }), thing('nested', { title: 'Verify release', parentId: 'root', status: 'active' }), thing('other', { title: 'Unrelated', projectId: 'project-two', status: 'active' }));
	for (const role of ['question', 'progress', 'todo'] as const) data[role].push(thing(`${role}-nested`, { parentId: 'nested', body: 'Needs review', title: 'Review' }), thing(`${role}-other`, { parentId: 'other' }));
	data.question.push(thing('question-private-parent', { parentId: 'not-authorized' }));
	const result = buildOverview({ ...input(), projectId: 'project-one', status: 'active', q: 'release', view: 'reports' }, data, true, 'now');
	assert.deepEqual(result.reports.map(row => row.id), ['progress-nested']);
	assert.deepEqual(result.questions.map(row => row.id), ['question-nested']);
	assert.deepEqual(result.todos.map(row => row.id), ['todo-nested']);
	assert.equal(result.questions[0].projectId, 'project-one'); assert.equal(result.stats.questions, 1);
	assert.deepEqual(result.rows.map(row => row.id), ['progress-nested']);
});

test('iterative hierarchy tolerates deep nesting without dropping data', () => {
	const rows = Array.from({ length: 15_000 }, (_, i) => overviewRow(thing(String(i), { parentId: i ? String(i - 1) : '' }), 'task'));
	const result = hierarchyRows(rows);
	assert.equal(result.length, 15_000); assert.equal(result.at(-1)?.depth, 14_999);
});
