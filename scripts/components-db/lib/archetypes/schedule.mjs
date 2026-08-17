// Schedule archetype — calendar-app surfaces (views, not pickers; the
// date-time archetype owns pickers) in five renditions: a calendar event
// card, a day agenda list, a mini week view, an availability slot row and a
// booking summary card. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-schedule-<variant>`.
//
// Budget notes: agenda rows, week columns and availability chips are
// deliberately non-identical (times, labels, tones vary), so the variety
// lives in plain JS helpers instead of ttRepeat, and the heavy 6-tone
// toneMaps are reserved for the few spots the tone arg actually drives
// (event rail + join button, agenda highlight row, week wash + today block,
// booking chip + confirm). Selected availability chips use a fixed
// per-library accent so seven chips never carry seven toneMaps.

import {
	avatarCircle,
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	merge,
	numberArg,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Fixed accent for selected slots: reactflow's graph pink when present,
// everyone else their primary solid (thingtime's primary is its ink).
const accentSolid = (lib) => lib.accent || lib.palette.primary.solid;
const accentOn = (lib) => (lib.accent ? '#ffffff' : lib.palette.primary.onSolid);

// The agenda's "now" hairline: thingtime winks in rainbow, reactflow uses its
// node-graph pink, everyone else runs the classic red-line-of-now.
const nowFill = (lib) => (lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.accent : lib.palette.danger.solid);

// mui buttons stay UPPERCASE; everyone else keeps sentence case.
const upper = (lib) => (lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {});

// mui cards float on elevation; untitled keeps its feather shadow; the rest
// sit on the quiet small shadow.
const cardShadow = (lib) => (lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm);

const cardChrome = (lib) => ({
	boxSizing: 'border-box',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: cardShadow(lib),
	fontFamily: lib.font
});

// Map-pin glyph (circle + path — no defs/gradients/text).
const pinIcon = (size, color) =>
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
		el('path', { d: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z' }),
		el('circle', { cx: 12, cy: 10, r: 3 })
	);

// One agenda time-slot row: fixed-width time column + a soft event card.
const slotRow = (lib, time, label, cardStyle) =>
	row(
		{ gap: '10px' },
		text({ width: '44px', flexShrink: 0, fontSize: lib.fontSize.xs, color: lib.faint, fontWeight: 500 }, time),
		el(
			'div',
			{
				style: {
					flex: 1,
					padding: '8px 10px',
					borderRadius: lib.radius.sm,
					fontSize: lib.fontSize.sm,
					fontWeight: 600,
					...cardStyle
				}
			},
			label
		)
	);

// One mini-week day column: header + relatively-positioned block canvas.
// The wash + bold header light up when the `today` arg matches the label.
const dayCol = (lib, label, blocks) =>
	el(
		'div',
		{
			style: merge(
				{
					flex: 1,
					display: 'flex',
					flexDirection: 'column',
					gap: '4px',
					padding: '6px 3px',
					borderRadius: lib.radius.sm
				},
				ifEq('today', label, { background: toneMap(lib, (palette) => palette.soft) })
			)
		},
		el(
			'span',
			{
				style: merge(
					{ fontSize: lib.fontSize.xs, color: lib.muted, fontWeight: 500, textAlign: 'center' },
					ifEq('today', label, { color: lib.text, fontWeight: 700 })
				)
			},
			label
		),
		el('div', { style: { position: 'relative', height: '84px' } }, ...blocks)
	);

const weekBlock = (lib, top, height, background) =>
	el('div', {
		style: { position: 'absolute', top, left: '2px', right: '2px', height, borderRadius: lib.radius.xs, background }
	});

// One availability chip; the `selected` arg lights exactly one up in the
// library accent. daisyui keeps chunkier corners, untitled a feather shadow.
const slotChip = (lib, time) =>
	el(
		'span',
		{
			style: merge(
				{
					padding: '7px 12px',
					borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					background: lib.surface,
					color: lib.text,
					fontSize: lib.fontSize.sm,
					fontWeight: 500,
					cursor: 'pointer',
					boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
				},
				ifEq('selected', time, {
					background: accentSolid(lib),
					borderColor: accentSolid(lib),
					color: accentOn(lib)
				})
			)
		},
		time
	);

const struckChip = (lib, time) =>
	el(
		'span',
		{
			style: {
				padding: '7px 12px',
				borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: lib.borderSoft,
				background: lib.surfaceAlt,
				color: lib.faint,
				fontSize: lib.fontSize.sm,
				fontWeight: 500,
				textDecoration: 'line-through',
				cursor: 'not-allowed'
			}
		},
		time
	);

export const archetype = {
	id: 'schedule',
	category: 'scheduling',
	variants: ['event', 'agenda', 'week', 'availability', 'booking'],
	build(lib) {
		const event = define({
			slug: `${lib.id}-schedule-event`,
			name: 'Calendar Event Card',
			library: lib.id,
			category: 'scheduling',
			description: `Calendar event card in the ${lib.label} style — tone-colored left rail beside the title and time range, a map-pin location caption, overlapping attendee avatars with a +N chip and an optional ${lib.uppercaseButtons ? 'uppercase ' : ''}join button.`,
			tags: ['calendar', 'event', 'card', 'meeting'],
			args: [
				stringArg('title', 'Design sync', { label: 'Title', maxLength: 40 }),
				stringArg('time', '9:00 – 9:45 AM', { label: 'Time range', maxLength: 32 }),
				stringArg('location', 'Studio 4 · Level 2', { label: 'Location', maxLength: 40 }),
				toneArg(),
				numberArg('extra', 3, { label: 'Extra attendees', min: 0, max: 99 }),
				booleanArg('join', true, { label: 'Join button' })
			],
			render: stack(
				{
					width: '300px',
					gap: '10px',
					padding: '14px 16px',
					boxSizing: 'border-box',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderLeftWidth: '4px',
					borderLeftColor: toneMap(lib, (palette) => palette.solid),
					borderRadius: lib.radius.md,
					boxShadow: cardShadow(lib),
					fontFamily: lib.font
				},
				stack(
					{ gap: '2px' },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
					text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{time}')
				),
				row({ gap: '6px', color: lib.muted, fontSize: lib.fontSize.sm }, pinIcon(14, lib.faint), '{location}'),
				row(
					{ gap: '8px' },
					avatarCircle('26px', lib.palette.info.soft, lib.palette.info.onSoft, 'AK', lib.fontSize.xs),
					avatarCircle('26px', lib.palette.success.soft, lib.palette.success.onSoft, 'JR', lib.fontSize.xs, {
						marginLeft: '-8px',
						boxShadow: `0 0 0 2px ${lib.surface}`
					}),
					el(
						'span',
						{
							style: {
								height: '26px',
								minWidth: '26px',
								padding: '0 6px',
								boxSizing: 'border-box',
								marginLeft: '-8px',
								boxShadow: `0 0 0 2px ${lib.surface}`,
								borderRadius: lib.radius.pill,
								background: lib.surfaceAlt,
								color: lib.muted,
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontSize: lib.fontSize.xs,
								fontWeight: 600
							}
						},
						'+{extra}'
					),
					el('span', { style: { flex: 1 } }),
					iff(
						'join',
						el(
							'button',
							{
								type: 'button',
								style: {
									height: lib.control.sm,
									padding: '0 12px',
									border: 'none',
									borderRadius: lib.radius.sm,
									background: toneMap(lib, (palette) => palette.solid),
									color: toneMap(lib, (palette) => palette.onSolid),
									fontFamily: lib.font,
									fontSize: lib.fontSize.sm,
									fontWeight: lib.buttonWeight,
									cursor: 'pointer',
									...upper(lib)
								}
							},
							'Join'
						)
					)
				)
			)
		});

		const agenda = define({
			slug: `${lib.id}-schedule-agenda`,
			name: 'Day Agenda List',
			library: lib.id,
			category: 'scheduling',
			description: `Day agenda list in the ${lib.label} style — bold day header with a muted date, three time-slotted event rows in soft tone washes and a ${lib.id === 'thingtime' ? 'rainbow' : 'colored'} now-hairline with a dot pinned between slots.`,
			tags: ['calendar', 'agenda', 'schedule', 'day'],
			args: [
				stringArg('day', 'Tuesday', { label: 'Day', maxLength: 16 }),
				stringArg('date', 'March 14', { label: 'Date', maxLength: 24 }),
				toneArg(),
				booleanArg('showNow', true, { label: 'Now line' })
			],
			render: stack(
				{ width: '300px', gap: '10px', padding: '14px 16px', ...cardChrome(lib) },
				row(
					{ gap: '8px', alignItems: 'baseline' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, '{day}'),
					text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{date}')
				),
				slotRow(lib, '9:00', 'Standup', {
					background: toneMap(lib, (palette) => palette.soft),
					color: toneMap(lib, (palette) => palette.onSoft)
				}),
				iff(
					'showNow',
					row(
						{ gap: '6px' },
						el('span', {
							style: { width: '8px', height: '8px', borderRadius: lib.radius.pill, background: nowFill(lib), flexShrink: 0 }
						}),
						el('span', { style: { flex: 1, height: '2px', borderRadius: lib.radius.pill, background: nowFill(lib) } })
					)
				),
				slotRow(lib, '10:30', 'Design review', { background: lib.palette.info.soft, color: lib.palette.info.onSoft }),
				slotRow(lib, '1:00', 'Roadmap sync', { background: lib.surfaceAlt, color: lib.muted })
			)
		});

		const week = define({
			slug: `${lib.id}-schedule-week`,
			name: 'Mini Week View',
			library: lib.id,
			category: 'scheduling',
			description: `Mini week view in the ${lib.label} style — five day columns under a range caption with positioned event blocks in varying tones and heights; the chosen today column wears a soft tone wash and a bold header${lib.id === 'reactflow' ? ', over the dotted node-canvas background' : ''}.`,
			tags: ['calendar', 'week', 'grid', 'events'],
			args: [
				stringArg('label', 'March 10 – 14', { label: 'Range label', maxLength: 32 }),
				enumArg('today', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 'Wed', { label: 'Today' }),
				toneArg()
			],
			render: stack(
				{ width: '320px', gap: '10px', padding: '14px', ...cardChrome(lib) },
				text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{label}'),
				el(
					'div',
					{
						style: {
							display: 'flex',
							gap: '4px',
							...(lib.id === 'reactflow'
								? { backgroundImage: `radial-gradient(${lib.dot} 1px, transparent 1px)`, backgroundSize: '10px 10px' }
								: {})
						}
					},
					dayCol(lib, 'Mon', [weekBlock(lib, '8px', '26px', lib.palette.info.solid)]),
					dayCol(lib, 'Tue', [weekBlock(lib, '30px', '18px', lib.palette.success.solid)]),
					dayCol(lib, 'Wed', [weekBlock(lib, '4px', '34px', toneMap(lib, (palette) => palette.solid))]),
					dayCol(lib, 'Thu', [weekBlock(lib, '44px', '22px', lib.palette.warning.solid)]),
					dayCol(lib, 'Fri', [
						weekBlock(lib, '12px', '20px', lib.palette.danger.solid),
						weekBlock(lib, '52px', '24px', lib.palette.info.solid)
					])
				)
			)
		});

		const availability = define({
			slug: `${lib.id}-schedule-availability`,
			name: 'Availability Slots',
			library: lib.id,
			category: 'scheduling',
			description: `Availability slot row in the ${lib.label} style — a heading over seven wrapped time chips with the chosen slot filled in the library accent, one struck sold-out slot and a timezone caption with a clock glyph.`,
			tags: ['availability', 'time-slots', 'booking', 'picker'],
			args: [
				stringArg('heading', 'Select a time', { label: 'Heading', maxLength: 32 }),
				enumArg('selected', ['9:00', '9:30', '10:00', '10:30', '11:30', '12:00'], '10:00', { label: 'Selected slot' }),
				stringArg('timezone', 'GMT+10 · Sydney', { label: 'Timezone', maxLength: 32 })
			],
			render: stack(
				{ width: '320px', gap: '12px', padding: '16px', ...cardChrome(lib) },
				text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{heading}'),
				el(
					'div',
					{ style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
					slotChip(lib, '9:00'),
					slotChip(lib, '9:30'),
					slotChip(lib, '10:00'),
					slotChip(lib, '10:30'),
					struckChip(lib, '11:00'),
					slotChip(lib, '11:30'),
					slotChip(lib, '12:00')
				),
				row({ gap: '6px', color: lib.faint, fontSize: lib.fontSize.xs }, icons.clock(12, lib.faint), '{timezone}')
			)
		});

		const booking = define({
			slug: `${lib.id}-schedule-booking`,
			name: 'Booking Summary Card',
			library: lib.id,
			category: 'scheduling',
			description: `Booking summary card in the ${lib.label} style — host avatar and name over the meeting title with a tone duration chip, a date-and-time slot panel, a ${lib.uppercaseButtons ? 'uppercase ' : ''}confirm button beside a ghost reschedule and a mono powered-by caption.`,
			tags: ['booking', 'meeting', 'summary', 'confirm'],
			args: [
				stringArg('host', 'Alex Rivera', { label: 'Host', maxLength: 40 }),
				stringArg('title', 'Intro call', { label: 'Meeting title', maxLength: 40 }),
				numberArg('duration', 30, { label: 'Duration (min)', min: 5, max: 240 }),
				stringArg('date', 'Fri, Mar 14', { label: 'Date', maxLength: 24 }),
				stringArg('time', '10:00 AM', { label: 'Time', maxLength: 16 }),
				toneArg()
			],
			render: stack(
				{ width: '320px', gap: '12px', padding: '16px', ...cardChrome(lib) },
				row(
					{ gap: '10px' },
					avatarCircle('36px', lib.surfaceAlt, lib.muted, icons.user(18, 'currentColor'), lib.fontSize.sm),
					stack(
						{ gap: '2px' },
						text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{host}'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Host')
					)
				),
				row(
					{ gap: '8px', justifyContent: 'space-between' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
					el(
						'span',
						{
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								gap: '4px',
								padding: '2px 8px',
								borderRadius: lib.radius.pill,
								background: toneMap(lib, (palette) => palette.soft),
								color: toneMap(lib, (palette) => palette.onSoft),
								fontSize: lib.fontSize.xs,
								fontWeight: 600
							}
						},
						icons.clock(12, 'currentColor'),
						'{duration} min'
					)
				),
				row(
					{
						gap: '8px',
						padding: '10px 12px',
						borderRadius: lib.radius.sm,
						background: lib.surfaceAlt,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.borderSoft,
						fontSize: lib.fontSize.sm,
						fontWeight: 500,
						color: lib.text
					},
					icons.calendar(14, lib.muted),
					'{date} · {time}'
				),
				row(
					{ gap: '8px' },
					el(
						'button',
						{
							type: 'button',
							style: {
								flex: 1,
								height: lib.control.md,
								border: 'none',
								borderRadius: lib.radius.md,
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								fontWeight: lib.buttonWeight,
								cursor: 'pointer',
								...upper(lib)
							}
						},
						'Confirm'
					),
					el(
						'button',
						{
							type: 'button',
							style: {
								height: lib.control.md,
								padding: '0 12px',
								border: 'none',
								borderRadius: lib.radius.md,
								background: 'transparent',
								color: lib.muted,
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								fontWeight: lib.buttonWeight,
								cursor: 'pointer',
								...upper(lib)
							}
						},
						'Reschedule'
					)
				),
				text(
					{ fontSize: lib.fontSize.xs, color: lib.faint, fontFamily: lib.fontMono, textAlign: 'center' },
					`Powered by ${lib.label}`
				)
			)
		});

		return [event, agenda, week, availability, booking];
	}
};
