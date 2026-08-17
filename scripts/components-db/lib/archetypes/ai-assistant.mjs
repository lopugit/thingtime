// AI assistant archetype — five AI-app surfaces: a prompt input bar, a
// streamed response card, a model picker dropdown, a token usage meter, and a
// live agent status card. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-ai-assistant-<variant>`.

import {
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
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Card chrome with per-library personality: MUI floats on elevation with no
// border, React Flow wears its crisp ink outline, daisyUI goes chunky-cornered,
// Untitled adds its feather shadow, antd keeps its tight quiet corners.
const cardStyle = (lib) => ({
	fontFamily: lib.font,
	background: lib.surface,
	borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
	boxSizing: 'border-box',
	...(lib.id === 'mui'
		? { boxShadow: lib.shadow.md }
		: {
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: lib.border,
				...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {})
			})
});

// Spark/zap accent: React Flow flashes its pink accent, Thingtime keeps ink.
const accent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid);

const upperLabel = (lib) =>
	lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {};

// --- tiny custom svg glyphs (allowlisted primitives only) -------------------

const svgIcon = (size, color, ...children) =>
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

const paperclipIcon = (size, color) =>
	svgIcon(size, color, el('path', { d: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' }));

const micIcon = (size, color) =>
	svgIcon(
		size,
		color,
		el('rect', { x: 9, y: 2, width: 6, height: 12, rx: 3 }),
		el('path', { d: 'M5 10v2a7 7 0 0 0 14 0v-2' }),
		el('line', { x1: 12, y1: 19, x2: 12, y2: 22 })
	);

const copyIcon = (size, color) =>
	svgIcon(
		size,
		color,
		el('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
		el('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
	);

const refreshIcon = (size, color) =>
	svgIcon(size, color, el('polyline', { points: '23 4 23 10 17 10' }), el('path', { d: 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10' }));

const thumbsUpIcon = (size, color) =>
	svgIcon(size, color, el('path', { d: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3' }));

const thumbsDownIcon = (size, color) =>
	svgIcon(size, color, el('path', { d: 'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17' }));

// --- shared bits ------------------------------------------------------------

const ghostBtn = (lib, icon) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: '26px',
				height: '26px',
				padding: 0,
				border: 'none',
				borderRadius: lib.radius.sm,
				background: 'transparent',
				cursor: 'pointer',
				flexShrink: 0
			}
		},
		icon
	);

const meterDot = (lib, on, color) =>
	el('span', {
		style: { width: '5px', height: '5px', borderRadius: '999px', background: on ? color : lib.borderSoft }
	});

const dotMeter = (lib, filled, color) =>
	row({ gap: '3px', flexShrink: 0 }, meterDot(lib, filled >= 1, color), meterDot(lib, filled >= 2, color), meterDot(lib, filled >= 3, color));

// state → tint lookups for the agent card (4-value maps on fixed palette
// entries — deliberately NOT a toneMap nested in another map).
const stateMap = (lib, pick) =>
	map('state', {
		running: pick(lib.palette.info),
		waiting: pick(lib.palette.warning),
		done: pick(lib.palette.success),
		error: pick(lib.palette.danger)
	});

export const archetype = {
	id: 'ai-assistant',
	category: 'ai',
	variants: ['prompt-bar', 'response', 'model-picker', 'usage', 'agent-status'],
	build(lib) {
		const promptBar = define({
			slug: `${lib.id}-ai-assistant-prompt-bar`,
			name: 'AI Prompt Bar',
			library: lib.id,
			category: 'ai',
			description: `Prompt input bar in the ${lib.label} style — spark glyph beside ghost placeholder text, attach and mic ghost buttons, a tone-filled send circle, and a model chip with a mono token counter caption below.`,
			tags: ['ai', 'prompt', 'input', 'chat'],
			args: [
				stringArg('placeholder', 'Ask anything…', { label: 'Placeholder', maxLength: 60 }),
				stringArg('model', 'Halo Pro', { label: 'Model', maxLength: 24 }),
				stringArg('tokens', '1.2k', { label: 'Tokens used', maxLength: 12 }),
				toneArg()
			],
			render: stack(
				{ gap: '8px', width: '320px', fontFamily: lib.font },
				row(
					{
						gap: '10px',
						height: lib.control.lg,
						padding: '0 8px 0 14px',
						boxSizing: 'border-box',
						background: lib.surface,
						borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
						...(lib.id === 'mui'
							? { boxShadow: lib.shadow.md }
							: {
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: lib.border,
									...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {})
								})
					},
					icons.zap(16, accent(lib)),
					text(
						{ flex: 1, fontSize: lib.fontSize.md, color: lib.faint, whiteSpace: 'nowrap', overflow: 'hidden' },
						'{placeholder}'
					),
					ghostBtn(lib, paperclipIcon(15, lib.muted)),
					ghostBtn(lib, micIcon(15, lib.muted)),
					el(
						'div',
						{
							style: {
								width: '30px',
								height: '30px',
								borderRadius: '999px',
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0
							}
						},
						icons.arrowUp(15, 'currentColor')
					)
				),
				lib.id === 'thingtime'
					? el('div', { style: { height: '2px', borderRadius: '999px', background: lib.rainbow } })
					: null,
				row(
					{ gap: '8px', padding: '0 4px' },
					el(
						'span',
						{
							style: {
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								color: lib.muted,
								background: lib.surfaceAlt,
								borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
								padding: '2px 8px',
								...upperLabel(lib)
							}
						},
						'{model}'
					),
					el('span', { style: { flex: 1 } }),
					text({ fontSize: lib.fontSize.xs, fontFamily: lib.fontMono, color: lib.faint }, '{tokens} tokens')
				)
			)
		});

		const response = define({
			slug: `${lib.id}-ai-assistant-response`,
			name: 'AI Response Card',
			library: lib.id,
			category: 'ai',
			description: `AI response card in the ${lib.label} style — tone spark avatar, streamed answer text whose last line carries a caret bar while streaming, copy/regenerate/thumbs ghost actions, and a mono generation-time caption.`,
			tags: ['ai', 'response', 'chat', 'card'],
			args: [
				textArg('body', 'Here is the short version: the Q3 launch slips one sprint, and the pricing page ships first so marketing can go live early.', { label: 'Response text', maxLength: 240 }),
				booleanArg('streaming', true, { label: 'Streaming' }),
				stringArg('secs', '1.8', { label: 'Seconds', maxLength: 8 }),
				toneArg()
			],
			render: stack(
				{ ...cardStyle(lib), gap: '10px', width: '340px', padding: '14px' },
				row(
					{ gap: '10px' },
					el(
						'div',
						{
							style: {
								width: '28px',
								height: '28px',
								borderRadius: '999px',
								background: lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid),
								color: lib.id === 'thingtime' ? lib.ink : toneMap(lib, (palette) => palette.onSolid),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0
							}
						},
						icons.zap(14, 'currentColor')
					),
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, 'Assistant')
				),
				el(
					'p',
					{ style: { margin: 0, fontSize: lib.fontSize.sm, lineHeight: 1.6, color: lib.text } },
					'{body}'
				),
				row(
					{ gap: '2px' },
					text({ fontSize: lib.fontSize.sm, lineHeight: 1.6, color: lib.text }, 'Want the follow-up email drafted too?'),
					iff(
						'streaming',
						el('span', {
							style: {
								display: 'inline-block',
								width: '2px',
								height: '14px',
								marginLeft: '3px',
								background: toneMap(lib, (palette) => palette.solid)
							}
						})
					)
				),
				row(
					{ gap: '4px', paddingTop: '2px' },
					ghostBtn(lib, copyIcon(14, lib.muted)),
					ghostBtn(lib, refreshIcon(14, lib.muted)),
					ghostBtn(lib, thumbsUpIcon(14, lib.muted)),
					ghostBtn(lib, thumbsDownIcon(14, lib.muted)),
					el('span', { style: { flex: 1 } }),
					text({ fontSize: lib.fontSize.xs, fontFamily: lib.fontMono, color: lib.faint }, 'Generated in {secs}s')
				)
			)
		});

		const modelPicker = define({
			slug: `${lib.id}-ai-assistant-model-picker`,
			name: 'AI Model Picker',
			library: lib.id,
			category: 'ai',
			description: `Model dropdown in the ${lib.label} style — current-model trigger with context-window caption and chevron, plus an open floating menu of three models with speed/quality dot meters, an active tone check, and a New chip.`,
			tags: ['ai', 'model', 'dropdown', 'menu'],
			args: [
				stringArg('model', 'Halo Pro', { label: 'Current model', maxLength: 24 }),
				stringArg('context', '200k', { label: 'Context window', maxLength: 12 }),
				booleanArg('open', true, { label: 'Menu open' }),
				toneArg()
			],
			render: stack(
				{ width: '264px', fontFamily: lib.font },
				row(
					{
						gap: '10px',
						padding: '8px 12px',
						boxSizing: 'border-box',
						background: lib.surface,
						borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
						...(lib.id === 'mui'
							? { boxShadow: lib.shadow.sm }
							: { borderWidth: '1px', borderStyle: 'solid', borderColor: lib.border })
					},
					stack(
						{ gap: '2px', flex: 1 },
						text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{model}'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{context} context')
					),
					icons.chevronDown(16, lib.muted)
				),
				iff(
					'open',
					stack(
						{
							gap: '2px',
							marginTop: '6px',
							padding: '6px',
							background: lib.surface,
							borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
							boxShadow: lib.shadow.lg,
							...(lib.id === 'mui'
								? {}
								: { borderWidth: '1px', borderStyle: 'solid', borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft })
						},
						row(
							{ gap: '8px', padding: '7px 8px', borderRadius: lib.radius.sm, background: lib.surfaceAlt },
							text({ flex: 1, fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{model}'),
							dotMeter(lib, 2, lib.palette.info.solid),
							dotMeter(lib, 3, lib.palette.success.solid),
							icons.check(14, toneMap(lib, (palette) => palette.solid))
						),
						row(
							{ gap: '8px', padding: '7px 8px', borderRadius: lib.radius.sm },
							text({ flex: 1, fontSize: lib.fontSize.sm, color: lib.text }, 'Halo Mini'),
							dotMeter(lib, 3, lib.palette.info.solid),
							dotMeter(lib, 1, lib.palette.success.solid),
							el(
								'span',
								{
									style: {
										fontSize: lib.fontSize.xs,
										fontWeight: 700,
										padding: '1px 6px',
										borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
										background: toneMap(lib, (palette) => palette.soft),
										color: toneMap(lib, (palette) => palette.onSoft)
									}
								},
								'New'
							)
						),
						row(
							{ gap: '8px', padding: '7px 8px', borderRadius: lib.radius.sm },
							text({ flex: 1, fontSize: lib.fontSize.sm, color: lib.text }, 'Halo Ultra'),
							dotMeter(lib, 1, lib.palette.info.solid),
							dotMeter(lib, 3, lib.palette.success.solid)
						)
					)
				)
			)
		});

		const usage = define({
			slug: `${lib.id}-ai-assistant-usage`,
			name: 'AI Usage Meter',
			library: lib.id,
			category: 'ai',
			description: `Token usage card in the ${lib.label} style — used/limit header, a segmented bar stacking solid used and soft reserved on the free track, two per-model breakdown rows, and a resets caption beside an upgrade ghost.`,
			tags: ['ai', 'usage', 'tokens', 'meter'],
			args: [
				stringArg('used', '62.4k', { label: 'Used', maxLength: 12 }),
				stringArg('limit', '100k', { label: 'Limit', maxLength: 12 }),
				numberArg('percent', 62, { label: 'Used %', min: 0, max: 100 }),
				numberArg('reserved', 14, { label: 'Reserved %', min: 0, max: 100 }),
				toneArg()
			],
			render: stack(
				{ ...cardStyle(lib), gap: '10px', width: '300px', padding: '14px' },
				row(
					{ gap: '5px' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, '{used}'),
					text({ fontSize: lib.fontSize.sm, color: lib.muted }, '/ {limit} tokens')
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							height: lib.id === 'daisyui' ? '12px' : '8px',
							background: lib.surfaceAlt,
							borderRadius: lib.radius.pill,
							overflow: 'hidden'
						}
					},
					el('div', {
						style: {
							width: '{percent}%',
							background: lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid)
						}
					}),
					el('div', { style: { width: '{reserved}%', background: toneMap(lib, (palette) => palette.border) } })
				),
				row(
					{ gap: '8px' },
					text({ flex: 1, fontSize: lib.fontSize.xs, color: lib.muted }, 'Halo Pro'),
					el(
						'div',
						{ style: { width: '90px', height: '4px', background: lib.surfaceAlt, borderRadius: lib.radius.pill, overflow: 'hidden' } },
						el('div', { style: { width: '70%', height: '4px', background: toneMap(lib, (palette) => palette.solid) } })
					),
					text({ fontSize: lib.fontSize.xs, fontFamily: lib.fontMono, color: lib.faint }, '41.9k')
				),
				row(
					{ gap: '8px' },
					text({ flex: 1, fontSize: lib.fontSize.xs, color: lib.muted }, 'Halo Mini'),
					el(
						'div',
						{ style: { width: '90px', height: '4px', background: lib.surfaceAlt, borderRadius: lib.radius.pill, overflow: 'hidden' } },
						el('div', { style: { width: '34%', height: '4px', background: toneMap(lib, (palette) => palette.solid) } })
					),
					text({ fontSize: lib.fontSize.xs, fontFamily: lib.fontMono, color: lib.faint }, '20.5k')
				),
				row(
					{ gap: '8px', paddingTop: '2px' },
					text({ flex: 1, fontSize: lib.fontSize.xs, color: lib.faint }, 'Resets in 12 days'),
					el(
						'button',
						{
							type: 'button',
							style: {
								border: 'none',
								background: 'transparent',
								padding: 0,
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								fontWeight: lib.buttonWeight,
								color: toneMap(lib, (palette) => palette.solid),
								cursor: 'pointer',
								...upperLabel(lib)
							}
						},
						'Upgrade'
					)
				)
			)
		});

		const agentStatus = define({
			slug: `${lib.id}-ai-assistant-agent-status`,
			name: 'AI Agent Status',
			library: lib.id,
			category: 'ai',
			description: `Agent status card in the ${lib.label} style — a pulsing ring-and-core dot tinted by a running/waiting/done/error state, task title with step caption, a mono elapsed chip, a mono tool-call log line, and a cancel ghost.`,
			tags: ['ai', 'agent', 'status', 'task'],
			args: [
				stringArg('task', 'Researching competitors', { label: 'Task', maxLength: 48 }),
				enumArg('state', ['running', 'waiting', 'done', 'error'], 'running', { label: 'State' }),
				numberArg('step', 3, { label: 'Step', min: 1 }),
				numberArg('total', 5, { label: 'Total steps', min: 1 }),
				stringArg('elapsed', '02:14', { label: 'Elapsed', maxLength: 10 })
			],
			render: stack(
				{ ...cardStyle(lib), gap: '10px', width: '320px', padding: '14px' },
				row(
					{ gap: '10px' },
					el(
						'div',
						{
							style: {
								width: '18px',
								height: '18px',
								borderRadius: '999px',
								background: stateMap(lib, (palette) => palette.soft),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0
							}
						},
						el('div', {
							style: { width: '8px', height: '8px', borderRadius: '999px', background: stateMap(lib, (palette) => palette.solid) }
						})
					),
					stack(
						{ gap: '2px', flex: 1 },
						text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{task}'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Step {step} of {total}')
					),
					el(
						'span',
						{
							style: {
								fontSize: lib.fontSize.xs,
								fontFamily: lib.fontMono,
								color: lib.muted,
								background: lib.surfaceAlt,
								borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
								padding: '2px 8px',
								flexShrink: 0
							}
						},
						'{elapsed}'
					)
				),
				el(
					'div',
					{
						style: {
							fontSize: lib.fontSize.xs,
							fontFamily: lib.fontMono,
							color: lib.muted,
							background: lib.surfaceAlt,
							borderRadius: lib.radius.sm,
							padding: '6px 8px',
							borderLeftWidth: '2px',
							borderLeftStyle: 'solid',
							borderLeftColor: stateMap(lib, (palette) => palette.solid),
							whiteSpace: 'nowrap',
							overflow: 'hidden'
						}
					},
					'→ web.search("competitor pricing")'
				),
				row(
					{ gap: '8px' },
					el('span', { style: { flex: 1 } }),
					el(
						'button',
						{
							type: 'button',
							style: {
								border: 'none',
								background: 'transparent',
								padding: 0,
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								fontWeight: lib.buttonWeight,
								color: lib.palette.danger.solid,
								cursor: 'pointer',
								...upperLabel(lib)
							}
						},
						'Cancel'
					)
				)
			)
		});

		return [promptBar, response, modelPicker, usage, agentStatus];
	}
};
