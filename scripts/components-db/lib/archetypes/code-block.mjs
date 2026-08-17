// Code-block archetype — code presentation in five renditions: an inline
// <code> chip inside a sentence, a highlighted <pre> block with a header bar,
// a dark terminal window, a diff viewer, and a keyboard-shortcut list.
// Follows the button.mjs exemplar: exactly 5 variants, `build(lib)` returns
// exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-code-block-<variant>`.

import {
	booleanArg,
	define,
	el,
	iff,
	merge,
	row,
	stack,
	stringArg,
	text
} from '../helpers.mjs';

// Two-rect copy glyph (clipboard-ish) — no external assets, allowlisted svg only.
const copyIcon = (size, color) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: color,
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		el('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
		el('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
	);

// Fake-syntax span painters: keyword / string / comment colors from the
// library palette so every rendition highlights in its own accent language.
const kw = (lib, value) => el('span', { style: { color: lib.palette.info.solid } }, value);
const st = (lib, value) => el('span', { style: { color: lib.palette.success.onSoft } }, value);
const cm = (lib, value) => el('span', { style: { color: lib.muted, fontStyle: 'italic' } }, value);

// Inline code chips lean on each library's accent personality: React Flow
// flashes its signature pink, Thingtime winks with its info pink, everyone
// else keeps quiet text on the surfaceAlt wash.
const inlineCodeColor = (lib) =>
	lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.text;

// Terminal chrome: darkened per library — React Flow reuses its ink-navy
// node border, Thingtime its house ink, the rest a tokyo-night charcoal.
const terminalBg = (lib) => (lib.id === 'reactflow' ? lib.border : lib.id === 'thingtime' ? lib.ink : '#1a1b26');
const promptColor = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.palette.success.solid);

const windowDot = (color) =>
	el('span', { style: { width: '10px', height: '10px', borderRadius: '999px', background: color, flexShrink: 0 } });

// kbd-style key chip; untitled wears its feather shadow, daisyUI's chunky
// radius token keeps its corners friendly on its own.
const keyChip = (lib, label) =>
	el(
		'span',
		{
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				minWidth: '20px',
				height: '22px',
				padding: '0 5px',
				boxSizing: 'border-box',
				fontFamily: lib.fontMono,
				fontSize: lib.fontSize.xs,
				color: lib.muted,
				background: lib.surfaceAlt,
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: lib.border,
				borderBottomWidth: '2px',
				borderRadius: lib.radius.xs,
				...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {})
			}
		},
		label
	);

const spacer = () => el('span', { style: { flex: 1 } });

const shortcutRow = (lib, first, action, keys) =>
	row(
		{
			padding: '10px 14px',
			gap: '12px',
			...(first ? {} : { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft })
		},
		text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text }, action),
		spacer(),
		row({ gap: '4px' }, ...keys.map((label) => keyChip(lib, label)))
	);

const diffLine = (lib, palette, value) =>
	el('div', { style: { padding: '2px 12px', background: palette.soft, color: palette.onSoft } }, value);

export const archetype = {
	id: 'code-block',
	category: 'data-display',
	variants: ['inline', 'block', 'terminal', 'diff', 'shortcuts'],
	build(lib) {
		const inline = define({
			slug: `${lib.id}-code-block-inline`,
			name: 'Inline Code',
			library: lib.id,
			category: 'data-display',
			description: `Sentence with an inline code chip in the ${lib.label} style — monospace snippet on the library's surface wash with its tightest corner radius.`,
			tags: ['code', 'inline', 'snippet', 'monospace'],
			args: [
				stringArg('before', 'Run', { label: 'Text before', maxLength: 60 }),
				stringArg('code', 'npm run dev', { label: 'Code', maxLength: 40 }),
				stringArg('after', 'to start the local server.', { label: 'Text after', maxLength: 60 }),
				booleanArg('bordered', true, { label: 'Bordered chip' })
			],
			render: el(
				'span',
				{ style: { fontFamily: lib.font, fontSize: lib.fontSize.md, color: lib.text, lineHeight: 1.7 } },
				'{before} ',
				el(
					'code',
					{
						style: merge(
							{
								fontFamily: lib.fontMono,
								fontSize: lib.fontSize.sm,
								color: inlineCodeColor(lib),
								background: lib.surfaceAlt,
								padding: '2px 6px',
								borderRadius: lib.radius.xs
							},
							iff('bordered', { borderWidth: '1px', borderStyle: 'solid', borderColor: lib.border }, {})
						)
					},
					'{code}'
				),
				' {after}'
			)
		});

		const block = define({
			slug: `${lib.id}-code-block-block`,
			name: 'Code Block',
			library: lib.id,
			category: 'data-display',
			description: `Highlighted code block in the ${lib.label} style — filename header bar with a copy glyph, line-number gutter, and fake syntax colors drawn from the library palette${lib.id === 'thingtime' ? ', capped with the house rainbow strip' : ''}.`,
			tags: ['code', 'block', 'syntax', 'snippet'],
			args: [
				stringArg('filename', 'app.ts', { label: 'Filename', maxLength: 40 }),
				stringArg('copyLabel', 'Copy', { label: 'Copy label', maxLength: 16 }),
				booleanArg('lineNumbers', true, { label: 'Line numbers' })
			],
			render: stack(
				{
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.radius.md,
					overflow: 'hidden',
					background: lib.surface,
					fontFamily: lib.fontMono,
					fontSize: lib.fontSize.sm,
					...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {})
				},
				lib.id === 'thingtime' ? el('div', { style: { height: '3px', background: lib.rainbow } }) : null,
				row(
					{
						padding: '8px 12px',
						gap: '8px',
						background: lib.surfaceAlt,
						borderBottomWidth: '1px',
						borderBottomStyle: 'solid',
						borderBottomColor: lib.borderSoft
					},
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.text }, '{filename}'),
					spacer(),
					row(
						{
							gap: '5px',
							color: lib.muted,
							fontSize: lib.fontSize.xs,
							fontFamily: lib.font,
							...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
						},
						copyIcon(12, 'currentColor'),
						'{copyLabel}'
					)
				),
				el(
					'pre',
					{ style: { margin: 0, padding: '12px 14px', display: 'flex', gap: '14px', overflowX: 'auto', lineHeight: 1.7 } },
					iff(
						'lineNumbers',
						stack({ color: lib.faint, textAlign: 'right', flexShrink: 0 }, ...['1', '2', '3', '4', '5'].map((n) => el('span', undefined, n)))
					),
					stack(
						{ color: lib.text },
						el('div', undefined, kw(lib, 'import'), ' { api } ', kw(lib, 'from'), st(lib, " './client'")),
						el('div', undefined, cm(lib, '// fetch the latest things')),
						el('div', undefined, kw(lib, 'const'), ' res = ', kw(lib, 'await'), ' api.get(', st(lib, "'/things'"), ')'),
						el('div', undefined, kw(lib, 'const'), ' names = res.map((t) => t.name)'),
						el('div', undefined, kw(lib, 'export'), ' ', kw(lib, 'default'), ' names')
					)
				)
			)
		});

		const terminal = define({
			slug: `${lib.id}-code-block-terminal`,
			name: 'Terminal Window',
			library: lib.id,
			category: 'data-display',
			description: `Dark terminal window in the ${lib.label} style — traffic-light window dots, prompt lines, and a muted output line${lib.id === 'reactflow' ? ' with the signature React Flow pink prompt' : ''} on the library's radius and shadow.`,
			tags: ['code', 'terminal', 'console', 'shell'],
			args: [
				stringArg('title', 'zsh', { label: 'Window title', maxLength: 30 }),
				stringArg('command', 'npm run dev', { label: 'Command', maxLength: 60 }),
				stringArg('output', 'ready in 320 ms', { label: 'Output line', maxLength: 60 })
			],
			render: stack(
				{
					background: terminalBg(lib),
					borderRadius: lib.radius.lg,
					overflow: 'hidden',
					boxShadow: lib.shadow.md,
					fontFamily: lib.fontMono,
					fontSize: lib.fontSize.sm,
					minWidth: '300px'
				},
				row(
					{ gap: '6px', padding: '10px 14px' },
					windowDot('#ff5f57'),
					windowDot('#febc2e'),
					windowDot('#28c840'),
					text({ marginLeft: '8px', color: 'rgba(255, 255, 255, 0.4)', fontSize: lib.fontSize.xs, fontFamily: lib.font }, '{title}')
				),
				stack(
					{ padding: '4px 16px 16px', gap: '8px', lineHeight: 1.5 },
					el(
						'div',
						undefined,
						el('span', { style: { color: promptColor(lib) } }, '$ '),
						el('span', { style: { color: lib.palette.primary.onSolid } }, '{command}')
					),
					el('div', { style: { color: 'rgba(255, 255, 255, 0.45)' } }, '{output}'),
					row(
						{ gap: '2px' },
						el('span', { style: { color: promptColor(lib) } }, '$ '),
						el('span', {
							style: {
								display: 'inline-block',
								width: '8px',
								height: '14px',
								background: 'rgba(255, 255, 255, 0.6)',
								borderRadius: '2px'
							}
						})
					)
				)
			)
		});

		const diff = define({
			slug: `${lib.id}-code-block-diff`,
			name: 'Diff Viewer',
			library: lib.id,
			category: 'data-display',
			description: `Diff viewer in the ${lib.label} style — hunk header plus removed and added lines washed in the library's danger and success tints, with +/− counters in the file bar.`,
			tags: ['code', 'diff', 'review', 'changes'],
			args: [
				stringArg('filename', 'src/utils/total.ts', { label: 'Filename', maxLength: 60 }),
				stringArg('removed', 'var total = items.length', { label: 'Removed line', maxLength: 60 }),
				stringArg('added', 'const total = items.reduce(sum, 0)', { label: 'Added line', maxLength: 60 })
			],
			render: stack(
				{
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
					overflow: 'hidden',
					background: lib.surface,
					fontFamily: lib.fontMono,
					fontSize: lib.fontSize.sm,
					...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {})
				},
				row(
					{
						padding: '8px 12px',
						gap: '8px',
						background: lib.surfaceAlt,
						borderBottomWidth: '1px',
						borderBottomStyle: 'solid',
						borderBottomColor: lib.borderSoft,
						fontFamily: lib.font
					},
					text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '{filename}'),
					spacer(),
					text({ fontSize: lib.fontSize.xs, fontWeight: 700, color: lib.palette.success.onSoft }, '+2'),
					text({ fontSize: lib.fontSize.xs, fontWeight: 700, color: lib.palette.danger.onSoft }, '−2')
				),
				stack(
					{ whiteSpace: 'pre', lineHeight: 1.7, padding: '6px 0', overflowX: 'auto' },
					el('div', { style: { padding: '2px 12px', background: lib.palette.info.soft, color: lib.palette.info.onSoft } }, '@@ -18,5 +18,5 @@'),
					diffLine(lib, lib.palette.danger, '- {removed}'),
					diffLine(lib, lib.palette.danger, "- console.log('total', total)"),
					diffLine(lib, lib.palette.success, '+ {added}'),
					diffLine(lib, lib.palette.success, '+ logger.debug(total)')
				)
			)
		});

		const shortcuts = define({
			slug: `${lib.id}-code-block-shortcuts`,
			name: 'Keyboard Shortcuts',
			library: lib.id,
			category: 'data-display',
			description: `Keyboard-shortcut list in the ${lib.label} style — action labels beside kbd-style bordered monospace key chips on the library's corner and border tokens.`,
			tags: ['code', 'keyboard', 'shortcuts', 'kbd'],
			args: [
				stringArg('title', 'Keyboard shortcuts', { label: 'Title', maxLength: 40 }),
				stringArg('action', 'Open command palette', { label: 'First action', maxLength: 40 }),
				stringArg('key1', '⌘', { label: 'First key', maxLength: 8 }),
				stringArg('key2', 'K', { label: 'Second key', maxLength: 8 })
			],
			render: stack(
				{
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.radius.md,
					overflow: 'hidden',
					background: lib.surface,
					fontFamily: lib.font,
					minWidth: '280px',
					...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {})
				},
				row(
					{
						padding: '10px 14px',
						background: lib.surfaceAlt,
						borderBottomWidth: '1px',
						borderBottomStyle: 'solid',
						borderBottomColor: lib.borderSoft
					},
					text({ fontSize: lib.fontSize.xs, fontWeight: lib.headingWeight, color: lib.muted }, '{title}')
				),
				shortcutRow(lib, true, '{action}', ['{key1}', '{key2}']),
				shortcutRow(lib, false, 'Search files', ['⌘', 'P']),
				shortcutRow(lib, false, 'Toggle theme', ['⌘', 'J']),
				shortcutRow(lib, false, 'Save changes', ['⌘', 'S'])
			)
		});

		return [inline, block, terminal, diff, shortcuts];
	}
};
