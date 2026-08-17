// Select-menu archetype — closed trigger with chevron, open state with menu
// list (hovered + selected rows), multi-select with tag chips, combobox with
// search + filtered list, and option groups with headers. Follows the
// button.mjs exemplar: exactly 5 variants, build(lib) returns 5 definitions
// in variant order, slugs `${lib.id}-select-menu-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	ifEq,
	iff,
	map,
	merge,
	numberArg,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

const fieldRadius = (lib) => (lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm);

const labelStyle = (lib) => ({
	fontFamily: lib.font,
	fontSize: lib.fontSize.sm,
	fontWeight: lib.headingWeight,
	color: lib.text
});

const triggerBase = (lib) => ({
	height: lib.control.md,
	padding: '0 12px',
	borderRadius: fieldRadius(lib),
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	background: lib.surface,
	fontFamily: lib.font,
	fontSize: lib.fontSize.md,
	color: lib.text,
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: '8px',
	cursor: 'pointer',
	boxSizing: 'border-box',
	boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
});

// antd/bootstrap menus are flush edge-to-edge lists; the rest pad the panel
// and round each option row.
const paddedMenu = (lib) => !['antd', 'bootstrap'].includes(lib.id);

const menuPanel = (lib) => ({
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft,
	borderRadius: lib.radius.md,
	boxShadow: lib.shadow.lg,
	padding: paddedMenu(lib) ? '4px' : '4px 0',
	display: 'flex',
	flexDirection: 'column',
	marginTop: '6px'
});

const optionBase = (lib) => ({
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: '8px',
	padding: '7px 10px',
	borderRadius: paddedMenu(lib) ? lib.radius.xs : '0',
	fontFamily: lib.font,
	fontSize: lib.fontSize.md,
	color: lib.text,
	cursor: 'pointer'
});

// One row of the open-select menu: hovered index tints the row, selected
// index bolds the label and draws a primary check.
const openOption = (lib, index, labelToken) =>
	el(
		'div',
		{
			style: merge(
				optionBase(lib),
				ifEq('hovered', index, { background: lib.surfaceAlt }, {}),
				ifEq('selected', index, { fontWeight: 600 }, {})
			)
		},
		el('span', undefined, labelToken),
		ifEq('selected', index, icons.check(14, lib.palette.primary.solid))
	);

// One row of the combobox result list: the active index gets the primary wash.
const comboOption = (lib, index, labelToken) =>
	el(
		'div',
		{
			style: merge(
				optionBase(lib),
				ifEq(
					'active',
					index,
					{ background: lib.palette.primary.soft, color: lib.palette.primary.onSoft },
					{}
				)
			)
		},
		el('span', undefined, labelToken)
	);

const groupHeader = (lib, token) =>
	text(
		{
			fontFamily: lib.font,
			fontSize: lib.fontSize.xs,
			fontWeight: lib.headingWeight,
			color: lib.muted,
			padding: '6px 10px 2px',
			...(lib.id === 'untitled' || lib.id === 'bootstrap'
				? { textTransform: 'uppercase', letterSpacing: '0.04em' }
				: {})
		},
		token
	);

const groupItem = (lib, token, selected) =>
	el(
		'div',
		{
			style: merge(optionBase(lib), selected ? { fontWeight: 600 } : {})
		},
		el('span', undefined, token),
		selected ? icons.check(14, lib.palette.primary.solid) : false
	);

export const archetype = {
	id: 'select-menu',
	category: 'forms',
	variants: ['closed', 'open', 'multi', 'combobox', 'grouped'],
	build(lib) {
		const closed = define({
			slug: `${lib.id}-select-menu-closed`,
			name: 'Select Input',
			library: lib.id,
			category: 'forms',
			description: `Closed select trigger in the ${lib.label} style — labeled field with the chosen value on the left and a muted chevron on the right, in three control sizes.`,
			tags: ['form', 'select', 'dropdown', 'trigger'],
			args: [
				stringArg('label', 'Country', { label: 'Label', maxLength: 40 }),
				stringArg('value', 'Australia', { label: 'Value', maxLength: 40 }),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
				booleanArg('disabled', false, { label: 'Disabled' })
			],
			render: stack(
				{ gap: '6px', width: '260px' },
				text(labelStyle(lib), '{label}'),
				el(
					'div',
					{
						style: merge(
							triggerBase(lib),
							map(
								'size',
								{
									sm: { height: lib.control.sm, fontSize: lib.fontSize.sm },
									md: { height: lib.control.md, fontSize: lib.fontSize.md },
									lg: { height: lib.control.lg, fontSize: lib.fontSize.lg }
								},
								{ height: lib.control.md, fontSize: lib.fontSize.md }
							),
							iff('disabled', { background: lib.surfaceAlt, color: lib.faint, cursor: 'not-allowed' }, {})
						)
					},
					el('span', undefined, '{value}'),
					icons.chevronDown(16, lib.muted)
				)
			)
		});

		const open = define({
			slug: `${lib.id}-select-menu-open`,
			name: 'Open Select',
			library: lib.id,
			category: 'forms',
			description: `Select in its open state in the ${lib.label} style — trigger above a floating menu panel where one row shows the hover tint and the selected row earns a primary check.`,
			tags: ['form', 'select', 'menu', 'open'],
			args: [
				stringArg('optionA', 'Apple', { label: 'Option A', maxLength: 30 }),
				stringArg('optionB', 'Banana', { label: 'Option B', maxLength: 30 }),
				stringArg('optionC', 'Cherry', { label: 'Option C', maxLength: 30 }),
				enumArg('selected', ['1', '2', '3'], '1', { label: 'Selected option' }),
				enumArg('hovered', ['1', '2', '3'], '2', { label: 'Hovered option' })
			],
			render: stack(
				{ width: '260px' },
				el(
					'div',
					{ style: merge(triggerBase(lib), { borderColor: lib.palette.primary.border }) },
					el(
						'span',
						undefined,
						map('selected', { 1: '{optionA}', 2: '{optionB}', 3: '{optionC}' }, '{optionA}')
					),
					icons.chevronDown(16, lib.muted)
				),
				el(
					'div',
					{ style: menuPanel(lib) },
					openOption(lib, '1', '{optionA}'),
					openOption(lib, '2', '{optionB}'),
					openOption(lib, '3', '{optionC}')
				)
			)
		});

		const chip = (lib2, children) =>
			el(
				'div',
				{
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						gap: '4px',
						height: '22px',
						padding: '0 8px',
						borderRadius: ['antd', 'reactflow'].includes(lib2.id) ? lib2.radius.xs : lib2.radius.pill,
						background: toneMap(lib2, (palette) => palette.soft),
						color: toneMap(lib2, (palette) => palette.onSoft),
						fontFamily: lib2.font,
						fontSize: lib2.fontSize.xs,
						fontWeight: 500
					}
				},
				...children
			);

		const multi = define({
			slug: `${lib.id}-select-menu-multi`,
			name: 'Multi Select',
			library: lib.id,
			category: 'forms',
			description: `Multi-select field in the ${lib.label} style — chosen values sit inside the field as removable tone-tinted tag chips, with an overflow "+n" chip and trailing chevron.`,
			tags: ['form', 'select', 'multi', 'tags', 'chips'],
			args: [
				stringArg('label', 'Teams', { label: 'Label', maxLength: 40 }),
				stringArg('tagA', 'Design', { label: 'First tag', maxLength: 24 }),
				stringArg('tagB', 'Platform', { label: 'Second tag', maxLength: 24 }),
				numberArg('moreCount', 2, { label: 'Overflow count', min: 0, max: 99 }),
				toneArg()
			],
			render: stack(
				{ gap: '6px', width: '280px' },
				text(labelStyle(lib), '{label}'),
				el(
					'div',
					{
						style: merge(triggerBase(lib), {
							height: 'auto',
							minHeight: lib.control.md,
							padding: '5px 12px 5px 6px',
							justifyContent: 'flex-start',
							flexWrap: 'wrap',
							gap: '5px'
						})
					},
					chip(lib, [el('span', undefined, '{tagA}'), icons.x(11, 'currentColor')]),
					chip(lib, [el('span', undefined, '{tagB}'), icons.x(11, 'currentColor')]),
					iff('moreCount', chip(lib, [el('span', undefined, '+{moreCount}')])),
					el(
						'div',
						{ style: { marginLeft: 'auto', display: 'flex', alignItems: 'center' } },
						icons.chevronDown(16, lib.muted)
					)
				)
			)
		});

		const combobox = define({
			slug: `${lib.id}-select-menu-combobox`,
			name: 'Combobox',
			library: lib.id,
			category: 'forms',
			description: `Type-ahead combobox in the ${lib.label} style — search icon, typed query with a live caret bar, and a filtered result list whose active row wears the primary wash.`,
			tags: ['form', 'combobox', 'search', 'autocomplete'],
			args: [
				stringArg('query', 'Gre', { label: 'Query', maxLength: 30 }),
				stringArg('resultA', 'Green', { label: 'Result A', maxLength: 30 }),
				stringArg('resultB', 'Greenhouse', { label: 'Result B', maxLength: 30 }),
				stringArg('resultC', 'Grenadine', { label: 'Result C', maxLength: 30 }),
				enumArg('active', ['1', '2', '3'], '1', { label: 'Active result' })
			],
			render: stack(
				{ width: '260px' },
				el(
					'div',
					{
						style: merge(triggerBase(lib), {
							justifyContent: 'flex-start',
							boxShadow: lib.focusRing
						})
					},
					icons.search(15, lib.muted),
					el('span', undefined, '{query}'),
					el('div', {
						style: {
							width: '1.5px',
							height: '14px',
							background: lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid
						}
					})
				),
				el(
					'div',
					{ style: menuPanel(lib) },
					comboOption(lib, '1', '{resultA}'),
					comboOption(lib, '2', '{resultB}'),
					comboOption(lib, '3', '{resultC}')
				)
			)
		});

		const flushDivider = ['antd', 'bootstrap', 'mui'].includes(lib.id);

		const grouped = define({
			slug: `${lib.id}-select-menu-grouped`,
			name: 'Grouped Select',
			library: lib.id,
			category: 'forms',
			description: `Open select panel with option groups in the ${lib.label} style — muted group headers over their options${flushDivider ? ', separated by a hairline divider' : ''}, first option showing the selected check.`,
			tags: ['form', 'select', 'groups', 'menu'],
			args: [
				stringArg('groupA', 'Fruits', { label: 'First group', maxLength: 30 }),
				stringArg('itemA1', 'Apple', { label: 'Group A item 1', maxLength: 30 }),
				stringArg('itemA2', 'Banana', { label: 'Group A item 2', maxLength: 30 }),
				stringArg('groupB', 'Vegetables', { label: 'Second group', maxLength: 30 }),
				stringArg('itemB1', 'Carrot', { label: 'Group B item 1', maxLength: 30 }),
				stringArg('itemB2', 'Kale', { label: 'Group B item 2', maxLength: 30 })
			],
			render: el(
				'div',
				{ style: { ...menuPanel(lib), marginTop: '0', width: '240px', boxSizing: 'border-box' } },
				groupHeader(lib, '{groupA}'),
				groupItem(lib, '{itemA1}', true),
				groupItem(lib, '{itemA2}', false),
				flushDivider
					? el('div', { style: { height: '1px', background: lib.borderSoft, margin: '4px 0' } })
					: false,
				groupHeader(lib, '{groupB}'),
				groupItem(lib, '{itemB1}', false),
				groupItem(lib, '{itemB2}', false)
			)
		});

		return [closed, open, multi, combobox, grouped];
	}
};
