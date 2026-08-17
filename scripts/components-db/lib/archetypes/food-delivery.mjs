// Food-delivery archetype — food & dining surfaces in five renditions:
// dish menu card, delivery order status, reservation card, dining review,
// and courier card. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-food-delivery-<variant>`.

import {
	avatarCircle,
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	ifEq,
	iff,
	map,
	merge,
	numberArg,
	row,
	stack,
	stringArg,
	text,
	textArg
} from '../helpers.mjs';

// --- shared chrome -----------------------------------------------------------

// reactflow keeps its hot-pink accent; thingtime winks with its pink info tone;
// everyone else leans on their primary.
const accent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.primary.solid);

const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);

// antd sits on tight corners; untitled/mui cards get the deeper feather/elevation shadow.
const cardStyle = (lib, extra = {}) => ({
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.id === 'antd' ? lib.radius.sm : lib.radius.lg,
	boxShadow: lib.id === 'untitled' || lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	fontFamily: lib.font,
	color: lib.text,
	overflow: 'hidden',
	boxSizing: 'border-box',
	...extra
});

const buttonBase = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '6px',
	height: lib.control.sm,
	padding: '0 12px',
	borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
	fontFamily: lib.font,
	fontSize: lib.fontSize.sm,
	fontWeight: lib.buttonWeight,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

const solidButton = (lib, label, extra = {}) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				...buttonBase(lib),
				border: 'none',
				background: lib.palette.primary.solid,
				color: lib.palette.primary.onSolid,
				boxShadow: lib.shadow.sm,
				...extra
			}
		},
		label
	);

const ghostButton = (lib, label) =>
	el(
		'button',
		{ type: 'button', style: { ...buttonBase(lib), border: 'none', background: 'transparent', color: accent(lib) } },
		label
	);

// --- food-flavored svg glyphs (allowlisted shapes only) ---------------------

const svgIcon = (size, stroke, ...kids) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke,
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		...kids
	);

const panIcon = (size, color) => svgIcon(size, color, el('circle', { cx: 9, cy: 12, r: 6 }), el('line', { x1: 16, y1: 12, x2: 22, y2: 12 }));

const bikeIcon = (size, color) =>
	svgIcon(
		size,
		color,
		el('circle', { cx: 6, cy: 17, r: 4 }),
		el('circle', { cx: 18, cy: 17, r: 4 }),
		el('polyline', { points: '6 17 9 9 15 9 18 17' })
	);

const phoneIcon = (size, color) =>
	svgIcon(
		size,
		color,
		el('path', {
			d: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'
		})
	);

// Plate-ish mark for the photo placeholder band: rim + inner well.
const plateIcon = (size, color) =>
	el(
		'svg',
		{ width: size, height: size, viewBox: '0 0 48 48', fill: 'none', stroke: color, strokeWidth: 2.5, xmlns: 'http://www.w3.org/2000/svg' },
		el('circle', { cx: 24, cy: 24, r: 20 }),
		el('circle', { cx: 24, cy: 24, r: 10 })
	);

// --- star rows (calc-clip overlay: fixed underlay + width-clipped overlay) ---

const rep5 = (node) => ({ ttRepeat: { count: 5, max: 5, node } });

const starRow = (lib, size, argName) =>
	el(
		'div',
		{ style: { position: 'relative', display: 'inline-flex', flexShrink: 0 } },
		el('div', { style: { display: 'flex' } }, rep5(icons.star(size, lib.faint, false))),
		el(
			'div',
			{
				style: {
					position: 'absolute',
					top: '0',
					left: '0',
					display: 'flex',
					overflow: 'hidden',
					maxWidth: `${size * 5}px`,
					width: `calc({${argName}} * ${size}px)`
				}
			},
			rep5(icons.star(size, lib.palette.warning.solid, true))
		)
	);

// --- chips ------------------------------------------------------------------

const miniPill = (lib, palette, label) =>
	el(
		'span',
		{
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				fontSize: lib.fontSize.xs,
				fontWeight: 700,
				padding: '1px 7px',
				borderRadius: chipRadius(lib),
				background: palette.soft,
				color: palette.onSoft
			}
		},
		label
	);

const infoChip = (lib, icon, label) =>
	el(
		'span',
		{
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				gap: '5px',
				fontSize: lib.fontSize.xs,
				fontWeight: 500,
				padding: '3px 9px',
				borderRadius: chipRadius(lib),
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: lib.borderSoft,
				background: lib.surfaceAlt,
				color: lib.text
			}
		},
		icon,
		label
	);

const tagChip = (lib, label) =>
	el(
		'span',
		{
			style: {
				fontSize: lib.fontSize.xs,
				fontWeight: 600,
				padding: '2px 9px',
				borderRadius: chipRadius(lib),
				background: lib.id === 'daisyui' ? lib.palette.primary.soft : lib.surfaceAlt,
				color: lib.id === 'daisyui' ? lib.palette.primary.onSoft : lib.muted
			}
		},
		label
	);

// --- order-status stage strip ------------------------------------------------

const STAGES = ['confirmed', 'preparing', 'on-the-way', 'delivered'];

// Color for the stage node at `position` given the current `stage` arg:
// completed stages go success, the current stage takes the accent, later
// stages stay faint.
const stageColor = (lib, position) => {
	const values = {};
	STAGES.forEach((key, current) => {
		values[key] = position < current ? lib.palette.success.solid : position === current ? accent(lib) : lib.faint;
	});
	return { ttMap: { arg: 'stage', values, default: lib.faint } };
};

const stageNode = (lib, position, icon, label) =>
	stack(
		{ alignItems: 'center', gap: '4px', flex: '1', textAlign: 'center', color: stageColor(lib, position) },
		icon,
		el('span', { style: { fontSize: lib.fontSize.xs, fontWeight: 600 } }, label)
	);

// --- misc controls ----------------------------------------------------------

const stepButton = (lib, label) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				width: '24px',
				height: '24px',
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				border: 'none',
				background: lib.surfaceAlt,
				color: lib.text,
				cursor: 'pointer',
				fontSize: lib.fontSize.sm,
				fontWeight: 700
			}
		},
		label
	);

const roundButton = (lib, icon) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				width: '34px',
				height: '34px',
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				borderRadius: '999px',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: lib.border,
				background: lib.surface,
				color: accent(lib),
				cursor: 'pointer',
				flexShrink: 0,
				boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
			}
		},
		icon
	);

const tipChip = (lib, value, label) =>
	el(
		'button',
		{
			type: 'button',
			style: merge(
				{
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					height: '26px',
					padding: '0 12px',
					borderRadius: chipRadius(lib),
					fontFamily: lib.font,
					fontSize: lib.fontSize.xs,
					fontWeight: 600,
					cursor: 'pointer',
					borderWidth: '1px',
					borderStyle: 'solid',
					...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
				},
				ifEq(
					'tip',
					value,
					{ background: accent(lib), color: lib.palette.primary.onSolid, borderColor: accent(lib) },
					{ background: 'transparent', color: lib.muted, borderColor: lib.border }
				)
			)
		},
		label
	);

// --- archetype ---------------------------------------------------------------

export const archetype = {
	id: 'food-delivery',
	category: 'food',
	variants: ['menu-item', 'order-status', 'reservation', 'review', 'courier'],
	build(lib) {
		const menuItem = define({
			slug: `${lib.id}-food-delivery-menu-item`,
			name: 'Menu Item Card',
			library: lib.id,
			category: 'food',
			description: `Dish card in the ${lib.label} style — warm photo placeholder band with a plate mark, dish name, blurb and price, V/GF dietary pills, and an Add button that flips into a quantity stepper once added.`,
			tags: ['food', 'menu', 'dish', 'card', 'restaurant'],
			args: [
				stringArg('dish', 'Truffle mushroom rigatoni', { label: 'Dish', maxLength: 60 }),
				textArg('desc', 'Slow-roasted mushrooms, parmesan cream, crispy sage.', { label: 'Description', maxLength: 140 }),
				stringArg('price', '$18.50', { label: 'Price', maxLength: 12 }),
				booleanArg('added', false, { label: 'Added to cart' })
			],
			render: stack(
				cardStyle(lib, { width: '270px' }),
				el(
					'div',
					{ style: { height: '92px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: lib.palette.warning.soft } },
					plateIcon(46, lib.palette.warning.border)
				),
				lib.id === 'thingtime' && el('div', { style: { height: '3px', background: lib.rainbow } }),
				stack(
					{ padding: '12px 14px', gap: '6px' },
					row(
						{ justifyContent: 'space-between', gap: '10px' },
						text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{dish}'),
						text({ fontSize: lib.fontSize.md, fontWeight: 700, color: lib.id === 'reactflow' ? lib.accent : lib.text, flexShrink: 0 }, '{price}')
					),
					text({ fontSize: lib.fontSize.xs, color: lib.muted, lineHeight: 1.5 }, '{desc}'),
					row(
						{ gap: '6px', marginTop: '4px' },
						miniPill(lib, lib.palette.success, 'V'),
						miniPill(lib, lib.palette.info, 'GF'),
						el('div', { style: { flex: '1' } }),
						iff(
							'added',
							row(
								{
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: lib.border,
									borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
									overflow: 'hidden'
								},
								stepButton(lib, '−'),
								el('span', { style: { minWidth: '22px', textAlign: 'center', fontSize: lib.fontSize.sm, fontWeight: 600 } }, '1'),
								stepButton(lib, '+')
							),
							solidButton(lib, 'Add', { height: '28px', padding: '0 14px' })
						)
					)
				)
			)
		});

		const orderStatus = define({
			slug: `${lib.id}-food-delivery-order-status`,
			name: 'Order Status Card',
			library: lib.id,
			category: 'food',
			description: `Delivery tracker in the ${lib.label} style — big ETA minutes, a Confirmed→Preparing→On the way→Delivered stage strip with food-flavored glyphs, a dotted map mock with a moving courier dot, and a Track ghost button.`,
			tags: ['food', 'delivery', 'order', 'tracking', 'status'],
			args: [
				numberArg('mins', 24, { label: 'ETA minutes' }),
				enumArg('stage', STAGES, 'on-the-way', { label: 'Stage' }),
				stringArg('restaurant', 'Bao Brothers', { label: 'Restaurant', maxLength: 40 })
			],
			render: stack(
				cardStyle(lib, { width: '310px', padding: '14px', gap: '12px' }),
				row(
					{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' },
					stack(
						{ gap: '2px' },
						text({ fontSize: lib.fontSize.xs, color: lib.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }, 'Arriving in'),
						row(
							{ gap: '5px', alignItems: 'baseline' },
							text({ fontSize: '28px', fontWeight: lib.headingWeight, lineHeight: 1.1 }, '{mins}'),
							text({ fontSize: lib.fontSize.sm, color: lib.muted, fontWeight: 600 }, 'min')
						),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{restaurant}')
					),
					ghostButton(lib, 'Track')
				),
				row(
					{ gap: '2px', alignItems: 'flex-start' },
					stageNode(lib, 0, icons.check(15, 'currentColor'), 'Confirmed'),
					stageNode(lib, 1, panIcon(15, 'currentColor'), 'Preparing'),
					stageNode(lib, 2, bikeIcon(15, 'currentColor'), 'On the way'),
					stageNode(lib, 3, icons.home(15, 'currentColor'), 'Delivered')
				),
				el(
					'div',
					{
						style: {
							position: 'relative',
							height: '46px',
							borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
							background: lib.surfaceAlt,
							backgroundImage: `radial-gradient(${lib.id === 'reactflow' ? lib.dot : lib.faint} 1px, transparent 1.4px)`,
							backgroundSize: '11px 11px'
						}
					},
					el(
						'div',
						{
							style: {
								position: 'absolute',
								left: '12px',
								right: '12px',
								top: '22px',
								borderTopWidth: '2px',
								borderTopStyle: 'dashed',
								borderTopColor: lib.id === 'reactflow' ? lib.edge : lib.muted
							}
						}
					),
					el(
						'div',
						{
							style: {
								position: 'absolute',
								top: '17px',
								left: map('stage', { confirmed: '8%', preparing: '33%', 'on-the-way': '60%', delivered: '88%' }, '33%'),
								width: '12px',
								height: '12px',
								borderRadius: '999px',
								background: accent(lib),
								borderWidth: '2px',
								borderStyle: 'solid',
								borderColor: lib.surface,
								boxShadow: lib.shadow.sm
							}
						}
					)
				)
			)
		});

		const reservation = define({
			slug: `${lib.id}-food-delivery-reservation`,
			name: 'Reservation Card',
			library: lib.id,
			category: 'food',
			description: `Table reservation card in the ${lib.label} style — restaurant name with cuisine caption, date/time/party chips, a table note, Confirm and Modify actions, and a free-cancellation reassurance line.`,
			tags: ['food', 'reservation', 'restaurant', 'booking', 'card'],
			args: [
				stringArg('restaurant', 'Lumen & Vine', { label: 'Restaurant', maxLength: 40 }),
				stringArg('cuisine', 'Modern Italian', { label: 'Cuisine', maxLength: 30 }),
				stringArg('date', 'Fri 22 Aug', { label: 'Date', maxLength: 20 }),
				stringArg('time', '7:30 PM', { label: 'Time', maxLength: 12 }),
				numberArg('party', 4, { label: 'Party size' })
			],
			render: stack(
				cardStyle(lib, { width: '300px', padding: '16px', gap: '10px' }),
				row(
					{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' },
					stack(
						{ gap: '2px' },
						text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, '{restaurant}'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{cuisine}')
					),
					el(
						'div',
						{
							style: {
								width: '36px',
								height: '36px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: lib.id === 'antd' ? lib.radius.sm : lib.radius.md,
								background: lib.palette.primary.soft,
								color: lib.palette.primary.onSoft,
								flexShrink: 0
							}
						},
						icons.calendar(18, 'currentColor')
					)
				),
				row(
					{ gap: '6px', flexWrap: 'wrap' },
					infoChip(lib, icons.calendar(12, 'currentColor'), '{date}'),
					infoChip(lib, icons.clock(12, 'currentColor'), '{time}'),
					infoChip(lib, icons.user(12, 'currentColor'), '{party} guests')
				),
				text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Table 12 · by the window'),
				row(
					{ gap: '8px', marginTop: '2px' },
					solidButton(lib, 'Confirm', { flex: '1' }),
					ghostButton(lib, 'Modify')
				),
				row(
					{ gap: '5px', color: lib.palette.success.solid },
					icons.check(14, 'currentColor'),
					el('span', { style: { fontSize: lib.fontSize.xs, fontWeight: 600 } }, 'Free cancellation until 5 PM')
				)
			)
		});

		const review = define({
			slug: `${lib.id}-food-delivery-review`,
			name: 'Dining Review',
			library: lib.id,
			category: 'food',
			description: `Dining review row in the ${lib.label} style — avatar and reviewer name with a fractional five-star row, the review body, dish tag chips, a helpful count, and a quiet Reply action.`,
			tags: ['food', 'review', 'rating', 'stars', 'restaurant'],
			args: [
				stringArg('name', 'Maya R.', { label: 'Reviewer', maxLength: 30 }),
				numberArg('stars', 4, { label: 'Stars (0–5)' }),
				textArg('text', 'The gnocchi was pillowy perfection and the staff were lovely. Would absolutely come back for the dessert menu alone.', { label: 'Review', maxLength: 240 }),
				stringArg('dish', 'Truffle gnocchi', { label: 'Dish tag', maxLength: 30 }),
				numberArg('helpful', 12, { label: 'Helpful count' })
			],
			render: stack(
				cardStyle(lib, { width: '320px', padding: '14px', gap: '10px' }),
				row(
					{ gap: '10px' },
					avatarCircle('36px', lib.surfaceAlt, lib.muted, icons.user(16, 'currentColor'), lib.fontSize.sm),
					stack(
						{ gap: '2px', flex: '1', minWidth: '0' },
						row(
							{ justifyContent: 'space-between', gap: '8px' },
							text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight }, '{name}'),
							starRow(lib, 16, 'stars')
						),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Dined in · 2 days ago')
					)
				),
				text({ fontSize: lib.fontSize.sm, lineHeight: 1.55 }, '{text}'),
				row(
					{ gap: '6px', flexWrap: 'wrap' },
					tagChip(lib, '{dish}'),
					tagChip(lib, 'Would order again')
				),
				row(
					{ justifyContent: 'space-between', alignItems: 'center' },
					row(
						{ gap: '5px', color: lib.muted },
						icons.heart(14, 'currentColor'),
						el('span', { style: { fontSize: lib.fontSize.xs, fontWeight: 500 } }, '{helpful} helpful')
					),
					ghostButton(lib, 'Reply')
				)
			)
		});

		const courier = define({
			slug: `${lib.id}-food-delivery-courier`,
			name: 'Courier Card',
			library: lib.id,
			category: 'food',
			description: `Courier card in the ${lib.label} style — avatar, courier name and vehicle caption, a live ETA chip, mini rating stars, round call and message buttons, and a tip chip row with one amount selected.`,
			tags: ['food', 'delivery', 'courier', 'driver', 'tip'],
			args: [
				stringArg('name', 'Dani K.', { label: 'Courier', maxLength: 30 }),
				enumArg('vehicle', ['bike', 'scooter', 'car'], 'scooter', { label: 'Vehicle' }),
				numberArg('mins', 6, { label: 'ETA minutes' }),
				numberArg('rating', 4.5, { label: 'Rating (0–5)' }),
				enumArg('tip', ['2', '5', 'custom'], '5', { label: 'Tip' })
			],
			render: stack(
				cardStyle(lib, { width: '320px', padding: '14px', gap: '12px' }),
				row(
					{ gap: '12px' },
					avatarCircle('44px', lib.palette.primary.soft, lib.palette.primary.onSoft, icons.user(20, 'currentColor'), lib.fontSize.md),
					stack(
						{ gap: '4px', flex: '1', minWidth: '0' },
						row(
							{ gap: '8px', flexWrap: 'wrap' },
							text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{name}'),
							el(
								'span',
								{
									style: {
										display: 'inline-flex',
										alignItems: 'center',
										gap: '4px',
										fontSize: lib.fontSize.xs,
										fontWeight: 600,
										padding: '2px 8px',
										borderRadius: chipRadius(lib),
										background: lib.palette.success.soft,
										color: lib.palette.success.onSoft
									}
								},
								el('span', { style: { width: '6px', height: '6px', borderRadius: '999px', background: lib.palette.success.solid } }),
								'{mins} min away'
							)
						),
						row(
							{ gap: '6px' },
							el(
								'span',
								{ style: { fontSize: lib.fontSize.xs, color: lib.muted } },
								map('vehicle', { bike: 'Bicycle courier', scooter: 'Scooter courier', car: 'Car courier' }, 'Courier')
							),
							starRow(lib, 12, 'rating'),
							el('span', { style: { fontSize: lib.fontSize.xs, fontWeight: 700 } }, '{rating}')
						)
					),
					roundButton(lib, phoneIcon(15, 'currentColor')),
					roundButton(lib, icons.mail(15, 'currentColor'))
				),
				el('div', {
					style: {
						height: lib.id === 'thingtime' ? '2px' : '1px',
						background: lib.id === 'thingtime' ? lib.rainbow : lib.borderSoft
					}
				}),
				row(
					{ gap: '8px' },
					el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted, fontWeight: 500, marginRight: '2px' } }, 'Add a tip'),
					tipChip(lib, '2', '$2'),
					tipChip(lib, '5', '$5'),
					tipChip(lib, 'custom', 'Custom')
				)
			)
		});

		return [menuItem, orderStatus, reservation, review, courier];
	}
};
