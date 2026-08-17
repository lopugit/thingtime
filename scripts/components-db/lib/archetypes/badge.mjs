// Badge archetype — status badges in five renditions: filled, tinted,
// bordered, dot-indicator + label, and a label + count pill. Follows the
// button.mjs exemplar: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs `${lib.id}-badge-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	iff,
	map,
	merge,
	row,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// antd tags sit on tight 4px corners and reactflow chrome stays crisp;
// everyone else wears the classic pill.
const badgeRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);

const sizeMap = (lib) =>
	map(
		'size',
		{
			sm: { fontSize: lib.fontSize.xs, padding: '2px 8px' },
			md: { fontSize: lib.fontSize.sm, padding: '4px 10px' }
		},
		{ fontSize: lib.fontSize.xs, padding: '2px 8px' }
	);

const baseBadge = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '6px',
	fontFamily: lib.font,
	fontWeight: 600,
	lineHeight: 1.4,
	borderRadius: badgeRadius(lib)
});

const commonArgs = (label) => [
	stringArg('label', label, { label: 'Label', maxLength: 24 }),
	toneArg(),
	enumArg('size', ['sm', 'md'], 'sm', { label: 'Size' })
];

export const archetype = {
	id: 'badge',
	category: 'data-display',
	variants: ['solid', 'soft', 'outline', 'dot', 'pill-count'],
	build(lib) {
		const solid = define({
			slug: `${lib.id}-badge-solid`,
			name: 'Solid Badge',
			library: lib.id,
			category: 'data-display',
			description: `Filled status badge in the ${lib.label} style — solid tone background with contrast text on the library's native badge corners.`,
			tags: ['badge', 'status', 'solid'],
			args: commonArgs('Active'),
			render: el(
				'span',
				{
					style: merge(baseBadge(lib), sizeMap(lib), {
						background: toneMap(lib, (palette) => palette.solid),
						color: toneMap(lib, (palette) => palette.onSolid)
					})
				},
				'{label}'
			)
		});

		const soft = define({
			slug: `${lib.id}-badge-soft`,
			name: 'Soft Badge',
			library: lib.id,
			category: 'data-display',
			description: `Tinted status badge in the ${lib.label} style — soft tone wash with the deeper tone for the label${lib.id === 'antd' ? ', plus the classic Ant Design tag border' : ''}.`,
			tags: ['badge', 'status', 'soft', 'tinted'],
			args: commonArgs('In review'),
			render: el(
				'span',
				{
					style: merge(baseBadge(lib), sizeMap(lib), {
						background: toneMap(lib, (palette) => palette.soft),
						color: toneMap(lib, (palette) => palette.onSoft),
						...(lib.id === 'antd'
							? { borderWidth: '1px', borderStyle: 'solid', borderColor: toneMap(lib, (palette) => palette.border) }
							: {})
					})
				},
				'{label}'
			)
		});

		const outline = define({
			slug: `${lib.id}-badge-outline`,
			name: 'Outline Badge',
			library: lib.id,
			category: 'data-display',
			description: `Bordered status badge in the ${lib.label} style — transparent body with a tone-colored border and matching label text.`,
			tags: ['badge', 'status', 'outline'],
			args: commonArgs('Beta'),
			render: el(
				'span',
				{
					style: merge(baseBadge(lib), sizeMap(lib), {
						background: 'transparent',
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: toneMap(lib, (palette) => palette.solid),
						color: toneMap(lib, (palette) => palette.solid)
					})
				},
				'{label}'
			)
		});

		const dot = define({
			slug: `${lib.id}-badge-dot`,
			name: 'Dot Badge',
			library: lib.id,
			category: 'data-display',
			description: `Dot-indicator badge in the ${lib.label} style — a small tone-colored dot beside a quiet label, optionally wrapped in a bordered chip.`,
			tags: ['badge', 'status', 'dot', 'indicator'],
			args: [
				stringArg('label', 'Online', { label: 'Label', maxLength: 24 }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'success'),
				enumArg('size', ['sm', 'md'], 'sm', { label: 'Size' }),
				booleanArg('bordered', true, { label: 'Bordered' })
			],
			render: el(
				'span',
				{
					style: merge(
						baseBadge(lib),
						sizeMap(lib),
						{ color: lib.text, fontWeight: 500 },
						iff(
							'bordered',
							{
								background: lib.surface,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.border,
								boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
							},
							{}
						)
					)
				},
				el('span', {
					style: {
						width: '8px',
						height: '8px',
						borderRadius: '999px',
						background: toneMap(lib, (palette) => palette.solid),
						flexShrink: 0
					}
				}),
				'{label}'
			)
		});

		const pillCount = define({
			slug: `${lib.id}-badge-pill-count`,
			name: 'Count Badge',
			library: lib.id,
			category: 'data-display',
			description: `Label with a count pill in the ${lib.label} style — a muted label beside a solid tone pill carrying the number, for inbox and tab counters.`,
			tags: ['badge', 'count', 'pill', 'notification'],
			args: [
				stringArg('label', 'Inbox', { label: 'Label', maxLength: 24 }),
				stringArg('count', '24', { label: 'Count', maxLength: 6 }),
				toneArg()
			],
			render: row(
				{ display: 'inline-flex', gap: '8px', fontFamily: lib.font },
				text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text }, '{label}'),
				el(
					'span',
					{
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							minWidth: '20px',
							height: '20px',
							padding: '0 6px',
							boxSizing: 'border-box',
							borderRadius: lib.radius.pill,
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							fontSize: lib.fontSize.xs,
							fontWeight: 700
						}
					},
					'{count}'
				)
			)
		});

		return [solid, soft, outline, dot, pillCount];
	}
};
