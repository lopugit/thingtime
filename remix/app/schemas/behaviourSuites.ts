// BEHAVIOUR SUITES — the demo library's "programs": each suite bundles the
// four thing kinds that make Thingtime behave (Data Thing + Component Thing +
// Action Thing = program, PRs/action-thing-v1-design.md) around one story:
//
//   schemas     the data shapes (schema things)
//   components  controls whose markup binds ttAction → an action key
//   actions     declarative programs over the closed vocabulary
//   data        sample data things so search steps have something to find
//   page        a builder webpage composing the controls with copy
//
// One definition materialises TWO ways, because of who may run what:
// - 'system' — the admin seed writes public system copies (shareIds
//   schema-demo-*, component-demo-*, action-demo-*, data-demo-*,
//   webpage-demo-suite-*) so every part is browsable on /schemas,
//   /components, /actions and /p/. A signed-in viewer can run the seeded
//   action deliberately from /actions (it mints THEIR data things against the
//   public schema by shareId).
// - 'own' — "Install suite" clones the whole bundle into the viewer's own
//   things through the ordinary /things write path: schemas referenced by
//   NAME, actions by actionKey, so a ttAction click on their page (which the
//   executor resolves owner-only) runs their own program end to end — with
//   zero dependence on the seed.
//
// Every materialised crystal clears its kind's write gate unchanged; the unit
// test asserts that for both modes across the whole catalog.

import { demoBlockKit, type DemoBlock, type DemoBlockCtx } from './webpageDemos.ts';

export const SUITE_SLUG_PREFIX = 'demo-';

type SchemaField = {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'string[]' | 'object' | 'array';
	description?: string;
	required?: boolean;
	values?: string[];
	min?: number;
	max?: number;
	maxLength?: number;
	maxItems?: number;
	unit?: string;
	// object: nested fields; array: the entry spec
	children?: SchemaField[];
	items?: Omit<SchemaField, 'name'> & { name?: string };
};

type ArgSpec = {
	name: string;
	type: 'string' | 'text' | 'number' | 'boolean' | 'enum';
	label: string;
	default: string | number | boolean;
	values?: string[];
	maxLength?: number;
};

type InputSpec = {
	name: string;
	type: 'string' | 'text' | 'number' | 'boolean' | 'enum';
	label: string;
	required?: boolean;
	default?: string | number | boolean;
	values?: string[];
	maxLength?: number;
	min?: number;
	max?: number;
};

// How a suite-local key becomes a reference in the materialised crystals.
export type SuiteRefs = {
	// what an action step / capability names a schema by (shareId or own name)
	schema: (key: string) => string;
	// what an actions.invoke step names a child by (shareId or actionKey)
	action: (key: string) => string;
	// what a page component block references (resolves seeded-or-own by key)
	component: (key: string) => string;
	// what a ttAction control names — ALWAYS the actionKey (owner-scoped)
	actionKey: (key: string) => string;
	// the schema thing's crystal.name (data things carry it as `schema`)
	schemaName: (key: string) => string;
};

export type SuiteSchemaDef = { key: string; description: string; fields: SchemaField[] };
export type SuiteComponentDef = {
	key: string;
	name: string;
	description: string;
	args: ArgSpec[];
	render: (refs: SuiteRefs) => Record<string, unknown>;
};
export type SuiteActionDef = {
	key: string;
	name: string;
	description: string;
	category: string;
	inputs: InputSpec[];
	steps: (refs: SuiteRefs) => Array<Record<string, unknown>>;
	capabilities: (refs: SuiteRefs) => Array<Record<string, unknown>>;
	limits?: Record<string, number>;
};
export type SuiteDataDef = { schema: string; values: Record<string, unknown> };

// A page of a multi-page suite (an APP). The entry page's pageKey is the
// suite key itself (so it opens at /p/<suiteKey>); every other page is
// <suiteKey>-<pageKey>. Pages resolve BY KEY: the viewer's installed twin
// outranks the seeded copy at the same URL (api/utils/webpages resolveWebpage).
export type SuitePageDef = {
	key: string;
	name: string;
	description?: string;
	blocks: (ctx: DemoBlockCtx, refs: SuiteRefs, suite: BehaviourSuite) => DemoBlock[];
};

export type SuiteAppDef = {
	tagline: string;
	// which SuitePageDef key is the entry page (defaults to the first page)
	entry?: string;
	// where the original app lives, for the gallery card
	origin?: string;
};

export type BehaviourSuite = {
	key: string;
	title: string;
	emoji: string;
	description: string;
	// the walkthrough shown on the page and in the gallery card
	story: string[];
	tone: string;
	schemas: SuiteSchemaDef[];
	components: SuiteComponentDef[];
	actions: SuiteActionDef[];
	data: SuiteDataDef[];
	// single-page suites (the demo library's originals)
	page?: (ctx: DemoBlockCtx, refs: SuiteRefs, suite: BehaviourSuite) => DemoBlock[];
	// multi-page APP suites — installed as a whole, pages link by key
	pages?: SuitePageDef[];
	app?: SuiteAppDef;
};

// ---------------------------------------------------------------------------
// Shared render fragments for suite components. Element-shaped templates
// drawn through the sanitising HtmlThingRenderer; `{arg}` tokens interpolate
// and ttAction/ttActionInputs fold into the two allowlisted data-* attrs.
const INK = '#16161a';
const TEXT = '#5a5a66';
const MUTED = '#9a9aa6';
const BORDER = '#ececef';

const controlCard = (title: string, children: unknown[]): Record<string, unknown> => ({
	tag: 'div',
	props: { style: { border: `1px solid ${BORDER}`, borderRadius: '16px', padding: '18px 20px', background: '#ffffff', display: 'grid', gap: '10px' } },
	children: [{ tag: 'div', props: { style: { fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, fontWeight: 700 } }, children: [title] }, ...children]
});

const line = (text: string, options: { strong?: boolean; muted?: boolean } = {}): Record<string, unknown> => ({
	tag: 'div',
	props: { style: { fontSize: options.strong ? '17px' : '14px', fontWeight: options.strong ? 700 : 400, color: options.muted ? MUTED : options.strong ? INK : TEXT, lineHeight: 1.5 } },
	children: [text]
});

const runButton = (label: string, actionKey: string, inputs: Record<string, string>, tone: 'solid' | 'ghost' = 'solid'): Record<string, unknown> => ({
	tag: 'button',
	props: {
		type: 'button',
		style:
			tone === 'solid'
				? { padding: '10px 18px', borderRadius: '999px', background: INK, color: '#ffffff', fontWeight: 700, fontSize: '14px', border: 'none', cursor: 'pointer' }
				: { padding: '10px 18px', borderRadius: '999px', background: '#ffffff', color: INK, fontWeight: 600, fontSize: '14px', border: `1px solid ${BORDER}`, cursor: 'pointer' }
	},
	ttAction: actionKey,
	ttActionInputs: inputs,
	children: [label]
});

const buttonRow = (children: unknown[]): Record<string, unknown> => ({
	tag: 'div',
	props: { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
	children
});

const stringArg = (name: string, label: string, value: string, maxLength = 120): ArgSpec => ({ name, type: 'string', label, default: value, maxLength });
const textArg = (name: string, label: string, value: string): ArgSpec => ({ name, type: 'text', label, default: value, maxLength: 600 });
const enumArg = (name: string, label: string, values: string[], value: string): ArgSpec => ({ name, type: 'enum', label, values, default: value });

const stringInput = (name: string, label: string, required = true, maxLength = 200): InputSpec => ({ name, type: 'string', label, required, maxLength });
const textInput = (name: string, label: string, required = false): InputSpec => ({ name, type: 'text', label, required, maxLength: 2000 });
const enumInput = (name: string, label: string, values: string[], fallback?: string): InputSpec => ({ name, type: 'enum', label, values, ...(fallback ? { default: fallback } : { required: true }) });
const numberInput = (name: string, label: string, min: number, max: number, fallback?: number): InputSpec => ({ name, type: 'number', label, min, max, ...(fallback !== undefined ? { default: fallback } : { required: true }) });

// a "list my things of this schema" action — every suite has one so the
// search op and the run inspector's result panel get exercised
const listAction = (key: string, name: string, description: string, category: string, schemaKey: string, limit = 12): SuiteActionDef => ({
	key,
	name,
	description,
	category,
	inputs: [],
	steps: (refs) => [
		{ op: 'things.search', schema: refs.schema(schemaKey), limit },
		{ op: 'return', value: '$step.1' }
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema(schemaKey)] }],
	limits: { timeoutMs: 4000, maxOperations: 4 }
});

// ---------------------------------------------------------------------------
// The page every suite renders: story + controls + a program index. Suites
// pass their own controls (component refs + arg overrides) into the middle.
const suitePage = (
	ctx: DemoBlockCtx,
	refs: SuiteRefs,
	suite: BehaviourSuite,
	controls: Array<{ component: string; args?: Record<string, string | number | boolean> }>
): DemoBlock[] => {
	const kit = demoBlockKit;
	const programIndex = suite.actions
		.map(
			(action) =>
				`<li style="margin:4px 0"><a href="/actions/${refs.action(action.key)}" style="color:${INK};font-weight:600;text-decoration:none">⚡ ${action.name}</a> <span style="color:${MUTED}">— ${action.description}</span></li>`
		)
		.join('');
	const shapes = suite.schemas
		.map((schema) => `<li style="margin:4px 0"><code style="background:#f1f1f4;border-radius:6px;padding:2px 6px;color:${INK}">${refs.schemaName(schema.key)}</code> <span style="color:${MUTED}">— ${schema.description}</span></li>`)
		.join('');
	return [
		kit.container(ctx, 'wrap', 'column', [
			kit.eyebrow(ctx, 'eyebrow', `Behaviour suite · ${suite.emoji} ${suite.title}`),
			kit.heading(ctx, 'title', suite.description, 40),
			...suite.story.map((paragraph, index) => kit.body(ctx, `story-${index}`, paragraph, 16)),
			// the controls below run the VIEWER'S OWN programs (delegated ttAction
			// resolution is owner-only), so a seeded copy is look-but-don't-touch
			// until the viewer installs the suite — say so where the buttons are
			kit.body(
				ctx,
				'install-hint',
				`🧪 These controls run your own copy of the programs. Install the ${suite.title} suite from /builder/demos (Suites tab) and they come alive on your page.`,
				14,
				{ color: ctx.tone.ink, background: ctx.tone.soft, border: `1px solid ${ctx.tone.border}`, 'border-radius': '12px', padding: '10px 14px' }
			),
			// a wrapping row, not a grid: each control takes at least 300px and
			// the row folds to one column on a phone
			kit.container(
				ctx,
				'controls',
				'row',
				controls.map((control, index) => ({
					id: ctx.id(`control-${index}`),
					type: 'component' as const,
					component: refs.component(control.component),
					...(control.args ? { args: control.args } : {}),
					css: { flex: '1 1 300px', 'min-width': '0' }
				})),
				{ gap: 4, css: { 'margin-top': '8px', 'flex-wrap': 'wrap' } }
			),
			kit.html(
				ctx,
				'index',
				`<div style="display:grid;gap:16px;border-top:1px solid ${BORDER};padding-top:20px"><div><div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};font-weight:700;margin-bottom:6px">Programs in this suite</div><ul style="list-style:none;padding:0;margin:0;font-size:14px">${programIndex}</ul></div><div><div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};font-weight:700;margin-bottom:6px">Data shapes</div><ul style="list-style:none;padding:0;margin:0;font-size:14px">${shapes}</ul></div><p style="font-size:13px;color:${MUTED};margin:0">Controls run <em>your own</em> copy of each program (install the suite from /builder/demos). Every run lands as an inspectable action-run record.</p></div>`
			)
		], { gap: 4, maxWidth: 860, css: { padding: '40px 0' } })
	];
};

// ---------------------------------------------------------------------------
export const BEHAVIOUR_SUITES: BehaviourSuite[] = [
	{
		key: 'guestbook',
		title: 'Guestbook',
		emoji: '📖',
		description: 'Sign a guestbook, then read the signatures back.',
		story: [
			'The simplest program: one schema, one create action, one search action. Signing mints a private guestbook-entry data thing stamped with $now; the reader lists the newest twelve.',
			'Change the name, message, or mood in the builder inspector — the control passes its args as the action inputs.'
		],
		tone: 'paper',
		schemas: [
			{
				key: 'entry',
				description: 'One guestbook signature.',
				fields: [
					{ name: 'name', type: 'string', required: true, maxLength: 80 },
					{ name: 'message', type: 'string', maxLength: 600 },
					{ name: 'mood', type: 'enum', values: ['happy', 'curious', 'grateful', 'sleepy'] },
					{ name: 'signedAt', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'signer',
				name: 'Guestbook signer',
				description: 'A card that signs the guestbook with the args as inputs.',
				args: [stringArg('name', 'Name', 'Ada'), textArg('message', 'Message', 'Lovely to be here ✨'), enumArg('mood', 'Mood', ['happy', 'curious', 'grateful', 'sleepy'], 'happy')],
				render: (refs) =>
					controlCard('Sign the guestbook', [
						line('{name}', { strong: true }),
						line('“{message}” — feeling {mood}'),
						buttonRow([runButton('Sign ✍️', refs.actionKey('sign'), { name: '{name}', message: '{message}', mood: '{mood}' })])
					])
			},
			{
				key: 'reader',
				name: 'Guestbook reader',
				description: 'Runs the list action; the result shows in the Lopu toast and the run record.',
				args: [stringArg('label', 'Button label', 'Read the latest signatures')],
				render: (refs) => controlCard('Read signatures', [line('Lists your newest twelve entries.', { muted: true }), buttonRow([runButton('{label}', refs.actionKey('recent'), {}, 'ghost')])])
			}
		],
		actions: [
			{
				key: 'sign',
				name: 'Sign guestbook',
				description: 'Creates one guestbook-entry data thing from the inputs.',
				category: 'guestbook',
				inputs: [stringInput('name', 'Name', true, 80), textInput('message', 'Message'), enumInput('mood', 'Mood', ['happy', 'curious', 'grateful', 'sleepy'], 'happy')],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('entry'), values: { name: '$input.name', message: '$input.message', mood: '$input.mood', signedAt: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('entry')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			listAction('recent', 'Recent signatures', 'Lists your newest twelve guestbook entries.', 'guestbook', 'entry')
		],
		data: [
			{ schema: 'entry', values: { name: 'Kai', message: 'First!', mood: 'happy', signedAt: '2026-09-01T09:00:00.000Z' } },
			{ schema: 'entry', values: { name: 'Noor', message: 'The block model is lovely.', mood: 'grateful', signedAt: '2026-09-01T10:30:00.000Z' } },
			{ schema: 'entry', values: { name: 'Sam', message: 'Back again tomorrow.', mood: 'sleepy', signedAt: '2026-09-01T23:10:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'signer' }, { component: 'reader' }])
	},
	{
		key: 'rsvp',
		title: 'RSVP',
		emoji: '💌',
		description: 'Collect RSVPs for an event and count the room.',
		story: [
			'One action takes an enum input, so the same program serves three buttons: yes, no, maybe. A second action lists the responses.',
			'Enum inputs are validated by the executor against the declared values — a control cannot smuggle a fourth answer.'
		],
		tone: 'mint',
		schemas: [
			{
				key: 'response',
				description: 'One guest’s answer.',
				fields: [
					{ name: 'guest', type: 'string', required: true, maxLength: 80 },
					{ name: 'attending', type: 'enum', values: ['yes', 'no', 'maybe'], required: true },
					{ name: 'plusOnes', type: 'number', min: 0, max: 6 },
					{ name: 'note', type: 'string', maxLength: 300 },
					{ name: 'repliedAt', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'buttons',
				name: 'RSVP buttons',
				description: 'Three answers, one action — the enum input differs.',
				args: [stringArg('guest', 'Guest name', 'Ada'), stringArg('plusOnes', 'Plus ones', '1', 2)],
				render: (refs) =>
					controlCard('Will you come?', [
						line('{guest} (+{plusOnes})', { strong: true }),
						buttonRow([
							runButton('Yes 🎉', refs.actionKey('reply'), { guest: '{guest}', attending: 'yes', plusOnes: '{plusOnes}' }),
							runButton('Maybe 🤔', refs.actionKey('reply'), { guest: '{guest}', attending: 'maybe', plusOnes: '{plusOnes}' }, 'ghost'),
							runButton('No 😢', refs.actionKey('reply'), { guest: '{guest}', attending: 'no', plusOnes: '0' }, 'ghost')
						])
					])
			},
			{
				key: 'count',
				name: 'Headcount',
				description: 'Lists the replies so far.',
				args: [],
				render: (refs) => controlCard('Headcount', [line('Newest replies first.', { muted: true }), buttonRow([runButton('List replies', refs.actionKey('replies'), {}, 'ghost')])])
			}
		],
		actions: [
			{
				key: 'reply',
				name: 'Reply to invitation',
				description: 'Records one RSVP with the guest’s answer and plus-ones.',
				category: 'events',
				inputs: [stringInput('guest', 'Guest', true, 80), enumInput('attending', 'Attending', ['yes', 'no', 'maybe']), numberInput('plusOnes', 'Plus ones', 0, 6, 0)],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('response'), values: { guest: '$input.guest', attending: '$input.attending', plusOnes: '$input.plusOnes', repliedAt: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('response')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			listAction('replies', 'List replies', 'Lists your newest RSVP responses.', 'events', 'response')
		],
		data: [
			{ schema: 'response', values: { guest: 'June', attending: 'yes', plusOnes: 1, repliedAt: '2026-08-30T08:00:00.000Z' } },
			{ schema: 'response', values: { guest: 'Rafa', attending: 'maybe', plusOnes: 0, note: 'Depends on the flight.', repliedAt: '2026-08-30T12:00:00.000Z' } },
			{ schema: 'response', values: { guest: 'Ines', attending: 'no', plusOnes: 0, repliedAt: '2026-08-31T18:00:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'buttons' }, { component: 'count' }])
	},
	{
		key: 'poll',
		title: 'Poll',
		emoji: '🗳',
		description: 'Cast votes on a question and tally them.',
		story: [
			'Votes are relational: every vote is its own data thing (FUNDAMENTALS §3 — appended data is never an embedded counter), so the tally is a search, not a mutation.',
			'The question is an arg on the control, so one component becomes any poll.'
		],
		tone: 'ocean',
		schemas: [
			{
				key: 'vote',
				description: 'One vote on one question.',
				fields: [
					{ name: 'question', type: 'string', required: true, maxLength: 200 },
					{ name: 'choice', type: 'enum', values: ['a', 'b', 'c'], required: true },
					{ name: 'castAt', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'ballot',
				name: 'Ballot',
				description: 'Three choices for one question.',
				args: [stringArg('question', 'Question', 'Tabs or spaces?', 200), stringArg('a', 'Choice A', 'Tabs', 40), stringArg('b', 'Choice B', 'Spaces', 40), stringArg('c', 'Choice C', 'Whatever the formatter says', 60)],
				render: (refs) =>
					controlCard('{question}', [
						buttonRow([
							runButton('{a}', refs.actionKey('cast'), { question: '{question}', choice: 'a' }, 'ghost'),
							runButton('{b}', refs.actionKey('cast'), { question: '{question}', choice: 'b' }, 'ghost'),
							runButton('{c}', refs.actionKey('cast'), { question: '{question}', choice: 'c' }, 'ghost')
						]),
						buttonRow([runButton('Tally 📊', refs.actionKey('tally'), {})])
					])
			}
		],
		actions: [
			{
				key: 'cast',
				name: 'Cast vote',
				description: 'Creates one vote data thing.',
				category: 'polls',
				inputs: [stringInput('question', 'Question', true, 200), enumInput('choice', 'Choice', ['a', 'b', 'c'])],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('vote'), values: { question: '$input.question', choice: '$input.choice', castAt: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('vote')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			listAction('tally', 'Tally votes', 'Lists your newest fifty votes — count the choices.', 'polls', 'vote', 50)
		],
		data: [
			{ schema: 'vote', values: { question: 'Tabs or spaces?', choice: 'a', castAt: '2026-09-01T08:00:00.000Z' } },
			{ schema: 'vote', values: { question: 'Tabs or spaces?', choice: 'b', castAt: '2026-09-01T08:05:00.000Z' } },
			{ schema: 'vote', values: { question: 'Tabs or spaces?', choice: 'a', castAt: '2026-09-01T08:09:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'ballot' }])
	},
	{
		key: 'tasks',
		title: 'Tasks',
		emoji: '✅',
		description: 'Add tasks, complete them, list what is open.',
		story: [
			'Three programs over one schema: create, update by id, search. Completing a task reads it first (things.get), then updates its status — both ops must be covered by declared capabilities.',
			'Paste a task id from the run record into the completer’s arg to close it.'
		],
		tone: 'mono',
		schemas: [
			{
				key: 'task',
				description: 'One task with a status.',
				fields: [
					{ name: 'title', type: 'string', required: true, maxLength: 160 },
					{ name: 'priority', type: 'enum', values: ['low', 'normal', 'high'] },
					{ name: 'status', type: 'enum', values: ['open', 'done'] },
					{ name: 'createdAt', type: 'date' },
					{ name: 'completedAt', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'adder',
				name: 'Task adder',
				description: 'Creates a task from the title and priority args.',
				args: [stringArg('title', 'Title', 'Write the launch post', 160), enumArg('priority', 'Priority', ['low', 'normal', 'high'], 'normal')],
				render: (refs) => controlCard('Add a task', [line('{title}', { strong: true }), line('priority {priority}', { muted: true }), buttonRow([runButton('Add ➕', refs.actionKey('add'), { title: '{title}', priority: '{priority}' })])])
			},
			{
				key: 'completer',
				name: 'Task completer',
				description: 'Marks the task with the given id as done.',
				args: [stringArg('taskId', 'Task id', 'paste-a-task-id', 128)],
				render: (refs) => controlCard('Complete a task', [line('{taskId}', { muted: true }), buttonRow([runButton('Mark done ✓', refs.actionKey('complete'), { id: '{taskId}' }), runButton('Open tasks', refs.actionKey('open'), {}, 'ghost')])])
			}
		],
		actions: [
			{
				key: 'add',
				name: 'Add task',
				description: 'Creates an open task.',
				category: 'tasks',
				inputs: [stringInput('title', 'Title', true, 160), enumInput('priority', 'Priority', ['low', 'normal', 'high'], 'normal')],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('task'), values: { title: '$input.title', priority: '$input.priority', status: 'open', createdAt: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('task')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			{
				key: 'complete',
				name: 'Complete task',
				description: 'Reads a task by id, then marks it done with a completedAt stamp.',
				category: 'tasks',
				inputs: [stringInput('id', 'Task id', true, 128)],
				steps: (refs) => [
					{ op: 'things.get', id: '$input.id' },
					{ op: 'things.update', id: '$step.1.id', values: { status: 'done', completedAt: '$now' } },
					{ op: 'return', value: '$step.2' }
				],
				capabilities: (refs) => [
					{ capability: 'things.read', schemas: [refs.schema('task')] },
					{ capability: 'things.update', schemas: [refs.schema('task')] }
				],
				limits: { timeoutMs: 4000, maxOperations: 6 }
			},
			listAction('open', 'Open tasks', 'Lists your newest tasks (filter status client-side).', 'tasks', 'task', 20)
		],
		data: [
			{ schema: 'task', values: { title: 'Write the launch post', priority: 'high', status: 'open', createdAt: '2026-09-01T07:00:00.000Z' } },
			{ schema: 'task', values: { title: 'Seed the demo library', priority: 'normal', status: 'done', createdAt: '2026-08-31T07:00:00.000Z', completedAt: '2026-09-01T06:00:00.000Z' } },
			{ schema: 'task', values: { title: 'Water the plants', priority: 'low', status: 'open', createdAt: '2026-09-01T09:00:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'adder' }, { component: 'completer' }])
	},
	{
		key: 'leads',
		title: 'Leads',
		emoji: '🧲',
		description: 'Capture a lead, then qualify it in one composed run.',
		story: [
			'actions.invoke composes programs: capture-and-qualify invokes capture-lead as a child (consuming the parent’s budget), then updates the created lead’s stage using $step.1.id.',
			'The child runs on its own declaration; the parent declares the invoke allowlist so the composition is visible in the inspector.'
		],
		tone: 'sunset',
		schemas: [
			{
				key: 'lead',
				description: 'A sales lead moving through stages.',
				fields: [
					{ name: 'name', type: 'string', required: true, maxLength: 120 },
					{ name: 'email', type: 'string', maxLength: 200 },
					{ name: 'company', type: 'string', maxLength: 120 },
					{ name: 'stage', type: 'enum', values: ['new', 'qualified', 'won', 'lost'] },
					{ name: 'note', type: 'string', maxLength: 300 },
					{ name: 'capturedAt', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'form',
				name: 'Lead capture',
				description: 'Capture only, or capture and qualify in one run.',
				args: [stringArg('name', 'Name', 'Priya Lumen'), stringArg('email', 'Email', 'priya@lumen.example', 200), stringArg('company', 'Company', 'Lumen')],
				render: (refs) =>
					controlCard('New lead', [
						line('{name} · {company}', { strong: true }),
						line('{email}', { muted: true }),
						buttonRow([
							runButton('Capture', refs.actionKey('capture'), { name: '{name}', email: '{email}', company: '{company}' }, 'ghost'),
							runButton('Capture + qualify ⚡', refs.actionKey('capture-qualify'), { name: '{name}', email: '{email}', company: '{company}' }),
							runButton('Pipeline', refs.actionKey('pipeline'), {}, 'ghost')
						])
					])
			}
		],
		actions: [
			{
				key: 'capture',
				name: 'Capture lead',
				description: 'Creates a lead in the new stage with a composed note.',
				category: 'sales',
				inputs: [stringInput('name', 'Name', true, 120), stringInput('email', 'Email', false, 200), stringInput('company', 'Company', false, 120)],
				steps: (refs) => [
					{
						op: 'things.create',
						schema: refs.schema('lead'),
						values: { name: '$input.name', email: '$input.email', company: '$input.company', stage: 'new', note: { ttConcat: ['Captured from the demo page for ', '$input.company'] }, capturedAt: '$now' }
					},
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('lead')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			{
				key: 'capture-qualify',
				name: 'Capture and qualify',
				description: 'Invokes capture-lead, then moves the new lead to qualified.',
				category: 'sales',
				inputs: [stringInput('name', 'Name', true, 120), stringInput('email', 'Email', false, 200), stringInput('company', 'Company', false, 120)],
				steps: (refs) => [
					{ op: 'actions.invoke', action: refs.action('capture'), inputs: { name: '$input.name', email: '$input.email', company: '$input.company' } },
					{ op: 'things.update', id: '$step.1.id', values: { stage: 'qualified' } },
					{ op: 'return', value: '$step.2' }
				],
				capabilities: (refs) => [
					{ capability: 'actions.invoke', actions: [refs.action('capture')] },
					{ capability: 'things.read', schemas: [refs.schema('lead')] },
					{ capability: 'things.update', schemas: [refs.schema('lead')] }
				],
				limits: { timeoutMs: 6000, maxOperations: 8, maxChildActions: 2 }
			},
			listAction('pipeline', 'Pipeline', 'Lists your newest leads with their stages.', 'sales', 'lead', 20)
		],
		data: [
			{ schema: 'lead', values: { name: 'Tom Harbor', email: 'tom@harbor.example', company: 'Harbor', stage: 'qualified', capturedAt: '2026-08-28T10:00:00.000Z' } },
			{ schema: 'lead', values: { name: 'Mei Sable', email: 'mei@sable.example', company: 'Sable', stage: 'new', capturedAt: '2026-08-30T10:00:00.000Z' } },
			{ schema: 'lead', values: { name: 'Ben Quill', email: 'ben@quill.example', company: 'Quill', stage: 'won', capturedAt: '2026-08-20T10:00:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'form' }])
	},
	{
		key: 'inventory',
		title: 'Inventory',
		emoji: '📦',
		description: 'Receive stock as adjustments against a product catalog.',
		story: [
			'Two schemas: products and stock adjustments. Adjustments are appended (relational) rather than mutating a stock number, so the ledger is always reconstructible.',
			'The receiver takes a numeric input — the executor coerces the control’s string arg and range-checks it.'
		],
		tone: 'paper',
		schemas: [
			{
				key: 'product',
				description: 'A stocked product.',
				fields: [
					{ name: 'sku', type: 'string', required: true, maxLength: 40 },
					{ name: 'name', type: 'string', required: true, maxLength: 120 },
					{ name: 'price', type: 'number', min: 0, unit: '$' }
				]
			},
			{
				key: 'adjustment',
				description: 'One stock movement for a sku.',
				fields: [
					{ name: 'sku', type: 'string', required: true, maxLength: 40 },
					{ name: 'delta', type: 'number', min: -999, max: 999, required: true },
					{ name: 'reason', type: 'enum', values: ['received', 'sold', 'damaged', 'audit'] },
					{ name: 'at', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'receiver',
				name: 'Stock receiver',
				description: 'Appends a stock adjustment for a sku.',
				args: [stringArg('sku', 'SKU', 'TT-MUG-01', 40), stringArg('delta', 'Quantity', '12', 5), enumArg('reason', 'Reason', ['received', 'sold', 'damaged', 'audit'], 'received')],
				render: (refs) =>
					controlCard('Stock movement', [
						line('{sku} · {delta} · {reason}', { strong: true }),
						buttonRow([runButton('Record 📦', refs.actionKey('adjust'), { sku: '{sku}', delta: '{delta}', reason: '{reason}' }), runButton('Catalog', refs.actionKey('catalog'), {}, 'ghost'), runButton('Ledger', refs.actionKey('ledger'), {}, 'ghost')])
					])
			}
		],
		actions: [
			{
				key: 'adjust',
				name: 'Record stock movement',
				description: 'Creates one stock-adjustment data thing.',
				category: 'inventory',
				inputs: [stringInput('sku', 'SKU', true, 40), numberInput('delta', 'Quantity', -999, 999), enumInput('reason', 'Reason', ['received', 'sold', 'damaged', 'audit'], 'received')],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('adjustment'), values: { sku: '$input.sku', delta: '$input.delta', reason: '$input.reason', at: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('adjustment')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			listAction('catalog', 'Product catalog', 'Lists your products.', 'inventory', 'product', 20),
			listAction('ledger', 'Stock ledger', 'Lists your newest stock adjustments.', 'inventory', 'adjustment', 30)
		],
		data: [
			{ schema: 'product', values: { sku: 'TT-MUG-01', name: 'Thingtime mug', price: 18 } },
			{ schema: 'product', values: { sku: 'TT-TEE-M', name: 'Rainbow tee (M)', price: 32 } },
			{ schema: 'adjustment', values: { sku: 'TT-MUG-01', delta: 40, reason: 'received', at: '2026-08-25T09:00:00.000Z' } },
			{ schema: 'adjustment', values: { sku: 'TT-MUG-01', delta: -3, reason: 'sold', at: '2026-08-26T15:00:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'receiver' }])
	},
	{
		key: 'feedback',
		title: 'Feedback',
		emoji: '⭐',
		description: 'Collect ratings with a comment and read the digest.',
		story: [
			'A rating control with five one-tap buttons, each passing a different enum value to the same action. The digest lists the newest feedback.',
			'Ratings stay strings in the enum so the inspector shows exactly what a control may send.'
		],
		tone: 'sunset',
		schemas: [
			{
				key: 'feedback',
				description: 'One piece of feedback about a page.',
				fields: [
					{ name: 'page', type: 'string', required: true, maxLength: 120 },
					{ name: 'rating', type: 'enum', values: ['1', '2', '3', '4', '5'], required: true },
					{ name: 'comment', type: 'string', maxLength: 600 },
					{ name: 'at', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'rater',
				name: 'Rating strip',
				description: 'Five taps, one action.',
				args: [stringArg('page', 'Page', '/builder/demos', 120), textArg('comment', 'Comment', 'Loved the demo library.')],
				render: (refs) =>
					controlCard('How was {page}?', [
						line('“{comment}”', { muted: true }),
						buttonRow(['1', '2', '3', '4', '5'].map((rating) => runButton(`${rating} ★`, refs.actionKey('rate'), { page: '{page}', rating, comment: '{comment}' }, rating === '5' ? 'solid' : 'ghost'))),
						buttonRow([runButton('Digest', refs.actionKey('digest'), {}, 'ghost')])
					])
			}
		],
		actions: [
			{
				key: 'rate',
				name: 'Leave feedback',
				description: 'Creates one feedback data thing.',
				category: 'feedback',
				inputs: [stringInput('page', 'Page', true, 120), enumInput('rating', 'Rating', ['1', '2', '3', '4', '5']), textInput('comment', 'Comment')],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('feedback'), values: { page: '$input.page', rating: '$input.rating', comment: '$input.comment', at: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('feedback')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			listAction('digest', 'Feedback digest', 'Lists your newest feedback.', 'feedback', 'feedback', 20)
		],
		data: [
			{ schema: 'feedback', values: { page: '/builder', rating: '5', comment: 'Blocks that stay editable — yes.', at: '2026-09-01T08:00:00.000Z' } },
			{ schema: 'feedback', values: { page: '/feed', rating: '4', comment: 'Fast.', at: '2026-09-01T08:30:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'rater' }])
	},
	{
		key: 'tickets',
		title: 'Support tickets',
		emoji: '🎫',
		description: 'Open tickets, escalate them, attach notes in one run.',
		story: [
			'Two schemas and a composed program: open-with-note invokes open-ticket and then creates a ticket-note whose text is composed with ttConcat from $step.1.id.',
			'Escalation is a read + update: the ticket must be a data thing the viewer owns, or the run refuses.'
		],
		tone: 'ink',
		schemas: [
			{
				key: 'ticket',
				description: 'A support ticket.',
				fields: [
					{ name: 'subject', type: 'string', required: true, maxLength: 160 },
					{ name: 'body', type: 'string', maxLength: 2000 },
					{ name: 'priority', type: 'enum', values: ['low', 'normal', 'high'] },
					{ name: 'status', type: 'enum', values: ['open', 'escalated', 'closed'] },
					{ name: 'openedAt', type: 'date' }
				]
			},
			{
				key: 'note',
				description: 'A note attached to a ticket by id.',
				fields: [
					{ name: 'ticketId', type: 'string', required: true, maxLength: 128 },
					{ name: 'text', type: 'string', required: true, maxLength: 1000 },
					{ name: 'at', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'opener',
				name: 'Ticket opener',
				description: 'Opens a ticket, optionally with a first note.',
				args: [stringArg('subject', 'Subject', 'Cannot publish my page', 160), textArg('body', 'Body', 'The Public toggle does nothing on Safari.')],
				render: (refs) =>
					controlCard('Open a ticket', [
						line('{subject}', { strong: true }),
						line('{body}'),
						buttonRow([runButton('Open', refs.actionKey('open'), { subject: '{subject}', body: '{body}' }, 'ghost'), runButton('Open + note ⚡', refs.actionKey('open-note'), { subject: '{subject}', body: '{body}' }), runButton('Queue', refs.actionKey('queue'), {}, 'ghost')])
					])
			},
			{
				key: 'escalator',
				name: 'Escalator',
				description: 'Escalates the ticket with the given id.',
				args: [stringArg('ticketId', 'Ticket id', 'paste-a-ticket-id', 128)],
				render: (refs) => controlCard('Escalate', [line('{ticketId}', { muted: true }), buttonRow([runButton('Escalate 🔺', refs.actionKey('escalate'), { id: '{ticketId}' })])])
			}
		],
		actions: [
			{
				key: 'open',
				name: 'Open ticket',
				description: 'Creates an open, normal-priority ticket.',
				category: 'support',
				inputs: [stringInput('subject', 'Subject', true, 160), textInput('body', 'Body')],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('ticket'), values: { subject: '$input.subject', body: '$input.body', priority: 'normal', status: 'open', openedAt: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('ticket')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			{
				key: 'open-note',
				name: 'Open ticket with note',
				description: 'Invokes open-ticket, then attaches a composed first note.',
				category: 'support',
				inputs: [stringInput('subject', 'Subject', true, 160), textInput('body', 'Body')],
				steps: (refs) => [
					{ op: 'actions.invoke', action: refs.action('open'), inputs: { subject: '$input.subject', body: '$input.body' } },
					{ op: 'things.create', schema: refs.schema('note'), values: { ticketId: '$step.1.id', text: { ttConcat: ['Opened from the demo page: ', '$input.subject'] }, at: '$now' } },
					{ op: 'return', value: { ticket: '$step.1', note: '$step.2' } }
				],
				capabilities: (refs) => [
					{ capability: 'actions.invoke', actions: [refs.action('open')] },
					{ capability: 'things.create', schemas: [refs.schema('note')] }
				],
				limits: { timeoutMs: 6000, maxOperations: 8, maxChildActions: 2 }
			},
			{
				key: 'escalate',
				name: 'Escalate ticket',
				description: 'Reads a ticket by id and sets priority high, status escalated.',
				category: 'support',
				inputs: [stringInput('id', 'Ticket id', true, 128)],
				steps: (refs) => [
					{ op: 'things.get', id: '$input.id' },
					{ op: 'things.update', id: '$step.1.id', values: { priority: 'high', status: 'escalated' } },
					{ op: 'return', value: '$step.2' }
				],
				capabilities: (refs) => [
					{ capability: 'things.read', schemas: [refs.schema('ticket')] },
					{ capability: 'things.update', schemas: [refs.schema('ticket')] }
				],
				limits: { timeoutMs: 4000, maxOperations: 6 }
			},
			listAction('queue', 'Ticket queue', 'Lists your newest tickets.', 'support', 'ticket', 20)
		],
		data: [
			{ schema: 'ticket', values: { subject: 'Avatar upload spins forever', body: 'Safari 18, 4MB PNG.', priority: 'high', status: 'escalated', openedAt: '2026-08-29T10:00:00.000Z' } },
			{ schema: 'ticket', values: { subject: 'Wrong timezone on posts', body: 'Shows UTC.', priority: 'normal', status: 'open', openedAt: '2026-08-31T10:00:00.000Z' } },
			{ schema: 'note', values: { ticketId: 'data-demo-tickets-1', text: 'Reproduced on Safari 18.1.', at: '2026-08-29T11:00:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'opener' }, { component: 'escalator' }])
	},
	{
		key: 'habits',
		title: 'Habit log',
		emoji: '🌱',
		description: 'Log a habit with a timestamp and review the streak.',
		story: ['The smallest useful program: one create with $now and one search. A habit is an arg, so the same control logs anything.'],
		tone: 'mint',
		schemas: [
			{
				key: 'log',
				description: 'One habit occurrence.',
				fields: [
					{ name: 'habit', type: 'string', required: true, maxLength: 80 },
					{ name: 'note', type: 'string', maxLength: 300 },
					{ name: 'at', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'logger',
				name: 'Habit logger',
				description: 'Logs one occurrence of the habit arg.',
				args: [stringArg('habit', 'Habit', 'Morning walk', 80), stringArg('note', 'Note', '20 minutes, sunny', 300)],
				render: (refs) => controlCard('Log it', [line('{habit}', { strong: true }), line('{note}', { muted: true }), buttonRow([runButton('Log 🌱', refs.actionKey('log'), { habit: '{habit}', note: '{note}' }), runButton('History', refs.actionKey('history'), {}, 'ghost')])])
			}
		],
		actions: [
			{
				key: 'log',
				name: 'Log habit',
				description: 'Creates one habit-log data thing stamped with $now.',
				category: 'habits',
				inputs: [stringInput('habit', 'Habit', true, 80), stringInput('note', 'Note', false, 300)],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('log'), values: { habit: '$input.habit', note: '$input.note', at: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('log')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			listAction('history', 'Habit history', 'Lists your newest thirty habit logs.', 'habits', 'log', 30)
		],
		data: [
			{ schema: 'log', values: { habit: 'Morning walk', note: 'Cold but bright', at: '2026-08-30T21:00:00.000Z' } },
			{ schema: 'log', values: { habit: 'Morning walk', note: 'Rain', at: '2026-08-31T21:00:00.000Z' } },
			{ schema: 'log', values: { habit: 'Read 10 pages', at: '2026-08-31T12:00:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'logger' }])
	},
	{
		key: 'orders',
		title: 'Orders & invoices',
		emoji: '🧾',
		description: 'Place an order, mint its invoice, mark it paid.',
		story: [
			'place-order creates two data things in one run: the order, then an invoice whose orderId references $step.1.id. mark-paid updates an invoice by id.',
			'Two create capabilities with separate schema scopes — the inspector derives “creates order, invoice” from the steps.'
		],
		tone: 'ocean',
		schemas: [
			{
				key: 'order',
				description: 'A customer order.',
				fields: [
					{ name: 'customer', type: 'string', required: true, maxLength: 120 },
					{ name: 'item', type: 'string', required: true, maxLength: 120 },
					{ name: 'qty', type: 'number', min: 1, max: 999 },
					{ name: 'status', type: 'enum', values: ['placed', 'shipped', 'delivered'] },
					{ name: 'placedAt', type: 'date' }
				]
			},
			{
				key: 'invoice',
				description: 'An invoice for an order.',
				fields: [
					{ name: 'orderId', type: 'string', required: true, maxLength: 128 },
					{ name: 'amount', type: 'number', min: 0, unit: '$' },
					{ name: 'status', type: 'enum', values: ['unpaid', 'paid'] },
					{ name: 'paidAt', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'checkout',
				name: 'Checkout',
				description: 'Places an order and mints its invoice.',
				args: [stringArg('customer', 'Customer', 'Ada Lovelace'), stringArg('item', 'Item', 'Thingtime mug'), stringArg('qty', 'Quantity', '2', 3), stringArg('amount', 'Amount', '36', 8)],
				render: (refs) =>
					controlCard('Place an order', [
						line('{customer} · {qty} × {item}', { strong: true }),
						line('${amount} due on the invoice', { muted: true }),
						buttonRow([runButton('Place order 🧾', refs.actionKey('place'), { customer: '{customer}', item: '{item}', qty: '{qty}', amount: '{amount}' }), runButton('Order board', refs.actionKey('board'), {}, 'ghost')])
					])
			},
			{
				key: 'payer',
				name: 'Pay invoice',
				description: 'Marks the invoice with the given id as paid.',
				args: [stringArg('invoiceId', 'Invoice id', 'paste-an-invoice-id', 128)],
				render: (refs) => controlCard('Pay', [line('{invoiceId}', { muted: true }), buttonRow([runButton('Mark paid ✓', refs.actionKey('pay'), { id: '{invoiceId}' })])])
			}
		],
		actions: [
			{
				key: 'place',
				name: 'Place order',
				description: 'Creates the order, then an unpaid invoice referencing it.',
				category: 'commerce',
				inputs: [stringInput('customer', 'Customer', true, 120), stringInput('item', 'Item', true, 120), numberInput('qty', 'Quantity', 1, 999, 1), numberInput('amount', 'Amount', 0, 100000, 0)],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('order'), values: { customer: '$input.customer', item: '$input.item', qty: '$input.qty', status: 'placed', placedAt: '$now' } },
					{ op: 'things.create', schema: refs.schema('invoice'), values: { orderId: '$step.1.id', amount: '$input.amount', status: 'unpaid' } },
					{ op: 'return', value: { order: '$step.1', invoice: '$step.2' } }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('order'), refs.schema('invoice')] }],
				limits: { timeoutMs: 5000, maxOperations: 6 }
			},
			{
				key: 'pay',
				name: 'Mark invoice paid',
				description: 'Reads an invoice by id and sets status paid with paidAt.',
				category: 'commerce',
				inputs: [stringInput('id', 'Invoice id', true, 128)],
				steps: (refs) => [
					{ op: 'things.get', id: '$input.id' },
					{ op: 'things.update', id: '$step.1.id', values: { status: 'paid', paidAt: '$now' } },
					{ op: 'return', value: '$step.2' }
				],
				capabilities: (refs) => [
					{ capability: 'things.read', schemas: [refs.schema('invoice')] },
					{ capability: 'things.update', schemas: [refs.schema('invoice')] }
				],
				limits: { timeoutMs: 4000, maxOperations: 6 }
			},
			listAction('board', 'Order board', 'Lists your newest orders.', 'commerce', 'order', 20)
		],
		data: [
			{ schema: 'order', values: { customer: 'Hana', item: 'Rainbow tee (M)', qty: 1, status: 'shipped', placedAt: '2026-08-28T10:00:00.000Z' } },
			{ schema: 'invoice', values: { orderId: 'data-demo-orders-1', amount: 32, status: 'paid', paidAt: '2026-08-28T11:00:00.000Z' } },
			{ schema: 'order', values: { customer: 'Otis', item: 'Thingtime mug', qty: 4, status: 'placed', placedAt: '2026-09-01T10:00:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'checkout' }, { component: 'payer' }])
	},
	{
		key: 'bookmarks',
		title: 'Reading list',
		emoji: '🔖',
		description: 'Save links with tags and pull your reading list.',
		story: ['Save-and-list with a string[] shape in the schema; the control passes a comma-separated tags string the schema documents as free text.'],
		tone: 'mono',
		schemas: [
			{
				key: 'bookmark',
				description: 'A saved link.',
				fields: [
					{ name: 'url', type: 'string', required: true, maxLength: 500 },
					{ name: 'title', type: 'string', maxLength: 200 },
					{ name: 'tags', type: 'string', maxLength: 200, description: 'comma-separated' },
					{ name: 'savedAt', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'saver',
				name: 'Bookmark saver',
				description: 'Saves the url/title/tags args as a bookmark.',
				args: [stringArg('url', 'URL', 'https://thingtime.com/docs', 500), stringArg('title', 'Title', 'Thingtime docs', 200), stringArg('tags', 'Tags', 'docs, thingtime', 200)],
				render: (refs) => controlCard('Save for later', [line('{title}', { strong: true }), line('{url}', { muted: true }), line('# {tags}', { muted: true }), buttonRow([runButton('Save 🔖', refs.actionKey('save'), { url: '{url}', title: '{title}', tags: '{tags}' }), runButton('Reading list', refs.actionKey('list'), {}, 'ghost')])])
			}
		],
		actions: [
			{
				key: 'save',
				name: 'Save bookmark',
				description: 'Creates one bookmark data thing.',
				category: 'reading',
				inputs: [stringInput('url', 'URL', true, 500), stringInput('title', 'Title', false, 200), stringInput('tags', 'Tags', false, 200)],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('bookmark'), values: { url: '$input.url', title: '$input.title', tags: '$input.tags', savedAt: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('bookmark')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			listAction('list', 'Reading list', 'Lists your newest bookmarks.', 'reading', 'bookmark', 30)
		],
		data: [
			{ schema: 'bookmark', values: { url: 'https://thingtime.com/docs/api', title: 'API reference', tags: 'docs, api', savedAt: '2026-08-30T08:00:00.000Z' } },
			{ schema: 'bookmark', values: { url: 'https://thingtime.com/builder/demos', title: 'Demo library', tags: 'builder', savedAt: '2026-09-01T08:00:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'saver' }])
	},
	{
		key: 'checkin',
		title: 'Event check-in',
		emoji: '🎟',
		description: 'Check attendees in at the door and list arrivals.',
		story: ['A door scanner as a component: the ticket code and attendee are args; each tap appends a check-in stamped with $now.'],
		tone: 'sunset',
		schemas: [
			{
				key: 'checkin',
				description: 'One attendee arrival.',
				fields: [
					{ name: 'attendee', type: 'string', required: true, maxLength: 120 },
					{ name: 'ticketCode', type: 'string', required: true, maxLength: 40 },
					{ name: 'gate', type: 'enum', values: ['north', 'south'] },
					{ name: 'at', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'scanner',
				name: 'Door scanner',
				description: 'Checks the attendee in at the chosen gate.',
				args: [stringArg('attendee', 'Attendee', 'Nia Orbit', 120), stringArg('ticketCode', 'Ticket code', 'ORB-0142', 40)],
				render: (refs) =>
					controlCard('Check in', [
						line('{attendee} · {ticketCode}', { strong: true }),
						buttonRow([runButton('North gate', refs.actionKey('checkin'), { attendee: '{attendee}', ticketCode: '{ticketCode}', gate: 'north' }), runButton('South gate', refs.actionKey('checkin'), { attendee: '{attendee}', ticketCode: '{ticketCode}', gate: 'south' }, 'ghost'), runButton('Arrivals', refs.actionKey('arrivals'), {}, 'ghost')])
					])
			}
		],
		actions: [
			{
				key: 'checkin',
				name: 'Check in attendee',
				description: 'Creates one check-in data thing.',
				category: 'events',
				inputs: [stringInput('attendee', 'Attendee', true, 120), stringInput('ticketCode', 'Ticket code', true, 40), enumInput('gate', 'Gate', ['north', 'south'], 'north')],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('checkin'), values: { attendee: '$input.attendee', ticketCode: '$input.ticketCode', gate: '$input.gate', at: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('checkin')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			listAction('arrivals', 'Arrivals', 'Lists your newest fifty check-ins.', 'events', 'checkin', 50)
		],
		data: [
			{ schema: 'checkin', values: { attendee: 'Sofia Vector', ticketCode: 'ORB-0007', gate: 'north', at: '2026-10-14T08:02:00.000Z' } },
			{ schema: 'checkin', values: { attendee: 'Ben Quill', ticketCode: 'ORB-0031', gate: 'south', at: '2026-10-14T08:05:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'scanner' }])
	},
	{
		key: 'expenses',
		title: 'Expense log',
		emoji: '💸',
		description: 'Log expenses by category and pull a report.',
		story: ['Numbers arrive as strings from the control and are coerced + range-checked by the executor; the category is an enum so the report is groupable.'],
		tone: 'paper',
		schemas: [
			{
				key: 'expense',
				description: 'One expense.',
				fields: [
					{ name: 'amount', type: 'number', min: 0, max: 100000, required: true, unit: '$' },
					{ name: 'category', type: 'enum', values: ['travel', 'food', 'tools', 'other'] },
					{ name: 'note', type: 'string', maxLength: 300 },
					{ name: 'at', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'logger',
				name: 'Expense logger',
				description: 'Logs the amount/category/note args.',
				args: [stringArg('amount', 'Amount', '14.50', 10), enumArg('category', 'Category', ['travel', 'food', 'tools', 'other'], 'food'), stringArg('note', 'Note', 'Coffee with June', 300)],
				render: (refs) => controlCard('Log an expense', [line('${amount} · {category}', { strong: true }), line('{note}', { muted: true }), buttonRow([runButton('Log 💸', refs.actionKey('log'), { amount: '{amount}', category: '{category}', note: '{note}' }), runButton('Report', refs.actionKey('report'), {}, 'ghost')])])
			}
		],
		actions: [
			{
				key: 'log',
				name: 'Log expense',
				description: 'Creates one expense data thing.',
				category: 'finance',
				inputs: [numberInput('amount', 'Amount', 0, 100000), enumInput('category', 'Category', ['travel', 'food', 'tools', 'other'], 'other'), stringInput('note', 'Note', false, 300)],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('expense'), values: { amount: '$input.amount', category: '$input.category', note: '$input.note', at: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('expense')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			listAction('report', 'Expense report', 'Lists your newest fifty expenses.', 'finance', 'expense', 50)
		],
		data: [
			{ schema: 'expense', values: { amount: 42, category: 'travel', note: 'Tram tickets', at: '2026-08-29T08:00:00.000Z' } },
			{ schema: 'expense', values: { amount: 14.5, category: 'food', note: 'Coffee with June', at: '2026-08-30T09:00:00.000Z' } },
			{ schema: 'expense', values: { amount: 120, category: 'tools', note: 'Keyboard', at: '2026-08-31T09:00:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'logger' }])
	},
	{
		key: 'applications',
		title: 'Hiring pipeline',
		emoji: '🧑‍💼',
		description: 'Take applications and advance them through stages.',
		story: ['Create, update-by-id, and list — with an enum stage the advancer sets explicitly so the run record shows exactly which transition happened.'],
		tone: 'ocean',
		schemas: [
			{
				key: 'application',
				description: 'A candidate’s application for a role.',
				fields: [
					{ name: 'candidate', type: 'string', required: true, maxLength: 120 },
					{ name: 'role', type: 'string', required: true, maxLength: 120 },
					{ name: 'stage', type: 'enum', values: ['applied', 'screen', 'interview', 'offer', 'hired', 'declined'] },
					{ name: 'appliedAt', type: 'date' }
				]
			}
		],
		components: [
			{
				key: 'apply',
				name: 'Application form',
				description: 'Submits an application for the role arg.',
				args: [stringArg('candidate', 'Candidate', 'Lin Vector', 120), stringArg('role', 'Role', 'Query engine engineer', 120)],
				render: (refs) => controlCard('Apply', [line('{candidate} → {role}', { strong: true }), buttonRow([runButton('Submit application', refs.actionKey('apply'), { candidate: '{candidate}', role: '{role}' }), runButton('Pipeline', refs.actionKey('pipeline'), {}, 'ghost')])])
			},
			{
				key: 'advancer',
				name: 'Stage advancer',
				description: 'Moves the application with the given id to a stage.',
				args: [stringArg('applicationId', 'Application id', 'paste-an-application-id', 128)],
				render: (refs) =>
					controlCard('Advance', [
						line('{applicationId}', { muted: true }),
						buttonRow([
							runButton('Screen', refs.actionKey('advance'), { id: '{applicationId}', stage: 'screen' }, 'ghost'),
							runButton('Interview', refs.actionKey('advance'), { id: '{applicationId}', stage: 'interview' }, 'ghost'),
							runButton('Offer 🎉', refs.actionKey('advance'), { id: '{applicationId}', stage: 'offer' })
						])
					])
			}
		],
		actions: [
			{
				key: 'apply',
				name: 'Submit application',
				description: 'Creates an application in the applied stage.',
				category: 'hiring',
				inputs: [stringInput('candidate', 'Candidate', true, 120), stringInput('role', 'Role', true, 120)],
				steps: (refs) => [
					{ op: 'things.create', schema: refs.schema('application'), values: { candidate: '$input.candidate', role: '$input.role', stage: 'applied', appliedAt: '$now' } },
					{ op: 'return', value: '$step.1' }
				],
				capabilities: (refs) => [{ capability: 'things.create', schemas: [refs.schema('application')] }],
				limits: { timeoutMs: 4000, maxOperations: 4 }
			},
			{
				key: 'advance',
				name: 'Advance stage',
				description: 'Reads an application by id and sets its stage.',
				category: 'hiring',
				inputs: [stringInput('id', 'Application id', true, 128), enumInput('stage', 'Stage', ['screen', 'interview', 'offer', 'hired', 'declined'])],
				steps: (refs) => [
					{ op: 'things.get', id: '$input.id' },
					{ op: 'things.update', id: '$step.1.id', values: { stage: '$input.stage' } },
					{ op: 'return', value: '$step.2' }
				],
				capabilities: (refs) => [
					{ capability: 'things.read', schemas: [refs.schema('application')] },
					{ capability: 'things.update', schemas: [refs.schema('application')] }
				],
				limits: { timeoutMs: 4000, maxOperations: 6 }
			},
			listAction('pipeline', 'Pipeline', 'Lists your newest applications.', 'hiring', 'application', 30)
		],
		data: [
			{ schema: 'application', values: { candidate: 'Dana Fable', role: 'Developer experience', stage: 'interview', appliedAt: '2026-08-20T10:00:00.000Z' } },
			{ schema: 'application', values: { candidate: 'Marco Orbit', role: 'Storage engineer', stage: 'applied', appliedAt: '2026-08-31T10:00:00.000Z' } }
		],
		page: (ctx, refs, suite) => suitePage(ctx, refs, suite, [{ component: 'apply' }, { component: 'advancer' }])
	}
];

// ---------------------------------------------------------------------------
// Materialisation.

export type SuiteMode = 'system' | 'own';

// App suites (registered below) slug as `app-<suite>-<key>` so their schema
// names, componentKeys, actionKeys, and seeded shareIds read as the app's,
// not as demos; the demo originals keep `demo-`.
export const APP_SLUG_PREFIX = 'app-';
export const suiteSlugPrefix = (suiteKey: string): string => (APP_SUITES.some((suite) => suite.key === suiteKey) ? APP_SLUG_PREFIX : SUITE_SLUG_PREFIX);
export const suiteSlug = (suiteKey: string, key: string): string => `${suiteSlugPrefix(suiteKey)}${suiteKey}-${key}`;

// System-copy shareIds (reserved kind prefixes; system seeding writes them).
export const suiteSchemaShareId = (suiteKey: string, key: string): string => `schema-${suiteSlug(suiteKey, key)}`;
export const suiteComponentShareId = (suiteKey: string, key: string): string => `component-${suiteSlug(suiteKey, key)}`;
export const suiteActionShareId = (suiteKey: string, key: string): string => `action-${suiteSlug(suiteKey, key)}`;
export const suiteDataShareId = (suiteKey: string, index: number): string => `data-${suiteSlugPrefix(suiteKey)}${suiteKey}-${index + 1}`;
export const suitePageShareId = (suiteKey: string): string => `webpage-${SUITE_SLUG_PREFIX}suite-${suiteKey}`;
// App pages: the entry page IS the suite key (/p/pokeworld), the rest are
// <suiteKey>-<pageKey> (/p/pokeworld-pokedex). The seeded shareId is the
// reserved webpage- prefix plus that pageKey.
export const suiteAppPageKey = (suite: Pick<BehaviourSuite, 'key' | 'pages' | 'app'>, pageKey: string): string => {
	const entry = suite.app?.entry || suite.pages?.[0]?.key || '';
	return pageKey === entry ? suite.key : `${suite.key}-${pageKey}`;
};
export const suiteAppPageShareId = (suite: Pick<BehaviourSuite, 'key' | 'pages' | 'app'>, pageKey: string): string => `webpage-${suiteAppPageKey(suite, pageKey)}`;
export const isAppSuite = (suite: BehaviourSuite): boolean => !!suite.app && Array.isArray(suite.pages) && suite.pages.length > 0;
export const suiteEntryPageKey = (suite: BehaviourSuite): string => (isAppSuite(suite) ? suite.key : `${SUITE_SLUG_PREFIX}suite-${suite.key}`);
export const suiteEntryPageShareId = (suite: BehaviourSuite): string => (isAppSuite(suite) ? `webpage-${suite.key}` : suitePageShareId(suite.key));

export const suiteRefsFor = (suite: BehaviourSuite, mode: SuiteMode): SuiteRefs => ({
	schema: (key) => (mode === 'system' ? suiteSchemaShareId(suite.key, key) : suiteSlug(suite.key, key)),
	action: (key) => (mode === 'system' ? suiteActionShareId(suite.key, key) : suiteSlug(suite.key, key)),
	component: (key) => suiteSlug(suite.key, key),
	actionKey: (key) => suiteSlug(suite.key, key),
	schemaName: (key) => suiteSlug(suite.key, key)
});

export type MaterializedSuite = {
	key: string;
	title: string;
	emoji: string;
	description: string;
	story: string[];
	mode: SuiteMode;
	schemas: Array<{ key: string; slug: string; shareId: string; crystal: Record<string, unknown> }>;
	components: Array<{ key: string; slug: string; shareId: string; crystal: Record<string, unknown> }>;
	actions: Array<{ key: string; slug: string; shareId: string; crystal: Record<string, unknown> }>;
	// data crystals carry `schema` (name); the caller stamps `schemaId` once
	// it knows the schema thing's id (system: the seeded shareId)
	data: Array<{ index: number; schemaKey: string; shareId: string; crystal: Record<string, unknown> }>;
	// the entry page (single-page suites: the only page)
	page: { slug: string; shareId: string; crystal: Record<string, unknown> };
	// every page, entry first — app suites install all of them
	pages: Array<{ key: string; slug: string; shareId: string; pageKey: string; crystal: Record<string, unknown> }>;
	app: SuiteAppDef | null;
};

export const materializeSuite = (suite: BehaviourSuite, mode: SuiteMode): MaterializedSuite => {
	const refs = suiteRefsFor(suite, mode);
	const kit = demoBlockKit;
	const tone = kit.toneByKey(suite.tone);
	const ctx: DemoBlockCtx = { id: kit.makeIds(`suite-${suite.key}`), tone, copy: kit.defaultCopy };
	const pageSlug = `suite-${suite.key}`;
	return {
		key: suite.key,
		title: suite.title,
		emoji: suite.emoji,
		description: suite.description,
		story: suite.story,
		mode,
		schemas: suite.schemas.map((schema) => ({
			key: schema.key,
			slug: suiteSlug(suite.key, schema.key),
			shareId: suiteSchemaShareId(suite.key, schema.key),
			crystal: { name: refs.schemaName(schema.key), description: `${suite.emoji} ${suite.title} demo suite — ${schema.description}`, fields: schema.fields }
		})),
		components: suite.components.map((component) => ({
			key: component.key,
			slug: suiteSlug(suite.key, component.key),
			shareId: suiteComponentShareId(suite.key, component.key),
			crystal: {
				name: `${component.name} · ${suite.title} demo`,
				description: component.description,
				library: 'thingtime',
				category: 'demo suites',
				componentKey: suiteSlug(suite.key, component.key),
				version: 1,
				args: component.args,
				render: component.render(refs)
			}
		})),
		actions: suite.actions.map((action) => ({
			key: action.key,
			slug: suiteSlug(suite.key, action.key),
			shareId: suiteActionShareId(suite.key, action.key),
			crystal: {
				name: `${action.name} · ${suite.title} demo`,
				description: action.description,
				actionKey: suiteSlug(suite.key, action.key),
				category: action.category,
				version: 1,
				inputs: action.inputs,
				steps: action.steps(refs),
				capabilities: action.capabilities(refs),
				...(action.limits ? { limits: action.limits } : {})
			}
		})),
		data: suite.data.map((entry, index) => ({
			index,
			schemaKey: entry.schema,
			shareId: suiteDataShareId(suite.key, index),
			crystal: { ...entry.values, schema: refs.schemaName(entry.schema) }
		})),
		...(() => {
			if (isAppSuite(suite)) {
				const entryKey = suite.app?.entry || suite.pages![0].key;
				const ordered = [...suite.pages!].sort((a, b) => (a.key === entryKey ? -1 : b.key === entryKey ? 1 : 0));
				const pages = ordered.map((page) => {
					const pageKey = suiteAppPageKey(suite, page.key);
					const pageCtx: DemoBlockCtx = { id: kit.makeIds(`app-${suite.key}-${page.key}`), tone, copy: kit.defaultCopy };
					return {
						key: page.key,
						slug: pageKey,
						shareId: suiteAppPageShareId(suite, page.key),
						pageKey,
						crystal: {
							name: page.key === entryKey ? `${suite.emoji} ${suite.title}` : `${suite.emoji} ${suite.title} · ${page.name}`,
							description: page.description || suite.description,
							pageKey,
							suiteKey: suite.key,
							version: 1,
							previewBg: tone.bg,
							blocks: page.blocks(pageCtx, refs, suite)
						}
					};
				});
				return { page: { slug: pages[0].slug, shareId: pages[0].shareId, crystal: pages[0].crystal }, pages, app: suite.app || null };
			}
			const page = {
				slug: pageSlug,
				shareId: suitePageShareId(suite.key),
				crystal: {
					name: `${suite.emoji} ${suite.title} · behaviour suite`,
					description: suite.description,
					pageKey: `${SUITE_SLUG_PREFIX}${pageSlug}`,
					suiteKey: suite.key,
					version: 1,
					previewBg: tone.bg,
					blocks: suite.page!(ctx, refs, suite)
				}
			};
			return { page, pages: [{ key: 'suite', slug: pageSlug, shareId: page.shareId, pageKey: `${SUITE_SLUG_PREFIX}${pageSlug}`, crystal: page.crystal }], app: null };
		})()
	};
};

export const getBehaviourSuite = (key: string): BehaviourSuite | null => BEHAVIOUR_SUITES.find((suite) => suite.key === key) || null;

export type BehaviourSuiteSummary = {
	key: string;
	title: string;
	emoji: string;
	description: string;
	story: string[];
	tone: string;
	counts: { schemas: number; components: number; actions: number; data: number; pages: number };
	pageId: string;
	// the URL the entry page answers at for everyone (seeded or installed)
	pageKey: string;
	pageIds: string[];
	actionIds: string[];
	schemaIds: string[];
	app: SuiteAppDef | null;
};

export const summarizeBehaviourSuite = (suite: BehaviourSuite): BehaviourSuiteSummary => ({
	key: suite.key,
	title: suite.title,
	emoji: suite.emoji,
	description: suite.description,
	story: suite.story,
	tone: suite.tone,
	counts: {
		schemas: suite.schemas.length,
		components: suite.components.length,
		actions: suite.actions.length,
		data: suite.data.length,
		pages: isAppSuite(suite) ? suite.pages!.length : 1
	},
	pageId: suiteEntryPageShareId(suite),
	pageKey: suiteEntryPageKey(suite),
	pageIds: isAppSuite(suite) ? suite.pages!.map((page) => suiteAppPageShareId(suite, page.key)) : [suitePageShareId(suite.key)],
	actionIds: suite.actions.map((action) => suiteActionShareId(suite.key, action.key)),
	schemaIds: suite.schemas.map((schema) => suiteSchemaShareId(suite.key, schema.key)),
	app: suite.app || null
});

// The app suites live in their own modules (schemas/appSuites/*) and are
// registered here so every consumer (seed, gallery, install, tests) iterates
// ONE list. BEHAVIOUR_SUITES stays the demo originals; ALL_SUITES is what
// materialises.
export const APP_SUITES: BehaviourSuite[] = [];
export const registerAppSuite = (suite: BehaviourSuite): BehaviourSuite => {
	if (!APP_SUITES.some((entry) => entry.key === suite.key)) APP_SUITES.push(suite);
	return suite;
};
export const getAllSuites = (): BehaviourSuite[] => [...BEHAVIOUR_SUITES, ...APP_SUITES];
export const getAnySuite = (key: string): BehaviourSuite | null => getAllSuites().find((suite) => suite.key === key) || null;
