// Choice-controls archetype — checkbox, stacked checkbox group, radio group,
// on/off switch, and a segmented toggle-button group. Follows the button.mjs
// exemplar: exactly 5 variants, build(lib) returns 5 definitions in variant
// order, slugs `${lib.id}-choice-controls-<variant>`.

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
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

const optionLabel = (lib) => ({ fontFamily: lib.font, fontSize: lib.fontSize.md, color: lib.text });

const boxBase = (lib) => ({
	width: '18px',
	height: '18px',
	borderRadius: lib.radius.xs,
	borderWidth: '1px',
	borderStyle: 'solid',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	flexShrink: 0,
	boxSizing: 'border-box'
});

// One row of the (tone-free) checkbox group: primary-palette box + label.
const groupOption = (lib, labelToken, checkedArg) =>
	row(
		{ gap: '8px' },
		el(
			'div',
			{
				style: merge(
					boxBase(lib),
					iff(
						checkedArg,
						{ background: lib.palette.primary.solid, borderColor: lib.palette.primary.solid },
						{ background: lib.surface, borderColor: lib.border }
					)
				)
			},
			iff(checkedArg, icons.check(12, lib.palette.primary.onSolid))
		),
		text(optionLabel(lib), labelToken)
	);

// One row of the radio group: ring + dot appear on the matching selected index.
const radioOption = (lib, index, labelToken) =>
	row(
		{ gap: '8px' },
		el(
			'div',
			{
				style: merge(
					{
						width: '18px',
						height: '18px',
						borderRadius: lib.radius.pill,
						borderWidth: '1px',
						borderStyle: 'solid',
						background: lib.surface,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						flexShrink: 0,
						boxSizing: 'border-box'
					},
					ifEq(
						'selected',
						index,
						{ borderColor: toneMap(lib, (palette) => palette.solid) },
						{ borderColor: lib.border }
					)
				)
			},
			ifEq(
				'selected',
				index,
				el('div', {
					style: {
						width: '9px',
						height: '9px',
						borderRadius: lib.radius.pill,
						background: toneMap(lib, (palette) => palette.solid)
					}
				})
			)
		),
		text(optionLabel(lib), labelToken)
	);

// One segment of the toggle group; antd/bootstrap/mui/reactflow are joined
// outlined buttons, the rest a padded segmented-control container.
const segment = (lib, outlined, index, labelToken) =>
	el(
		'button',
		{
			type: 'button',
			style: merge(
				{
					height: outlined ? lib.control.md : lib.control.sm,
					padding: '0 14px',
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontFamily: lib.font,
					fontSize: lib.fontSize.sm,
					fontWeight: lib.buttonWeight,
					border: 'none',
					cursor: 'pointer',
					borderRadius: outlined ? '0' : lib.radius.xs,
					...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {}),
					...(outlined && index !== '1'
						? { borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: lib.border }
						: {})
				},
				outlined
					? ifEq(
							'active',
							index,
							{
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid)
							},
							{ background: lib.surface, color: lib.text }
						)
					: ifEq(
							'active',
							index,
							{
								background: lib.surface,
								color: toneMap(lib, (palette) => palette.onSoft),
								boxShadow: lib.shadow.sm
							},
							{ background: 'transparent', color: lib.muted }
						)
			)
		},
		labelToken
	);

export const archetype = {
	id: 'choice-controls',
	category: 'forms',
	variants: ['checkbox', 'checkbox-group', 'radio-group', 'switch', 'toggle-group'],
	build(lib) {
		const checkbox = define({
			slug: `${lib.id}-choice-controls-checkbox`,
			name: 'Checkbox',
			library: lib.id,
			category: 'forms',
			description: `Single checkbox with label in the ${lib.label} style — checking fills the box with the tone color and draws the check glyph at the library's corner radius.`,
			tags: ['form', 'checkbox', 'choice', 'toggle'],
			args: [
				stringArg('label', 'Email me product updates', { label: 'Label', maxLength: 50 }),
				booleanArg('checked', true, { label: 'Checked' }),
				toneArg(),
				booleanArg('disabled', false, { label: 'Disabled' })
			],
			render: row(
				{ gap: '8px', cursor: 'pointer', opacity: iff('disabled', 0.5, 1) },
				el(
					'div',
					{
						style: merge(
							boxBase(lib),
							iff(
								'checked',
								{
									background: toneMap(lib, (palette) => palette.solid),
									borderColor: toneMap(lib, (palette) => palette.solid)
								},
								{ background: lib.surface, borderColor: lib.border }
							)
						)
					},
					iff('checked', icons.check(12, toneMap(lib, (palette) => palette.onSolid)))
				),
				text(optionLabel(lib), '{label}')
			)
		});

		const checkboxGroup = define({
			slug: `${lib.id}-choice-controls-checkbox-group`,
			name: 'Checkbox Group',
			library: lib.id,
			category: 'forms',
			description: `Vertical stack of three labeled checkboxes in the ${lib.label} style — each row's label and checked state is its own arg, boxes fill with the primary color.`,
			tags: ['form', 'checkbox', 'group', 'choice'],
			args: [
				stringArg('labelA', 'Product updates', { label: 'Option A', maxLength: 40 }),
				booleanArg('checkedA', true, { label: 'A checked' }),
				stringArg('labelB', 'Weekly digest', { label: 'Option B', maxLength: 40 }),
				booleanArg('checkedB', true, { label: 'B checked' }),
				stringArg('labelC', 'Partner offers', { label: 'Option C', maxLength: 40 }),
				booleanArg('checkedC', false, { label: 'C checked' })
			],
			render: stack(
				{ gap: '10px' },
				groupOption(lib, '{labelA}', 'checkedA'),
				groupOption(lib, '{labelB}', 'checkedB'),
				groupOption(lib, '{labelC}', 'checkedC')
			)
		});

		const radioGroup = define({
			slug: `${lib.id}-choice-controls-radio-group`,
			name: 'Radio Group',
			library: lib.id,
			category: 'forms',
			description: `Three stacked radio options in the ${lib.label} style — the selected index gains a tone-colored ring and inner dot, the rest stay quiet library borders.`,
			tags: ['form', 'radio', 'group', 'choice'],
			args: [
				stringArg('labelA', 'Hobby', { label: 'Option A', maxLength: 40 }),
				stringArg('labelB', 'Pro', { label: 'Option B', maxLength: 40 }),
				stringArg('labelC', 'Team', { label: 'Option C', maxLength: 40 }),
				enumArg('selected', ['1', '2', '3'], '1', { label: 'Selected option' }),
				toneArg()
			],
			render: stack(
				{ gap: '10px' },
				radioOption(lib, '1', '{labelA}'),
				radioOption(lib, '2', '{labelB}'),
				radioOption(lib, '3', '{labelC}')
			)
		});

		const onTrack =
			lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid;

		const switchDef = define({
			slug: `${lib.id}-choice-controls-switch`,
			name: 'Switch',
			library: lib.id,
			category: 'forms',
			description: `On/off switch with label in the ${lib.label} style — the boolean slides the knob across the pill track${lib.id === 'thingtime' ? ', lighting the house rainbow when on' : lib.id === 'reactflow' ? ', lighting the React Flow pink accent when on' : ''}.`,
			tags: ['form', 'switch', 'toggle', 'boolean'],
			args: [
				stringArg('label', 'Enable notifications', { label: 'Label', maxLength: 50 }),
				booleanArg('on', true, { label: 'On' }),
				enumArg('size', ['sm', 'md'], 'md', { label: 'Size' }),
				booleanArg('disabled', false, { label: 'Disabled' })
			],
			render: row(
				{ gap: '10px', cursor: 'pointer', opacity: iff('disabled', 0.5, 1) },
				el(
					'div',
					{
						style: merge(
							map(
								'size',
								{
									sm: { width: '34px', height: '18px' },
									md: { width: '44px', height: '24px' }
								},
								{ width: '44px', height: '24px' }
							),
							{
								borderRadius: lib.radius.pill,
								padding: '2px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: iff('on', 'flex-end', 'flex-start'),
								background: iff('on', onTrack, lib.faint),
								flexShrink: 0,
								boxSizing: 'border-box'
							}
						)
					},
					el('div', {
						style: merge(
							map(
								'size',
								{
									sm: { width: '14px', height: '14px' },
									md: { width: '20px', height: '20px' }
								},
								{ width: '20px', height: '20px' }
							),
							{ borderRadius: lib.radius.pill, background: '#ffffff', boxShadow: lib.shadow.sm }
						)
					})
				),
				text(optionLabel(lib), '{label}')
			)
		});

		const outlined = ['antd', 'bootstrap', 'mui', 'reactflow'].includes(lib.id);

		const toggleGroup = define({
			slug: `${lib.id}-choice-controls-toggle-group`,
			name: 'Toggle Group',
			library: lib.id,
			category: 'forms',
			description: `Segmented toggle-button group in the ${lib.label} style — ${outlined ? 'joined outlined buttons where the active index fills with the tone color' : 'a padded rail where the active index lifts onto a shadowed surface chip'}.`,
			tags: ['form', 'toggle', 'segmented', 'group'],
			args: [
				stringArg('labelA', 'Day', { label: 'Segment A', maxLength: 20 }),
				stringArg('labelB', 'Week', { label: 'Segment B', maxLength: 20 }),
				stringArg('labelC', 'Month', { label: 'Segment C', maxLength: 20 }),
				enumArg('active', ['1', '2', '3'], '2', { label: 'Active segment' }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						display: 'inline-flex',
						...(outlined
							? {
									borderRadius: lib.radius.md,
									overflow: 'hidden',
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: lib.border
								}
							: {
									background: lib.surfaceAlt,
									padding: '4px',
									gap: '2px',
									borderRadius: lib.radius.md
								})
					}
				},
				segment(lib, outlined, '1', '{labelA}'),
				segment(lib, outlined, '2', '{labelB}'),
				segment(lib, outlined, '3', '{labelC}')
			)
		});

		return [checkbox, checkboxGroup, radioGroup, switchDef, toggleGroup];
	}
};
