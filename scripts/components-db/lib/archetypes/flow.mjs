// Flow archetype — node-graph pieces with a React Flow soul, restyled per
// library: node cards with handles, io nodes with type chips, bezier edges,
// a minimap panel, and a dotted-grid canvas.
// Contract mirrors button.mjs: exactly 5 variants, `build(lib)` returns
// exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-flow-<variant>`.

import {
	booleanArg,
	define,
	el,
	iff,
	merge,
	numberArg,
	repeat,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

const TONES = ['primary', 'success', 'warning', 'danger', 'info', 'neutral'];

// React Flow ships accent/edge/dot chrome; other libraries approximate it
// from their own tokens so every rendition stays library-authentic.
const chromeOf = (lib) => ({
	accent: lib.accent || lib.palette.primary.solid,
	edge: lib.edge || lib.faint,
	dot: lib.dot || lib.faint,
	handle: lib.id === 'reactflow' ? lib.text : lib.palette.primary.solid
});

// React Flow's crisp near-black node border comes straight from its border
// token; lighter libraries get their own quiet borders.
const nodeShell = (lib, extra = {}) => ({
	fontFamily: lib.font,
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.md,
	boxShadow: lib.shadow.sm,
	boxSizing: 'border-box',
	...extra
});

const selectedRing = (lib) => {
	const chrome = chromeOf(lib);
	return iff('selected', { borderColor: chrome.accent, boxShadow: `0 0 0 1px ${chrome.accent}` }, {});
};

const handleDot = (lib, side) => {
	const chrome = chromeOf(lib);
	const place =
		side === 'top'
			? { top: '-6px', left: '50%', marginLeft: '-5px' }
			: side === 'bottom'
				? { bottom: '-6px', left: '50%', marginLeft: '-5px' }
				: side === 'left'
					? { left: '-6px', top: '50%', marginTop: '-5px' }
					: { right: '-6px', top: '50%', marginTop: '-5px' };
	return el('span', {
		style: {
			position: 'absolute',
			width: '10px',
			height: '10px',
			borderRadius: '999px',
			background: chrome.handle,
			borderWidth: '2px',
			borderStyle: 'solid',
			borderColor: lib.surface,
			boxSizing: 'border-box',
			...place
		}
	});
};

const typeChip = (lib, palette, token) =>
	el(
		'span',
		{
			style: {
				fontFamily: lib.fontMono,
				fontSize: lib.fontSize.xs,
				padding: '2px 8px',
				borderRadius: lib.radius.pill,
				background: palette.soft,
				color: palette.onSoft,
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: palette.border,
				whiteSpace: 'nowrap'
			}
		},
		token
	);

const miniNode = (lib, token, place) =>
	el(
		'div',
		{
			style: nodeShell(lib, {
				position: 'absolute',
				width: '84px',
				padding: '8px 6px',
				textAlign: 'center',
				fontSize: lib.fontSize.xs,
				fontWeight: 500,
				color: lib.text,
				...place
			})
		},
		token
	);

export const archetype = {
	id: 'flow',
	category: 'flow',
	variants: ['node', 'io-node', 'edge', 'minimap', 'canvas'],
	build(lib) {
		const chrome = chromeOf(lib);

		const node = define({
			slug: `${lib.id}-flow-node`,
			name: 'Flow Node',
			library: lib.id,
			category: 'flow',
			description: `Graph node card in the ${lib.label} style — title, mono sublabel, tone status dot, and top/bottom connection handles with an accent ring when selected.`,
			tags: ['flow', 'node', 'graph', 'handle'],
			args: [
				stringArg('label', 'Transform', { label: 'Label', maxLength: 30 }),
				stringArg('sublabel', 'normalize()', { label: 'Sublabel', maxLength: 30 }),
				toneArg(TONES, 'success'),
				booleanArg('selected', false, { label: 'Selected' })
			],
			render: el(
				'div',
				{ style: { padding: '10px 4px', display: 'inline-block' } },
				el(
					'div',
					{ style: merge(nodeShell(lib, { position: 'relative', width: '180px', padding: '10px 12px' }), selectedRing(lib)) },
					handleDot(lib, 'top'),
					row(
						{ gap: '8px' },
						el('span', {
							style: {
								width: '8px',
								height: '8px',
								borderRadius: '999px',
								background: toneMap(lib, (palette) => palette.solid, 'success'),
								flexShrink: 0
							}
						}),
						stack(
							{ gap: '2px', minWidth: '0' },
							text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{label}'),
							text({ fontSize: lib.fontSize.xs, color: lib.muted, fontFamily: lib.fontMono }, '{sublabel}')
						)
					),
					handleDot(lib, 'bottom')
				)
			)
		});

		const ioNode = define({
			slug: `${lib.id}-flow-io-node`,
			name: 'Input/Output Node',
			library: lib.id,
			category: 'flow',
			description: `Input-to-output graph node in the ${lib.label} style — side connection handles plus mono type chips for the inbound and outbound ports.`,
			tags: ['flow', 'node', 'io', 'ports', 'types'],
			args: [
				stringArg('label', 'Map fields', { label: 'Label', maxLength: 30 }),
				stringArg('inType', 'string', { label: 'Input type', maxLength: 16 }),
				stringArg('outType', 'number', { label: 'Output type', maxLength: 16 }),
				booleanArg('selected', false, { label: 'Selected' })
			],
			render: el(
				'div',
				{ style: { padding: '4px 10px', display: 'inline-block' } },
				el(
					'div',
					{ style: merge(nodeShell(lib, { position: 'relative', width: '208px', padding: '10px 14px' }), selectedRing(lib)) },
					handleDot(lib, 'left'),
					handleDot(lib, 'right'),
					stack(
						{ gap: '8px' },
						text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{label}'),
						row(
							{ gap: '6px', justifyContent: 'space-between' },
							typeChip(lib, lib.palette.info, 'in: {inType}'),
							typeChip(lib, lib.palette.success, 'out: {outType}')
						)
					)
				)
			)
		});

		const edge = define({
			slug: `${lib.id}-flow-edge`,
			name: 'Bezier Edge',
			library: lib.id,
			category: 'flow',
			description: `Two mini graph nodes joined by an svg bezier edge in the ${lib.label} style — tone-colored curve with endpoint dots and an optional dashed stroke.`,
			tags: ['flow', 'edge', 'bezier', 'connector', 'svg'],
			args: [
				stringArg('fromLabel', 'Source', { label: 'From label', maxLength: 20 }),
				stringArg('toLabel', 'Target', { label: 'To label', maxLength: 20 }),
				toneArg(TONES, 'neutral'),
				booleanArg('dashed', false, { label: 'Dashed' })
			],
			render: el(
				'div',
				{ style: { position: 'relative', width: '260px', height: '120px', fontFamily: lib.font } },
				el(
					'svg',
					{
						width: 260,
						height: 120,
						viewBox: '0 0 260 120',
						fill: 'none',
						xmlns: 'http://www.w3.org/2000/svg',
						style: { position: 'absolute', top: '0', left: '0' }
					},
					el('path', {
						d: 'M 84 30 C 138 30 122 90 176 90',
						stroke: toneMap(lib, (palette) => palette.solid, 'neutral'),
						strokeWidth: 1.5,
						style: { strokeDasharray: iff('dashed', '7 5', 'none') }
					}),
					el('circle', { cx: 84, cy: 30, r: 3, fill: toneMap(lib, (palette) => palette.solid, 'neutral') }),
					el('circle', { cx: 176, cy: 90, r: 3, fill: toneMap(lib, (palette) => palette.solid, 'neutral') })
				),
				miniNode(lib, '{fromLabel}', { left: '0', top: '12px' }),
				miniNode(lib, '{toLabel}', { right: '0', bottom: '12px' })
			)
		});

		const minimap = define({
			slug: `${lib.id}-flow-minimap`,
			name: 'Flow Minimap',
			library: lib.id,
			category: 'flow',
			description: `Graph minimap panel in the ${lib.label} style — a muted surface scattered with node blocks and a tone-colored viewport rectangle overlay.`,
			tags: ['flow', 'minimap', 'viewport', 'panel'],
			args: [
				numberArg('nodes', 6, { label: 'Nodes', min: 0, max: 12 }),
				toneArg(),
				stringArg('label', 'Graph overview', { label: 'Caption', maxLength: 40 })
			],
			render: stack(
				{ fontFamily: lib.font, gap: '6px', width: '180px' },
				el(
					'div',
					{
						style: {
							position: 'relative',
							width: '180px',
							height: '112px',
							background: lib.surfaceAlt,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.borderSoft,
							borderRadius: lib.radius.md,
							boxShadow: lib.shadow.sm,
							padding: '10px',
							boxSizing: 'border-box',
							display: 'flex',
							flexWrap: 'wrap',
							gap: '9px',
							alignContent: 'flex-start',
							overflow: 'hidden'
						}
					},
					repeat(
						'nodes',
						12,
						el('span', {
							style: {
								width: '24px',
								height: '13px',
								borderRadius: lib.radius.xs,
								background: lib.surface,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: chrome.dot,
								boxSizing: 'border-box'
							}
						})
					),
					el('span', {
						style: {
							position: 'absolute',
							left: '28%',
							top: '20%',
							width: '46%',
							height: '52%',
							borderWidth: '2px',
							borderStyle: 'solid',
							borderColor: toneMap(lib, (palette) => palette.solid),
							borderRadius: lib.radius.xs,
							boxSizing: 'border-box'
						}
					})
				),
				text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{label}')
			)
		});

		const canvas = define({
			slug: `${lib.id}-flow-canvas`,
			name: 'Flow Canvas',
			library: lib.id,
			category: 'flow',
			description: `Dotted-grid graph canvas in the ${lib.label} style — repeating radial-gradient dot field holding positioned nodes joined by svg bezier connectors, with a toggleable third node.`,
			tags: ['flow', 'canvas', 'grid', 'graph', 'svg'],
			args: [
				stringArg('nodeA', 'Input', { label: 'Node A', maxLength: 16 }),
				stringArg('nodeB', 'Process', { label: 'Node B', maxLength: 16 }),
				stringArg('nodeC', 'Output', { label: 'Node C', maxLength: 16 }),
				booleanArg('showThird', true, { label: 'Show third node' }),
				toneArg(TONES, 'neutral')
			],
			render: el(
				'div',
				{
					style: {
						position: 'relative',
						width: '300px',
						height: '180px',
						fontFamily: lib.font,
						backgroundColor: lib.bg,
						backgroundImage: `radial-gradient(circle, ${chrome.dot} 1px, transparent 1px)`,
						backgroundSize: '14px 14px',
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.borderSoft,
						borderRadius: lib.radius.lg,
						boxShadow: lib.shadow.sm,
						overflow: 'hidden',
						boxSizing: 'border-box'
					}
				},
				el(
					'svg',
					{
						width: 300,
						height: 180,
						viewBox: '0 0 300 180',
						fill: 'none',
						xmlns: 'http://www.w3.org/2000/svg',
						style: { position: 'absolute', top: '0', left: '0' }
					},
					el('path', {
						d: 'M 100 45 C 136 45 134 93 170 93',
						stroke: toneMap(lib, (palette) => palette.solid, 'neutral'),
						strokeWidth: 1.5
					}),
					iff(
						'showThird',
						el('path', {
							d: 'M 212 108 C 212 143 180 143 140 143',
							stroke: toneMap(lib, (palette) => palette.solid, 'neutral'),
							strokeWidth: 1.5
						})
					)
				),
				miniNode(lib, '{nodeA}', { left: '16px', top: '30px' }),
				miniNode(lib, '{nodeB}', { left: '170px', top: '78px' }),
				iff('showThird', miniNode(lib, '{nodeC}', { left: '56px', top: '128px' }))
			)
		});

		return [node, ioNode, edge, minimap, canvas];
	}
};
