import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { COMMANDER_COMMANDS, matchCommanderCommands, parseCommanderCommand, runCommanderCommand } from './commanderCommands.ts';

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
		['>editor', '/editor'],
		['>edit', '/editor'],
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
	assert.deepEqual(matchCommanderCommands('>edit').map((command) => command.name), ['editor']);
});
