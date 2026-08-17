// Button archetype — the exemplar every other archetype module follows.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-button-<variant>`.

import {
	arg,
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	map,
	merge,
	row,
	stringArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

const sizeMap = (lib) => ({
	ttMap: {
		arg: 'size',
		values: {
			sm: { height: lib.control.sm, padding: '0 12px', fontSize: lib.fontSize.sm },
			md: { height: lib.control.md, padding: '0 16px', fontSize: lib.fontSize.md },
			lg: { height: lib.control.lg, padding: '0 20px', fontSize: lib.fontSize.lg }
		},
		default: { height: lib.control.md, padding: '0 16px', fontSize: lib.fontSize.md }
	}
});

const baseButton = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '8px',
	border: 'none',
	borderRadius: lib.radius.md,
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

const disabledStyle = iff('disabled', { opacity: 0.5, cursor: 'not-allowed' }, {});

const commonArgs = (label) => [
	stringArg('label', label, { label: 'Label', maxLength: 40 }),
	toneArg(),
	enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
	booleanArg('disabled', false, { label: 'Disabled' })
];

export const archetype = {
	id: 'button',
	category: 'buttons',
	variants: ['solid', 'outline', 'ghost', 'soft', 'icon'],
	build(lib) {
		const solid = define({
			slug: `${lib.id}-button-solid`,
			name: 'Solid Button',
			library: lib.id,
			category: 'buttons',
			description: `Filled primary action button in the ${lib.label} style — solid tone background, ${lib.uppercaseButtons ? 'uppercase label, ' : ''}library-native radius and type.`,
			tags: ['button', 'action', 'solid'],
			args: commonArgs('Get started'),
			render: el(
				'button',
				{
					type: 'button',
					style: merge(
						baseButton(lib),
						sizeMap(lib),
						{
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
						},
						disabledStyle
					)
				},
				'{label}'
			)
		});

		const outline = define({
			slug: `${lib.id}-button-outline`,
			name: 'Outline Button',
			library: lib.id,
			category: 'buttons',
			description: `Bordered secondary button in the ${lib.label} style — transparent body, tone-colored border and label.`,
			tags: ['button', 'action', 'outline'],
			args: commonArgs('Learn more'),
			render: el(
				'button',
				{
					type: 'button',
					style: merge(
						baseButton(lib),
						sizeMap(lib),
						{
							background: 'transparent',
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.solid)
						},
						disabledStyle
					)
				},
				'{label}'
			)
		});

		const ghost = define({
			slug: `${lib.id}-button-ghost`,
			name: 'Ghost Button',
			library: lib.id,
			category: 'buttons',
			description: `Borderless quiet button in the ${lib.label} style — label only, tone-colored text on a transparent body.`,
			tags: ['button', 'action', 'ghost'],
			args: commonArgs('Dismiss'),
			render: el(
				'button',
				{
					type: 'button',
					style: merge(
						baseButton(lib),
						sizeMap(lib),
						{ background: 'transparent', color: toneMap(lib, (palette) => palette.solid) },
						disabledStyle
					)
				},
				'{label}'
			)
		});

		const soft = define({
			slug: `${lib.id}-button-soft`,
			name: 'Soft Button',
			library: lib.id,
			category: 'buttons',
			description: `Tinted button in the ${lib.label} style — soft tone wash background with the deeper tone for the label.`,
			tags: ['button', 'action', 'soft', 'tinted'],
			args: commonArgs('Preview'),
			render: el(
				'button',
				{
					type: 'button',
					style: merge(
						baseButton(lib),
						sizeMap(lib),
						{
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft)
						},
						disabledStyle
					)
				},
				'{label}'
			)
		});

		const icon = define({
			slug: `${lib.id}-button-icon`,
			name: 'Icon Button',
			library: lib.id,
			category: 'buttons',
			description: `Button with a leading icon in the ${lib.label} style — a plus glyph beside the label, optional icon-only square mode.`,
			tags: ['button', 'action', 'icon'],
			args: [
				stringArg('label', 'New item', { label: 'Label', maxLength: 40 }),
				toneArg(),
				booleanArg('iconOnly', false, { label: 'Icon only' }),
				booleanArg('disabled', false, { label: 'Disabled' })
			],
			render: el(
				'button',
				{
					type: 'button',
					style: merge(
						baseButton(lib),
						{
							height: lib.control.md,
							fontSize: lib.fontSize.md,
							padding: iff('iconOnly', '0', '0 16px'),
							width: iff('iconOnly', lib.control.md, 'auto'),
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							boxShadow: lib.shadow.sm
						},
						disabledStyle
					)
				},
				icons.plus(16, 'currentColor'),
				iff('iconOnly', '', '{label}')
			)
		});

		return [solid, outline, ghost, soft, icon];
	}
};
