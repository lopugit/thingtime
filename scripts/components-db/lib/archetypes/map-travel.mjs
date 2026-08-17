// Map & travel archetype — travel/maps surfaces in five renditions: place
// card, route summary, weather card, itinerary card, and a map pin cluster
// mock. Follows the button.mjs exemplar: exactly 5 variants, `build(lib)`
// returns exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-map-travel-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
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

// antd travel cards sit on tight corners; everyone else keeps the roomy radius.
const cardRadius = (lib) => (lib.id === 'antd' ? lib.radius.sm : lib.radius.lg);

const card = (lib) => ({
	fontFamily: lib.font,
	background: lib.surface,
	borderWidth: lib.id === 'daisyui' ? '2px' : '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: cardRadius(lib),
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.id === 'untitled' ? lib.shadow.lg : lib.shadow.sm,
	overflow: 'hidden',
	boxSizing: 'border-box'
});

// thingtime cards wear the house rainbow as a hairline topper.
const rainbowStrip = (lib) =>
	lib.id === 'thingtime' ? el('div', { style: { height: '3px', background: lib.rainbow, flexShrink: 0 } }) : null;

// Map-canvas dotted grid; reactflow uses its native canvas dot color.
const dotGrid = (lib) => ({
	background: lib.surfaceAlt,
	backgroundImage: `radial-gradient(${lib.id === 'reactflow' ? lib.dot : lib.faint} 1px, transparent 1.5px)`,
	backgroundSize: '12px 12px'
});

// tone → solid, except reactflow's primary rides the signature accent pink.
const toneSolid = (lib) =>
	toneMap(lib, (palette, tone) => (lib.id === 'reactflow' && tone === 'primary' ? lib.accent : palette.solid));

const upper = (lib) =>
	lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {};

// Circle-on-path map pin (stroke carries the tone).
const pin = (lib, size) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: toneSolid(lib),
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		el('path', { d: 'M20 10c0 4.99-5.82 10.66-7.55 12.23a.7.7 0 0 1-.9 0C9.82 20.66 4 14.99 4 10a8 8 0 0 1 16 0z' }),
		el('circle', { cx: 12, cy: 10, r: 3 })
	);

// Soft tone chip for distances, durations, and date ranges.
const chip = (lib, label) =>
	el(
		'span',
		{
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				padding: '2px 8px',
				borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
				background: toneMap(lib, (palette) => palette.soft),
				color: toneMap(lib, (palette) => palette.onSoft),
				fontSize: lib.fontSize.xs,
				fontWeight: 600,
				fontFamily: lib.font,
				whiteSpace: 'nowrap'
			}
		},
		label
	);

const caption = (lib, label) => text({ fontSize: lib.fontSize.xs, color: lib.faint, fontWeight: 600, ...upper(lib) }, label);

// One transport-mode segment; the segment matching the `mode` arg lights up.
const modeSegment = (lib, key, label) =>
	el(
		'div',
		{
			style: merge(
				{
					flex: '1',
					textAlign: 'center',
					padding: '4px 0',
					borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
					fontSize: lib.fontSize.xs,
					fontWeight: 600,
					cursor: 'pointer',
					...upper(lib)
				},
				ifEq(
					'mode',
					key,
					{
						background: lib.surface,
						color: lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid,
						boxShadow: lib.shadow.sm
					},
					{ background: 'transparent', color: lib.muted }
				)
			)
		},
		label
	);

const sunGlyph = (lib) =>
	el(
		'svg',
		{ width: 34, height: 34, viewBox: '0 0 24 24', fill: 'none', stroke: lib.palette.warning.solid, strokeWidth: 2, strokeLinecap: 'round', xmlns: 'http://www.w3.org/2000/svg' },
		el('circle', { cx: 12, cy: 12, r: 4.5 }),
		el('line', { x1: 12, y1: 2.5, x2: 12, y2: 5 }),
		el('line', { x1: 12, y1: 19, x2: 12, y2: 21.5 }),
		el('line', { x1: 2.5, y1: 12, x2: 5, y2: 12 }),
		el('line', { x1: 19, y1: 12, x2: 21.5, y2: 12 })
	);

const cloudGlyph = (lib) =>
	el(
		'svg',
		{ width: 34, height: 34, viewBox: '0 0 24 24', fill: 'none', stroke: lib.muted, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', xmlns: 'http://www.w3.org/2000/svg' },
		el('path', { d: 'M18 10h-1.26A8 8 0 1 0 9 20h9a4 4 0 0 0 0-8z' })
	);

// Mini forecast column: day label, sun dot glyph, hi/lo.
const forecastCol = (lib, day, hi, lo) =>
	stack(
		{ alignItems: 'center', gap: '3px', flex: '1' },
		caption(lib, day),
		el(
			'svg',
			{ width: 12, height: 12, viewBox: '0 0 24 24', fill: lib.palette.warning.solid, xmlns: 'http://www.w3.org/2000/svg' },
			el('circle', { cx: 12, cy: 12, r: 6 })
		),
		text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.text }, hi),
		text({ fontSize: lib.fontSize.xs, color: lib.faint }, lo)
	);

// Absolutely-positioned pin for the cluster canvas.
const placedPin = (lib, size, left, top) => el('div', { style: { position: 'absolute', left, top } }, pin(lib, size));

const zoomButton = (lib, label, extra) =>
	el(
		'div',
		{
			style: {
				width: '22px',
				height: '22px',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				fontSize: lib.fontSize.sm,
				fontWeight: 600,
				color: lib.text,
				cursor: 'pointer',
				...extra
			}
		},
		label
	);

export const archetype = {
	id: 'map-travel',
	category: 'travel',
	variants: ['location', 'route', 'weather', 'itinerary', 'pins'],
	build(lib) {
		const location = define({
			slug: `${lib.id}-map-travel-location`,
			name: 'Location Card',
			library: lib.id,
			category: 'travel',
			description: `Place card in the ${lib.label} style — dotted map band with a tone map pin, place name and address, rating stars beside a distance chip, and a solid directions button.`,
			tags: ['travel', 'map', 'location', 'place', 'card'],
			args: [
				stringArg('place', 'Blue Bottle Coffee', { label: 'Place', maxLength: 40 }),
				stringArg('address', '46 Water St, Brooklyn', { label: 'Address', maxLength: 60 }),
				numberArg('rating', 4, { label: 'Rating (0-5)', min: 0, max: 5 }),
				stringArg('distance', '1.2 km', { label: 'Distance', maxLength: 12 }),
				toneArg()
			],
			render: stack(
				{ ...card(lib), width: '260px' },
				rainbowStrip(lib),
				el(
					'div',
					{
						style: {
							height: '84px',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							borderBottomWidth: '1px',
							borderBottomStyle: 'solid',
							borderBottomColor: lib.borderSoft,
							...dotGrid(lib)
						}
					},
					pin(lib, 30)
				),
				stack(
					{ padding: '12px 14px 14px', gap: '10px' },
					stack(
						{ gap: '2px' },
						text(
							{ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.id === 'thingtime' ? lib.ink : lib.text },
							'{place}'
						),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{address}')
					),
					row(
						{ gap: '3px' },
						repeat('rating', 5, icons.star(12, lib.palette.warning.solid, true)),
						el('span', { style: { flexGrow: 1 } }),
						chip(lib, '{distance}')
					),
					el(
						'button',
						{
							type: 'button',
							style: {
								display: 'flex',
								width: '100%',
								alignItems: 'center',
								justifyContent: 'center',
								gap: '6px',
								height: lib.control.sm,
								border: 'none',
								borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
								background: toneSolid(lib),
								color: toneMap(lib, (palette) => palette.onSolid),
								fontFamily: lib.font,
								fontWeight: lib.buttonWeight,
								fontSize: lib.fontSize.sm,
								cursor: 'pointer',
								...upper(lib)
							}
						},
						icons.arrowRight(14, 'currentColor'),
						'Directions'
					)
				)
			)
		});

		const route = define({
			slug: `${lib.id}-map-travel-route`,
			name: 'Route Summary',
			library: lib.id,
			category: 'travel',
			description: `Route summary in the ${lib.label} style — origin and destination joined by a dashed rail between A/B dots, duration and distance chips, and a car/walk/transit mode toggle.`,
			tags: ['travel', 'map', 'route', 'directions', 'navigation'],
			args: [
				stringArg('origin', 'Home', { label: 'Origin', maxLength: 40 }),
				stringArg('destination', 'Airport Terminal 1', { label: 'Destination', maxLength: 40 }),
				stringArg('duration', '24 min', { label: 'Duration', maxLength: 12 }),
				stringArg('distance', '18.5 km', { label: 'Distance', maxLength: 12 }),
				enumArg('mode', ['car', 'walk', 'transit'], 'car', { label: 'Mode' }),
				toneArg()
			],
			render: stack(
				{ ...card(lib), width: '260px' },
				rainbowStrip(lib),
				stack(
					{ padding: '14px', gap: '12px' },
					row(
						{ gap: '10px', alignItems: 'stretch' },
						stack(
							{ alignItems: 'center', width: '10px', padding: '4px 0' },
							el('div', {
								style: {
									width: '10px',
									height: '10px',
									borderRadius: '999px',
									borderWidth: '2px',
									borderStyle: 'solid',
									borderColor: lib.muted,
									boxSizing: 'border-box',
									flexShrink: 0
								}
							}),
							el('div', {
								style: { flexGrow: 1, width: '0px', borderLeftWidth: '2px', borderLeftStyle: 'dashed', borderLeftColor: lib.faint, margin: '3px 0' }
							}),
							el('div', { style: { width: '10px', height: '10px', borderRadius: '999px', background: toneSolid(lib), flexShrink: 0 } })
						),
						stack(
							{ gap: '14px', flexGrow: 1, justifyContent: 'space-between' },
							stack(
								{ gap: '1px' },
								caption(lib, 'From'),
								text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '{origin}')
							),
							stack(
								{ gap: '1px' },
								caption(lib, 'To'),
								text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '{destination}')
							)
						)
					),
					row({ gap: '6px' }, chip(lib, '{duration}'), chip(lib, '{distance}')),
					row(
						{
							gap: '2px',
							padding: '3px',
							background: lib.surfaceAlt,
							borderRadius: lib.id === 'antd' ? lib.radius.sm : lib.radius.md,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.borderSoft
						},
						modeSegment(lib, 'car', 'Car'),
						modeSegment(lib, 'walk', 'Walk'),
						modeSegment(lib, 'transit', 'Transit')
					)
				)
			)
		});

		const weather = define({
			slug: `${lib.id}-map-travel-weather`,
			name: 'Weather Card',
			library: lib.id,
			category: 'travel',
			description: `Weather card in the ${lib.label} style — big temperature over a condition caption, a sun or cloud glyph toggle, and four mini forecast columns with hi/lo readings.`,
			tags: ['travel', 'weather', 'forecast', 'card'],
			args: [
				stringArg('place', 'Sydney', { label: 'Place', maxLength: 30 }),
				stringArg('temp', '24', { label: 'Temperature', maxLength: 5 }),
				stringArg('condition', 'Sunny', { label: 'Condition', maxLength: 30 }),
				booleanArg('sunny', true, { label: 'Sunny glyph' })
			],
			render: stack(
				{ ...card(lib), width: '240px' },
				rainbowStrip(lib),
				stack(
					{ padding: '14px 16px 12px', gap: '10px' },
					row(
						{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' },
						stack(
							{ gap: '1px' },
							caption(lib, '{place}'),
							text(
								{ fontSize: '30px', fontWeight: lib.headingWeight, lineHeight: 1.15, color: lib.id === 'thingtime' ? lib.ink : lib.text },
								'{temp}°'
							),
							text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{condition}')
						),
						iff('sunny', sunGlyph(lib), cloudGlyph(lib))
					),
					row(
						{ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft, paddingTop: '10px', alignItems: 'flex-start' },
						forecastCol(lib, 'Mon', '25°', '17°'),
						forecastCol(lib, 'Tue', '23°', '16°'),
						forecastCol(lib, 'Wed', '21°', '14°'),
						forecastCol(lib, 'Thu', '24°', '15°')
					)
				)
			)
		});

		const itinerary = define({
			slug: `${lib.id}-map-travel-itinerary`,
			name: 'Itinerary Card',
			library: lib.id,
			category: 'travel',
			description: `Trip summary card in the ${lib.label} style — trip title with a date-range chip, numbered day rows down a dashed dot rail, and a totals footer caption.`,
			tags: ['travel', 'itinerary', 'trip', 'planner', 'card'],
			args: [
				stringArg('trip', 'Tokyo long weekend', { label: 'Trip', maxLength: 40 }),
				stringArg('dates', 'Mar 4-9', { label: 'Dates', maxLength: 16 }),
				numberArg('days', 3, { label: 'Days (1-6)', min: 1, max: 6 }),
				stringArg('stops', 'Shibuya walk · 3 stops', { label: 'Day caption', maxLength: 40 }),
				stringArg('total', '9 stops · 3 days', { label: 'Total', maxLength: 30 }),
				toneArg()
			],
			render: stack(
				{ ...card(lib), width: '250px' },
				rainbowStrip(lib),
				stack(
					{ padding: '14px', gap: '10px' },
					row(
						{ justifyContent: 'space-between', gap: '8px' },
						text(
							{ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.id === 'thingtime' ? lib.ink : lib.text },
							'{trip}'
						),
						chip(lib, '{dates}')
					),
					stack(
						{ gap: '0px' },
						repeat(
							'days',
							6,
							row(
								{ gap: '10px', alignItems: 'stretch' },
								stack(
									{ alignItems: 'center', width: '10px', paddingTop: '4px' },
									el('div', { style: { width: '8px', height: '8px', borderRadius: '999px', background: toneSolid(lib), flexShrink: 0 } }),
									el('div', {
										style: { flexGrow: 1, width: '0px', borderLeftWidth: '2px', borderLeftStyle: 'dashed', borderLeftColor: lib.faint, margin: '3px 0 1px' }
									})
								),
								stack(
									{ gap: '1px', paddingBottom: '12px', flexGrow: 1 },
									text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, 'Day {n}'),
									text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{stops}')
								)
							)
						)
					),
					row(
						{ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft, paddingTop: '8px', justifyContent: 'space-between', gap: '8px' },
						caption(lib, 'Total'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted, fontWeight: 600 }, '{total}')
					)
				)
			)
		});

		const pins = define({
			slug: `${lib.id}-map-travel-pins`,
			name: 'Map Pin Cluster',
			library: lib.id,
			category: 'travel',
			description: `Map pin cluster mock in the ${lib.label} style — a dotted map canvas with three tone pins of varying sizes, a +N cluster bubble, an area chip, and a corner zoom pill.`,
			tags: ['travel', 'map', 'pins', 'cluster', 'canvas'],
			args: [
				stringArg('area', 'Inner West', { label: 'Area', maxLength: 24 }),
				stringArg('more', '5', { label: 'Cluster count', maxLength: 4 }),
				booleanArg('showZoom', true, { label: 'Zoom control' }),
				toneArg()
			],
			render: stack(
				{ ...card(lib), width: '260px' },
				rainbowStrip(lib),
				el(
					'div',
					{ style: { position: 'relative', height: '150px', ...dotGrid(lib) } },
					el(
						'span',
						{
							style: {
								position: 'absolute',
								top: '8px',
								left: '8px',
								padding: '2px 8px',
								borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
								background: lib.surface,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.border,
								boxShadow: lib.shadow.sm,
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								color: lib.text,
								fontFamily: lib.font
							}
						},
						'{area}'
					),
					placedPin(lib, 26, '24%', '32%'),
					placedPin(lib, 20, '58%', '52%'),
					placedPin(lib, 15, '38%', '64%'),
					el(
						'div',
						{
							style: {
								position: 'absolute',
								left: '70%',
								top: '22%',
								width: '28px',
								height: '28px',
								borderRadius: '999px',
								background: toneSolid(lib),
								color: toneMap(lib, (palette) => palette.onSolid),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontSize: lib.fontSize.xs,
								fontWeight: 700,
								fontFamily: lib.font,
								borderWidth: '2px',
								borderStyle: 'solid',
								borderColor: lib.surface,
								boxShadow: lib.shadow.sm,
								boxSizing: 'border-box'
							}
						},
						'+{more}'
					),
					iff(
						'showZoom',
						stack(
							{
								position: 'absolute',
								right: '8px',
								bottom: '8px',
								background: lib.surface,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.border,
								borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
								boxShadow: lib.shadow.sm,
								overflow: 'hidden'
							},
							zoomButton(lib, '+', {}),
							zoomButton(lib, '−', { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft })
						)
					)
				)
			)
		});

		return [location, route, weather, itinerary, pins];
	}
};
