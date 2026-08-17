// Avatar archetype — initials-based identity marks in five arrangements.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-avatar-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	iff,
	map,
	merge,
	numberArg,
	repeat,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

const sizeMap = (lib) => ({
	ttMap: {
		arg: 'size',
		values: {
			sm: { width: '28px', height: '28px', fontSize: lib.fontSize.xs },
			md: { width: '40px', height: '40px', fontSize: lib.fontSize.sm },
			lg: { width: '56px', height: '56px', fontSize: lib.fontSize.lg }
		},
		default: { width: '40px', height: '40px', fontSize: lib.fontSize.sm }
	}
});

const dotSizeMap = {
	ttMap: {
		arg: 'size',
		values: {
			sm: { width: '9px', height: '9px' },
			md: { width: '11px', height: '11px' },
			lg: { width: '14px', height: '14px' }
		},
		default: { width: '11px', height: '11px' }
	}
};

const baseAvatar = (lib, borderRadius) => ({
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	fontFamily: lib.font,
	fontWeight: lib.headingWeight,
	borderRadius,
	flexShrink: 0,
	userSelect: 'none'
});

const solidFill = (lib) => ({
	background: toneMap(lib, (palette) => palette.solid),
	color: toneMap(lib, (palette) => palette.onSolid)
});

// `soft` boolean flips between the filled and tinted rendition of the tone.
const toneFill = (lib) =>
	iff(
		'soft',
		{
			background: toneMap(lib, (palette) => palette.soft),
			color: toneMap(lib, (palette) => palette.onSoft),
			border: toneMap(lib, (palette) => `1px solid ${palette.border}`)
		},
		solidFill(lib)
	);

export const archetype = {
	id: 'avatar',
	category: 'data-display',
	variants: ['initials', 'status', 'group', 'labeled', 'squared'],
	build(lib) {
		const squareRadius = lib.id === 'daisyui' ? lib.radius.lg : lib.id === 'reactflow' ? lib.radius.xs : lib.radius.md;

		const initials = define({
			slug: `${lib.id}-avatar-initials`,
			name: 'Initials Avatar',
			library: lib.id,
			category: 'data-display',
			description: `Circular initials avatar in the ${lib.label} style — tone-filled disc with library type, optional soft tint and a surface-offset ring.`,
			tags: ['avatar', 'initials', 'profile'],
			args: [
				stringArg('initials', 'NF', { label: 'Initials', maxLength: 3 }),
				toneArg(),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
				booleanArg('soft', false, { label: 'Soft tint' }),
				booleanArg('ring', false, { label: 'Ring' })
			],
			render: el(
				'div',
				{
					style: merge(
						baseAvatar(lib, lib.radius.pill),
						sizeMap(lib),
						toneFill(lib),
						iff('ring', { boxShadow: toneMap(lib, (palette) => `0 0 0 2px ${lib.surface}, 0 0 0 4px ${palette.border}`) }, {})
					)
				},
				'{initials}'
			)
		});

		const status = define({
			slug: `${lib.id}-avatar-status`,
			name: 'Status Avatar',
			library: lib.id,
			category: 'data-display',
			description: `Initials avatar with a presence dot in the ${lib.label} style — online, away or busy indicator ringed by the surface color.`,
			tags: ['avatar', 'status', 'presence', 'indicator'],
			args: [
				stringArg('initials', 'JT', { label: 'Initials', maxLength: 3 }),
				toneArg(),
				enumArg('status', ['online', 'away', 'busy'], 'online', { label: 'Status' }),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' })
			],
			render: el(
				'div',
				{ style: { position: 'relative', display: 'inline-flex' } },
				el('div', { style: merge(baseAvatar(lib, lib.radius.pill), sizeMap(lib), solidFill(lib)) }, '{initials}'),
				el('span', {
					style: merge(
						{
							position: 'absolute',
							right: '0',
							bottom: '0',
							borderRadius: '999px',
							border: `2px solid ${lib.surface}`,
							background: map(
								'status',
								{
									online: lib.palette.success.solid,
									away: lib.palette.warning.solid,
									busy: lib.palette.danger.solid
								},
								lib.palette.success.solid
							)
						},
						dotSizeMap
					)
				})
			)
		});

		const group = define({
			slug: `${lib.id}-avatar-group`,
			name: 'Avatar Group',
			library: lib.id,
			category: 'data-display',
			description: `Overlapping avatar stack in the ${lib.label} style — a repeat-driven row of tone-filled initials discs separated by surface-colored rims.`,
			tags: ['avatar', 'group', 'stack', 'team'],
			args: [
				numberArg('count', 4, { label: 'Avatars', min: 1, max: 8 }),
				stringArg('prefix', 'U', { label: 'Initials prefix', maxLength: 2 }),
				toneArg(),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' })
			],
			render: row(
				{ paddingLeft: '10px', fontFamily: lib.font },
				repeat(
					'count',
					8,
					el(
						'div',
						{
							style: merge(baseAvatar(lib, lib.radius.pill), sizeMap(lib), solidFill(lib), {
								border: `2px solid ${lib.surface}`,
								marginLeft: '-10px'
							})
						},
						'{prefix}{n}'
					)
				)
			)
		});

		const labeled = define({
			slug: `${lib.id}-avatar-labeled`,
			name: 'Labeled Avatar',
			library: lib.id,
			category: 'data-display',
			description: `Avatar with name and role text in the ${lib.label} style — initials disc beside a two-line identity block using library type and muted ink.`,
			tags: ['avatar', 'labeled', 'identity', 'profile'],
			args: [
				stringArg('initials', 'AR', { label: 'Initials', maxLength: 3 }),
				stringArg('name', 'Alex Rivers', { label: 'Name', maxLength: 40 }),
				stringArg('role', 'Product Designer', { label: 'Role', maxLength: 40 }),
				toneArg()
			],
			render: row(
				{ gap: '12px', fontFamily: lib.font },
				el(
					'div',
					{
						style: merge(baseAvatar(lib, lib.radius.pill), { width: '40px', height: '40px', fontSize: lib.fontSize.sm }, solidFill(lib))
					},
					'{initials}'
				),
				stack(
					{ gap: '2px' },
					text(
						{
							fontSize: lib.fontSize.md,
							fontWeight: lib.headingWeight,
							color: lib.id === 'thingtime' ? lib.ink : lib.text
						},
						'{name}'
					),
					text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{role}')
				)
			)
		});

		const squared = define({
			slug: `${lib.id}-avatar-squared`,
			name: 'Squared Avatar',
			library: lib.id,
			category: 'data-display',
			description: `Rounded-square initials avatar in the ${lib.label} style — the library's own corner radius on a tone-filled tile, with an optional soft tint.`,
			tags: ['avatar', 'squared', 'initials', 'tile'],
			args: [
				stringArg('initials', 'TT', { label: 'Initials', maxLength: 3 }),
				toneArg(),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
				booleanArg('soft', false, { label: 'Soft tint' })
			],
			render: el('div', { style: merge(baseAvatar(lib, squareRadius), sizeMap(lib), toneFill(lib)) }, '{initials}')
		});

		return [initials, status, group, labeled, squared];
	}
};
