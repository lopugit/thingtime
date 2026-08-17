// Crypto-trading archetype — trading surfaces in five renditions: asset price
// card, candlestick mini-chart, portfolio allocation rows, token swap widget,
// and an order book. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-crypto-trading-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	merge,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Shared trading-card chrome: mui rides pure elevation, untitled wears its
// feather shadow, daisyui gets a chunkier border, antd keeps tight corners.
const card = (lib, extra = {}) => ({
	fontFamily: lib.font,
	color: lib.text,
	background: lib.surface,
	borderWidth: lib.id === 'daisyui' ? '2px' : '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.id === 'antd' ? lib.radius.md : lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.lg : lib.id === 'untitled' ? lib.shadow.md : lib.shadow.sm,
	padding: '14px',
	boxSizing: 'border-box',
	...extra
});

const caption = (lib, extra = {}) => ({ fontSize: lib.fontSize.xs, color: lib.muted, ...extra });

const upper = (lib) =>
	lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {};

// Mono coin glyph in a tinted circle. thingtime winks with its rainbow,
// reactflow flashes its pink accent tint, everyone else gets coin-orange.
const coinCircle = (lib, size, glyph, palette, fontSize) => {
	const tint =
		palette || (lib.id === 'reactflow' ? lib.palette.danger : lib.palette.warning);
	return el(
		'div',
		{
			style: {
				width: size,
				height: size,
				borderRadius: '999px',
				background: lib.id === 'thingtime' && !palette ? lib.rainbow : tint.soft,
				color: lib.id === 'thingtime' && !palette ? lib.palette.primary.onSolid : tint.onSoft,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				fontFamily: lib.fontMono,
				fontWeight: 700,
				fontSize,
				flexShrink: 0
			}
		},
		glyph
	);
};

// Fixed candle geometry (x, wick extent, body top/height) — an upward-drifting
// nine-candle tape with a fixed up/down pattern.
const CANDLES = [
	{ x: 6, up: true, wickTop: 20, wickBot: 58, bodyTop: 28, bodyH: 22 },
	{ x: 24, up: false, wickTop: 14, wickBot: 52, bodyTop: 20, bodyH: 20 },
	{ x: 42, up: true, wickTop: 30, wickBot: 66, bodyTop: 38, bodyH: 18 },
	{ x: 60, up: true, wickTop: 24, wickBot: 60, bodyTop: 30, bodyH: 22 },
	{ x: 78, up: false, wickTop: 10, wickBot: 46, bodyTop: 16, bodyH: 18 },
	{ x: 96, up: true, wickTop: 26, wickBot: 64, bodyTop: 34, bodyH: 20 },
	{ x: 114, up: false, wickTop: 18, wickBot: 50, bodyTop: 24, bodyH: 16 },
	{ x: 132, up: true, wickTop: 12, wickBot: 44, bodyTop: 18, bodyH: 18 },
	{ x: 150, up: true, wickTop: 8, wickBot: 40, bodyTop: 12, bodyH: 20 }
];

const candleSvg = (lib) =>
	el(
		'svg',
		{ width: 166, height: 74, viewBox: '0 0 166 74', fill: 'none', xmlns: SVG_NS },
		...CANDLES.flatMap((c) => {
			const color = c.up ? lib.palette.success.solid : lib.palette.danger.solid;
			return [
				el('line', { x1: c.x + 5, y1: c.wickTop, x2: c.x + 5, y2: c.wickBot, stroke: color, strokeWidth: 1.5 }),
				el('rect', { x: c.x, y: c.bodyTop, width: 10, height: c.bodyH, rx: 1, fill: color })
			];
		})
	);

// Two opposed vertical arrows for the swap pivot button.
const swapArrows = (lib) =>
	el(
		'svg',
		{
			width: 13,
			height: 13,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid,
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: SVG_NS
		},
		el('line', { x1: 8, y1: 4, x2: 8, y2: 20 }),
		el('polyline', { points: '4 16 8 20 12 16' }),
		el('line', { x1: 16, y1: 20, x2: 16, y2: 4 }),
		el('polyline', { points: '12 8 16 4 20 8' })
	);

// One order-book ladder row. The depth bar is a hard-stop gradient background:
// bids fill from the right ('to left'), asks from the left ('to right').
const bookRow = (lib, palette, direction, width, priceNode, sizeNode) =>
	el(
		'div',
		{
			style: {
				display: 'flex',
				justifyContent: 'space-between',
				padding: '3px 8px',
				borderRadius: lib.radius.xs,
				fontFamily: lib.fontMono,
				fontSize: lib.fontSize.xs,
				background: `linear-gradient(to ${direction}, ${palette.soft} ${width}, transparent ${width})`
			}
		},
		el('span', { style: { color: palette.onSoft, fontWeight: 600 } }, priceNode),
		el('span', { style: { color: lib.muted } }, sizeNode)
	);

const bookHeader = (lib) =>
	el(
		'div',
		{
			style: {
				display: 'flex',
				justifyContent: 'space-between',
				padding: '0 8px',
				fontSize: lib.fontSize.xs,
				color: lib.faint,
				fontWeight: 600,
				...upper(lib)
			}
		},
		el('span', {}, 'Price'),
		el('span', {}, 'Size')
	);

// One portfolio allocation row: coin glyph, symbol + holdings, value + a
// fixed-width weight bar on a soft track.
const assetRow = (lib, glyph, palette, symbolNode, holdingsNode, valueNode, barWidth, barColor) =>
	row(
		{ gap: '10px', justifyContent: 'space-between' },
		row(
			{ gap: '10px' },
			coinCircle(lib, '26px', glyph, palette, '12px'),
			stack(
				{ gap: '1px' },
				text({ fontSize: lib.fontSize.sm, fontWeight: 600 }, symbolNode),
				text(caption(lib), holdingsNode)
			)
		),
		stack(
			{ gap: '5px', alignItems: 'flex-end' },
			text({ fontSize: lib.fontSize.sm, fontWeight: 600, fontFamily: lib.fontMono }, valueNode),
			el(
				'div',
				{ style: { width: '64px', height: '4px', borderRadius: '999px', background: lib.borderSoft } },
				el('div', { style: { width: barWidth, height: '4px', borderRadius: '999px', background: barColor } })
			)
		)
	);

// From/To swap panel: token chip (glyph + symbol + chevron) beside the amount.
const swapPanel = (lib, label, glyph, glyphPalette, tokenNode, amountNode, amountIsMuted) =>
	el(
		'div',
		{
			style: {
				background: lib.surfaceAlt,
				borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
				padding: '10px 12px',
				display: 'flex',
				flexDirection: 'column',
				gap: '8px'
			}
		},
		text(caption(lib, { fontWeight: 600, ...upper(lib) }), label),
		row(
			{ justifyContent: 'space-between', gap: '10px' },
			row(
				{
					gap: '6px',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
					padding: '3px 8px',
					fontWeight: 600,
					fontSize: lib.fontSize.sm
				},
				coinCircle(lib, '18px', glyph, glyphPalette, '10px'),
				tokenNode,
				icons.chevronDown(12, lib.muted)
			),
			text(
				{
					fontFamily: lib.fontMono,
					fontSize: lib.fontSize.lg,
					fontWeight: 600,
					color: amountIsMuted ? lib.muted : lib.text
				},
				amountNode
			)
		)
	);

const frameChip = (lib, frame) =>
	el(
		'span',
		{
			style: merge(
				{
					padding: '2px 10px',
					fontSize: lib.fontSize.xs,
					fontWeight: 600,
					cursor: 'pointer',
					borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
					...upper(lib)
				},
				ifEq(
					'timeframe',
					frame,
					{
						background: lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid,
						color: lib.palette.primary.onSolid
					},
					{ background: lib.surfaceAlt, color: lib.muted }
				)
			)
		},
		frame
	);

export const archetype = {
	id: 'crypto-trading',
	category: 'finance',
	variants: ['price', 'candles', 'portfolio', 'swap', 'order-book'],
	build(lib) {
		const price = define({
			slug: `${lib.id}-crypto-trading-price`,
			name: 'Asset Price Card',
			library: lib.id,
			category: 'finance',
			description: `Crypto asset price card in the ${lib.label} style — coin glyph circle, symbol and name, big mono price, a 24h change chip that flips success/danger with direction, and a matching sparkline.`,
			tags: ['crypto', 'price', 'ticker', 'sparkline'],
			args: [
				stringArg('symbol', 'BTC', { label: 'Symbol', maxLength: 8 }),
				stringArg('name', 'Bitcoin', { label: 'Name', maxLength: 20 }),
				stringArg('price', '$67,412.80', { label: 'Price', maxLength: 16 }),
				stringArg('change', '2.4%', { label: '24h change', maxLength: 10 }),
				booleanArg('up', true, { label: 'Trending up' })
			],
			render: stack(
				{ ...card(lib), width: '250px', gap: '10px' },
				row(
					{ gap: '10px' },
					coinCircle(lib, '34px', '₿', null, '15px'),
					stack(
						{ gap: '1px' },
						text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{symbol}'),
						text(caption(lib), '{name}')
					)
				),
				row(
					{ justifyContent: 'space-between', alignItems: 'flex-end', gap: '8px' },
					text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight }, '{price}'),
					el(
						'span',
						{
							style: merge(
								{
									display: 'inline-flex',
									alignItems: 'center',
									gap: '4px',
									padding: '2px 8px',
									borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
									fontSize: lib.fontSize.xs,
									fontWeight: 600,
									fontFamily: lib.fontMono
								},
								iff(
									'up',
									{ background: lib.palette.success.soft, color: lib.palette.success.onSoft },
									{ background: lib.palette.danger.soft, color: lib.palette.danger.onSoft }
								)
							)
						},
						iff('up', icons.arrowUp(10, 'currentColor'), icons.arrowDown(10, 'currentColor')),
						'{change}'
					)
				),
				el(
					'svg',
					{ width: 220, height: 36, viewBox: '0 0 220 36', fill: 'none', xmlns: SVG_NS },
					el('polyline', {
						points: '4 28 30 20 56 24 82 12 108 16 134 8 160 14 186 5 216 9',
						stroke: iff('up', lib.palette.success.solid, lib.palette.danger.solid),
						strokeWidth: 2,
						strokeLinecap: 'round',
						strokeLinejoin: 'round'
					})
				)
			)
		});

		const candles = define({
			slug: `${lib.id}-crypto-trading-candles`,
			name: 'Candlestick Chart',
			library: lib.id,
			category: 'finance',
			description: `Candlestick mini-chart in the ${lib.label} style — nine svg candles with wicks in a fixed up/down pattern, high/low price captions on the right, and 1H/1D/1W timeframe chips${lib.id === 'reactflow' ? ' over a dotted node-canvas' : ''}.`,
			tags: ['crypto', 'candlestick', 'chart', 'trading'],
			args: [
				stringArg('symbol', 'BTC/USD', { label: 'Pair', maxLength: 12 }),
				enumArg('timeframe', ['1H', '1D', '1W'], '1D', { label: 'Timeframe' }),
				stringArg('high', '68.2k', { label: 'High', maxLength: 10 }),
				stringArg('low', '65.9k', { label: 'Low', maxLength: 10 })
			],
			render: stack(
				{ ...card(lib), width: '262px', gap: '10px' },
				row(
					{ justifyContent: 'space-between', gap: '8px' },
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight }, '{symbol}'),
					row({ gap: '4px' }, frameChip(lib, '1H'), frameChip(lib, '1D'), frameChip(lib, '1W'))
				),
				row(
					{ gap: '8px', alignItems: 'stretch' },
					el(
						'div',
						{
							style: {
								borderRadius: lib.radius.sm,
								padding: '4px',
								flexShrink: 0,
								...(lib.id === 'reactflow'
									? {
											backgroundImage: `radial-gradient(${lib.dot} 1px, transparent 1px)`,
											backgroundSize: '12px 12px'
										}
									: { background: lib.surfaceAlt })
							}
						},
						candleSvg(lib)
					),
					stack(
						{ justifyContent: 'space-between', padding: '4px 0' },
						text(caption(lib, { fontFamily: lib.fontMono }), '{high}'),
						text(caption(lib, { fontFamily: lib.fontMono }), '{low}')
					)
				)
			)
		});

		const portfolio = define({
			slug: `${lib.id}-crypto-trading-portfolio`,
			name: 'Portfolio Allocation',
			library: lib.id,
			category: 'finance',
			description: `Crypto portfolio allocation card in the ${lib.label} style — total value header over three asset rows, each with a coin glyph, holdings caption, mono value, and a fixed-width weight bar${lib.id === 'thingtime' ? ' (the top bar wears the house rainbow)' : ''}.`,
			tags: ['crypto', 'portfolio', 'allocation', 'holdings'],
			args: [
				stringArg('total', '$24,861.40', { label: 'Total value', maxLength: 16 }),
				stringArg('symbol', 'BTC', { label: 'Top asset', maxLength: 8 }),
				stringArg('holdings', '0.184 BTC', { label: 'Top holdings', maxLength: 16 }),
				stringArg('value', '$12,402', { label: 'Top value', maxLength: 12 })
			],
			render: stack(
				{ ...card(lib), width: '260px', gap: '12px' },
				stack(
					{ gap: '2px' },
					text(caption(lib, { fontWeight: 600, ...upper(lib) }), 'Portfolio'),
					text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight }, '{total}')
				),
				el('div', { style: { height: '1px', background: lib.borderSoft } }),
				assetRow(
					lib,
					'₿',
					null,
					'{symbol}',
					'{holdings}',
					'{value}',
					'58%',
					lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid
				),
				assetRow(lib, 'Ξ', lib.palette.info, 'ETH', '3.6 ETH', '$8,102', '33%', lib.palette.info.solid),
				assetRow(lib, '◎', lib.palette.success, 'SOL', '96 SOL', '$4,357', '18%', lib.palette.success.solid)
			)
		});

		const swap = define({
			slug: `${lib.id}-crypto-trading-swap`,
			name: 'Token Swap',
			library: lib.id,
			category: 'finance',
			description: `Token swap widget in the ${lib.label} style — From/To panels with token chips and mono amounts, a swap-arrows pivot button between them, a rate caption, and a full-width tone Swap button.`,
			tags: ['crypto', 'swap', 'exchange', 'defi'],
			args: [
				stringArg('fromToken', 'ETH', { label: 'From token', maxLength: 8 }),
				stringArg('toToken', 'USDC', { label: 'To token', maxLength: 8 }),
				stringArg('amount', '1.50', { label: 'Amount', maxLength: 12 }),
				stringArg('rate', '1 ETH ≈ 3,412 USDC', { label: 'Rate', maxLength: 28 }),
				toneArg()
			],
			render: stack(
				{ ...card(lib), width: '264px', gap: '10px' },
				swapPanel(lib, 'From', 'Ξ', lib.palette.info, '{fromToken}', '{amount}', false),
				el(
					'div',
					{
						style: {
							width: '30px',
							height: '30px',
							borderRadius: '999px',
							background: lib.surface,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							alignSelf: 'center',
							marginTop: '-19px',
							marginBottom: '-19px',
							position: 'relative',
							zIndex: 1,
							boxShadow: lib.id === 'untitled' ? lib.shadow.md : lib.shadow.sm
						}
					},
					swapArrows(lib)
				),
				swapPanel(lib, 'To', '$', lib.palette.success, '{toToken}', '≈ 5,118.42', true),
				row(
					{ justifyContent: 'space-between', gap: '8px' },
					text(caption(lib), 'Rate'),
					text(caption(lib, { fontFamily: lib.fontMono, color: lib.text }), '{rate}')
				),
				el(
					'button',
					{
						type: 'button',
						style: merge(
							{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								width: '100%',
								height: lib.control.md,
								border: 'none',
								borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
								fontFamily: lib.font,
								fontWeight: lib.buttonWeight,
								fontSize: lib.fontSize.md,
								cursor: 'pointer',
								...upper(lib)
							},
							{
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								boxShadow: lib.id === 'mui' ? lib.shadow.md : 'none'
							}
						)
					},
					'Swap'
				)
			)
		});

		const orderBook = define({
			slug: `${lib.id}-crypto-trading-order-book`,
			name: 'Order Book',
			library: lib.id,
			category: 'finance',
			description: `Order book in the ${lib.label} style — success bids and danger asks side by side, four ladder rows each with decreasing depth-bar backgrounds, Price/Size headers, and the live spread between the columns.`,
			tags: ['crypto', 'order-book', 'trading', 'depth'],
			args: [
				stringArg('pair', 'BTC/USD', { label: 'Pair', maxLength: 12 }),
				stringArg('bid', '67,405.2', { label: 'Best bid', maxLength: 12 }),
				stringArg('ask', '67,411.8', { label: 'Best ask', maxLength: 12 }),
				stringArg('spread', '6.6', { label: 'Spread', maxLength: 8 })
			],
			render: stack(
				{ ...card(lib), width: '312px', gap: '10px' },
				row(
					{ gap: '6px' },
					el('span', {
						style: { width: '6px', height: '6px', borderRadius: '999px', background: lib.palette.success.solid }
					}),
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight }, '{pair}')
				),
				row(
					{ gap: '4px', alignItems: 'stretch' },
					stack(
						{ gap: '2px', flex: 1 },
						bookHeader(lib),
						bookRow(lib, lib.palette.success, 'left', '88%', '{bid}', '0.84'),
						bookRow(lib, lib.palette.success, 'left', '64%', '67,398.5', '1.20'),
						bookRow(lib, lib.palette.success, 'left', '42%', '67,391.0', '0.42'),
						bookRow(lib, lib.palette.success, 'left', '22%', '67,384.2', '2.05')
					),
					stack(
						{ gap: '2px', alignItems: 'center', justifyContent: 'center', padding: '0 6px' },
						text(caption(lib, upper(lib)), 'Spread'),
						text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, fontWeight: 700 }, '{spread}')
					),
					stack(
						{ gap: '2px', flex: 1 },
						bookHeader(lib),
						bookRow(lib, lib.palette.danger, 'right', '88%', '{ask}', '0.62'),
						bookRow(lib, lib.palette.danger, 'right', '64%', '67,419.5', '0.95'),
						bookRow(lib, lib.palette.danger, 'right', '42%', '67,426.1', '1.48'),
						bookRow(lib, lib.palette.danger, 'right', '22%', '67,433.8', '0.71')
					)
				)
			)
		});

		return [price, candles, portfolio, swap, orderBook];
	}
};
