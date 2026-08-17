// Support archetype — customer-support surfaces in five renditions: ticket
// row, FAQ accordion, chat launcher, incident status banner, and CSAT prompt.
// Follows the button.mjs exemplar: exactly 5 variants, `build(lib)` returns
// exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-support-help-<variant>`.

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
	row,
	stack,
	stringArg,
	text,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// antd chips sit on tight 4px corners and reactflow chrome stays crisp;
// everyone else wears the classic pill.
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);

const chipBase = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '6px',
	padding: '2px 8px',
	fontSize: lib.fontSize.xs,
	fontWeight: 600,
	lineHeight: 1.4,
	borderRadius: chipRadius(lib),
	textTransform: 'capitalize',
	whiteSpace: 'nowrap',
	flexShrink: 0
});

const cardBase = (lib) => ({
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	fontFamily: lib.font,
	color: lib.text,
	boxSizing: 'border-box'
});

const upper = (lib) =>
	lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {};

const ghostButton = (lib, color, label) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				background: 'transparent',
				border: 'none',
				cursor: 'pointer',
				padding: '4px 8px',
				borderRadius: lib.radius.sm,
				fontFamily: lib.font,
				fontSize: lib.fontSize.xs,
				fontWeight: 600,
				color,
				...upper(lib)
			}
		},
		label
	);

// Feather-style chat bubble glyph (allowlisted svg/path only).
const chatGlyph = (size, color) =>
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
		el('path', {
			d: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5h.5a8.48 8.48 0 0 1 8 8v.5z'
		})
	);

// Face glyph: outline circle + two dot eyes + a mouth node (arc path or line).
const faceSvg = (ink, mouth) =>
	el(
		'svg',
		{
			width: 22,
			height: 22,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: ink,
			strokeWidth: 1.8,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		el('circle', { cx: 12, cy: 12, r: 10 }),
		el('circle', { cx: 8.8, cy: 9.6, r: 1.1, fill: ink, stroke: 'none' }),
		el('circle', { cx: 15.2, cy: 9.6, r: 1.1, fill: ink, stroke: 'none' }),
		mouth
	);

const MOUTHS = {
	terrible: el('path', { d: 'M7.8 16.4s1.6-2.6 4.2-2.6 4.2 2.6 4.2 2.6' }),
	bad: el('path', { d: 'M8.6 15.6s1.3-1.4 3.4-1.4 3.4 1.4 3.4 1.4' }),
	okay: el('line', { x1: 8.6, y1: 15, x2: 15.4, y2: 15 }),
	good: el('path', { d: 'M8.6 14.2s1.3 1.4 3.4 1.4 3.4-1.4 3.4-1.4' }),
	great: el('path', { d: 'M7.8 13.6s1.6 2.6 4.2 2.6 4.2-2.6 4.2-2.6' })
};

export const archetype = {
	id: 'support-help',
	category: 'support',
	variants: ['ticket', 'faq', 'launcher', 'status', 'csat'],
	build(lib) {
		const pal = lib.palette;
		// Thingtime's wink tone is its pink info; everyone else opens on primary.
		const openTint = lib.id === 'thingtime' ? pal.info : pal.primary;
		// reactflow's unread signal is its hot accent (same hue as its danger).
		const unreadColor = lib.accent || pal.danger.solid;

		const ticket = define({
			slug: `${lib.id}-support-help-ticket`,
			name: 'Support Ticket Row',
			library: lib.id,
			category: 'support',
			description: `Support ticket queue row in the ${lib.label} style — mono id chip, subject with requester caption, priority and status chips, and the assignee avatar on library-native corners.`,
			tags: ['support', 'ticket', 'queue', 'row', 'status'],
			args: [
				stringArg('id', '4821', { label: 'Ticket #', maxLength: 8 }),
				stringArg('subject', 'Cannot connect my calendar', { label: 'Subject', maxLength: 60 }),
				stringArg('requester', 'Dana P.', { label: 'Requester', maxLength: 24 }),
				stringArg('updated', '2h ago', { label: 'Updated', maxLength: 16 }),
				enumArg('priority', ['low', 'medium', 'high', 'urgent'], 'high', { label: 'Priority' }),
				enumArg('status', ['open', 'waiting'], 'open', { label: 'Status' })
			],
			render: el(
				'div',
				{
					style: merge(cardBase(lib), {
						display: 'flex',
						alignItems: 'center',
						gap: '12px',
						width: '430px',
						padding: '10px 14px',
						borderRadius: lib.radius.md
					})
				},
				el(
					'span',
					{
						style: {
							fontFamily: lib.fontMono,
							fontSize: lib.fontSize.xs,
							color: lib.muted,
							background: lib.surfaceAlt,
							padding: '2px 6px',
							borderRadius: lib.radius.xs,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.borderSoft,
							flexShrink: 0
						}
					},
					'#{id}'
				),
				stack(
					{ gap: '2px', flex: '1 1 auto', minWidth: 0 },
					text(
						{
							fontSize: lib.fontSize.sm,
							fontWeight: 600,
							color: lib.text,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis'
						},
						'{subject}'
					),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{requester} · Updated {updated}')
				),
				el(
					'span',
					{
						style: merge(
							chipBase(lib),
							{
								background: map(
									'priority',
									{ low: pal.neutral.soft, medium: pal.info.soft, high: pal.warning.soft, urgent: pal.danger.soft },
									pal.neutral.soft
								),
								color: map(
									'priority',
									{ low: pal.neutral.onSoft, medium: pal.info.onSoft, high: pal.warning.onSoft, urgent: pal.danger.onSoft },
									pal.neutral.onSoft
								)
							},
							lib.id === 'antd'
								? {
										borderWidth: '1px',
										borderStyle: 'solid',
										borderColor: map(
											'priority',
											{ low: pal.neutral.border, medium: pal.info.border, high: pal.warning.border, urgent: pal.danger.border },
											pal.neutral.border
										)
									}
								: {}
						)
					},
					'{priority}'
				),
				el(
					'span',
					{
						style: merge(
							chipBase(lib),
							ifEq(
								'status',
								'open',
								{ background: openTint.soft, color: openTint.onSoft },
								{ background: lib.surfaceAlt, color: lib.muted }
							)
						)
					},
					'{status}'
				),
				avatarCircle('26px', openTint.solid, openTint.onSolid, 'AK', lib.fontSize.xs)
			)
		});

		const faq = define({
			slug: `${lib.id}-support-help-faq`,
			name: 'FAQ Accordion',
			library: lib.id,
			category: 'support',
			description: `Help-center FAQ accordion in the ${lib.label} style — three question rows with chevrons, the first expandable into its answer with a "was this helpful" yes/no ghost pair.`,
			tags: ['support', 'faq', 'accordion', 'help'],
			args: [
				stringArg('question', 'How do I reset my password?', { label: 'Question', maxLength: 60 }),
				textArg('answer', 'Head to Settings, choose Security, then Reset password — we email you a secure link that stays valid for one hour.', {
					label: 'Answer',
					maxLength: 240
				}),
				booleanArg('expanded', true, { label: 'Expanded' })
			],
			render: el(
				'div',
				{
					style: merge(cardBase(lib), {
						display: 'flex',
						flexDirection: 'column',
						width: '320px',
						overflow: 'hidden'
					})
				},
				stack(
					{ gap: '0px' },
					row(
						{ justifyContent: 'space-between', gap: '10px', padding: '12px 14px' },
						text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{question}'),
						iff('expanded', icons.chevronDown(16, lib.muted), icons.chevronRight(16, lib.muted))
					),
					iff(
						'expanded',
						stack(
							{ padding: '0 14px 12px', gap: '10px' },
							text({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.6 }, '{answer}'),
							row(
								{ gap: '4px' },
								text({ fontSize: lib.fontSize.xs, color: lib.faint, fontWeight: 500 }, 'Was this helpful?'),
								ghostButton(lib, lib.muted, 'Yes'),
								ghostButton(lib, lib.muted, 'No')
							)
						)
					)
				),
				row(
					{
						justifyContent: 'space-between',
						gap: '10px',
						padding: '12px 14px',
						borderTopWidth: '1px',
						borderTopStyle: 'solid',
						borderTopColor: lib.borderSoft
					},
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, 'Can I export my data?'),
					icons.chevronRight(16, lib.faint)
				),
				row(
					{
						justifyContent: 'space-between',
						gap: '10px',
						padding: '12px 14px',
						borderTopWidth: '1px',
						borderTopStyle: 'solid',
						borderTopColor: lib.borderSoft
					},
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, 'Where do I manage billing?'),
					icons.chevronRight(16, lib.faint)
				)
			)
		});

		const launcher = define({
			slug: `${lib.id}-support-help-launcher`,
			name: 'Chat Launcher',
			library: lib.id,
			category: 'support',
			description: `Floating chat launcher in the ${lib.label} style — round tone bubble with a chat glyph and unread dot, plus a dismissable teaser card with an agent avatar trio.`,
			tags: ['support', 'chat', 'launcher', 'widget', 'floating'],
			args: [
				textArg('teaser', 'Hi there! Have a question about your order? We are online now.', { label: 'Teaser', maxLength: 140 }),
				toneArg(),
				booleanArg('showTeaser', true, { label: 'Show teaser' }),
				booleanArg('unread', true, { label: 'Unread dot' })
			],
			render: stack(
				{ display: 'inline-flex', alignItems: 'flex-end', gap: '10px', fontFamily: lib.font },
				iff(
					'showTeaser',
					el(
						'div',
						{
							style: merge(cardBase(lib), {
								display: 'flex',
								flexDirection: 'column',
								gap: '8px',
								width: '250px',
								padding: '12px',
								boxShadow: lib.shadow.lg
							})
						},
						lib.id === 'thingtime'
							? el('div', { style: { height: '3px', borderRadius: lib.radius.pill, background: lib.rainbow } })
							: null,
						row(
							{ justifyContent: 'space-between', gap: '8px' },
							row(
								{ gap: '0px' },
								avatarCircle('24px', pal.info.soft, pal.info.onSoft, 'AM', lib.fontSize.xs),
								avatarCircle('24px', pal.success.soft, pal.success.onSoft, 'JR', lib.fontSize.xs, { marginLeft: '-6px' }),
								avatarCircle('24px', pal.warning.soft, pal.warning.onSoft, 'KT', lib.fontSize.xs, { marginLeft: '-6px' })
							),
							el(
								'button',
								{
									type: 'button',
									style: {
										background: 'transparent',
										border: 'none',
										cursor: 'pointer',
										padding: '0',
										display: 'inline-flex',
										color: lib.faint
									}
								},
								icons.x(14, 'currentColor')
							)
						),
						text({ fontSize: lib.fontSize.sm, color: lib.text, fontWeight: 500, lineHeight: 1.5 }, '{teaser}'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Typically replies in a few minutes')
					)
				),
				el(
					'div',
					{
						style: {
							position: 'relative',
							width: lib.id === 'daisyui' ? '60px' : '54px',
							height: lib.id === 'daisyui' ? '60px' : '54px',
							borderRadius: lib.radius.pill,
							background: toneMap(lib, (palette) => palette.solid),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							boxShadow: lib.shadow.lg,
							cursor: 'pointer',
							flexShrink: 0
						}
					},
					chatGlyph(24, toneMap(lib, (palette) => palette.onSolid)),
					iff(
						'unread',
						el('span', {
							style: {
								position: 'absolute',
								top: '0px',
								right: '0px',
								width: '12px',
								height: '12px',
								borderRadius: lib.radius.pill,
								background: unreadColor,
								borderWidth: '2px',
								borderStyle: 'solid',
								borderColor: lib.surface
							}
						})
					)
				)
			)
		});

		const status = define({
			slug: `${lib.id}-support-help-status`,
			name: 'Incident Status Banner',
			library: lib.id,
			category: 'support',
			description: `Incident status banner in the ${lib.label} style — state dot and tint flip between operational, degraded, and outage, with subscribe and details actions plus a shimmer bar during incidents.`,
			tags: ['support', 'status', 'incident', 'banner', 'uptime'],
			args: [
				stringArg('system', 'API', { label: 'System', maxLength: 24 }),
				enumArg('state', ['operational', 'degraded', 'outage'], 'degraded', { label: 'State' }),
				stringArg('ago', '4 min ago', { label: 'Updated', maxLength: 16 })
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						flexDirection: 'column',
						gap: '6px',
						width: '340px',
						padding: '12px 14px',
						boxSizing: 'border-box',
						background: map(
							'state',
							{ operational: pal.success.soft, degraded: pal.warning.soft, outage: pal.danger.soft },
							pal.success.soft
						),
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: map(
							'state',
							{ operational: pal.success.border, degraded: pal.warning.border, outage: pal.danger.border },
							pal.success.border
						),
						borderRadius: lib.radius.md,
						fontFamily: lib.font
					}
				},
				row(
					{ gap: '8px' },
					el('span', {
						style: {
							width: '10px',
							height: '10px',
							borderRadius: lib.radius.pill,
							flexShrink: 0,
							background: map(
								'state',
								{ operational: pal.success.solid, degraded: pal.warning.solid, outage: pal.danger.solid },
								pal.success.solid
							)
						}
					}),
					text(
						{
							fontSize: lib.fontSize.md,
							fontWeight: lib.headingWeight,
							textTransform: 'capitalize',
							color: map(
								'state',
								{ operational: pal.success.onSoft, degraded: pal.warning.onSoft, outage: pal.danger.onSoft },
								pal.success.onSoft
							)
						},
						'{system} — {state}'
					)
				),
				text({ fontSize: lib.fontSize.xs, color: lib.muted, paddingLeft: '18px' }, 'Updated {ago}'),
				row(
					{ gap: '8px', paddingLeft: '10px' },
					ghostButton(
						lib,
						map(
							'state',
							{ operational: pal.success.onSoft, degraded: pal.warning.onSoft, outage: pal.danger.onSoft },
							pal.success.onSoft
						),
						'Subscribe'
					),
					el(
						'a',
						{
							href: '#',
							style: {
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								textDecoration: 'underline',
								color: lib.muted,
								padding: '4px 0'
							}
						},
						'Details'
					)
				),
				ifEq(
					'state',
					'operational',
					'',
					el(
						'div',
						{
							style: {
								height: '4px',
								borderRadius: lib.radius.pill,
								background: lib.surface,
								overflow: 'hidden',
								marginTop: '2px'
							}
						},
						el('div', {
							style: {
								height: '100%',
								width: '45%',
								borderRadius: lib.radius.pill,
								background:
									lib.id === 'thingtime'
										? lib.rainbow
										: map('state', { degraded: pal.warning.solid, outage: pal.danger.solid }, pal.warning.solid)
							}
						})
					)
				)
			)
		});

		// CSAT accent: reactflow rings in its hot accent, everyone else in the
		// library primary.
		const csatAccent = lib.accent || pal.primary.solid;
		const faceInk = lib.muted;
		const face = (value) =>
			el(
				'button',
				{
					type: 'button',
					style: merge(
						{
							width: '40px',
							height: '40px',
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							background: lib.surface,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							borderRadius: lib.radius.pill,
							cursor: 'pointer',
							padding: '0'
						},
						ifEq('rating', value, { borderColor: csatAccent, boxShadow: lib.focusRing, background: lib.surfaceAlt }, {})
					)
				},
				faceSvg(faceInk, MOUTHS[value])
			);

		const csat = define({
			slug: `${lib.id}-support-help-csat`,
			name: 'CSAT Prompt',
			library: lib.id,
			category: 'support',
			description: `Post-chat satisfaction prompt in the ${lib.label} style — five smiley-scale face buttons from terrible to great with the selected one ringed, an optional comment field, and a tone submit button.`,
			tags: ['support', 'csat', 'feedback', 'survey', 'rating'],
			args: [
				enumArg('rating', ['terrible', 'bad', 'okay', 'good', 'great'], 'great', { label: 'Rating' }),
				stringArg('agent', 'Maya', { label: 'Agent', maxLength: 24 }),
				booleanArg('comment', true, { label: 'Comment field' }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: merge(cardBase(lib), {
						display: 'flex',
						flexDirection: 'column',
						gap: '12px',
						width: '300px',
						padding: '16px'
					})
				},
				stack(
					{ gap: '2px' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, 'How did we do?'),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Rate your chat with {agent}')
				),
				row(
					{ justifyContent: 'space-between', gap: '4px' },
					face('terrible'),
					face('bad'),
					face('okay'),
					face('good'),
					face('great')
				),
				iff(
					'comment',
					el('input', {
						type: 'text',
						placeholder: 'Add a comment (optional)',
						style: {
							width: '100%',
							boxSizing: 'border-box',
							height: lib.control.sm,
							padding: '0 10px',
							borderRadius: lib.radius.sm,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							background: lib.surfaceAlt,
							fontFamily: lib.font,
							fontSize: lib.fontSize.sm,
							color: lib.text,
							outline: 'none'
						}
					})
				),
				el(
					'button',
					{
						type: 'button',
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: '100%',
							height: lib.control.sm,
							border: 'none',
							borderRadius: lib.radius.md,
							fontFamily: lib.font,
							fontWeight: lib.buttonWeight,
							fontSize: lib.fontSize.sm,
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							cursor: 'pointer',
							...upper(lib)
						}
					},
					'Submit'
				)
			)
		});

		return [ticket, faq, launcher, status, csat];
	}
};
