// DONE & DUSTED — a todo app on Thingtime. The "hello world" of app suites,
// written to exercise the everyday builder features one by one:
//
//   forms        a fieldset of named fields (text, select, date, textarea,
//                a real tt-upload) → one `add` action
//   lists        a source-bound board (things.search + expressions →
//                ttEach rows) that refetches after every control run
//   deep links   ?filter=today / ?edit=<id> flow through `{query.*}` into
//                source inputs and the filter chips
//   edits        things.get → things.update, an editor prefilled from the
//                bound record (value → defaultValue), snooze via dateAdd
//   deletes      things.delete, and `each` → a child action (clear done)
//   last-run     the search card narrates `last.result` — no source needed
//
// Every task is a private data thing of the viewer; nothing runs as anyone
// else. Install once from /builder/demos (📱 Apps) and the pages come alive.

import type { BehaviourSuite, SuiteActionDef, SuiteComponentDef, SuiteRefs } from '../behaviourSuites.ts';
import { appShell, boundBlock, componentBlock, compute, concat, each, el, eq, fmt, get, ifEquals, ifTruthy, iff, isEmpty, len, makeKit, makeTheme, navComponent, notEmpty, percent, pick, returnValue, rows, search, today, x, type Node } from './kit.ts';

const T = makeTheme({ accent: '#f2662d', soft: '#fff1ea', border: '#f1dccf', bg: '#fff8f4' });
const k = makeKit(T);

const PROJECTS: Array<[string, string]> = [
	['inbox', '📥 Inbox'],
	['work', '💼 Work'],
	['home', '🏠 Home'],
	['someday', '🌤 Someday']
];
const PRIORITIES: Array<[string, string]> = [
	['medium', 'Medium'],
	['high', 'High'],
	['low', 'Low']
];
const PRIORITY_BG = { high: '#fdecec', medium: '#fff4e5', low: T.soft };
const PRIORITY_INK = { high: T.danger, medium: '#b45309', low: T.muted };
const SMALL = { padding: '6px 11px', fontSize: '12px' };

// ── row view of a task (what the board, the done list and search draw) ──────
const priorityPill = (arg = 'item.priority'): Node =>
	el('span', { display: 'inline-block', fontFamily: T.font, fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', background: pick(arg, PRIORITY_BG, T.soft), color: pick(arg, PRIORITY_INK, T.muted), whiteSpace: 'nowrap' }, [fmt(arg, 'capitalize')]);
const duePill = (): Node =>
	ifTruthy(
		'item.due',
		el('span', { display: 'inline-block', fontFamily: T.font, fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', background: pick('item.dueTone', { overdue: '#fdecec', today: '#e6f6ee' }, T.soft), color: pick('item.dueTone', { overdue: T.danger, today: T.ok }, T.muted), whiteSpace: 'nowrap' }, ['{item.dueText}'])
	);
const projectPill = (): Node => k.pill(pick('item.project', Object.fromEntries(PROJECTS), '📥 Inbox'));
const filePill = (): Node => ifTruthy('item.file', k.textLink('📎 attachment', '{item.file}', { fontSize: '12px' }));

const taskRow = (refs: SuiteRefs, options: { done?: boolean } = {}): Node =>
	// a fieldset per row: a control inside reads only THIS row's fields (none
	// here — the ids ride in ttActionInputs), never the composer's
	el('fieldset', { border: `1px solid ${T.border}`, margin: 0, padding: '10px 12px', minWidth: 0, background: T.surface, borderRadius: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }, [
		k.button(options.done ? '↩' : '○', refs.actionKey('toggle'), { id: '{item.id}' }, options.done ? 'soft' : 'ghost', { padding: '6px 11px', fontSize: '15px', lineHeight: 1 }),
		el('div', { display: 'grid', gap: '4px', flex: '1 1 220px', minWidth: 0 }, [
			k.strong('{item.title}', { fontSize: '15px', ...(options.done ? { textDecoration: 'line-through', color: T.muted } : {}) }),
			k.row([priorityPill(), duePill(), projectPill(), filePill()], { gap: '6px' })
		]),
		options.done
			? k.row([k.muted('done {item.doneOn}'), k.button('🗑', refs.actionKey('remove'), { id: '{item.id}' }, 'ghost', SMALL)], { gap: '6px' })
			: k.row([k.button('Snooze', refs.actionKey('snooze'), { id: '{item.id}' }, 'soft', SMALL), k.link('Edit', '/p/dusted-task?edit={item.id}', 'ghost', SMALL), k.button('🗑', refs.actionKey('remove'), { id: '{item.id}' }, 'ghost', SMALL)], { gap: '6px' })
	]);

// ── components ──────────────────────────────────────────────────────────────
const nav = navComponent(T, {
	brand: 'Done & Dusted',
	emoji: '✅',
	home: '/p/dusted',
	links: [
		['tasks', 'Tasks', '/p/dusted'],
		['done', 'Done', '/p/dusted-done'],
		['task', 'Editor', '/p/dusted-task']
	]
});

const composer: SuiteComponentDef = {
	key: 'composer',
	name: 'Task composer',
	description: 'One fieldset, one button: every named field inside — including the uploaded file (file + fileAttachmentId) — lands as an input of the add action.',
	args: [{ name: 'heading', type: 'string', label: 'Heading', default: 'Add a task', maxLength: 60 }],
	render: (refs) =>
		k.card([
			k.strong('{heading}'),
			k.group([
				k.field('Title', k.input('title', { placeholder: 'What needs doing?', required: true, maxLength: 140 })),
				el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }, [
					k.field('Priority', k.select('priority', PRIORITIES)),
					k.field('Due', k.input('due', { type: 'date' })),
					k.field('Project', k.select('project', PROJECTS))
				]),
				k.field('Notes', k.textarea('notes', { placeholder: 'Optional details', maxLength: 2000 })),
				k.field('Attachment', k.upload('file', { title: 'Attach a file' }), 'Optional — a photo of the whiteboard, a PDF, anything. Upload, choose “Use file”, then add; the file stays private to you.'),
				k.row([k.button('Add task', refs.actionKey('add'), {}), k.muted('The board below refreshes itself after every run.')])
			])
		])
};

const chip = (caption: string, href: string, key: string): Node =>
	ifEquals('result.filter', key, k.link(caption, href, 'solid', SMALL), k.link(caption, href, 'ghost', SMALL));

const board: SuiteComponentDef = {
	key: 'board',
	name: 'Task board',
	description: 'The open list, bound to the overview action. Filter chips are plain links — ?filter=… rides into the source input through {query.filter}.',
	args: [{ name: 'heading', type: 'string', label: 'Heading', default: 'Open tasks', maxLength: 60 }],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Done & Dusted',
				'A todo app whose every control is a declarative action over your own data things — add, tick, snooze, edit, delete, clear.',
				el('div', { display: 'grid', gap: '10px' }, [
					k.row([
						k.strong('{heading}', { fontSize: '17px' }),
						k.muted('{result.stats.open} open · {result.stats.overdue} overdue · {result.stats.today} due today', { marginLeft: 'auto' })
					]),
					k.row([chip('All', '/p/dusted', 'all'), chip('Today', '/p/dusted?filter=today', 'today'), chip('Overdue', '/p/dusted?filter=overdue', 'overdue'), chip('High priority', '/p/dusted?filter=high', 'high'), chip('Inbox', '/p/dusted?project=inbox', 'inbox')], { gap: '6px' }),
					each('result.items', taskRow(refs), { max: 30, empty: k.soft([k.strong('Nothing here 🎉'), k.muted('Add a task above, or pick another filter.')]) }),
					ifTruthy('result.truncated', k.muted('Showing the first 30 — finish a few and the rest appear.'))
				])
			)
		])
};

const stats: SuiteComponentDef = {
	key: 'stats',
	name: 'Progress strip',
	description: 'Four tiles and a progress bar computed by the overview action — one request shared with the board when both bind the same source.',
	args: [],
	render: () =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Done & Dusted',
				'Counts and a completion bar over your tasks.',
				el('div', { display: 'grid', gap: '10px' }, [
					k.grid([k.stat('{result.stats.open}', 'open'), k.stat('{result.stats.overdue}', 'overdue', { background: '#fdecec' }), k.stat('{result.stats.today}', 'due today'), k.stat('{result.stats.doneTotal}', 'done, ever')], 120),
					k.row([k.muted('{result.stats.donePercent}% of everything you ever added is done'), k.muted('{result.stats.doneToday} finished today', { marginLeft: 'auto' })]),
					k.bar('result.stats.donePercent', T.ok)
				]),
				{ inert: k.grid([k.stat('7', 'open'), k.stat('1', 'overdue', { background: '#fdecec' }), k.stat('2', 'due today'), k.stat('42', 'done, ever')], 120) }
			)
		])
};

const finder: SuiteComponentDef = {
	key: 'finder',
	name: 'Task finder',
	description: 'A search box with no source binding: the Find button runs the find action and the card renders last.result — the runtime hands every component the most recent run.',
	args: [],
	render: (refs) =>
		k.card([
			k.strong('Find a task'),
			k.group([k.row([k.input('q', { placeholder: 'Search open task titles…', maxLength: 80 }, { flex: '1 1 200px', width: 'auto' }), k.button('Find', refs.actionKey('find'), {}, 'ghost')])]),
			ifEquals(
				'last.action',
				refs.actionKey('find'),
				el('div', { display: 'grid', gap: '8px' }, [k.muted('{last.result.count} matching “{last.result.q}”'), each('last.result.items', taskRow(refs), { max: 12, empty: k.muted('No open task matches that.') })]),
				k.muted('Type a word and press Find — the matches render from the last run’s result, no page reload.')
			)
		])
};

const editor: SuiteComponentDef = {
	key: 'editor',
	name: 'Task editor',
	description: 'Bound to the task action with the id from ?edit=… — fields prefill from the record (value → defaultValue) and Save runs things.update with the id in ttActionInputs.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Done & Dusted',
				'Edit one task.',
				ifTruthy(
					'result.hasTask',
					k.card([
						k.row([k.strong('Edit task', { fontSize: '17px' }), k.muted('created {result.task.createdOn}', { marginLeft: 'auto' })]),
						k.group([
							k.field('Title', k.input('title', { value: '{result.task.title}', required: true, maxLength: 140 })),
							el('div', { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }, [
								k.field('Priority', k.select('priority', PRIORITIES, { value: '{result.task.priority}' })),
								k.field('Due', k.input('due', { type: 'date', value: '{result.task.due}' })),
								k.field('Project', k.select('project', PROJECTS, { value: '{result.task.project}' }))
							]),
							k.field('Notes', k.textarea('notes', { value: '{result.task.notes}', maxLength: 2000 })),
							k.field('Attachment', k.upload('file', { title: 'Attachment', value: '{result.task.file}', attachmentId: '{result.task.fileAttachmentId}' }), 'Replace it, clear it, or leave it — Clear removes the link but keeps the private file in your account.'),
							k.row([
								k.button('Save changes', refs.actionKey('edit'), { id: '{result.task.id}' }),
								ifEquals('result.task.status', 'done', k.button('Reopen', refs.actionKey('toggle'), { id: '{result.task.id}' }, 'soft'), k.button('Mark done ✓', refs.actionKey('toggle'), { id: '{result.task.id}' }, 'ok')),
								k.link('← Back to tasks', '/p/dusted')
							])
						])
					]),
					k.card([k.strong('Pick a task to edit'), k.text('Open this page from a task’s Edit link on the board — the task id rides along in the URL as ?edit=… and this component binds it as its source input.'), k.row([k.link('← Tasks', '/p/dusted', 'solid')])])
				),
				{ inert: k.card([k.strong('Edit task'), k.text('Prefilled fields, Save, Mark done — bound to the task named in the URL.')]) }
			)
		])
};

const doneList: SuiteComponentDef = {
	key: 'done',
	name: 'Done list',
	description: 'Finished tasks with undo, and a Clear button that runs `each` over the list — one child delete per row.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Done & Dusted',
				'Everything you finished.',
				el('div', { display: 'grid', gap: '10px' }, [
					k.row([k.strong('Done ✓', { fontSize: '17px' }), k.muted('{result.stats.doneTotal} finished · {result.stats.doneToday} today', { marginLeft: 'auto' })]),
					each('result.done', taskRow(refs, { done: true }), { max: 30, empty: k.soft([k.strong('Nothing finished yet'), k.muted('Tick a task on the board and it lands here.')]) }),
					k.group([k.row([k.button('Clear all done', refs.actionKey('clear-done'), {}, 'danger'), k.muted('Runs the remove action once per finished task (each → child action).')])])
				])
			)
		])
};

// ── actions ─────────────────────────────────────────────────────────────────
const dueTone = (due: unknown, todayIso: unknown): Node => iff(isEmpty(due), 'none', iff(x('lt', due, todayIso), 'overdue', iff(eq(due, todayIso), 'today', 'later')));
const dueText = (due: unknown, todayIso: unknown): Node => iff(isEmpty(due), '', iff(x('lt', due, todayIso), concat('Overdue · ', due), iff(eq(due, todayIso), 'Due today', concat('Due ', due))));
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const viewRows = (listStep: string, todayStep: string): Node =>
	x(
		'map',
		listStep,
		x('merge', '$item.crystal', {
			id: '$item.id',
			dueTone: dueTone('$item.crystal.due', todayStep),
			dueText: dueText('$item.crystal.due', todayStep),
			doneOn: iff(notEmpty('$item.crystal.doneAt'), x('isoDate', '$item.crystal.doneAt'), ''),
			// overdue rows first (a missing due date is never overdue), then by priority
			rank: x('add', iff(x('and', notEmpty('$item.crystal.due'), x('lt', '$item.crystal.due', todayStep)), 0, 10), get(PRIORITY_RANK, '$item.crystal.priority', 1))
		})
	);
const filterHolds = (filter: unknown, project: unknown): Node =>
	x(
		'and',
		x('or', isEmpty(project), eq('$item.project', project)),
		iff(eq(filter, 'today'), x('or', eq('$item.dueTone', 'today'), eq('$item.dueTone', 'overdue')), iff(eq(filter, 'overdue'), eq('$item.dueTone', 'overdue'), iff(eq(filter, 'high'), eq('$item.priority', 'high'), true)))
	);
const taskCaps = (refs: SuiteRefs, ...capabilities: string[]) => capabilities.map((capability) => ({ capability, schemas: [refs.schema('task')] }));
const dueValue = (input: string): Node => iff(isEmpty(input), null, input);

const overviewAction: SuiteActionDef = {
	key: 'overview',
	name: 'Overview',
	description: 'The open list (filtered, overdue first), the done list, and the stats every page shows.',
	category: 'todo',
	inputs: [
		{ name: 'filter', type: 'string', label: 'Filter (all/today/overdue/high)', default: '', maxLength: 20 },
		{ name: 'project', type: 'string', label: 'Project', default: '', maxLength: 20 }
	],
	steps: (refs) => [
		search(refs.schema('task'), { where: { status: 'open' }, limit: 60, sort: { field: 'createdAt', dir: 'desc' } }),
		search(refs.schema('task'), { where: { status: 'done' }, limit: 30, sort: { field: 'updatedAt', dir: 'desc' } }),
		compute(today()),
		compute(viewRows('$step.1', '$step.3')),
		compute(x('sortBy', x('filter', '$step.4', filterHolds('$input.filter', '$input.project')), '$item.rank')),
		compute(viewRows('$step.2', '$step.3')),
		compute({
			open: len('$step.1'),
			overdue: x('count', '$step.4', eq('$item.dueTone', 'overdue')),
			today: x('count', '$step.4', eq('$item.dueTone', 'today')),
			high: x('count', '$step.4', eq('$item.priority', 'high')),
			doneTotal: len('$step.2'),
			doneToday: x('count', '$step.6', eq('$item.doneOn', '$step.3')),
			donePercent: percent(len('$step.2'), x('add', len('$step.1'), len('$step.2')))
		}),
		returnValue({
			items: x('slice', '$step.5', 0, 30),
			count: len('$step.5'),
			truncated: x('gt', len('$step.5'), 30),
			done: '$step.6',
			stats: '$step.7',
			filter: iff(isEmpty('$input.filter'), iff(isEmpty('$input.project'), 'all', '$input.project'), '$input.filter'),
			today: '$step.3',
			silent: true
		})
	],
	capabilities: (refs) => taskCaps(refs, 'things.read'),
	limits: { timeoutMs: 6000, maxOperations: 16, maxResultBytes: 96 * 1024 }
};

const addAction: SuiteActionDef = {
	key: 'add',
	name: 'Add task',
	description: 'Creates one task data thing from the composer’s fields (and the uploaded file, when there is one).',
	category: 'todo',
	inputs: [
		{ name: 'title', type: 'string', label: 'Title', required: true, maxLength: 140 },
		{ name: 'notes', type: 'text', label: 'Notes', default: '', maxLength: 2000 },
		{ name: 'priority', type: 'enum', label: 'Priority', values: ['low', 'medium', 'high'], default: 'medium' },
		{ name: 'due', type: 'string', label: 'Due (YYYY-MM-DD)', default: '', maxLength: 10 },
		{ name: 'project', type: 'enum', label: 'Project', values: ['inbox', 'work', 'home', 'someday'], default: 'inbox' },
		{ name: 'file', type: 'string', label: 'Attachment URL', default: '', maxLength: 500 },
		{ name: 'fileAttachmentId', type: 'string', label: 'Attachment id', default: '', maxLength: 80 }
	],
	steps: (refs) => [
		{ op: 'things.create', schema: refs.schema('task'), values: { title: '$input.title', notes: '$input.notes', status: 'open', priority: '$input.priority', due: dueValue('$input.due'), project: '$input.project', file: '$input.file', fileAttachmentId: '$input.fileAttachmentId', createdOn: today(), doneAt: null } },
		returnValue({ id: '$step.1.id', message: concat('Added “', '$input.title', '”') })
	],
	capabilities: (refs) => taskCaps(refs, 'things.create'),
	limits: { timeoutMs: 4000, maxOperations: 4 }
};

const toggleAction: SuiteActionDef = {
	key: 'toggle',
	name: 'Toggle done',
	description: 'Reads the task, flips its status, stamps doneAt.',
	category: 'todo',
	inputs: [{ name: 'id', type: 'string', label: 'Task id', required: true, maxLength: 80 }],
	steps: (refs) => [
		{ op: 'things.get', id: '$input.id' },
		compute(iff(eq('$step.1.crystal.status', 'done'), 'open', 'done')),
		{ op: 'things.update', id: '$input.id', values: { status: '$step.2', doneAt: iff(eq('$step.2', 'done'), '$now', null) } },
		returnValue({ id: '$input.id', status: '$step.2', message: iff(eq('$step.2', 'done'), concat('✓ Done — “', '$step.1.crystal.title', '”'), concat('Back on the list: “', '$step.1.crystal.title', '”')) })
	],
	capabilities: (refs) => taskCaps(refs, 'things.read', 'things.update'),
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const editAction: SuiteActionDef = {
	key: 'edit',
	name: 'Edit task',
	description: 'Updates the fields of one task — explicit empty text clears a value.',
	category: 'todo',
	inputs: [
		{ name: 'id', type: 'string', label: 'Task id', required: true, maxLength: 80 },
		{ name: 'title', type: 'string', label: 'Title', required: true, maxLength: 140 },
		{ name: 'notes', type: 'text', label: 'Notes', default: '', maxLength: 2000 },
		{ name: 'priority', type: 'enum', label: 'Priority', values: ['low', 'medium', 'high'], default: 'medium' },
		{ name: 'due', type: 'string', label: 'Due (YYYY-MM-DD)', default: '', maxLength: 10 },
		{ name: 'project', type: 'enum', label: 'Project', values: ['inbox', 'work', 'home', 'someday'], default: 'inbox' },
		{ name: 'file', type: 'string', label: 'Attachment URL', default: '', maxLength: 500 },
		{ name: 'fileAttachmentId', type: 'string', label: 'Attachment id', default: '', maxLength: 80 }
	],
	steps: () => [
		{ op: 'things.update', id: '$input.id', values: { title: '$input.title', notes: '$input.notes', priority: '$input.priority', due: dueValue('$input.due'), project: '$input.project', file: '$input.file', fileAttachmentId: '$input.fileAttachmentId' } },
		returnValue({ id: '$input.id', message: 'Saved ✓' })
	],
	capabilities: (refs) => taskCaps(refs, 'things.update'),
	limits: { timeoutMs: 4000, maxOperations: 4 }
};

const snoozeAction: SuiteActionDef = {
	key: 'snooze',
	name: 'Snooze a day',
	description: 'Pushes the due date one day out (from today when it had none) — dateAdd over the stored date.',
	category: 'todo',
	inputs: [{ name: 'id', type: 'string', label: 'Task id', required: true, maxLength: 80 }],
	steps: () => [
		{ op: 'things.get', id: '$input.id' },
		compute(x('isoDate', x('dateAdd', x('coalesce', '$step.1.crystal.due', today()), 1, 'day'))),
		{ op: 'things.update', id: '$input.id', values: { due: '$step.2' } },
		returnValue({ id: '$input.id', due: '$step.2', message: concat('Snoozed to ', '$step.2') })
	],
	capabilities: (refs) => taskCaps(refs, 'things.read', 'things.update'),
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

const removeAction: SuiteActionDef = {
	key: 'remove',
	name: 'Delete task',
	description: 'Deletes one of your task data things.',
	category: 'todo',
	inputs: [{ name: 'id', type: 'string', label: 'Task id', required: true, maxLength: 80 }],
	steps: () => [{ op: 'things.delete', id: '$input.id' }, returnValue({ id: '$input.id', message: 'Deleted.' })],
	capabilities: (refs) => taskCaps(refs, 'things.delete'),
	limits: { timeoutMs: 4000, maxOperations: 4 }
};

const clearDoneAction: SuiteActionDef = {
	key: 'clear-done',
	name: 'Clear done',
	description: 'Lists your finished tasks and runs the delete action once per row — `each` over a child action.',
	category: 'todo',
	inputs: [],
	steps: (refs) => [
		search(refs.schema('task'), { where: { status: 'done' }, limit: 20 }),
		{ op: 'each', action: refs.action('remove'), list: '$step.1', inputs: { id: '$item.id' }, max: 20 },
		returnValue({ cleared: len('$step.1'), message: concat('Cleared ', len('$step.1'), ' finished task(s)') })
	],
	capabilities: (refs) => [...taskCaps(refs, 'things.read'), { capability: 'actions.invoke', actions: [refs.action('remove')] }],
	limits: { timeoutMs: 8000, maxOperations: 60, maxChildActions: 24 }
};

const taskAction: SuiteActionDef = {
	key: 'task',
	name: 'One task',
	description: 'Reads the task named by the id (the editor binds ?edit=… here).',
	category: 'todo',
	inputs: [{ name: 'id', type: 'string', label: 'Task id', default: '', maxLength: 80 }],
	steps: () => [
		{ op: 'things.get', when: notEmpty('$input.id'), id: '$input.id' },
		returnValue({ hasTask: notEmpty('$step.1'), task: iff(isEmpty('$step.1'), null, x('merge', get('$step.1', 'crystal', {}), { id: '$input.id' })), silent: true })
	],
	capabilities: (refs) => taskCaps(refs, 'things.read'),
	limits: { timeoutMs: 4000, maxOperations: 4 }
};

const findAction: SuiteActionDef = {
	key: 'find',
	name: 'Find tasks',
	description: 'Case-insensitive substring search over open task titles (things.search `match`).',
	category: 'todo',
	inputs: [{ name: 'q', type: 'string', label: 'Search', default: '', maxLength: 80 }],
	steps: (refs) => [
		search(refs.schema('task'), { where: { status: 'open' }, match: { title: '$input.q' }, limit: 12, sort: { field: 'createdAt', dir: 'desc' } }),
		compute(today()),
		returnValue({ items: viewRows('$step.1', '$step.2'), count: len('$step.1'), q: '$input.q', message: concat(len('$step.1'), ' open task(s) match') })
	],
	capabilities: (refs) => taskCaps(refs, 'things.read'),
	limits: { timeoutMs: 4000, maxOperations: 6 }
};

// ── the suite ───────────────────────────────────────────────────────────────
export const dustedSuite: BehaviourSuite = {
	key: 'dusted',
	title: 'Done & Dusted',
	emoji: '✅',
	description: 'A todo app — add, tick, snooze, edit, attach, search, clear — where every control is a declarative action over your own data things.',
	story: [
		'The everyday builder features, one control each: a composer fieldset (text, select, date, textarea and a real file upload) feeding one create action; a board bound to a search + expressions source that refetches after every run; filter chips that are plain links carrying ?filter into the source input; an editor prefilled from the record named in the URL; snooze via dateAdd; delete; and Clear done, which runs a child action once per row with `each`.',
		'Nothing here needs code. Every part is a thing you can open — /schemas for the shape, /components for the controls, /actions for the programs and their run records — and “Install app” copies the whole bundle into your things so the pages run as you.'
	],
	tone: 'sunset',
	app: { tagline: 'The todo app, as things ✅', entry: 'tasks' },
	schemas: [
		{
			key: 'task',
			description: 'One task: title, notes, status, priority, due date, project and an optional private attachment.',
			fields: [
				{ name: 'title', type: 'string', required: true, maxLength: 140 },
				{ name: 'notes', type: 'string', maxLength: 2000 },
				{ name: 'status', type: 'enum', values: ['open', 'done'], required: true },
				{ name: 'priority', type: 'enum', values: ['low', 'medium', 'high'] },
				{ name: 'due', type: 'date', description: 'Calendar date, YYYY-MM-DD' },
				{ name: 'project', type: 'enum', values: ['inbox', 'work', 'home', 'someday'] },
				{ name: 'file', type: 'string', maxLength: 500, description: 'Content URL of the uploaded attachment' },
				{ name: 'fileAttachmentId', type: 'string', maxLength: 80 },
				{ name: 'createdOn', type: 'date' },
				{ name: 'doneAt', type: 'date' }
			]
		}
	],
	components: [nav, composer, board, stats, finder, editor, doneList],
	actions: [overviewAction, addAction, toggleAction, editAction, snoozeAction, removeAction, clearDoneAction, taskAction, findAction],
	data: [
		{ schema: 'task', values: { title: 'Water the monstera', notes: 'It droops on Thursdays.', status: 'open', priority: 'low', due: '2026-09-10', project: 'home', file: '', fileAttachmentId: '', createdOn: '2026-09-08', doneAt: null } },
		{ schema: 'task', values: { title: 'Ship the builder demo apps', notes: 'Todo, creature collector, garden, story, trivia, scavenger hunt, pinboard, feature tour.', status: 'open', priority: 'high', due: '2026-09-22', project: 'work', file: '', fileAttachmentId: '', createdOn: '2026-09-21', doneAt: null } },
		{ schema: 'task', values: { title: 'Book the dentist', notes: '', status: 'open', priority: 'medium', due: null, project: 'inbox', file: '', fileAttachmentId: '', createdOn: '2026-09-20', doneAt: null } },
		{ schema: 'task', values: { title: 'Learn what a Thing is', notes: 'Everything is a thing.', status: 'done', priority: 'medium', due: '2026-09-01', project: 'someday', file: '', fileAttachmentId: '', createdOn: '2026-08-30', doneAt: '2026-09-01T09:30:00.000Z' } }
	],
	pages: [
		{
			key: 'tasks',
			name: 'Tasks',
			description: 'Stats, composer, the board and the finder.',
			blocks: (ctx, refs) =>
				appShell(ctx, refs, 'nav', 'tasks', [
					boundBlock(ctx, refs, 'stats', 'stats', 'overview'),
					componentBlock(ctx, refs, 'composer', 'composer'),
					boundBlock(ctx, refs, 'board', 'board', 'overview', { filter: '{query.filter}', project: '{query.project}' }),
					componentBlock(ctx, refs, 'finder', 'finder')
				])
		},
		{ key: 'done', name: 'Done', description: 'Finished tasks, undo, clear.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'done', [boundBlock(ctx, refs, 'done', 'done', 'overview')]) },
		{ key: 'task', name: 'Editor', description: 'Edit the task named by ?edit=.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'task', [boundBlock(ctx, refs, 'editor', 'editor', 'task', { id: '{query.edit}' })]) }
	]
};
