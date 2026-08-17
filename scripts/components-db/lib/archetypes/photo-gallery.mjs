// Photo-gallery archetype — photo surfaces in five renditions: a masonry
// grid mock, a lightbox overlay, an album card, a photo-editor toolbar and a
// filmstrip scrubber. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-photo-gallery-<variant>`.

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

// antd keeps its tight corners, reactflow stays crisp, daisyui goes chunky.
const tileRadius = (lib) =>
	lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md;

// mui gets its elevation; everyone else wears a feather-light card shadow.
const cardShadow = (lib) => (lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm);

// Per-library accent for rings and slider fills: reactflow's hot pink handle
// color, thingtime's pink wink, otherwise the primary solid.
const accent = (lib) => lib.accent || (lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.primary.solid);

// Fixed tone rotation for placeholder tiles (tone-soft washes).
const TONE_CYCLE = ['primary', 'info', 'success', 'warning', 'danger', 'neutral'];
const softOf = (lib, i) => lib.palette[TONE_CYCLE[i % TONE_CYCLE.length]].soft;
const onSoftOf = (lib, i) => lib.palette[TONE_CYCLE[i % TONE_CYCLE.length]].onSoft;

// Tinted placeholder tile with a centered image glyph.
const glyphTile = (lib, toneIndex, height, glyphSize = 16) =>
	el(
		'div',
		{
			style: {
				height,
				borderRadius: tileRadius(lib),
				background: softOf(lib, toneIndex),
				color: onSoftOf(lib, toneIndex),
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center'
			}
		},
		icons.image(glyphSize, 'currentColor')
	);

// Left/right chevron (the shared icon set only ships down/right).
const chevron = (size, color, left) =>
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
		el('polyline', { points: left ? '15 6 9 12 15 18' : '9 6 15 12 9 18' })
	);

const editorSvg = (...shapes) =>
	el(
		'svg',
		{
			width: 14,
			height: 14,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: 'currentColor',
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		...shapes
	);

const cropIcon = () =>
	editorSvg(el('path', { d: 'M6.13 1L6 16a2 2 0 0 0 2 2h15' }), el('path', { d: 'M1 6.13L16 6a2 2 0 0 1 2 2v15' }));

const rotateIcon = () =>
	editorSvg(el('polyline', { points: '23 4 23 10 17 10' }), el('path', { d: 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10' }));

export const archetype = {
	id: 'photo-gallery',
	category: 'media',
	variants: ['masonry', 'lightbox', 'album', 'editor', 'filmstrip'],
	build(lib) {
		const gapMap = () => map('gap', { tight: '4px', regular: '10px' });

		const masonry = define({
			slug: `${lib.id}-photo-gallery-masonry`,
			name: 'Masonry Grid',
			library: lib.id,
			category: 'media',
			description: `Three-column masonry photo grid mock in the ${lib.label} style — placeholder tiles rotating through the tone washes with image glyphs, a photo-count header, and one hovered tile carrying a caption overlay and heart.`,
			tags: ['photo', 'gallery', 'masonry', 'grid', 'media'],
			args: [
				stringArg('count', '128', { label: 'Photo count', maxLength: 8 }),
				stringArg('caption', 'Golden hour', { label: 'Hover caption', maxLength: 24 }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'warning'),
				enumArg('gap', ['tight', 'regular'], 'regular', { label: 'Gap' })
			],
			render: stack(
				{ width: '280px', gap: '10px', fontFamily: lib.font },
				text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{count} photos'),
				el(
					'div',
					{ style: { display: 'flex', gap: gapMap(), alignItems: 'flex-start' } },
					stack(
						{ flex: '1 1 0', minWidth: '0', gap: gapMap() },
						glyphTile(lib, 0, '76px'),
						glyphTile(lib, 1, '104px'),
						glyphTile(lib, 2, '64px')
					),
					stack(
						{ flex: '1 1 0', minWidth: '0', gap: gapMap() },
						el(
							'div',
							{
								style: {
									position: 'relative',
									height: '112px',
									borderRadius: tileRadius(lib),
									background: toneMap(lib, (palette) => palette.soft, 'warning'),
									color: toneMap(lib, (palette) => palette.onSoft, 'warning'),
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									overflow: 'hidden'
								}
							},
							icons.image(16, 'currentColor'),
							el(
								'div',
								{
									style: {
										position: 'absolute',
										left: '0',
										right: '0',
										bottom: '0',
										padding: '6px 9px',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'space-between',
										background: 'linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.55) 100%)'
									}
								},
								text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: '#ffffff' }, '{caption}'),
								icons.heart(12, '#ffffff', true)
							)
						),
						glyphTile(lib, 2, '68px'),
						glyphTile(lib, 3, '92px')
					),
					stack(
						{ flex: '1 1 0', minWidth: '0', gap: gapMap() },
						glyphTile(lib, 4, '96px'),
						glyphTile(lib, 5, '128px')
					)
				)
			)
		});

		const lightbox = define({
			slug: `${lib.id}-photo-gallery-lightbox`,
			name: 'Lightbox Overlay',
			library: lib.id,
			category: 'media',
			description: `Lightbox photo overlay in the ${lib.label} style — a dark backdrop panel around a tone-tinted photo placeholder, prev/next chevron circles, an index caption with share, download and close ghosts, and a caption bar below.`,
			tags: ['photo', 'lightbox', 'overlay', 'viewer'],
			args: [
				stringArg('current', '3', { label: 'Current index', maxLength: 6 }),
				stringArg('total', '24', { label: 'Total photos', maxLength: 6 }),
				stringArg('caption', 'Sunset over the bay', { label: 'Caption', maxLength: 40 }),
				toneArg()
			],
			render: stack(
				{
					width: '300px',
					borderRadius: lib.radius.lg,
					overflow: 'hidden',
					background: '#101014',
					boxShadow: lib.shadow.lg,
					fontFamily: lib.font
				},
				row(
					{ justifyContent: 'space-between', padding: '10px 12px' },
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: 'rgba(255, 255, 255, 0.72)' }, '{current} of {total}'),
					row(
						{ gap: '6px' },
						...[icons.upload(12, 'currentColor'), icons.download(12, 'currentColor'), icons.x(12, 'currentColor')].map(
							(icon) =>
								el(
									'span',
									{
										style: {
											width: '22px',
											height: '22px',
											display: 'inline-flex',
											alignItems: 'center',
											justifyContent: 'center',
											borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
											background: 'rgba(255, 255, 255, 0.08)',
											color: 'rgba(255, 255, 255, 0.75)'
										}
									},
									icon
								)
						)
					)
				),
				row(
					{ gap: '10px', padding: '0 12px' },
					...[true, false].map((left) => null),
					el(
						'span',
						{
							style: {
								width: '26px',
								height: '26px',
								flexShrink: 0,
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
								background: 'rgba(255, 255, 255, 0.12)',
								color: '#ffffff'
							}
						},
						chevron(13, 'currentColor', true)
					),
					el(
						'div',
						{
							style: {
								flex: '1 1 auto',
								height: '148px',
								borderRadius: tileRadius(lib),
								background: toneMap(lib, (palette) => palette.soft),
								color: toneMap(lib, (palette) => palette.onSoft),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center'
							}
						},
						icons.image(22, 'currentColor')
					),
					el(
						'span',
						{
							style: {
								width: '26px',
								height: '26px',
								flexShrink: 0,
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
								background: 'rgba(255, 255, 255, 0.12)',
								color: '#ffffff'
							}
						},
						chevron(13, 'currentColor', false)
					)
				),
				row(
					{ padding: '10px 12px 12px' },
					text({ fontSize: lib.fontSize.sm, color: 'rgba(255, 255, 255, 0.85)' }, '{caption}')
				)
			)
		});

		const album = define({
			slug: `${lib.id}-photo-gallery-album`,
			name: 'Album Card',
			library: lib.id,
			category: 'media',
			description: `Album card in the ${lib.label} style — a stacked-photos illusion peeking behind the tone-tinted cover, title and item-count caption, a shared-with avatar pair and an open button${lib.id === 'thingtime' ? ', finished with the house rainbow strip' : ''}.`,
			tags: ['photo', 'album', 'card', 'collection'],
			args: [
				stringArg('title', 'Summer trip', { label: 'Title', maxLength: 24 }),
				stringArg('count', '86', { label: 'Item count', maxLength: 6 }),
				toneArg(),
				booleanArg('shared', true, { label: 'Shared' })
			],
			render: stack(
				{
					width: '210px',
					padding: '12px',
					gap: '10px',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.radius.lg,
					boxShadow: cardShadow(lib),
					fontFamily: lib.font
				},
				el(
					'div',
					{ style: { position: 'relative', paddingTop: '12px' } },
					el('div', {
						style: {
							position: 'absolute',
							top: '0',
							left: '18px',
							right: '18px',
							height: '16px',
							borderRadius: tileRadius(lib),
							background: lib.borderSoft
						}
					}),
					el('div', {
						style: {
							position: 'absolute',
							top: '6px',
							left: '9px',
							right: '9px',
							height: '16px',
							borderRadius: tileRadius(lib),
							background: toneMap(lib, (palette) => palette.border)
						}
					}),
					el(
						'div',
						{
							style: {
								position: 'relative',
								height: '96px',
								borderRadius: tileRadius(lib),
								background: toneMap(lib, (palette) => palette.soft),
								color: toneMap(lib, (palette) => palette.onSoft),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								overflow: 'hidden'
							}
						},
						icons.image(20, 'currentColor'),
						lib.id === 'thingtime'
							? el('div', { style: { position: 'absolute', left: '0', right: '0', bottom: '0', height: '3px', background: lib.rainbow } })
							: null
					)
				),
				stack(
					{ gap: '2px' },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{count} items')
				),
				row(
					{ justifyContent: 'space-between' },
					iff(
						'shared',
						row(
							{},
							avatarCircle(22, lib.palette.info.soft, lib.palette.info.onSoft, 'AK', '9px'),
							avatarCircle(22, lib.palette.success.soft, lib.palette.success.onSoft, 'MJ', '9px', {
								marginLeft: '-6px',
								boxShadow: `0 0 0 2px ${lib.surface}`
							})
						),
						text({ fontSize: lib.fontSize.xs, fontWeight: 500, color: lib.faint }, 'Private')
					),
					el(
						'button',
						{
							type: 'button',
							style: {
								height: lib.control.sm,
								padding: '0 12px',
								border: 'none',
								borderRadius: lib.radius.sm,
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								fontFamily: lib.font,
								fontSize: lib.fontSize.xs,
								fontWeight: lib.buttonWeight,
								cursor: 'pointer',
								...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
							}
						},
						'Open'
					)
				)
			)
		});

		const toolActive =
			lib.id === 'reactflow'
				? { background: lib.palette.danger.soft, color: lib.accent }
				: { background: lib.palette.primary.soft, color: lib.palette.primary.onSoft };

		const toolBtn = (id, icon) =>
			el(
				'button',
				{
					type: 'button',
					style: merge(
						{
							width: '26px',
							height: '26px',
							padding: '0',
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							border: 'none',
							background: 'transparent',
							color: lib.muted,
							borderRadius: lib.radius.xs,
							cursor: 'pointer'
						},
						ifEq('tool', id, toolActive)
					)
				},
				icon
			);

		const divider = () => el('div', { style: { width: '1px', height: '18px', background: lib.borderSoft, flexShrink: 0 } });

		const editor = define({
			slug: `${lib.id}-photo-gallery-editor`,
			name: 'Photo Editor Bar',
			library: lib.id,
			category: 'media',
			description: `Photo-editor toolbar in the ${lib.label} style — crop, rotate, adjust and filter tools with one active, an exposure slider with fill track, thumb and value chip, a before/after toggle and a save/cancel pair${lib.uppercaseButtons ? ' with uppercase Material actions' : ''}.`,
			tags: ['photo', 'editor', 'toolbar', 'slider', 'media'],
			args: [
				enumArg('tool', ['crop', 'rotate', 'adjust', 'filters'], 'crop', { label: 'Active tool' }),
				numberArg('exposure', 64, { label: 'Exposure', min: 0, max: 100 }),
				booleanArg('original', false, { label: 'Show original' }),
				toneArg()
			],
			render: row(
				{
					display: 'inline-flex',
					gap: '10px',
					padding: '8px 10px',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.radius.lg,
					boxShadow: cardShadow(lib),
					fontFamily: lib.font
				},
				row(
					{ gap: '2px' },
					toolBtn('crop', cropIcon()),
					toolBtn('rotate', rotateIcon()),
					toolBtn('adjust', icons.settings(14, 'currentColor')),
					toolBtn('filters', icons.zap(14, 'currentColor'))
				),
				divider(),
				row(
					{ gap: '8px' },
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.muted, whiteSpace: 'nowrap' }, 'Exposure'),
					el(
						'div',
						{ style: { position: 'relative', width: '96px', height: '4px', borderRadius: lib.radius.pill, background: lib.borderSoft } },
						el('div', {
							style: {
								position: 'absolute',
								left: '0',
								top: '0',
								bottom: '0',
								width: '{exposure}%',
								borderRadius: lib.radius.pill,
								background: lib.id === 'thingtime' ? lib.rainbow : accent(lib)
							}
						}),
						el('div', {
							style: {
								position: 'absolute',
								top: '50%',
								left: 'calc({exposure}% - 6px)',
								marginTop: '-6px',
								width: '12px',
								height: '12px',
								boxSizing: 'border-box',
								borderRadius: '999px',
								background: lib.surface,
								border: `2px solid ${accent(lib)}`
							}
						})
					),
					el(
						'span',
						{
							style: {
								fontFamily: lib.fontMono,
								fontSize: lib.fontSize.xs,
								color: lib.text,
								background: lib.surfaceAlt,
								padding: '2px 6px',
								borderRadius: lib.radius.xs
							}
						},
						'{exposure}'
					)
				),
				divider(),
				el(
					'button',
					{
						type: 'button',
						style: merge(
							{
								height: '22px',
								padding: '0 10px',
								display: 'inline-flex',
								alignItems: 'center',
								borderWidth: '1px',
								borderStyle: 'solid',
								borderRadius: lib.radius.pill,
								fontFamily: lib.font,
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								cursor: 'pointer',
								whiteSpace: 'nowrap'
							},
							iff(
								'original',
								{
									background: lib.palette.warning.soft,
									color: lib.palette.warning.onSoft,
									borderColor: lib.palette.warning.border
								},
								{ background: 'transparent', color: lib.muted, borderColor: lib.border }
							)
						)
					},
					iff('original', 'Before', 'After')
				),
				divider(),
				el(
					'button',
					{
						type: 'button',
						style: {
							height: '26px',
							padding: '0 8px',
							border: 'none',
							background: 'transparent',
							color: lib.muted,
							fontFamily: lib.font,
							fontSize: lib.fontSize.xs,
							fontWeight: lib.buttonWeight,
							cursor: 'pointer',
							...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
						}
					},
					'Cancel'
				),
				el(
					'button',
					{
						type: 'button',
						style: {
							height: '26px',
							padding: '0 12px',
							border: 'none',
							borderRadius: lib.radius.sm,
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							fontFamily: lib.font,
							fontSize: lib.fontSize.xs,
							fontWeight: lib.buttonWeight,
							cursor: 'pointer',
							boxShadow: lib.id === 'mui' ? lib.shadow.sm : 'none',
							...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
						}
					},
					'Save'
				)
			)
		});

		const zoomChip = (label) =>
			el(
				'span',
				{
					style: {
						width: '20px',
						height: '20px',
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.border,
						borderRadius: lib.radius.xs,
						color: lib.muted,
						fontSize: lib.fontSize.xs,
						fontWeight: 600
					}
				},
				label
			);

		const filmstrip = define({
			slug: `${lib.id}-photo-gallery-filmstrip`,
			name: 'Filmstrip',
			library: lib.id,
			category: 'media',
			description: `Filmstrip scrubber in the ${lib.label} style — a large tone-tinted current frame above a six-thumbnail strip with the active frame ringed${lib.id === 'reactflow' ? ' on a dotted canvas' : ''}, plus a frame counter and zoom chips.`,
			tags: ['photo', 'filmstrip', 'thumbnails', 'viewer'],
			args: [
				enumArg('frame', ['1', '2', '3', '4', '5', '6'], '2', { label: 'Current frame' }),
				numberArg('zoom', 100, { label: 'Zoom %' }),
				toneArg()
			],
			render: stack(
				{
					width: '250px',
					padding: '10px',
					gap: '8px',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.radius.lg,
					boxShadow: cardShadow(lib),
					fontFamily: lib.font,
					...(lib.id === 'reactflow'
						? { backgroundImage: `radial-gradient(${lib.dot} 0.75px, transparent 0.75px)`, backgroundSize: '12px 12px' }
						: {})
				},
				el(
					'div',
					{
						style: {
							height: '124px',
							borderRadius: tileRadius(lib),
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center'
						}
					},
					icons.image(20, 'currentColor')
				),
				row(
					{ gap: '5px', padding: '2px' },
					...[0, 1, 2, 3, 4, 5].map((i) =>
						el('div', {
							style: merge(
								{ flex: '1 1 0', height: '28px', borderRadius: lib.radius.xs, background: softOf(lib, i) },
								ifEq('frame', String(i + 1), { boxShadow: `0 0 0 2px ${accent(lib)}`, opacity: 1 }, { opacity: 0.65 })
							)
						})
					)
				),
				row(
					{ justifyContent: 'space-between' },
					el(
						'span',
						{
							style: {
								fontFamily: lib.fontMono,
								fontSize: lib.fontSize.xs,
								color: lib.muted,
								background: lib.surfaceAlt,
								padding: '2px 8px',
								borderRadius: lib.radius.xs
							}
						},
						'{frame} / 6'
					),
					row(
						{ gap: '4px' },
						zoomChip('−'),
						el(
							'span',
							{
								style: {
									height: '20px',
									display: 'inline-flex',
									alignItems: 'center',
									padding: '0 6px',
									fontFamily: lib.fontMono,
									fontSize: lib.fontSize.xs,
									color: lib.text
								}
							},
							'{zoom}%'
						),
						zoomChip('+')
					)
				)
			)
		});

		return [masonry, lightbox, album, editor, filmstrip];
	}
};
