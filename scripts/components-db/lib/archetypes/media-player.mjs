// Media-player archetype — playback chrome in five renditions: full audio
// player card, 16:9 video frame with scrubber, compact now-playing mini bar,
// playlist track stack, and a volume/speed control cluster. Follows the
// button.mjs exemplar: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs
// `${lib.id}-media-player-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	iff,
	ifEq,
	numberArg,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// --- local svg glyphs (filled transport icons + stroked chrome icons) -------

const filledSvg = (size, fill, ...children) =>
	el('svg', { width: size, height: size, viewBox: '0 0 24 24', fill, xmlns: 'http://www.w3.org/2000/svg' }, ...children);

const strokedSvg = (size, ...children) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: 'currentColor',
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		...children
	);

const playTriangle = (size, fill) => filledSvg(size, fill, el('polygon', { points: '8 5 19 12 8 19' }));

const pauseBars = (size, fill) =>
	filledSvg(size, fill, el('rect', { x: 6, y: 5, width: 4, height: 14, rx: 1 }), el('rect', { x: 14, y: 5, width: 4, height: 14, rx: 1 }));

const prevIcon = (size, fill) =>
	filledSvg(size, fill, el('polygon', { points: '19 20 9 12 19 4' }), el('rect', { x: 5, y: 4, width: 2, height: 16, rx: 1 }));

const nextIcon = (size, fill) =>
	filledSvg(size, fill, el('polygon', { points: '5 4 15 12 5 20' }), el('rect', { x: 17, y: 4, width: 2, height: 16, rx: 1 }));

const musicNote = (size) =>
	strokedSvg(size, el('path', { d: 'M9 18V5l12-2v13' }), el('circle', { cx: 6, cy: 18, r: 3 }), el('circle', { cx: 18, cy: 16, r: 3 }));

const speakerIcon = (size) =>
	strokedSvg(
		size,
		el('polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }),
		el('path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }),
		el('path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14' })
	);

// Animated-feel EQ bars marking the currently playing track (static heights).
const eqBars = (size, fill) =>
	filledSvg(
		size,
		fill,
		el('rect', { x: 5, y: 10, width: 3, height: 9, rx: 1 }),
		el('rect', { x: 10.5, y: 5, width: 3, height: 14, rx: 1 }),
		el('rect', { x: 16, y: 12, width: 3, height: 7, rx: 1 })
	);

// --- shared chrome ----------------------------------------------------------

// reactflow flashes its signature pink accent, thingtime winks with its house
// pink, everyone else stays on the library primary.
const accentOf = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.primary.solid);

// Dark video canvas: thingtime uses its ink token, others their darkest text.
const frameInk = (lib) => (lib.id === 'thingtime' ? lib.ink : lib.text);

const cardBase = (lib) => ({
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	fontFamily: lib.font,
	boxSizing: 'border-box'
});

const artworkSquare = (lib, size, radius, glyphSize) =>
	el(
		'div',
		{
			style: {
				width: size,
				height: size,
				borderRadius: radius,
				background: toneMap(lib, (palette) => palette.soft),
				color: toneMap(lib, (palette) => palette.onSoft),
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				flexShrink: 0
			}
		},
		musicNote(glyphSize)
	);

const monoTime = (lib, value) => text({ fontSize: lib.fontSize.xs, color: lib.muted, fontFamily: lib.fontMono }, value);

// Playlist row: index number (or tone-accent EQ bars when current), title,
// duration, with a hover wash driven by the `hovered` arg.
const trackRow = (lib, accent, n, title, duration) =>
	el(
		'div',
		{
			style: {
				display: 'flex',
				alignItems: 'center',
				gap: '10px',
				padding: '7px 10px',
				borderRadius: lib.radius.sm,
				background: ifEq('hovered', String(n), lib.surfaceAlt, 'transparent')
			}
		},
		el(
			'div',
			{
				style: {
					width: '18px',
					display: 'flex',
					justifyContent: 'center',
					color: lib.faint,
					fontSize: lib.fontSize.xs,
					fontFamily: lib.fontMono
				}
			},
			ifEq('current', String(n), eqBars(14, accent), String(n))
		),
		el(
			'span',
			{
				style: {
					flex: 1,
					minWidth: 0,
					fontSize: lib.fontSize.sm,
					fontWeight: 500,
					color: ifEq('current', String(n), accent, lib.text)
				}
			},
			title
		),
		el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted, fontFamily: lib.fontMono } }, duration)
	);

export const archetype = {
	id: 'media-player',
	category: 'media',
	variants: ['audio', 'video', 'mini', 'playlist', 'volume'],
	build(lib) {
		const accent = accentOf(lib);

		const audio = define({
			slug: `${lib.id}-media-player-audio`,
			name: 'Audio Player',
			library: lib.id,
			category: 'media',
			description: `Audio player card in the ${lib.label} style — tinted artwork square with a music glyph, track title and artist, tone progress bar with elapsed/total times, and prev/play/next transport controls.`,
			tags: ['media', 'audio', 'player', 'music'],
			args: [
				stringArg('title', 'Golden Hour', { label: 'Title', maxLength: 40 }),
				stringArg('artist', 'Cassette Club', { label: 'Artist', maxLength: 40 }),
				numberArg('percent', 42, { label: 'Progress %', min: 0, max: 100 }),
				stringArg('elapsed', '1:34', { label: 'Elapsed', maxLength: 8 }),
				stringArg('total', '3:42', { label: 'Total', maxLength: 8 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: { ...cardBase(lib), display: 'flex', flexDirection: 'column', gap: '12px', width: '280px', padding: '14px' } },
				row(
					{ gap: '12px' },
					artworkSquare(lib, '52px', lib.radius.md, 24),
					stack(
						{ gap: '2px', minWidth: 0 },
						text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
						text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{artist}')
					)
				),
				el(
					'div',
					{ style: { height: '5px', borderRadius: lib.radius.pill, background: lib.borderSoft, overflow: 'hidden' } },
					el('div', {
						style: { width: '{percent}%', height: '100%', borderRadius: lib.radius.pill, background: toneMap(lib, (palette) => palette.solid) }
					})
				),
				row({ justifyContent: 'space-between' }, monoTime(lib, '{elapsed}'), monoTime(lib, '{total}')),
				row(
					{ justifyContent: 'center', gap: '18px' },
					prevIcon(18, lib.muted),
					el(
						'div',
						{
							style: {
								width: '44px',
								height: '44px',
								borderRadius: lib.radius.pill,
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								boxShadow: lib.shadow.sm,
								flexShrink: 0
							}
						},
						playTriangle(18, 'currentColor')
					),
					nextIcon(18, lib.muted)
				)
			)
		});

		const video = define({
			slug: `${lib.id}-media-player-video`,
			name: 'Video Player',
			library: lib.id,
			category: 'media',
			description: `Dark 16:9 video frame in the ${lib.label} style — centered translucent play button, bottom scrubber with faint buffered and tone-colored played layers, plus a monospaced time chip.`,
			tags: ['media', 'video', 'player', 'scrubber'],
			args: [
				numberArg('percent', 38, { label: 'Played %', min: 0, max: 100 }),
				numberArg('buffered', 66, { label: 'Buffered %', min: 0, max: 100 }),
				stringArg('time', '2:41 / 7:02', { label: 'Time', maxLength: 16 }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						flexDirection: 'column',
						width: '320px',
						aspectRatio: '16 / 9',
						background: frameInk(lib),
						borderRadius: lib.radius.lg,
						overflow: 'hidden',
						fontFamily: lib.font,
						boxShadow: lib.shadow.md
					}
				},
				el(
					'div',
					{ style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
					el(
						'div',
						{
							style: {
								width: '46px',
								height: '46px',
								borderRadius: lib.radius.pill,
								background: 'rgba(255, 255, 255, 0.22)',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center'
							}
						},
						playTriangle(18, '#ffffff')
					)
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '0 12px 10px' } },
					el(
						'div',
						{ style: { flex: 1, position: 'relative', height: '4px', borderRadius: lib.radius.pill, background: 'rgba(255, 255, 255, 0.18)' } },
						el('div', {
							style: {
								position: 'absolute',
								left: 0,
								top: 0,
								height: '100%',
								width: '{buffered}%',
								borderRadius: lib.radius.pill,
								background: 'rgba(255, 255, 255, 0.35)'
							}
						}),
						el('div', {
							style: {
								position: 'absolute',
								left: 0,
								top: 0,
								height: '100%',
								width: '{percent}%',
								borderRadius: lib.radius.pill,
								background: toneMap(lib, (palette) => palette.solid)
							}
						})
					),
					el(
						'span',
						{
							style: {
								fontSize: lib.fontSize.xs,
								fontFamily: lib.fontMono,
								color: '#ffffff',
								background: 'rgba(255, 255, 255, 0.16)',
								padding: '2px 6px',
								borderRadius: lib.radius.sm,
								flexShrink: 0
							}
						},
						'{time}'
					)
				)
			)
		});

		const mini = define({
			slug: `${lib.id}-media-player-mini`,
			name: 'Mini Player',
			library: lib.id,
			category: 'media',
			description: `Compact now-playing bar in the ${lib.label} style — tiny tinted artwork, ellipsized track title over a thin tone progress line, and a play/pause toggle button.`,
			tags: ['media', 'audio', 'mini', 'now-playing'],
			args: [
				stringArg('title', 'Night Drive — Neon Waves', { label: 'Title', maxLength: 48 }),
				numberArg('percent', 64, { label: 'Progress %', min: 0, max: 100 }),
				booleanArg('playing', true, { label: 'Playing' }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						...cardBase(lib),
						display: 'flex',
						alignItems: 'center',
						gap: '10px',
						width: '300px',
						padding: '8px 10px',
						borderRadius: lib.id === 'daisyui' ? lib.radius.pill : lib.radius.md
					}
				},
				artworkSquare(lib, '32px', lib.radius.sm, 16),
				stack(
					{ gap: '6px', flex: 1, minWidth: 0 },
					text(
						{
							fontSize: lib.fontSize.sm,
							fontWeight: 600,
							color: lib.text,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis'
						},
						'{title}'
					),
					el(
						'div',
						{ style: { height: '3px', borderRadius: lib.radius.pill, background: lib.borderSoft, overflow: 'hidden' } },
						el('div', {
							style: { width: '{percent}%', height: '100%', borderRadius: lib.radius.pill, background: toneMap(lib, (palette) => palette.solid) }
						})
					)
				),
				el(
					'div',
					{
						style: {
							width: '30px',
							height: '30px',
							borderRadius: lib.radius.pill,
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							flexShrink: 0
						}
					},
					iff('playing', pauseBars(12, 'currentColor'), playTriangle(12, 'currentColor'))
				)
			)
		});

		const playlist = define({
			slug: `${lib.id}-media-player-playlist`,
			name: 'Playlist',
			library: lib.id,
			category: 'media',
			description: `Playlist card in the ${lib.label} style — four track rows with index numbers and monospaced durations; the current track swaps its number for accent EQ bars and the hovered row gets a soft wash.`,
			tags: ['media', 'playlist', 'tracks', 'queue'],
			args: [
				stringArg('heading', 'Up next', { label: 'Heading', maxLength: 24 }),
				enumArg('current', ['1', '2', '3', '4'], '2', { label: 'Current track' }),
				enumArg('hovered', ['none', '1', '2', '3', '4'], '3', { label: 'Hovered row' })
			],
			render: el(
				'div',
				{ style: { ...cardBase(lib), display: 'flex', flexDirection: 'column', gap: '2px', width: '280px', padding: '10px' } },
				text(
					{
						fontSize: lib.fontSize.xs,
						fontWeight: lib.headingWeight,
						color: lib.muted,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						padding: '2px 10px 6px'
					},
					'{heading}'
				),
				trackRow(lib, accent, 1, 'Golden Hour', '3:42'),
				trackRow(lib, accent, 2, 'Night Drive', '4:05'),
				trackRow(lib, accent, 3, 'Paper Planes', '2:58'),
				trackRow(lib, accent, 4, 'Low Tide', '3:21')
			)
		});

		const volume = define({
			slug: `${lib.id}-media-player-volume`,
			name: 'Volume Control',
			library: lib.id,
			category: 'media',
			description: `Volume cluster in the ${lib.label} style — speaker glyph, tone-filled slider with a positioned thumb, a mute toggle that greys the whole control, and a monospaced playback-speed chip.`,
			tags: ['media', 'volume', 'slider', 'controls'],
			args: [
				numberArg('percent', 65, { label: 'Volume %', min: 0, max: 100 }),
				booleanArg('muted', false, { label: 'Muted' }),
				enumArg('speed', ['0.5x', '1x', '1.5x', '2x'], '1x', { label: 'Speed' }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						...cardBase(lib),
						display: 'flex',
						alignItems: 'center',
						gap: '12px',
						width: '280px',
						padding: '10px 14px',
						borderRadius: lib.id === 'reactflow' ? lib.radius.md : lib.radius.pill
					}
				},
				el('div', { style: { display: 'flex', flexShrink: 0, color: iff('muted', lib.faint, lib.text) } }, speakerIcon(18)),
				el(
					'div',
					{ style: { position: 'relative', flex: 1, height: '14px', display: 'flex', alignItems: 'center' } },
					el(
						'div',
						{ style: { width: '100%', height: '4px', borderRadius: lib.radius.pill, background: lib.borderSoft, overflow: 'hidden' } },
						el('div', {
							style: {
								width: '{percent}%',
								height: '100%',
								borderRadius: lib.radius.pill,
								background: iff('muted', lib.faint, toneMap(lib, (palette) => palette.solid))
							}
						})
					),
					el('div', {
						style: {
							position: 'absolute',
							left: 'calc({percent}% - 7px)',
							top: 0,
							width: '14px',
							height: '14px',
							borderRadius: lib.radius.pill,
							background: lib.surface,
							borderWidth: '2px',
							borderStyle: 'solid',
							borderColor: iff('muted', lib.faint, toneMap(lib, (palette) => palette.solid)),
							boxSizing: 'border-box',
							boxShadow: lib.shadow.sm
						}
					})
				),
				el(
					'span',
					{
						style: {
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							fontFamily: lib.fontMono,
							color: lib.muted,
							background: lib.surfaceAlt,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.borderSoft,
							padding: '2px 8px',
							borderRadius: lib.radius.pill,
							flexShrink: 0
						}
					},
					'{speed}'
				)
			)
		});

		return [audio, video, mini, playlist, volume];
	}
};
