// Charity & community archetype — giving and community surfaces in five
// renditions: donation picker, fundraiser progress card, volunteer shift
// card, impact stats band, and sponsorship tier card. Follows the button.mjs
// exemplar: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-charity-community-<variant>`.

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

// Sanctioned metal fills for the sponsorship tiers (named in the brief).
const METALS = { bronze: '#cd7f32', silver: '#c0c0c0', gold: '#d4af37' };

// reactflow leads with its hot-pink accent; everyone else uses their primary.
const accentOf = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid);
const accentOnOf = (lib) => (lib.id === 'reactflow' ? lib.palette.danger.onSolid : lib.palette.primary.onSolid);

// thingtime keeps its house rainbow; other libraries get a palette-derived band.
const rainbowOf = (lib) =>
	lib.id === 'thingtime'
		? lib.rainbow
		: lib.id === 'reactflow'
			? `linear-gradient(90deg, ${lib.accent}, ${lib.palette.info.solid})`
			: `linear-gradient(90deg, ${lib.palette.danger.solid}, ${lib.palette.warning.solid}, ${lib.palette.success.solid}, ${lib.palette.info.solid}, ${lib.palette.primary.solid})`;

const card = (lib, extra = {}) => ({
	display: 'flex',
	flexDirection: 'column',
	gap: '14px',
	width: '300px',
	boxSizing: 'border-box',
	padding: '18px',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft,
	borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
	boxShadow: lib.id === 'mui' || lib.id === 'untitled' ? lib.shadow.md : lib.shadow.sm,
	fontFamily: lib.font,
	color: lib.text,
	...extra
});

const heading = (lib, value) =>
	text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, lineHeight: 1.3, color: lib.text }, value);
const caption = (lib, value, extra = {}) =>
	text({ fontSize: lib.fontSize.xs, color: lib.muted, lineHeight: 1.4, ...extra }, value);
const bigNumber = (lib, value, size = 'xl') =>
	text(
		{ fontSize: lib.fontSize[size], fontWeight: lib.headingWeight, lineHeight: 1.2, color: lib.id === 'thingtime' ? lib.ink : lib.text },
		value
	);

const ctaBase = (lib) => ({
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '8px',
	height: lib.control.md,
	padding: '0 16px',
	borderRadius: lib.radius.md,
	border: 'none',
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	fontSize: lib.fontSize.sm,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

const ghostButton = (lib, label) =>
	el('button', { type: 'button', style: { ...ctaBase(lib), padding: '0 10px', background: 'transparent', color: accentOf(lib) } }, label);

// check-in-circle glyph for benefit checklists.
const checkCircle = (lib, size) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: lib.palette.success.solid,
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		el('circle', { cx: 12, cy: 12, r: 10 }),
		el('polyline', { points: '16 9 10.8 14.5 8 12' })
	);

export const archetype = {
	id: 'charity-community',
	category: 'community',
	variants: ['donate', 'fundraiser', 'volunteer', 'impact', 'sponsor'],
	build(lib) {
		const amountChip = (value, label) =>
			el(
				'div',
				{
					style: merge(
						{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							flex: '1 1 0',
							height: lib.control.sm,
							borderRadius: lib.id === 'daisyui' ? lib.radius.pill : lib.radius.sm,
							fontSize: lib.fontSize.sm,
							fontWeight: 600,
							borderWidth: '1px',
							borderStyle: 'solid',
							cursor: 'pointer'
						},
						ifEq(
							'amount',
							value,
							{ background: accentOf(lib), color: accentOnOf(lib), borderColor: accentOf(lib) },
							{ background: lib.surface, color: lib.text, borderColor: lib.border }
						)
					)
				},
				label
			);

		const donate = define({
			slug: `${lib.id}-charity-community-donate`,
			name: 'Donation Picker',
			library: lib.id,
			category: 'community',
			description: `Donation amount picker in the ${lib.label} style — cause header, preset amount chips with a solid selected state, a monthly-giving toggle, and a tone donate button over a secure-checkout caption.`,
			tags: ['charity', 'donation', 'giving', 'picker'],
			args: [
				stringArg('cause', 'Clean water for the delta', { label: 'Cause', maxLength: 60 }),
				enumArg('amount', ['10', '25', '50', 'custom'], '25', { label: 'Amount' }),
				booleanArg('monthly', true, { label: 'Monthly' }),
				toneArg()
			],
			render: el(
				'div',
				{ style: card(lib) },
				stack({ gap: '2px' }, heading(lib, '{cause}'), caption(lib, 'via Open Hands Collective')),
				row({ gap: '8px' }, amountChip('10', '$10'), amountChip('25', '$25'), amountChip('50', '$50'), amountChip('custom', 'Custom')),
				row(
					{
						justifyContent: 'space-between',
						gap: '10px',
						padding: '9px 12px',
						boxSizing: 'border-box',
						background: lib.surfaceAlt,
						borderRadius: lib.radius.sm
					},
					row(
						{ gap: '8px' },
						icons.heart(14, lib.palette.danger.solid, true),
						text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text }, 'Make it monthly')
					),
					el(
						'div',
						{
							style: {
								width: '36px',
								height: '20px',
								borderRadius: lib.radius.pill,
								padding: '2px',
								boxSizing: 'border-box',
								display: 'flex',
								alignItems: 'center',
								flexShrink: 0,
								background: iff('monthly', lib.palette.success.solid, lib.faint),
								justifyContent: iff('monthly', 'flex-end', 'flex-start')
							}
						},
						el('div', { style: { width: '16px', height: '16px', borderRadius: lib.radius.pill, background: lib.surface, boxShadow: lib.shadow.sm } })
					)
				),
				el(
					'button',
					{
						type: 'button',
						style: merge(ctaBase(lib), {
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
						})
					},
					map('amount', { 10: 'Donate $10', 25: 'Donate $25', 50: 'Donate $50', custom: 'Donate custom amount' }, 'Donate')
				),
				caption(lib, 'Secure checkout · every dollar reaches the cause', { textAlign: 'center' })
			)
		});

		const avatarRing = (overlap) => ({
			borderWidth: '2px',
			borderStyle: 'solid',
			borderColor: lib.surface,
			...(overlap ? { marginLeft: '-8px' } : {})
		});
		const stat = (value, label) =>
			stack(
				{ gap: '1px', flex: '1 1 0' },
				text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.id === 'thingtime' ? lib.ink : lib.text }, value),
				caption(lib, label)
			);

		const fundraiser = define({
			slug: `${lib.id}-charity-community-fundraiser`,
			name: 'Fundraiser Progress Card',
			library: lib.id,
			category: 'community',
			description: `Fundraiser progress card in the ${lib.label} style — big raised amount against the goal, a chunky percent-driven progress bar${lib.id === 'thingtime' ? ' filled with the house rainbow' : ''}, donor and days-left stats, and a recent-donor avatar stack beside a Share ghost.`,
			tags: ['charity', 'fundraiser', 'progress', 'goal'],
			args: [
				stringArg('title', 'Rebuild the community hall', { label: 'Title', maxLength: 60 }),
				stringArg('raised', '$8,240', { label: 'Raised', maxLength: 12 }),
				stringArg('goal', '$12,000', { label: 'Goal', maxLength: 12 }),
				numberArg('percent', 68, { label: 'Percent funded', min: 0, max: 100 }),
				stringArg('donors', '142', { label: 'Donors', maxLength: 8 }),
				stringArg('days', '9', { label: 'Days left', maxLength: 8 })
			],
			render: el(
				'div',
				{ style: card(lib) },
				heading(lib, '{title}'),
				row({ gap: '8px', alignItems: 'baseline' }, bigNumber(lib, '{raised}'), caption(lib, 'of {goal} goal', { fontSize: lib.fontSize.sm })),
				el(
					'div',
					{
						style: {
							height: lib.id === 'daisyui' ? '14px' : '10px',
							background: lib.id === 'reactflow' ? lib.surfaceAlt : lib.borderSoft,
							borderRadius: lib.radius.pill,
							overflow: 'hidden'
						}
					},
					el('div', {
						style: {
							width: '{percent}%',
							height: '100%',
							borderRadius: lib.radius.pill,
							background: lib.id === 'thingtime' ? lib.rainbow : accentOf(lib)
						}
					})
				),
				row({ gap: '12px' }, stat('{donors}', 'donors'), stat('{percent}%', 'funded'), stat('{days}', 'days left')),
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					row(
						{},
						avatarCircle('26px', lib.palette.primary.soft, lib.palette.primary.onSoft, 'KL', lib.fontSize.xs, avatarRing(false)),
						avatarCircle('26px', lib.palette.success.soft, lib.palette.success.onSoft, 'MB', lib.fontSize.xs, avatarRing(true)),
						avatarCircle('26px', lib.palette.warning.soft, lib.palette.warning.onSoft, 'TW', lib.fontSize.xs, avatarRing(true)),
						avatarCircle('26px', lib.surfaceAlt, lib.muted, '+9', lib.fontSize.xs, avatarRing(true))
					),
					ghostButton(lib, 'Share')
				)
			)
		});

		const infoChip = (icon, label) =>
			el(
				'div',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						gap: '6px',
						padding: '4px 10px',
						background: lib.surface,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.border,
						borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
						fontSize: lib.fontSize.xs,
						fontWeight: 500,
						color: lib.text
					}
				},
				icon,
				label
			);
		const reqChip = (label) =>
			el(
				'span',
				{
					style: {
						padding: '3px 9px',
						background: lib.surfaceAlt,
						color: lib.muted,
						borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
						fontSize: lib.fontSize.xs,
						fontWeight: 500
					}
				},
				label
			);

		const volunteer = define({
			slug: `${lib.id}-charity-community-volunteer`,
			name: 'Volunteer Shift Card',
			library: lib.id,
			category: 'community',
			description: `Volunteer shift card in the ${lib.label} style — role and organisation header, date and duration chips, a soft warning pill counting the spots left, requirement chips, and a tone sign-up button with a Details ghost.`,
			tags: ['charity', 'volunteer', 'shift', 'community'],
			args: [
				stringArg('role', 'Meal service volunteer', { label: 'Role', maxLength: 60 }),
				stringArg('org', 'Riverside Kitchen', { label: 'Organisation', maxLength: 40 }),
				stringArg('when', 'Sat 21 Jun · 9:00am', { label: 'When', maxLength: 30 }),
				stringArg('spots', '3', { label: 'Spots left', maxLength: 6 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: card(lib) },
				stack({ gap: '2px' }, heading(lib, '{role}'), caption(lib, '{org} · 2.1 km away')),
				row({ gap: '8px', flexWrap: 'wrap' }, infoChip(icons.calendar(13, lib.muted), '{when}'), infoChip(icons.clock(13, lib.muted), '3 hrs')),
				row(
					{ gap: '6px', padding: '5px 10px', background: lib.palette.warning.soft, borderRadius: lib.radius.sm, alignSelf: 'flex-start' },
					icons.alert(13, lib.palette.warning.onSoft),
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.palette.warning.onSoft }, '{spots} spots left')
				),
				row({ gap: '6px', flexWrap: 'wrap' }, reqChip('18+'), reqChip('Outdoors'), reqChip('No experience needed')),
				row(
					{ gap: '8px' },
					el(
						'button',
						{
							type: 'button',
							style: merge(
								{ ...ctaBase(lib), flex: '1 1 auto' },
								{
									background: toneMap(lib, (palette) => palette.solid),
									color: toneMap(lib, (palette) => palette.onSolid),
									boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
								}
							)
						},
						'Sign up'
					),
					ghostButton(lib, 'Details')
				)
			)
		});

		const tile = (icon, bg, value, label) =>
			stack(
				{ gap: '6px', flex: '1 1 0' },
				el(
					'div',
					{
						style: {
							width: '30px',
							height: '30px',
							borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
							background: bg,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center'
						}
					},
					icon
				),
				bigNumber(lib, value, 'lg'),
				caption(lib, label)
			);

		const impact = define({
			slug: `${lib.id}-charity-community-impact`,
			name: 'Impact Stats Band',
			library: lib.id,
			category: 'community',
			description: `Impact stats band in the ${lib.label} style — three big-number tiles with tinted icon squares for meals, volunteers, and partners, under a thin ${lib.id === 'thingtime' ? 'rainbow' : 'palette-gradient'} divider with a since-year caption.`,
			tags: ['charity', 'impact', 'stats', 'metrics'],
			args: [
				stringArg('title', 'Our impact so far', { label: 'Title', maxLength: 50 }),
				stringArg('meals', '12,480', { label: 'Meals', maxLength: 10 }),
				stringArg('since', '2020', { label: 'Since year', maxLength: 6 })
			],
			render: el(
				'div',
				{ style: card(lib, { width: '320px', gap: '12px' }) },
				heading(lib, '{title}'),
				el('div', { style: { height: '3px', borderRadius: lib.radius.pill, background: rainbowOf(lib) } }),
				row(
					{ gap: '12px', alignItems: 'flex-start' },
					tile(icons.heart(15, lib.palette.danger.solid, true), lib.palette.danger.soft, '{meals}', 'meals shared'),
					tile(icons.user(15, lib.palette.info.solid), lib.palette.info.soft, '940', 'volunteers'),
					tile(icons.home(15, lib.palette.success.solid), lib.palette.success.soft, '38', 'partner orgs')
				),
				caption(lib, 'Community-powered since {since}')
			)
		});

		const benefitRow = (value) =>
			row({ gap: '8px' }, checkCircle(lib, 15), text({ fontSize: lib.fontSize.sm, color: lib.text, lineHeight: 1.4 }, value));

		const sponsor = define({
			slug: `${lib.id}-charity-community-sponsor`,
			name: 'Sponsorship Tier Card',
			library: lib.id,
			category: 'community',
			description: `Sponsorship tier card in the ${lib.label} style — a bronze, silver, or gold metal tier chip, monthly price, a check-circle benefit list, and a metal call-to-action that flips to a quiet Current-plan outline when the tier is already active.`,
			tags: ['charity', 'sponsor', 'tier', 'pricing'],
			args: [
				enumArg('tier', ['bronze', 'silver', 'gold'], 'gold', { label: 'Tier' }),
				stringArg('price', '$120', { label: 'Monthly price', maxLength: 10 }),
				stringArg('benefit', 'Logo on the event banner', { label: 'Top benefit', maxLength: 60 }),
				booleanArg('current', false, { label: 'Current tier' })
			],
			render: el(
				'div',
				{ style: card(lib) },
				row(
					{ justifyContent: 'space-between', gap: '8px' },
					el(
						'span',
						{
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								padding: '3px 10px',
								borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
								fontSize: lib.fontSize.xs,
								fontWeight: 700,
								letterSpacing: '0.06em',
								textTransform: 'uppercase',
								background: map('tier', METALS, METALS.gold),
								color: map('tier', { bronze: lib.surface, silver: lib.text, gold: lib.text }, lib.text)
							}
						},
						'{tier}'
					),
					iff('current', text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.palette.success.onSoft }, 'Active'))
				),
				row({ gap: '4px', alignItems: 'baseline' }, bigNumber(lib, '{price}'), caption(lib, '/month', { fontSize: lib.fontSize.sm })),
				stack(
					{ gap: '8px' },
					benefitRow('{benefit}'),
					benefitRow('Priority event invites'),
					benefitRow('Quarterly impact report'),
					benefitRow('Newsletter shout-out')
				),
				el(
					'button',
					{
						type: 'button',
						style: merge(
							ctaBase(lib),
							iff(
								'current',
								{
									background: 'transparent',
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: lib.border,
									color: lib.muted,
									cursor: 'default',
									boxShadow: 'none'
								},
								{
									background: map('tier', METALS, METALS.gold),
									color: map('tier', { bronze: lib.surface, silver: lib.text, gold: lib.text }, lib.text),
									boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
								}
							)
						)
					},
					iff('current', 'Current plan', 'Become a sponsor')
				)
			)
		});

		return [donate, fundraiser, volunteer, impact, sponsor];
	}
};
