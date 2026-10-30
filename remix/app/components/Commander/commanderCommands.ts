// Commander `>` command registry (claude-todo/10 ⌨️ — "Commander `>` command
// registry"). Typed commands turn the omnipresent "Imagine.." input into a real
// palette: `>theme Midnight`, `>undo`, `>feed`, `>docs api`, … Every command
// confirms through Lopu (FUNDAMENTALS §7 — the only sanctioned notification
// path) and every future egg/tool gets a home here.
//
// Pure logic, DOM-free: side effects arrive via the context object so the
// registry is unit-testable in Node and CommanderV2 stays thin.

// The Lopu toast statuses (`useLopu`'s LopuStatus). Mirrored here rather than
// widened to `string`: a loose type let an invalid 'warning' status through,
// which the toast silently rendered as neutral.
export type CommanderLopuStatus = 'success' | 'error' | 'info';

export type CommanderCommandContext = {
	navigate: (to: string) => void;
	/** `useLopu()` — returns a toast id, which command handlers ignore. */
	lopu: (opts: { title: string; description?: string; status?: CommanderLopuStatus; duration?: number }) => unknown;
	/** Switch the builtin theme preset (useTtTheme().setPreset). */
	setThemePreset: (name: string) => void;
	/** Builtin preset names, for validation + discoverability. */
	builtinThemeNames: string[];
	/**
	 * Re-dispatch a key chord on window. `>undo`/`>redo` reuse the app-wide
	 * Cmd/Ctrl+Z listener instead of reaching into the provider's timeline ref.
	 */
	dispatchKeydown: (init: { key: string; metaKey?: boolean; shiftKey?: boolean }) => void;
};

export type CommanderCommand = {
	name: string;
	aliases?: string[];
	usage: string;
	description: string;
	run: (args: string, ctx: CommanderCommandContext) => void;
};

const navCommand = (name: string, to: string, description: string, emoji: string, aliases?: string[]): CommanderCommand => ({
	name,
	aliases,
	usage: `>${name}`,
	description,
	run: (_args, ctx) => {
		ctx.navigate(to);
		ctx.lopu({ title: `${emoji} ${description}`, status: 'success' });
	}
});

export const COMMANDER_COMMANDS: CommanderCommand[] = [
	{
		name: 'help',
		aliases: ['?', 'commands'],
		usage: '>help',
		description: 'List every Commander command',
		run: (_args, ctx) => {
			const lines = COMMANDER_COMMANDS.map((command) => `${command.usage} — ${command.description}`);
			ctx.lopu({ title: '⌨️ Commander commands', description: lines.join('\n'), status: 'info' });
		}
	},
	{
		name: 'theme',
		usage: '>theme <name>',
		description: 'Switch the theme preset',
		run: (args, ctx) => {
			const wanted = args.trim().toLowerCase();
			const match = wanted && ctx.builtinThemeNames.find((name) => name.toLowerCase() === wanted);
			if (!match) {
				ctx.lopu({
					title: wanted ? `🎨 No theme called “${args.trim()}”` : '🎨 Which theme?',
					description: `Try: ${ctx.builtinThemeNames.join(' · ')}`,
					status: wanted ? 'error' : 'info'
				});
				return;
			}
			ctx.setThemePreset(match);
			ctx.lopu({ title: `🎨 Theme: ${match}`, status: 'success' });
		}
	},
	{
		name: 'undo',
		usage: '>undo',
		description: 'Undo the last thingtime change',
		run: (_args, ctx) => {
			ctx.dispatchKeydown({ key: 'z', metaKey: true });
			ctx.lopu({ title: '↩️ Undone', status: 'success' });
		}
	},
	{
		name: 'redo',
		usage: '>redo',
		description: 'Redo the last undone change',
		run: (_args, ctx) => {
			ctx.dispatchKeydown({ key: 'z', metaKey: true, shiftKey: true });
			ctx.lopu({ title: '↪️ Redone', status: 'success' });
		}
	},
	{
		name: 'search',
		usage: '>search <query>',
		description: 'Search things',
		run: (args, ctx) => {
			const query = args.trim();
			ctx.navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
			ctx.lopu({ title: query ? `🔍 Searching “${query}”` : '🔍 Search things', status: 'success' });
		}
	},
	{
		name: 'docs',
		usage: '>docs [api|embed|concepts|schemas|design]',
		description: 'Open the docs (optionally a section)',
		run: (args, ctx) => {
			const section = args.trim().toLowerCase().split(/\s+/)[0];
			const known = ['api', 'embed', 'concepts', 'schemas', 'design', 'design-system'];
			const to = known.includes(section) ? `/docs/${section}` : '/docs';
			ctx.navigate(to);
			ctx.lopu({ title: `📚 Docs${known.includes(section) ? `: ${section}` : ''}`, status: 'success' });
		}
	},
	navCommand('feed', '/feed', 'Open the feed', '🌀'),
	navCommand('things', '/things', 'Open your things', '📦'),
	navCommand('lopu', '/lopu', 'Talk to Lopu', '🦄', ['ask', 'chat', 'ai']),
	// NOTE: no `>editor`. claude-todo/10 lists it as an example, but there is no
	// `/editor` route in routes.tsx — it fell through to the `*` catch-all tree
	// viewer at the empty Thingtime path `editor` while toasting "Open the
	// editor" as a success. Re-add this one line the day an editor page lands —
	// commanderCommands.test.ts checks every target against routes.tsx.
	navCommand('themes', '/themes', 'Open the Theme Studio', '🎨'),
	navCommand('settings', '/settings', 'Open settings', '⚙️'),
	navCommand('profile', '/profile', 'Open your profile', '🌈'),
	navCommand('schemas', '/schemas', 'Browse schemas', '💎')
];

export type ParsedCommanderCommand = {
	command: CommanderCommand;
	args: string;
};

/**
 * Parse a Commander input into a registry command. Returns null unless the
 * input starts with `>` (nothing else is ever treated as a command), and
 * `{ command: null }`-like undefined command when the name is unknown so the
 * caller can toast instead of falling through to the path/setter machinery.
 */
export const parseCommanderCommand = (input: string): { name: string; args: string; command: CommanderCommand | null } | null => {
	const trimmed = (input || '').trim();
	if (!trimmed.startsWith('>')) return null;

	const body = trimmed.slice(1).trim();
	const [name = '', ...rest] = body.split(/\s+/);
	const lowered = name.toLowerCase();
	const command =
		COMMANDER_COMMANDS.find((candidate) => candidate.name === lowered || candidate.aliases?.includes(lowered)) || null;

	return { name: lowered, args: rest.join(' '), command };
};

/** Commands whose usage matches a `>`-prefixed input, for suggestion rows. */
export const matchCommanderCommands = (input: string): CommanderCommand[] => {
	const parsed = parseCommanderCommand(input);
	if (!parsed) return [];
	if (!parsed.name) return COMMANDER_COMMANDS;
	return COMMANDER_COMMANDS.filter(
		(candidate) => candidate.name.startsWith(parsed.name) || candidate.aliases?.some((alias) => alias.startsWith(parsed.name))
	);
};

/**
 * Which dropdown row Enter should run in `>` mode, or null to run the raw
 * input — the command-mode twin of `commanderEnterSuggestionIndex`.
 *
 * Rows complete the command NAME, so a highlight only means anything while the
 * name is all that has been typed. `>theme Midnight` filters to the same two
 * rows as `>theme` (the args don't narrow the list), so a highlight left on
 * `>themes` would otherwise still win and Enter would navigate to /themes,
 * silently dropping a fully-typed command. Once there are arguments, the typed
 * input is unambiguous — run that.
 */
export const commanderCommandEnterIndex = (input: {
	hoveredSuggestion: number | null;
	inputValue: string;
	matchCount: number;
}): number | null => {
	if (typeof input.hoveredSuggestion !== 'number') return null;
	if (input.hoveredSuggestion < 0 || input.hoveredSuggestion >= input.matchCount) return null;
	if (parseCommanderCommand(input.inputValue)?.args) return null;
	return input.hoveredSuggestion;
};

/**
 * Run a `>` command. Returns true when the input was a `>` command (whether or
 * not it named a real one) so the caller stops there; unknown names toast a
 * pointer to `>help`.
 */
export const runCommanderCommand = (input: string, ctx: CommanderCommandContext): boolean => {
	const parsed = parseCommanderCommand(input);
	if (!parsed) return false;

	if (!parsed.command) {
		ctx.lopu({
			title: parsed.name ? `🤷‍♂️ Unknown command “>${parsed.name}”` : '⌨️ Type a command',
			description: 'Try >help for the list',
			status: 'error'
		});
		return true;
	}

	parsed.command.run(parsed.args, ctx);
	return true;
};
