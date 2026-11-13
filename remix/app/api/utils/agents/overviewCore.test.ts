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

test('overview filters combine selections across task level, status, and project before paging', () => {
	const data = records();
	for (const id of ['alpha', 'beta', 'gamma']) data.project.push(thing(id));
	data.task.push(
		thing('alpha-root', { parentId: 'alpha', status: 'active' }),
		thing('alpha-subtask', { parentId: 'alpha-root', status: 'complete' }),
		thing('alpha-grandchild', { parentId: 'alpha-subtask', status: 'complete' }),
		thing('agent-subtask', { parentId: 'alpha-agent', status: 'active' }),
		thing('beta-root', { projectId: 'beta', status: 'complete' }),
		thing('gamma-root', { projectId: 'gamma', status: 'active' }),
		thing('excluded-status', { projectId: 'beta', status: 'blocked' }),
		thing('detached', { parentId: 'unknown', projectId: 'beta', status: 'complete' }),
		thing('detached-child', { parentId: 'detached', status: 'complete' })
	);
	data.agent.push(thing('alpha-agent', { taskId: 'alpha-root', status: 'active' }));
	for (const role of ['question', 'progress', 'todo'] as const) data[role].push(
		thing(`${role}-root`, { parentId: 'alpha-root' }), thing(`${role}-subtask`, { parentId: 'alpha-subtask' })
	);
	const filters = 'statuses=complete,active&statuses=active&projectIds=beta&projectIds=alpha';
	const read = (levels: string, complete = true) => buildOverview(
		parseOverviewInput(new URLSearchParams(`taskSchema=tasks&projectSchema=projects&agentSchema=agents&${filters}&${levels}`)), data, complete, 'now'
	);
	const roots = read('taskLevels=top-level');
	assert.deepEqual(roots.rows.map(row => row.id), ['alpha-root', 'beta-root', 'detached']);
	assert.deepEqual(roots.statuses, ['active', 'complete']);
	assert.deepEqual(roots.projectIds, ['alpha', 'beta']);
	assert.deepEqual(roots.availableStatuses, ['active', 'blocked', 'complete']);
	assert.deepEqual(roots.projects.map(row => row.id), ['alpha', 'beta', 'gamma']);
	assert.equal(roots.rows[0].depth, 1);
	assert.equal(roots.rows[0].projectId, 'alpha');
	assert.equal(roots.rows[2].orphan, true);
	assert.equal(read('taskLevels=top-level', false).rows[2].unresolvedParent, true);
	assert.deepEqual(roots.reports.map(row => row.id), ['progress-root']);
	assert.deepEqual(roots.todos.map(row => row.id), ['todo-root']);
	assert.equal(roots.stats.tasks, 3);
	const nested = read('taskLevels=subtasks');
	assert.deepEqual(nested.rows.map(row => row.id), ['alpha-subtask', 'alpha-grandchild', 'agent-subtask', 'detached-child']);
	assert.deepEqual(nested.questions.map(row => row.id), ['question-subtask']);
	assert.equal(nested.rows[1].projectId, 'alpha');
	assert.equal(nested.rows[2].projectId, 'alpha');
	assert.equal(nested.rows[3].projectId, 'beta');
	assert.equal(nested.rows[3].orphan, false);
	const both = read('taskLevels=subtasks&taskLevels=top-level');
	assert.equal(both.rows.length, 7);
	assert.deepEqual(both.taskLevels, ['top-level', 'subtasks']);
	assert.deepEqual(read('taskLevels=all').rows, both.rows);
	assert.deepEqual(read('taskLevels=').rows, both.rows);
	assert.deepEqual(read('taskLevels=%5B%5D').rows, both.rows);
	assert.equal(read('').rows.some(row => row.id === 'alpha-agent'), true);
	const detail = buildOverview({ ...input(), taskLevels: ['top-level'], statuses: ['blocked'], taskId: 'alpha-subtask' }, data, true, 'now');
	assert.equal(detail.selected?.id, 'alpha-subtask');
	assert.deepEqual(detail.reports.map(row => row.id), ['progress-subtask']);
});

test('selection cursors canonicalize lists, reject changes, and keep legacy scalar filters literal', () => {
	const data = records();
	for (let index = 0; index < 55; index++) data.task.push(thing(String(index), { status: 'active', projectId: 'alpha' }));
	data.task.push(thing('literal', { status: 'active, complete', projectId: 'alpha,beta' }));
	const query = (filter: string) => parseOverviewInput(new URLSearchParams(`taskSchema=tasks&${filter}`));
	const first = buildOverview(query('statuses=active,complete&projectIds=alpha,beta&taskLevels=top-level'), data, true, 'now');
	assert.ok(first.nextCursor);
	const reordered = query('taskLevels=top-level&projectIds=beta&projectIds=alpha,beta&statuses=complete,active,active');
	assert.equal(buildOverview({ ...reordered, cursor: first.nextCursor! }, data, true, 'now').rows.length, 5);
	for (const change of [{ taskLevels: ['subtasks'] as const }, { projectIds: ['beta'] }, { statuses: ['complete'] }]) {
		const changed = { ...reordered, ...change, taskLevels: 'taskLevels' in change ? [...change.taskLevels] : reordered.taskLevels };
		assert.throws(() => buildOverview({ ...changed, cursor: first.nextCursor! }, data, true, 'now'), /pagination changed/);
	}
	assert.deepEqual(buildOverview(query('status=active%2C+complete&projectId=alpha%2Cbeta'), data, true, 'now').rows.map(row => row.id), ['literal']);
	assert.equal(buildOverview(query('status=blocked&statuses='), data, true, 'now').stats.tasks, 56);
	assert.throws(() => query('taskLevels=invalid'), /Invalid taskLevels/);
	assert.throws(() => query('statuses=bad%0Astatus'), /Invalid statuses/);
});

test('JSON filter lists preserve exact labels and reject non-string or control values', () => {
	const status = ' In review, external ';
	const data = records();
	data.task.push(thing('exact', { status }), thing('trimmed', { status: status.trim() }), thing('active', { status: 'active' }));
	const params = new URLSearchParams({ taskSchema: 'tasks', status: 'legacy', statuses: JSON.stringify([status, status], null, 2) });
	params.append('statuses', 'active');
	const result = buildOverview(parseOverviewInput(params), data, true, 'now');
	assert.deepEqual(result.statuses, [status, 'active']);
	assert.deepEqual(result.rows.map(row => row.id), ['exact', 'active']);
	params.set('statuses', '[]');
	assert.equal(buildOverview(parseOverviewInput(params), data, true, 'now').stats.tasks, 3);
	for (const invalid of ['[', '[1]', '["a",null]', '[["nested"]]', '["bad\\nvalue"]']) {
		params.set('statuses', invalid);
		assert.throws(() => parseOverviewInput(params), /Invalid statuses/);
	}
});

test('task activity and inline open questions use only authorized, valid source timestamps and question fields', () => {
	const data = records();
	data.task.push({ id: 'task', crystal: { title: 'Task', status: 'active' }, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' },
		thing('unknown', { title: 'Unknown' }));
	data.progress.push({ id: 'progress', crystal: { parentId: 'task', body: 'Built' }, updatedAt: '2026-11-04T00:00:00Z' },
		{ id: 'other-progress', crystal: { parentId: 'unreadable-task' }, updatedAt: '2026-11-12T00:00:00Z' });
	data.todo.push({ id: 'todo', crystal: { parentId: 'task', title: 'Check' }, updatedAt: '2026-11-06T00:00:00Z' });
	data.agent.push({ id: 'agent', crystal: { taskId: 'task', status: 'blocked' }, updatedAt: '2026-11-07T00:00:00Z' });
	data.question.push({ id: 'open', crystal: { parentId: 'task', body: 'Which route?', password: 'hidden' }, createdAt: '2026-11-03T00:00:00Z' },
		{ id: 'answered', crystal: { parentId: 'task', body: 'Resolved', answer: 'Use the saved page', status: 'answered' }, updatedAt: '2026-11-05T00:00:00Z' },
		{ id: 'bad-date', crystal: { parentId: 'task', body: 'Still open' }, updatedAt: 'invalid-date' });
	const result = buildOverview(input(), data, true, '2026-11-13T00:00:00Z');
	const task = result.rows.find(row => row.id === 'task')!;
	assert.equal(task.lastActivityAt, '2026-11-07T00:00:00.000Z');
	assert.equal(task.statusGroup, 'active');
	assert.equal(result.agents[0].statusGroup, 'blocked');
	assert.equal(task.questionCount, 3);
	assert.equal(task.openQuestionCount, 2);
	assert.deepEqual(task.openQuestions.map(row => row.id), ['open', 'bad-date']);
	assert.deepEqual(task.questions.map(row => row.id), ['open', 'bad-date', 'answered']);
	assert.equal(task.questions[2].answer, 'Use the saved page');
	assert.equal(task.openQuestions[0].body, 'Which route?');
	assert.equal(JSON.stringify(task.openQuestions).includes('hidden'), false);
	assert.equal(result.rows.find(row => row.id === 'unknown')?.lastActivityAt, null);
	const partial = buildOverview(input(), data, false, 'now');
	assert.equal(partial.rows.find(row => row.id === 'task')?.relatedRecordsComplete, false);
	assert.equal(partial.coverage.relatedRecordsComplete, false);
	assert.equal(partial.coverage.archiveTreeComplete, false);
});

test('archive filters task trees without changing status, descendants, exact detail or cursor authority', () => {
	const data = records();
	data.task.push(thing('archived-parent', { status: 'complete', archived: true }), thing('inherited-child', { parentId: 'archived-parent', status: 'active' }),
		thing('active-parent', { status: 'todo' }), thing('explicit-child', { parentId: 'active-parent', status: 'blocked', archived: true }),
		thing('active', { status: 'waiting-approval' }), thing('agent-descendant', { parentId: 'agent-under-archive', status: 'active' }));
	data.agent.push(thing('agent-under-archive', { taskId: 'archived-parent' }));
	data.question.push(thing('hidden-question', { parentId: 'archived-parent', body: 'Hidden in active board' }), thing('active-question', { parentId: 'active', body: 'Visible' }));
	const active = buildOverview(input(), data, true, 'now');
	assert.deepEqual(active.rows.map(row => row.id), ['active-parent', 'active']);
	assert.deepEqual(active.questions.map(row => row.id), ['active-question']);
	assert.equal(active.stats.tasks, 2);
	assert.equal(active.rows.find(row => row.id === 'active')?.statusGroup, 'waiting');
	assert.equal(active.rows.find(row => row.id === 'active-parent')?.statusGroup, 'todo');
	const archived = buildOverview({ ...input(), archive: 'archived' }, data, true, 'now');
	assert.deepEqual(archived.rows.filter(row => row.recordType === 'agent-task').map(row => row.id), ['archived-parent', 'inherited-child', 'agent-descendant', 'explicit-child']);
	assert.equal(archived.rows.find(row => row.id === 'inherited-child')?.archived, false);
	assert.equal(archived.rows.find(row => row.id === 'inherited-child')?.effectiveArchived, true);
	assert.equal(archived.rows.find(row => row.id === 'inherited-child')?.archivedAncestorId, 'archived-parent');
	assert.equal(archived.rows.find(row => row.id === 'agent-descendant')?.archivedAncestorId, 'archived-parent');
	assert.equal(archived.rows.find(row => row.id === 'archived-parent')?.status, 'complete');
	const all = buildOverview({ ...input(), archive: 'all' }, data, true, 'now');
	assert.equal(all.rows.filter(row => row.recordType === 'agent-task').length, 6);
	const detail = buildOverview({ ...input(), taskId: 'archived-parent' }, data, true, 'now');
	assert.equal(detail.selected?.id, 'archived-parent');
	assert.deepEqual(detail.selectedChildren.map(row => row.id), ['inherited-child', 'agent-descendant']);
	assert.deepEqual(detail.questions.map(row => row.id), ['hidden-question']);
	for (const invalid of ['archive=', 'archive=deleted', 'archive=active&archive=all'])
		assert.throws(() => parseOverviewInput(new URLSearchParams(`taskSchema=tasks&${invalid}`)), /Invalid archive/);
	const many = records();
	for (let i = 0; i < 51; i++) many.task.push(thing(String(i)));
	const first = buildOverview(input(), many, true, 'now');
	assert.throws(() => buildOverview({ ...input(), archive: 'all', cursor: first.nextCursor! }, many, true, 'now'), /pagination changed/);
	const cyclic = records();
	cyclic.task.push(thing('cycle-a', { parentId: 'cycle-b', archived: true }), thing('cycle-b', { parentId: 'cycle-a' }), thing('outside', { parentId: 'cycle-b' }));
	const cyclicRead = buildOverview({ ...input(), archive: 'archived' }, cyclic, true, 'now');
	assert.deepEqual(new Set(cyclicRead.rows.map(row => row.id)), new Set(['cycle-a', 'cycle-b', 'outside']));
	assert.equal(cyclicRead.rows.find(row => row.id === 'outside')?.archivedAncestorId, 'cycle-a');
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
