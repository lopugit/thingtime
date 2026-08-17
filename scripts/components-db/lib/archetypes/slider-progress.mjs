// Slider & progress archetype — completion UI: bars, labeled bars, thumb
// sliders, dual-thumb ranges, and svg progress rings. Follows the button.mjs
// exemplar contract: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs
// `${lib.id}-slider-progress-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
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

// Ring geometry: r=20 in a 48×48 viewBox. strokeDasharray only supports string
// values, so precompute one dash string per 10% step and pick via ttMap.
const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_STEPS = ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'];
const ringDashValues = Object.fromEntries(
	RING_STEPS.map((step) => [step, `${((RING_CIRCUMFERENCE * Number(step)) / 100).toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`])
);

// Tone → solid fill, with per-library winks: Thingtime's primary fill is the
// house rainbow gradient, React Flow's primary fill is its hot-pink accent.
const fillBackground = (lib) =>
	toneMap(lib, (palette, tone) => {
		if (lib.id === 'thingtime' && tone === 'primary') return lib.rainbow;
		if (lib.id === 'reactflow' && tone === 'primary') return lib.accent;
		return palette.solid;
	});

// Solid-color-only variant (svg strokes can't take gradients).
const toneSolid = (lib) =>
	toneMap(lib, (palette, tone) => (lib.id === 'reactflow' && tone === 'primary' ? lib.accent : palette.solid));

const trackHeights = (lib) =>
	lib.id === 'daisyui' ? { sm: '8px', md: '12px', lg: '16px' } : { sm: '4px', md: '8px', lg: '12px' };

const barTrack = (lib, height, ...children) =>
	el(
		'div',
		{ style: { height, background: lib.borderSoft, borderRadius: lib.radius.pill, overflow: 'hidden' } },
		...children
	);

const barFill = (lib) =>
	el('div', {
		style: {
			width: '{percent}%',
			height: '100%',
			background: fillBackground(lib),
			borderRadius: lib.radius.pill
		}
	});

const sliderTrack = (lib, ...children) =>
	el(
		'div',
		{
			style: {
				position: 'relative',
				height: lib.id === 'daisyui' ? '8px' : '6px',
				background: lib.borderSoft,
				borderRadius: lib.radius.pill
			}
		},
		...children
	);

const sliderThumb = (lib, left) =>
	el('div', {
		style: {
			position: 'absolute',
			left,
			top: '50%',
			transform: 'translate(-50%, -50%)',
			width: lib.id === 'daisyui' ? '20px' : '16px',
			height: lib.id === 'daisyui' ? '20px' : '16px',
			borderRadius: lib.radius.pill,
			background: lib.surface,
			borderWidth: '2px',
			borderStyle: 'solid',
			borderColor: toneSolid(lib),
			boxShadow: lib.shadow.sm
		}
	});

export const archetype = {
	id: 'slider-progress',
	category: 'forms',
	variants: ['progress', 'progress-label', 'slider', 'range', 'ring'],
	build(lib) {
		const heights = trackHeights(lib);
		const heightMap = map('size', heights, heights.md);

		const progress = define({
			slug: `${lib.id}-slider-progress-progress`,
			name: 'Progress Bar',
			library: lib.id,
			category: 'forms',
			description: `Horizontal progress bar in the ${lib.label} style — pill-rounded track with a tone-colored fill whose width tracks the percent value.`,
			tags: ['progress', 'bar', 'percent', 'status'],
			args: [
				numberArg('percent', 64, { label: 'Percent', min: 0, max: 100 }),
				toneArg(),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' })
			],
			render: el(
				'div',
				{ style: { width: '240px', fontFamily: lib.font } },
				barTrack(lib, heightMap, barFill(lib))
			)
		});

		const progressLabel = define({
			slug: `${lib.id}-slider-progress-progress-label`,
			name: 'Labeled Progress',
			library: lib.id,
			category: 'forms',
			description: `Progress bar with a caption row in the ${lib.label} style — task label on the left, live percent readout on the right, tone-colored fill below.`,
			tags: ['progress', 'label', 'percent', 'status'],
			args: [
				stringArg('label', 'Uploading assets', { label: 'Label', maxLength: 40 }),
				numberArg('percent', 68, { label: 'Percent', min: 0, max: 100 }),
				toneArg(),
				booleanArg('showPercent', true, { label: 'Show percent' })
			],
			render: stack(
				{ gap: '6px', width: '240px', fontFamily: lib.font },
				row(
					{ justifyContent: 'space-between' },
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{label}'),
					iff('showPercent', text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{percent}%'))
				),
				barTrack(lib, heights.md, barFill(lib))
			)
		});

		const slider = define({
			slug: `${lib.id}-slider-progress-slider`,
			name: 'Slider',
			library: lib.id,
			category: 'forms',
			description: `Single-thumb slider in the ${lib.label} style — filled track up to the percent value, a surface thumb with a tone-colored border, optional value bubble.`,
			tags: ['slider', 'input', 'range', 'percent'],
			args: [
				numberArg('percent', 40, { label: 'Value', min: 0, max: 100 }),
				toneArg(),
				booleanArg('showValue', true, { label: 'Show value bubble' })
			],
			render: el(
				'div',
				{
					style: merge(
						{ width: '240px', fontFamily: lib.font, paddingBottom: '8px' },
						iff('showValue', { paddingTop: '36px' }, { paddingTop: '8px' })
					)
				},
				sliderTrack(
					lib,
					el('div', {
						style: {
							width: '{percent}%',
							height: '100%',
							background: fillBackground(lib),
							borderRadius: lib.radius.pill
						}
					}),
					iff(
						'showValue',
						el(
							'div',
							{
								style: {
									position: 'absolute',
									left: '{percent}%',
									top: '-32px',
									transform: 'translateX(-50%)',
									background: toneSolid(lib),
									color: toneMap(lib, (palette) => palette.onSolid),
									padding: '2px 8px',
									borderRadius: lib.radius.sm,
									fontSize: lib.fontSize.xs,
									fontWeight: lib.headingWeight
								}
							},
							'{percent}'
						)
					),
					sliderThumb(lib, '{percent}%')
				)
			)
		});

		const range = define({
			slug: `${lib.id}-slider-progress-range`,
			name: 'Range Slider',
			library: lib.id,
			category: 'forms',
			description: `Dual-thumb range slider in the ${lib.label} style — the tone-colored fill spans from the low to the high value, with optional end labels.`,
			tags: ['slider', 'range', 'input', 'dual'],
			args: [
				numberArg('low', 25, { label: 'Low', min: 0, max: 100 }),
				numberArg('high', 75, { label: 'High', min: 0, max: 100 }),
				toneArg(),
				booleanArg('showValues', true, { label: 'Show values' })
			],
			render: stack(
				{ gap: '8px', width: '240px', fontFamily: lib.font, padding: '8px 0' },
				iff(
					'showValues',
					row(
						{ justifyContent: 'space-between' },
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{low}'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{high}')
					)
				),
				sliderTrack(
					lib,
					el('div', {
						style: {
							position: 'absolute',
							left: '{low}%',
							right: 'calc(100% - {high}%)',
							top: '0',
							bottom: '0',
							background: fillBackground(lib),
							borderRadius: lib.radius.pill
						}
					}),
					sliderThumb(lib, '{low}%'),
					sliderThumb(lib, '{high}%')
				)
			)
		});

		const ring = define({
			slug: `${lib.id}-slider-progress-ring`,
			name: 'Progress Ring',
			library: lib.id,
			category: 'forms',
			description: `Circular progress ring in the ${lib.label} style — an svg track circle with a tone-colored arc (strokeDasharray per 10% step) and a centered percent label.`,
			tags: ['progress', 'ring', 'circular', 'percent'],
			args: [
				enumArg('percent', RING_STEPS, '70', { label: 'Percent' }),
				toneArg(),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
				booleanArg('showLabel', true, { label: 'Show label' })
			],
			render: el(
				'div',
				{
					style: {
						position: 'relative',
						width: map('size', { sm: '44px', md: '56px', lg: '72px' }, '56px'),
						height: map('size', { sm: '44px', md: '56px', lg: '72px' }, '56px'),
						fontFamily: lib.font
					}
				},
				el(
					'svg',
					{
						width: map('size', { sm: 44, md: 56, lg: 72 }, 56),
						height: map('size', { sm: 44, md: 56, lg: 72 }, 56),
						viewBox: '0 0 48 48',
						fill: 'none',
						xmlns: 'http://www.w3.org/2000/svg',
						style: { display: 'block', transform: 'rotate(-90deg)' }
					},
					el('circle', { cx: 24, cy: 24, r: RING_RADIUS, stroke: lib.borderSoft, strokeWidth: 4 }),
					el('circle', {
						cx: 24,
						cy: 24,
						r: RING_RADIUS,
						stroke: toneSolid(lib),
						strokeWidth: 4,
						strokeLinecap: 'round',
						style: { strokeDasharray: map('percent', ringDashValues, ringDashValues['70']) }
					})
				),
				iff(
					'showLabel',
					el(
						'span',
						{
							style: {
								position: 'absolute',
								inset: 0,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontSize: map('size', { sm: lib.fontSize.xs, md: lib.fontSize.sm, lg: lib.fontSize.lg }, lib.fontSize.sm),
								fontWeight: lib.headingWeight,
								color: lib.text
							}
						},
						'{percent}%'
					)
				)
			)
		});

		return [progress, progressLabel, slider, range, ring];
	}
};
