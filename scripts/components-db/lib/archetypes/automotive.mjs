// Automotive archetype — vehicle surfaces in five renditions: vehicle card,
// EV battery charge card, trip computer, parking session card, and a service
// reminder. Follows the button.mjs exemplar: exactly 5 variants, `build(lib)`
// returns exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-automotive-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
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

// --- shared chrome -----------------------------------------------------------

const cardStyle = (lib, width) => ({
	width,
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	fontFamily: lib.font,
	color: lib.text,
	overflow: 'hidden',
	boxSizing: 'border-box'
});

const buttonBase = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: lib.id === 'daisyui' ? lib.control.md : lib.control.sm,
	padding: '0 14px',
	border: 'none',
	borderRadius: lib.radius.md,
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	fontSize: lib.fontSize.sm,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

const toneButton = (lib, label, extra = {}) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				...buttonBase(lib),
				background: toneMap(lib, (palette) => palette.solid),
				color: toneMap(lib, (palette) => palette.onSolid),
				...extra
			}
		},
		label
	);

const ghostButton = (lib, label, extra = {}) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				...buttonBase(lib),
				background: 'transparent',
				color: toneMap(lib, (palette) => palette.solid),
				...extra
			}
		},
		label
	);

const monoChip = (lib, label) =>
	el(
		'span',
		{
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				padding: '2px 8px',
				borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
				background: lib.surfaceAlt,
				color: lib.muted,
				fontFamily: lib.fontMono,
				fontSize: lib.fontSize.xs,
				fontWeight: 500,
				...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {})
			}
		},
		label
	);

const captionStyle = (lib) => ({ fontSize: lib.fontSize.xs, color: lib.muted });

// Exact-key step maps (ttMap looks up String(value)) — enumerate the low band.
const lowChargeFill = (lib) => {
	const values = {};
	for (let i = 0; i <= 15; i += 1) values[i] = lib.palette.danger.solid;
	return { ttMap: { arg: 'percent', values, default: lib.palette.success.solid } };
};

const lowMinutesColor = (lib) => {
	const values = {};
	for (let i = 0; i <= 9; i += 1) values[i] = lib.palette.warning.onSoft;
	return { ttMap: { arg: 'mins', values, default: lib.text } };
};

// Stepped dasharray for the eco mini-ring (path circumference ≈ 100).
const RING_D = 'M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831';

const ecoDash = () => {
	const values = {};
	for (let i = 0; i <= 10; i += 1) values[i] = `${i * 10} 100`;
	return { ttMap: { arg: 'eco', values, default: '80 100' } };
};

export const archetype = {
	id: 'automotive',
	category: 'automotive',
	variants: ['vehicle', 'battery', 'trip', 'parking', 'service'],
	build(lib) {
		const vehicle = define({
			slug: `${lib.id}-automotive-vehicle`,
			name: 'Vehicle Card',
			library: lib.id,
			category: 'automotive',
			description: `Vehicle showcase card in the ${lib.label} style — tone-tinted silhouette band with a simple car outline, model and trim, spec chips, price with a monthly estimate, and a Configure action.`,
			tags: ['automotive', 'vehicle', 'card', 'pricing'],
			args: [
				stringArg('model', 'Aurora GT', { label: 'Model', maxLength: 32 }),
				stringArg('trim', '2026 · Dual Motor AWD', { label: 'Year / trim', maxLength: 40 }),
				stringArg('range', '512 km', { label: 'Range', maxLength: 12 }),
				stringArg('price', '$54,990', { label: 'Price', maxLength: 12 }),
				stringArg('monthly', '$639', { label: 'Monthly estimate', maxLength: 12 }),
				toneArg()
			],
			render: stack(
				cardStyle(lib, '290px'),
				lib.id === 'thingtime' && el('div', { style: { height: '4px', background: lib.rainbow } }),
				el(
					'div',
					{
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							padding: '18px 0 14px 0',
							background: toneMap(lib, (palette) => palette.soft),
							color: lib.id === 'reactflow' ? lib.accent : toneMap(lib, (palette) => palette.solid)
						}
					},
					el(
						'svg',
						{ width: 132, height: 48, viewBox: '0 0 132 48', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
						el('rect', { x: 10, y: 22, width: 112, height: 12, rx: 6, fill: 'currentColor' }),
						el('rect', { x: 38, y: 10, width: 52, height: 16, rx: 8, fill: 'currentColor' }),
						el('circle', { cx: 36, cy: 38, r: 7, stroke: 'currentColor', strokeWidth: 4, fill: lib.surface }),
						el('circle', { cx: 96, cy: 38, r: 7, stroke: 'currentColor', strokeWidth: 4, fill: lib.surface })
					)
				),
				stack(
					{ padding: '14px 16px 16px 16px', gap: '10px' },
					stack(
						{ gap: '2px' },
						text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, '{model}'),
						text(captionStyle(lib), '{trim}')
					),
					row(
						{ gap: '6px', flexWrap: 'wrap' },
						monoChip(lib, '{range} range'),
						monoChip(lib, '4.1s 0-60'),
						monoChip(lib, '5 seats')
					),
					row(
						{ gap: '8px', alignItems: 'baseline' },
						text({ fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight }, '{price}'),
						text(captionStyle(lib), 'Est. {monthly}/mo')
					),
					toneButton(lib, 'Configure', { width: '100%' })
				)
			)
		});

		const battery = define({
			slug: `${lib.id}-automotive-battery`,
			name: 'EV Battery Card',
			library: lib.id,
			category: 'automotive',
			description: `EV charge card in the ${lib.label} style — large percentage with range caption, a rounded battery bar with terminal nub that flips to danger when low, and a charging chip with time-to-full.`,
			tags: ['automotive', 'ev', 'battery', 'charge'],
			args: [
				numberArg('percent', 72, { label: 'Charge %', min: 0, max: 100 }),
				stringArg('range', '318 km', { label: 'Range', maxLength: 12 }),
				booleanArg('charging', true, { label: 'Charging' }),
				stringArg('time', '1h 20m', { label: 'Time to full', maxLength: 12 })
			],
			render: stack(
				{ ...cardStyle(lib, '270px'), padding: '16px', gap: '10px' },
				row(
					{ gap: '8px', alignItems: 'baseline' },
					text({ fontSize: '30px', fontWeight: lib.headingWeight, lineHeight: 1 }, '{percent}%'),
					iff(
						'charging',
						el(
							'span',
							{
								style: {
									display: 'inline-flex',
									alignItems: 'center',
									gap: '4px',
									padding: '2px 8px',
									borderRadius: lib.radius.pill,
									background: lib.palette.success.soft,
									color: lib.palette.success.onSoft,
									fontSize: lib.fontSize.xs,
									fontWeight: 600
								}
							},
							icons.zap(11, 'currentColor'),
							'Charging'
						)
					)
				),
				text(captionStyle(lib), '{range} of range'),
				row(
					{ gap: '4px' },
					el(
						'div',
						{
							style: {
								flex: '1',
								height: lib.id === 'daisyui' ? '18px' : '12px',
								borderRadius: lib.radius.pill,
								background: lib.surfaceAlt,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.borderSoft,
								overflow: 'hidden',
								boxSizing: 'border-box'
							}
						},
						el('div', {
							style: {
								width: '{percent}%',
								height: '100%',
								borderRadius: lib.radius.pill,
								background: lowChargeFill(lib)
							}
						})
					),
					el('div', {
						style: { width: '4px', height: '8px', borderRadius: '2px', background: lib.border, flexShrink: 0 }
					})
				),
				iff('charging', text(captionStyle(lib), 'Time to full {time}'))
			)
		});

		const trip = define({
			slug: `${lib.id}-automotive-trip`,
			name: 'Trip Computer',
			library: lib.id,
			category: 'automotive',
			description: `Trip computer card in the ${lib.label} style — four stat tiles for distance, speed, drive time and efficiency, a route caption, and an eco-score mini-ring drawn with a stepped dasharray.`,
			tags: ['automotive', 'trip', 'stats', 'eco'],
			args: [
				stringArg('distance', '128 km', { label: 'Distance', maxLength: 12 }),
				stringArg('from', 'Home', { label: 'From', maxLength: 20 }),
				stringArg('to', 'Office', { label: 'To', maxLength: 20 }),
				numberArg('eco', 8, { label: 'Eco score (0-10)', min: 0, max: 10 })
			],
			render: stack(
				{ ...cardStyle(lib, '290px'), padding: '16px', gap: '10px' },
				stack(
					{ gap: '2px' },
					text(
						{
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							letterSpacing: '0.08em',
							textTransform: 'uppercase',
							color: lib.faint
						},
						'Trip computer'
					),
					text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{from} → {to}')
				),
				el(
					'div',
					{ style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
					...[
						['Distance', '{distance}'],
						['Avg speed', '54 km/h'],
						['Drive time', '2h 08m'],
						['Efficiency', '16.4 kWh/100km']
					].map(([tileLabel, tileValue]) =>
						stack(
							{ padding: '8px 10px', gap: '2px', borderRadius: lib.radius.md, background: lib.surfaceAlt },
							text({ fontSize: lib.fontSize.xs, color: lib.muted }, tileLabel),
							text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight }, tileValue)
						)
					)
				),
				row(
					{ gap: '10px' },
					el(
						'svg',
						{ width: 40, height: 40, viewBox: '0 0 36 36', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
						el('path', { d: RING_D, stroke: lib.borderSoft, strokeWidth: 4 }),
						el('path', {
							d: RING_D,
							stroke: lib.id === 'reactflow' ? lib.accent : lib.palette.success.solid,
							strokeWidth: 4,
							strokeLinecap: 'round',
							style: { strokeDasharray: ecoDash() }
						})
					),
					stack(
						{ gap: '2px' },
						text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight }, 'Eco score {eco}/10'),
						text(captionStyle(lib), 'Smooth accel & braking')
					)
				)
			)
		});

		const parking = define({
			slug: `${lib.id}-automotive-parking`,
			name: 'Parking Session Card',
			library: lib.id,
			category: 'automotive',
			description: `Parking session card in the ${lib.label} style — P emblem tile with garage name, level and spot mono chips, an expiry timer that turns warning when low, a rate caption, and Extend plus Directions actions.`,
			tags: ['automotive', 'parking', 'timer', 'card'],
			args: [
				stringArg('garage', 'Central Plaza', { label: 'Garage', maxLength: 32 }),
				stringArg('spot', 'B-42', { label: 'Spot', maxLength: 8 }),
				numberArg('mins', 24, { label: 'Minutes left', min: 0, max: 240 }),
				stringArg('rate', '$4.50 / hr', { label: 'Rate', maxLength: 16 }),
				toneArg()
			],
			render: stack(
				{ ...cardStyle(lib, '280px'), padding: '16px', gap: '10px' },
				row(
					{ gap: '10px' },
					el(
						'div',
						{
							style: {
								width: '40px',
								height: '40px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: lib.radius.md,
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								fontWeight: 700,
								fontSize: lib.fontSize.lg,
								flexShrink: 0
							}
						},
						'P'
					),
					stack(
						{ gap: '4px' },
						text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{garage}'),
						row({ gap: '6px' }, monoChip(lib, 'L2'), monoChip(lib, '{spot}'))
					)
				),
				stack(
					{ gap: '2px' },
					text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lowMinutesColor(lib) }, 'Expires in {mins} min'),
					text(captionStyle(lib), '{rate}')
				),
				row(
					{ gap: '8px' },
					toneButton(lib, 'Extend', { flex: '1' }),
					ghostButton(lib, 'Directions')
				)
			)
		});

		const service = define({
			slug: `${lib.id}-automotive-service`,
			name: 'Service Reminder',
			library: lib.id,
			category: 'automotive',
			description: `Service reminder card in the ${lib.label} style — gear glyph in a warning-tinted tile, the due service with mileage caption, an ok/soon/overdue urgency chip, a next-appointment row, and a Book action.`,
			tags: ['automotive', 'service', 'maintenance', 'reminder'],
			args: [
				stringArg('service', 'Brake inspection', { label: 'Service', maxLength: 32 }),
				stringArg('mileage', '48,200 km', { label: 'Mileage', maxLength: 16 }),
				enumArg('urgency', ['ok', 'soon', 'overdue'], 'soon', { label: 'Urgency' }),
				stringArg('date', 'Tue 26 Aug · 9:30', { label: 'Next appointment', maxLength: 24 }),
				toneArg()
			],
			render: stack(
				{ ...cardStyle(lib, '290px'), padding: '16px', gap: '10px' },
				row(
					{ gap: '10px' },
					el(
						'div',
						{
							style: {
								width: '40px',
								height: '40px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: lib.radius.md,
								background: lib.palette.warning.soft,
								flexShrink: 0
							}
						},
						icons.settings(20, lib.palette.warning.solid)
					),
					stack(
						{ gap: '2px' },
						text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{service} due'),
						text(captionStyle(lib), 'Odometer {mileage}')
					)
				),
				el(
					'span',
					{
						style: merge(
							{
								display: 'inline-flex',
								alignItems: 'center',
								alignSelf: 'flex-start',
								padding: '2px 10px',
								borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								textTransform: 'capitalize'
							},
							map('urgency', {
								ok: { background: lib.palette.success.soft, color: lib.palette.success.onSoft },
								soon: { background: lib.palette.warning.soft, color: lib.palette.warning.onSoft },
								overdue: { background: lib.palette.danger.soft, color: lib.palette.danger.onSoft }
							})
						)
					},
					'{urgency}'
				),
				row(
					{ gap: '6px', color: lib.muted },
					icons.calendar(14, 'currentColor'),
					text({ fontSize: lib.fontSize.sm, color: lib.text }, '{date}')
				),
				toneButton(lib, 'Book service', { width: '100%' })
			)
		});

		return [vehicle, battery, trip, parking, service];
	}
};
