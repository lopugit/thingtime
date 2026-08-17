// Marketing archetype — landing-page sections: hero, pricing card,
// testimonial, feature item, and CTA band.
// Contract mirrors button.mjs: exactly 5 variants, `build(lib)` returns
// exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-marketing-<variant>`.

import {
	avatarCircle,
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
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

const surfaceCard = (lib, extra = {}) => ({
	fontFamily: lib.font,
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	boxSizing: 'border-box',
	...extra
});

const buttonStyle = (lib, extra = {}) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '8px',
	border: 'none',
	height: lib.control.md,
	padding: '0 18px',
	borderRadius: lib.radius.md,
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	fontSize: lib.fontSize.md,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {}),
	...extra
});

const featureCheckRow = (lib, token) =>
	row(
		{ gap: '10px' },
		el(
			'span',
			{
				style: {
					width: '18px',
					height: '18px',
					borderRadius: lib.radius.pill,
					background: lib.palette.success.soft,
					color: lib.palette.success.onSoft,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					flexShrink: 0
				}
			},
			icons.check(11, 'currentColor')
		),
		text({ fontSize: lib.fontSize.sm, color: lib.text }, token)
	);

export const archetype = {
	id: 'marketing',
	category: 'marketing',
	variants: ['hero', 'pricing', 'testimonial', 'feature', 'cta'],
	build(lib) {
		const hero = define({
			slug: `${lib.id}-marketing-hero`,
			name: 'Hero Section',
			library: lib.id,
			category: 'marketing',
			description: `Centered landing hero in the ${lib.label} style — display heading, supporting subtext, and a solid + outline button pair on ${lib.label} tone, radius, and type tokens.`,
			tags: ['marketing', 'hero', 'landing', 'section'],
			args: [
				stringArg('heading', 'Ship your ideas faster', { label: 'Heading', maxLength: 60 }),
				textArg('subtext', 'Everything you need to design, build, and launch — in one calm workspace.', {
					label: 'Subtext',
					maxLength: 160
				}),
				stringArg('primaryLabel', 'Get started', { label: 'Primary button', maxLength: 30 }),
				stringArg('secondaryLabel', 'View demo', { label: 'Secondary button', maxLength: 30 }),
				toneArg()
			],
			render: el(
				'section',
				{
					style: {
						fontFamily: lib.font,
						background: lib.surface,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.borderSoft,
						borderRadius: lib.radius.lg,
						boxShadow: lib.shadow.md,
						padding: '44px 36px',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						textAlign: 'center',
						gap: '12px',
						maxWidth: '560px',
						boxSizing: 'border-box'
					}
				},
				text(
					{ fontSize: '30px', fontWeight: lib.headingWeight, color: lib.text, lineHeight: 1.15, letterSpacing: '-0.02em' },
					'{heading}'
				),
				text({ fontSize: lib.fontSize.lg, color: lib.muted, lineHeight: 1.55, maxWidth: '420px' }, '{subtext}'),
				row(
					{ gap: '10px', marginTop: '8px', justifyContent: 'center', flexWrap: 'wrap' },
					el(
						'button',
						{
							type: 'button',
							style: buttonStyle(lib, {
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								boxShadow: lib.shadow.sm
							})
						},
						'{primaryLabel}'
					),
					el(
						'button',
						{
							type: 'button',
							style: buttonStyle(lib, {
								background: 'transparent',
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.border,
								color: lib.text
							})
						},
						'{secondaryLabel}'
					)
				)
			)
		});

		const pricing = define({
			slug: `${lib.id}-marketing-pricing`,
			name: 'Pricing Card',
			library: lib.id,
			category: 'marketing',
			description: `Single-plan pricing card in the ${lib.label} style — plan name, large price with period, a check-icon feature list, and a full-width call-to-action button.`,
			tags: ['marketing', 'pricing', 'plan', 'card'],
			args: [
				stringArg('plan', 'Pro', { label: 'Plan name', maxLength: 24 }),
				stringArg('price', '$29', { label: 'Price', maxLength: 12 }),
				stringArg('feature1', 'Unlimited projects', { label: 'Feature 1', maxLength: 40 }),
				stringArg('feature2', 'Priority support', { label: 'Feature 2', maxLength: 40 }),
				stringArg('feature3', 'Custom domains', { label: 'Feature 3', maxLength: 40 }),
				stringArg('ctaLabel', 'Start free trial', { label: 'Button label', maxLength: 30 })
			],
			render: stack(
				surfaceCard(lib, {
					padding: '24px',
					gap: '14px',
					width: '260px',
					boxShadow: lib.id === 'untitled' ? lib.shadow.lg : lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
				}),
				text(
					{
						fontSize: lib.fontSize.sm,
						fontWeight: 600,
						color: lib.palette.primary.onSoft,
						...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: '0.08em' } : {})
					},
					'{plan}'
				),
				row(
					{ gap: '4px', alignItems: 'baseline' },
					text({ fontSize: '30px', fontWeight: lib.headingWeight, color: lib.text, lineHeight: 1 }, '{price}'),
					text({ fontSize: lib.fontSize.sm, color: lib.muted }, '/month')
				),
				el('div', { style: { height: '1px', background: lib.borderSoft } }),
				stack(
					{ gap: '8px' },
					featureCheckRow(lib, '{feature1}'),
					featureCheckRow(lib, '{feature2}'),
					featureCheckRow(lib, '{feature3}')
				),
				el(
					'button',
					{
						type: 'button',
						style: buttonStyle(lib, {
							background: lib.palette.primary.solid,
							color: lib.palette.primary.onSolid,
							width: '100%',
							boxShadow: lib.shadow.sm,
							marginTop: '4px'
						})
					},
					'{ctaLabel}'
				)
			)
		});

		const testimonial = define({
			slug: `${lib.id}-marketing-testimonial`,
			name: 'Testimonial Card',
			library: lib.id,
			category: 'marketing',
			description: `Customer testimonial in the ${lib.label} style — star rating, quoted praise, and an initials avatar with name and role${lib.id === 'thingtime' ? ', avatar dipped in the house rainbow' : ''}.`,
			tags: ['marketing', 'testimonial', 'quote', 'social-proof'],
			args: [
				textArg('quote', 'This replaced four tools on day one — easily the calmest software we use.', {
					label: 'Quote',
					maxLength: 200
				}),
				stringArg('name', 'Maya Chen', { label: 'Name', maxLength: 40 }),
				stringArg('role', 'Head of Product, Northwind', { label: 'Role', maxLength: 60 }),
				stringArg('initials', 'MC', { label: 'Initials', maxLength: 3 }),
				numberArg('stars', 5, { label: 'Stars', min: 0, max: 5 })
			],
			render: stack(
				surfaceCard(lib, { padding: '20px 22px', gap: '12px', maxWidth: '360px' }),
				row({ gap: '3px' }, repeat('stars', 5, icons.star(15, lib.palette.warning.solid, true))),
				text({ fontSize: lib.fontSize.lg, color: lib.text, lineHeight: 1.55 }, '“{quote}”'),
				row(
					{ gap: '10px', marginTop: '2px' },
					avatarCircle(
						38,
						lib.id === 'thingtime' ? lib.rainbow : lib.palette.primary.soft,
						lib.id === 'thingtime' ? lib.ink : lib.palette.primary.onSoft,
						'{initials}',
						lib.fontSize.sm
					),
					stack(
						{ gap: '2px' },
						text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '{name}'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{role}')
					)
				)
			)
		});

		const feature = define({
			slug: `${lib.id}-marketing-feature`,
			name: 'Feature Item',
			library: lib.id,
			category: 'marketing',
			description: `Feature highlight in the ${lib.label} style — a tone-tinted icon tile beside a bold title and muted supporting copy, icon switchable via an enum.`,
			tags: ['marketing', 'feature', 'icon', 'benefits'],
			args: [
				stringArg('title', 'Instant sync', { label: 'Title', maxLength: 40 }),
				textArg('body', 'Every change lands on all your devices in milliseconds — no save button, no refresh.', {
					label: 'Body',
					maxLength: 160
				}),
				enumArg('icon', ['zap', 'mail', 'settings', 'star'], 'zap', { label: 'Icon' }),
				toneArg()
			],
			render: row(
				{ fontFamily: lib.font, gap: '14px', alignItems: 'flex-start', maxWidth: '360px' },
				el(
					'div',
					{
						style: {
							width: '44px',
							height: '44px',
							borderRadius: lib.id === 'untitled' || lib.id === 'daisyui' ? lib.radius.pill : lib.radius.md,
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							flexShrink: 0
						}
					},
					map(
						'icon',
						{
							zap: icons.zap(20, 'currentColor'),
							mail: icons.mail(20, 'currentColor'),
							settings: icons.settings(20, 'currentColor'),
							star: icons.star(20, 'currentColor', false)
						},
						icons.zap(20, 'currentColor')
					)
				),
				stack(
					{ gap: '4px', minWidth: '0' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
					text({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.55 }, '{body}')
				)
			)
		});

		const gradientBg =
			lib.id === 'thingtime'
				? lib.rainbow
				: `linear-gradient(135deg, ${lib.palette.primary.solid} 0%, ${lib.palette.info.solid} 100%)`;
		const gradientText = lib.id === 'thingtime' ? lib.ink : '#ffffff';

		const cta = define({
			slug: `${lib.id}-marketing-cta`,
			name: 'CTA Band',
			library: lib.id,
			category: 'marketing',
			description: `Call-to-action band in the ${lib.label} style — gradient or solid tone background with heading, subtext, and an inverted surface button${lib.id === 'thingtime' ? '; gradient mode uses the house rainbow' : ''}.`,
			tags: ['marketing', 'cta', 'banner', 'conversion'],
			args: [
				stringArg('heading', 'Ready to dive in?', { label: 'Heading', maxLength: 60 }),
				textArg('subtext', 'Free 14-day trial — no credit card required.', { label: 'Subtext', maxLength: 120 }),
				stringArg('buttonLabel', 'Create your account', { label: 'Button label', maxLength: 30 }),
				booleanArg('gradient', true, { label: 'Gradient' }),
				toneArg()
			],
			render: row(
				{
					fontFamily: lib.font,
					padding: '24px 28px',
					borderRadius: lib.radius.lg,
					background: iff('gradient', gradientBg, toneMap(lib, (palette) => palette.solid)),
					color: iff('gradient', gradientText, toneMap(lib, (palette) => palette.onSolid)),
					gap: '18px',
					justifyContent: 'space-between',
					flexWrap: 'wrap',
					maxWidth: '560px',
					boxShadow: lib.shadow.md,
					boxSizing: 'border-box'
				},
				stack(
					{ gap: '4px', flex: '1 1 220px', minWidth: '200px' },
					text({ fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight }, '{heading}'),
					text({ fontSize: lib.fontSize.sm, opacity: 0.85 }, '{subtext}')
				),
				el(
					'button',
					{
						type: 'button',
						style: buttonStyle(lib, { background: lib.surface, color: lib.text, boxShadow: lib.shadow.sm, flexShrink: 0 })
					},
					'{buttonLabel}'
				)
			)
		});

		return [hero, pricing, testimonial, feature, cta];
	}
};
