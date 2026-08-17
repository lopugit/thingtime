// Banking archetype — finance surfaces in five renditions: balance card,
// transaction list, transfer form mock, credit-card visual, and spending
// breakdown. Follows the button.mjs exemplar: exactly 5 variants, `build(lib)`
// returns exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-banking-<variant>`.

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
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Shared card shell: mui + untitled float on their signature shadows,
// reactflow stays crisp on its near-black border, everyone else sits quiet.
const panel = (lib) => ({
	display: 'flex',
	flexDirection: 'column',
	boxSizing: 'border-box',
	width: '320px',
	padding: '20px',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' || lib.id === 'untitled' ? lib.shadow.md : lib.shadow.sm,
	fontFamily: lib.font,
	color: lib.text
});

// mui wears its uppercase overline captions; everyone else stays sentence case.
const caption = (lib) => ({
	fontSize: lib.fontSize.xs,
	fontWeight: 500,
	color: lib.muted,
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: '0.06em' } : {})
});

// reactflow sets money figures in its mono for that instrument-panel feel.
const moneyFont = (lib) => (lib.id === 'reactflow' ? lib.fontMono : lib.font);

const ghostButton = (lib, label) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				flex: 1,
				height: lib.control.sm,
				padding: '0 12px',
				border: 'none',
				background: 'transparent',
				borderRadius: lib.radius.sm,
				fontFamily: lib.font,
				fontWeight: lib.buttonWeight,
				fontSize: lib.fontSize.sm,
				color: lib.palette.primary.solid,
				cursor: 'pointer',
				...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
			}
		},
		label
	);

// Category icon tile: soft tone square carrying a glyph (antd keeps corners tight).
const iconTile = (lib, palette, icon) =>
	el(
		'div',
		{
			style: {
				width: '36px',
				height: '36px',
				borderRadius: lib.id === 'antd' ? lib.radius.sm : lib.radius.md,
				background: palette.soft,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				flexShrink: 0
			}
		},
		icon(16, palette.onSoft)
	);

const txnRow = (lib, tileNode, merchant, date, amount, amountColor, divided) =>
	el(
		'div',
		{
			style: {
				display: 'flex',
				alignItems: 'center',
				gap: '12px',
				padding: '10px 0',
				...(divided ? { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft } : {})
			}
		},
		tileNode,
		el(
			'div',
			{ style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
			text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, merchant),
			text({ fontSize: lib.fontSize.xs, color: lib.muted }, date)
		),
		text(
			{ marginLeft: 'auto', fontSize: lib.fontSize.sm, fontWeight: 600, color: amountColor, fontFamily: moneyFont(lib) },
			amount
		)
	);

const accountRow = (lib, labelText, name, mask, palette) =>
	el(
		'div',
		{ style: { display: 'flex', alignItems: 'center', gap: '12px' } },
		el(
			'div',
			{
				style: {
					width: '36px',
					height: '36px',
					borderRadius: lib.radius.pill,
					background: palette.soft,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					flexShrink: 0
				}
			},
			icons.user(16, palette.onSoft)
		),
		el(
			'div',
			{ style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
			text(caption(lib), labelText),
			text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, name)
		),
		text({ marginLeft: 'auto', fontSize: lib.fontSize.xs, color: lib.muted, fontFamily: lib.fontMono }, mask)
	);

// Contactless payment arcs (three nested right-opening strokes).
const contactless = (size, color) =>
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
			xmlns: 'http://www.w3.org/2000/svg'
		},
		el('path', { d: 'M6 9.5a4.5 4.5 0 0 1 0 5' }),
		el('path', { d: 'M9.5 7a8 8 0 0 1 0 10' }),
		el('path', { d: 'M13 4.5a12 12 0 0 1 0 15' })
	);

const cardDot = (lib, opacity, overlap) =>
	el('div', {
		style: {
			width: '18px',
			height: '18px',
			borderRadius: lib.radius.pill,
			background: toneMap(lib, (palette) => palette.onSolid),
			opacity,
			...(overlap ? { marginLeft: '-7px' } : {})
		}
	});

// daisyui bulks its progress tracks up a notch — chunky by nature.
const trackH = (lib) => (lib.id === 'daisyui' ? '10px' : '8px');

const spendBar = (lib, label, widthValue, amount, palette, fillOverride) =>
	el(
		'div',
		{ style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
		el(
			'div',
			{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
			text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text }, label),
			text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.muted, fontFamily: moneyFont(lib) }, amount)
		),
		el(
			'div',
			{ style: { height: trackH(lib), borderRadius: lib.radius.pill, background: palette.soft } },
			el('div', {
				style: {
					height: trackH(lib),
					width: widthValue,
					borderRadius: lib.radius.pill,
					background: fillOverride || palette.solid
				}
			})
		)
	);

export const archetype = {
	id: 'banking',
	category: 'finance',
	variants: ['balance', 'transaction', 'transfer', 'credit-card', 'spending'],
	build(lib) {
		const balance = define({
			slug: `${lib.id}-banking-balance`,
			name: 'Balance Card',
			library: lib.id,
			category: 'finance',
			description: `Account balance card in the ${lib.label} style — total-balance caption over a large figure, a trend chip that flips success/danger with direction, masked account line and ghost Send / Top up actions.`,
			tags: ['banking', 'balance', 'finance', 'card'],
			args: [
				stringArg('amount', '$24,562.80', { label: 'Amount', maxLength: 16 }),
				stringArg('change', '4.2', { label: 'Change %', maxLength: 8 }),
				booleanArg('up', true, { label: 'Trending up' }),
				stringArg('mask', '4821', { label: 'Account last 4', maxLength: 6 })
			],
			render: el(
				'div',
				{ style: { ...panel(lib), gap: '8px' } },
				lib.id === 'thingtime'
					? el('div', {
							style: { height: '4px', borderRadius: lib.radius.pill, background: lib.rainbow, marginBottom: '2px' }
						})
					: null,
				text(caption(lib), 'Total balance'),
				text(
					{ fontSize: '28px', fontWeight: lib.headingWeight, lineHeight: 1.1, fontFamily: moneyFont(lib), color: lib.text },
					'{amount}'
				),
				el(
					'span',
					{
						style: merge(
							{
								display: 'inline-flex',
								alignItems: 'center',
								alignSelf: 'flex-start',
								padding: '3px 10px',
								borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
								fontSize: lib.fontSize.xs,
								fontWeight: 600
							},
							iff(
								'up',
								{ background: lib.palette.success.soft, color: lib.palette.success.onSoft },
								{ background: lib.palette.danger.soft, color: lib.palette.danger.onSoft }
							)
						)
					},
					iff('up', '+{change}% this month', '-{change}% this month')
				),
				text({ fontSize: lib.fontSize.sm, color: lib.muted, fontFamily: lib.fontMono }, '•••• {mask}'),
				row({ gap: '8px', marginTop: '6px' }, ghostButton(lib, 'Send'), ghostButton(lib, 'Top up'))
			)
		});

		const transaction = define({
			slug: `${lib.id}-banking-transaction`,
			name: 'Transaction List',
			library: lib.id,
			category: 'finance',
			description: `Recent-transactions list in the ${lib.label} style — category icon tiles in soft tone squares, merchant and date stacked beside right-aligned amounts, incoming pay highlighted in success green.`,
			tags: ['banking', 'transactions', 'finance', 'list'],
			args: [
				enumArg('category', ['groceries', 'transport', 'salary'], 'groceries', { label: 'Category' }),
				stringArg('merchant', 'Fresh Mart', { label: 'Merchant', maxLength: 24 }),
				stringArg('amount', '-$32.40', { label: 'Amount', maxLength: 12 }),
				stringArg('date', 'Today, 9:41', { label: 'Date', maxLength: 20 })
			],
			render: el(
				'div',
				{ style: { ...panel(lib), width: '340px', padding: '8px 16px 6px' } },
				text({ ...caption(lib), padding: '8px 0 2px' }, 'Recent activity'),
				txnRow(
					lib,
					map('category', {
						groceries: iconTile(lib, lib.palette.warning, icons.heart),
						transport: iconTile(lib, lib.palette.info, icons.zap),
						salary: iconTile(lib, lib.palette.success, icons.download)
					}),
					'{merchant}',
					'{date}',
					'{amount}',
					lib.muted,
					false
				),
				txnRow(lib, iconTile(lib, lib.palette.info, icons.zap), 'Metro Transit', 'Yesterday', '-$2.75', lib.muted, true),
				txnRow(
					lib,
					iconTile(lib, lib.palette.success, icons.download),
					'Acme Payroll',
					'Aug 12',
					'+$4,250.00',
					lib.palette.success.onSoft,
					true
				)
			)
		});

		const transfer = define({
			slug: `${lib.id}-banking-transfer`,
			name: 'Transfer Form',
			library: lib.id,
			category: 'finance',
			description: `Money-transfer form mock in the ${lib.label} style — From and To account rows with avatars and masked numbers, a swap arrow between them, a large amount display with currency chip and a tone Continue button.`,
			tags: ['banking', 'transfer', 'finance', 'form'],
			args: [
				stringArg('amount', '$250.00', { label: 'Amount', maxLength: 12 }),
				stringArg('currency', 'USD', { label: 'Currency', maxLength: 5 }),
				stringArg('fromName', 'Everyday account', { label: 'From', maxLength: 24 }),
				stringArg('toName', 'Alex Rivera', { label: 'To', maxLength: 24 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: { ...panel(lib), gap: '12px' } },
				accountRow(lib, 'From', '{fromName}', '•••• 2048', lib.palette.primary),
				el(
					'div',
					{
						style: {
							width: '24px',
							height: '24px',
							borderRadius: lib.radius.pill,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							background: lib.surface,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							marginLeft: '6px'
						}
					},
					icons.arrowDown(12, lib.muted)
				),
				accountRow(lib, 'To', '{toName}', '•••• 7731', lib.palette.info),
				el(
					'div',
					{
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							background: lib.surfaceAlt,
							borderRadius: lib.radius.md,
							padding: '14px 16px',
							marginTop: '4px'
						}
					},
					text({ fontSize: '24px', fontWeight: lib.headingWeight, fontFamily: moneyFont(lib), color: lib.text }, '{amount}'),
					el(
						'span',
						{
							style: {
								padding: '3px 10px',
								borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
								background: lib.palette.primary.soft,
								color: lib.palette.primary.onSoft,
								fontSize: lib.fontSize.xs,
								fontWeight: 700
							}
						},
						'{currency}'
					)
				),
				el(
					'button',
					{
						type: 'button',
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							gap: '8px',
							height: lib.control.md,
							marginTop: '4px',
							border: 'none',
							borderRadius: lib.radius.md,
							fontFamily: lib.font,
							fontWeight: lib.buttonWeight,
							fontSize: lib.fontSize.md,
							cursor: 'pointer',
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
							...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
						}
					},
					'Continue',
					icons.arrowRight(14, 'currentColor')
				)
			)
		});

		const creditCard = define({
			slug: `${lib.id}-banking-credit-card`,
			name: 'Credit Card',
			library: lib.id,
			category: 'finance',
			description: `Payment card visual in the ${lib.label} style — a flat tone-solid face with chip and contactless arcs, mono masked number, holder and expiry row, and a twin brand-dot pair.`,
			tags: ['banking', 'credit-card', 'finance', 'payment'],
			args: [
				stringArg('last4', '4821', { label: 'Last 4 digits', maxLength: 4 }),
				stringArg('holder', 'Alex Rivera', { label: 'Card holder', maxLength: 26 }),
				stringArg('expiry', '12/29', { label: 'Expiry', maxLength: 5 }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'space-between',
						boxSizing: 'border-box',
						width: '300px',
						height: '180px',
						padding: '20px',
						background: toneMap(lib, (palette) => palette.solid),
						color: toneMap(lib, (palette) => palette.onSolid),
						borderRadius: lib.id === 'antd' ? lib.radius.md : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.lg,
						boxShadow: lib.id === 'mui' || lib.id === 'untitled' || lib.id === 'reactflow' ? lib.shadow.lg : lib.shadow.md,
						fontFamily: lib.font
					}
				},
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
					el('div', {
						style: {
							width: '34px',
							height: '24px',
							borderRadius: '4px',
							background: toneMap(lib, (palette) => palette.onSolid),
							opacity: 0.35
						}
					}),
					contactless(20, 'currentColor')
				),
				text(
					{ fontFamily: lib.fontMono, fontSize: lib.fontSize.lg, fontWeight: 500, letterSpacing: '2px' },
					'•••• •••• •••• {last4}'
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' } },
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
						text(
							{ fontSize: lib.fontSize.xs, fontWeight: 500, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em' },
							'Card holder'
						),
						text({ fontSize: lib.fontSize.sm, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }, '{holder}')
					),
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
						text(
							{ fontSize: lib.fontSize.xs, fontWeight: 500, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em' },
							'Expires'
						),
						text({ fontSize: lib.fontSize.sm, fontWeight: 600 }, '{expiry}')
					),
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center' } },
						cardDot(lib, 0.9, false),
						cardDot(lib, 0.5, true)
					)
				)
			)
		});

		const spending = define({
			slug: `${lib.id}-banking-spending`,
			name: 'Spending Breakdown',
			library: lib.id,
			category: 'finance',
			description: `Spending breakdown in the ${lib.label} style — month caption with a large total above soft tone tracks whose solid fills chart each category share, amounts right-aligned per row.`,
			tags: ['banking', 'spending', 'finance', 'chart'],
			args: [
				stringArg('month', 'August', { label: 'Month', maxLength: 12 }),
				stringArg('total', '$1,842.60', { label: 'Total', maxLength: 14 }),
				stringArg('category', 'Groceries', { label: 'Top category', maxLength: 20 }),
				numberArg('percent', 62, { label: 'Top percent', min: 0, max: 100 })
			],
			render: el(
				'div',
				{ style: { ...panel(lib), gap: '14px' } },
				el(
					'div',
					{ style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
					text(caption(lib), '{month} spending'),
					text(
						{ fontSize: '24px', fontWeight: lib.headingWeight, lineHeight: 1.1, fontFamily: moneyFont(lib), color: lib.text },
						'{total}'
					)
				),
				spendBar(
					lib,
					'{category}',
					'{percent}%',
					'$684.20',
					lib.palette.primary,
					lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.accent : undefined
				),
				spendBar(lib, 'Transport', '38%', '$213.50', lib.palette.info),
				spendBar(lib, 'Dining', '52%', '$318.90', lib.palette.warning),
				spendBar(lib, 'Utilities', '24%', '$142.00', lib.palette.success)
			)
		});

		return [balance, transaction, transfer, creditCard, spending];
	}
};
