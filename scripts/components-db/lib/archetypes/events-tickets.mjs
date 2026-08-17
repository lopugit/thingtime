// Events & tickets archetype — event and ticketing surfaces in five
// renditions: event card, perforated ticket stub, seat map, lineup schedule,
// and an on-sale countdown banner. Follows the button.mjs exemplar: exactly
// 5 variants, `build(lib)` returns exactly 5 definitions (one per variant,
// same order), slugs `${lib.id}-events-tickets-<variant>`.

import {
	avatarCircle,
	define,
	el,
	enumArg,
	icons,
	ifEq,
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

// Shared card shell. reactflow's dark border token gives it node-crisp edges
// for free; mui rides one elevation step higher than everyone else.
const card = (lib, extra = {}) => ({
	display: 'flex',
	flexDirection: 'column',
	fontFamily: lib.font,
	color: lib.text,
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	boxSizing: 'border-box',
	...extra
});

// antd chips sit on tight tag corners; everyone else wears the pill.
const chip = (lib, extra = {}) => ({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '4px',
	padding: '2px 8px',
	borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
	fontSize: lib.fontSize.xs,
	fontWeight: 600,
	lineHeight: 1.4,
	...extra
});

const btn = (lib, extra = {}) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: lib.control.sm,
	padding: '0 14px',
	border: 'none',
	borderRadius: lib.radius.md,
	fontFamily: lib.font,
	fontSize: lib.fontSize.sm,
	fontWeight: lib.buttonWeight,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {}),
	...extra
});

const caption = (lib, extra = {}) => ({ fontSize: lib.fontSize.xs, color: lib.muted, ...extra });

// QR mock: fill-only rect grid (three finder squares with punched centers plus
// scattered data cells) — stays inside the svg/rect allowlist, no defs needed.
const qrMock = (lib) => {
	const dark = lib.id === 'thingtime' ? lib.ink : lib.text;
	const cell = (x, y, size, fill) => el('rect', { x, y, width: size, height: size, fill });
	return el(
		'svg',
		{ width: 40, height: 40, viewBox: '0 0 40 40', xmlns: 'http://www.w3.org/2000/svg' },
		cell(2, 2, 12, dark),
		cell(6, 6, 4, lib.surface),
		cell(26, 2, 12, dark),
		cell(30, 6, 4, lib.surface),
		cell(2, 26, 12, dark),
		cell(6, 30, 4, lib.surface),
		cell(18, 4, 4, dark),
		cell(24, 12, 4, dark),
		cell(16, 18, 4, dark),
		cell(30, 22, 4, dark),
		cell(20, 26, 4, dark),
		cell(32, 32, 4, dark)
	);
};

export const archetype = {
	id: 'events-tickets',
	category: 'events',
	variants: ['event', 'ticket', 'seats', 'lineup', 'on-sale'],
	build(lib) {
		const event = define({
			slug: `${lib.id}-events-tickets-event`,
			name: 'Event Card',
			library: lib.id,
			category: 'events',
			description: `Event listing card in the ${lib.label} style — a tone-soft date square beside the title and venue, time and from-price chips, a going-avatars pair with an interested count, and a Get-tickets action.`,
			tags: ['event', 'card', 'tickets', 'listing'],
			args: [
				stringArg('title', 'Midnight Frequencies Tour', { label: 'Title', maxLength: 60 }),
				stringArg('venue', 'Forum Theatre · Melbourne', { label: 'Venue', maxLength: 60 }),
				stringArg('day', '24', { label: 'Day', maxLength: 2 }),
				stringArg('mon', 'Jun', { label: 'Month', maxLength: 3 }),
				stringArg('price', '$59', { label: 'From price', maxLength: 8 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: card(lib, { width: '320px', padding: '14px', gap: '12px' }) },
				row(
					{ gap: '12px', alignItems: 'flex-start' },
					stack(
						{
							alignItems: 'center',
							justifyContent: 'center',
							width: '52px',
							height: '52px',
							flexShrink: 0,
							borderRadius: lib.radius.md,
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft),
							...(lib.id === 'reactflow'
								? { borderWidth: '1px', borderStyle: 'solid', borderColor: toneMap(lib, (palette) => palette.border) }
								: {})
						},
						text({ fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight, lineHeight: 1.1 }, '{day}'),
						text({ fontSize: lib.fontSize.xs, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }, '{mon}')
					),
					stack(
						{ gap: '2px', minWidth: 0 },
						text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, '{title}'),
						text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{venue}'),
						row(
							{ gap: '6px', marginTop: '6px' },
							el(
								'span',
								{ style: chip(lib, { background: lib.surfaceAlt, color: lib.muted }) },
								icons.clock(12, 'currentColor'),
								'7:30 PM'
							),
							el('span', { style: chip(lib, { background: lib.surfaceAlt, color: lib.muted }) }, 'From {price}')
						)
					)
				),
				row(
					{ gap: '8px' },
					avatarCircle('22px', lib.palette.info.soft, lib.palette.info.onSoft, 'AK', lib.fontSize.xs),
					avatarCircle('22px', lib.palette.success.soft, lib.palette.success.onSoft, 'MJ', lib.fontSize.xs, {
						marginLeft: '-8px'
					}),
					el('span', { style: chip(lib, { background: lib.surfaceAlt, color: lib.muted, fontWeight: 500 }) }, '+412 interested'),
					el(
						'button',
						{
							type: 'button',
							style: btn(lib, {
								marginLeft: 'auto',
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid)
							})
						},
						'Get tickets'
					)
				)
			)
		});

		const ticket = define({
			slug: `${lib.id}-events-tickets-ticket`,
			name: 'Ticket Stub',
			library: lib.id,
			category: 'events',
			description: `Perforated ticket stub in the ${lib.label} style — event, date and seat panel joined to a QR-and-gate panel by a dashed perforation with punched notches, over a barcode strip.`,
			tags: ['ticket', 'stub', 'pass', 'qr', 'admission'],
			args: [
				stringArg('event', 'Midnight Frequencies', { label: 'Event', maxLength: 40 }),
				stringArg('date', 'Fri 24 Jun', { label: 'Date', maxLength: 24 }),
				stringArg('seat', 'C 12', { label: 'Seat', maxLength: 8 }),
				stringArg('gate', 'B', { label: 'Gate', maxLength: 4 }),
				toneArg()
			],
			previewBg: lib.bg,
			render: el(
				'div',
				{ style: card(lib, { width: '340px', overflow: 'hidden' }) },
				el('div', {
					style: {
						height: '6px',
						background: toneMap(lib, (palette) => palette.solid),
						...(lib.id === 'thingtime' ? { background: lib.rainbow } : {})
					}
				}),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'stretch' } },
					stack(
						{ flex: 1, minWidth: 0, padding: '12px 14px', gap: '8px', justifyContent: 'center' },
						text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, '{event}'),
						row(
							{ justifyContent: 'space-between', gap: '8px' },
							text(caption(lib, { letterSpacing: '0.5px', textTransform: 'uppercase' }), 'Date'),
							text({ fontSize: lib.fontSize.sm, fontWeight: 600 }, '{date}')
						),
						row(
							{ justifyContent: 'space-between', gap: '8px' },
							text(caption(lib, { letterSpacing: '0.5px', textTransform: 'uppercase' }), 'Seat'),
							text({ fontSize: lib.fontSize.sm, fontWeight: 700, color: toneMap(lib, (palette) => palette.solid) }, '{seat}')
						)
					),
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '14px', flexShrink: 0 } },
						el('div', { style: { width: '14px', height: '14px', borderRadius: '999px', background: lib.bg, flexShrink: 0, marginTop: '-7px' } }),
						el('div', { style: { flex: 1, width: 0, borderLeft: `1px dashed ${lib.border}` } }),
						el('div', { style: { width: '14px', height: '14px', borderRadius: '999px', background: lib.bg, flexShrink: 0, marginBottom: '-7px' } })
					),
					stack(
						{ alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '12px 14px', background: lib.surfaceAlt },
						el(
							'div',
							{
								style: {
									display: 'flex',
									padding: '5px',
									background: lib.surface,
									borderRadius: lib.radius.xs,
									...(lib.id === 'reactflow' ? { borderWidth: '1px', borderStyle: 'solid', borderColor: lib.border } : {})
								}
							},
							qrMock(lib)
						),
						text(caption(lib, { letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 600 }), 'Gate {gate}')
					)
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							justifyContent: 'center',
							gap: '3px',
							padding: '10px 14px',
							borderTop: `1px dashed ${lib.border}`
						}
					},
					{
						ttRepeat: {
							count: 12,
							max: 12,
							node: el(
								'div',
								{ style: { display: 'flex', gap: '3px' } },
								el('div', { style: { width: '3px', height: '16px', background: lib.id === 'thingtime' ? lib.ink : lib.text } }),
								el('div', { style: { width: '1px', height: '16px', background: lib.faint } })
							)
						}
					}
				)
			)
		});

		// Seat geometry: 16px seats + 6px gaps → a 22px pitch both ways, so the
		// selected overlay lands exactly on the (row, seat) cell via calc.
		const seatRow = (takenSeats) =>
			row({ gap: '6px' }, {
				ttRepeat: {
					count: 8,
					max: 8,
					node: el('div', {
						style: merge(
							{ width: '16px', height: '16px', borderRadius: lib.radius.xs, boxSizing: 'border-box' },
							map(
								'n',
								Object.fromEntries(takenSeats.map((seat) => [String(seat), { background: lib.faint }])),
								{ background: lib.surfaceAlt, border: `1px solid ${lib.border}` }
							)
						)
					})
				}
			});

		const legendSwatch = (swatchStyle, label) =>
			row(
				{ gap: '5px' },
				el('div', { style: { width: '10px', height: '10px', borderRadius: lib.radius.xs, ...swatchStyle } }),
				label
			);

		const seats = define({
			slug: `${lib.id}-events-tickets-seats`,
			name: 'Seat Map',
			library: lib.id,
			category: 'events',
			description: `Seat picker in the ${lib.label} style — a stage band over four rows of eight seats (soft available, faint taken), the chosen row-and-seat pair rendered as a ringed tone seat with a matching chip and legend.`,
			tags: ['seats', 'seat-map', 'venue', 'picker', 'tickets'],
			args: [
				stringArg('section', 'Section C · Stalls', { label: 'Section', maxLength: 40 }),
				enumArg('row', ['A', 'B', 'C', 'D'], 'B', { label: 'Row' }),
				numberArg('seat', 4, { label: 'Seat', min: 1, max: 8 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: card(lib, { width: '280px', padding: '14px', gap: '10px' }) },
				row(
					{ justifyContent: 'space-between', gap: '8px' },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{section}'),
					el(
						'span',
						{
							style: chip(lib, {
								background: toneMap(lib, (palette) => palette.soft),
								color: toneMap(lib, (palette) => palette.onSoft),
								...(lib.id === 'antd'
									? { borderWidth: '1px', borderStyle: 'solid', borderColor: toneMap(lib, (palette) => palette.border) }
									: {})
							})
						},
						'{row}{seat}'
					)
				),
				el(
					'div',
					{
						style: {
							padding: '4px 0',
							textAlign: 'center',
							fontSize: lib.fontSize.xs,
							fontWeight: 700,
							letterSpacing: '2px',
							textTransform: 'uppercase',
							borderRadius: lib.radius.sm,
							background: lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.text : lib.surfaceAlt,
							color: lib.id === 'thingtime' ? lib.ink : lib.id === 'reactflow' ? lib.surface : lib.muted
						}
					},
					'Stage'
				),
				el(
					'div',
					{ style: { position: 'relative', alignSelf: 'center', display: 'flex', flexDirection: 'column', gap: '6px' } },
					seatRow([3, 6]),
					seatRow([1, 8]),
					seatRow([4, 5]),
					seatRow([2, 7]),
					el('div', {
						style: {
							position: 'absolute',
							top: map('row', { A: '0px', B: '22px', C: '44px', D: '66px' }, '22px'),
							left: 'calc(({seat} - 1) * 22px)',
							width: '16px',
							height: '16px',
							borderRadius: lib.radius.xs,
							background: toneMap(lib, (palette) => palette.solid),
							boxShadow: lib.focusRing
						}
					})
				),
				row(
					{ gap: '12px', ...caption(lib) },
					legendSwatch({ background: lib.surfaceAlt, border: `1px solid ${lib.border}` }, 'Open'),
					legendSwatch({ background: lib.faint }, 'Taken'),
					legendSwatch({ background: toneMap(lib, (palette) => palette.solid) }, 'Yours')
				)
			)
		});

		const actRow = (key, timeStr, actName, setLength, headliner) =>
			el(
				'div',
				{
					style: merge(
						{
							display: 'flex',
							alignItems: 'center',
							gap: '10px',
							padding: '8px 10px',
							borderRadius: lib.radius.sm,
							...(lib.id === 'reactflow' ? { borderWidth: '1px', borderStyle: 'solid', borderColor: lib.borderSoft } : {})
						},
						ifEq('onNow', key, { background: lib.surfaceAlt }, {})
					)
				},
				text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.sm, color: lib.muted, width: '42px', flexShrink: 0 }, timeStr),
				stack(
					{ gap: '1px', minWidth: 0, flex: 1 },
					row(
						{ gap: '6px' },
						text({ fontSize: lib.fontSize.md, fontWeight: headliner ? lib.headingWeight : 500 }, actName),
						headliner
							? el(
									'span',
									{
										style: chip(lib, {
											background: toneMap(lib, (palette) => palette.soft),
											color: toneMap(lib, (palette) => palette.onSoft),
											...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
										})
									},
									'Headliner'
								)
							: null
					),
					text({ fontSize: lib.fontSize.xs, color: lib.faint }, setLength)
				),
				ifEq(
					'onNow',
					key,
					row(
						{ gap: '5px', flexShrink: 0 },
						el('div', { style: { width: '8px', height: '8px', borderRadius: '999px', background: toneMap(lib, (palette) => palette.solid) } }),
						text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.muted }, 'On now')
					)
				)
			);

		const lineup = define({
			slug: `${lib.id}-events-tickets-lineup`,
			name: 'Lineup Schedule',
			library: lib.id,
			category: 'events',
			description: `Stage lineup schedule in the ${lib.label} style — three act rows with mono time column and set-length captions, a tone-chipped bold headliner, and the on-now act highlighted with a tone dot.`,
			tags: ['lineup', 'schedule', 'stage', 'festival', 'acts'],
			args: [
				stringArg('stage', 'Main Stage', { label: 'Stage', maxLength: 30 }),
				stringArg('act1', 'Neon Harbour', { label: 'Opener', maxLength: 30 }),
				stringArg('act2', 'Glass Atlas', { label: 'Support', maxLength: 30 }),
				stringArg('headliner', 'Midnight Frequencies', { label: 'Headliner', maxLength: 30 }),
				enumArg('onNow', ['opener', 'support', 'headliner'], 'support', { label: 'On now' }),
				toneArg()
			],
			render: el(
				'div',
				{ style: card(lib, { width: '320px', padding: '12px', gap: '6px' }) },
				row(
					{ justifyContent: 'space-between', gap: '8px', padding: '0 10px 4px' },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{stage}'),
					icons.calendar(14, lib.muted)
				),
				actRow('opener', '7:00', '{act1}', '40 min set', false),
				actRow('support', '8:15', '{act2}', '50 min set', false),
				actRow('headliner', '9:45', '{headliner}', '90 min set', true)
			)
		});

		const countdownTile = (value, unit) =>
			stack(
				{
					alignItems: 'center',
					gap: '1px',
					minWidth: '44px',
					padding: '6px 8px',
					boxSizing: 'border-box',
					borderRadius: lib.radius.sm,
					background: lib.id === 'thingtime' ? lib.ink : lib.surfaceAlt,
					color: lib.id === 'thingtime' ? lib.surface : lib.text,
					...(lib.id === 'reactflow' ? { borderWidth: '1px', borderStyle: 'solid', borderColor: lib.borderSoft } : {})
				},
				text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.lg, fontWeight: 700, lineHeight: 1.2 }, value),
				text({ fontSize: lib.fontSize.xs, opacity: 0.65 }, unit)
			);

		const onSale = define({
			slug: `${lib.id}-events-tickets-on-sale`,
			name: 'On-sale Banner',
			library: lib.id,
			category: 'events',
			description: `Tickets on-sale banner in the ${lib.label} style — headline and event caption over day, hour and minute countdown tiles, notify-me ghost and tone buy buttons, with a warning remaining-stock caption.`,
			tags: ['on-sale', 'countdown', 'banner', 'tickets', 'urgency'],
			args: [
				stringArg('event', 'Midnight Frequencies · Sydney', { label: 'Event', maxLength: 60 }),
				numberArg('days', 2, { label: 'Days', min: 0, max: 99 }),
				numberArg('hours', 14, { label: 'Hours', min: 0, max: 23 }),
				numberArg('mins', 36, { label: 'Minutes', min: 0, max: 59 }),
				stringArg('left', '128 tickets', { label: 'Remaining', maxLength: 24 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: card(lib, { width: '340px', padding: '14px', gap: '12px' }) },
				lib.id === 'thingtime' ? el('div', { style: { height: '4px', borderRadius: '999px', background: lib.rainbow } }) : null,
				stack(
					{ gap: '2px' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, 'Tickets on sale'),
					text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{event}')
				),
				row(
					{ gap: '8px' },
					countdownTile('{days}', 'days'),
					countdownTile('{hours}', 'hrs'),
					countdownTile('{mins}', 'min')
				),
				row(
					{ gap: '8px' },
					el(
						'button',
						{
							type: 'button',
							style: btn(lib, {
								background: 'transparent',
								border: `1px solid ${lib.border}`,
								color: lib.text,
								...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {})
							})
						},
						'Notify me'
					),
					el(
						'button',
						{
							type: 'button',
							style: btn(lib, {
								flex: 1,
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
							})
						},
						'Buy tickets'
					)
				),
				row(
					{ gap: '5px' },
					icons.zap(13, lib.palette.warning.solid),
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.palette.warning.onSoft }, '{left} remaining')
				)
			)
		});

		return [event, ticket, seats, lineup, onSale];
	}
};
