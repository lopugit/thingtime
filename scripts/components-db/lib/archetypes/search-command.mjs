// Search-command archetype — search interfaces in five renditions: a plain
// search bar, an autocomplete field with an open suggestions panel, a centered
// command palette, a filter bar with closable chips, and a navbar global
// search with a ⌘K hint. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-search-command-<variant>`.

import {
	booleanArg,
	define,
	div,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	merge,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Bordered field shell every variant's search input sits in. untitled wears
// its trademark feather shadow; reactflow's crisp near-black border comes
// straight from its border token.
const fieldShell = (lib, extra = {}) => ({
	display: 'flex',
	alignItems: 'center',
	gap: '8px',
	height: lib.control.md,
	padding: '0 12px',
	boxSizing: 'border-box',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.md,
	boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none',
	...extra
});

const bareInput = (lib, extra = {}) =>
	el('input', {
		type: 'text',
		placeholder: '{placeholder}',
		style: {
			border: 'none',
			outline: 'none',
			background: 'transparent',
			fontFamily: lib.font,
			fontSize: lib.fontSize.sm,
			color: lib.text,
			width: '140px',
			...extra
		}
	});

// Small keyboard-shortcut chip (span — `kbd` is not allowlisted).
const kbdChip = (lib, label, extra = {}) =>
	el(
		'span',
		{
			style: {
				fontFamily: lib.fontMono,
				fontSize: lib.fontSize.xs,
				color: lib.muted,
				background: lib.surfaceAlt,
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: lib.borderSoft,
				borderRadius: lib.radius.xs,
				padding: '1px 5px',
				lineHeight: 1.4,
				...extra
			}
		},
		label
	);

export const archetype = {
	id: 'search-command',
	category: 'forms',
	variants: ['search-bar', 'autocomplete', 'command-palette', 'filter-bar', 'global-search'],
	build(lib) {
		const searchBar = define({
			slug: `${lib.id}-search-command-search-bar`,
			name: 'Search Bar',
			library: lib.id,
			category: 'forms',
			description: `Search bar in the ${lib.label} style — bordered input with a leading magnifier glyph and editable placeholder beside a solid tone search button${lib.uppercaseButtons ? ' with the uppercase Material label' : ''}.`,
			tags: ['search', 'input', 'form', 'bar'],
			args: [
				stringArg('placeholder', 'Search anything…', { label: 'Placeholder', maxLength: 40 }),
				stringArg('buttonLabel', 'Search', { label: 'Button label', maxLength: 20 }),
				toneArg()
			],
			render: row(
				{ gap: '8px', fontFamily: lib.font },
				row(
					fieldShell(lib),
					icons.search(16, lib.muted),
					bareInput(lib)
				),
				el(
					'button',
					{
						type: 'button',
						style: merge(
							{
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								height: lib.control.md,
								padding: '0 16px',
								border: 'none',
								borderRadius: lib.radius.md,
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								fontWeight: lib.buttonWeight,
								cursor: 'pointer',
								boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
								...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
							},
							{
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid)
							}
						)
					},
					'{buttonLabel}'
				)
			)
		});

		// One suggestion row: bold tone-colored matched prefix + plain remainder.
		const suggestion = (suffix, hovered) =>
			row(
				{
					gap: '8px',
					padding: '7px 10px',
					borderRadius: lib.radius.sm,
					fontSize: lib.fontSize.sm,
					color: lib.text,
					background: hovered ? lib.surfaceAlt : 'transparent'
				},
				icons.search(13, lib.faint),
				el(
					'span',
					undefined,
					el('strong', { style: { fontWeight: 700, color: toneMap(lib, (palette) => palette.solid) } }, '{query}'),
					suffix
				)
			);

		const autocomplete = define({
			slug: `${lib.id}-search-command-autocomplete`,
			name: 'Autocomplete Search',
			library: lib.id,
			category: 'forms',
			description: `Autocomplete search in the ${lib.label} style — a typed query field above an open suggestions panel where each of four rows bolds the matched query prefix in the active tone, with the first row hovered.`,
			tags: ['search', 'autocomplete', 'suggestions', 'dropdown'],
			args: [
				stringArg('query', 'da', { label: 'Query', maxLength: 20 }),
				toneArg(),
				booleanArg('open', true, { label: 'Panel open' })
			],
			render: stack(
				{ gap: '6px', width: '250px', fontFamily: lib.font },
				row(
					fieldShell(lib),
					icons.search(16, lib.muted),
					text({ fontSize: lib.fontSize.sm, color: lib.text }, '{query}'),
					div({ width: '1px', height: '14px', background: lib.muted, flexShrink: 0 })
				),
				iff(
					'open',
					stack(
						{
							background: lib.surface,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.borderSoft,
							borderRadius: lib.radius.md,
							boxShadow: lib.shadow.md,
							padding: '4px'
						},
						suggestion(' dashboard', true),
						suggestion(' settings', false),
						suggestion(' reports', false),
						suggestion(' history', false)
					)
				)
			)
		});

		// One palette command row; the active row (matched by index) gains the
		// surfaceAlt wash and a tone accent bar on its left edge.
		const commandRow = (index, icon, label, keys) =>
			el(
				'div',
				{
					style: merge(
						{
							display: 'flex',
							alignItems: 'center',
							gap: '10px',
							padding: '8px 12px',
							fontSize: lib.fontSize.sm,
							color: lib.text,
							borderLeftWidth: '3px',
							borderLeftStyle: 'solid',
							borderLeftColor: 'transparent'
						},
						ifEq('active', index, {
							background: lib.surfaceAlt,
							borderLeftColor: toneMap(lib, (palette) => palette.solid)
						})
					)
				},
				icon(14, lib.muted),
				text({ flexGrow: 1 }, label),
				kbdChip(lib, '⌘'),
				kbdChip(lib, keys)
			);

		const commandPalette = define({
			slug: `${lib.id}-search-command-command-palette`,
			name: 'Command Palette',
			library: lib.id,
			category: 'forms',
			description: `Command palette in the ${lib.label} style — a centered elevated panel with a prompt row, a Suggestions group header, and four icon + shortcut command rows; the active row carries a tone accent bar${lib.id === 'thingtime' ? ' beneath a rainbow top strip' : ''}.`,
			tags: ['search', 'command-palette', 'keyboard', 'launcher'],
			args: [
				stringArg('placeholder', 'Type a command…', { label: 'Placeholder', maxLength: 40 }),
				toneArg(),
				enumArg('active', ['1', '2', '3', '4'], '1', { label: 'Active row' }),
				enumArg('prompt', ['search', 'chevron'], 'search', { label: 'Prompt glyph' })
			],
			previewBg: lib.bg,
			render: div(
				{ display: 'flex', justifyContent: 'center', fontFamily: lib.font },
				stack(
					{
						width: '280px',
						background: lib.surface,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.borderSoft,
						borderRadius: lib.radius.lg,
						boxShadow: lib.shadow.lg,
						overflow: 'hidden',
						paddingBottom: '6px'
					},
					lib.id === 'thingtime' ? div({ height: '3px', background: lib.rainbow }) : null,
					row(
						{ gap: '8px', padding: '10px 12px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: lib.borderSoft },
						ifEq(
							'prompt',
							'chevron',
							text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.md, fontWeight: 700, color: lib.faint }, '>'),
							icons.search(15, lib.faint)
						),
						text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{placeholder}')
					),
					text(
						{
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							color: lib.faint,
							textTransform: 'uppercase',
							letterSpacing: '0.05em',
							padding: '8px 12px 4px'
						},
						'Suggestions'
					),
					commandRow('1', icons.file, 'New file', 'N'),
					commandRow('2', icons.settings, 'Open settings', ','),
					commandRow('3', icons.user, 'Invite teammate', 'I'),
					commandRow('4', icons.zap, 'Run workflow', 'R')
				)
			)
		});

		// Closable tone-tinted filter chip (antd keeps its tight tag corners).
		const filterChip = (labelTemplate) =>
			row(
				{
					gap: '6px',
					padding: '4px 10px',
					background: toneMap(lib, (palette) => palette.soft),
					color: toneMap(lib, (palette) => palette.onSoft),
					borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
					fontSize: lib.fontSize.xs,
					fontWeight: 500
				},
				labelTemplate,
				icons.x(12, 'currentColor')
			);

		const filterBar = define({
			slug: `${lib.id}-search-command-filter-bar`,
			name: 'Filter Bar',
			library: lib.id,
			category: 'forms',
			description: `Filter bar in the ${lib.label} style — a compact search field beside closable tone-tinted filter chips and a quiet Clear all ghost link, for list and table toolbars.`,
			tags: ['search', 'filter', 'chips', 'toolbar'],
			args: [
				stringArg('placeholder', 'Filter tasks…', { label: 'Placeholder', maxLength: 40 }),
				stringArg('filterA', 'Status: Active', { label: 'Filter chip A', maxLength: 30 }),
				stringArg('filterB', 'Owner: Me', { label: 'Filter chip B', maxLength: 30 }),
				toneArg()
			],
			render: row(
				{ gap: '8px', flexWrap: 'wrap', fontFamily: lib.font },
				row(
					fieldShell(lib, { height: lib.control.sm, padding: '0 10px' }),
					icons.search(14, lib.muted),
					bareInput(lib, { width: '110px', fontSize: lib.fontSize.xs })
				),
				filterChip('{filterA}'),
				filterChip('{filterB}'),
				el(
					'button',
					{
						type: 'button',
						style: {
							border: 'none',
							background: 'transparent',
							color: lib.muted,
							fontFamily: lib.font,
							fontSize: lib.fontSize.xs,
							fontWeight: 500,
							cursor: 'pointer',
							padding: '0 4px'
						}
					},
					'Clear all'
				)
			)
		});

		const globalSearch = define({
			slug: `${lib.id}-search-command-global-search`,
			name: 'Global Search',
			library: lib.id,
			category: 'forms',
			description: `Global search in the ${lib.label} style — a navbar strip pairing a tone-dotted brand mark with a compact search field that tucks a keyboard shortcut hint chip against its right edge.`,
			tags: ['search', 'navbar', 'shortcut', 'kbd'],
			args: [
				stringArg('brand', 'Acme', { label: 'Brand', maxLength: 20 }),
				stringArg('placeholder', 'Search…', { label: 'Placeholder', maxLength: 30 }),
				stringArg('shortcut', '⌘K', { label: 'Shortcut hint', maxLength: 6 }),
				toneArg()
			],
			render: row(
				{
					justifyContent: 'space-between',
					gap: '16px',
					minWidth: '300px',
					padding: '8px 12px',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.borderSoft,
					borderRadius: lib.radius.md,
					boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none',
					fontFamily: lib.font
				},
				row(
					{ gap: '8px' },
					div({
						width: '10px',
						height: '10px',
						borderRadius: '999px',
						background: toneMap(lib, (palette) => palette.solid),
						flexShrink: 0
					}),
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{brand}')
				),
				row(
					{
						gap: '8px',
						height: lib.control.sm,
						padding: '0 6px 0 10px',
						boxSizing: 'border-box',
						background: lib.surfaceAlt,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.borderSoft,
						borderRadius: lib.id === 'daisyui' || lib.id === 'thingtime' ? lib.radius.pill : lib.radius.sm,
						width: '170px'
					},
					icons.search(14, lib.faint),
					text({ flexGrow: 1, fontSize: lib.fontSize.sm, color: lib.muted }, '{placeholder}'),
					kbdChip(lib, '{shortcut}', { background: lib.surface, borderColor: lib.border })
				)
			)
		});

		return [searchBar, autocomplete, commandPalette, filterBar, globalSearch];
	}
};
