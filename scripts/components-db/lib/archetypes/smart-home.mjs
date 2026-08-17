// Smart-home archetype — connected-home surfaces in five renditions: a 2×2
// device tile grid, a thermostat dial, a light dimmer row, a camera feed card,
// and an energy usage card. Follows the button.mjs exemplar: exactly 5
// variants, `build(lib)` returns exactly 5 definitions (one per variant, same
// order), slugs `${lib.id}-smart-home-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	map,
	stringArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// --- local svg glyphs (allowlisted svg/path/circle/rect/line/polygon only) --

const svgIcon = (lib, size, color, ...children) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: color,
			strokeWidth: lib.id === 'daisyui' ? 2.4 : 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		...children
	);

const bulbIcon = (lib, size, color) =>
	svgIcon(
		lib,
		size,
		color,
		el('path', { d: 'M9 18h6' }),
		el('path', { d: 'M10 22h4' }),
		el('path', { d: 'M12 2a7 7 0 0 1 4.9 12 5 5 0 0 0-1.4 3H8.5a5 5 0 0 0-1.4-3A7 7 0 0 1 12 2z' })
	);

const camIcon = (lib, size, color) =>
	svgIcon(lib, size, color, el('rect', { x: 2, y: 7, width: 13, height: 10, rx: 2 }), el('polygon', { points: '22 8 15 12 22 16' }));

const micIcon = (lib, size, color) =>
	svgIcon(
		lib,
		size,
		color,
		el('path', { d: 'M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z' }),
		el('path', { d: 'M19 10v1a7 7 0 0 1-14 0v-1' }),
		el('line', { x1: 12, y1: 18, x2: 12, y2: 22 })
	);

const talkIcon = (lib, size, color) =>
	svgIcon(lib, size, color, el('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }));

const wifiIcon = (lib, size, color) =>
	svgIcon(
		lib,
		size,
		color,
		el('path', { d: 'M5 12.55a11 11 0 0 1 14.08 0' }),
		el('path', { d: 'M8.53 16.11a6 6 0 0 1 6.95 0' }),
		el('line', { x1: 12, y1: 20, x2: 12.01, y2: 20 })
	);

// --- shared chrome -----------------------------------------------------------

const cardBase = (lib) => ({
	display: 'flex',
	flexDirection: 'column',
	boxSizing: 'border-box',
	fontFamily: lib.font,
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
});

// antd chips sit on tight corners, reactflow chrome stays crisp, others pill.
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);
const chipCase = (lib) => (lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {});

// --- device-tile -------------------------------------------------------------

const tileBase = (lib) => ({
	display: 'flex',
	flexDirection: 'column',
	gap: '6px',
	padding: '12px',
	minWidth: '0',
	boxSizing: 'border-box',
	borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.md,
	borderWidth: '1px',
	borderStyle: 'solid'
});

const staticTile = (lib, icon, name, caption, on) =>
	el(
		'div',
		{
			style: {
				...tileBase(lib),
				background: on ? toneMap(lib, (palette) => palette.soft) : lib.surfaceAlt,
				borderColor: on ? toneMap(lib, (palette) => palette.border) : lib.borderSoft
			}
		},
		el('span', { style: { display: 'flex', color: on ? toneMap(lib, (palette) => palette.solid) : lib.faint } }, icon),
		el(
			'span',
			{
				style: {
					fontSize: lib.fontSize.sm,
					fontWeight: lib.headingWeight,
					color: on ? lib.text : lib.muted,
					whiteSpace: 'nowrap',
					overflow: 'hidden',
					textOverflow: 'ellipsis'
				}
			},
			name
		),
		el('span', { style: { fontSize: lib.fontSize.xs, color: on ? toneMap(lib, (palette) => palette.onSoft) : lib.faint } }, caption)
	);

// --- thermostat: stepped dasharray on r=40 (circumference ≈ 251.3) ----------

const DIAL_CIRC = 251.3;
const TEMP_STEPS = ['16', '18', '20', '22', '24', '26', '28'];
const TEMP_DASH = Object.fromEntries(
	TEMP_STEPS.map((t) => [t, `${(((Number(t) - 14) / 16) * DIAL_CIRC).toFixed(1)} ${DIAL_CIRC}`])
);

// --- lights: brightness steps → wash opacity ---------------------------------

const BRIGHT_STEPS = ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'];
const BRIGHT_OPACITY = Object.fromEntries(
	BRIGHT_STEPS.map((b) => [b, Number((0.25 + (Number(b) / 100) * 0.75).toFixed(2))])
);

// Scene hue dots — the four fixed scene hues named by the brief.
const SCENES = [
	['sunset', '#f97316'],
	['forest', '#22c55e'],
	['ocean', '#0ea5e9'],
	['lavender', '#a78bfa']
];

// --- energy: fixed varying bar heights (today's bar rendered separately) -----

const BAR_HEIGHTS = ['18px', '30px', '24px', '40px', '28px', '34px'];
const BAR_HEIGHT_MAP = Object.fromEntries(BAR_HEIGHTS.map((h, i) => [String(i), h]));

export const archetype = {
	id: 'smart-home',
	category: 'iot',
	variants: ['device-tile', 'thermostat', 'lights', 'camera', 'energy'],
	build(lib) {
		const deviceTile = define({
			slug: `${lib.id}-smart-home-device-tile`,
			name: 'Device Tile Grid',
			library: lib.id,
			category: 'iot',
			description: `2×2 smart-device tile grid in the ${lib.label} style — active tiles wear a soft tone wash with a solid icon while idle tiles stay muted; the first tile's name and power state are live args.`,
			tags: ['smart-home', 'iot', 'device', 'grid', 'tile'],
			args: [
				stringArg('name', 'Lamp', { label: 'Device name', maxLength: 24 }),
				booleanArg('on', true, { label: 'Powered on' }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'warning')
			],
			render: el(
				'div',
				{
					style: {
						display: 'grid',
						gridTemplateColumns: '1fr 1fr',
						gap: '10px',
						width: '270px',
						boxSizing: 'border-box',
						fontFamily: lib.font
					}
				},
				el(
					'div',
					{
						style: {
							...tileBase(lib),
							background: iff('on', toneMap(lib, (palette) => palette.soft), lib.surfaceAlt),
							borderColor: iff('on', toneMap(lib, (palette) => palette.border), lib.borderSoft)
						}
					},
					el('span', { style: { display: 'flex', color: iff('on', toneMap(lib, (palette) => palette.solid), lib.faint) } }, bulbIcon(lib, 18, 'currentColor')),
					el(
						'span',
						{
							style: {
								fontSize: lib.fontSize.sm,
								fontWeight: lib.headingWeight,
								color: iff('on', lib.text, lib.muted),
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis'
							}
						},
						'{name}'
					),
					el(
						'span',
						{ style: { fontSize: lib.fontSize.xs, color: iff('on', toneMap(lib, (palette) => palette.onSoft), lib.faint) } },
						iff('on', 'On', 'Off')
					)
				),
				staticTile(lib, icons.clock(18, 'currentColor'), 'Thermostat', '21.5° · Heat', true),
				staticTile(lib, camIcon(lib, 18, 'currentColor'), 'Camera', 'Standby', false),
				staticTile(lib, icons.bell(18, 'currentColor'), 'Doorbell', 'Armed', true)
			)
		});

		const ringWidth = lib.id === 'daisyui' ? 11 : 8;
		const thermostat = define({
			slug: `${lib.id}-smart-home-thermostat`,
			name: 'Thermostat Dial',
			library: lib.id,
			category: 'iot',
			description: `Thermostat dial in the ${lib.label} style — a stepped arc ring tracks the set temperature around a centered readout, with heat/cool/auto mode chips and round nudge buttons.`,
			tags: ['smart-home', 'iot', 'thermostat', 'dial', 'gauge'],
			args: [
				enumArg('temp', TEMP_STEPS, '22', { label: 'Set temp °C' }),
				enumArg('mode', ['heat', 'cool', 'auto'], 'heat', { label: 'Mode' }),
				stringArg('name', 'Living room', { label: 'Room', maxLength: 24 })
			],
			render: el(
				'div',
				{ style: { ...cardBase(lib), alignItems: 'center', gap: '12px', padding: '16px', width: '212px' } },
				el('span', { style: { fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text } }, '{name}'),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '12px' } },
					el(
						'button',
						{
							type: 'button',
							style: {
								width: lib.control.sm,
								height: lib.control.sm,
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								padding: '0',
								borderRadius: lib.radius.pill,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.border,
								background: lib.surface,
								color: lib.text,
								fontSize: lib.fontSize.lg,
								cursor: 'pointer',
								boxShadow: lib.shadow.sm
							}
						},
						'−'
					),
					el(
						'div',
						{ style: { position: 'relative', width: '104px', height: '104px' } },
						el(
							'svg',
							{ width: 104, height: 104, viewBox: '0 0 100 100', xmlns: 'http://www.w3.org/2000/svg' },
							el('circle', { cx: 50, cy: 50, r: 40, fill: 'none', stroke: lib.borderSoft, strokeWidth: ringWidth }),
							el('circle', {
								cx: 50,
								cy: 50,
								r: 40,
								fill: 'none',
								stroke: map(
									'mode',
									{ heat: lib.palette.danger.solid, cool: lib.palette.info.solid, auto: lib.palette.success.solid },
									lib.palette.danger.solid
								),
								strokeWidth: ringWidth,
								strokeLinecap: lib.id === 'reactflow' ? 'butt' : 'round',
								style: {
									strokeDasharray: map('temp', TEMP_DASH, TEMP_DASH['22']),
									transform: 'rotate(-90deg)',
									transformOrigin: '50px 50px'
								}
							})
						),
						el(
							'span',
							{
								style: {
									position: 'absolute',
									inset: '0',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									fontSize: lib.fontSize.xl,
									fontWeight: lib.headingWeight,
									color: lib.text
								}
							},
							'{temp}°'
						)
					),
					el(
						'button',
						{
							type: 'button',
							style: {
								width: lib.control.sm,
								height: lib.control.sm,
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								padding: '0',
								borderRadius: lib.radius.pill,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.border,
								background: lib.surface,
								color: lib.text,
								fontSize: lib.fontSize.lg,
								cursor: 'pointer',
								boxShadow: lib.shadow.sm
							}
						},
						'+'
					)
				),
				el(
					'div',
					{ style: { display: 'flex', gap: '6px' } },
					...[
						['heat', 'Heat', 'danger'],
						['cool', 'Cool', 'info'],
						['auto', 'Auto', 'success']
					].map(([value, label, tone]) =>
						el(
							'span',
							{
								style: {
									padding: '3px 10px',
									borderRadius: chipRadius(lib),
									fontSize: lib.fontSize.xs,
									fontWeight: 600,
									cursor: 'pointer',
									...chipCase(lib),
									borderWidth: '1px',
									borderStyle: 'solid',
									background: ifEq('mode', value, lib.palette[tone].soft, 'transparent'),
									color: ifEq('mode', value, lib.palette[tone].onSoft, lib.muted),
									borderColor: ifEq('mode', value, lib.palette[tone].border, 'transparent')
								}
							},
							label
						)
					)
				)
			)
		});

		const lights = define({
			slug: `${lib.id}-smart-home-lights`,
			name: 'Light Dimmer Row',
			library: lib.id,
			category: 'iot',
			description: `Light control row in the ${lib.label} style — a warm-washed bulb that dims with brightness, a calc-driven dimmer fill with thumb, and four scene hue dots with a selected ring${lib.id === 'thingtime' ? ', the fill wearing the house rainbow' : ''}.`,
			tags: ['smart-home', 'iot', 'light', 'dimmer', 'slider'],
			args: [
				stringArg('room', 'Living room', { label: 'Room', maxLength: 24 }),
				enumArg('brightness', BRIGHT_STEPS, '70', { label: 'Brightness %' }),
				enumArg('scene', SCENES.map(([key]) => key), 'sunset', { label: 'Scene' })
			],
			render: el(
				'div',
				{ style: { ...cardBase(lib), flexDirection: 'row', alignItems: 'center', gap: '12px', padding: '14px', width: '290px' } },
				el(
					'div',
					{
						style: {
							width: '44px',
							height: '44px',
							flexShrink: '0',
							borderRadius: lib.radius.pill,
							background: lib.palette.warning.soft,
							color: lib.palette.warning.solid,
							opacity: map('brightness', BRIGHT_OPACITY, 0.78),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center'
						}
					},
					bulbIcon(lib, 20, 'currentColor')
				),
				el(
					'div',
					{ style: { display: 'flex', flexDirection: 'column', gap: '9px', flex: '1', minWidth: '0' } },
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
						el('span', { style: { fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text } }, '{room}'),
						el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted, fontFamily: lib.fontMono } }, '{brightness}%')
					),
					el(
						'div',
						{ style: { position: 'relative', height: '6px', borderRadius: lib.radius.pill, background: lib.borderSoft } },
						el('div', {
							style: {
								position: 'absolute',
								left: '0',
								top: '0',
								bottom: '0',
								width: '{brightness}%',
								borderRadius: lib.radius.pill,
								background: lib.id === 'thingtime' ? lib.rainbow : lib.palette.warning.solid
							}
						}),
						el('div', {
							style: {
								position: 'absolute',
								top: '50%',
								left: 'calc({brightness}% - 7px)',
								transform: 'translateY(-50%)',
								width: '14px',
								height: '14px',
								boxSizing: 'border-box',
								borderRadius: lib.radius.pill,
								background: lib.surface,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.border,
								boxShadow: lib.shadow.sm
							}
						})
					),
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center', gap: '8px' } },
						...SCENES.map(([key, hue]) =>
							el('span', {
								style: {
									width: '14px',
									height: '14px',
									borderRadius: lib.radius.pill,
									background: hue,
									cursor: 'pointer',
									boxShadow: ifEq('scene', key, `0 0 0 2px ${lib.surface}, 0 0 0 4px ${hue}`, 'none')
								}
							})
						)
					)
				)
			)
		});

		const camera = define({
			slug: `${lib.id}-smart-home-camera`,
			name: 'Camera Feed Card',
			library: lib.id,
			category: 'iot',
			description: `Security camera card in the ${lib.label} style — a dark 16:9 feed mock with a LIVE chip, connection arcs and a mono timestamp, over a caption row with mic and talk ghost buttons.`,
			tags: ['smart-home', 'iot', 'camera', 'security', 'feed'],
			args: [
				stringArg('room', 'Front door', { label: 'Camera name', maxLength: 24 }),
				booleanArg('live', true, { label: 'Live' }),
				stringArg('time', '14:32:07', { label: 'Timestamp', maxLength: 12 })
			],
			render: el(
				'div',
				{ style: { ...cardBase(lib), width: '270px', overflow: 'hidden', padding: '0' } },
				el(
					'div',
					{ style: { position: 'relative', height: '150px', background: lib.id === 'thingtime' ? lib.ink : lib.text } },
					el('div', { style: { position: 'absolute', left: '0', right: '0', top: '46%', height: '28px', background: 'rgba(255, 255, 255, 0.06)' } }),
					el(
						'div',
						{ style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255, 255, 255, 0.55)' } },
						wifiIcon(lib, 30, 'currentColor')
					),
					el(
						'span',
						{
							style: {
								position: 'absolute',
								top: '10px',
								left: '10px',
								display: 'inline-flex',
								alignItems: 'center',
								gap: '5px',
								padding: '2px 8px',
								borderRadius: chipRadius(lib),
								fontSize: lib.fontSize.xs,
								fontWeight: 700,
								letterSpacing: '0.04em',
								background: iff('live', lib.id === 'reactflow' ? lib.accent : lib.palette.danger.solid, 'rgba(255, 255, 255, 0.16)'),
								color: iff('live', lib.palette.danger.onSolid, 'rgba(255, 255, 255, 0.72)')
							}
						},
						el('span', { style: { width: '6px', height: '6px', borderRadius: '999px', background: 'currentColor' } }),
						iff('live', 'LIVE', 'OFFLINE')
					),
					el(
						'span',
						{ style: { position: 'absolute', right: '10px', bottom: '8px', fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: 'rgba(255, 255, 255, 0.75)' } },
						'{time}'
					)
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px' } },
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' } },
						el('span', { style: { fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text } }, '{room}'),
						el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, iff('live', 'Streaming · 1080p', 'Standby'))
					),
					el(
						'div',
						{ style: { display: 'flex', gap: '6px' } },
						...[micIcon(lib, 14, 'currentColor'), talkIcon(lib, 14, 'currentColor')].map((icon) =>
							el(
								'button',
								{
									type: 'button',
									style: {
										width: '28px',
										height: '28px',
										display: 'inline-flex',
										alignItems: 'center',
										justifyContent: 'center',
										padding: '0',
										borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.md,
										borderWidth: '1px',
										borderStyle: 'solid',
										borderColor: lib.borderSoft,
										background: lib.surfaceAlt,
										color: lib.muted,
										cursor: 'pointer',
										boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
									}
								},
								icon
							)
						)
					)
				)
			)
		});

		const energy = define({
			slug: `${lib.id}-smart-home-energy`,
			name: 'Energy Usage Card',
			library: lib.id,
			category: 'iot',
			description: `Home energy card in the ${lib.label} style — today's kWh and cost beside a week of mini bars with today rendered solid, and a vs-last-week trend chip that flips tone with direction.`,
			tags: ['smart-home', 'iot', 'energy', 'usage', 'chart'],
			args: [
				stringArg('kwh', '12.4', { label: 'kWh today', maxLength: 8 }),
				stringArg('cost', '$3.86', { label: 'Cost', maxLength: 10 }),
				booleanArg('up', false, { label: 'Usage up' }),
				toneArg()
			],
			render: el(
				'div',
				{ style: { ...cardBase(lib), width: '270px', padding: '16px', gap: '12px' } },
				lib.id === 'thingtime' ? el('div', { style: { height: '3px', borderRadius: lib.radius.pill, background: lib.rainbow } }) : null,
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' } },
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
						el('span', { style: { fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight, color: lib.text } }, '{kwh} kWh'),
						el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, '{cost} today')
					),
					el(
						'span',
						{
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								gap: '4px',
								padding: '3px 8px',
								borderRadius: chipRadius(lib),
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								whiteSpace: 'nowrap',
								background: iff('up', lib.palette.danger.soft, lib.palette.success.soft),
								color: iff('up', lib.palette.danger.onSoft, lib.palette.success.onSoft)
							}
						},
						iff('up', icons.arrowUp(11, 'currentColor'), icons.arrowDown(11, 'currentColor')),
						'8% vs last week'
					)
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'flex-end', gap: '6px', height: '52px' } },
					{
						ttRepeat: {
							count: 6,
							max: 6,
							node: el('div', {
								style: {
									flex: '1',
									borderRadius: lib.radius.xs,
									background: toneMap(lib, (palette) => palette.soft),
									height: map('index', BAR_HEIGHT_MAP, '24px')
								}
							})
						}
					},
					el('div', { style: { flex: '1', borderRadius: lib.radius.xs, background: toneMap(lib, (palette) => palette.solid), height: '46px' } })
				)
			)
		});

		return [deviceTile, thermostat, lights, camera, energy];
	}
};
