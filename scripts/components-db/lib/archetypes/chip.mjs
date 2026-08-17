// Chip archetype — tags/chips in five renditions: plain, closable with an x
// glyph, leading icon, selected/checked state, and a row of chips inside an
// input-style group. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-chip-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	map,
	merge,
	stringArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// antd tags keep tight 4px corners and reactflow chrome stays crisp; the rest
// (mui chips especially) wear the classic pill.
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);

const baseChip = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '6px',
	height: lib.control.sm,
	padding: '0 12px',
	borderRadius: chipRadius(lib),
	fontFamily: lib.font,
	fontWeight: 500,
	fontSize: lib.fontSize.sm
});

const softLook = (lib) => ({
	background: toneMap(lib, (palette) => palette.soft),
	color: toneMap(lib, (palette) => palette.onSoft),
	...(lib.id === 'antd'
		? { borderWidth: '1px', borderStyle: 'solid', borderColor: toneMap(lib, (palette) => palette.border) }
		: {})
});

const solidLook = (lib) => ({
	background: toneMap(lib, (palette) => palette.solid),
	color: toneMap(lib, (palette) => palette.onSolid)
});

export const archetype = {
	id: 'chip',
	category: 'data-display',
	variants: ['basic', 'closable', 'icon', 'selected', 'input-group'],
	build(lib) {
		const basic = define({
			slug: `${lib.id}-chip-basic`,
			name: 'Basic Chip',
			library: lib.id,
			category: 'data-display',
			description: `Plain tag chip in the ${lib.label} style — a soft tone wash by default with a filled toggle, on the library's native chip corners.`,
			tags: ['chip', 'tag', 'label'],
			args: [
				stringArg('label', 'Design', { label: 'Label', maxLength: 24 }),
				toneArg(),
				booleanArg('filled', false, { label: 'Filled' })
			],
			render: el(
				'span',
				{ style: merge(baseChip(lib), iff('filled', solidLook(lib), softLook(lib))) },
				'{label}'
			)
		});

		const closable = define({
			slug: `${lib.id}-chip-closable`,
			name: 'Closable Chip',
			library: lib.id,
			category: 'data-display',
			description: `Removable tag chip in the ${lib.label} style — a soft tone chip with a trailing x glyph, dimming when disabled.`,
			tags: ['chip', 'tag', 'closable', 'removable'],
			args: [
				stringArg('label', 'Filter: recent', { label: 'Label', maxLength: 24 }),
				toneArg(),
				booleanArg('disabled', false, { label: 'Disabled' })
			],
			render: el(
				'span',
				{
					style: merge(baseChip(lib), softLook(lib), { cursor: 'pointer' }, iff('disabled', { opacity: 0.5, cursor: 'not-allowed' }, {}))
				},
				'{label}',
				icons.x(12, 'currentColor')
			)
		});

		const icon = define({
			slug: `${lib.id}-chip-icon`,
			name: 'Icon Chip',
			library: lib.id,
			category: 'data-display',
			description: `Tag chip with a leading glyph in the ${lib.label} style — pick a star, user, bell, or zap icon beside the label on a soft tone chip.`,
			tags: ['chip', 'tag', 'icon'],
			args: [
				stringArg('label', 'Starred', { label: 'Label', maxLength: 24 }),
				toneArg(),
				enumArg('icon', ['star', 'user', 'bell', 'zap'], 'star', { label: 'Icon' })
			],
			render: el(
				'span',
				{ style: merge(baseChip(lib), softLook(lib)) },
				map(
					'icon',
					{
						star: icons.star(12, 'currentColor'),
						user: icons.user(12, 'currentColor'),
						bell: icons.bell(12, 'currentColor'),
						zap: icons.zap(12, 'currentColor')
					},
					icons.star(12, 'currentColor')
				),
				'{label}'
			)
		});

		const selected = define({
			slug: `${lib.id}-chip-selected`,
			name: 'Selected Chip',
			library: lib.id,
			category: 'data-display',
			description: `Selectable filter chip in the ${lib.label} style — checked state fills with the tone and gains a check glyph; unchecked stays a quiet outline.`,
			tags: ['chip', 'filter', 'selected', 'toggle'],
			args: [
				stringArg('label', 'Popular', { label: 'Label', maxLength: 24 }),
				toneArg(),
				booleanArg('selected', true, { label: 'Selected' })
			],
			render: el(
				'span',
				{
					style: merge(
						baseChip(lib),
						{ borderWidth: '1px', borderStyle: 'solid', cursor: 'pointer' },
						iff(
							'selected',
							{
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								borderColor: toneMap(lib, (palette) => palette.solid)
							},
							{ background: lib.surface, color: lib.text, borderColor: lib.border }
						)
					)
				},
				iff('selected', icons.check(12, 'currentColor')),
				'{label}'
			)
		});

		const groupChip = (labelToken) =>
			el(
				'span',
				{ style: { ...baseChip(lib), ...softLook(lib), height: lib.control.sm, padding: '0 10px' } },
				labelToken,
				icons.x(12, 'currentColor')
			);

		const inputGroup = define({
			slug: `${lib.id}-chip-input-group`,
			name: 'Chip Input Group',
			library: lib.id,
			category: 'data-display',
			description: `A row of removable chips inside an input-style field in the ${lib.label} style — three tags with x glyphs plus a faint add-tag placeholder.`,
			tags: ['chip', 'tag', 'input', 'group'],
			args: [
				stringArg('tag1', 'Design', { label: 'Tag 1', maxLength: 24 }),
				stringArg('tag2', 'Engineering', { label: 'Tag 2', maxLength: 24 }),
				stringArg('tag3', 'Marketing', { label: 'Tag 3', maxLength: 24 }),
				stringArg('placeholder', 'Add tag…', { label: 'Placeholder', maxLength: 24 }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						flexWrap: 'wrap',
						gap: '6px',
						padding: '6px 10px',
						background: lib.surface,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.border,
						borderRadius: lib.radius.md,
						fontFamily: lib.font,
						boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
					}
				},
				groupChip('{tag1}'),
				groupChip('{tag2}'),
				groupChip('{tag3}'),
				el('span', { style: { color: lib.faint, fontSize: lib.fontSize.sm, padding: '0 4px' } }, '{placeholder}')
			)
		});

		return [basic, closable, icon, selected, inputGroup];
	}
};
