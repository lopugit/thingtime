import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
	COMMANDER_COMMANDS,
	commanderCommandEnterIndex,
	matchCommanderCommands,
	parseCommanderCommand,
	runCommanderCommand
} from './commanderCommands.ts';

type Call = { kind: string; payload: any };

const makeContext = () => {
	const calls: Call[] = [];
	return {
		calls,
		ctx: {
			navigate: (to: string) => calls.push({ kind: 'navigate', payload: to }),
			lopu: (opts: any) => calls.push({ kind: 'lopu', payload: opts }),
			setThemePreset: (name: string) => calls.push({ kind: 'theme', payload: name }),
			builtinThemeNames: ['Thingtime', 'Fable', 'Prism', 'Midnight'],
			dispatchKeydown: (init: any) => calls.push({ kind: 'key', payload: init })
		}
	};
};

test('non-command input is not treated as a command', () => {
	const { ctx, calls } = makeContext();
	assert.equal(parseCommanderCommand('settings.drawer.width = 400'), null);
	assert.equal(runCommanderCommand('unicorn', ctx), false);
	assert.deepEqual(calls, []);
});

test('>theme with a valid name (case-insensitive) switches the preset and confirms via Lopu', () => {
	const { ctx, calls } = makeContext();
	assert.equal(runCommanderCommand('>theme midnight', ctx), true);
	assert.deepEqual(calls[0], { kind: 'theme', payload: 'Midnight' });
	assert.equal(calls[1].kind, 'lopu');
	assert.equal(calls[1].payload.status, 'success');
});

test('>theme with an unknown or missing name lists the presets instead of switching', () => {
	for (const input of ['>theme neon', '>theme']) {
		const { ctx, calls } = makeContext();
		assert.equal(runCommanderCommand(input, ctx), true);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].kind, 'lopu');
		assert.match(calls[0].payload.description, /Thingtime · Fable · Prism · Midnight/);
	}
});

test('>undo and >redo re-dispatch the timeline key chord', () => {
	const { ctx, calls } = makeContext();
	runCommanderCommand('>undo', ctx);
	runCommanderCommand('>redo', ctx);
	const keys = calls.filter((call) => call.kind === 'key').map((call) => call.payload);
	assert.deepEqual(keys, [
		{ key: 'z', metaKey: true },
		{ key: 'z', metaKey: true, shiftKey: true }
	]);
});

test('navigation commands navigate and confirm', () => {
	const expectations: Array<[string, string]> = [
		['>feed', '/feed'],
		['>things', '/things'],
		['>themes', '/themes'],
		['>settings', '/settings'],
		['>docs', '/docs'],
		['>docs api', '/docs/api'],
		['>search rainbow unicorn', '/search?q=rainbow%20unicorn']
	];
	for (const [input, to] of expectations) {
		const { ctx, calls } = makeContext();
		assert.equal(runCommanderCommand(input, ctx), true, input);
		assert.deepEqual(calls[0], { kind: 'navigate', payload: to }, input);
		assert.equal(calls[1].kind, 'lopu', input);
	}
});

test('unknown commands toast a pointer to >help instead of falling through', () => {
	const { ctx, calls } = makeContext();
	assert.equal(runCommanderCommand('>frobnicate now', ctx), true);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].kind, 'lopu');
	assert.match(calls[0].payload.title, /frobnicate/);
	assert.match(calls[0].payload.description, />help/);
});

test('>help lists every registered command', () => {
	const { ctx, calls } = makeContext();
	runCommanderCommand('>help', ctx);
	assert.equal(calls.length, 1);
	for (const command of COMMANDER_COMMANDS) {
		assert.ok(calls[0].payload.description.includes(command.usage), command.usage);
	}
});

test('matchCommanderCommands filters by prefix and shows all for a bare ">"', () => {
	assert.equal(matchCommanderCommands('nope').length, 0);
	assert.equal(matchCommanderCommands('>').length, COMMANDER_COMMANDS.length);
	const themeMatches = matchCommanderCommands('>the');
	assert.deepEqual(
		themeMatches.map((command) => command.name),
		['theme', 'themes']
	);
	// aliases match by prefix too — `commands` is an alias of `help`
	assert.deepEqual(
		matchCommanderCommands('>comm').map((command) => command.name),
		['help']
	);
});

test('a highlighted row only wins Enter while the command name is all that is typed', () => {
	// `>the` → rows [theme, themes]; the highlight is the user's actual choice
	assert.equal(commanderCommandEnterIndex({ hoveredSuggestion: 1, inputValue: '>the', matchCount: 2 }), 1);
	// row completion leaves a trailing space — still no argument, still the row
	assert.equal(commanderCommandEnterIndex({ hoveredSuggestion: 0, inputValue: '>theme ', matchCount: 2 }), 0);

	// …but arguments don't narrow the rows, so an older highlight would sit on
	// `>themes` and navigate there, silently dropping the typed preset
	assert.equal(commanderCommandEnterIndex({ hoveredSuggestion: 1, inputValue: '>theme Midnight', matchCount: 2 }), null);

	// nothing highlighted, or a highlight left past the end of a narrowed list
	assert.equal(commanderCommandEnterIndex({ hoveredSuggestion: null, inputValue: '>the', matchCount: 2 }), null);
	assert.equal(commanderCommandEnterIndex({ hoveredSuggestion: 5, inputValue: '>the', matchCount: 2 }), null);
	assert.equal(commanderCommandEnterIndex({ hoveredSuggestion: 0, inputValue: '>zzz', matchCount: 0 }), null);
});

// Every `>` command that navigates must land on a route the router actually
// declares. `>editor` shipped pointing at `/editor`, which has no route: it fell
// through to the `*` catch-all tree viewer while toasting success. A registry
// entry is one line, so this class of dead command is easy to reintroduce and
// invisible without a browser — pin it here instead.
test('every navigation target resolves to a declared route', () => {
	const routesSource = readFileSync(new URL('../../routes.tsx', import.meta.url), 'utf8');
	const declaredPaths = new Set(
		[...routesSource.matchAll(/path:\s*'([^']+)'/g)].flatMap((match) => match[1].split('/').filter(Boolean))
	);
	// the parse must find the router, not silently match nothing and pass
	assert.ok(declaredPaths.size > 10, `expected routes.tsx to declare many paths, parsed ${declaredPaths.size}`);

	const { ctx, calls } = makeContext();
	for (const command of COMMANDER_COMMANDS) {
		command.run('', ctx);
	}
	// argument-taking navigations reach their own subtrees
	for (const section of ['api', 'embed', 'concepts', 'schemas', 'design', 'design-system']) {
		runCommanderCommand(`>docs ${section}`, ctx);
	}

	const targets = calls.filter((call) => call.kind === 'navigate').map((call) => call.payload as string);
	assert.ok(targets.length > 0, 'expected the registry to navigate somewhere');
	for (const target of targets) {
		for (const segment of target.split('?')[0].split('/').filter(Boolean)) {
			assert.ok(declaredPaths.has(segment), `>command navigates to ${target}, but no route declares '${segment}'`);
		}
	}
});
