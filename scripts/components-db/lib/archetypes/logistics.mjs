// Logistics archetype — B2B parcel & freight surfaces in five renditions:
// parcel tracking card, shipment route, warehouse slot card, freight quote,
// and customs summary. (Food-delivery owns meal tracking.) Follows the
// button.mjs exemplar: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs `${lib.id}-logistics-<v>`.

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
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Accent for "you are here" markers, active radio dots and the quote CTA —
// reactflow wears its hot-pink accent, thingtime its ink, others primary.
const accent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid);

// antd chips sit on tight 4px corners; everyone else on the small radius.
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.radius.sm);

const upper = (lib) => (lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {});

// daisyui cards wear a chunky 2px border; mui floats on elevation; reactflow's
// ink border token keeps its chrome crisp; untitled keeps the feather shadow.
const cardStyle = (lib) => ({
	display: 'flex',
	flexDirection: 'column',
	gap: '14px',
	width: '320px',
	maxWidth: '100%',
	boxSizing: 'border-box',
	padding: '16px',
	background: lib.surface,
	borderWidth: lib.id === 'daisyui' ? '2px' : '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	fontFamily: lib.font,
	color: lib.text,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
});

const glyph = (size, color, ...children) =>
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
		...children
	);

const boxGlyph = (size, color) =>
	glyph(
		size,
		color,
		el('path', { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' }),
		el('polyline', { points: '3.29 7 12 12 20.71 7' }),
		el('line', { x1: 12, y1: 22, x2: 12, y2: 12 })
	);

const copyGlyph = (size, color) =>
	glyph(
		size,
		color,
		el('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
		el('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
	);

const swapGlyph = (size, color) =>
	glyph(
		size,
		color,
		el('polyline', { points: '17 1 21 5 17 9' }),
		el('path', { d: 'M3 11V9a4 4 0 0 1 4-4h14' }),
		el('polyline', { points: '7 23 3 19 7 15' }),
		el('path', { d: 'M21 13v2a4 4 0 0 1-4 4H3' })
	);

const monoChip = (lib, label) =>
	el(
		'span',
		{
			style: {
				fontFamily: lib.fontMono,
				fontSize: lib.fontSize.sm,
				fontWeight: 600,
				color: lib.text,
				background: lib.surfaceAlt,
				padding: '3px 8px',
				borderRadius: chipRadius(lib),
				letterSpacing: '0.04em'
			}
		},
		label
	);

const softChip = (lib, label) =>
	el(
		'span',
		{
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				padding: '2px 8px',
				borderRadius: chipRadius(lib),
				background: lib.surfaceAlt,
				color: lib.muted,
				fontSize: lib.fontSize.xs,
				fontWeight: 600,
				boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
			}
		},
		label
	);

const ghostBtn = (lib, ...children) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				gap: '6px',
				height: lib.control.sm,
				padding: '0 10px',
				border: 'none',
				background: 'transparent',
				color: lib.muted,
				borderRadius: lib.radius.sm,
				fontFamily: lib.font,
				fontWeight: lib.buttonWeight,
				fontSize: lib.fontSize.sm,
				cursor: 'pointer',
				...upper(lib)
			}
		},
		...children
	);

const divider = (lib) => el('div', { style: { height: '1px', background: lib.borderSoft } });

const caption = (lib) => ({ fontSize: lib.fontSize.xs, color: lib.muted });

export const archetype = {
	id: 'logistics',
	category: 'logistics',
	variants: ['package', 'route', 'warehouse', 'quote', 'customs'],
	build(lib) {
		const pkg = define({
			slug: `${lib.id}-logistics-package`,
			name: 'Parcel Tracking Card',
			library: lib.id,
			category: 'logistics',
			description: `Parcel card in the ${lib.label} style — box glyph tile, mono tracking chip with a copy ghost, carrier caption, tinted status chip and an ETA row with a notify action.`,
			tags: ['logistics', 'parcel', 'tracking', 'shipping'],
			args: [
				stringArg('tracking', '1Z 999 AA1 0134', { label: 'Tracking number', maxLength: 24 }),
				stringArg('carrier', 'DHL Express', { label: 'Carrier', maxLength: 24 }),
				enumArg('status', ['created', 'in-transit', 'out-for-delivery', 'delivered'], 'in-transit', { label: 'Status' }),
				stringArg('eta', 'Thu 21 Aug', { label: 'ETA', maxLength: 20 })
			],
			render: el(
				'div',
				{ style: cardStyle(lib) },
				row(
					{ gap: '12px', alignItems: 'flex-start' },
					el(
						'div',
						{
							style: {
								width: '40px',
								height: '40px',
								borderRadius: lib.radius.md,
								background: lib.palette.primary.soft,
								color: lib.palette.primary.onSoft,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0
							}
						},
						boxGlyph(20, 'currentColor')
					),
					stack(
						{ gap: '4px', flex: 1, minWidth: 0 },
						row(
							{ gap: '4px' },
							monoChip(lib, '{tracking}'),
							el(
								'button',
								{
									type: 'button',
									title: 'Copy tracking number',
									style: {
										display: 'inline-flex',
										alignItems: 'center',
										justifyContent: 'center',
										width: '22px',
										height: '22px',
										padding: '0',
										border: 'none',
										background: 'transparent',
										color: lib.muted,
										cursor: 'pointer',
										borderRadius: lib.radius.xs
									}
								},
								copyGlyph(12, 'currentColor')
							)
						),
						text(caption(lib), '{carrier} · Priority freight')
					)
				),
				el(
					'span',
					{
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							alignSelf: 'flex-start',
							padding: '3px 10px',
							borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							background: map(
								'status',
								{
									created: lib.palette.neutral.soft,
									'in-transit': lib.palette.info.soft,
									'out-for-delivery': lib.palette.warning.soft,
									delivered: lib.palette.success.soft
								},
								lib.palette.info.soft
							),
							color: map(
								'status',
								{
									created: lib.palette.neutral.onSoft,
									'in-transit': lib.palette.info.onSoft,
									'out-for-delivery': lib.palette.warning.onSoft,
									delivered: lib.palette.success.onSoft
								},
								lib.palette.info.onSoft
							)
						}
					},
					map(
						'status',
						{
							created: 'Label created',
							'in-transit': 'In transit',
							'out-for-delivery': 'Out for delivery',
							delivered: 'Delivered'
						},
						'In transit'
					)
				),
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					row({ gap: '6px' }, icons.clock(14, lib.muted), text({ fontSize: lib.fontSize.sm, color: lib.text, fontWeight: 500 }, 'Arrives {eta}')),
					ghostBtn(lib, icons.bell(13, 'currentColor'), 'Notify')
				)
			)
		});

		const hopRow = (cityNode, captionText, hopKey) =>
			row(
				{ gap: '10px', alignItems: 'flex-start' },
				el(
					'div',
					{ style: { width: '24px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
					ifEq(
						'currentHop',
						hopKey,
						icons.arrowRight(14, accent(lib)),
						el('span', {
							style: { width: '8px', height: '8px', borderRadius: '999px', background: lib.id === 'reactflow' ? lib.dot : lib.faint }
						})
					)
				),
				stack(
					{ gap: '2px', minWidth: 0 },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, cityNode),
					text(caption(lib), captionText)
				)
			);

		const rail = (activeValues) =>
			el('div', {
				style: {
					width: '2px',
					height: '14px',
					marginLeft: '11px',
					borderRadius: '999px',
					background: map('currentHop', activeValues, lib.borderSoft)
				}
			});

		const route = define({
			slug: `${lib.id}-logistics-route`,
			name: 'Shipment Route',
			library: lib.id,
			category: 'logistics',
			description: `Shipment route in the ${lib.label} style — origin, hub and destination hops with timestamp captions, connector rails, an arrow marker at the current hop and distance/weight chips.`,
			tags: ['logistics', 'route', 'shipment', 'freight', 'tracking'],
			args: [
				stringArg('origin', 'Sydney', { label: 'Origin', maxLength: 24 }),
				stringArg('destination', 'Auckland', { label: 'Destination', maxLength: 24 }),
				enumArg('currentHop', ['origin', 'hub', 'destination'], 'hub', { label: 'Current hop' }),
				stringArg('distance', '2,156 km', { label: 'Distance', maxLength: 16 }),
				stringArg('weight', '480 kg', { label: 'Weight', maxLength: 16 })
			],
			render: el(
				'div',
				{ style: cardStyle(lib) },
				stack(
					{ gap: '2px' },
					hopRow('{origin}', 'Departed 6:40 AM', 'origin'),
					rail({ hub: accent(lib), destination: accent(lib) }),
					hopRow('Melbourne Gateway Hub', 'Arrived 1:15 PM · sorting', 'hub'),
					rail({ destination: accent(lib) }),
					hopRow('{destination}', 'ETA 8:30 PM', 'destination')
				),
				row({ gap: '6px' }, softChip(lib, '{distance}'), softChip(lib, '{weight}'))
			)
		});

		const warehouse = define({
			slug: `${lib.id}-logistics-warehouse`,
			name: 'Warehouse Slot Card',
			library: lib.id,
			category: 'logistics',
			description: `Warehouse slot card in the ${lib.label} style — aisle/rack/bin mono locator chips, a stepped capacity bar that flips to warning tints as it fills, SKU count caption and a reassign action.`,
			tags: ['logistics', 'warehouse', 'inventory', 'capacity'],
			args: [
				stringArg('aisle', 'A3', { label: 'Aisle', maxLength: 6 }),
				stringArg('rack', 'R12', { label: 'Rack', maxLength: 6 }),
				stringArg('bin', 'B07', { label: 'Bin', maxLength: 6 }),
				enumArg('fill', ['25', '50', '75', '90', '100'], '75', { label: 'Fill %' }),
				stringArg('skus', '128', { label: 'SKU count', maxLength: 8 })
			],
			render: el(
				'div',
				{ style: cardStyle(lib) },
				row(
					{ gap: '6px' },
					monoChip(lib, '{aisle}'),
					text({ color: lib.faint, fontWeight: 600 }, '–'),
					monoChip(lib, '{rack}'),
					text({ color: lib.faint, fontWeight: 600 }, '–'),
					monoChip(lib, '{bin}')
				),
				stack(
					{ gap: '6px' },
					row(
						{ justifyContent: 'space-between', gap: '10px' },
						text({ fontSize: lib.fontSize.sm, color: lib.muted }, 'Capacity'),
						text(
							{
								fontSize: lib.fontSize.sm,
								fontWeight: 600,
								color: map(
									'fill',
									{ 90: lib.palette.warning.onSoft, 100: lib.palette.danger.onSoft },
									lib.palette.success.onSoft
								)
							},
							'{fill}% full'
						)
					),
					el(
						'div',
						{ style: { height: '8px', background: lib.borderSoft, borderRadius: lib.radius.pill, overflow: 'hidden' } },
						el('div', {
							style: {
								width: '{fill}%',
								height: '8px',
								borderRadius: lib.radius.pill,
								background: map(
									'fill',
									{ 90: lib.palette.warning.solid, 100: lib.palette.danger.solid },
									lib.palette.success.solid
								)
							}
						})
					)
				),
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					text(caption(lib), '{skus} SKUs · last scan 12 min ago'),
					ghostBtn(lib, 'Reassign')
				)
			)
		});

		const segment = (value) =>
			el(
				'span',
				{
					style: merge(
						{
							flex: 1,
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							height: '26px',
							borderRadius: lib.radius.sm,
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							cursor: 'pointer'
						},
						ifEq(
							'size',
							value,
							{ background: lib.surface, color: lib.text, boxShadow: lib.shadow.sm },
							{ background: 'transparent', color: lib.muted }
						)
					)
				},
				value
			);

		const speedRadio = (value) =>
			row(
				{ gap: '6px' },
				el(
					'span',
					{
						style: {
							width: '14px',
							height: '14px',
							borderRadius: '999px',
							borderWidth: '1.5px',
							borderStyle: 'solid',
							borderColor: ifEq('speed', value, accent(lib), lib.border),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							boxSizing: 'border-box',
							flexShrink: 0
						}
					},
					el('span', {
						style: { width: '6px', height: '6px', borderRadius: '999px', background: ifEq('speed', value, accent(lib), 'transparent') }
					})
				),
				text({ fontSize: lib.fontSize.sm, color: lib.text }, value)
			);

		const quote = define({
			slug: `${lib.id}-logistics-quote`,
			name: 'Freight Quote Card',
			library: lib.id,
			category: 'logistics',
			description: `Freight quote in the ${lib.label} style — origin/destination row with a swap glyph, package size segments, weight chip and speed radios, then the estimated total and a quote action.`,
			tags: ['logistics', 'freight', 'quote', 'shipping', 'pricing'],
			args: [
				stringArg('origin', 'Brisbane', { label: 'Origin', maxLength: 24 }),
				stringArg('destination', 'Perth', { label: 'Destination', maxLength: 24 }),
				enumArg('size', ['S', 'M', 'L', 'Pallet'], 'M', { label: 'Package size' }),
				enumArg('speed', ['Express', 'Standard'], 'Express', { label: 'Speed' }),
				stringArg('weight', '480 kg', { label: 'Weight', maxLength: 16 }),
				stringArg('price', '$1,284', { label: 'Quote', maxLength: 12 })
			],
			render: el(
				'div',
				{ style: cardStyle(lib) },
				lib.rainbow ? el('div', { style: { height: '4px', borderRadius: lib.radius.pill, background: lib.rainbow } }) : null,
				row(
					{ gap: '10px' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, '{origin}'),
					swapGlyph(16, lib.muted),
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, '{destination}')
				),
				row(
					{ gap: '4px', padding: '3px', background: lib.surfaceAlt, borderRadius: lib.radius.md, boxSizing: 'border-box' },
					segment('S'),
					segment('M'),
					segment('L'),
					segment('Pallet')
				),
				row(
					{ justifyContent: 'space-between', gap: '12px' },
					softChip(lib, '{weight}'),
					row({ gap: '14px' }, speedRadio('Express'), speedRadio('Standard'))
				),
				divider(lib),
				row(
					{ justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px' },
					stack(
						{ gap: '2px' },
						text(caption(lib), 'Estimated total'),
						text({ fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight, color: lib.text }, '{price}')
					),
					el(
						'button',
						{
							type: 'button',
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								height: lib.control.md,
								padding: '0 14px',
								border: 'none',
								borderRadius: lib.radius.md,
								background: accent(lib),
								color: '#ffffff',
								fontFamily: lib.font,
								fontWeight: lib.buttonWeight,
								fontSize: lib.fontSize.sm,
								cursor: 'pointer',
								boxShadow: lib.id === 'mui' ? lib.shadow.sm : 'none',
								...upper(lib)
							}
						},
						'Get exact quote'
					)
				)
			)
		});

		const declRow = (label, valueNode, mono) =>
			row(
				{ justifyContent: 'space-between', gap: '12px' },
				text({ fontSize: lib.fontSize.sm, color: lib.muted }, label),
				text(
					{ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text, ...(mono ? { fontFamily: lib.fontMono } : {}) },
					valueNode
				)
			);

		const customs = define({
			slug: `${lib.id}-logistics-customs`,
			name: 'Customs Summary Card',
			library: lib.id,
			category: 'logistics',
			description: `Customs summary in the ${lib.label} style — contents, value and HS-code declaration rows, a duties estimate with info glyph, an optional restricted-item warning banner, plus confirm and edit actions.`,
			tags: ['logistics', 'customs', 'declaration', 'freight'],
			args: [
				stringArg('contents', 'Electronics — routers', { label: 'Contents', maxLength: 40 }),
				stringArg('duties', '$86.40', { label: 'Duties estimate', maxLength: 12 }),
				booleanArg('restricted', true, { label: 'Restricted items' }),
				toneArg()
			],
			render: el(
				'div',
				{ style: cardStyle(lib) },
				text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, 'Customs declaration'),
				stack(
					{ gap: '8px' },
					declRow('Contents', '{contents}'),
					declRow('Declared value', 'USD 1,240.00'),
					declRow('HS code', '8517.62', true)
				),
				divider(lib),
				row(
					{ justifyContent: 'space-between', gap: '12px' },
					row({ gap: '6px' }, icons.info(14, lib.muted), text({ fontSize: lib.fontSize.sm, color: lib.muted }, 'Estimated duties')),
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{duties}')
				),
				iff(
					'restricted',
					row(
						{
							gap: '8px',
							alignItems: 'flex-start',
							padding: '10px 12px',
							borderRadius: lib.radius.md,
							background: lib.palette.danger.soft,
							color: lib.palette.danger.onSoft
						},
						icons.alert(14, 'currentColor'),
						text({ fontSize: lib.fontSize.xs, fontWeight: 500, lineHeight: 1.4 }, 'Restricted items flagged — additional screening applies before export.')
					)
				),
				row(
					{ gap: '8px' },
					el(
						'button',
						{
							type: 'button',
							style: {
								flex: 1,
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								height: lib.control.md,
								padding: '0 14px',
								border: 'none',
								borderRadius: lib.radius.md,
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								fontFamily: lib.font,
								fontWeight: lib.buttonWeight,
								fontSize: lib.fontSize.sm,
								cursor: 'pointer',
								boxShadow: lib.id === 'mui' ? lib.shadow.sm : 'none',
								...upper(lib)
							}
						},
						'Confirm'
					),
					ghostBtn(lib, 'Edit')
				)
			)
		});

		return [pkg, route, warehouse, quote, customs];
	}
};
