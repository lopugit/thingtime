// Card archetype — content surfaces in five compositions.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-card-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	map,
	merge,
	row,
	stack,
	stringArg,
	text,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

const cardBase = (lib) => ({
	width: '300px',
	fontFamily: lib.font,
	background: lib.surface,
	color: lib.text,
	border: `1px solid ${lib.border}`,
	borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
	boxShadow: lib.shadow.sm,
	overflow: 'hidden',
	boxSizing: 'border-box'
});

const titleText = (lib) => ({
	fontSize: lib.fontSize.lg,
	fontWeight: lib.headingWeight,
	color: lib.id === 'thingtime' ? lib.ink : lib.text
});

const bodyText = (lib) => ({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.5 });

const actionButton = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: lib.control.sm,
	padding: '0 14px',
	border: 'none',
	borderRadius: lib.radius.sm,
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	fontSize: lib.fontSize.sm,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

export const archetype = {
	id: 'card',
	category: 'layout',
	variants: ['basic', 'header-footer', 'media', 'actions', 'elevated'],
	build(lib) {
		const basic = define({
			slug: `${lib.id}-card-basic`,
			name: 'Basic Card',
			library: lib.id,
			category: 'layout',
			description: `Simple padded content card in the ${lib.label} style — tone-colored eyebrow, heading and muted body on one bordered library surface.`,
			tags: ['card', 'surface', 'content'],
			args: [
				stringArg('title', 'Card title', { label: 'Title', maxLength: 60 }),
				textArg('body', 'Cards group related content and actions onto one calm surface.', { label: 'Body' }),
				stringArg('eyebrow', 'Overview', { label: 'Eyebrow', maxLength: 30 }),
				toneArg()
			],
			render: stack(
				{ ...cardBase(lib), padding: '16px', gap: '8px' },
				iff(
					'eyebrow',
					text(
						{
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							textTransform: 'uppercase',
							letterSpacing: '0.06em',
							color: toneMap(lib, (palette) => palette.solid)
						},
						'{eyebrow}'
					)
				),
				text(titleText(lib), '{title}'),
				text(bodyText(lib), '{body}')
			)
		});

		const headerFooter = define({
			slug: `${lib.id}-card-header-footer`,
			name: 'Header & Footer Card',
			library: lib.id,
			category: 'layout',
			description: `Three-part card in the ${lib.label} style — bordered header and footer bands around a padded body, with an optional tinted footer.`,
			tags: ['card', 'header', 'footer', 'sections'],
			args: [
				stringArg('title', 'Weekly report', { label: 'Title', maxLength: 60 }),
				textArg('body', 'Everything shipped this week, grouped by team and sorted by impact.', { label: 'Body' }),
				stringArg('footer', 'Updated 2 days ago', { label: 'Footer', maxLength: 60 }),
				booleanArg('tintedFooter', true, { label: 'Tinted footer' })
			],
			render: stack(
				cardBase(lib),
				el('div', { style: { padding: '12px 16px', borderBottom: `1px solid ${lib.borderSoft}` } }, text(titleText(lib), '{title}')),
				el('div', { style: { padding: '16px' } }, text(bodyText(lib), '{body}')),
				el(
					'div',
					{
						style: merge(
							{ padding: '10px 16px', borderTop: `1px solid ${lib.borderSoft}`, fontSize: lib.fontSize.xs, color: lib.muted },
							iff('tintedFooter', { background: lib.surfaceAlt }, {})
						)
					},
					'{footer}'
				)
			)
		});

		const media = define({
			slug: `${lib.id}-card-media`,
			name: 'Media Card',
			library: lib.id,
			category: 'layout',
			description: `Card with a media block in the ${lib.label} style — a ${lib.id === 'thingtime' ? 'rainbow' : 'tone-gradient'} placeholder banner over a badge, title and body.`,
			tags: ['card', 'media', 'image', 'banner'],
			args: [
				stringArg('title', 'Golden hour', { label: 'Title', maxLength: 60 }),
				textArg('body', 'A placeholder media block stands in for imagery — no external assets needed.', { label: 'Body' }),
				toneArg(),
				enumArg('mediaHeight', ['sm', 'md', 'lg'], 'md', { label: 'Media height' }),
				stringArg('badge', 'New', { label: 'Badge', maxLength: 20 })
			],
			render: stack(
				cardBase(lib),
				el(
					'div',
					{
						style: merge(
							{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								background:
									lib.id === 'thingtime'
										? lib.rainbow
										: toneMap(lib, (palette) => `linear-gradient(135deg, ${palette.soft} 0%, ${palette.border} 60%, ${palette.solid} 140%)`)
							},
							map(
								'mediaHeight',
								{ sm: { height: '72px' }, md: { height: '112px' }, lg: { height: '152px' } },
								{ height: '112px' }
							)
						)
					},
					icons.image(28, lib.id === 'thingtime' ? 'rgba(255, 255, 255, 0.92)' : toneMap(lib, (palette) => palette.onSoft))
				),
				stack(
					{ padding: '16px', gap: '8px' },
					iff(
						'badge',
						el(
							'span',
							{
								style: {
									alignSelf: 'flex-start',
									padding: '2px 8px',
									borderRadius: lib.radius.pill,
									fontSize: lib.fontSize.xs,
									fontWeight: 600,
									background: toneMap(lib, (palette) => palette.soft),
									color: toneMap(lib, (palette) => palette.onSoft),
									border: toneMap(lib, (palette) => `1px solid ${palette.border}`)
								}
							},
							'{badge}'
						)
					),
					text(titleText(lib), '{title}'),
					text(bodyText(lib), '{body}')
				)
			)
		});

		const actions = define({
			slug: `${lib.id}-card-actions`,
			name: 'Actions Card',
			library: lib.id,
			category: 'layout',
			description: `Card with footer action buttons in the ${lib.label} style — ${lib.uppercaseButtons ? 'uppercase ' : ''}solid confirm beside an outlined cancel, right-aligned above the border.`,
			tags: ['card', 'actions', 'buttons', 'footer'],
			args: [
				stringArg('title', 'Delete project?', { label: 'Title', maxLength: 60 }),
				textArg('body', 'This removes the project and its history. Collaborators lose access immediately.', { label: 'Body' }),
				stringArg('primaryLabel', 'Confirm', { label: 'Primary label', maxLength: 30 }),
				stringArg('secondaryLabel', 'Cancel', { label: 'Secondary label', maxLength: 30 }),
				toneArg(undefined, 'danger')
			],
			render: stack(
				cardBase(lib),
				stack({ padding: '16px', gap: '8px' }, text(titleText(lib), '{title}'), text(bodyText(lib), '{body}')),
				row(
					{ justifyContent: 'flex-end', gap: '8px', padding: '12px 16px', borderTop: `1px solid ${lib.borderSoft}` },
					iff(
						'secondaryLabel',
						el(
							'button',
							{
								type: 'button',
								style: { ...actionButton(lib), background: 'transparent', border: `1px solid ${lib.border}`, color: lib.text }
							},
							'{secondaryLabel}'
						)
					),
					el(
						'button',
						{
							type: 'button',
							style: merge(actionButton(lib), {
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid)
							})
						},
						'{primaryLabel}'
					)
				)
			)
		});

		const elevated = define({
			slug: `${lib.id}-card-elevated`,
			name: 'Elevated Card',
			library: lib.id,
			category: 'layout',
			description: `Floating borderless card in the ${lib.label} style — the library's deeper shadow tiers lift it off the page, led by a tone-tinted icon chip.`,
			tags: ['card', 'elevated', 'shadow', 'floating'],
			args: [
				stringArg('title', 'Quick insight', { label: 'Title', maxLength: 60 }),
				textArg('body', 'Elevation carries the hierarchy here — the card floats free of any border.', { label: 'Body' }),
				enumArg('elevation', ['raised', 'floating'], 'floating', { label: 'Elevation' }),
				toneArg()
			],
			render: stack(
				{
					...cardBase(lib),
					border: lib.id === 'reactflow' ? `1px solid ${lib.border}` : 'none',
					boxShadow: map('elevation', { raised: lib.shadow.md, floating: lib.shadow.lg }, lib.shadow.lg),
					padding: '16px',
					gap: '10px'
				},
				row(
					{ gap: '10px' },
					el(
						'div',
						{
							style: {
								width: '32px',
								height: '32px',
								borderRadius: lib.radius.sm,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								background: toneMap(lib, (palette) => palette.soft),
								flexShrink: 0
							}
						},
						icons.zap(16, toneMap(lib, (palette) => palette.onSoft))
					),
					text(titleText(lib), '{title}')
				),
				text(bodyText(lib), '{body}')
			)
		});

		return [basic, headerFooter, media, actions, elevated];
	}
};
