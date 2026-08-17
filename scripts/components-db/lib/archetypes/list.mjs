// List archetype — ul/ol data-display lists rendered in each library's skin.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-list-<variant>`.

import {
	avatarCircle,
	booleanArg,
	define,
	div,
	el,
	enumArg,
	icons,
	ifEq,
	iff,
	map,
	merge,
	numberArg,
	repeat,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// React Flow gets its dotted-canvas personality via dashed separators; every
// other library keeps its quiet hairline.
const separator = (lib) => (lib.id === 'reactflow' ? `1px dashed ${lib.borderSoft}` : `1px solid ${lib.borderSoft}`);

const shell = (lib) => ({
	listStyle: 'none',
	margin: 0,
	padding: 0,
	width: '280px',
	fontFamily: lib.font,
	color: lib.text,
	background: lib.surface,
	borderRadius: lib.radius.md,
	overflow: 'hidden'
});

const framed = (lib) => ({
	border: `1px solid ${lib.border}`,
	boxShadow: lib.shadow.sm
});

const rowStyle = (lib) => ({
	display: 'flex',
	alignItems: 'center',
	gap: '12px',
	padding: '10px 14px',
	fontSize: lib.fontSize.md
});

// Divider on every row but the first (n is the 1-based ttRepeat counter).
const dividerIf = (lib) => ifEq('n', 1, {}, { borderTop: separator(lib) });

export const archetype = {
	id: 'list',
	category: 'data-display',
	variants: ['simple', 'avatar', 'two-line', 'actions', 'numbered'],
	build(lib) {
		const simple = define({
			slug: `${lib.id}-list-simple`,
			name: 'Simple List',
			library: lib.id,
			category: 'data-display',
			description: `Plain text list rows in the ${lib.label} style — ${lib.id === 'reactflow' ? 'dashed' : 'hairline'} separators, library-native type, with toggleable dividers and outer border.`,
			tags: ['list', 'rows', 'text', 'data'],
			args: [
				stringArg('item', 'List item', { label: 'Item label', maxLength: 40 }),
				numberArg('count', 4, { label: 'Rows', min: 1, max: 8 }),
				booleanArg('divided', true, { label: 'Dividers' }),
				booleanArg('bordered', true, { label: 'Border' })
			],
			render: el(
				'ul',
				{ style: merge(shell(lib), iff('bordered', framed(lib), {})) },
				repeat('count', 8, el('li', { style: merge(rowStyle(lib), iff('divided', dividerIf(lib), {})) }, '{item} {n}'))
			)
		});

		const avatar = define({
			slug: `${lib.id}-list-avatar`,
			name: 'Avatar List',
			library: lib.id,
			category: 'data-display',
			description: `Avatar-and-name list rows in the ${lib.label} style — tone-tinted initials circles beside names, a faint recency mark trailing each row.`,
			tags: ['list', 'avatar', 'people', 'data'],
			args: [
				stringArg('name', 'Alex Rivers', { label: 'Name', maxLength: 40 }),
				stringArg('initials', 'AR', { label: 'Initials', maxLength: 3 }),
				toneArg(),
				numberArg('count', 3, { label: 'Rows', min: 1, max: 6 })
			],
			render: el(
				'ul',
				{ style: merge(shell(lib), framed(lib)) },
				repeat(
					'count',
					6,
					el(
						'li',
						{ style: merge(rowStyle(lib), dividerIf(lib)) },
						avatarCircle('32px', toneMap(lib, (palette) => palette.soft), toneMap(lib, (palette) => palette.onSoft), '{initials}', lib.fontSize.xs),
						text({ fontWeight: 500, flexGrow: 1 }, '{name}'),
						text({ color: lib.faint, fontSize: lib.fontSize.xs }, '{n}h')
					)
				)
			)
		});

		const twoLine = define({
			slug: `${lib.id}-list-two-line`,
			name: 'Two-line List',
			library: lib.id,
			category: 'data-display',
			description: `Two-line list rows in the ${lib.label} style — a weighted title over a muted subtitle, with optional trailing chevrons for navigation.`,
			tags: ['list', 'two-line', 'subtitle', 'data'],
			args: [
				stringArg('title', 'Design review', { label: 'Title', maxLength: 40 }),
				stringArg('subtitle', 'Last updated', { label: 'Subtitle', maxLength: 60 }),
				numberArg('count', 3, { label: 'Rows', min: 1, max: 6 }),
				booleanArg('chevrons', true, { label: 'Chevrons' })
			],
			render: el(
				'ul',
				{ style: merge(shell(lib), framed(lib)) },
				repeat(
					'count',
					6,
					el(
						'li',
						{ style: merge(rowStyle(lib), dividerIf(lib)) },
						stack(
							{ gap: '2px', flexGrow: 1, minWidth: 0 },
							text({ fontWeight: lib.headingWeight, fontSize: lib.fontSize.md }, '{title}'),
							text({ color: lib.muted, fontSize: lib.fontSize.sm }, '{subtitle} · {n}h ago')
						),
						iff('chevrons', icons.chevronRight(16, lib.faint))
					)
				)
			)
		});

		const actions = define({
			slug: `${lib.id}-list-actions`,
			name: 'Actions List',
			library: lib.id,
			category: 'data-display',
			description: `List rows with a trailing action button in the ${lib.label} style — pick the row glyph (edit, trash, or overflow dots) and the tint it sits on.`,
			tags: ['list', 'actions', 'buttons', 'data'],
			args: [
				stringArg('item', 'Quarterly report', { label: 'Item label', maxLength: 40 }),
				numberArg('count', 3, { label: 'Rows', min: 1, max: 6 }),
				enumArg('action', ['edit', 'trash', 'dots'], 'edit', { label: 'Action' }),
				toneArg()
			],
			render: el(
				'ul',
				{ style: merge(shell(lib), framed(lib)) },
				repeat(
					'count',
					6,
					el(
						'li',
						{ style: merge(rowStyle(lib), dividerIf(lib)) },
						text({ flexGrow: 1, minWidth: 0 }, '{item} {n}'),
						el(
							'button',
							{
								type: 'button',
								style: {
									width: lib.control.sm,
									height: lib.control.sm,
									padding: 0,
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									border: 'none',
									borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
									background: toneMap(lib, (palette) => palette.soft),
									color: toneMap(lib, (palette) => palette.onSoft),
									cursor: 'pointer',
									flexShrink: 0
								}
							},
							map(
								'action',
								{
									edit: icons.edit(15, 'currentColor'),
									trash: icons.trash(15, 'currentColor'),
									dots: icons.dots(15, 'currentColor')
								},
								icons.edit(15, 'currentColor')
							)
						)
					)
				)
			)
		});

		const numberedChipRadius = lib.id === 'reactflow' ? lib.radius.xs : lib.id === 'daisyui' ? lib.radius.md : lib.radius.pill;
		const numbered = define({
			slug: `${lib.id}-list-numbered`,
			name: 'Numbered List',
			library: lib.id,
			category: 'data-display',
			description: `Ordered list in the ${lib.label} style — hand-styled number markers (${lib.id === 'reactflow' ? 'square mono chips' : lib.id === 'daisyui' ? 'chunky rounded chips' : 'pill chips'}) on a tone tint beside each row.`,
			tags: ['list', 'numbered', 'ordered', 'steps'],
			args: [
				stringArg('item', 'Step', { label: 'Item label', maxLength: 40 }),
				numberArg('count', 4, { label: 'Rows', min: 1, max: 8 }),
				toneArg(),
				booleanArg('divided', true, { label: 'Dividers' })
			],
			render: el(
				'ol',
				{ style: merge(shell(lib), framed(lib)) },
				repeat(
					'count',
					8,
					el(
						'li',
						{ style: merge(rowStyle(lib), iff('divided', dividerIf(lib), {})) },
						div(
							{
								width: '24px',
								height: '24px',
								borderRadius: numberedChipRadius,
								background: toneMap(lib, (palette) => palette.soft),
								color: toneMap(lib, (palette) => palette.onSoft),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontSize: lib.fontSize.xs,
								fontWeight: 700,
								fontFamily: lib.id === 'reactflow' ? lib.fontMono : lib.font,
								flexShrink: 0
							},
							'{n}'
						),
						'{item} {n}'
					)
				)
			)
		});

		return [simple, avatar, twoLine, actions, numbered];
	}
};
