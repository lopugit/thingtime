// Shared builders for component archetypes. A component's `render` is an
// HtmlThingNode template — the exact JSON tree remix/app/components/Kinds/
// HtmlThingRenderer.tsx renders (allowlisted tags/props, object styles only),
// extended with a tiny arg-template DSL resolved client-side BEFORE rendering
// (remix/app/components/ComponentsLibrary/componentTemplate.ts):
//
//   "…{argName}…"                                   string interpolation
//   { ttArg: 'name' }                               raw arg value
//   { ttMap: { arg, values: {...}, default } }      lookup by String(arg)
//   { ttIf: { arg, equals?, then, else? } }         conditional (truthy w/o equals)
//   { ttMerge: [styleA, styleB, …] }                merge resolved style objects
//   { ttRepeat: { arg|count, max, node } }          repeat node; {index} / {n}
//                                                   interpolate inside (1-based n)
//
// DSL keys deliberately avoid a '$' prefix: the server render sanitizer
// (checkSchemaRenderTree) rejects '$'-prefixed keys before Mongo storage.
// Keep every template within the renderer budget: ≤600 nodes, ≤24 depth.

export const el = (tag, props, ...children) => {
	const node = { tag };
	if (props && Object.keys(props).length) node.props = props;
	const kids = children.flat().filter((child) => child !== null && child !== undefined && child !== false);
	if (kids.length) node.children = kids;
	return node;
};

export const div = (style, ...children) => el('div', style ? { style } : undefined, ...children);
export const span = (style, ...children) => el('span', style ? { style } : undefined, ...children);
export const text = (style, value) => el('span', { style }, value);

export const row = (style, ...children) =>
	el('div', { style: { display: 'flex', alignItems: 'center', ...style } }, ...children);
export const stack = (style, ...children) =>
	el('div', { style: { display: 'flex', flexDirection: 'column', ...style } }, ...children);

// --- arg-template DSL shorthands -------------------------------------------

export const arg = (name) => ({ ttArg: name });
export const map = (argName, values, fallback) => ({
	ttMap: { arg: argName, values, ...(fallback === undefined ? {} : { default: fallback }) }
});
export const iff = (argName, then, orElse) => ({ ttIf: { arg: argName, then, ...(orElse === undefined ? {} : { else: orElse }) } });
export const ifEq = (argName, equals, then, orElse) => ({
	ttIf: { arg: argName, equals, then, ...(orElse === undefined ? {} : { else: orElse }) }
});
export const merge = (...styles) => ({ ttMerge: styles.filter(Boolean) });
export const repeat = (argName, max, node) => ({ ttRepeat: { arg: argName, max, node } });

// Map a `tone` arg (primary/success/…) onto a per-tone token lookup.
export const toneMap = (lib, pick, fallbackTone = 'primary') => {
	const values = {};
	for (const [tone, palette] of Object.entries(lib.palette)) values[tone] = pick(palette, tone);
	return { ttMap: { arg: 'tone', values, default: values[fallbackTone] } };
};

// --- arg descriptors ---------------------------------------------------------

export const stringArg = (name, def, extra = {}) => ({ name, type: 'string', default: def, ...extra });
export const textArg = (name, def, extra = {}) => ({ name, type: 'text', default: def, ...extra });
export const numberArg = (name, def, extra = {}) => ({ name, type: 'number', default: def, ...extra });
export const booleanArg = (name, def, extra = {}) => ({ name, type: 'boolean', default: def, ...extra });
export const enumArg = (name, values, def, extra = {}) => ({ name, type: 'enum', values, default: def ?? values[0], ...extra });
export const colorArg = (name, def, extra = {}) => ({ name, type: 'color', default: def, ...extra });

export const toneArg = (tones = ['primary', 'success', 'warning', 'danger', 'info', 'neutral'], def = 'primary') =>
	enumArg('tone', tones, def, { label: 'Tone' });

// --- svg icons (allowlisted svg/path/circle/rect/line/polyline/polygon) -----

const svgBase = (size, viewBox, stroke, ...children) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox,
			fill: 'none',
			stroke,
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		...children
	);

export const icons = {
	check: (size, color) => svgBase(size, '0 0 24 24', color, el('polyline', { points: '20 6 9 17 4 12' })),
	x: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('line', { x1: 18, y1: 6, x2: 6, y2: 18 }), el('line', { x1: 6, y1: 6, x2: 18, y2: 18 })),
	plus: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('line', { x1: 12, y1: 5, x2: 12, y2: 19 }), el('line', { x1: 5, y1: 12, x2: 19, y2: 12 })),
	chevronDown: (size, color) => svgBase(size, '0 0 24 24', color, el('polyline', { points: '6 9 12 15 18 9' })),
	chevronRight: (size, color) => svgBase(size, '0 0 24 24', color, el('polyline', { points: '9 6 15 12 9 18' })),
	arrowRight: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('line', { x1: 5, y1: 12, x2: 19, y2: 12 }), el('polyline', { points: '12 5 19 12 12 19' })),
	arrowUp: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('line', { x1: 12, y1: 19, x2: 12, y2: 5 }), el('polyline', { points: '5 12 12 5 19 12' })),
	arrowDown: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('line', { x1: 12, y1: 5, x2: 12, y2: 19 }), el('polyline', { points: '19 12 12 19 5 12' })),
	search: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('circle', { cx: 11, cy: 11, r: 7 }), el('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })),
	star: (size, color, filled) =>
		el(
			'svg',
			{ width: size, height: size, viewBox: '0 0 24 24', fill: filled ? color : 'none', stroke: color, strokeWidth: 2, strokeLinejoin: 'round', xmlns: 'http://www.w3.org/2000/svg' },
			el('polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26' })
		),
	info: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('circle', { cx: 12, cy: 12, r: 10 }), el('line', { x1: 12, y1: 16, x2: 12, y2: 12 }), el('line', { x1: 12, y1: 8, x2: 12.01, y2: 8 })),
	alert: (size, color) =>
		svgBase(
			size,
			'0 0 24 24',
			color,
			el('path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }),
			el('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
			el('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 })
		),
	user: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }), el('circle', { cx: 12, cy: 7, r: 4 })),
	bell: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }), el('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' })),
	mail: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }), el('polyline', { points: '22 6 12 13 2 6' })),
	settings: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('circle', { cx: 12, cy: 12, r: 3 }), el('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' })),
	heart: (size, color, filled) =>
		el(
			'svg',
			{ width: size, height: size, viewBox: '0 0 24 24', fill: filled ? color : 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', xmlns: 'http://www.w3.org/2000/svg' },
			el('path', { d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' })
		),
	home: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('path', { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }), el('polyline', { points: '9 22 9 12 15 12 15 22' })),
	folder: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' })),
	file: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('path', { d: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z' }), el('polyline', { points: '13 2 13 9 20 9' })),
	image: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }), el('circle', { cx: 8.5, cy: 8.5, r: 1.5 }), el('polyline', { points: '21 15 16 10 5 21' })),
	upload: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }), el('polyline', { points: '17 8 12 3 7 8' }), el('line', { x1: 12, y1: 3, x2: 12, y2: 15 })),
	download: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }), el('polyline', { points: '7 10 12 15 17 10' }), el('line', { x1: 12, y1: 15, x2: 12, y2: 3 })),
	trash: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('polyline', { points: '3 6 5 6 21 6' }), el('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' })),
	edit: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }), el('path', { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' })),
	calendar: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }), el('line', { x1: 16, y1: 2, x2: 16, y2: 6 }), el('line', { x1: 8, y1: 2, x2: 8, y2: 6 }), el('line', { x1: 3, y1: 10, x2: 21, y2: 10 })),
	clock: (size, color) =>
		svgBase(size, '0 0 24 24', color, el('circle', { cx: 12, cy: 12, r: 10 }), el('polyline', { points: '12 6 12 12 16 14' })),
	dots: (size, color) =>
		el(
			'svg',
			{ width: size, height: size, viewBox: '0 0 24 24', fill: color, xmlns: 'http://www.w3.org/2000/svg' },
			el('circle', { cx: 12, cy: 12, r: 1.6 }),
			el('circle', { cx: 19, cy: 12, r: 1.6 }),
			el('circle', { cx: 5, cy: 12, r: 1.6 })
		),
	zap: (size, color) => svgBase(size, '0 0 24 24', color, el('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }))
};

// Initials avatar circle (no external images — initials keep it self-contained).
export const avatarCircle = (size, background, colorText, label, fontSize, extra = {}) =>
	el(
		'div',
		{
			style: {
				width: size,
				height: size,
				borderRadius: '999px',
				background,
				color: colorText,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				fontWeight: 600,
				fontSize,
				flexShrink: 0,
				...extra
			}
		},
		label
	);

// --- definition assembly -----------------------------------------------------

// Assemble one catalog entry. The generator stamps ids/versioning; builders
// provide the human-facing surface + args + render template.
export const define = ({ slug, name, library, category, description, tags = [], args = [], render, previewBg }) => ({
	slug,
	name,
	library,
	category,
	description,
	tags,
	args,
	render,
	...(previewBg ? { previewBg } : {})
});
