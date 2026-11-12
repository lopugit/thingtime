// BRANCHWOOD — a choose-your-own-adventure. The story is public system
// content (one data thing per scene, with choices that may require or set a
// flag); your playthrough — where you are, what you carry, the path you
// took, the endings you have found — is one data thing you own.
//
// Built to show: branching logic in the action grammar (a `when`-guarded
// chain of fails, `find`/`filter` over a scene's choices, flags as a string
// list with uniq/append), `system`-scope content reads, a stateful single
// record updated in place, and a journal that maps a path of keys back to
// titles with a lambda.

import type { BehaviourSuite, SuiteActionDef, SuiteComponentDef, SuiteRefs } from '../behaviourSuites.ts';
import { appShell, boundBlock, coalesce, compute, concat, each, el, eq, firstCrystal, firstId, get, ifOp, ifTruthy, iff, isEmpty, len, makeKit, makeTheme, merge, navComponent, notEmpty, pick, returnValue, search, x, type Node } from './kit.ts';

const T = makeTheme({ bg: '#f7f3ea', surface: '#fffdf8', ink: '#2b2118', text: '#5a4a3a', muted: '#9c8b78', accent: '#7c4a1e', soft: '#f1e8d8', border: '#e6d9c3', ok: '#3d7a4a', danger: '#b23a3a', font: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', serif" });
const k = makeKit(T);
const SMALL = { padding: '6px 11px', fontSize: '12px' };

type Choice = { label: string; to: string; requires?: string; sets?: string; hint?: string };
type Scene = { key: string; title: string; mood: 'calm' | 'tense' | 'wonder' | 'dark' | 'ending'; text: string; choices: Choice[]; ending?: string };
const SCENES: Scene[] = [
	{ key: 'start', title: 'The last bus to Branchwood', mood: 'calm', text: 'The bus leaves you at a stop with no sign, in a village where every house faces the sea and none of them face you. Down the cliff path a lighthouse stands dark. A note is pinned to the stop: “Keeper wanted. Ask at the Gull.”', choices: [{ label: 'Find the Gull — it sounds like a pub', to: 'gull' }, { label: 'Walk straight down to the lighthouse', to: 'cliffpath' }] },
	{ key: 'gull', title: 'The Gull', mood: 'calm', text: 'The Gull is warm, low-beamed and half asleep. The landlady looks at you the way you look at weather. “Keeper’s job? Lamp’s been out three weeks. Old Tam left in a hurry and left this.” She slides a brass key across the bar.', choices: [{ label: 'Take the key and thank her', to: 'gull-key', sets: 'key' }, { label: 'Ask what Tam was afraid of', to: 'gull-story' }] },
	{ key: 'gull-story', title: 'What Tam saw', mood: 'tense', text: '“He said the light started answering,” she says. “You’d flash it out to sea and something out there would flash back. Three long, one short. Every night. Then it flashed first.” She pushes the key over anyway. “Somebody has to.”', choices: [{ label: 'Take the key', to: 'gull-key', sets: 'key' }, { label: 'Ask if anyone has a lantern', to: 'lantern', sets: 'lantern' }] },
	{ key: 'gull-key', title: 'A key that is warm', mood: 'calm', text: 'The key is warm as if it had been in someone’s hand a moment ago. Outside, the wind has turned. A boy by the door says, “If you’re going up there, take a lantern. The stairs eat torches.” He holds one out.', choices: [{ label: 'Take the lantern', to: 'lantern', sets: 'lantern' }, { label: 'You have a phone. Go now', to: 'cliffpath' }] },
	{ key: 'lantern', title: 'A borrowed light', mood: 'calm', text: 'The lantern is old, oiled and heavy, and it lights on the first try. The boy — Finn — walks you to the cliff path and stops there. “I’ll wait till I see the lamp come on,” he says. “Then I’ll know.”', choices: [{ label: 'Head down the cliff path', to: 'cliffpath' }, { label: 'Ask Finn to come with you', to: 'finn' }] },
	{ key: 'finn', title: 'Two are braver', mood: 'calm', text: 'Finn thinks about it for exactly as long as a twelve-year-old thinks about anything, then nods. “Mum says I’m not allowed. Mum also says the lamp has to come on.” He takes the lantern, because he knows the stairs.', choices: [{ label: 'Down the cliff path, together', to: 'cliffpath', sets: 'friend' }] },
	{ key: 'cliffpath', title: 'The cliff path', mood: 'tense', text: 'The path is cut into the rock, wet with spray, and halfway down a chain has been strung across it with a sign: DANGER — WAY CLOSED. Beyond the chain the path continues. Beside it a narrower goat track drops toward the beach.', choices: [{ label: 'Step over the chain', to: 'door' }, { label: 'Take the goat track to the beach', to: 'beach' }] },
	{ key: 'beach', title: 'The shell beach', mood: 'wonder', text: 'The beach is entirely shells, millions of them, and they chime when the water moves. In the tideline something glints: a folded chart in an oilskin, marked with a cross a mile out to sea and the words MEET HER THERE in Tam’s hand.', choices: [{ label: 'Pocket the chart', to: 'door', sets: 'map' }, { label: 'Leave it. Climb back to the lighthouse', to: 'door' }] },
	{ key: 'door', title: 'The lighthouse door', mood: 'tense', text: 'The door is iron and closed and colder than the air. Someone has scratched a tally into it — nineteen marks — and under them: NOT TONIGHT.', choices: [{ label: 'Unlock it with the brass key', to: 'stairs', requires: 'key', hint: 'needs the key' }, { label: 'Knock', to: 'knock' }, { label: 'Walk round to the seaward side', to: 'seaward' }] },
	{ key: 'knock', title: 'Knocking', mood: 'dark', text: 'You knock. After a while, from very far away and very far down, something knocks back. Three long. One short.', choices: [{ label: 'Unlock the door', to: 'stairs', requires: 'key', hint: 'needs the key' }, { label: 'Go back to the Gull for the key', to: 'gull' }, { label: 'Walk round to the seaward side', to: 'seaward' }] },
	{ key: 'seaward', title: 'The seaward side', mood: 'wonder', text: 'On the seaward side the rock falls straight into black water and a boat is tied to an iron ring, oars shipped, dry. Out at sea, right where the horizon should be, a light flashes. Three long. One short.', choices: [{ label: 'Take the boat and row out', to: 'boat' }, { label: 'Back to the door', to: 'door' }] },
	{ key: 'boat', title: 'Rowing out', mood: 'dark', text: 'The sea is flat and the boat goes easily, too easily, as if the water wants you there. The light ahead does not get closer for a long time. Then it is right beside you and it is a woman standing in a boat of her own, holding a lantern, and she is smiling.', choices: [{ label: 'Show her the chart', to: 'ending-sea', requires: 'map', hint: 'needs the chart' }, { label: 'Ask her what she wants', to: 'her' }, { label: 'Row back as hard as you can', to: 'ending-home' }] },
	{ key: 'her', title: 'What she wants', mood: 'dark', text: '“The light,” she says. “I only ever wanted the light kept. They stopped keeping it.” Her lantern gutters. “You could keep it. Or you could come and see where the flashing comes from.”', choices: [{ label: 'Promise to keep the light', to: 'ending-keeper' }, { label: 'Go and see', to: 'ending-sea' }] },
	{ key: 'stairs', title: 'The stairs', mood: 'tense', text: 'The stairs spiral up in the dark and your phone torch dies on the fourth turn, exactly as promised.', choices: [{ label: 'Light the lantern', to: 'lamp-room', requires: 'lantern', hint: 'needs a lantern' }, { label: 'Feel your way up in the dark', to: 'dark-stairs' }] },
	{ key: 'dark-stairs', title: 'In the dark', mood: 'dark', text: 'You count two hundred steps by hand. At some point the wall on your left stops being wall and starts being air, and you can hear the sea inside the tower. A step is missing. You find it with your foot just in time.', choices: [{ label: 'Keep climbing', to: 'lamp-room' }, { label: 'Turn back for the lantern', to: 'lantern', sets: 'lantern' }] },
	{ key: 'lamp-room', title: 'The lamp room', mood: 'wonder', text: 'The lamp room is glass on every side and the lamp itself is a great cold flower of lenses. The mechanism is fine. Someone simply turned it off. Beside the switch is Tam’s logbook, open, the last line reading: SHE FLASHED FIRST. I AM GOING TO ASK HER.', choices: [{ label: 'Turn the lamp on', to: 'lamp-on' }, { label: 'Read the whole logbook first', to: 'logbook' }] },
	{ key: 'logbook', title: 'Tam’s logbook', mood: 'dark', text: 'Nineteen nights. Every night the lamp went out to sea and every night the answer came back, until the answer came first. The last pages are a chart of the answering light’s position. It has been getting closer. Last night it was at the foot of the tower.', choices: [{ label: 'Turn the lamp on', to: 'lamp-on' }, { label: 'Go down and find her', to: 'seaward' }] },
	{ key: 'lamp-on', title: 'Light', mood: 'wonder', text: 'The lamp turns. The beam sweeps the village, the cliff, the shell beach, the flat black sea — and out where the horizon should be, a small light flashes three long and one short, and then, for the first time in nineteen nights, goes out.', choices: [{ label: 'Stay. Keep the light', to: 'ending-keeper' }, { label: 'Wave the lantern back at her: three long, one short', to: 'ending-storm', requires: 'lantern', hint: 'needs the lantern' }, { label: 'Climb down and go home on the morning bus', to: 'ending-home' }] },
	{ key: 'ending-keeper', title: 'The keeper', mood: 'ending', ending: 'keeper', text: 'You keep the light. The Gull sends up soup. Finn brings the post. Some nights, far out, something flashes three long and one short, and you flash back, and you both know the other is still there, and that is enough.', choices: [] },
	{ key: 'ending-sea', title: 'The answering light', mood: 'ending', ending: 'sea', text: 'You go and see. Where the flashing comes from is a lighthouse just like yours, on a shore just like this one, where a village of houses all face the sea. A note is pinned to a bus stop: KEEPER WANTED. You have the feeling you have read it before.', choices: [] },
	{ key: 'ending-storm', title: 'Three long, one short', mood: 'ending', ending: 'storm', text: 'You answer. The sea stands up. All night the storm walks round the tower without touching it, and in the morning every boat in Branchwood is safe in the harbour, and a woman with a lantern is walking up the cliff path, home at last, and the lamp is still burning.', choices: [] },
	{ key: 'ending-home', title: 'The morning bus', mood: 'ending', ending: 'home', text: 'You catch the morning bus. Branchwood shrinks behind you and the lighthouse is dark again before the first bend. You will tell this story badly at parties for the rest of your life, and every time, somewhere, a light will flash three long and one short.', choices: [] }
];
const ENDINGS: Array<[string, string]> = [
	['keeper', 'The keeper'],
	['sea', 'The answering light'],
	['storm', 'Three long, one short'],
	['home', 'The morning bus']
];
const MOOD_BG = { calm: '#f1e8d8', tense: '#f4dfcf', wonder: '#e3ecf3', dark: '#d9d3cf', ending: '#e7efe1' };
const MOOD_EMOJI = { calm: '🌤', tense: '🌬', wonder: '✨', dark: '🌑', ending: '🏁' };

// ── components ──────────────────────────────────────────────────────────────
const nav = navComponent(T, {
	brand: 'Branchwood',
	emoji: '📖',
	home: '/p/branchwood',
	links: [
		['story', 'Story', '/p/branchwood'],
		['journal', 'Journal', '/p/branchwood-journal']
	]
});

const choiceButton = (refs: SuiteRefs): Node =>
	ifTruthy(
		'item.available',
		k.button(el('span', { display: 'grid', gap: '2px', textAlign: 'left' }, [el('span', {}, ['→ {item.label}']), ifTruthy('item.sets', el('span', { fontSize: '10px', fontWeight: 600, opacity: 0.75 }, ['takes: {item.sets}']))]), refs.actionKey('choose'), { choice: '{index}' }, 'solid', { padding: '10px 16px', borderRadius: '12px', background: T.ink, border: 'none', whiteSpace: 'normal' }),
		el('div', { fontFamily: T.font, fontSize: '13px', color: T.muted, padding: '10px 16px', border: `1px dashed ${T.border}`, borderRadius: '12px' }, ['→ {item.label} — {item.hint}'])
	);

const scene: SuiteComponentDef = {
	key: 'scene',
	name: 'Scene',
	description: 'The current scene of your playthrough with its choices; locked choices show their hint. Bound to the scene action.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Branchwood',
				'A short interactive story. Every choice is one action run; the scenes are public content, the playthrough is yours.',
				ifTruthy(
					'result.hasRun',
					el('div', { display: 'grid', gap: '10px' }, [
						el('div', { display: 'grid', gap: '12px', padding: '22px 24px', borderRadius: '18px', background: pick('result.scene.mood', MOOD_BG, T.soft), border: `1px solid ${T.border}` }, [
							k.row([k.muted(pick('result.scene.mood', MOOD_EMOJI, '📖')), k.label('Step {result.steps} · {result.scene.mood}'), k.muted('carrying: {result.flagsLine}', { marginLeft: 'auto' })]),
							k.title('{result.scene.title}', { fontSize: '28px' }),
							k.text('{result.scene.text}', { fontSize: '17px', lineHeight: 1.65 }),
							ifTruthy(
								'result.ended',
								el('div', { display: 'grid', gap: '8px' }, [k.notice('THE END — “{result.scene.title}”. Ending {result.endingsFound} of 4 found.', 'ok'), k.row([k.button('Play again ↺', refs.actionKey('begin'), {}, 'solid'), k.link('Read the journal', '/p/branchwood-journal', 'ghost')])]),
								el('div', { display: 'grid', gap: '8px' }, [each('result.choices', choiceButton(refs), { max: 4 })])
							)
						]),
						k.row([k.muted('{result.pathLength} scenes so far · {result.endingsFound}/4 endings found'), k.group([k.button('Start over', refs.actionKey('begin'), {}, 'ghost', SMALL)], { marginLeft: 'auto' })])
					]),
					el('div', { display: 'grid', gap: '12px', padding: '22px 24px', borderRadius: '18px', background: T.soft, border: `1px solid ${T.border}` }, [
						k.label('An interactive story'),
						k.title('{result.scene.title}', { fontSize: '28px' }),
						k.text('{result.scene.text}', { fontSize: '17px', lineHeight: 1.65 }),
						k.row([k.button('Begin ▶', refs.actionKey('begin'), {}, 'solid'), k.muted('Four endings. About five minutes each.')])
					])
				),
				{ inert: el('div', { display: 'grid', gap: '10px', padding: '22px 24px', borderRadius: '18px', background: T.soft }, [k.title('The last bus to Branchwood', { fontSize: '28px' }), k.text('The bus leaves you at a stop with no sign, in a village where every house faces the sea…', { fontSize: '17px' }), k.muted('Four endings. Open the page to play.')]) }
			)
		])
};

const journal: SuiteComponentDef = {
	key: 'journal',
	name: 'Journal',
	description: 'The path of the current playthrough (keys mapped back to scene titles) and the endings found across every playthrough.',
	args: [],
	render: (refs) =>
		el('div', { display: 'grid', gap: '10px' }, [
			...k.gates(
				'Branchwood',
				'Your journal.',
				ifTruthy(
					'result.hasRun',
					el('div', { display: 'grid', gap: '10px' }, [
						k.card([
							k.strong('Endings found: {result.endingsFound}/4', { fontSize: '17px' }),
							k.row([each('result.endings', k.pill('{item.title}', { background: { ttIf: { arg: 'item.found', then: T.ok, else: T.soft } }, color: { ttIf: { arg: 'item.found', then: '#ffffff', else: T.muted } } }))], { gap: '6px' })
						]),
						k.card([
							k.strong('This playthrough', { fontSize: '17px' }),
							k.muted('Started {result.startedOn} · {result.steps} choices · carrying: {result.flagsLine}'),
							el('ol', { fontFamily: T.font, color: T.text, fontSize: '14px', lineHeight: 1.7, paddingLeft: '20px', margin: 0 }, [each('result.path', el('li', {}, [ifOp('item.mood', 'eq', 'ending', k.strong('{item.title} — THE END'), el('span', {}, ['{item.title}']))]), { max: 60 })]),
							k.row([k.link('← Back to the story', '/p/branchwood', 'solid', SMALL), k.group([k.button('Start over', refs.actionKey('begin'), {}, 'ghost', SMALL)])])
						])
					]),
					k.card([k.strong('No playthrough yet'), k.row([k.link('→ Begin the story', '/p/branchwood', 'solid')])])
				)
			)
		])
};

// ── actions ─────────────────────────────────────────────────────────────────
const runSearch = (refs: SuiteRefs) => search(refs.schema('playthrough'), { limit: 1, sort: { field: 'updatedAt', dir: 'desc' } });
const sceneSearch = (refs: SuiteRefs, key: unknown) => search(refs.schema('scene'), { scope: 'system', where: { key }, limit: 1 });
const flagsOf = (run: unknown): Node => coalesce(get(run, 'flags', null), []);
const choicesView = (scene: unknown, flags: unknown): Node =>
	x('map', coalesce(get(scene, 'choices', null), []), merge('$item', { index: '$index', available: x('or', isEmpty('$item.requires'), x('includes', flags, '$item.requires')), hint: coalesce('$item.hint', 'locked') }));
const endingsView = (found: unknown): Node[] => ENDINGS.map(([key, title]) => ({ key, title, found: x('includes', found, key) }));

const sceneAction: SuiteActionDef = {
	key: 'scene',
	name: 'Current scene',
	description: 'Your playthrough’s scene with the choices you can take (flags unlock some), or the opening scene when you have not begun.',
	category: 'branchwood',
	inputs: [],
	steps: (refs) => [
		runSearch(refs), // 1
		compute(firstCrystal('$step.1')), // 2
		sceneSearch(refs, coalesce(get('$step.2', 'nodeKey', null), 'start')), // 3
		compute(firstCrystal('$step.3')), // 4
		returnValue({
			hasRun: notEmpty('$step.2'),
			scene: '$step.4',
			choices: choicesView('$step.4', flagsOf('$step.2')),
			flags: flagsOf('$step.2'),
			flagsLine: iff(isEmpty(flagsOf('$step.2')), 'nothing yet', x('join', flagsOf('$step.2'), ', ')),
			steps: coalesce(get('$step.2', 'steps', null), 0),
			pathLength: len(coalesce(get('$step.2', 'path', null), [])),
			ended: notEmpty(get('$step.4', 'ending', null)),
			endingsFound: len(coalesce(get('$step.2', 'endings', null), [])),
			silent: true
		})
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('playthrough'), refs.schema('scene')] }],
	limits: { timeoutMs: 6000, maxOperations: 10 }
};

const beginAction: SuiteActionDef = {
	key: 'begin',
	name: 'Begin (or start over)',
	description: 'Creates your playthrough at the first scene — or resets the existing one in place, keeping the endings you have already found.',
	category: 'branchwood',
	inputs: [],
	steps: (refs) => [
		runSearch(refs), // 1
		compute(firstCrystal('$step.1')), // 2
		{ op: 'things.update', when: notEmpty('$step.2'), id: firstId('$step.1'), values: { nodeKey: 'start', flags: [], path: ['start'], steps: 0, ending: null, startedAt: '$now', endedAt: null, updatedAt: '$now' } }, // 3
		{ op: 'things.create', when: isEmpty('$step.2'), schema: refs.schema('playthrough'), values: { nodeKey: 'start', flags: [], path: ['start'], steps: 0, ending: null, endings: [], startedAt: '$now', endedAt: null, updatedAt: '$now' } }, // 4
		returnValue({ title: iff(notEmpty('$step.2'), 'Once more', 'The last bus to Branchwood'), message: iff(notEmpty('$step.2'), 'The story starts again. Your found endings are kept.', 'The bus leaves you at a stop with no sign…') })
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('playthrough')] }, { capability: 'things.create', schemas: [refs.schema('playthrough')] }, { capability: 'things.update', schemas: [refs.schema('playthrough')] }],
	limits: { timeoutMs: 6000, maxOperations: 8 }
};

const chooseAction: SuiteActionDef = {
	key: 'choose',
	name: 'Choose',
	description: 'Takes choice N of the current scene: checks it exists and its flag requirement, moves the playthrough, records flags, path and endings.',
	category: 'branchwood',
	inputs: [{ name: 'choice', type: 'number', label: 'Choice index', min: 0, max: 3, required: true }],
	steps: (refs) => [
		runSearch(refs), // 1
		{ op: 'fail', when: isEmpty('$step.1'), message: 'Begin the story first.' }, // 2
		compute(firstCrystal('$step.1')), // 3
		sceneSearch(refs, coalesce(get('$step.3', 'nodeKey', null), 'start')), // 4
		compute(firstCrystal('$step.4')), // 5
		{ op: 'fail', when: notEmpty(get('$step.5', 'ending', null)), message: 'This story has ended — start over to read another ending.' }, // 6
		compute(x('get', coalesce(get('$step.5', 'choices', null), []), x('round', '$input.choice'), null)), // 7
		{ op: 'fail', when: isEmpty('$step.7'), message: 'That is not one of the choices here.' }, // 8
		{ op: 'fail', when: x('and', notEmpty(get('$step.7', 'requires', null)), x('not', x('includes', flagsOf('$step.3'), get('$step.7', 'requires', '')))), message: concat('You need something first: ', coalesce(get('$step.7', 'hint', null), 'locked'), '.') }, // 9
		sceneSearch(refs, '$step.7.to'), // 10
		{ op: 'fail', when: isEmpty('$step.10'), message: 'The path leads nowhere — the scene is missing.' }, // 11
		compute(firstCrystal('$step.10')), // 12
		compute(iff(notEmpty(get('$step.7', 'sets', null)), x('uniq', x('append', flagsOf('$step.3'), get('$step.7', 'sets', ''))), flagsOf('$step.3'))), // 13
		{
			op: 'things.update',
			id: firstId('$step.1'),
			values: {
				nodeKey: '$step.7.to',
				flags: '$step.13',
				path: x('slice', x('append', coalesce(get('$step.3', 'path', null), []), '$step.7.to'), -60),
				steps: x('add', coalesce(get('$step.3', 'steps', null), 0), 1),
				ending: coalesce(get('$step.12', 'ending', null), null),
				endings: iff(notEmpty(get('$step.12', 'ending', null)), x('uniq', x('append', coalesce(get('$step.3', 'endings', null), []), get('$step.12', 'ending', ''))), coalesce(get('$step.3', 'endings', null), [])),
				endedAt: iff(notEmpty(get('$step.12', 'ending', null)), '$now', null),
				updatedAt: '$now'
			}
		}, // 14
		returnValue({ title: '$step.12.title', message: iff(notEmpty(get('$step.12', 'ending', null)), 'THE END. Start over from the story page to find another ending.', iff(notEmpty(get('$step.7', 'sets', null)), concat('You now carry: ', get('$step.7', 'sets', ''), '.'), x('slice', '$step.12.text', 0, 120))), scene: '$step.7.to', ended: notEmpty(get('$step.12', 'ending', null)), silent: false })
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('playthrough'), refs.schema('scene')] }, { capability: 'things.update', schemas: [refs.schema('playthrough')] }],
	limits: { timeoutMs: 8000, maxOperations: 20 }
};

const journalAction: SuiteActionDef = {
	key: 'journal',
	name: 'Journal',
	description: 'The path so far (scene keys mapped to titles through one system-scope read of every scene) and the endings found.',
	category: 'branchwood',
	inputs: [],
	steps: (refs) => [
		runSearch(refs), // 1
		compute(firstCrystal('$step.1')), // 2
		search(refs.schema('scene'), { scope: 'system', limit: 60 }), // 3
		compute(x('map', '$step.3', '$item.crystal')), // 4
		// (a nested find lambda would shadow $item — look scenes up by index instead)
		compute(x('pluck', '$step.4', 'key')), // 5
		compute(x('map', coalesce(get('$step.2', 'path', null), []), merge({ key: '$item' }, x('pick', coalesce(get('$step.4', x('indexOf', '$step.5', '$item'), null), {}), ['title', 'mood'])))), // 6
		returnValue({
			hasRun: notEmpty('$step.2'),
			path: '$step.6',
			steps: coalesce(get('$step.2', 'steps', null), 0),
			flagsLine: iff(isEmpty(flagsOf('$step.2')), 'nothing yet', x('join', flagsOf('$step.2'), ', ')),
			startedOn: iff(notEmpty(get('$step.2', 'startedAt', null)), x('isoDate', get('$step.2', 'startedAt', '')), ''),
			endings: endingsView(coalesce(get('$step.2', 'endings', null), [])),
			endingsFound: len(coalesce(get('$step.2', 'endings', null), [])),
			silent: true
		})
	],
	capabilities: (refs) => [{ capability: 'things.read', schemas: [refs.schema('playthrough'), refs.schema('scene')] }],
	limits: { timeoutMs: 8000, maxOperations: 12, maxResultBytes: 96 * 1024 }
};

// ── the suite ───────────────────────────────────────────────────────────────
export const branchwoodSuite: BehaviourSuite = {
	key: 'branchwood',
	title: 'Branchwood',
	emoji: '📖',
	description: 'A choose-your-own-adventure with four endings: every choice is one action run over a scene graph seeded as public content.',
	story: [
		'Twenty-two scenes are public system data things; a choice may require a flag (the key, the lantern, the chart) or grant one. The choose action is the branching logic in the grammar: a chain of `when`-guarded fails (no run, story ended, bad index, missing flag), then a system-scope read of the next scene and one update of your playthrough — position, flags with uniq/append, the path, and the endings you have found, which survive Start over.',
		'The journal maps the path of keys back to titles with a `find` lambda over one read of every scene. Nothing here needs code — the whole story is data you could edit on /things.'
	],
	tone: 'paper',
	app: { tagline: 'Four endings. One lighthouse. 📖', entry: 'story' },
	schemas: [
		{
			key: 'scene',
			description: 'One scene of the story (public content): text, mood, choices with optional flag requirements.',
			fields: [
				{ name: 'key', type: 'string', required: true, maxLength: 40 },
				{ name: 'order', type: 'number' },
				{ name: 'title', type: 'string', required: true, maxLength: 80 },
				{ name: 'mood', type: 'enum', values: ['calm', 'tense', 'wonder', 'dark', 'ending'] },
				{ name: 'text', type: 'string', maxLength: 1200 },
				{ name: 'ending', type: 'string', maxLength: 20 },
				{
					name: 'choices',
					type: 'array',
					maxItems: 4,
					items: {
						type: 'object',
						children: [
							{ name: 'label', type: 'string', maxLength: 120 },
							{ name: 'to', type: 'string', maxLength: 40 },
							{ name: 'requires', type: 'string', maxLength: 20 },
							{ name: 'sets', type: 'string', maxLength: 20 },
							{ name: 'hint', type: 'string', maxLength: 40 }
						]
					}
				}
			]
		},
		{
			key: 'playthrough',
			description: 'Your run: where you are, what you carry, the path, endings found.',
			fields: [
				{ name: 'nodeKey', type: 'string', required: true, maxLength: 40 },
				{ name: 'flags', type: 'string[]', maxItems: 8 },
				{ name: 'path', type: 'string[]', maxItems: 60 },
				{ name: 'steps', type: 'number' },
				{ name: 'ending', type: 'string', maxLength: 20 },
				{ name: 'endings', type: 'string[]', maxItems: 4 },
				{ name: 'startedAt', type: 'date' },
				{ name: 'endedAt', type: 'date' },
				{ name: 'updatedAt', type: 'date' }
			]
		}
	],
	components: [nav, scene, journal],
	actions: [sceneAction, beginAction, chooseAction, journalAction],
	data: [],
	content: () => SCENES.map((scene, index) => ({ id: scene.key, schema: 'scene', tags: ['scene', scene.mood], values: { key: scene.key, order: index + 1, title: scene.title, mood: scene.mood, text: scene.text, ending: scene.ending ?? null, choices: scene.choices } })),
	pages: [
		{ key: 'story', name: 'Story', description: 'The current scene.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'story', [boundBlock(ctx, refs, 'scene', 'scene', 'scene')], { maxWidth: 760 }) },
		{ key: 'journal', name: 'Journal', description: 'Path and endings.', blocks: (ctx, refs) => appShell(ctx, refs, 'nav', 'journal', [boundBlock(ctx, refs, 'journal', 'journal', 'journal')], { maxWidth: 760 }) }
	]
};
