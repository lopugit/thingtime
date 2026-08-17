// Commerce archetype — shopping surfaces in five renditions: product tile,
// cart line item, order summary, promo-code row, and saved payment method.
// Follows the button.mjs exemplar: exactly 5 variants, `build(lib)` returns
// exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-commerce-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	map,
	numberArg,
	repeat,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// antd tags sit on tight square-ish corners; everyone else wears the pill.
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.radius.pill);

const buttonBase = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '6px',
	border: 'none',
	borderRadius: lib.radius.md,
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

// Flex-centered placeholder square standing in for a product photo.
const imagePlaceholder = (lib, size, iconSize, radius) =>
	el(
		'div',
		{
			style: {
				width: size,
				height: size,
				borderRadius: radius,
				background: lib.surfaceAlt,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				flexShrink: 0
			}
		},
		icons.image(iconSize, lib.faint)
	);

export const archetype = {
	id: 'commerce',
	category: 'commerce',
	variants: ['product-card', 'cart-item', 'summary', 'promo', 'payment'],
	build(lib) {
		const productCard = define({
			slug: `${lib.id}-commerce-product-card`,
			name: 'Product Card',
			library: lib.id,
			category: 'commerce',
			description: `Product tile in the ${lib.label} style — image placeholder with an optional sale pill, star rating with review count, price line and an add-to-cart action on library-native corners.`,
			tags: ['commerce', 'product', 'card', 'shop'],
			args: [
				stringArg('name', 'Aurora Headphones', { label: 'Product name', maxLength: 40 }),
				stringArg('price', '$129', { label: 'Price', maxLength: 12 }),
				booleanArg('onSale', true, { label: 'On sale' }),
				numberArg('rating', 4, { label: 'Stars (0-5)' }),
				stringArg('reviews', '128', { label: 'Review count', maxLength: 8 })
			],
			render: stack(
				{
					width: '240px',
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.lg,
					boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
					fontFamily: lib.font,
					overflow: 'hidden'
				},
				lib.id === 'thingtime' ? el('div', { style: { height: '3px', background: lib.rainbow } }) : null,
				el(
					'div',
					{
						style: {
							position: 'relative',
							height: '132px',
							background: lib.surfaceAlt,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center'
						}
					},
					icons.image(30, lib.faint),
					iff(
						'onSale',
						el(
							'span',
							{
								style: {
									position: 'absolute',
									top: '10px',
									left: '10px',
									padding: '2px 10px',
									borderRadius: chipRadius(lib),
									background: lib.palette.danger.solid,
									color: lib.palette.danger.onSolid,
									fontSize: lib.fontSize.xs,
									fontWeight: 700
								}
							},
							'Sale'
						)
					)
				),
				stack(
					{ padding: '14px', gap: '8px' },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{name}'),
					row(
						{ gap: '6px' },
						row({ gap: '2px' }, repeat('rating', 5, icons.star(14, lib.palette.warning.solid, true))),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, '({reviews})')
					),
					row(
						{ justifyContent: 'space-between', marginTop: '4px' },
						text({ fontSize: lib.fontSize.lg, fontWeight: 700, color: lib.text }, '{price}'),
						el(
							'button',
							{
								type: 'button',
								style: {
									...buttonBase(lib),
									height: lib.control.sm,
									padding: '0 12px',
									fontSize: lib.fontSize.xs,
									background: lib.palette.primary.solid,
									color: lib.palette.primary.onSolid
								}
							},
							icons.plus(13, 'currentColor'),
							'Add'
						)
					)
				)
			)
		});

		const cartItem = define({
			slug: `${lib.id}-commerce-cart-item`,
			name: 'Cart Item',
			library: lib.id,
			category: 'commerce',
			description: `Cart line item in the ${lib.label} style — thumbnail square, product name with variant caption, a bordered quantity stepper, monospace line price and a quiet remove icon.`,
			tags: ['commerce', 'cart', 'stepper', 'line-item'],
			args: [
				stringArg('name', 'Aurora Headphones', { label: 'Product name', maxLength: 40 }),
				stringArg('variant', 'Midnight / M', { label: 'Variant', maxLength: 30 }),
				numberArg('qty', 2, { label: 'Quantity' }),
				stringArg('price', '$258.00', { label: 'Line price', maxLength: 12 })
			],
			render: row(
				{
					gap: '12px',
					width: '360px',
					padding: '12px',
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.md,
					boxShadow: lib.shadow.sm,
					fontFamily: lib.font,
					boxSizing: 'border-box'
				},
				imagePlaceholder(lib, '48px', 20, lib.radius.sm),
				stack(
					{ gap: '2px', flex: '1 1 auto', minWidth: 0 },
					text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '{name}'),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{variant}')
				),
				row(
					{
						border: `1px solid ${lib.border}`,
						borderRadius: lib.radius.sm,
						overflow: 'hidden',
						flexShrink: 0
					},
					el(
						'span',
						{
							style: {
								width: '24px',
								height: '24px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								background: lib.surfaceAlt,
								color: lib.muted,
								fontSize: lib.fontSize.sm,
								cursor: 'pointer'
							}
						},
						'−'
					),
					el(
						'span',
						{
							style: {
								minWidth: '28px',
								height: '24px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontSize: lib.fontSize.sm,
								fontWeight: 600,
								color: lib.text
							}
						},
						'{qty}'
					),
					el(
						'span',
						{
							style: {
								width: '24px',
								height: '24px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								background: lib.surfaceAlt,
								color: lib.muted,
								fontSize: lib.fontSize.sm,
								cursor: 'pointer'
							}
						},
						'+'
					)
				),
				text({ fontSize: lib.fontSize.sm, fontWeight: 700, color: lib.text, fontFamily: lib.fontMono }, '{price}'),
				icons.trash(16, lib.faint)
			)
		});

		const lineRow = (label, token) =>
			row(
				{ justifyContent: 'space-between' },
				text({ fontSize: lib.fontSize.sm, color: lib.muted }, label),
				text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text }, token)
			);

		const summary = define({
			slug: `${lib.id}-commerce-summary`,
			name: 'Order Summary',
			library: lib.id,
			category: 'commerce',
			description: `Order summary card in the ${lib.label} style — subtotal, shipping and tax rows over a hairline divider, a bold total, a tone-colored checkout button and a secure-checkout caption.`,
			tags: ['commerce', 'checkout', 'summary', 'order'],
			args: [
				stringArg('subtotal', '$236.00', { label: 'Subtotal', maxLength: 12 }),
				stringArg('shipping', '$12.00', { label: 'Shipping', maxLength: 12 }),
				stringArg('tax', '$21.40', { label: 'Tax', maxLength: 12 }),
				stringArg('total', '$269.40', { label: 'Total', maxLength: 12 }),
				toneArg()
			],
			render: stack(
				{
					width: '280px',
					padding: '16px',
					gap: '10px',
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.lg,
					boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
					fontFamily: lib.font,
					boxSizing: 'border-box'
				},
				text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, 'Order summary'),
				lineRow('Subtotal', '{subtotal}'),
				lineRow('Shipping', '{shipping}'),
				lineRow('Tax', '{tax}'),
				el('div', { style: { height: '1px', background: lib.borderSoft } }),
				row(
					{ justifyContent: 'space-between' },
					text({ fontSize: lib.fontSize.md, fontWeight: 700, color: lib.text }, 'Total'),
					text({ fontSize: lib.fontSize.lg, fontWeight: 700, color: lib.text }, '{total}')
				),
				el(
					'button',
					{
						type: 'button',
						style: {
							...buttonBase(lib),
							height: lib.control.md,
							fontSize: lib.fontSize.md,
							marginTop: '4px',
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							boxShadow: lib.shadow.sm
						}
					},
					'Checkout'
				),
				row(
					{ gap: '6px', justifyContent: 'center' },
					el(
						'span',
						{
							style: {
								width: '16px',
								height: '16px',
								borderRadius: lib.radius.pill,
								background: lib.palette.success.soft,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0
							}
						},
						icons.check(10, lib.palette.success.onSoft)
					),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Secure checkout')
				)
			)
		});

		const promo = define({
			slug: `${lib.id}-commerce-promo`,
			name: 'Promo Code Row',
			library: lib.id,
			category: 'commerce',
			description: `Promo code row in the ${lib.label} style — dashed voucher field showing the code as an applied chip, an apply button, and a success caption that appears once the code is accepted.`,
			tags: ['commerce', 'promo', 'coupon', 'discount'],
			args: [
				stringArg('code', 'SAVE20', { label: 'Code', maxLength: 16 }),
				booleanArg('applied', true, { label: 'Applied' }),
				stringArg('discount', '20% off', { label: 'Discount', maxLength: 16 })
			],
			render: stack(
				{ gap: '6px', width: '320px', fontFamily: lib.font },
				row(
					{ gap: '8px' },
					row(
						{
							flex: '1 1 auto',
							height: lib.control.md,
							padding: '0 10px',
							border: `1px dashed ${lib.border}`,
							borderRadius: lib.radius.md,
							background: lib.surfaceAlt,
							boxSizing: 'border-box'
						},
						iff(
							'applied',
							el(
								'span',
								{
									style: {
										display: 'inline-flex',
										alignItems: 'center',
										gap: '6px',
										padding: '2px 10px',
										borderRadius: chipRadius(lib),
										background: lib.palette.success.soft,
										color: lib.palette.success.onSoft,
										fontSize: lib.fontSize.xs,
										fontWeight: 700,
										fontFamily: lib.fontMono
									}
								},
								icons.check(11, 'currentColor'),
								'{code}'
							),
							el('span', { style: { fontSize: lib.fontSize.sm, color: lib.faint, fontFamily: lib.fontMono } }, '{code}')
						)
					),
					el(
						'button',
						{
							type: 'button',
							style: {
								...buttonBase(lib),
								height: lib.control.md,
								padding: '0 16px',
								fontSize: lib.fontSize.sm,
								background: lib.palette.primary.solid,
								color: lib.palette.primary.onSolid,
								flexShrink: 0
							}
						},
						'Apply'
					)
				),
				iff(
					'applied',
					row(
						{ gap: '5px' },
						icons.check(12, lib.palette.success.solid),
						text({ fontSize: lib.fontSize.xs, color: lib.palette.success.onSoft }, '{discount} applied to your order')
					)
				)
			)
		});

		const payment = define({
			slug: `${lib.id}-commerce-payment`,
			name: 'Payment Method',
			library: lib.id,
			category: 'commerce',
			description: `Saved payment method row in the ${lib.label} style — tinted card-brand chip, masked card number, expiry caption, selectable radio ring and an optional default badge.`,
			tags: ['commerce', 'payment', 'card', 'saved-method'],
			args: [
				enumArg('brand', ['visa', 'mastercard', 'amex'], 'visa', { label: 'Brand' }),
				stringArg('last4', '4242', { label: 'Last 4', maxLength: 4 }),
				stringArg('expiry', '12/27', { label: 'Expiry', maxLength: 7 }),
				booleanArg('selected', true, { label: 'Selected' }),
				booleanArg('isDefault', true, { label: 'Default badge' })
			],
			render: row(
				{
					gap: '12px',
					width: '340px',
					padding: '12px 14px',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: iff('selected', lib.palette.primary.solid, lib.border),
					borderRadius: lib.radius.md,
					boxShadow: iff('selected', lib.focusRing, lib.shadow.sm),
					fontFamily: lib.font,
					boxSizing: 'border-box'
				},
				el(
					'span',
					{
						style: {
							width: '16px',
							height: '16px',
							borderRadius: lib.radius.pill,
							borderWidth: '2px',
							borderStyle: 'solid',
							borderColor: iff('selected', lib.palette.primary.solid, lib.faint),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							boxSizing: 'border-box',
							flexShrink: 0
						}
					},
					iff(
						'selected',
						el('span', {
							style: { width: '7px', height: '7px', borderRadius: lib.radius.pill, background: lib.palette.primary.solid }
						})
					)
				),
				el(
					'span',
					{
						style: {
							padding: '3px 8px',
							borderRadius: lib.radius.sm,
							background: map('brand', {
								visa: lib.palette.info.soft,
								mastercard: lib.palette.danger.soft,
								amex: lib.palette.success.soft
							}),
							color: map('brand', {
								visa: lib.palette.info.onSoft,
								mastercard: lib.palette.danger.onSoft,
								amex: lib.palette.success.onSoft
							}),
							fontFamily: lib.fontMono,
							fontSize: lib.fontSize.xs,
							fontWeight: 700,
							letterSpacing: '0.04em',
							flexShrink: 0
						}
					},
					map('brand', { visa: 'VISA', mastercard: 'MC', amex: 'AMEX' })
				),
				stack(
					{ gap: '2px', flex: '1 1 auto', minWidth: 0 },
					row(
						{ gap: '6px' },
						text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '•••• {last4}'),
						iff(
							'isDefault',
							el(
								'span',
								{
									style: {
										padding: '1px 8px',
										borderRadius: chipRadius(lib),
										background: lib.palette.neutral.soft,
										color: lib.palette.neutral.onSoft,
										fontSize: lib.fontSize.xs,
										fontWeight: 600
									}
								},
								'Default'
							)
						)
					),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Expires {expiry}')
				)
			)
		});

		return [productCard, cartItem, summary, promo, payment];
	}
};
