// Whiteboard / collaboration archetype — collaborative-canvas surfaces in
// five renditions: multiplayer cursor field, sticky note, canvas tool rail,
// anchored comment pin, and canvas zoom controls. React Flow's home turf, so
// every library gets its own take on the dotted canvas. Follows the
// button.mjs exemplar: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs
// `${lib.id}-whiteboard-collab-<variant>`.

import {
	avatarCircle,
	booleanArg,
	colorArg,
	define,
	el,
	enumArg,
	icons,
	ifEq,
	iff,
	map,
	merge,
	numberArg,
	stringArg,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

const XMLNS = 'http://www.w3.org/2000/svg';

const strokeSvg = (size, ...children) =>
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
			xmlns: XMLNS
		},
		...children
	);

// Canvas texture: React Flow keeps its authentic dot-grid chrome; everyone
// else gets a faint dotted wash on their own surface tint.
const dottedCanvas = (lib) => ({
	background: lib.id === 'reactflow' ? lib.bg : lib.surfaceAlt,
	backgroundImage: `radial-gradient(circle, ${lib.dot || lib.faint} 1px, transparent 1px)`,
	backgroundSize: '14px 14px'
});

const canvasBorder = (lib) => (lib.id === 'reactflow' ? lib.border : lib.borderSoft);
const accent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid);
const onAccent = (lib) => (lib.id === 'reactflow' || lib.id === 'thingtime' ? '#ffffff' : lib.palette.primary.onSolid);
const cardShadow = (lib) => (lib.id === 'mui' ? lib.shadow.md : lib.id === 'untitled' ? lib.shadow.lg : lib.shadow.sm);

// --- cursors ----------------------------------------------------------------

const cursorArrow = (fill) =>
	el(
		'svg',
		{ width: 18, height: 18, viewBox: '0 0 24 24', fill, stroke: '#ffffff', strokeWidth: 1.5, strokeLinejoin: 'round', xmlns: XMLNS },
		el('polygon', { points: '5 2 19 11 12 12.5 9 20' })
	);

const cursorAt = (lib, left, top, fill, flagBg, flagFg, label) =>
	el(
		'div',
		{ style: { position: 'absolute', left, top, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' } },
		cursorArrow(fill),
		el(
			'span',
			{
				style: {
					marginLeft: '11px',
					padding: '2px 7px',
					borderRadius: lib.radius.xs,
					background: flagBg,
					color: flagFg,
					fontSize: lib.fontSize.xs,
					fontWeight: 600,
					whiteSpace: 'nowrap'
				}
			},
			label
		)
	);

// --- sticky washes (brief-sanctioned literal pastels) -----------------------

const STICKY_WASHES = {
	yellow: { background: '#fef9c3', color: '#854d0e' },
	pink: { background: '#fce7f3', color: '#9d174d' },
	blue: { background: '#dbeafe', color: '#1e40af' },
	green: { background: '#dcfce7', color: '#166534' }
};

const STICKY_FOLDS = {
	yellow: 'transparent transparent #fde047 transparent',
	pink: 'transparent transparent #f9a8d4 transparent',
	blue: 'transparent transparent #93c5fd transparent',
	green: 'transparent transparent #86efac transparent'
};

// --- toolbar pieces ---------------------------------------------------------

const toolTile = (lib, id, icon) =>
	el(
		'div',
		{
			style: merge(
				{
					width: '32px',
					height: '32px',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
					color: lib.muted,
					cursor: 'pointer'
				},
				ifEq(
					'active',
					id,
					lib.id === 'reactflow'
						? { background: lib.palette.danger.soft, color: lib.palette.danger.onSoft }
						: { background: lib.palette.primary.soft, color: lib.palette.primary.onSoft },
					{}
				)
			)
		},
		icon
	);

const histBtn = (lib, icon) =>
	el(
		'div',
		{ style: { width: '15px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: lib.faint, cursor: 'pointer' } },
		icon
	);

export const archetype = {
	id: 'whiteboard-collab',
	category: 'collaboration',
	variants: ['cursors', 'sticky', 'toolbar', 'comment-pin', 'zoom'],
	build(lib) {
		const chunky = lib.id === 'daisyui';

		const cursors = define({
			slug: `${lib.id}-whiteboard-collab-cursors`,
			name: 'Multiplayer Cursors',
			library: lib.id,
			category: 'collaboration',
			description: `Multiplayer cursor field in the ${lib.label} style — three hue-coded pointer arrows with name flag chips drifting over a dotted canvas band, plus a live presence caption.`,
			tags: ['whiteboard', 'cursor', 'multiplayer', 'presence'],
			args: [
				stringArg('name', 'Ava', { label: 'Your name', maxLength: 16 }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'info'),
				booleanArg('live', true, { label: 'Live caption' })
			],
			render: el(
				'div',
				{
					style: {
						position: 'relative',
						width: '260px',
						height: '160px',
						boxSizing: 'border-box',
						borderRadius: lib.radius.md,
						borderWidth: chunky ? '2px' : '1px',
						borderStyle: 'solid',
						borderColor: canvasBorder(lib),
						overflow: 'hidden',
						fontFamily: lib.font,
						...dottedCanvas(lib)
					}
				},
				cursorAt(
					lib,
					'28px',
					'26px',
					toneMap(lib, (palette) => palette.solid),
					toneMap(lib, (palette) => palette.solid),
					toneMap(lib, (palette) => palette.onSolid),
					'{name}'
				),
				cursorAt(lib, '152px', '62px', lib.palette.success.solid, lib.palette.success.solid, lib.palette.success.onSolid, 'Sam'),
				cursorAt(lib, '80px', '96px', lib.palette.danger.solid, lib.palette.danger.solid, lib.palette.danger.onSolid, 'Mia'),
				iff(
					'live',
					el(
						'span',
						{
							style: {
								position: 'absolute',
								top: '8px',
								right: '8px',
								display: 'inline-flex',
								alignItems: 'center',
								gap: '5px',
								padding: '3px 8px',
								borderRadius: lib.radius.pill,
								background: lib.surface,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.borderSoft,
								boxShadow: lib.shadow.sm,
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								color: lib.muted,
								...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
							}
						},
						el('span', {
							style: {
								width: '6px',
								height: '6px',
								borderRadius: '999px',
								background: lib.id === 'thingtime' ? lib.rainbow : lib.palette.success.solid
							}
						}),
						'3 live'
					)
				)
			)
		});

		const sticky = define({
			slug: `${lib.id}-whiteboard-collab-sticky`,
			name: 'Sticky Note',
			library: lib.id,
			category: 'collaboration',
			description: `Whiteboard sticky note in the ${lib.label} style — a tinted square wash with handwritten-feel text, an author chip, a folded corner, and a tilt you can dial in degrees.`,
			tags: ['whiteboard', 'sticky-note', 'collaboration', 'annotation'],
			args: [
				textArg('text', 'Ship the collab demo', { label: 'Note', maxLength: 80 }),
				enumArg('color', ['yellow', 'pink', 'blue', 'green'], 'yellow', { label: 'Color' }),
				stringArg('author', 'Ava', { label: 'Author', maxLength: 16 }),
				numberArg('tilt', -2, { label: 'Tilt (deg)', min: -8, max: 8 })
			],
			render: el(
				'div',
				{
					style: merge(
						{
							position: 'relative',
							width: '168px',
							height: '168px',
							boxSizing: 'border-box',
							padding: '14px',
							display: 'flex',
							flexDirection: 'column',
							gap: '8px',
							overflow: 'hidden',
							borderRadius: lib.id === 'antd' ? lib.radius.xs : chunky ? lib.radius.md : lib.radius.sm,
							boxShadow: cardShadow(lib),
							fontFamily: lib.font,
							transform: 'rotate(calc({tilt} * 1deg))'
						},
						map('color', STICKY_WASHES, STICKY_WASHES.yellow)
					)
				},
				el(
					'div',
					{
						style: {
							flex: '1',
							fontSize: lib.fontSize.lg,
							lineHeight: 1.35,
							fontWeight: chunky ? 700 : 500,
							fontStyle: 'italic',
							fontFamily: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive"
						}
					},
					'{text}'
				),
				el(
					'span',
					{
						style: {
							alignSelf: 'flex-start',
							padding: '2px 8px',
							borderRadius: lib.radius.pill,
							background: 'rgba(255, 255, 255, 0.6)',
							fontSize: lib.fontSize.xs,
							fontWeight: 600
						}
					},
					'{author}'
				),
				el('span', {
					style: {
						position: 'absolute',
						right: 0,
						bottom: 0,
						width: 0,
						height: 0,
						borderStyle: 'solid',
						borderWidth: '0 0 20px 20px',
						borderColor: map('color', STICKY_FOLDS, STICKY_FOLDS.yellow)
					}
				})
			)
		});

		const toolbar = define({
			slug: `${lib.id}-whiteboard-collab-toolbar`,
			name: 'Canvas Toolbar',
			library: lib.id,
			category: 'collaboration',
			description: `Vertical canvas tool rail in the ${lib.label} style — select, pen, shape, text, and eraser tiles with a tone-washed active state, an undo/redo pair, and a color swatch dot.`,
			tags: ['whiteboard', 'toolbar', 'tools', 'canvas'],
			args: [
				enumArg('active', ['select', 'pen', 'shape', 'text', 'eraser'], 'select', { label: 'Active tool' }),
				colorArg('swatch', lib.id === 'reactflow' ? lib.accent : lib.palette.info.solid, { label: 'Swatch' }),
				booleanArg('history', true, { label: 'Undo / redo' })
			],
			render: el(
				'div',
				{
					style: {
						display: 'inline-flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '3px',
						padding: chunky ? '8px' : '6px',
						background: lib.surface,
						borderWidth: chunky ? '2px' : '1px',
						borderStyle: 'solid',
						borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft,
						borderRadius: lib.id === 'antd' ? lib.radius.sm : chunky ? lib.radius.lg : lib.radius.md,
						boxShadow: cardShadow(lib),
						fontFamily: lib.font
					}
				},
				toolTile(
					lib,
					'select',
					el('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor', xmlns: XMLNS }, el('polygon', { points: '5 2 19 11 12 12.5 9 20' }))
				),
				toolTile(lib, 'pen', icons.edit(15, 'currentColor')),
				toolTile(lib, 'shape', strokeSvg(16, el('rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }))),
				toolTile(lib, 'text', el('span', { style: { fontSize: '15px', fontWeight: 700, fontFamily: 'Georgia, serif', lineHeight: 1 } }, 'T')),
				toolTile(
					lib,
					'eraser',
					strokeSvg(
						16,
						el('path', { d: 'M4 15 13 6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L9 20H6l-2-2v-3z' }),
						el('line', { x1: 9, y1: 10, x2: 14, y2: 15 })
					)
				),
				el('span', { style: { width: '20px', height: chunky ? '2px' : '1px', background: lib.borderSoft, margin: '2px 0' } }),
				iff(
					'history',
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center', gap: '2px' } },
						histBtn(lib, strokeSvg(12, el('path', { d: 'M4 10h10a6 6 0 0 1 0 12h-4' }), el('polyline', { points: '8 6 4 10 8 14' }))),
						histBtn(lib, strokeSvg(12, el('path', { d: 'M20 10H10a6 6 0 0 0 0 12h4' }), el('polyline', { points: '16 6 20 10 16 14' })))
					)
				),
				el('span', {
					style: {
						width: '18px',
						height: '18px',
						borderRadius: '999px',
						background: '{swatch}',
						borderWidth: '2px',
						borderStyle: 'solid',
						borderColor: lib.surface,
						boxShadow: `0 0 0 1px ${lib.border}`,
						marginTop: '2px'
					}
				})
			)
		});

		const commentPin = define({
			slug: `${lib.id}-whiteboard-collab-comment-pin`,
			name: 'Comment Pin',
			library: lib.id,
			category: 'collaboration',
			description: `Anchored canvas comment in the ${lib.label} style — a numbered pin on a dotted canvas patch, connected to a thread card with author, time, a reply input mock, and a resolve check.`,
			tags: ['whiteboard', 'comment', 'pin', 'thread'],
			args: [
				textArg('comment', 'Can we make this edge dotted?', { label: 'Comment', maxLength: 120 }),
				stringArg('author', 'Mia', { label: 'Author', maxLength: 16 }),
				stringArg('time', '2m', { label: 'Time', maxLength: 12 }),
				numberArg('num', 3, { label: 'Pin number', min: 1, max: 99 }),
				booleanArg('resolved', false, { label: 'Resolved' })
			],
			render: el(
				'div',
				{ style: { width: '250px', fontFamily: lib.font } },
				el(
					'div',
					{
						style: {
							position: 'relative',
							height: '64px',
							boxSizing: 'border-box',
							borderRadius: lib.radius.md,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: canvasBorder(lib),
							...dottedCanvas(lib)
						}
					},
					el(
						'div',
						{
							style: merge(
								{
									position: 'absolute',
									left: '20px',
									top: '14px',
									width: '28px',
									height: '28px',
									boxSizing: 'border-box',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									borderRadius: '999px 999px 999px 3px',
									borderWidth: '2px',
									borderStyle: 'solid',
									borderColor: '#ffffff',
									boxShadow: lib.shadow.sm,
									fontSize: lib.fontSize.xs,
									fontWeight: 700
								},
								iff(
									'resolved',
									{ background: lib.palette.success.solid, color: lib.palette.success.onSolid },
									{ background: accent(lib), color: onAccent(lib) }
								)
							)
						},
						'{num}'
					)
				),
				el('div', { style: { width: '2px', height: '14px', marginLeft: '33px', background: lib.border } }),
				el(
					'div',
					{
						style: {
							background: lib.surface,
							borderWidth: chunky ? '2px' : '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							borderRadius: lib.id === 'antd' ? lib.radius.sm : chunky ? lib.radius.lg : lib.radius.md,
							boxShadow: cardShadow(lib),
							padding: '12px',
							display: 'flex',
							flexDirection: 'column',
							gap: '8px'
						}
					},
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center', gap: '8px' } },
						avatarCircle('22px', lib.palette.neutral.soft, lib.palette.neutral.onSoft, icons.user(12, 'currentColor'), lib.fontSize.xs),
						el('span', { style: { fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text } }, '{author}'),
						el('span', { style: { fontSize: lib.fontSize.xs, color: lib.faint } }, '{time}'),
						el(
							'span',
							{
								style: merge(
									{
										marginLeft: 'auto',
										width: '22px',
										height: '22px',
										boxSizing: 'border-box',
										borderRadius: '999px',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										cursor: 'pointer'
									},
									iff(
										'resolved',
										{ background: lib.palette.success.solid, color: lib.palette.success.onSolid },
										{ borderWidth: '1px', borderStyle: 'solid', borderColor: lib.border, color: lib.faint, background: 'transparent' }
									)
								)
							},
							icons.check(12, 'currentColor')
						)
					),
					el('p', { style: { margin: 0, fontSize: lib.fontSize.sm, lineHeight: 1.45, color: lib.text } }, '{comment}'),
					el('input', {
						type: 'text',
						placeholder: 'Reply…',
						style: {
							width: '100%',
							boxSizing: 'border-box',
							height: lib.control.sm,
							padding: '0 10px',
							borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.borderSoft,
							background: lib.surfaceAlt,
							fontSize: lib.fontSize.sm,
							fontFamily: lib.font,
							color: lib.text,
							outline: 'none'
						}
					})
				)
			)
		});

		const zoom = define({
			slug: `${lib.id}-whiteboard-collab-zoom`,
			name: 'Zoom Controls',
			library: lib.id,
			category: 'collaboration',
			description: `Canvas zoom cluster in the ${lib.label} style — a minus/plus pill around a live zoom readout, fit-view and fullscreen ghost buttons, and a minimap mock with a viewport rectangle.`,
			tags: ['whiteboard', 'zoom', 'controls', 'minimap'],
			args: [
				numberArg('zoom', 100, { label: 'Zoom %', min: 10, max: 400 }),
				booleanArg('minimap', true, { label: 'Minimap' }),
				booleanArg('fit', true, { label: 'Fit + fullscreen' })
			],
			render: el(
				'div',
				{ style: { display: 'flex', alignItems: 'flex-end', gap: '10px', fontFamily: lib.font } },
				el(
					'div',
					{ style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' } },
					el(
						'div',
						{
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								gap: '2px',
								padding: '2px',
								background: lib.surface,
								borderWidth: chunky ? '2px' : '1px',
								borderStyle: 'solid',
								borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft,
								borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
								boxShadow: cardShadow(lib)
							}
						},
						el(
							'div',
							{ style: { width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: lib.muted, cursor: 'pointer' } },
							strokeSvg(14, el('line', { x1: 5, y1: 12, x2: 19, y2: 12 }))
						),
						el(
							'span',
							{ style: { minWidth: '46px', textAlign: 'center', fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text } },
							'{zoom}%'
						),
						el(
							'div',
							{ style: { width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: lib.muted, cursor: 'pointer' } },
							icons.plus(14, 'currentColor')
						)
					),
					iff(
						'fit',
						el(
							'div',
							{ style: { display: 'flex', gap: '6px' } },
							el(
								'div',
								{
									style: {
										width: '28px',
										height: '28px',
										boxSizing: 'border-box',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										background: lib.surface,
										borderWidth: '1px',
										borderStyle: 'solid',
										borderColor: lib.border,
										borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
										color: lib.muted,
										cursor: 'pointer'
									}
								},
								strokeSvg(
									14,
									el('path', { d: 'M8 3H5a2 2 0 0 0-2 2v3' }),
									el('path', { d: 'M16 3h3a2 2 0 0 1 2 2v3' }),
									el('path', { d: 'M8 21H5a2 2 0 0 1-2-2v-3' }),
									el('path', { d: 'M16 21h3a2 2 0 0 0 2-2v-3' })
								)
							),
							el(
								'div',
								{
									style: {
										width: '28px',
										height: '28px',
										boxSizing: 'border-box',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										background: lib.surface,
										borderWidth: '1px',
										borderStyle: 'solid',
										borderColor: lib.border,
										borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
										color: lib.muted,
										cursor: 'pointer'
									}
								},
								strokeSvg(
									14,
									el('polyline', { points: '15 3 21 3 21 9' }),
									el('polyline', { points: '9 21 3 21 3 15' }),
									el('line', { x1: 21, y1: 3, x2: 14, y2: 10 }),
									el('line', { x1: 3, y1: 21, x2: 10, y2: 14 })
								)
							)
						)
					)
				),
				iff(
					'minimap',
					el(
						'div',
						{
							style: {
								position: 'relative',
								width: '92px',
								height: '64px',
								boxSizing: 'border-box',
								overflow: 'hidden',
								borderRadius: lib.radius.sm,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: canvasBorder(lib),
								boxShadow: lib.shadow.sm,
								...dottedCanvas(lib),
								backgroundSize: '10px 10px'
							}
						},
						el('span', { style: { position: 'absolute', left: '10px', top: '12px', width: '16px', height: '11px', borderRadius: '2px', background: lib.faint } }),
						el('span', { style: { position: 'absolute', left: '64px', top: '38px', width: '16px', height: '11px', borderRadius: '2px', background: lib.faint } }),
						el('span', {
							style: {
								position: 'absolute',
								left: '30px',
								top: '16px',
								width: '42px',
								height: '30px',
								boxSizing: 'border-box',
								borderWidth: '1.5px',
								borderStyle: 'solid',
								borderColor: accent(lib),
								borderRadius: '2px',
								background: 'transparent'
							}
						})
					)
				)
			)
		});

		return [cursors, sticky, toolbar, commentPin, zoom];
	}
};
