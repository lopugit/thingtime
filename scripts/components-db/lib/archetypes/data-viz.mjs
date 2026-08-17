// Data-viz archetype — svg mini-charts wrapped in library-native card chrome:
// bar, line, donut, gauge, heatmap. Static hardcoded data with arg-driven
// accents (tone recolors, enum/number args move the highlight). Follows the
// button.mjs exemplar: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs `${lib.id}-data-viz-<variant>`.
//
// svg allowlist has no defs/gradients/text — labels are HTML spans outside or
// absolutely overlaying the svg, and translucent fills are precomputed rgba
// strings derived from each tone's solid hex (a sanctioned literal).

import {
	booleanArg,
	define,
	el,
	enumArg,
	ifEq,
	iff,
	map,
	numberArg,
	stringArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// --- shared chrome -----------------------------------------------------------

const card = (lib, width, extra, ...children) =>
	el(
		'div',
		{
			style: {
				display: 'flex',
				flexDirection: 'column',
				width,
				boxSizing: 'border-box',
				padding: '14px 16px',
				fontFamily: lib.font,
				background: lib.surface,
				border: `1px solid ${lib.border}`,
				borderRadius: lib.radius.md,
				boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
				...(extra || {})
			}
		},
		...children
	);

// Chart heading: MUI wears an uppercase overline, Thingtime a rainbow underline.
const chartHeader = (lib) =>
	el(
		'div',
		{ style: { marginBottom: '10px' } },
		el(
			'span',
			{
				style: {
					fontSize: lib.id === 'mui' ? lib.fontSize.xs : lib.fontSize.sm,
					fontWeight: lib.headingWeight,
					color: lib.text,
					...(lib.id === 'mui' ? { textTransform: 'uppercase', letterSpacing: '0.06em' } : {})
				}
			},
			'{title}'
		),
		lib.id === 'thingtime'
			? el('div', { style: { height: '3px', width: '32px', marginTop: '4px', borderRadius: '999px', background: lib.rainbow } })
			: null
	);

const XMLNS = 'http://www.w3.org/2000/svg';

// '#rrggbb' → translucent rgba; non-hex solids (antd neutral) fall back to soft.
const hexRgba = (hex, alpha) => {
	const match = /^#([0-9a-f]{6})$/i.exec(hex || '');
	if (!match) return null;
	const int = parseInt(match[1], 16);
	return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
};

const toneSolid = (lib) => toneMap(lib, (palette) => palette.solid);
const toneSoft = (lib) => toneMap(lib, (palette) => palette.soft);
const toneWash = (lib, alpha) => toneMap(lib, (palette) => hexRgba(palette.solid, alpha) ?? palette.soft);

// --- static chart data -------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const BAR_HEIGHTS = [38, 56, 30, 66, 46, 72];

const LINE_POINTS = '4,48 28,36 52,42 76,26 100,32 124,14 152,20';
const AREA_POINTS = `${LINE_POINTS} 152,60 4,60`;

// Donut: r=40 → circumference 2π·40 ≈ 251.3; percent enum in steps of 10 maps
// to precomputed dasharray strings (the DSL cannot do arithmetic).
const DONUT_CIRC = 251.3;
const DONUT_STEPS = Array.from({ length: 11 }, (_, i) => String(i * 10));
const DONUT_DASH = Object.fromEntries(
	DONUT_STEPS.map((p) => [p, `${((Number(p) / 100) * DONUT_CIRC).toFixed(1)} ${DONUT_CIRC}`])
);

// Heatmap: 7×4 fixed intensity pattern, 4 opacity steps over currentColor so a
// single tone map on the wrapper recolors all 28 cells.
const HEAT_PATTERN = [
	[0, 1, 2, 1, 3, 0, 1],
	[1, 2, 3, 2, 1, 1, 0],
	[2, 3, 1, 0, 2, 3, 1],
	[0, 1, 2, 3, 3, 2, 1]
];
const HEAT_OPACITY = [0.16, 0.42, 0.7, 1];
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const archetype = {
	id: 'data-viz',
	category: 'data-display',
	variants: ['bar', 'line', 'donut', 'gauge', 'heatmap'],
	build(lib) {
		const barRx = lib.id === 'daisyui' ? 4 : lib.id === 'reactflow' ? 1 : 2;

		const bar = define({
			slug: `${lib.id}-data-viz-bar`,
			name: 'Bar Chart',
			library: lib.id,
			category: 'data-display',
			description: `Mini bar chart in the ${lib.label} style — six svg bars on a baseline inside library card chrome; the highlighted month fills with the solid tone, the rest with its soft wash.`,
			tags: ['chart', 'bar', 'data', 'viz'],
			args: [
				stringArg('title', 'Revenue', { label: 'Title', maxLength: 32 }),
				toneArg(),
				enumArg('active', MONTHS, 'Apr', { label: 'Highlight' })
			],
			render: card(
				lib,
				'232px',
				null,
				chartHeader(lib),
				el(
					'svg',
					{ width: 200, height: 74, viewBox: '0 0 200 74', xmlns: XMLNS },
					...MONTHS.map((month, i) =>
						el('rect', {
							x: i * 34,
							y: 72 - BAR_HEIGHTS[i],
							width: 30,
							height: BAR_HEIGHTS[i],
							rx: barRx,
							fill: ifEq('active', month, toneSolid(lib), toneSoft(lib))
						})
					),
					el('line', { x1: 0, y1: 73, x2: 200, y2: 73, stroke: lib.border, strokeWidth: 1 })
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							marginTop: '6px',
							fontSize: lib.fontSize.xs,
							color: lib.muted,
							textAlign: 'center'
						}
					},
					...MONTHS.map((month) => el('span', { style: { flex: 1 } }, month))
				)
			)
		});

		const line = define({
			slug: `${lib.id}-data-viz-line`,
			name: 'Line Chart',
			library: lib.id,
			category: 'data-display',
			description: `Mini line chart in the ${lib.label} style — a tone-colored svg trend polyline with an optional translucent area fill, end-point dot, and min/max captions under the plot.`,
			tags: ['chart', 'line', 'trend', 'area'],
			args: [
				stringArg('title', 'Active users', { label: 'Title', maxLength: 32 }),
				toneArg(),
				booleanArg('area', true, { label: 'Area fill' }),
				stringArg('min', 'Low 14', { label: 'Min caption', maxLength: 16 }),
				stringArg('max', 'High 86', { label: 'Max caption', maxLength: 16 })
			],
			render: card(
				lib,
				'232px',
				null,
				chartHeader(lib),
				el(
					'svg',
					{ width: 200, height: 80, viewBox: '0 0 160 64', xmlns: XMLNS },
					iff('area', el('polygon', { points: AREA_POINTS, fill: toneWash(lib, 0.18) })),
					el('line', { x1: 4, y1: 60, x2: 156, y2: 60, stroke: lib.borderSoft, strokeWidth: 1 }),
					el('polyline', {
						points: LINE_POINTS,
						fill: 'none',
						stroke: toneSolid(lib),
						strokeWidth: 2.5,
						strokeLinecap: 'round',
						strokeLinejoin: 'round'
					}),
					el('circle', { cx: 152, cy: 20, r: 3.5, fill: toneSolid(lib), stroke: lib.surface, strokeWidth: 1.5 })
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							justifyContent: 'space-between',
							marginTop: '4px',
							fontSize: lib.fontSize.xs,
							color: lib.muted
						}
					},
					el('span', null, '{min}'),
					el('span', null, '{max}')
				)
			)
		});

		const donut = define({
			slug: `${lib.id}-data-viz-donut`,
			name: 'Donut Chart',
			library: lib.id,
			category: 'data-display',
			description: `Donut progress chart in the ${lib.label} style — a tone-colored svg ring drawn with a stepped stroke-dasharray over a quiet track, the percent overlaid dead-center as an HTML label.`,
			tags: ['chart', 'donut', 'progress', 'ring'],
			args: [
				stringArg('title', 'Storage used', { label: 'Title', maxLength: 32 }),
				enumArg('percent', DONUT_STEPS, '60', { label: 'Percent' }),
				toneArg(),
				stringArg('caption', '1.2 TB of 2 TB', { label: 'Caption', maxLength: 32 })
			],
			render: card(
				lib,
				'216px',
				null,
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '14px' } },
					el(
						'div',
						{ style: { position: 'relative', width: '84px', height: '84px', flexShrink: 0 } },
						el(
							'svg',
							{ width: 84, height: 84, viewBox: '0 0 100 100', xmlns: XMLNS },
							el('circle', { cx: 50, cy: 50, r: 40, fill: 'none', stroke: lib.borderSoft, strokeWidth: 12 }),
							el('circle', {
								cx: 50,
								cy: 50,
								r: 40,
								fill: 'none',
								stroke: toneSolid(lib),
								strokeWidth: 12,
								strokeLinecap: lib.id === 'reactflow' ? 'butt' : 'round',
								style: {
									strokeDasharray: map('percent', DONUT_DASH, DONUT_DASH['60']),
									transform: 'rotate(-90deg)',
									transformOrigin: '50px 50px'
								}
							})
						),
						el(
							'span',
							{
								style: {
									position: 'absolute',
									inset: '0',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									fontSize: lib.fontSize.lg,
									fontWeight: lib.headingWeight,
									color: lib.text
								}
							},
							'{percent}%'
						)
					),
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
						el('span', { style: { fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text } }, '{title}'),
						el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, '{caption}')
					)
				)
			)
		});

		const gauge = define({
			slug: `${lib.id}-data-viz-gauge`,
			name: 'Gauge',
			library: lib.id,
			category: 'data-display',
			description: `Semicircle gauge in the ${lib.label} style — a soft svg arc track with a tone-colored needle rotated by CSS calc from the percent value, pivot dot, and a big value caption below.`,
			tags: ['chart', 'gauge', 'meter', 'kpi'],
			args: [
				stringArg('title', 'CPU load', { label: 'Title', maxLength: 32 }),
				numberArg('percent', 64, { label: 'Percent', min: 0, max: 100 }),
				toneArg(),
				stringArg('suffix', '%', { label: 'Suffix', maxLength: 6 })
			],
			render: card(
				lib,
				'188px',
				{ alignItems: 'center' },
				el(
					'span',
					{
						style: {
							fontSize: lib.fontSize.xs,
							fontWeight: lib.headingWeight,
							color: lib.muted,
							textTransform: 'uppercase',
							letterSpacing: '0.05em'
						}
					},
					'{title}'
				),
				el(
					'svg',
					{ width: 120, height: 70, viewBox: '0 0 100 58', xmlns: XMLNS },
					el('path', {
						d: 'M 12 52 A 38 38 0 0 1 88 52',
						fill: 'none',
						stroke: lib.borderSoft,
						strokeWidth: 8,
						strokeLinecap: 'round'
					}),
					el('line', {
						x1: 50,
						y1: 52,
						x2: 50,
						y2: 21,
						stroke: toneSolid(lib),
						strokeWidth: 3,
						strokeLinecap: 'round',
						style: {
							transform: 'rotate(calc({percent} * 1.8deg - 90deg))',
							transformOrigin: '50px 52px'
						}
					}),
					el('circle', { cx: 50, cy: 52, r: 4.5, fill: toneSolid(lib) })
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							justifyContent: 'space-between',
							width: '120px',
							fontSize: lib.fontSize.xs,
							color: lib.faint
						}
					},
					el('span', null, '0'),
					el('span', null, '100')
				),
				el(
					'span',
					{ style: { marginTop: '2px', fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight, color: lib.text } },
					'{percent}{suffix}'
				)
			)
		});

		const heatmap = define({
			slug: `${lib.id}-data-viz-heatmap`,
			name: 'Heatmap',
			library: lib.id,
			category: 'data-display',
			description: `Activity heatmap in the ${lib.label} style — a 7×4 grid of rounded cells shading a fixed contribution pattern through four opacity steps of the tone color, with weekday captions and an optional Less→More legend.`,
			tags: ['chart', 'heatmap', 'activity', 'grid'],
			args: [
				stringArg('title', 'Activity', { label: 'Title', maxLength: 32 }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'success'),
				booleanArg('legend', true, { label: 'Legend' })
			],
			render: card(
				lib,
				'224px',
				null,
				chartHeader(lib),
				el(
					'div',
					{ style: { color: toneSolid(lib) } },
					el(
						'div',
						{ style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' } },
						...HEAT_PATTERN.flat().map((level) =>
							el('div', {
								style: {
									height: '18px',
									borderRadius: lib.radius.xs,
									background: 'currentColor',
									opacity: HEAT_OPACITY[level]
								}
							})
						)
					),
					el(
						'div',
						{
							style: {
								display: 'grid',
								gridTemplateColumns: 'repeat(7, 1fr)',
								gap: '4px',
								marginTop: '4px',
								textAlign: 'center',
								fontSize: lib.fontSize.xs,
								color: lib.muted
							}
						},
						...WEEKDAYS.map((day) => el('span', null, day))
					),
					iff(
						'legend',
						el(
							'div',
							{
								style: {
									display: 'flex',
									alignItems: 'center',
									gap: '4px',
									marginTop: '8px',
									fontSize: lib.fontSize.xs
								}
							},
							el('span', { style: { color: lib.muted, marginRight: '2px' } }, 'Less'),
							...HEAT_OPACITY.map((opacity) =>
								el('div', {
									style: {
										width: '10px',
										height: '10px',
										borderRadius: lib.radius.xs,
										background: 'currentColor',
										opacity
									}
								})
							),
							el('span', { style: { color: lib.muted, marginLeft: '2px' } }, 'More')
						)
					)
				)
			)
		});

		return [bar, line, donut, gauge, heatmap];
	}
};
