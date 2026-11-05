import type { BehaviourSuite, SuiteActionDef } from '../behaviourSuites';
import { appShell, boundBlock, each, ifTruthy, makeKit, makeTheme, navComponent, returnValue } from './kit';

const theme = makeTheme();
const kit = makeKit(theme);
const states = ['todo', 'active', 'blocked', 'complete'];
const taskInput = { name: 'taskId', type: 'string' as const, label: 'Task Thing ID', required: true };
const taskRead = { op: 'things.get', id: '$input.taskId' };
const createTask: SuiteActionDef = {
	key: 'create-task', name: 'Create agent task', category: 'agents', description: 'Creates a private task Data Thing with isolated security defaults.',
	inputs: [{ name: 'title', type: 'string', label: 'Title', required: true }, { name: 'description', type: 'text', label: 'Description' }],
	steps: refs => [{ op: 'things.create', schema: refs.schema('task'), values: { recordType: 'agent-task', title: '$input.title', description: '$input.description', status: 'todo',
		useCustomSecurity: false, network: { mode: 'isolated', rules: [] }, createdAt: '$now' } }, returnValue({ id: '$step.1.id', message: 'Task created. Open its browser controls to claim an isolated session.' })],
	capabilities: refs => [{ capability: 'things.create', schemas: [refs.schema('task')] }]
};
const updateTask: SuiteActionDef = {
	key: 'update-task', name: 'Update task progress', category: 'agents', description: 'Updates a task’s status through the normal Thing write path.',
	inputs: [taskInput, { name: 'status', type: 'enum', label: 'Status', values: states, required: true }],
	steps: () => [taskRead, { op: 'things.update', id: '$input.taskId', values: { status: '$input.status' } }, returnValue({ message: 'Task status updated.' })],
	capabilities: refs => [{ capability: 'things.read', schemas: [refs.schema('task')] }, { capability: 'things.update', schemas: [refs.schema('task')] }]
};
const addTodo: SuiteActionDef = {
	key: 'add-todo', name: 'Add task todo', category: 'agents', description: 'Creates an independent todo Thing linked to the parent task.',
	inputs: [taskInput, { name: 'title', type: 'string', label: 'Todo', required: true }],
	steps: refs => [taskRead, { op: 'things.create', schema: refs.schema('todo'), values: { parentId: '$input.taskId', title: '$input.title', done: false, createdAt: '$now' } }, returnValue({ id: '$step.2.id', message: 'Todo added.' })],
	capabilities: refs => [{ capability: 'things.read', schemas: [refs.schema('task')] }, { capability: 'things.create', schemas: [refs.schema('todo')] }]
};
const addProgress: SuiteActionDef = {
	key: 'add-progress', name: 'Record task update', category: 'agents', description: 'Appends an independent progress Thing. Never include credentials or page contents containing secrets.',
	inputs: [taskInput, { name: 'body', type: 'text', label: 'Progress update', required: true }],
	steps: refs => [taskRead, { op: 'things.create', schema: refs.schema('progress'), values: { parentId: '$input.taskId', body: '$input.body', createdAt: '$now' } }, returnValue({ id: '$step.2.id', message: 'Progress saved.' })],
	capabilities: refs => [{ capability: 'things.read', schemas: [refs.schema('task')] }, { capability: 'things.create', schemas: [refs.schema('progress')] }]
};
const readChildren = (kind: 'todo' | 'progress'): SuiteActionDef => ({
	key: `read-${kind}`, name: `Read task ${kind === 'todo' ? 'todos' : 'updates'}`, category: 'agents', runtime: 'browser',
	description: 'Reads a cursor page of independent child Things for one task.',
	inputs: [taskInput, { name: 'cursor', type: 'string', label: 'Cursor', default: '' }],
	steps: refs => [{ op: 'http.request', method: 'POST', path: '/api/v1/things/search', feature: 'api.things-search', minimumVersion: '1.4.0', query: {},
		body: { thingtime: 'data', scope: 'mine', conditions: [{ field: 'schema', op: 'eq', value: refs.schemaName(kind) }, { field: 'crystal.parentId', op: 'eq', value: '$input.taskId' }], sort: 'newest', cursor: '$input.cursor', limit: 20 } },
		returnValue({ records: '$step.1.things', nextCursor: '$step.1.nextCursor', incomplete: '$step.1.incomplete' })],
	capabilities: () => [{ capability: 'http.request', endpoints: ['POST /api/v1/things/search'] }]
});

export const agentTasksSuite: BehaviourSuite = {
	key: 'agent-tasks', title: 'Agent tasks', emoji: '🧭', tone: 'paper',
	description: 'Editable tasks, todos and progress records, with device-owned browser claims and a live viewer.',
	story: ['Tasks, todos and updates are private Data Things. Edit the schemas, Components and Actions in Builder.', 'Open a task’s browser controls in the Thingtime Mac app to choose its security policy and claim a separate browser.'],
	app: { tagline: 'Tasks with their own browsers', entry: 'tasks' },
	schemas: [
		{ key: 'task', description: 'An agent task; network preferences apply only to new browser claims.', fields: [
			{ name: 'recordType', type: 'string', required: true }, { name: 'title', type: 'string', required: true }, { name: 'description', type: 'string' },
			{ name: 'status', type: 'enum', values: states }, { name: 'useCustomSecurity', type: 'boolean' },
			{ name: 'network', type: 'object', children: [{ name: 'mode', type: 'enum', values: ['isolated', 'restricted', 'unrestricted'] },
				{ name: 'rules', type: 'array', items: { type: 'object', children: [{ name: 'address', type: 'string' }, { name: 'protocol', type: 'enum', values: ['any', 'tcp', 'udp'] }, { name: 'ports', type: 'array', items: { type: 'number' } }] } }] },
			{ name: 'createdAt', type: 'date' }
		] },
		{ key: 'todo', description: 'An atomic todo linked to a task by parentId.', fields: [{ name: 'parentId', type: 'string', required: true }, { name: 'title', type: 'string', required: true }, { name: 'done', type: 'boolean' }, { name: 'createdAt', type: 'date' }] },
		{ key: 'progress', description: 'An atomic task update linked by parentId.', fields: [{ name: 'parentId', type: 'string', required: true }, { name: 'body', type: 'string', required: true }, { name: 'createdAt', type: 'date' }] }
	],
	actions: [createTask, updateTask, addTodo, addProgress, readChildren('todo'), readChildren('progress'), {
		key: 'recent-tasks', name: 'Read agent tasks', category: 'agents', runtime: 'browser', description: 'Reads your task Things in cursor pages, with no maximum task count.',
		inputs: [{ name: 'cursor', type: 'string', label: 'Cursor', default: '' }],
		steps: refs => [{ op: 'http.request', method: 'POST', path: '/api/v1/things/search', feature: 'api.things-search', minimumVersion: '1.4.0', query: {},
			body: { thingtime: 'data', scope: 'mine', conditions: [{ field: 'schema', op: 'eq', value: refs.schemaName('task') }], sort: 'newest', cursor: '$input.cursor', limit: 20 } },
			returnValue({ tasks: '$step.1.things', nextCursor: '$step.1.nextCursor', incomplete: '$step.1.incomplete' })],
		capabilities: () => [{ capability: 'http.request', endpoints: ['POST /api/v1/things/search'] }]
	}, {
		key: 'complete-todo', name: 'Complete task todo', category: 'agents', description: 'Marks one todo complete.', inputs: [{ name: 'todoId', type: 'string', label: 'Todo Thing ID', required: true }],
		steps: () => [{ op: 'things.update', id: '$input.todoId', values: { done: true } }, returnValue({ message: 'Todo completed.' })],
		capabilities: refs => [{ capability: 'things.update', schemas: [refs.schema('todo')] }]
	}],
	components: [navComponent(theme, { brand: 'Agent tasks', emoji: '🧭', home: '/p/agent-tasks', links: [['tasks', 'Tasks', '/p/agent-tasks'], ['controls', 'Browser controls', '/agent-browsers']] }), {
		key: 'task-board', name: 'Agent task board', description: 'An editable task creation form and paginated task cards.', args: [],
		render: refs => kit.stack([
			kit.group([kit.field('Task title', kit.input('title')), kit.field('Description', kit.textarea('description')), kit.button('Create task', refs.actionKey('create-task'), {})]),
			kit.title('Tasks'), ifTruthy('result.incomplete', kit.muted('Showing tasks saved on this device. Other account tasks may be available online.')),
			each('result.tasks', kit.card([kit.strong('{item.crystal.title}'), kit.text('{item.crystal.description}'), kit.pill('{item.crystal.status}'),
				kit.row([kit.link('Todos and updates', '/p/agent-tasks-detail?taskId={item.id}'), kit.link('Browser controls', '/agent-browsers/{item.id}'), kit.link('Open task Thing', '/thing/{item.id}')]),
				kit.muted('Task ID: {item.id}')]), { empty: kit.text('Create your first task above.') }),
			kit.row([kit.link('First page', '/p/agent-tasks'), ifTruthy('result.nextCursor', kit.button('Next page', '$ui', { op: 'query', params: { cursor: '{result.nextCursor}' } })), kit.link('Open the Things library', '/things')]),
			kit.group([kit.title('Update a task'), kit.field('Task Thing ID', kit.input('taskId')), kit.field('Status', kit.select('status', states.map(value => [value, value]))), kit.button('Save status', refs.actionKey('update-task'), {})]),
			kit.group([kit.title('Add a todo'), kit.field('Task Thing ID', kit.input('taskId')), kit.field('Todo', kit.input('title')), kit.button('Add todo', refs.actionKey('add-todo'), {})]),
			kit.group([kit.title('Record progress'), kit.field('Task Thing ID', kit.input('taskId')), kit.field('Update', kit.textarea('body')), kit.button('Save update', refs.actionKey('add-progress'), {})])
		])
	}, {
		key: 'task-todos', name: 'Task todos', description: 'Editable, paginated todo list with completion controls.', args: [],
		render: refs => kit.stack([
			kit.title('Todos'), ifTruthy('result.incomplete', kit.muted('Showing todos saved on this device. Other account todos may be available online.')), kit.link('Browser controls', '/agent-browsers/{query.taskId}'),
			kit.group([kit.field('Todo', kit.input('title')), kit.button('Add todo', refs.actionKey('add-todo'), { taskId: '{query.taskId}' })]),
			each('result.records', kit.card([kit.strong('{item.crystal.title}'), ifTruthy('item.crystal.done', kit.pill('Complete'), kit.group([kit.button('Mark complete', refs.actionKey('complete-todo'), { todoId: '{item.id}' })]))]), { empty: kit.muted('No todos on this page.') }),
			kit.row([kit.link('First page', '/p/agent-tasks-detail?taskId={query.taskId}'), ifTruthy('result.nextCursor', kit.button('Next todos', '$ui', { op: 'query', params: { taskId: '{query.taskId}', todoCursor: '{result.nextCursor}' } }))])
		])
	}, {
		key: 'task-progress', name: 'Task progress', description: 'Editable, paginated progress history.', args: [],
		render: refs => kit.stack([
			kit.title('Progress'), ifTruthy('result.incomplete', kit.muted('Showing updates saved on this device. Other account updates may be available online.')), kit.group([kit.field('Update', kit.textarea('body')), kit.button('Save update', refs.actionKey('add-progress'), { taskId: '{query.taskId}' })]),
			each('result.records', kit.card([kit.text('{item.crystal.body}'), kit.muted('{item.crystal.createdAt}')]), { empty: kit.muted('No updates on this page.') }),
			ifTruthy('result.nextCursor', kit.button('Next updates', '$ui', { op: 'query', params: { taskId: '{query.taskId}', progressCursor: '{result.nextCursor}' } }))
		])
	}],
	data: [],
	pages: [{ key: 'tasks', name: 'Agent tasks', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'tasks', [boundBlock(ctx, refs, 'task-board', 'task-board', 'recent-tasks', { cursor: '{query.cursor}' })], { maxWidth: 1000 }) },
		{ key: 'detail', name: 'Task todos and progress', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'tasks', [
			boundBlock(ctx, refs, 'task-todos', 'task-todos', 'read-todo', { taskId: '{query.taskId}', cursor: '{query.todoCursor}' }),
			boundBlock(ctx, refs, 'task-progress', 'task-progress', 'read-progress', { taskId: '{query.taskId}', cursor: '{query.progressCursor}' })
		], { maxWidth: 1000 }) }]
};
