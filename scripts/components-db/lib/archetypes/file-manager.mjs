// File-manager archetype — file management surfaces in five renditions: a
// file list row, a folder tile grid, a drag-drop upload zone, a storage meter
// card, and a file-browser toolbar. Follows the button.mjs exemplar: exactly
// 5 variants, `build(lib)` returns exactly 5 definitions (one per variant,
// same order), slugs `${lib.id}-file-manager-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	ifEq,
	iff,
	map,
	merge,
	numberArg,
	repeat,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// antd sits on tight corners and reactflow chrome stays crisp; daisyui goes
// chunky; everyone else keeps their native mid radius.
const surfaceRadius = (lib) =>
	lib.id === 'antd' || lib.id === 'reactflow' ? lib.radius.sm : lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md;

// untitled wears its feather shadow on quiet surfaces; mui gets real elevation
// on the storage card only.
const quietShadow = (lib) => (lib.id === 'untitled' ? lib.shadow.sm : 'none');

const captionStyle = (lib) => ({ fontSize: lib.fontSize.xs, color: lib.muted, lineHeight: 1.4 });

const upperCase = (lib) =>
	lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {};

// View-toggle glyphs (grid + list) — the shared icon set has no grid/list
// marks; built from allowlisted svg rect/line primitives only.
const svgFrame = (size, ...children) =>
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

const gridGlyph = (size) =>
	svgFrame(
		size,
		el('rect', { x: 3, y: 3, width: 7, height: 7 }),
		el('rect', { x: 14, y: 3, width: 7, height: 7 }),
		el('rect', { x: 3, y: 14, width: 7, height: 7 }),
		el('rect', { x: 14, y: 14, width: 7, height: 7 })
	);

const listGlyph = (size) =>
	svgFrame(
		size,
		el('line', { x1: 4, y1: 6, x2: 20, y2: 6 }),
		el('line', { x1: 4, y1: 12, x2: 20, y2: 12 }),
		el('line', { x1: 4, y1: 18, x2: 20, y2: 18 })
	);

// Folder tile base — plain object (row()/stack() would spread a ttMerge, so
// tiles that need merging use el('div', { style: merge(...) }) instead).
const folderTile = (lib) => ({
	display: 'flex',
	flexDirection: 'column',
	gap: '8px',
	width: '116px',
	padding: '12px',
	boxSizing: 'border-box',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: surfaceRadius(lib),
	boxShadow: quietShadow(lib)
});

const toggleCell = (lib) => ({
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	width: '30px',
	height: '26px',
	color: lib.muted,
	cursor: 'pointer'
});

export const archetype = {
	id: 'file-manager',
	category: 'files',
	variants: ['file-row', 'folder-grid', 'upload', 'storage', 'toolbar'],
	build(lib) {
		const fileRow = define({
			slug: `${lib.id}-file-manager-file-row`,
			name: 'File Row',
			library: lib.id,
			category: 'files',
			description: `File list row in the ${lib.label} style — a tone-tinted file-type icon tile beside the name with a size-and-date caption, finished with a quiet kebab menu${lib.id === 'thingtime' ? ' and the house rainbow spine on the left edge' : ''}.`,
			tags: ['file', 'list', 'row', 'document'],
			args: [
				stringArg('name', 'Q3-report.pdf', { label: 'File name', maxLength: 40 }),
				stringArg('meta', '2.4 MB · Aug 12', { label: 'Caption', maxLength: 40 }),
				enumArg('fileType', ['doc', 'image', 'video', 'audio'], 'doc', { label: 'File type' }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						gap: '12px',
						width: '320px',
						padding: '10px 12px',
						boxSizing: 'border-box',
						fontFamily: lib.font,
						background: lib.surface,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.id === 'reactflow' ? lib.borderSoft : lib.border,
						borderRadius: surfaceRadius(lib),
						boxShadow: quietShadow(lib)
					}
				},
				lib.id === 'thingtime'
					? el('div', {
							style: {
								width: '4px',
								alignSelf: 'stretch',
								borderRadius: lib.radius.pill,
								background: lib.rainbow,
								flexShrink: 0
							}
					  })
					: null,
				el(
					'div',
					{
						style: {
							width: '38px',
							height: '38px',
							flexShrink: 0,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft)
						}
					},
					map(
						'fileType',
						{
							doc: icons.file(18, 'currentColor'),
							image: icons.image(18, 'currentColor'),
							video: icons.zap(18, 'currentColor'),
							audio: icons.bell(18, 'currentColor')
						},
						icons.file(18, 'currentColor')
					)
				),
				el(
					'div',
					{ style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 } },
					text(
						{
							fontSize: lib.fontSize.sm,
							fontWeight: 600,
							color: lib.text,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis'
						},
						'{name}'
					),
					text(captionStyle(lib), '{meta}')
				),
				icons.dots(18, lib.faint)
			)
		});

		const folderGrid = define({
			slug: `${lib.id}-file-manager-folder-grid`,
			name: 'Folder Grid',
			library: lib.id,
			category: 'files',
			description: `Folder tile grid in the ${lib.label} style — tone-colored folder glyphs with name and item-count captions, the selected tile lifted by the library focus ring${lib.id === 'reactflow' ? ' and the React Flow accent border' : ''}.`,
			tags: ['folder', 'grid', 'files', 'tiles'],
			args: [
				stringArg('name', 'Design assets', { label: 'Selected folder', maxLength: 30 }),
				stringArg('items', '24', { label: 'Item count', maxLength: 6 }),
				numberArg('folders', 3, { label: 'More folders', min: 1, max: 5 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'stretch', fontFamily: lib.font } },
				el(
					'div',
					{
						style: merge(folderTile(lib), {
							borderColor: lib.id === 'reactflow' ? lib.accent : toneMap(lib, (palette) => palette.border),
							background: toneMap(lib, (palette) => palette.soft),
							boxShadow: lib.focusRing
						})
					},
					el('span', { style: { display: 'flex', color: toneMap(lib, (palette) => palette.solid) } }, icons.folder(20, 'currentColor')),
					text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '{name}'),
					text(captionStyle(lib), '{items} items')
				),
				repeat(
					'folders',
					5,
					el(
						'div',
						{ style: folderTile(lib) },
						el('span', { style: { display: 'flex', color: toneMap(lib, (palette) => palette.solid) } }, icons.folder(20, 'currentColor')),
						text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, 'Folder 0{n}'),
						text(captionStyle(lib), 'Updated {n}d ago')
					)
				)
			)
		});

		const upload = define({
			slug: `${lib.id}-file-manager-upload`,
			name: 'Upload Dropzone',
			library: lib.id,
			category: 'files',
			description: `Drag-and-drop upload zone in the ${lib.label} style — dashed border, tinted upload badge, and a browse link, with an optional in-flight file row driving a live percent progress bar${lib.id === 'thingtime' ? ' filled by the house rainbow' : ''}.`,
			tags: ['upload', 'dropzone', 'files', 'progress'],
			args: [
				booleanArg('uploading', true, { label: 'Uploading' }),
				stringArg('fileName', 'photos.zip', { label: 'File name', maxLength: 30 }),
				numberArg('percent', 64, { label: 'Percent', min: 0, max: 100 }),
				stringArg('hint', 'PNG, JPG or ZIP up to 25 MB', { label: 'Hint', maxLength: 60 }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '8px',
						width: '300px',
						padding: '24px 16px',
						boxSizing: 'border-box',
						fontFamily: lib.font,
						background: lib.surfaceAlt,
						borderWidth: lib.id === 'daisyui' ? '2px' : '1px',
						borderStyle: 'dashed',
						borderColor: lib.id === 'reactflow' ? lib.dot : lib.border,
						borderRadius: lib.id === 'antd' ? lib.radius.sm : lib.radius.lg
					}
				},
				el(
					'div',
					{
						style: {
							width: '40px',
							height: '40px',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							borderRadius: lib.radius.pill,
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft)
						}
					},
					icons.upload(18, 'currentColor')
				),
				el(
					'div',
					{ style: { display: 'flex', gap: '4px', fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text } },
					'Drop files or',
					el(
						'span',
						{
							style: {
								color: lib.id === 'reactflow' ? lib.accent : toneMap(lib, (palette) => palette.solid),
								fontWeight: 600,
								textDecoration: 'underline',
								cursor: 'pointer'
							}
						},
						'browse'
					)
				),
				text(captionStyle(lib), '{hint}'),
				iff(
					'uploading',
					el(
						'div',
						{
							style: {
								display: 'flex',
								alignItems: 'center',
								gap: '8px',
								width: '100%',
								marginTop: '4px',
								padding: '8px 10px',
								boxSizing: 'border-box',
								background: lib.surface,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.borderSoft,
								borderRadius: surfaceRadius(lib)
							}
						},
						el('span', { style: { display: 'flex', flexShrink: 0, color: lib.muted } }, icons.file(14, 'currentColor')),
						text({ fontSize: lib.fontSize.xs, fontWeight: 500, color: lib.text, whiteSpace: 'nowrap' }, '{fileName}'),
						el(
							'div',
							{
								style: {
									flex: 1,
									height: '6px',
									borderRadius: lib.radius.pill,
									background: lib.borderSoft,
									overflow: 'hidden'
								}
							},
							el('div', {
								style: {
									width: '{percent}%',
									height: '6px',
									borderRadius: lib.radius.pill,
									background: lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid)
								}
							})
						),
						text({ fontSize: lib.fontSize.xs, color: lib.muted, flexShrink: 0 }, '{percent}%')
					)
				)
			)
		});

		const storage = define({
			slug: `${lib.id}-file-manager-storage`,
			name: 'Storage Meter',
			library: lib.id,
			category: 'files',
			description: `Storage meter card in the ${lib.label} style — a segmented usage bar with solid and tinted tone spans over a used-of-total caption, closed by a quiet upgrade button${lib.uppercaseButtons ? ' in Material uppercase' : ''}.`,
			tags: ['storage', 'meter', 'usage', 'card'],
			args: [
				stringArg('used', '68 GB', { label: 'Used', maxLength: 12 }),
				stringArg('total', '100 GB', { label: 'Total', maxLength: 12 }),
				stringArg('cta', 'Upgrade', { label: 'Button label', maxLength: 24 }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						flexDirection: 'column',
						gap: '10px',
						width: '280px',
						padding: '16px',
						boxSizing: 'border-box',
						fontFamily: lib.font,
						background: lib.surface,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.border,
						borderRadius: surfaceRadius(lib),
						boxShadow: lib.id === 'mui' ? lib.shadow.md : quietShadow(lib)
					}
				},
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '8px' } },
					el('span', { style: { display: 'flex', color: toneMap(lib, (palette) => palette.solid) } }, icons.folder(16, 'currentColor')),
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, 'Storage')
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							height: '8px',
							borderRadius: lib.radius.pill,
							background: lib.borderSoft,
							overflow: 'hidden'
						}
					},
					el('div', {
						style: {
							width: '46%',
							height: '8px',
							background: lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid)
						}
					}),
					el('div', {
						style: { width: '26%', height: '8px', background: toneMap(lib, (palette) => palette.soft) }
					})
				),
				text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{used} of {total} used'),
				el(
					'button',
					{
						type: 'button',
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							alignSelf: 'flex-start',
							height: lib.control.sm,
							padding: '0 12px',
							background: 'transparent',
							border: 'none',
							cursor: 'pointer',
							borderRadius: surfaceRadius(lib),
							fontFamily: lib.font,
							fontWeight: lib.buttonWeight,
							fontSize: lib.fontSize.sm,
							color: lib.id === 'reactflow' ? lib.accent : toneMap(lib, (palette) => palette.solid),
							...upperCase(lib)
						}
					},
					'{cta}'
				)
			)
		});

		const toolbar = define({
			slug: `${lib.id}-file-manager-toolbar`,
			name: 'File Toolbar',
			library: lib.id,
			category: 'files',
			description: `File browser toolbar in the ${lib.label} style — Home breadcrumb into the current folder, a grid/list view toggle, a sort mock, and a tone-solid new-folder button${lib.uppercaseButtons ? ' with the Material uppercase label' : ''}.`,
			tags: ['toolbar', 'files', 'breadcrumb', 'browser'],
			args: [
				stringArg('folder', 'Design', { label: 'Folder', maxLength: 24 }),
				enumArg('view', ['grid', 'list'], 'grid', { label: 'View' }),
				stringArg('sort', 'Name', { label: 'Sort by', maxLength: 16 }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						gap: '12px',
						width: '460px',
						padding: '8px 12px',
						boxSizing: 'border-box',
						fontFamily: lib.font,
						background: lib.surface,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.border,
						borderRadius: surfaceRadius(lib),
						boxShadow: quietShadow(lib)
					}
				},
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
					text({ fontSize: lib.fontSize.sm, color: lib.muted }, 'Home'),
					el('span', { style: { display: 'flex', color: lib.faint } }, icons.chevronRight(12, 'currentColor')),
					text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text, whiteSpace: 'nowrap' }, '{folder}')
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' } },
					el(
						'div',
						{
							style: {
								display: 'flex',
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.border,
								borderRadius: lib.id === 'antd' ? lib.radius.xs : surfaceRadius(lib),
								overflow: 'hidden'
							}
						},
						el(
							'span',
							{
								style: merge(
									toggleCell(lib),
									ifEq(
										'view',
										'grid',
										{
											background: toneMap(lib, (palette) => palette.soft),
											color: lib.id === 'reactflow' ? lib.accent : toneMap(lib, (palette) => palette.onSoft)
										},
										{}
									)
								)
							},
							gridGlyph(14)
						),
						el(
							'span',
							{
								style: merge(
									toggleCell(lib),
									ifEq(
										'view',
										'list',
										{
											background: toneMap(lib, (palette) => palette.soft),
											color: lib.id === 'reactflow' ? lib.accent : toneMap(lib, (palette) => palette.onSoft)
										},
										{}
									)
								)
							},
							listGlyph(14)
						)
					),
					el(
						'div',
						{
							style: {
								display: 'flex',
								alignItems: 'center',
								gap: '6px',
								height: lib.control.sm,
								padding: '0 10px',
								boxSizing: 'border-box',
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.border,
								borderRadius: surfaceRadius(lib),
								background: lib.surface,
								fontSize: lib.fontSize.sm,
								color: lib.text,
								cursor: 'pointer'
							}
						},
						'{sort}',
						el('span', { style: { display: 'flex', color: lib.faint } }, icons.chevronDown(12, 'currentColor'))
					),
					el(
						'button',
						{
							type: 'button',
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								gap: '6px',
								height: lib.control.sm,
								padding: '0 12px',
								border: 'none',
								cursor: 'pointer',
								borderRadius: surfaceRadius(lib),
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								fontFamily: lib.font,
								fontWeight: lib.buttonWeight,
								fontSize: lib.fontSize.sm,
								boxShadow: lib.id === 'mui' ? lib.shadow.sm : 'none',
								...upperCase(lib)
							}
						},
						icons.plus(13, 'currentColor'),
						'New folder'
					)
				)
			)
		});

		return [fileRow, folderGrid, upload, storage, toolbar];
	}
};
