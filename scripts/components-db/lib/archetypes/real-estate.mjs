// Real-estate archetype — property surfaces in five renditions: listing card,
// property spec sheet, mortgage calculator card, agent card, and tour
// scheduler. Follows the button.mjs exemplar: exactly 5 variants, `build(lib)`
// returns exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-real-estate-<variant>`.

import {
	avatarCircle,
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
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// antd chips sit on tight corners and reactflow chrome stays crisp;
// everyone else wears the pill.
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);

// Selection/fill accent: reactflow's hot pink, thingtime's ink, primary else.
const accent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid);
const onAccent = (lib) => lib.palette.primary.onSolid;

const cardStyle = (lib, width) => ({
	width,
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	fontFamily: lib.font,
	color: lib.text,
	overflow: 'hidden'
});

// Mini line glyphs from the allowlisted svg shape set (no defs/gradients).
const glyph = (size, ...shapes) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: 'currentColor',
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		...shapes
	);

const bedGlyph = (size) =>
	glyph(size, el('path', { d: 'M2 17v-6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6' }), el('line', { x1: 2, y1: 14, x2: 22, y2: 14 }));
const bathGlyph = (size) =>
	glyph(size, el('path', { d: 'M4 12h16v2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z' }), el('path', { d: 'M7 12V6a2 2 0 0 1 4 0' }));
const areaGlyph = (size) => glyph(size, el('rect', { x: 4, y: 4, width: 16, height: 16, rx: 1 }), el('path', { d: 'M12 4v8h8' }));

const specChip = (lib, icon, label) =>
	el(
		'span',
		{
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				gap: '5px',
				padding: '3px 8px',
				borderRadius: chipRadius(lib),
				background: lib.surfaceAlt,
				color: lib.muted,
				fontSize: lib.fontSize.xs,
				fontWeight: 500
			}
		},
		icon,
		label
	);

const ctaBase = (lib) => ({
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: lib.control.md,
	padding: '0 14px',
	border: 'none',
	borderRadius: lib.radius.md,
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	fontSize: lib.fontSize.sm,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

// Tone-mapped CTAs — only for variants that declare the `tone` arg.
const solidCta = (lib, label, extra) =>
	el(
		'button',
		{
			type: 'button',
			style: merge(ctaBase(lib), extra, {
				background: toneMap(lib, (palette) => palette.solid),
				color: toneMap(lib, (palette) => palette.onSolid),
				boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
			})
		},
		label
	);

const ghostCta = (lib, label, extra) =>
	el(
		'button',
		{
			type: 'button',
			style: merge(ctaBase(lib), extra, { background: 'transparent', color: toneMap(lib, (palette) => palette.solid) })
		},
		label
	);

export const archetype = {
	id: 'real-estate',
	category: 'property',
	variants: ['listing', 'details', 'mortgage', 'agent', 'tour'],
	build(lib) {
		const listing = define({
			slug: `${lib.id}-real-estate-listing`,
			name: 'Listing Card',
			library: lib.id,
			category: 'property',
			description: `Property listing card in the ${lib.label} style — tinted photo band with a home glyph and optional New chip, bold price over the address, bed/bath/area spec chips, and a saved-heart toggle${lib.id === 'thingtime' ? ', capped by the house rainbow strip' : ''}.`,
			tags: ['real-estate', 'listing', 'card', 'property'],
			args: [
				stringArg('price', '$849,000', { label: 'Price', maxLength: 16 }),
				stringArg('address', '42 Marigold Ave, Portland', { label: 'Address', maxLength: 60 }),
				stringArg('beds', '3', { label: 'Beds', maxLength: 3 }),
				stringArg('sqft', '1,840', { label: 'Square feet', maxLength: 8 }),
				booleanArg('isNew', true, { label: 'New listing' }),
				booleanArg('saved', false, { label: 'Saved' })
			],
			render: stack(
				cardStyle(lib, '300px'),
				el(
					'div',
					{
						style: {
							position: 'relative',
							height: '104px',
							background: lib.palette.primary.soft,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center'
						}
					},
					icons.home(30, lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid),
					iff(
						'isNew',
						el(
							'span',
							{
								style: {
									position: 'absolute',
									top: '10px',
									left: '10px',
									padding: '2px 8px',
									borderRadius: chipRadius(lib),
									background: lib.id === 'reactflow' ? lib.accent : lib.palette.success.solid,
									color: lib.palette.success.onSolid,
									fontSize: lib.fontSize.xs,
									fontWeight: 700
								}
							},
							'New'
						)
					),
					el(
						'div',
						{
							style: {
								position: 'absolute',
								top: '8px',
								right: '8px',
								width: '28px',
								height: '28px',
								borderRadius: '999px',
								background: lib.surface,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								boxShadow: lib.shadow.sm
							}
						},
						iff('saved', icons.heart(15, lib.palette.danger.solid, true), icons.heart(15, lib.muted, false))
					)
				),
				lib.id === 'thingtime' ? el('div', { style: { height: '3px', background: lib.rainbow } }) : null,
				stack(
					{ padding: '12px 14px', gap: '5px' },
					text({ fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight, lineHeight: 1.2 }, '{price}'),
					text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{address}'),
					row(
						{ gap: '6px', marginTop: '4px', flexWrap: 'wrap' },
						specChip(lib, bedGlyph(12), '{beds} bd'),
						specChip(lib, bathGlyph(12), '2 ba'),
						specChip(lib, areaGlyph(12), '{sqft} sqft')
					)
				)
			)
		});

		const specRows = [
			['Year built', '{year}'],
			['Lot size', '6,100 sqft'],
			['HOA', '$85/mo'],
			['Type', 'Single family']
		];
		const highlightChip = (label) =>
			el(
				'span',
				{
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						gap: '4px',
						padding: '3px 9px',
						borderRadius: chipRadius(lib),
						background: lib.palette.primary.soft,
						color: lib.palette.primary.onSoft,
						fontSize: lib.fontSize.xs,
						fontWeight: 600
					}
				},
				icons.check(11, 'currentColor'),
				label
			);
		const details = define({
			slug: `${lib.id}-real-estate-details`,
			name: 'Property Spec Sheet',
			library: lib.id,
			category: 'property',
			description: `Property spec sheet in the ${lib.label} style — header price with a for-sale/pending/sold status tint, two-column spec rows, highlight chips, and a Schedule tour plus Ask a question action pair.`,
			tags: ['real-estate', 'details', 'specs', 'property'],
			args: [
				stringArg('price', '$849,000', { label: 'Price', maxLength: 16 }),
				enumArg('status', ['for-sale', 'pending', 'sold'], 'for-sale', { label: 'Status' }),
				stringArg('year', '2018', { label: 'Year built', maxLength: 6 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: cardStyle(lib, '320px') },
				stack(
					{ padding: '14px 16px', gap: '12px' },
					row(
						{ justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' },
						stack(
							{ gap: '2px' },
							text({ fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight }, '{price}'),
							text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Asking price')
						),
						el(
							'span',
							{
								style: merge(
									{ padding: '3px 10px', borderRadius: chipRadius(lib), fontSize: lib.fontSize.xs, fontWeight: 600 },
									map('status', {
										'for-sale': { background: lib.palette.success.soft, color: lib.palette.success.onSoft },
										pending: { background: lib.palette.warning.soft, color: lib.palette.warning.onSoft },
										sold: { background: lib.palette.neutral.soft, color: lib.palette.neutral.onSoft }
									})
								)
							},
							map('status', { 'for-sale': 'For sale', pending: 'Pending', sold: 'Sold' })
						)
					),
					stack(
						{},
						...specRows.map(([label, value], index) =>
							el(
								'div',
								{
									style: {
										display: 'flex',
										justifyContent: 'space-between',
										alignItems: 'center',
										padding: '7px 0',
										...(index ? { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft } : {})
									}
								},
								text({ fontSize: lib.fontSize.sm, color: lib.muted }, label),
								text({ fontSize: lib.fontSize.sm, fontWeight: 600 }, value)
							)
						)
					),
					row({ gap: '6px' }, highlightChip('Garage'), highlightChip('Pool')),
					row({ gap: '8px' }, solidCta(lib, 'Schedule tour', { flex: '1' }), ghostCta(lib, 'Ask a question', { flex: '1' }))
				)
			)
		});

		const breakdownRow = (dotColor, label, value) =>
			el(
				'div',
				{ style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0' } },
				el('span', { style: { width: '8px', height: '8px', borderRadius: '999px', background: dotColor, flexShrink: 0 } }),
				text({ flex: '1', fontSize: lib.fontSize.sm, color: lib.muted }, label),
				text({ fontSize: lib.fontSize.sm, fontWeight: 600 }, value)
			);
		const termChip = (value) =>
			el(
				'span',
				{
					style: merge(
						{
							padding: '3px 10px',
							borderRadius: chipRadius(lib),
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							background: lib.surface,
							color: lib.muted,
							fontSize: lib.fontSize.xs,
							fontWeight: 600
						},
						ifEq('term', value, { background: accent(lib), borderColor: accent(lib), color: onAccent(lib) })
					)
				},
				value
			);
		const mortgage = define({
			slug: `${lib.id}-real-estate-mortgage`,
			name: 'Mortgage Calculator',
			library: lib.id,
			category: 'property',
			description: `Mortgage calculator card in the ${lib.label} style — big estimated monthly payment, color-dotted principal/taxes/insurance breakdown rows, a percent-filled down-payment bar${lib.id === 'thingtime' ? ' in the house rainbow' : ''}, and rate plus loan-term chips.`,
			tags: ['real-estate', 'mortgage', 'calculator', 'finance'],
			args: [
				stringArg('payment', '$4,115', { label: 'Monthly payment', maxLength: 12 }),
				numberArg('down', 20, { label: 'Down payment %', min: 0, max: 100 }),
				stringArg('rate', '6.25%', { label: 'Rate', maxLength: 8 }),
				enumArg('term', ['15-year', '30-year'], '30-year', { label: 'Loan term' })
			],
			render: el(
				'div',
				{ style: cardStyle(lib, '300px') },
				stack(
					{ padding: '14px 16px', gap: '12px' },
					stack(
						{ gap: '2px' },
						text(
							{ fontSize: lib.fontSize.xs, color: lib.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 },
							'Estimated payment'
						),
						text({ fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight }, 'Est. {payment}/mo')
					),
					stack(
						{},
						breakdownRow(accent(lib), 'Principal & interest', '$3,410'),
						breakdownRow(lib.palette.info.solid, 'Taxes', '$495'),
						breakdownRow(lib.palette.warning.solid, 'Insurance', '$210')
					),
					stack(
						{ gap: '6px' },
						row(
							{ justifyContent: 'space-between' },
							text({ fontSize: lib.fontSize.sm, color: lib.muted }, 'Down payment'),
							text({ fontSize: lib.fontSize.sm, fontWeight: 700 }, '{down}%')
						),
						el(
							'div',
							{ style: { height: '6px', borderRadius: lib.radius.pill, background: lib.borderSoft } },
							el('div', {
								style: {
									width: '{down}%',
									height: '6px',
									borderRadius: lib.radius.pill,
									background: lib.id === 'thingtime' ? lib.rainbow : accent(lib)
								}
							})
						)
					),
					row(
						{ gap: '6px', flexWrap: 'wrap' },
						el(
							'span',
							{
								style: {
									padding: '3px 10px',
									borderRadius: chipRadius(lib),
									background: lib.palette.info.soft,
									color: lib.palette.info.onSoft,
									fontSize: lib.fontSize.xs,
									fontWeight: 600
								}
							},
							'{rate} APR'
						),
						termChip('15-year'),
						termChip('30-year')
					)
				)
			)
		});

		const statCell = (value, label) =>
			stack(
				{ alignItems: 'center', gap: '2px', flex: '1' },
				text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, value),
				text({ fontSize: lib.fontSize.xs, color: lib.muted }, label)
			);
		const vDivider = () => el('div', { style: { width: '1px', alignSelf: 'stretch', background: lib.borderSoft } });
		const agent = define({
			slug: `${lib.id}-real-estate-agent`,
			name: 'Agent Card',
			library: lib.id,
			category: 'property',
			description: `Real-estate agent card in the ${lib.label} style — initials avatar with name and brokerage, listings/sold/rating stat trio with mini stars, a response-time chip, Call and Message actions, and a mono license caption.`,
			tags: ['real-estate', 'agent', 'profile', 'contact'],
			args: [
				stringArg('name', 'Sasha Reid', { label: 'Name', maxLength: 40 }),
				stringArg('initials', 'SR', { label: 'Initials', maxLength: 3 }),
				stringArg('brokerage', 'Harbor & Co. Realty', { label: 'Brokerage', maxLength: 48 }),
				stringArg('listings', '24', { label: 'Active listings', maxLength: 4 }),
				stringArg('rating', '4.9', { label: 'Rating', maxLength: 4 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: cardStyle(lib, '300px') },
				stack(
					{ padding: '14px 16px', gap: '12px' },
					row(
						{ gap: '10px' },
						avatarCircle(
							'44px',
							lib.id === 'thingtime' ? lib.rainbow : lib.palette.primary.soft,
							lib.id === 'thingtime' ? '#ffffff' : lib.palette.primary.onSoft,
							'{initials}',
							lib.fontSize.md
						),
						stack(
							{ gap: '1px', flex: '1', minWidth: '0' },
							text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, '{name}'),
							text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{brokerage}')
						)
					),
					row(
						{ gap: '10px' },
						statCell('{listings}', 'Listings'),
						vDivider(),
						statCell('112', 'Sold'),
						vDivider(),
						stack(
							{ alignItems: 'center', gap: '3px', flex: '1' },
							text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, '{rating}'),
							row({ gap: '1px' }, { ttRepeat: { count: 5, max: 5, node: icons.star(9, lib.palette.warning.solid, true) } })
						)
					),
					el(
						'span',
						{
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								gap: '5px',
								padding: '3px 9px',
								borderRadius: chipRadius(lib),
								background: lib.palette.success.soft,
								color: lib.palette.success.onSoft,
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								alignSelf: 'flex-start',
								boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
							}
						},
						icons.clock(11, 'currentColor'),
						'Replies in ~1 hr'
					),
					row({ gap: '8px' }, ghostCta(lib, 'Call', { flex: '1' }), solidCta(lib, 'Message', { flex: '1' })),
					text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: lib.faint }, 'Lic. #01429876')
				)
			)
		});

		const dayChip = ([day, date]) =>
			el(
				'div',
				{
					style: merge(
						{
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: '2px',
							padding: '7px 0',
							flex: '1',
							borderRadius: lib.id === 'antd' || lib.id === 'reactflow' ? lib.radius.sm : lib.radius.md,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
						},
						ifEq('day', day, { background: accent(lib), borderColor: accent(lib), color: onAccent(lib) })
					)
				},
				text({ fontSize: lib.fontSize.xs, opacity: 0.75 }, day),
				text({ fontSize: lib.fontSize.md, fontWeight: 700 }, date)
			);
		const slotChip = (slot, unavailable) =>
			el(
				'span',
				{
					style: merge(
						{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							height: '30px',
							borderRadius: chipRadius(lib),
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							fontSize: lib.fontSize.xs,
							fontWeight: 600
						},
						unavailable
							? { color: lib.faint, textDecoration: 'line-through', background: lib.surfaceAlt, borderColor: lib.borderSoft }
							: ifEq('time', slot, { background: accent(lib), borderColor: accent(lib), color: onAccent(lib) })
					)
				},
				slot
			);
		const modeSeg = (value, label) =>
			el(
				'span',
				{
					style: merge(
						{
							flex: '1',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							height: '26px',
							borderRadius: chipRadius(lib),
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							color: lib.muted
						},
						ifEq('mode', value, { background: lib.surface, color: lib.text, boxShadow: lib.shadow.sm })
					)
				},
				label
			);
		const tour = define({
			slug: `${lib.id}-real-estate-tour`,
			name: 'Tour Scheduler',
			library: lib.id,
			category: 'property',
			description: `Home tour scheduler in the ${lib.label} style — a four-day date chip row, a six-slot time grid with one slot struck out as unavailable, an in-person/video segmented toggle, and a Confirm tour action.`,
			tags: ['real-estate', 'tour', 'scheduler', 'booking'],
			args: [
				enumArg('day', ['Mon', 'Tue', 'Wed', 'Thu'], 'Wed', { label: 'Day' }),
				enumArg('time', ['9:00', '10:30', '1:30', '3:00', '4:30'], '10:30', { label: 'Time' }),
				enumArg('mode', ['in-person', 'video'], 'in-person', { label: 'Tour type' }),
				toneArg()
			],
			render: el(
				'div',
				{ style: cardStyle(lib, '300px') },
				stack(
					{ padding: '14px 16px', gap: '12px' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, 'Schedule a tour'),
					row(
						{ gap: '6px' },
						...[
							['Mon', '12'],
							['Tue', '13'],
							['Wed', '14'],
							['Thu', '15']
						].map(dayChip)
					),
					el(
						'div',
						{ style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' } },
						slotChip('9:00'),
						slotChip('10:30'),
						slotChip('12:00', true),
						slotChip('1:30'),
						slotChip('3:00'),
						slotChip('4:30')
					),
					row(
						{ padding: '3px', background: lib.surfaceAlt, borderRadius: chipRadius(lib), gap: '2px' },
						modeSeg('in-person', 'In person'),
						modeSeg('video', 'Video call')
					),
					solidCta(lib, 'Confirm tour')
				)
			)
		});

		return [listing, details, mortgage, agent, tour];
	}
};
