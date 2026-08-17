// Social-feed archetype — feed mechanics in five renditions: a feed post card,
// a stories row, a poll card, a share sheet, and a comment thread. (The
// profile-social archetype owns identity; chat owns messaging.) Follows the
// button.mjs exemplar: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs `${lib.id}-social-feed-<variant>`.

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
	row,
	stack,
	stringArg,
	text,
	textArg
} from '../helpers.mjs';

// --- library personality accents --------------------------------------------

// Solid accent for follow chips / plus badges: React Flow flashes its pink
// accent, Thingtime stays ink-on-white, everyone else uses their primary.
const accentSolid = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid);

// Link/emphasis color for "view more" style text.
const linkColor = (lib) =>
	lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.primary.solid;

// A filled heart reads pink in Thingtime, accent-pink in React Flow, red elsewhere.
const heartColor = (lib) =>
	lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.danger.solid;

// React Flow chrome stays crisp where others go round.
const crispOr = (lib, radius) => (lib.id === 'reactflow' ? lib.radius.sm : radius);

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

const userAvatar = (lib, size, iconSize) =>
	avatarCircle(size, lib.palette.neutral.soft, lib.palette.neutral.onSoft, icons.user(iconSize, 'currentColor'), lib.fontSize.sm);

// --- svg glyphs the shared icon set lacks (allowlisted primitives only) -----

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

const HEART_PATH =
	'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';

const commentGlyph = (size, color) =>
	glyph(
		size,
		color,
		el('path', {
			d: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z'
		})
	);

const sendGlyph = (size, color) =>
	glyph(size, color, el('line', { x1: 22, y1: 2, x2: 11, y2: 13 }), el('polygon', { points: '22 2 15 22 11 13 2 9 22 2' }));

const bookmarkGlyph = (size, color) => glyph(size, color, el('path', { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }));

const linkGlyph = (size, color) =>
	glyph(
		size,
		color,
		el('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
		el('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' })
	);

const cameraGlyph = (size, color) =>
	glyph(
		size,
		color,
		el('path', { d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }),
		el('circle', { cx: 12, cy: 13, r: 4 })
	);

const globeGlyph = (size, color) =>
	glyph(
		size,
		color,
		el('circle', { cx: 12, cy: 12, r: 10 }),
		el('line', { x1: 2, y1: 12, x2: 22, y2: 12 }),
		el('path', { d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' })
	);

export const archetype = {
	id: 'social-feed',
	category: 'social',
	variants: ['post', 'stories', 'poll', 'share-sheet', 'comments'],
	build(lib) {
		// --- post -----------------------------------------------------------
		const actionGroup = (icon, count, countStyle) =>
			row({ gap: '6px' }, icon, count === null ? null : text({ fontSize: lib.fontSize.sm, fontWeight: 600, ...countStyle }, count));

		const post = define({
			slug: `${lib.id}-social-feed-post`,
			name: 'Feed Post Card',
			library: lib.id,
			category: 'social',
			description: `Feed post card in the ${lib.label} style — avatar header with a follow chip, post text, an optional tone-soft media band, and a like/comment/share/bookmark bar where liking fills the heart${lib.id === 'thingtime' ? ' pink' : ''}.`,
			tags: ['social', 'feed', 'post', 'card', 'like'],
			args: [
				stringArg('name', 'Mira Chen', { label: 'Name', maxLength: 40 }),
				stringArg('handle', '@mira · 2h', { label: 'Handle · time', maxLength: 40 }),
				textArg('text', 'Shipped the new components library today — 1,000 little building blocks and counting.', {
					label: 'Post text',
					maxLength: 240
				}),
				stringArg('likes', '1.2k', { label: 'Like count', maxLength: 8 }),
				booleanArg('liked', true, { label: 'Liked' }),
				booleanArg('media', true, { label: 'Show media' })
			],
			render: stack(
				{ width: '320px', padding: '14px', gap: '10px', ...card(lib) },
				row(
					{ gap: '10px' },
					userAvatar(lib, '40px', 18),
					stack(
						{ flex: 1, minWidth: 0, gap: '1px' },
						text(
							{
								fontSize: lib.fontSize.sm,
								fontWeight: lib.headingWeight,
								color: lib.text,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis'
							},
							'{name}'
						),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{handle}')
					),
					el(
						'span',
						{
							style: {
								alignSelf: 'center',
								flexShrink: 0,
								background: accentSolid(lib),
								color: lib.palette.primary.onSolid,
								fontSize: lib.fontSize.xs,
								fontWeight: 700,
								padding: '3px 10px',
								borderRadius: crispOr(lib, lib.radius.pill),
								...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
							}
						},
						'Follow'
					)
				),
				text({ fontSize: lib.fontSize.sm, color: lib.text, lineHeight: 1.5 }, '{text}'),
				iff(
					'media',
					el(
						'div',
						{
							style: {
								height: '130px',
								borderRadius: crispOr(lib, lib.radius.md),
								background: lib.palette.info.soft,
								color: lib.palette.info.onSoft,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center'
							}
						},
						icons.image(28, 'currentColor')
					)
				),
				row(
					{ justifyContent: 'space-between', color: lib.muted },
					row(
						{ gap: '16px' },
						actionGroup(
							el(
								'svg',
								{
									width: 17,
									height: 17,
									viewBox: '0 0 24 24',
									fill: iff('liked', heartColor(lib), 'none'),
									stroke: iff('liked', heartColor(lib), lib.muted),
									strokeWidth: 2,
									strokeLinecap: 'round',
									strokeLinejoin: 'round',
									xmlns: 'http://www.w3.org/2000/svg'
								},
								el('path', { d: HEART_PATH })
							),
							'{likes}',
							{ color: iff('liked', heartColor(lib), lib.muted) }
						),
						actionGroup(commentGlyph(16, lib.muted), '48', { color: lib.muted }),
						actionGroup(sendGlyph(16, lib.muted), null)
					),
					bookmarkGlyph(16, lib.muted)
				)
			)
		});

		// --- stories --------------------------------------------------------
		const ringPad = lib.id === 'daisyui' ? '4px' : '3px'; // daisyUI wears the chunky ring
		const unseenRing = lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid;
		const seenRing = lib.border;

		const storyRing = (background, avatar) =>
			el(
				'div',
				{ style: { padding: ringPad, borderRadius: '999px', background } },
				el('div', { style: { padding: '2px', borderRadius: '999px', background: lib.surface, display: 'flex' } }, avatar)
			);

		const storyCaption = (color, label) =>
			text(
				{
					fontSize: lib.fontSize.xs,
					color,
					maxWidth: '56px',
					whiteSpace: 'nowrap',
					overflow: 'hidden',
					textOverflow: 'ellipsis'
				},
				label
			);

		// Friend i (1-based) shows the faint seen ring once `unseen` drops below i.
		const friendStory = (index, nameToken) => {
			const seenKeys = {};
			for (let k = 0; k < index; k++) seenKeys[String(k)] = seenRing;
			return stack(
				{ alignItems: 'center', gap: '6px' },
				storyRing(map('unseen', seenKeys, unseenRing), userAvatar(lib, '44px', 20)),
				storyCaption(lib.text, nameToken)
			);
		};

		const stories = define({
			slug: `${lib.id}-social-feed-stories`,
			name: 'Stories Row',
			library: lib.id,
			category: 'social',
			description: `Stories row in the ${lib.label} style — a Your-story avatar with a plus badge beside four friends whose rings flip from ${lib.id === 'thingtime' ? 'rainbow-ringed' : 'tone-ringed'} unseen to faint seen as the unseen count changes.`,
			tags: ['social', 'stories', 'avatar', 'ring'],
			args: [
				stringArg('name1', 'Mira', { label: 'Friend 1', maxLength: 16 }),
				stringArg('name2', 'Kai', { label: 'Friend 2', maxLength: 16 }),
				stringArg('name3', 'Sana', { label: 'Friend 3', maxLength: 16 }),
				stringArg('name4', 'Theo', { label: 'Friend 4', maxLength: 16 }),
				enumArg('unseen', ['0', '1', '2', '3', '4'], '2', { label: 'Unseen stories' })
			],
			render: row(
				{ gap: '14px', alignItems: 'flex-start', fontFamily: lib.font },
				stack(
					{ alignItems: 'center', gap: '6px' },
					el(
						'div',
						{ style: { position: 'relative' } },
						storyRing(seenRing, userAvatar(lib, '44px', 20)),
						el(
							'div',
							{
								style: {
									position: 'absolute',
									right: '0',
									bottom: '0',
									width: '18px',
									height: '18px',
									borderRadius: '999px',
									background: accentSolid(lib),
									color: lib.palette.primary.onSolid,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									boxShadow: `0 0 0 2px ${lib.surface}`
								}
							},
							icons.plus(10, 'currentColor')
						)
					),
					storyCaption(lib.muted, 'Your story')
				),
				friendStory(1, '{name1}'),
				friendStory(2, '{name2}'),
				friendStory(3, '{name3}'),
				friendStory(4, '{name4}')
			)
		});

		// --- poll -----------------------------------------------------------
		const leadFill = lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.palette.danger.soft : lib.palette.primary.border;
		const leadText = lib.id === 'thingtime' ? lib.ink : lib.id === 'reactflow' ? lib.accent : lib.palette.primary.onSoft;

		const pollOption = ({ label, width, pct, lead }) =>
			el(
				'div',
				{
					style: {
						position: 'relative',
						height: '36px',
						borderRadius: crispOr(lib, lib.radius.md),
						overflow: 'hidden',
						background: lib.surface,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft
					}
				},
				el('div', {
					style: {
						position: 'absolute',
						left: '0',
						top: '0',
						bottom: '0',
						width,
						background: lead ? leadFill : lib.palette.primary.soft
					}
				}),
				row(
					{ position: 'relative', height: '100%', padding: '0 12px', justifyContent: 'space-between', gap: '8px' },
					row(
						{ gap: '6px', minWidth: 0 },
						text(
							{
								fontSize: lib.fontSize.sm,
								fontWeight: lead ? 600 : 500,
								color: lead ? leadText : lib.text,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis'
							},
							label
						),
						lead ? icons.check(14, leadText) : null
					),
					text({ fontSize: lib.fontSize.sm, fontWeight: lead ? 700 : 500, color: lead ? leadText : lib.muted, flexShrink: 0 }, pct)
				)
			);

		const pct2 = map('pct1', { 40: '35%', 50: '30%', 60: '25%', 70: '20%', 80: '15%' }, '25%');
		const pct3 = map('pct1', { 40: '25%', 50: '20%', 60: '15%', 70: '10%', 80: '5%' }, '15%');

		const poll = define({
			slug: `${lib.id}-social-feed-poll`,
			name: 'Poll Card',
			library: lib.id,
			category: 'social',
			description: `Poll card in the ${lib.label} style — a question over three percent-width result bars, the leading option ${lib.id === 'thingtime' ? 'wearing the rainbow fill' : 'solid-tinted'} with a check, plus a votes and time-left caption.`,
			tags: ['social', 'poll', 'vote', 'results'],
			args: [
				stringArg('question', 'Which logo should we ship?', { label: 'Question', maxLength: 80 }),
				stringArg('opt1', 'Gradient mark', { label: 'Leading option', maxLength: 32 }),
				stringArg('opt2', 'Monoline', { label: 'Option 2', maxLength: 32 }),
				stringArg('opt3', 'Wordmark only', { label: 'Option 3', maxLength: 32 }),
				enumArg('pct1', ['40', '50', '60', '70', '80'], '60', { label: 'Leading %' }),
				stringArg('meta', '12,408 votes · Ends in 5h', { label: 'Caption', maxLength: 48 })
			],
			render: stack(
				{ width: '300px', padding: '14px', gap: '9px', ...card(lib) },
				text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{question}'),
				pollOption({ label: '{opt1}', width: '{pct1}%', pct: '{pct1}%', lead: true }),
				pollOption({ label: '{opt2}', width: pct2, pct: pct2, lead: false }),
				pollOption({ label: '{opt3}', width: pct3, pct: pct3, lead: false }),
				text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{meta}')
			)
		});

		// --- share-sheet ----------------------------------------------------
		const tile = (icon, label, palette) =>
			stack(
				{ alignItems: 'center', gap: '6px', minWidth: 0 },
				el(
					'div',
					{
						style: {
							width: '46px',
							height: '46px',
							borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.id === 'daisyui' ? lib.radius.lg : '999px',
							background: palette.soft,
							color: palette.onSoft,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center'
						}
					},
					icon
				),
				text({ fontSize: lib.fontSize.xs, color: lib.muted, textAlign: 'center' }, label)
			);

		const shareSheet = define({
			slug: `${lib.id}-social-feed-share-sheet`,
			name: 'Share Sheet',
			library: lib.id,
			category: 'social',
			description: `Share sheet in the ${lib.label} style — grab handle, Share-to caption, a two-by-four grid of tinted destination tiles from copy-link to mail, and a ${lib.uppercaseButtons ? 'uppercase ' : ''}cancel bar.`,
			tags: ['social', 'share', 'sheet', 'grid'],
			args: [
				stringArg('title', 'Share to', { label: 'Title', maxLength: 32 }),
				stringArg('cancel', 'Cancel', { label: 'Cancel label', maxLength: 20 }),
				booleanArg('showHandle', true, { label: 'Grab handle' })
			],
			render: stack(
				{ width: '300px', padding: '10px 14px 14px', gap: '12px', ...card(lib, { boxShadow: lib.shadow.lg }) },
				iff(
					'showHandle',
					el('div', {
						style: { width: '36px', height: '4px', borderRadius: '999px', background: lib.border, alignSelf: 'center' }
					})
				),
				text(
					{
						fontSize: lib.fontSize.sm,
						fontWeight: lib.headingWeight,
						color: lib.text,
						...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
					},
					'{title}'
				),
				el(
					'div',
					{ style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' } },
					tile(linkGlyph(18, 'currentColor'), 'Copy link', lib.palette.neutral),
					tile(commentGlyph(18, 'currentColor'), 'Message', lib.palette.success),
					tile(icons.mail(18, 'currentColor'), 'Mail', lib.palette.info),
					tile(cameraGlyph(18, 'currentColor'), 'Story', lib.palette.danger),
					tile(icons.zap(18, 'currentColor'), 'Thingtime', lib.palette.primary),
					tile(globeGlyph(18, 'currentColor'), 'Web', lib.palette.warning),
					tile(bookmarkGlyph(18, 'currentColor'), 'Save', lib.palette.neutral),
					tile(icons.dots(18, 'currentColor'), 'More', lib.palette.neutral)
				),
				el(
					'button',
					{
						type: 'button',
						style: {
							height: lib.control.md,
							border: 'none',
							borderRadius: crispOr(lib, lib.radius.md),
							background: lib.surfaceAlt,
							color: lib.text,
							fontWeight: lib.buttonWeight,
							fontSize: lib.fontSize.md,
							fontFamily: lib.font,
							cursor: 'pointer',
							...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
						}
					},
					'{cancel}'
				)
			)
		});

		// --- comments -------------------------------------------------------
		const nameRow = (nameToken, when) =>
			row(
				{ gap: '6px', alignItems: 'baseline' },
				text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, nameToken),
				text({ fontSize: lib.fontSize.xs, color: lib.faint }, when)
			);

		const comments = define({
			slug: `${lib.id}-social-feed-comments`,
			name: 'Comment Thread',
			library: lib.id,
			category: 'social',
			description: `Comment thread in the ${lib.label} style — a parent comment with like and reply actions, one thread-railed nested reply, a view-more-replies link, and a composer mock at the bottom.`,
			tags: ['social', 'comments', 'thread', 'reply'],
			args: [
				stringArg('name', 'Mira Chen', { label: 'Name', maxLength: 40 }),
				textArg('comment', 'This is exactly the kind of update I needed today — the stories row is my favourite.', {
					label: 'Comment',
					maxLength: 200
				}),
				stringArg('replyName', 'Kai', { label: 'Reply name', maxLength: 40 }),
				stringArg('reply', 'Couldn’t agree more!', { label: 'Reply', maxLength: 120 }),
				numberArg('more', 12, { label: 'More replies' }),
				stringArg('placeholder', 'Add a comment…', { label: 'Composer placeholder', maxLength: 40 })
			],
			render: stack(
				{ width: '320px', padding: '14px', gap: '10px', ...card(lib) },
				row(
					{ gap: '10px', alignItems: 'flex-start' },
					userAvatar(lib, '32px', 15),
					stack(
						{ flex: 1, minWidth: 0, gap: '4px' },
						nameRow('{name}', '2h'),
						text({ fontSize: lib.fontSize.sm, color: lib.text, lineHeight: 1.5 }, '{comment}'),
						row(
							{ gap: '14px', color: lib.muted },
							row(
								{ gap: '4px' },
								glyph(13, 'currentColor', el('path', { d: HEART_PATH })),
								text({ fontSize: lib.fontSize.xs, fontWeight: 600 }, '24')
							),
							text({ fontSize: lib.fontSize.xs, fontWeight: 600 }, 'Reply')
						)
					)
				),
				row(
					{ gap: '10px', alignItems: 'flex-start' },
					el('div', {
						style: { width: '2px', alignSelf: 'stretch', marginLeft: '15px', borderRadius: '999px', background: lib.borderSoft, flexShrink: 0 }
					}),
					userAvatar(lib, '24px', 12),
					stack(
						{ flex: 1, minWidth: 0, gap: '2px' },
						nameRow('{replyName}', '1h'),
						text({ fontSize: lib.fontSize.sm, color: lib.text, lineHeight: 1.5 }, '{reply}')
					)
				),
				row(
					{ gap: '8px', marginLeft: '42px' },
					el('div', { style: { width: '22px', height: '1px', background: lib.border } }),
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: linkColor(lib) }, 'View {more} more replies')
				),
				row(
					{ gap: '8px', paddingTop: '8px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft },
					userAvatar(lib, '28px', 13),
					el('input', {
						type: 'text',
						placeholder: '{placeholder}',
						style: {
							flex: 1,
							minWidth: 0,
							height: '34px',
							boxSizing: 'border-box',
							padding: '0 12px',
							background: lib.surfaceAlt,
							color: lib.text,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							borderRadius: crispOr(lib, lib.radius.pill),
							fontSize: lib.fontSize.sm,
							fontFamily: lib.font,
							outline: 'none'
						}
					})
				)
			)
		});

		return [post, stories, poll, shareSheet, comments];
	}
};
