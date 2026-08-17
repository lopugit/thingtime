// Health & fitness archetype — fitness surfaces in library card chrome:
// activity rings, workout summary, sleep card, macros card, heart-rate card.
// Follows the button.mjs exemplar: exactly 5 variants, `build(lib)` returns
// exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-health-fitness-<variant>`.
//
// svg allowlist has no defs/gradients/text — ring fills are stepped
// stroke-dasharray strings (percent enums in steps of 10, precomputed per
// radius; the DSL cannot do arithmetic) and all labels are HTML spans.

import {
	define,
	el,
	enumArg,
	icons,
	map,
	numberArg,
	repeat,
	stringArg
} from '../helpers.mjs';

const XMLNS = 'http://www.w3.org/2000/svg';

// --- shared chrome -----------------------------------------------------------

const cardRadius = (lib) => (lib.id === 'reactflow' ? lib.radius.sm : lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md);
const barRadius = (lib) => (lib.id === 'reactflow' ? lib.radius.xs : lib.radius.pill);
const lineCap = (lib) => (lib.id === 'reactflow' ? 'butt' : 'round');

const card = (lib, width, ...children) =>
	el(
		'div',
		{
			style: {
				display: 'flex',
				flexDirection: 'column',
				width,
				boxSizing: 'border-box',
				padding: '16px',
				fontFamily: lib.font,
				background: lib.surface,
				border: `1px solid ${lib.border}`,
				borderRadius: cardRadius(lib),
				boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
			}
		},
		...children
	);

// Card heading: MUI wears an uppercase overline, Thingtime a rainbow underline.
const heading = (lib, token) =>
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
			token
		),
		lib.id === 'thingtime'
			? el('div', { style: { height: '3px', width: '32px', marginTop: '4px', borderRadius: '999px', background: lib.rainbow } })
			: null
	);

const capStyle = (lib) => ({
	fontSize: lib.fontSize.xs,
	color: lib.muted,
	...(lib.id === 'mui' ? { textTransform: 'uppercase', letterSpacing: '0.06em' } : {})
});

const bigNumber = (lib) => ({ fontSize: '24px', fontWeight: lib.headingWeight, color: lib.text, lineHeight: 1.15 });

// --- stepped ring dasharrays -------------------------------------------------

// Rings at r = 40 / 30 / 20 (strokeWidth 8, 100×100 viewBox). Circumference
// 2πr per ring; percent enums in steps of 10 map to precomputed dash strings.
const PERCENT_STEPS = Array.from({ length: 11 }, (_, i) => String(i * 10));
const dashTable = (circ) =>
	Object.fromEntries(PERCENT_STEPS.map((p) => [p, `${((Number(p) / 100) * circ).toFixed(1)} ${circ.toFixed(1)}`]));
const MOVE_DASH = dashTable(251.3);
const EXERCISE_DASH = dashTable(188.5);
const STAND_DASH = dashTable(125.7);

// --- workout activity icons (allowlisted svg primitives only) ---------------

const activityIcon = (color, ...kids) =>
	el(
		'svg',
		{
			width: 20,
			height: 20,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: color,
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: XMLNS
		},
		...kids
	);

const runIcon = (color) => activityIcon(color, el('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }));
const bikeIcon = (color) =>
	activityIcon(
		color,
		el('circle', { cx: 5.5, cy: 17.5, r: 3.5 }),
		el('circle', { cx: 18.5, cy: 17.5, r: 3.5 }),
		el('polyline', { points: '5.5 17.5 9 10 15 10 18.5 17.5' }),
		el('line', { x1: 9, y1: 10, x2: 7, y2: 6.5 })
	);
const strengthIcon = (color) =>
	activityIcon(
		color,
		el('line', { x1: 7.5, y1: 12, x2: 16.5, y2: 12 }),
		el('rect', { x: 3, y: 7.5, width: 3.5, height: 9, rx: 1 }),
		el('rect', { x: 17.5, y: 7.5, width: 3.5, height: 9, rx: 1 })
	);

// ECG-ish trace: flat baseline with three spiky beats (viewBox 0 0 160 44).
const ECG_POINTS =
	'2,24 26,24 32,24 36,10 40,36 44,16 48,24 76,24 82,24 86,8 90,38 94,14 98,24 126,24 132,24 136,12 140,34 144,18 148,24 158,24';

export const archetype = {
	id: 'health-fitness',
	category: 'health',
	variants: ['rings', 'workout', 'sleep', 'nutrition', 'heart-rate'],
	build(lib) {
		const moveColor = lib.palette.danger.solid;
		const exerciseColor = lib.palette.success.solid;
		const standColor = lib.palette.info.solid;

		const ring = (r, argName, dash, color) =>
			el('circle', {
				cx: 50,
				cy: 50,
				r,
				fill: 'none',
				stroke: color,
				strokeWidth: 8,
				strokeLinecap: lineCap(lib),
				style: {
					strokeDasharray: map(argName, dash, dash['60']),
					transform: 'rotate(-90deg)',
					transformOrigin: '50px 50px'
				}
			});

		const track = (r) => el('circle', { cx: 50, cy: 50, r, fill: 'none', stroke: lib.borderSoft, strokeWidth: 8 });

		const legendRow = (color, label, token) =>
			el(
				'div',
				{ style: { display: 'flex', alignItems: 'center', gap: '8px' } },
				el('span', { style: { width: '8px', height: '8px', borderRadius: '999px', background: color, flexShrink: 0 } }),
				el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted, flex: 1 } }, label),
				el('span', { style: { fontSize: lib.fontSize.xs, fontWeight: lib.headingWeight, color: lib.text } }, token)
			);

		const rings = define({
			slug: `${lib.id}-health-fitness-rings`,
			name: 'Activity Rings',
			library: lib.id,
			category: 'health',
			description: `Activity rings card in the ${lib.label} style — three nested svg rings (move, exercise, stand) drawn with stepped stroke-dasharray fills over quiet tracks, beside a dot legend echoing each ring's percent.`,
			tags: ['health', 'activity', 'rings', 'fitness', 'progress'],
			args: [
				stringArg('title', 'Today', { label: 'Title', maxLength: 24 }),
				enumArg('move', PERCENT_STEPS, '80', { label: 'Move %' }),
				enumArg('exercise', PERCENT_STEPS, '60', { label: 'Exercise %' }),
				enumArg('stand', PERCENT_STEPS, '90', { label: 'Stand %' })
			],
			render: card(
				lib,
				'248px',
				heading(lib, '{title}'),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '16px' } },
					el(
						'svg',
						{ width: 96, height: 96, viewBox: '0 0 100 100', xmlns: XMLNS },
						track(40),
						track(30),
						track(20),
						ring(40, 'move', MOVE_DASH, moveColor),
						ring(30, 'exercise', EXERCISE_DASH, exerciseColor),
						ring(20, 'stand', STAND_DASH, standColor)
					),
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 } },
						legendRow(moveColor, 'Move', '{move}%'),
						legendRow(exerciseColor, 'Exercise', '{exercise}%'),
						legendRow(standColor, 'Stand', '{stand}%')
					)
				)
			)
		});

		const stat = (label, token) =>
			el(
				'div',
				{ style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 } },
				el('span', { style: { fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text } }, token),
				el('span', { style: capStyle(lib) }, label)
			);

		const goalFill = lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid;

		const workout = define({
			slug: `${lib.id}-health-fitness-workout`,
			name: 'Workout Summary',
			library: lib.id,
			category: 'health',
			description: `Workout summary card in the ${lib.label} style — a tinted activity icon tile (run, bike, or strength), a duration/distance/energy stat trio, a goal progress bar, and a quiet ghost restart action.`,
			tags: ['health', 'workout', 'fitness', 'summary', 'progress'],
			args: [
				stringArg('title', 'Morning intervals', { label: 'Title', maxLength: 32 }),
				enumArg('activity', ['run', 'bike', 'strength'], 'run', { label: 'Activity' }),
				stringArg('duration', '42:18', { label: 'Duration', maxLength: 12 }),
				stringArg('distance', '6.4 km', { label: 'Distance', maxLength: 12 }),
				stringArg('kcal', '486', { label: 'Energy (kcal)', maxLength: 8 }),
				numberArg('progress', 68, { label: 'Goal %', min: 0, max: 100 })
			],
			render: card(
				lib,
				'256px',
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' } },
					el(
						'div',
						{
							style: {
								width: '40px',
								height: '40px',
								borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0,
								background: map(
									'activity',
									{ run: lib.palette.danger.soft, bike: lib.palette.success.soft, strength: lib.palette.info.soft },
									lib.palette.danger.soft
								)
							}
						},
						map(
							'activity',
							{
								run: runIcon(lib.palette.danger.solid),
								bike: bikeIcon(lib.palette.success.solid),
								strength: strengthIcon(lib.palette.info.solid)
							},
							runIcon(lib.palette.danger.solid)
						)
					),
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
						el(
							'span',
							{
								style: {
									fontSize: lib.fontSize.sm,
									fontWeight: lib.headingWeight,
									color: lib.text,
									...(lib.id === 'mui' ? { textTransform: 'uppercase', letterSpacing: '0.04em' } : {})
								}
							},
							'{title}'
						),
						el('span', { style: capStyle(lib) }, map('activity', { run: 'Run', bike: 'Ride', strength: 'Strength' }, 'Run'))
					)
				),
				el(
					'div',
					{ style: { display: 'flex', gap: '10px', marginBottom: '12px' } },
					stat('Duration', '{duration}'),
					stat('Distance', '{distance}'),
					stat('Energy', '{kcal} kcal')
				),
				el(
					'div',
					{ style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } },
					el('span', { style: capStyle(lib) }, 'Weekly goal'),
					el('span', { style: { fontSize: lib.fontSize.xs, fontWeight: lib.headingWeight, color: lib.text } }, '{progress}%')
				),
				el(
					'div',
					{
						style: {
							height: lib.id === 'daisyui' ? '10px' : '8px',
							borderRadius: barRadius(lib),
							background: lib.surfaceAlt,
							overflow: 'hidden'
						}
					},
					el('div', { style: { width: '{progress}%', height: '100%', borderRadius: barRadius(lib), background: goalFill } })
				),
				el(
					'button',
					{
						type: 'button',
						style: {
							alignSelf: 'flex-start',
							marginTop: '10px',
							padding: '6px 10px',
							border: 'none',
							borderRadius: lib.radius.sm,
							background: 'transparent',
							color: lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid,
							fontFamily: lib.font,
							fontSize: lib.fontSize.sm,
							fontWeight: lib.buttonWeight,
							cursor: 'pointer',
							...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
						}
					},
					'Start again'
				)
			)
		});

		const stageSeg = (widthPct, color) =>
			el('div', {
				style: {
					width: widthPct,
					borderRadius: lib.id === 'reactflow' ? '1px' : '2px',
					background: color
				}
			});

		const stageDot = (color, label) =>
			el(
				'div',
				{ style: { display: 'flex', alignItems: 'center', gap: '4px' } },
				el('span', { style: { width: '6px', height: '6px', borderRadius: '999px', background: color, flexShrink: 0 } }),
				el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, label)
			);

		const sleep = define({
			slug: `${lib.id}-health-fitness-sleep`,
			name: 'Sleep Card',
			library: lib.id,
			category: 'health',
			description: `Sleep summary card in the ${lib.label} style — a big time-asleep figure over a four-segment stage band (deep, core, REM, awake in distinct solids) with a stage legend and a bedtime-to-wake caption row.`,
			tags: ['health', 'sleep', 'stages', 'tracker'],
			args: [
				numberArg('hours', 7, { label: 'Hours', min: 0, max: 24 }),
				numberArg('mins', 42, { label: 'Minutes', min: 0, max: 59 }),
				stringArg('bedtime', '10:48 PM', { label: 'Bedtime', maxLength: 12 }),
				stringArg('wake', '6:30 AM', { label: 'Wake', maxLength: 12 })
			],
			render: card(
				lib,
				'248px',
				el('span', { style: bigNumber(lib) }, '{hours}h {mins}m'),
				el('span', { style: { ...capStyle(lib), marginTop: '2px' } }, 'Time asleep'),
				lib.id === 'thingtime'
					? el('div', { style: { height: '3px', width: '32px', marginTop: '6px', borderRadius: '999px', background: lib.rainbow } })
					: null,
				el(
					'div',
					{ style: { display: 'flex', gap: '2px', height: lib.id === 'daisyui' ? '14px' : '10px', marginTop: '12px' } },
					stageSeg('26%', lib.palette.info.solid),
					stageSeg('40%', lib.palette.primary.solid),
					stageSeg('20%', lib.palette.success.solid),
					stageSeg('14%', lib.palette.warning.solid)
				),
				el(
					'div',
					{ style: { display: 'flex', gap: '10px', marginTop: '8px', flexWrap: 'wrap' } },
					stageDot(lib.palette.info.solid, 'Deep'),
					stageDot(lib.palette.primary.solid, 'Core'),
					stageDot(lib.palette.success.solid, 'REM'),
					stageDot(lib.palette.warning.solid, 'Awake')
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							marginTop: '12px',
							paddingTop: '10px',
							borderTop: `1px solid ${lib.borderSoft}`
						}
					},
					el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, '{bedtime}'),
					icons.arrowRight(12, lib.faint),
					el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, '{wake}')
				)
			)
		});

		const macroBar = (label, gramsToken, widthPct, color) =>
			el(
				'div',
				{ style: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px' } },
				el(
					'div',
					{ style: { display: 'flex', justifyContent: 'space-between', fontSize: lib.fontSize.xs } },
					el('span', { style: { color: lib.muted } }, label),
					el('span', { style: { color: lib.text, fontWeight: lib.headingWeight } }, gramsToken)
				),
				el(
					'div',
					{
						style: {
							height: lib.id === 'daisyui' ? '8px' : '6px',
							borderRadius: barRadius(lib),
							background: lib.surfaceAlt,
							overflow: 'hidden'
						}
					},
					el('div', { style: { width: widthPct, height: '100%', borderRadius: barRadius(lib), background: color } })
				)
			);

		const waterDot = (color) =>
			el('span', { style: { width: '12px', height: '12px', borderRadius: '999px', background: color, flexShrink: 0 } });

		const nutrition = define({
			slug: `${lib.id}-health-fitness-nutrition`,
			name: 'Macros Card',
			library: lib.id,
			category: 'health',
			description: `Nutrition macros card in the ${lib.label} style — a big calorie figure with its goal caption, three fixed-tone macro bars (protein, carbs, fat), and a water tracker row of repeat-driven filled glasses.`,
			tags: ['health', 'nutrition', 'macros', 'calories', 'water'],
			args: [
				stringArg('kcal', '1,842', { label: 'Calories', maxLength: 8 }),
				stringArg('goal', '2,200', { label: 'Goal', maxLength: 8 }),
				numberArg('protein', 96, { label: 'Protein (g)', min: 0, max: 400 }),
				numberArg('glasses', 5, { label: 'Glasses', min: 0, max: 8 })
			],
			render: card(
				lib,
				'236px',
				el('span', { style: bigNumber(lib) }, '{kcal}'),
				el('span', { style: { ...capStyle(lib), marginTop: '2px' } }, 'of {goal} kcal goal'),
				lib.id === 'thingtime'
					? el('div', { style: { height: '3px', width: '32px', marginTop: '6px', borderRadius: '999px', background: lib.rainbow } })
					: null,
				macroBar('Protein', '{protein}g', '72%', lib.palette.success.solid),
				macroBar('Carbs', '218g', '54%', lib.palette.warning.solid),
				macroBar('Fat', '64g', '38%', lib.palette.info.solid),
				el(
					'div',
					{ style: { display: 'flex', justifyContent: 'space-between', marginTop: '14px' } },
					el('span', { style: capStyle(lib) }, 'Water'),
					el('span', { style: { fontSize: lib.fontSize.xs, fontWeight: lib.headingWeight, color: lib.text } }, '{glasses} of 8')
				),
				el(
					'div',
					{ style: { position: 'relative', height: '12px', marginTop: '6px' } },
					el(
						'div',
						{ style: { position: 'absolute', top: '0', left: '0', display: 'flex', gap: '6px' } },
						{ ttRepeat: { count: 8, max: 8, node: waterDot(lib.borderSoft) } }
					),
					el(
						'div',
						{ style: { position: 'absolute', top: '0', left: '0', display: 'flex', gap: '6px' } },
						repeat('glasses', 8, waterDot(lib.palette.info.solid))
					)
				)
			)
		});

		const traceColor = lib.id === 'reactflow' ? lib.accent : lib.palette.danger.solid;

		const heartRate = define({
			slug: `${lib.id}-health-fitness-heart-rate`,
			name: 'Heart Rate Card',
			library: lib.id,
			category: 'health',
			description: `Heart-rate card in the ${lib.label} style — a filled heart glyph beside the title, a big BPM figure, an ECG-ish svg polyline trace on a quiet baseline, and a range caption with a resting chip.`,
			tags: ['health', 'heart-rate', 'bpm', 'ecg', 'vitals'],
			args: [
				stringArg('title', 'Heart rate', { label: 'Title', maxLength: 24 }),
				stringArg('bpm', '72', { label: 'BPM', maxLength: 6 }),
				stringArg('range', '58-142 today', { label: 'Range caption', maxLength: 24 }),
				stringArg('resting', 'Resting 61', { label: 'Resting chip', maxLength: 16 })
			],
			render: card(
				lib,
				'248px',
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
					icons.heart(16, traceColor, true),
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
					)
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'baseline', gap: '6px' } },
					el('span', { style: bigNumber(lib) }, '{bpm}'),
					el('span', { style: capStyle(lib) }, 'BPM')
				),
				el(
					'svg',
					{ width: 216, height: 59, viewBox: '0 0 160 44', xmlns: XMLNS },
					el('line', { x1: 2, y1: 24, x2: 158, y2: 24, stroke: lib.borderSoft, strokeWidth: 1 }),
					el('polyline', {
						points: ECG_POINTS,
						fill: 'none',
						stroke: traceColor,
						strokeWidth: 2,
						strokeLinecap: lineCap(lib),
						strokeLinejoin: 'round'
					})
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' } },
					el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, '{range}'),
					el(
						'span',
						{
							style: {
								padding: '2px 8px',
								borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
								background: lib.surfaceAlt,
								border: `1px solid ${lib.borderSoft}`,
								fontSize: lib.fontSize.xs,
								fontWeight: lib.headingWeight,
								color: lib.text
							}
						},
						'{resting}'
					)
				)
			)
		});

		return [rings, workout, sleep, nutrition, heartRate];
	}
};
