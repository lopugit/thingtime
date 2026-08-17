// News-reading archetype — news & reading surfaces in five renditions: a
// headline stack, an article card, a reader controls bar, an inline newsletter
// block, and a live-blog feed. Follows the button.mjs exemplar: exactly 5
// variants, `build(lib)` returns exactly 5 definitions (one per variant, same
// order), slugs `${lib.id}-news-reading-<variant>`.

import {
	avatarCircle,
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	numberArg,
	row,
	stack,
	stringArg,
	text,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// --- library personality accents --------------------------------------------

// React Flow flashes its pink accent, Thingtime stays ink, others go primary.
const accentSolid = (lib) =>
	lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid;

// Link/emphasis color for "more" style text.
const linkColor = (lib) =>
	lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.primary.solid;

// React Flow chrome stays crisp where others go round.
const crispOr = (lib, radius) => (lib.id === 'reactflow' ? lib.radius.sm : radius);

// antd chips sit on tight corners, reactflow stays crisp, the rest wear pills.
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : crispOr(lib, lib.radius.pill));

// daisyUI buttons go chunky; everyone else keeps their native control radius.
const buttonRadius = (lib) => (lib.id === 'daisyui' ? lib.radius.lg : crispOr(lib, lib.radius.md));

// Newsprint lead type — the one sanctioned serif stack for headline text.
const SERIF = "Georgia, 'Times New Roman', serif";

const card = (lib, extra = {}) => ({
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.id === 'untitled' ? lib.shadow.sm : 'none',
	fontFamily: lib.font,
	boxSizing: 'border-box',
	...extra
});

// --- svg glyphs the shared icon set lacks (allowlisted primitives only) -----

const bookmarkGlyph = (size, color) =>
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
		el('path', { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' })
	);

export const archetype = {
	id: 'news-reading',
	category: 'content',
	variants: ['headline', 'article-card', 'reader', 'newsletter', 'live-blog'],
	build(lib) {
		// --- headline -------------------------------------------------------
		const kickerBg =
			lib.id === 'reactflow' ? lib.palette.danger.soft : lib.id === 'thingtime' ? lib.surfaceAlt : lib.palette.primary.soft;
		const kickerColor = lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.onSoft;

		const secondaryRow = (token, when) =>
			row(
				{ gap: '8px' },
				el('span', {
					style: { width: '5px', height: '5px', borderRadius: '999px', background: accentSolid(lib), flexShrink: 0 }
				}),
				text(
					{
						flex: 1,
						minWidth: 0,
						fontSize: lib.fontSize.sm,
						fontWeight: 600,
						color: lib.text,
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis'
					},
					token
				),
				text({ fontSize: lib.fontSize.xs, color: lib.faint, flexShrink: 0 }, when)
			);

		const headline = define({
			slug: `${lib.id}-news-reading-headline`,
			name: 'Headline Stack',
			library: lib.id,
			category: 'content',
			description: `Headline stack in the ${lib.label} style — an uppercase section chip over a serif lead headline, two bulleted secondary stories with timestamps, and a ${lib.id === 'reactflow' ? 'pink-accent' : 'tone-colored'} more-from-section link.`,
			tags: ['news', 'headline', 'section', 'stories'],
			args: [
				stringArg('section', 'Technology', { label: 'Section', maxLength: 24 }),
				textArg('headline', 'Quantum chips leap from the lab to the laptop', { label: 'Headline', maxLength: 120 }),
				stringArg('sub1', 'Foundries race to package the first consumer wafers', { label: 'Story 2', maxLength: 80 }),
				stringArg('sub2', 'What the breakthrough means for battery life', { label: 'Story 3', maxLength: 80 })
			],
			render: stack(
				{ width: '300px', gap: '10px', fontFamily: lib.font },
				el(
					'span',
					{
						style: {
							alignSelf: 'flex-start',
							padding: '3px 9px',
							borderRadius: chipRadius(lib),
							background: kickerBg,
							color: kickerColor,
							fontSize: lib.fontSize.xs,
							fontWeight: 700,
							textTransform: 'uppercase',
							letterSpacing: '0.07em'
						}
					},
					'{section}'
				),
				text({ fontFamily: SERIF, fontSize: lib.fontSize.xl, fontWeight: 700, lineHeight: 1.25, color: lib.text }, '{headline}'),
				stack(
					{ gap: '7px', paddingTop: '9px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft },
					secondaryRow('{sub1}', '2h ago'),
					secondaryRow('{sub2}', '5h ago')
				),
				text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: linkColor(lib) }, 'More {section} →')
			)
		});

		// --- article-card ---------------------------------------------------
		const articleCard = define({
			slug: `${lib.id}-news-reading-article-card`,
			name: 'Article Card',
			library: lib.id,
			category: 'content',
			description: `Article card in the ${lib.label} style — a tone-soft image band over a category chip with a read-time caption, serif title, dek snippet, and an avatar byline row with a quiet bookmark button${lib.id === 'mui' ? ', riding Material elevation' : ''}.`,
			tags: ['news', 'article', 'card', 'byline', 'bookmark'],
			args: [
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'info'),
				stringArg('category', 'Climate', { label: 'Category', maxLength: 24 }),
				textArg('title', 'The quiet rewiring of the world’s power grids', { label: 'Title', maxLength: 100 }),
				textArg('dek', 'Utilities are burying a decade of upgrades under our streets — and almost nobody has noticed.', {
					label: 'Dek',
					maxLength: 160
				}),
				stringArg('readTime', '6 min read', { label: 'Read time', maxLength: 20 }),
				stringArg('author', 'Ana Reyes', { label: 'Author', maxLength: 40 })
			],
			render: stack(
				{ width: '300px', overflow: 'hidden', ...card(lib) },
				el(
					'div',
					{
						style: {
							height: '112px',
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center'
						}
					},
					icons.image(26, 'currentColor')
				),
				stack(
					{ padding: '14px', gap: '8px' },
					row(
						{ justifyContent: 'space-between', gap: '8px' },
						el(
							'span',
							{
								style: {
									padding: '2px 8px',
									borderRadius: chipRadius(lib),
									background: toneMap(lib, (palette) => palette.soft),
									color: toneMap(lib, (palette) => palette.onSoft),
									fontSize: lib.fontSize.xs,
									fontWeight: 700,
									textTransform: 'uppercase',
									letterSpacing: '0.05em'
								}
							},
							'{category}'
						),
						text({ fontSize: lib.fontSize.xs, color: lib.faint, flexShrink: 0 }, '{readTime}')
					),
					text({ fontFamily: SERIF, fontSize: lib.fontSize.lg, fontWeight: 700, lineHeight: 1.3, color: lib.text }, '{title}'),
					text({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.5 }, '{dek}'),
					row(
						{ gap: '8px', paddingTop: '9px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft },
						avatarCircle('26px', lib.palette.neutral.soft, lib.palette.neutral.onSoft, icons.user(13, 'currentColor'), lib.fontSize.xs),
						text(
							{
								fontSize: lib.fontSize.sm,
								fontWeight: 600,
								color: lib.text,
								minWidth: 0,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis'
							},
							'{author}'
						),
						text({ fontSize: lib.fontSize.xs, color: lib.faint, flexShrink: 0 }, 'May 12'),
						el(
							'button',
							{
								type: 'button',
								style: {
									marginLeft: 'auto',
									width: '28px',
									height: '28px',
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									border: 'none',
									background: 'transparent',
									color: lib.muted,
									borderRadius: crispOr(lib, lib.radius.sm),
									cursor: 'pointer',
									padding: '0',
									flexShrink: 0
								}
							},
							bookmarkGlyph(15, 'currentColor')
						)
					)
				)
			)
		});

		// --- reader ---------------------------------------------------------
		const stepButton = (label, fontSize) =>
			el(
				'button',
				{
					type: 'button',
					style: {
						width: '26px',
						height: '26px',
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						border: 'none',
						borderRadius: crispOr(lib, lib.radius.sm),
						background: lib.surfaceAlt,
						color: lib.text,
						fontFamily: lib.font,
						fontWeight: 700,
						fontSize,
						cursor: 'pointer',
						padding: '0',
						flexShrink: 0
					}
				},
				label
			);

		const widthSegment = (key, barWidth) =>
			el(
				'button',
				{
					type: 'button',
					style: {
						width: '26px',
						height: '22px',
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						border: 'none',
						padding: '0',
						cursor: 'pointer',
						borderRadius: crispOr(lib, lib.radius.xs),
						background: ifEq('lineWidth', key, lib.surface, 'transparent'),
						boxShadow: ifEq('lineWidth', key, lib.shadow.sm, 'none')
					}
				},
				el('span', {
					style: {
						width: barWidth,
						height: '3px',
						borderRadius: '999px',
						background: ifEq('lineWidth', key, accentSolid(lib), lib.faint)
					}
				})
			);

		const themeDot = (key, background, borderColor) =>
			el('button', {
				type: 'button',
				style: {
					width: '18px',
					height: '18px',
					borderRadius: '999px',
					background,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor,
					cursor: 'pointer',
					padding: '0',
					flexShrink: 0,
					boxShadow: ifEq('theme', key, `0 0 0 2px ${lib.surface}, 0 0 0 4px ${accentSolid(lib)}`, 'none')
				}
			});

		const groupDivider = () => el('div', { style: { width: '1px', height: '22px', background: lib.borderSoft, flexShrink: 0 } });

		const reader = define({
			slug: `${lib.id}-news-reading-reader`,
			name: 'Reader Controls',
			library: lib.id,
			category: 'content',
			description: `Reader controls bar in the ${lib.label} style — A− and A+ steppers around a mono px readout, line-width segments, light/sepia/dark theme dots with an ${lib.id === 'reactflow' ? 'accent-pink' : lib.id === 'thingtime' ? 'ink' : 'accent'} ring on the active one, and a ${lib.id === 'thingtime' ? 'rainbow ' : ''}percent-read progress sliver.`,
			tags: ['news', 'reader', 'typography', 'controls', 'progress'],
			args: [
				numberArg('size', 18, { label: 'Font size (px)', min: 12, max: 28 }),
				enumArg('lineWidth', ['narrow', 'normal', 'wide'], 'normal', { label: 'Line width' }),
				enumArg('theme', ['light', 'sepia', 'dark'], 'light', { label: 'Theme' }),
				numberArg('percent', 42, { label: 'Percent read', min: 0, max: 100 })
			],
			render: row(
				{ width: '360px', padding: '10px 12px', gap: '10px', ...card(lib) },
				row(
					{ gap: '6px', flexShrink: 0 },
					stepButton('A−', lib.fontSize.xs),
					text(
						{ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.text, minWidth: '34px', textAlign: 'center' },
						'{size}px'
					),
					stepButton('A+', lib.fontSize.sm)
				),
				groupDivider(),
				row(
					{ gap: '2px', padding: '2px', background: lib.surfaceAlt, borderRadius: crispOr(lib, lib.radius.sm), flexShrink: 0 },
					widthSegment('narrow', '8px'),
					widthSegment('normal', '13px'),
					widthSegment('wide', '18px')
				),
				groupDivider(),
				row(
					{ gap: '7px', flexShrink: 0 },
					themeDot('light', '#ffffff', lib.border),
					themeDot('sepia', '#f0e6d2', '#ddceac'),
					themeDot('dark', '#1f2937', '#1f2937')
				),
				stack(
					{ flex: 1, minWidth: '58px', gap: '4px' },
					text({ fontSize: lib.fontSize.xs, color: lib.muted, whiteSpace: 'nowrap' }, '{percent}% read'),
					el(
						'div',
						{ style: { height: '4px', borderRadius: '999px', background: lib.borderSoft, overflow: 'hidden' } },
						el('div', {
							style: {
								width: '{percent}%',
								height: '100%',
								borderRadius: '999px',
								background: lib.id === 'thingtime' ? lib.rainbow : accentSolid(lib)
							}
						})
					)
				)
			)
		});

		// --- newsletter -----------------------------------------------------
		const subscribeForm = row(
			{ gap: '8px' },
			el('input', {
				type: 'email',
				placeholder: 'you@example.com',
				style: {
					flex: 1,
					minWidth: 0,
					height: '36px',
					boxSizing: 'border-box',
					padding: '0 12px',
					background: lib.surface,
					color: lib.text,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: buttonRadius(lib),
					fontSize: lib.fontSize.sm,
					fontFamily: lib.font,
					outline: 'none'
				}
			}),
			el(
				'button',
				{
					type: 'button',
					style: {
						height: '36px',
						padding: '0 14px',
						border: 'none',
						borderRadius: buttonRadius(lib),
						background: toneMap(lib, (palette) => palette.solid),
						color: toneMap(lib, (palette) => palette.onSolid),
						fontWeight: lib.buttonWeight,
						fontSize: lib.fontSize.sm,
						fontFamily: lib.font,
						cursor: 'pointer',
						flexShrink: 0,
						...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
					}
				},
				'Subscribe'
			)
		);

		const subscribedRow = row(
			{ gap: '10px', padding: '9px 12px', background: lib.palette.success.soft, borderRadius: buttonRadius(lib) },
			el(
				'div',
				{
					style: {
						width: '22px',
						height: '22px',
						borderRadius: '999px',
						background: lib.palette.success.solid,
						color: lib.palette.success.onSolid,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						flexShrink: 0
					}
				},
				icons.check(12, 'currentColor')
			),
			text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.palette.success.onSoft }, 'You’re in — check your inbox.')
		);

		const newsletter = define({
			slug: `${lib.id}-news-reading-newsletter`,
			name: 'Newsletter Block',
			library: lib.id,
			category: 'content',
			description: `Inline newsletter block in the ${lib.label} style — serif title with a cadence caption, an email field mock beside a ${lib.uppercaseButtons ? 'uppercase ' : ''}tone Subscribe button that flips to a check and a you-are-in row once subscribed, over subscriber-count and no-spam captions.`,
			tags: ['news', 'newsletter', 'subscribe', 'email'],
			args: [
				stringArg('title', 'The Morning Brief', { label: 'Title', maxLength: 48 }),
				stringArg('cadence', 'Every weekday at 7am', { label: 'Cadence', maxLength: 48 }),
				stringArg('subscribers', '84,000 readers', { label: 'Subscriber count', maxLength: 32 }),
				toneArg(),
				booleanArg('subscribed', false, { label: 'Subscribed' })
			],
			render: stack(
				{ width: '320px', padding: '16px', gap: '10px', ...card(lib) },
				stack(
					{ gap: '2px' },
					text({ fontFamily: SERIF, fontSize: lib.fontSize.lg, fontWeight: 700, color: lib.text }, '{title}'),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{cadence}')
				),
				iff('subscribed', subscribedRow, subscribeForm),
				row(
					{ gap: '6px' },
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.muted }, '{subscribers}'),
					text({ fontSize: lib.fontSize.xs, color: lib.faint }, '· No spam, unsubscribe anytime')
				)
			)
		});

		// --- live-blog ------------------------------------------------------
		const liveChip = row(
			{
				display: 'inline-flex',
				gap: '6px',
				padding: '3px 9px',
				borderRadius: chipRadius(lib),
				background: toneMap(lib, (palette) => palette.soft),
				color: toneMap(lib, (palette) => palette.onSoft),
				flexShrink: 0
			},
			el('span', {
				style: {
					width: '7px',
					height: '7px',
					borderRadius: '999px',
					background: toneMap(lib, (palette) => palette.solid),
					boxShadow: toneMap(lib, (palette) => `0 0 0 3px ${palette.border}`)
				}
			}),
			text({ fontSize: lib.fontSize.xs, fontWeight: 800, letterSpacing: '0.08em' }, 'LIVE')
		);

		const oldPip = () =>
			el('span', {
				style: {
					width: '5px',
					height: '5px',
					borderRadius: '999px',
					borderWidth: '2px',
					borderStyle: 'solid',
					borderColor: lib.faint,
					background: lib.surface,
					flexShrink: 0
				}
			});

		const railColumn = (pip, last) =>
			stack(
				{ alignItems: 'center', width: '11px', flexShrink: 0, paddingTop: '5px', gap: '3px' },
				pip,
				last ? null : el('span', { style: { width: '2px', flex: 1, background: lib.borderSoft, borderRadius: '999px' } })
			);

		const olderUpdate = (token, when, last) =>
			row(
				{ gap: '10px', alignItems: 'stretch' },
				railColumn(oldPip(), last),
				stack(
					{ flex: 1, minWidth: 0, gap: '2px', paddingBottom: last ? '0' : '12px' },
					text({ fontSize: lib.fontSize.xs, color: lib.faint }, when),
					text({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.5 }, token)
				)
			);

		const liveBlog = define({
			slug: `${lib.id}-news-reading-live-blog`,
			name: 'Live Blog Feed',
			library: lib.id,
			category: 'content',
			description: `Live blog feed in the ${lib.label} style — a pulsing LIVE chip beside the event title over three time-pipped updates on a rail, the newest wearing a tone tint and a Just-now stamp, with a quiet load-earlier button underneath.`,
			tags: ['news', 'live', 'blog', 'feed', 'updates'],
			args: [
				stringArg('event', 'Election night 2026', { label: 'Event', maxLength: 60 }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'danger'),
				textArg('update1', 'Polls close across the east coast as counting begins.', { label: 'Newest update', maxLength: 140 }),
				textArg('update2', 'First results trickle in from the early counties.', { label: 'Update 2', maxLength: 140 }),
				textArg('update3', 'Turnout is on track to set a modern record.', { label: 'Update 3', maxLength: 140 })
			],
			render: stack(
				{ width: '320px', padding: '14px', gap: '10px', ...card(lib) },
				row(
					{ gap: '10px' },
					liveChip,
					text(
						{
							fontSize: lib.fontSize.lg,
							fontWeight: lib.headingWeight,
							color: lib.text,
							minWidth: 0,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis'
						},
						'{event}'
					)
				),
				stack(
					{},
					row(
						{ gap: '10px', alignItems: 'stretch' },
						railColumn(
							el('span', {
								style: {
									width: '9px',
									height: '9px',
									borderRadius: '999px',
									background: toneMap(lib, (palette) => palette.solid),
									boxShadow: toneMap(lib, (palette) => `0 0 0 3px ${palette.soft}`),
									flexShrink: 0
								}
							}),
							false
						),
						stack(
							{
								flex: 1,
								minWidth: 0,
								gap: '2px',
								padding: '7px 10px',
								marginBottom: '10px',
								background: toneMap(lib, (palette) => palette.soft),
								borderRadius: crispOr(lib, lib.radius.md)
							},
							text(
								{
									fontSize: lib.fontSize.xs,
									fontWeight: 700,
									color: toneMap(lib, (palette) => palette.onSoft),
									textTransform: 'uppercase',
									letterSpacing: '0.04em'
								},
								'Just now'
							),
							text({ fontSize: lib.fontSize.sm, color: lib.text, lineHeight: 1.5 }, '{update1}')
						)
					),
					olderUpdate('{update2}', '18 min ago', false),
					olderUpdate('{update3}', '42 min ago', true)
				),
				el(
					'button',
					{
						type: 'button',
						style: {
							height: '32px',
							border: 'none',
							background: 'transparent',
							color: linkColor(lib),
							fontWeight: 600,
							fontSize: lib.fontSize.sm,
							fontFamily: lib.font,
							cursor: 'pointer',
							borderRadius: buttonRadius(lib),
							...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
						}
					},
					'Load earlier updates'
				)
			)
		});

		return [headline, articleCard, reader, newsletter, liveBlog];
	}
};
