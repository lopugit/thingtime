// Window-chrome archetype — app-frame mockups for showcasing other content:
// browser window, phone frame, desktop app window, editor tab strip, and a
// dock bar. Follows the button.mjs exemplar: exactly 5 variants, `build(lib)`
// returns exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-window-chrome-<variant>`.
//
// Sanctioned literals: macOS traffic-light hexes (#ff5f57/#febc2e/#28c840)
// and rgba translucency for the frosted dock bar. Everything else styles
// itself from the library token set.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	ifEq,
	iff,
	merge,
	numberArg,
	repeat,
	row,
	stack,
	stringArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Thingtime's ink for bezels/indicators; every other library uses its text ink.
const ink = (lib) => lib.ink || lib.text;

// mui gets real Material elevation, untitled its feather lg; others sit calm.
const frameShadow = (lib) => (lib.id === 'mui' || lib.id === 'untitled' ? lib.shadow.lg : lib.shadow.md);

// reactflow content areas become dotted canvases — the node-graph wink.
const canvasBg = (lib) =>
	lib.id === 'reactflow'
		? { backgroundImage: `radial-gradient(${lib.dot} 1px, transparent 1px)`, backgroundSize: '14px 14px' }
		: {};

const trafficDot = (color) =>
	el('span', { style: { width: '10px', height: '10px', borderRadius: '999px', background: color, flexShrink: 0 } });

const trafficLights = () => row({ gap: '6px', flexShrink: 0 }, trafficDot('#ff5f57'), trafficDot('#febc2e'), trafficDot('#28c840'));

const chevronLeft = (size, color) =>
	el(
		'svg',
		{ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', xmlns: 'http://www.w3.org/2000/svg' },
		el('polyline', { points: '15 6 9 12 15 18' })
	);

const frame = (lib, width) => ({
	width,
	maxWidth: '100%',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	background: lib.surface,
	overflow: 'hidden',
	boxShadow: frameShadow(lib),
	fontFamily: lib.font
});

// Thingtime frames carry the house rainbow as a hairline under the chrome bar.
const rainbowStrip = (lib) => (lib.id === 'thingtime' ? el('div', { style: { height: '3px', background: lib.rainbow } }) : null);

const skeletonLine = (lib, height, step) =>
	el('div', {
		style: { height, borderRadius: lib.radius.xs, background: lib.borderSoft, width: `calc(100% - {index} * ${step})` }
	});

export const archetype = {
	id: 'window-chrome',
	category: 'mockups',
	variants: ['browser', 'phone', 'window', 'tabs', 'dock'],
	build(lib) {
		const browser = define({
			slug: `${lib.id}-window-chrome-browser`,
			name: 'Browser Window',
			library: lib.id,
			category: 'mockups',
			description: `Browser window mockup in the ${lib.label} style — traffic-light dots, back/forward chevrons and a pill URL bar with a star, over muted placeholder content lines.`,
			tags: ['mockup', 'browser', 'window', 'frame'],
			args: [
				stringArg('url', 'thingtime.com', { label: 'URL', maxLength: 60 }),
				numberArg('lines', 4, { label: 'Content lines' }),
				booleanArg('starred', false, { label: 'Starred' })
			],
			render: stack(
				frame(lib, '320px'),
				row(
					{
						gap: '9px',
						padding: '8px 10px',
						background: lib.surfaceAlt,
						borderBottomWidth: '1px',
						borderBottomStyle: 'solid',
						borderBottomColor: lib.borderSoft
					},
					trafficLights(),
					chevronLeft(14, lib.muted),
					icons.chevronRight(14, lib.faint),
					el(
						'div',
						{
							style: {
								display: 'flex',
								alignItems: 'center',
								gap: '8px',
								flexGrow: 1,
								minWidth: 0,
								height: '24px',
								padding: '0 10px',
								background: lib.surface,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.borderSoft,
								borderRadius: lib.radius.pill,
								fontSize: lib.fontSize.xs,
								color: lib.muted
							}
						},
						el('span', { style: { flexGrow: 1, overflow: 'hidden', whiteSpace: 'nowrap' } }, '{url}'),
						iff(
							'starred',
							icons.star(12, lib.accent || lib.palette.warning.solid, true),
							icons.star(12, lib.faint, false)
						)
					)
				),
				rainbowStrip(lib),
				stack({ gap: '8px', padding: '14px', ...canvasBg(lib) }, repeat('lines', 8, skeletonLine(lib, '10px', '11%')))
			)
		});

		const phone = define({
			slug: `${lib.id}-window-chrome-phone`,
			name: 'Phone Frame',
			library: lib.id,
			category: 'mockups',
			description: `Phone frame mockup in the ${lib.label} style — ${lib.id === 'daisyui' ? 'extra-chunky' : 'thick'} bezel, notch or punch-hole cutout, a status bar with time, signal and battery, tone hero block, placeholder lines and a home indicator.`,
			tags: ['mockup', 'phone', 'mobile', 'frame'],
			args: [
				stringArg('time', '9:41', { label: 'Status time', maxLength: 8 }),
				enumArg('cutout', ['notch', 'punch'], 'notch', { label: 'Cutout' }),
				numberArg('blocks', 3, { label: 'Content lines' }),
				toneArg()
			],
			render: stack(
				{
					width: '190px',
					borderWidth: lib.id === 'daisyui' ? '7px' : '5px',
					borderStyle: 'solid',
					borderColor: ink(lib),
					borderRadius: '30px',
					background: lib.surface,
					overflow: 'hidden',
					boxShadow: frameShadow(lib),
					fontFamily: lib.font
				},
				row(
					{ justifyContent: 'center', alignItems: 'flex-start', height: '16px' },
					ifEq(
						'cutout',
						'notch',
						el('div', { style: { width: '74px', height: '13px', borderRadius: '0 0 10px 10px', background: ink(lib) } }),
						el('div', { style: { width: '10px', height: '10px', borderRadius: '999px', background: ink(lib), marginTop: '3px' } })
					)
				),
				row(
					{ justifyContent: 'space-between', padding: '2px 14px', fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.text },
					'{time}',
					row(
						{ gap: '5px' },
						el(
							'svg',
							{ width: 12, height: 10, viewBox: '0 0 12 10', fill: lib.text, xmlns: 'http://www.w3.org/2000/svg' },
							el('rect', { x: 0, y: 6, width: 2.5, height: 4, rx: 0.8 }),
							el('rect', { x: 4.5, y: 3.5, width: 2.5, height: 6.5, rx: 0.8 }),
							el('rect', { x: 9, y: 0.5, width: 2.5, height: 9.5, rx: 0.8 })
						),
						el(
							'svg',
							{ width: 18, height: 10, viewBox: '0 0 18 10', fill: 'none', stroke: lib.text, strokeWidth: 1, xmlns: 'http://www.w3.org/2000/svg' },
							el('rect', { x: 0.5, y: 1, width: 13, height: 8, rx: 2 }),
							el('rect', { x: 2.5, y: 3, width: 7, height: 4, rx: 1, fill: lib.text, stroke: 'none' }),
							el('line', { x1: 15.5, y1: 3.5, x2: 15.5, y2: 6.5 })
						)
					)
				),
				stack(
					{ gap: '8px', padding: '12px' },
					el('div', { style: { height: '58px', borderRadius: lib.radius.md, background: toneMap(lib, (palette) => palette.soft) } }),
					repeat('blocks', 6, skeletonLine(lib, '10px', '12%'))
				),
				row(
					{ justifyContent: 'center', padding: '2px 0 7px' },
					el('div', { style: { width: '54px', height: '4px', borderRadius: '999px', background: ink(lib) } })
				)
			)
		});

		const windowDef = define({
			slug: `${lib.id}-window-chrome-window`,
			name: 'App Window',
			library: lib.id,
			category: 'mockups',
			description: `Desktop app window in the ${lib.label} style — traffic lights beside a centered title bar, a sidebar rail with one tone-highlighted row, and a skeleton content pane.`,
			tags: ['mockup', 'window', 'desktop', 'app', 'frame'],
			args: [
				stringArg('title', 'Project Overview', { label: 'Window title', maxLength: 40 }),
				toneArg(),
				numberArg('navItems', 4, { label: 'Sidebar rows' }),
				numberArg('lines', 4, { label: 'Content lines' })
			],
			render: stack(
				frame(lib, '340px'),
				row(
					{
						gap: '8px',
						padding: '8px 10px',
						background: lib.surfaceAlt,
						borderBottomWidth: '1px',
						borderBottomStyle: 'solid',
						borderBottomColor: lib.borderSoft
					},
					trafficLights(),
					el(
						'span',
						{
							style: {
								flexGrow: 1,
								textAlign: 'center',
								fontSize: lib.fontSize.xs,
								fontWeight: lib.headingWeight,
								color: lib.muted,
								overflow: 'hidden',
								whiteSpace: 'nowrap'
							}
						},
						'{title}'
					),
					el('div', { style: { width: '42px', flexShrink: 0 } })
				),
				rainbowStrip(lib),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'stretch' } },
					stack(
						{
							gap: '7px',
							width: '92px',
							flexShrink: 0,
							padding: '10px 8px',
							background: lib.surfaceAlt,
							borderRightWidth: '1px',
							borderRightStyle: 'solid',
							borderRightColor: lib.borderSoft
						},
						row(
							{ gap: '6px', padding: '5px 6px', borderRadius: lib.radius.xs, background: toneMap(lib, (palette) => palette.soft) },
							el('span', {
								style: {
									width: '6px',
									height: '6px',
									borderRadius: '999px',
									background: toneMap(lib, (palette) => palette.solid),
									flexShrink: 0
								}
							}),
							el('span', {
								style: { height: '6px', borderRadius: '999px', background: toneMap(lib, (palette) => palette.border), flexGrow: 1 }
							})
						),
						repeat(
							'navItems',
							6,
							row(
								{ gap: '6px', padding: '5px 6px' },
								el('span', { style: { width: '6px', height: '6px', borderRadius: '999px', background: lib.faint, flexShrink: 0 } }),
								el('span', { style: { height: '6px', borderRadius: '999px', background: lib.borderSoft, flexGrow: 1 } })
							)
						)
					),
					stack(
						{ gap: '8px', padding: '12px', flexGrow: 1, ...canvasBg(lib) },
						el('div', { style: { height: '12px', width: '55%', borderRadius: lib.radius.xs, background: lib.border } }),
						repeat('lines', 6, skeletonLine(lib, '8px', '9%'))
					)
				)
			)
		});

		// antd + reactflow wear the indicator as a crisp topline; the rest get a
		// Material-style underline (mui also uppercases its tab labels).
		const indicatorSide = lib.id === 'antd' || lib.id === 'reactflow' ? 'Top' : 'Bottom';
		const restingTab = (label) =>
			row({ gap: '6px', padding: '6px 10px', fontSize: lib.fontSize.xs, color: lib.muted, flexShrink: 0 }, label);

		const tabs = define({
			slug: `${lib.id}-window-chrome-tabs`,
			name: 'Editor Tabs',
			library: lib.id,
			category: 'mockups',
			description: `Editor tab strip in the ${lib.label} style — an active file tab with a tone ${indicatorSide === 'Top' ? 'topline' : 'underline'} and close x, two resting tabs, an optional plus tab, and a breadcrumb path row.`,
			tags: ['mockup', 'tabs', 'editor', 'ide', 'frame'],
			args: [
				stringArg('file', 'App.tsx', { label: 'Active file', maxLength: 24 }),
				toneArg(),
				booleanArg('plusTab', true, { label: 'Show + tab' }),
				stringArg('path', 'src / components', { label: 'Breadcrumb path', maxLength: 40 })
			],
			render: stack(
				frame(lib, '340px'),
				row(
					{
						alignItems: 'flex-end',
						gap: '2px',
						padding: '6px 8px 0',
						background: lib.surfaceAlt,
						borderBottomWidth: '1px',
						borderBottomStyle: 'solid',
						borderBottomColor: lib.border,
						...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
					},
					row(
						{
							gap: '8px',
							padding: '6px 10px',
							background: lib.surface,
							borderTopLeftRadius: lib.radius.xs,
							borderTopRightRadius: lib.radius.xs,
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							color: lib.text,
							flexShrink: 0,
							[`border${indicatorSide}Width`]: '2px',
							[`border${indicatorSide}Style`]: 'solid',
							[`border${indicatorSide}Color`]: toneMap(lib, (palette) => palette.solid)
						},
						'{file}',
						icons.x(10, lib.muted)
					),
					restingTab('index.ts'),
					restingTab('styles.css'),
					iff('plusTab', row({ padding: '6px 8px', flexShrink: 0 }, icons.plus(12, lib.muted)))
				),
				row(
					{ gap: '6px', padding: '7px 10px', fontSize: lib.fontSize.xs, color: lib.muted, fontFamily: lib.fontMono },
					'{path}',
					icons.chevronRight(10, lib.faint),
					el('span', { style: { color: lib.text, fontWeight: 600 } }, '{file}')
				)
			)
		});

		// Five fixed-tone tiles, alternating solid/soft fills, tiny app glyphs.
		const tiles = [
			{ tone: 'primary', mode: 'solid', icon: icons.zap },
			{ tone: 'info', mode: 'soft', icon: icons.mail },
			{ tone: 'success', mode: 'solid', icon: icons.image },
			{ tone: 'warning', mode: 'soft', icon: icons.calendar },
			{ tone: 'danger', mode: 'solid', icon: icons.settings }
		];
		const dockTile = (k, spec) => {
			const palette = lib.palette[spec.tone];
			return stack(
				{ alignItems: 'center', gap: '4px' },
				el(
					'div',
					{
						style: merge(
							{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.md,
								background: spec.mode === 'solid' ? palette.solid : palette.soft,
								boxShadow: lib.shadow.sm,
								flexShrink: 0
							},
							ifEq('focused', String(k), { width: '46px', height: '46px' }, { width: '36px', height: '36px' })
						)
					},
					spec.icon(18, spec.mode === 'solid' ? palette.onSolid : palette.onSoft)
				),
				ifEq(
					'running',
					String(k),
					el('span', { style: { width: '5px', height: '5px', borderRadius: '999px', background: lib.accent || lib.muted } }),
					el('span', { style: { width: '5px', height: '5px', borderRadius: '999px', background: 'transparent' } })
				)
			);
		};

		const dock = define({
			slug: `${lib.id}-window-chrome-dock`,
			name: 'Dock Bar',
			library: lib.id,
			category: 'mockups',
			description: `Dock bar mockup in the ${lib.label} style — five tone-filled app tiles with tiny glyphs on a translucent bar over a token wallpaper, one enlarged focus tile and a running-app dot.`,
			tags: ['mockup', 'dock', 'launcher', 'apps'],
			args: [
				enumArg('focused', ['1', '2', '3', '4', '5'], '3', { label: 'Enlarged tile' }),
				enumArg('running', ['1', '2', '3', '4', '5'], '1', { label: 'Running app' }),
				booleanArg('frosted', true, { label: 'Frosted bar' })
			],
			render: el(
				'div',
				{
					style: {
						display: 'inline-flex',
						padding: '16px 18px 10px',
						borderRadius: lib.radius.lg,
						background: `linear-gradient(135deg, ${lib.palette.info.soft}, ${lib.palette.primary.soft})`
					}
				},
				row(
					{
						alignItems: 'flex-end',
						gap: '10px',
						padding: '7px 12px',
						borderRadius: lib.radius.lg,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: 'rgba(255, 255, 255, 0.6)',
						boxShadow: frameShadow(lib),
						backdropFilter: 'blur(8px)',
						background: iff('frosted', 'rgba(255, 255, 255, 0.55)', lib.surface)
					},
					tiles.map((spec, index) => dockTile(index + 1, spec))
				)
			)
		});

		return [browser, phone, windowDef, tabs, dock];
	}
};
