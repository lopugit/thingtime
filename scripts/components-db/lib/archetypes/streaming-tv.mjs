// Streaming-TV archetype — streaming catalog surfaces (catalog/browse UX; the
// media-player archetype owns playback chrome): a 2:3 show poster card, a
// continue-watching tile, an episode list, an audio & subtitles panel, and a
// watch-party card. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-streaming-tv-<variant>`.

import {
	avatarCircle,
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
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// reactflow's hot pink and thingtime's ink are each library's signature accent.
const accent = (lib) => lib.accent || (lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid);

// Progress fills: thingtime winks rainbow, reactflow flashes its accent,
// everyone else wears streaming-service red.
const progressFill = (lib) => (lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.accent : lib.palette.danger.solid);

const cardBase = (lib, width) => ({
	width,
	boxSizing: 'border-box',
	fontFamily: lib.font,
	background: lib.surface,
	borderRadius: lib.radius.lg,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	overflow: 'hidden'
});

// Solid play triangle (svg polygon — no defs/gradients allowed).
const playGlyph = (size, color) =>
	el(
		'svg',
		{ width: size, height: size, viewBox: '0 0 24 24', fill: color, xmlns: 'http://www.w3.org/2000/svg' },
		el('polygon', { points: '8 5 19 12 8 19' })
	);

const ghostBtn = (lib, color, padding, ...children) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				gap: '6px',
				border: 'none',
				background: 'transparent',
				cursor: 'pointer',
				padding,
				borderRadius: lib.radius.sm,
				fontFamily: lib.font,
				fontWeight: lib.buttonWeight,
				fontSize: lib.fontSize.sm,
				color,
				...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
			}
		},
		...children
	);

const groupLabel = (lib, label) =>
	text(
		{
			fontSize: lib.fontSize.xs,
			fontWeight: 600,
			letterSpacing: '0.06em',
			textTransform: 'uppercase',
			color: lib.muted
		},
		label
	);

// One-element radio: a thick tone border reads as the filled dot.
const radioRow = (lib, label, selected) =>
	row(
		{ gap: '8px' },
		el('div', {
			style: {
				width: '14px',
				height: '14px',
				borderRadius: '999px',
				boxSizing: 'border-box',
				flexShrink: 0,
				borderWidth: selected ? '4px' : '1.5px',
				borderStyle: 'solid',
				borderColor: selected ? toneMap(lib, (palette) => palette.solid) : lib.border,
				background: lib.surface
			}
		}),
		text(
			{ fontSize: lib.fontSize.sm, color: selected ? lib.text : lib.muted, fontWeight: selected ? 600 : 400 },
			label
		)
	);

export const archetype = {
	id: 'streaming-tv',
	category: 'entertainment',
	variants: ['poster', 'continue', 'episodes', 'audio-subs', 'watch-party'],
	build(lib) {
		const poster = define({
			slug: `${lib.id}-streaming-tv-poster`,
			name: 'Show Poster Card',
			library: lib.id,
			category: 'entertainment',
			description: `Streaming catalog show card in the ${lib.label} style — a 2:3 tone-washed poster band with play glyph and optional Top 10 rank chip, title with genre and year caption, a match-score line, and a My List ghost action.`,
			tags: ['streaming', 'poster', 'show', 'card', 'catalog'],
			args: [
				stringArg('title', 'Neon Horizon', { label: 'Title', maxLength: 40 }),
				numberArg('match', 97, { label: 'Match %', min: 0, max: 100 }),
				toneArg(),
				booleanArg('topTen', true, { label: 'Top 10 chip' })
			],
			render: stack(
				cardBase(lib, '200px'),
				el(
					'div',
					{
						style: {
							position: 'relative',
							aspectRatio: '2 / 3',
							background: toneMap(lib, (palette) => palette.soft),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center'
						}
					},
					el(
						'div',
						{
							style: {
								width: '44px',
								height: '44px',
								borderRadius: '999px',
								borderWidth: '2px',
								borderStyle: 'solid',
								borderColor: toneMap(lib, (palette) => palette.onSoft),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center'
							}
						},
						playGlyph(16, toneMap(lib, (palette) => palette.onSoft))
					),
					iff(
						'topTen',
						el(
							'span',
							{
								style: {
									position: 'absolute',
									top: '8px',
									right: '8px',
									padding: '2px 6px',
									borderRadius: lib.radius.xs,
									background: lib.id === 'thingtime' ? lib.rainbow : lib.palette.danger.solid,
									color: lib.id === 'thingtime' ? lib.ink : lib.palette.danger.onSolid,
									fontSize: lib.fontSize.xs,
									fontWeight: 700,
									letterSpacing: '0.04em'
								}
							},
							'TOP 10'
						)
					)
				),
				stack(
					{ padding: '12px', gap: '4px', alignItems: 'flex-start' },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Sci-fi · 2026 · 3 seasons'),
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.palette.success.solid }, '{match}% match'),
					ghostBtn(lib, accent(lib), '6px 0', icons.plus(14, 'currentColor'), 'My List')
				)
			)
		});

		const cont = define({
			slug: `${lib.id}-streaming-tv-continue`,
			name: 'Continue Watching Tile',
			library: lib.id,
			category: 'entertainment',
			description: `Continue-watching tile in the ${lib.label} style — a 16:9 still with a centered play circle, a resume progress bar hugging the band's bottom edge, episode caption with time left, and an options kebab.`,
			tags: ['streaming', 'continue', 'progress', 'resume', 'tile'],
			args: [
				stringArg('title', 'The Long Static', { label: 'Title', maxLength: 40 }),
				numberArg('percent', 64, { label: 'Watched %', min: 0, max: 100 }),
				numberArg('s', 2, { label: 'Season', min: 1 }),
				numberArg('e', 5, { label: 'Episode', min: 1 }),
				stringArg('left', '23m', { label: 'Time left', maxLength: 10 })
			],
			render: stack(
				cardBase(lib, '260px'),
				el(
					'div',
					{
						style: {
							position: 'relative',
							aspectRatio: '16 / 9',
							background: lib.palette.neutral.solid,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center'
						}
					},
					el(
						'div',
						{
							style: {
								width: '40px',
								height: '40px',
								borderRadius: '999px',
								background: lib.surface,
								boxShadow: lib.shadow.md,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center'
							}
						},
						playGlyph(16, lib.text)
					),
					el(
						'div',
						{ style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '4px', background: lib.faint } },
						el('div', { style: { height: '100%', width: '{percent}%', background: progressFill(lib) } })
					)
				),
				row(
					{ padding: '10px 12px', gap: '10px' },
					stack(
						{ flex: 1, gap: '2px', minWidth: 0 },
						text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'S{s}:E{e} · {left} left')
					),
					el(
						'span',
						{ style: { display: 'inline-flex', transform: 'rotate(90deg)', flexShrink: 0 } },
						icons.dots(16, lib.muted)
					)
				)
			)
		});

		const currentRowStyle = {
			background: lib.id === 'thingtime' ? lib.surfaceAlt : lib.palette.primary.soft,
			boxShadow: `inset 3px 0 0 ${accent(lib)}`
		};
		const watchedRowStyle = { opacity: 0.55 };
		const epRowBase = {
			display: 'flex',
			alignItems: 'center',
			gap: '10px',
			padding: '10px 12px',
			borderTopWidth: '1px',
			borderTopStyle: 'solid',
			borderTopColor: lib.borderSoft
		};
		const epNumber = (n) => text({ width: '14px', fontSize: lib.fontSize.sm, color: lib.faint, fontWeight: 600, flexShrink: 0 }, n);
		const epThumb = el(
			'div',
			{
				style: {
					width: '56px',
					height: '32px',
					borderRadius: lib.radius.xs,
					background: lib.surfaceAlt,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					flexShrink: 0
				}
			},
			playGlyph(12, lib.muted)
		);
		const epTitle = (title, synopsis) =>
			stack(
				{ flex: 1, gap: '2px', minWidth: 0 },
				text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, title),
				text({ fontSize: lib.fontSize.xs, color: lib.muted }, synopsis)
			);
		const epDuration = (v) => text({ fontSize: lib.fontSize.xs, color: lib.muted, flexShrink: 0 }, v);
		const epCheck = icons.check(14, lib.palette.success.solid);

		const episodes = define({
			slug: `${lib.id}-streaming-tv-episodes`,
			name: 'Episode List',
			library: lib.id,
			category: 'entertainment',
			description: `Season episode list in the ${lib.label} style — a mock season selector header over three episode rows with number, thumb tile, synopsis snippet, and duration; watched rows sit check-dimmed while the current episode carries the highlight.`,
			tags: ['streaming', 'episodes', 'season', 'list'],
			args: [
				stringArg('ep1', 'First Light', { label: 'Episode 1 title', maxLength: 40 }),
				enumArg('current', ['1', '2', '3'], '2', { label: 'Current episode' }),
				stringArg('season', '1', { label: 'Season', maxLength: 3 })
			],
			render: stack(
				cardBase(lib, '300px'),
				row(
					{ padding: '12px', justifyContent: 'space-between' },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, 'Episodes'),
					row(
						{
							gap: '6px',
							padding: '4px 10px',
							borderRadius: lib.radius.sm,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							fontSize: lib.fontSize.sm,
							color: lib.text,
							cursor: 'pointer'
						},
						'Season {season}',
						icons.chevronDown(14, lib.muted)
					)
				),
				el(
					'div',
					{ style: merge(epRowBase, map('current', { 1: currentRowStyle }, watchedRowStyle)) },
					epNumber('1'),
					epThumb,
					epTitle('{ep1}', 'The crew intercepts a signal.'),
					map('current', { 1: epDuration('52m') }, epCheck)
				),
				el(
					'div',
					{ style: merge(epRowBase, map('current', { 2: currentRowStyle, 3: watchedRowStyle }, {})) },
					epNumber('2'),
					epThumb,
					epTitle('Static Fields', 'Ora crosses the blockade.'),
					map('current', { 3: epCheck }, epDuration('48m'))
				),
				el(
					'div',
					{ style: merge(epRowBase, map('current', { 3: currentRowStyle }, {})) },
					epNumber('3'),
					epThumb,
					epTitle('The Silent Coast', 'Nothing is what it seems.'),
					epDuration('55m')
				)
			)
		});

		const audioSubs = define({
			slug: `${lib.id}-streaming-tv-audio-subs`,
			name: 'Audio & Subtitles Panel',
			library: lib.id,
			category: 'entertainment',
			description: `Audio and subtitles picker in the ${lib.label} style — two column groups of language radio rows with one selection each, an optional CC chip in the header, and a quiet settings caption underneath.`,
			tags: ['streaming', 'subtitles', 'audio', 'language', 'panel'],
			args: [
				stringArg('audio', 'English (5.1)', { label: 'Selected audio', maxLength: 24 }),
				stringArg('lang', 'English (CC)', { label: 'Selected subtitle', maxLength: 24 }),
				toneArg(),
				booleanArg('cc', true, { label: 'CC chip' })
			],
			render: stack(
				cardBase(lib, '320px'),
				row(
					{ padding: '12px 14px', gap: '8px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: lib.borderSoft },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text, flex: 1 }, 'Audio & Subtitles'),
					iff(
						'cc',
						el(
							'span',
							{
								style: {
									padding: '1px 5px',
									borderRadius: lib.radius.xs,
									borderWidth: '1.5px',
									borderStyle: 'solid',
									borderColor: lib.text,
									color: lib.text,
									fontSize: lib.fontSize.xs,
									fontWeight: 700,
									lineHeight: 1.3
								}
							},
							'CC'
						)
					)
				),
				row(
					{ padding: '12px 14px', gap: '16px', alignItems: 'flex-start' },
					stack(
						{ flex: 1, gap: '10px' },
						groupLabel(lib, 'Audio'),
						radioRow(lib, '{audio}', true),
						radioRow(lib, 'Japanese', false),
						radioRow(lib, 'French', false)
					),
					stack(
						{ flex: 1, gap: '10px' },
						groupLabel(lib, 'Subtitles'),
						radioRow(lib, 'Off', false),
						radioRow(lib, '{lang}', true),
						radioRow(lib, 'Spanish', false)
					)
				),
				row(
					{ padding: '10px 14px', gap: '6px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft },
					icons.settings(12, lib.faint),
					text({ fontSize: lib.fontSize.xs, color: lib.faint }, 'Applies to every title on this profile')
				)
			)
		});

		const partyAvatar = (label, palette, extra) =>
			avatarCircle('28px', palette.solid, palette.onSolid, label, lib.fontSize.xs, {
				borderWidth: '2px',
				borderStyle: 'solid',
				borderColor: lib.surface,
				boxSizing: 'content-box',
				...extra
			});

		const watchParty = define({
			slug: `${lib.id}-streaming-tv-watch-party`,
			name: 'Watch Party Card',
			library: lib.id,
			category: 'entertainment',
			description: `Watch party card in the ${lib.label} style — stacked viewer avatars with a watching count, a synced-position caption over a thin progress bar, a chat teaser bubble, and Invite plus Leave ghost actions.`,
			tags: ['streaming', 'watch-party', 'social', 'sync', 'card'],
			args: [
				numberArg('count', 8, { label: 'Watching count', min: 1 }),
				stringArg('position', '42:17', { label: 'Synced position', maxLength: 10 }),
				numberArg('percent', 62, { label: 'Progress %', min: 0, max: 100 }),
				stringArg('message', 'That reveal was wild', { label: 'Chat teaser', maxLength: 60 })
			],
			render: stack(
				{ ...cardBase(lib, '280px'), padding: '14px', gap: '12px', overflow: 'visible' },
				row(
					{ gap: '10px' },
					row(
						{},
						partyAvatar('NK', lib.palette.primary, {}),
						partyAvatar('JD', lib.palette.info, { marginLeft: '-8px' }),
						partyAvatar('AR', lib.palette.warning, { marginLeft: '-8px' })
					),
					text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '{count} watching')
				),
				stack(
					{ gap: '6px' },
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Synced · {position}'),
					el(
						'div',
						{ style: { height: '4px', borderRadius: lib.radius.pill, background: lib.borderSoft, overflow: 'hidden' } },
						el('div', { style: { height: '100%', width: '{percent}%', background: progressFill(lib) } })
					)
				),
				row(
					{ gap: '8px', alignItems: 'flex-start' },
					avatarCircle('22px', lib.palette.info.solid, lib.palette.info.onSolid, 'JD', lib.fontSize.xs),
					el(
						'div',
						{
							style: {
								background: lib.surfaceAlt,
								borderRadius: lib.radius.md,
								borderTopLeftRadius: lib.radius.xs,
								padding: '6px 10px',
								fontSize: lib.fontSize.xs,
								color: lib.text
							}
						},
						'{message}'
					)
				),
				row(
					{ gap: '8px', justifyContent: 'space-between' },
					ghostBtn(lib, accent(lib), '6px 10px', icons.plus(14, 'currentColor'), 'Invite'),
					ghostBtn(lib, lib.palette.danger.solid, '6px 10px', 'Leave')
				)
			)
		});

		return [poster, cont, episodes, audioSubs, watchParty];
	}
};
