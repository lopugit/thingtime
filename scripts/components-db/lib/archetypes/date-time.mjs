// Date-time archetype — temporal pickers and displays in five renditions:
// mini month calendar, labeled date input, time picker with an open dropdown,
// joined date-range fields with preset chips, and an event countdown. Follows
// the button.mjs exemplar: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs `${lib.id}-date-time-<v>`.
//
// Budget notes: the calendar's day cells run through ONE ttRepeat with a tiny
// (≤6 style props) cell template, and the selected day is a single inline
// accent chip — no per-cell conditionals. ttRepeat.max is validator-capped at
// 24 (REPEAT_HARD_CAP), so months longer than 24 days clamp their cell count.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	map,
	merge,
	numberArg,
	row,
	stack,
	stringArg,
	text
} from '../helpers.mjs';

// Accent used for selected-day chips, focus borders and active presets:
// reactflow's node-graph pink when present, thingtime's rainbow wink for the
// calendar chip, everyone else their primary solid.
const accentSolid = (lib) => lib.accent || lib.palette.primary.solid;
const accentOn = (lib) => (lib.accent ? '#ffffff' : lib.palette.primary.onSolid);

const chevron = (points, size, color) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: color,
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		el('polyline', { points })
	);

const navButton = (lib, points) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				width: '24px',
				height: '24px',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				border: 'none',
				background: 'transparent',
				cursor: 'pointer'
			}
		},
		chevron(points, 14, lib.muted)
	);

// Shared closed-field chrome for the input-like variants (divs, never a real
// input value — typed text renders as styled spans).
const fieldBase = (lib) => ({
	display: 'flex',
	alignItems: 'center',
	gap: '8px',
	height: lib.control.md,
	padding: '0 12px',
	boxSizing: 'border-box',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderRadius: lib.radius.md,
	fontSize: lib.fontSize.md,
	color: lib.text
});

const TIMES = ['09:00', '09:30', '10:00', '10:30'];
const PRESETS = ['Today', '7d', '30d'];

export const archetype = {
	id: 'date-time',
	category: 'forms',
	variants: ['calendar', 'date-input', 'time-picker', 'range', 'countdown'],
	build(lib) {
		const calendar = define({
			slug: `${lib.id}-date-time-calendar`,
			name: 'Mini Calendar',
			library: lib.id,
			category: 'forms',
			description: `Mini month calendar in the ${lib.label} style — chevron month header, S-M-T-W-T-F-S weekday row and a 7-column day grid, with the selected day echoed in an accent chip.`,
			tags: ['calendar', 'date', 'picker', 'month'],
			args: [
				stringArg('month', 'March 2026', { label: 'Month', maxLength: 24 }),
				numberArg('days', 30, { label: 'Days shown', min: 1, max: 31 }),
				numberArg('selected', 14, { label: 'Selected day', min: 1, max: 31 })
			],
			render: stack(
				{
					width: 'fit-content',
					gap: '8px',
					padding: '14px',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.radius.lg,
					boxShadow: lib.id === 'reactflow' ? lib.shadow.lg : lib.shadow.md,
					fontFamily: lib.font
				},
				row(
					{ justifyContent: 'space-between' },
					navButton(lib, '15 18 9 12 15 6'),
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{month}'),
					navButton(lib, '9 6 15 12 9 18')
				),
				el(
					'div',
					{ style: { display: 'grid', gridTemplateColumns: 'repeat(7, 28px)', gap: '2px' } },
					{
						ttRepeat: {
							count: 7,
							max: 7,
							node: el(
								'div',
								{ style: { textAlign: 'center', fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.faint } },
								map('index', { 0: 'S', 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S' })
							)
						}
					}
				),
				el(
					'div',
					{ style: { display: 'grid', gridTemplateColumns: 'repeat(7, 28px)', gap: '2px' } },
					{
						ttRepeat: {
							arg: 'days',
							max: 24,
							node: el(
								'div',
								{
									style: {
										height: '26px',
										lineHeight: '26px',
										textAlign: 'center',
										fontSize: lib.fontSize.sm,
										color: lib.text,
										borderRadius: lib.id === 'daisyui' ? lib.radius.pill : lib.radius.sm
									}
								},
								'{n}'
							)
						}
					}
				),
				row(
					{
						justifyContent: 'space-between',
						paddingTop: '8px',
						borderTopWidth: '1px',
						borderTopStyle: 'solid',
						borderTopColor: lib.borderSoft
					},
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Selected'),
					el(
						'span',
						{
							style: {
								padding: '3px 10px',
								borderRadius: lib.radius.pill,
								background: lib.id === 'thingtime' ? lib.rainbow : accentSolid(lib),
								color: lib.id === 'thingtime' ? '#ffffff' : accentOn(lib),
								fontSize: lib.fontSize.xs,
								fontWeight: 700
							}
						},
						'{selected}'
					)
				)
			)
		});

		const dateInput = define({
			slug: `${lib.id}-date-time-date-input`,
			name: 'Date Input',
			library: lib.id,
			category: 'forms',
			description: `Labeled date field in the ${lib.label} style — calendar glyph beside a formatted date, with the library's focus ring and accent border when focused.`,
			tags: ['date', 'input', 'field', 'form'],
			args: [
				stringArg('label', 'Due date', { label: 'Label', maxLength: 32 }),
				stringArg('date', '12 Aug 2026', { label: 'Date', maxLength: 24 }),
				booleanArg('focused', true, { label: 'Focused' }),
				stringArg('hint', 'DD MMM YYYY', { label: 'Hint', maxLength: 40 })
			],
			render: stack(
				{ gap: '6px', width: '232px', fontFamily: lib.font },
				el('label', { style: { fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text } }, '{label}'),
				el(
					'div',
					{
						style: merge(
							fieldBase(lib),
							iff(
								'focused',
								{ borderColor: accentSolid(lib), boxShadow: lib.focusRing },
								{ borderColor: lib.border, boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none' }
							)
						)
					},
					icons.calendar(16, lib.muted),
					'{date}'
				),
				iff('hint', el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, '{hint}'))
			)
		});

		const timePicker = define({
			slug: `${lib.id}-date-time-time-picker`,
			name: 'Time Picker',
			library: lib.id,
			category: 'forms',
			description: `Time picker in the ${lib.label} style — clock field above an open dropdown of half-hour slots, the chosen time on a soft tint with a check mark.`,
			tags: ['time', 'picker', 'dropdown', 'form'],
			args: [
				stringArg('label', 'Start time', { label: 'Label', maxLength: 32 }),
				enumArg('selected', TIMES, '09:30', { label: 'Selected time' }),
				booleanArg('open', true, { label: 'Open' })
			],
			render: stack(
				{ gap: '6px', width: '208px', fontFamily: lib.font },
				el('label', { style: { fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text } }, '{label}'),
				el(
					'div',
					{
						style: {
							...fieldBase(lib),
							justifyContent: 'space-between',
							borderColor: lib.border,
							boxShadow: lib.shadow.sm
						}
					},
					row({ gap: '8px' }, icons.clock(16, lib.muted), '{selected}'),
					icons.chevronDown(14, lib.faint)
				),
				iff(
					'open',
					stack(
						{
							gap: '2px',
							padding: '4px',
							background: lib.surface,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.borderSoft,
							borderRadius: lib.radius.md,
							boxShadow: lib.shadow.lg
						},
						TIMES.map((time) =>
							el(
								'div',
								{
									style: merge(
										{
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'space-between',
											padding: '6px 10px',
											borderRadius: lib.radius.sm,
											fontSize: lib.fontSize.sm,
											color: lib.text,
											cursor: 'pointer'
										},
										ifEq(
											'selected',
											time,
											{
												background: lib.palette.primary.soft,
												color: lib.palette.primary.onSoft,
												fontWeight: 600
											},
											{}
										)
									)
								},
								time,
								ifEq('selected', time, icons.check(14, 'currentColor'))
							)
						)
					)
				)
			)
		});

		const range = define({
			slug: `${lib.id}-date-time-range`,
			name: 'Date Range Picker',
			library: lib.id,
			category: 'forms',
			description: `Date range control in the ${lib.label} style — two joined date fields bridged by an arrow, under a row of quick preset chips with one active.`,
			tags: ['date', 'range', 'picker', 'preset'],
			args: [
				stringArg('start', '01 Aug 2026', { label: 'Start date', maxLength: 24 }),
				stringArg('end', '30 Aug 2026', { label: 'End date', maxLength: 24 }),
				enumArg('preset', PRESETS, '30d', { label: 'Active preset' })
			],
			render: stack(
				{ gap: '10px', width: 'fit-content', fontFamily: lib.font },
				row(
					{
						display: 'inline-flex',
						background: lib.surface,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.border,
						borderRadius: lib.radius.md,
						boxShadow: lib.shadow.sm,
						overflow: 'hidden'
					},
					row(
						{ gap: '6px', height: lib.control.md, padding: '0 12px', fontSize: lib.fontSize.sm, color: lib.text },
						icons.calendar(14, lib.muted),
						'{start}'
					),
					el(
						'div',
						{
							style: {
								display: 'flex',
								alignItems: 'center',
								alignSelf: 'stretch',
								padding: '0 8px',
								background: lib.surfaceAlt
							}
						},
						icons.arrowRight(14, lib.id === 'reactflow' ? lib.accent : lib.muted)
					),
					row(
						{ gap: '6px', height: lib.control.md, padding: '0 12px', fontSize: lib.fontSize.sm, color: lib.text },
						'{end}'
					)
				),
				row(
					{ gap: '6px' },
					PRESETS.map((preset) =>
						el(
							'span',
							{
								style: merge(
									{
										padding: '4px 12px',
										borderRadius: lib.id === 'antd' ? lib.radius.sm : lib.radius.pill,
										borderWidth: '1px',
										borderStyle: 'solid',
										fontSize: lib.fontSize.xs,
										fontWeight: 600,
										cursor: 'pointer'
									},
									ifEq(
										'preset',
										preset,
										{ background: accentSolid(lib), borderColor: accentSolid(lib), color: accentOn(lib) },
										{ background: lib.surface, borderColor: lib.border, color: lib.muted }
									)
								)
							},
							preset
						)
					)
				)
			)
		});

		const countdownTile = (value, unit) =>
			stack(
				{
					alignItems: 'center',
					justifyContent: 'center',
					width: lib.id === 'daisyui' ? '64px' : '56px',
					height: lib.id === 'daisyui' ? '64px' : '56px',
					background: lib.surfaceAlt,
					borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.md,
					...(lib.id === 'reactflow' ? { borderWidth: '1px', borderStyle: 'solid', borderColor: lib.border } : {})
				},
				text(
					{
						fontSize: lib.fontSize.xl,
						fontWeight: lib.headingWeight,
						color: lib.text,
						...(lib.id === 'reactflow' ? { fontFamily: lib.fontMono } : {})
					},
					value
				),
				text({ fontSize: lib.fontSize.xs, color: lib.muted }, unit)
			);

		const countdown = define({
			slug: `${lib.id}-date-time-countdown`,
			name: 'Event Countdown',
			library: lib.id,
			category: 'forms',
			description: `Event countdown in the ${lib.label} style — days, hours and minutes as big numbers in ${lib.id === 'daisyui' ? 'chunky' : lib.id === 'reactflow' ? 'crisp bordered' : 'quiet'} tiles with unit captions, above the event name${lib.id === 'thingtime' ? ', topped with the house rainbow strip' : ''}.`,
			tags: ['countdown', 'timer', 'event', 'time'],
			args: [
				stringArg('event', 'Launch day', { label: 'Event name', maxLength: 40 }),
				stringArg('days', '03', { label: 'Days', maxLength: 3 }),
				stringArg('hours', '12', { label: 'Hours', maxLength: 2 }),
				stringArg('mins', '45', { label: 'Minutes', maxLength: 2 })
			],
			render: stack(
				{
					alignItems: 'center',
					gap: '10px',
					width: 'fit-content',
					padding: lib.id === 'daisyui' ? '20px' : '16px',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.radius.lg,
					boxShadow: lib.shadow.md,
					fontFamily: lib.font,
					position: 'relative',
					overflow: 'hidden'
				},
				lib.id === 'thingtime' &&
					el('div', { style: { position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: lib.rainbow } }),
				row(
					{ gap: '8px' },
					countdownTile('{days}', 'days'),
					countdownTile('{hours}', 'hours'),
					countdownTile('{mins}', 'mins')
				),
				text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.muted }, '{event}')
			)
		});

		return [calendar, dateInput, timePicker, range, countdown];
	}
};
