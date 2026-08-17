// Settings archetype — preference surfaces in five renditions: a single
// switch row, a grouped section card, a danger zone, an API-key row, and a
// notification channel matrix. Follows the button.mjs exemplar: exactly 5
// variants, `build(lib)` returns exactly 5 definitions (one per variant,
// same order), slugs `${lib.id}-settings-<variant>`.

import {
	booleanArg,
	define,
	el,
	icons,
	iff,
	merge,
	row,
	stack,
	stringArg,
	text,
	textArg
} from '../helpers.mjs';

// Control accent: reactflow winks its hot pink, thingtime keeps ink-dark
// controls, everyone else uses the library primary.
const accent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid);

// Per-library hairline: reactflow rows divide with the dashed rhythm of its
// dotted canvases; everyone else uses a quiet solid hairline.
const dividerStyle = (lib) => ({
	borderBottomWidth: '1px',
	borderBottomStyle: lib.id === 'reactflow' ? 'dashed' : 'solid',
	borderBottomColor: lib.borderSoft
});

const card = (lib) => ({
	width: '320px',
	boxSizing: 'border-box',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.md,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.id === 'untitled' ? lib.shadow.sm : 'none',
	fontFamily: lib.font,
	overflow: 'hidden'
});

// Switch: the boolean arg drives both knob position (flex justification) and
// track tone. daisyui wears the chunky track; thingtime's on-track is the
// house rainbow.
const switchControl = (lib, argName) => {
	const chunky = lib.id === 'daisyui';
	const knob = chunky ? '18px' : '14px';
	const onTrack = lib.id === 'thingtime' ? lib.rainbow : accent(lib);
	return el(
		'div',
		{
			style: {
				width: chunky ? '44px' : '36px',
				height: chunky ? '24px' : '20px',
				padding: '3px',
				boxSizing: 'border-box',
				borderRadius: lib.radius.pill,
				background: iff(argName, onTrack, lib.faint),
				display: 'flex',
				alignItems: 'center',
				justifyContent: iff(argName, 'flex-end', 'flex-start'),
				flexShrink: 0
			}
		},
		el('div', {
			style: { width: knob, height: knob, borderRadius: lib.radius.pill, background: lib.surface, boxShadow: lib.shadow.sm }
		})
	);
};

const checkboxBase = (lib) => ({
	width: lib.id === 'daisyui' ? '20px' : '16px',
	height: lib.id === 'daisyui' ? '20px' : '16px',
	boxSizing: 'border-box',
	borderRadius: lib.radius.xs,
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	flexShrink: 0
});

const checkboxOff = (lib) => ({ background: lib.surface, borderWidth: '1px', borderStyle: 'solid', borderColor: lib.border });

const staticCheckbox = (lib, on) =>
	el(
		'div',
		{ style: { ...checkboxBase(lib), ...(on ? { background: accent(lib) } : checkboxOff(lib)) } },
		on ? icons.check(lib.id === 'daisyui' ? 13 : 11, lib.surface) : null
	);

const argCheckbox = (lib, argName) =>
	el(
		'div',
		{ style: merge(checkboxBase(lib), iff(argName, { background: accent(lib) }, checkboxOff(lib))) },
		iff(argName, icons.check(lib.id === 'daisyui' ? 13 : 11, lib.surface))
	);

const monoHeading = (lib, value) =>
	text(
		{
			fontFamily: lib.fontMono,
			fontSize: lib.fontSize.xs,
			fontWeight: 600,
			letterSpacing: '0.08em',
			textTransform: 'uppercase',
			color: lib.muted
		},
		value
	);

const smallButton = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: lib.control.sm,
	padding: '0 12px',
	borderRadius: lib.radius.sm,
	fontFamily: lib.font,
	fontSize: lib.fontSize.sm,
	fontWeight: lib.buttonWeight,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

// Custom glyphs the shared icon set lacks (allowlisted svg primitives only).
const svgProps = (size, color) => ({
	width: size,
	height: size,
	viewBox: '0 0 24 24',
	fill: 'none',
	stroke: color,
	strokeWidth: 2,
	strokeLinecap: 'round',
	strokeLinejoin: 'round',
	xmlns: 'http://www.w3.org/2000/svg'
});

const copyIcon = (size, color) =>
	el(
		'svg',
		svgProps(size, color),
		el('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
		el('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
	);

const eyeIcon = (size, color) =>
	el(
		'svg',
		svgProps(size, color),
		el('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }),
		el('circle', { cx: 12, cy: 12, r: 3 })
	);

const ghostIconButton = (lib, icon) =>
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
				padding: '0',
				border: 'none',
				borderRadius: lib.radius.sm,
				background: 'transparent',
				color: lib.muted,
				cursor: 'pointer'
			}
		},
		icon
	);

const matrixCell = (lib, box) => el('div', { style: { width: '48px', display: 'flex', justifyContent: 'center' } }, box);

const matrixRow = (lib, label, push, email, divided) =>
	row(
		{ justifyContent: 'space-between', padding: '10px 0', ...(divided ? dividerStyle(lib) : {}) },
		text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text }, label),
		row({}, matrixCell(lib, push), matrixCell(lib, email))
	);

export const archetype = {
	id: 'settings',
	category: 'settings',
	variants: ['row', 'section', 'danger', 'api-keys', 'notifications'],
	build(lib) {
		const settingsRow = define({
			slug: `${lib.id}-settings-row`,
			name: 'Settings Row',
			library: lib.id,
			category: 'settings',
			description: `Single preference row in the ${lib.label} style — title and helper caption on the left, a ${lib.id === 'thingtime' ? 'rainbow-tracked' : lib.id === 'daisyui' ? 'chunky' : 'tone-tracked'} switch on the right, hairline dividers above and below.`,
			tags: ['settings', 'row', 'switch', 'preference'],
			args: [
				stringArg('title', 'Email notifications', { label: 'Title', maxLength: 40 }),
				stringArg('caption', 'Get a digest of workspace activity', { label: 'Caption', maxLength: 80 }),
				booleanArg('enabled', true, { label: 'Enabled' })
			],
			render: row(
				{
					width: '320px',
					boxSizing: 'border-box',
					justifyContent: 'space-between',
					gap: '16px',
					padding: '12px 4px',
					background: lib.surface,
					fontFamily: lib.font,
					borderTopWidth: '1px',
					borderTopStyle: 'solid',
					borderTopColor: lib.borderSoft,
					...dividerStyle(lib)
				},
				stack(
					{ gap: '2px', minWidth: 0 },
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{caption}')
				),
				switchControl(lib, 'enabled')
			)
		});

		const section = define({
			slug: `${lib.id}-settings-section`,
			name: 'Settings Section',
			library: lib.id,
			category: 'settings',
			description: `Grouped settings card in the ${lib.label} style — mono uppercase section header over a switch row, a select mock with chevron, and a navigation row, split by ${lib.id === 'reactflow' ? 'dashed canvas-style' : 'hairline'} dividers.`,
			tags: ['settings', 'section', 'card', 'group'],
			args: [
				stringArg('heading', 'Workspace', { label: 'Heading', maxLength: 30 }),
				booleanArg('enabled', true, { label: 'Auto-save on' }),
				stringArg('value', 'English', { label: 'Selected value', maxLength: 24 })
			],
			render: stack(
				{ ...card(lib) },
				lib.id === 'thingtime' ? el('div', { style: { height: '3px', background: lib.rainbow } }) : null,
				el('div', { style: { padding: '12px 14px 6px' } }, monoHeading(lib, '{heading}')),
				row(
					{ justifyContent: 'space-between', gap: '12px', padding: '10px 14px', ...dividerStyle(lib) },
					text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text }, 'Auto-save'),
					switchControl(lib, 'enabled')
				),
				row(
					{ justifyContent: 'space-between', gap: '12px', padding: '10px 14px', ...dividerStyle(lib) },
					text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text }, 'Language'),
					row({ gap: '6px', fontSize: lib.fontSize.sm, color: lib.muted }, '{value}', icons.chevronDown(14, lib.faint))
				),
				row(
					{ justifyContent: 'space-between', gap: '12px', padding: '10px 14px' },
					text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text }, 'Members'),
					icons.chevronRight(14, lib.faint)
				)
			)
		});

		const danger = define({
			slug: `${lib.id}-settings-danger`,
			name: 'Danger Zone',
			library: lib.id,
			category: 'settings',
			description: `Danger-zone settings card in the ${lib.label} style — danger-tinted border and header, warning copy, a confirm-phrase field mock, and an outline-danger delete button beside a ghost cancel${lib.uppercaseButtons ? ', with Material uppercase button labels' : ''}.`,
			tags: ['settings', 'danger', 'delete', 'confirm'],
			args: [
				stringArg('heading', 'Danger zone', { label: 'Heading', maxLength: 30 }),
				textArg('warning', 'Deleting this workspace removes every project, member, and file. This cannot be undone.', {
					label: 'Warning copy',
					maxLength: 160
				}),
				stringArg('phrase', 'acme/workspace', { label: 'Confirm phrase', maxLength: 40 })
			],
			render: stack(
				{ ...card(lib), borderColor: lib.palette.danger.border },
				el(
					'div',
					{ style: { padding: '10px 14px', background: lib.palette.danger.soft } },
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.palette.danger.onSoft }, '{heading}')
				),
				stack(
					{ padding: '12px 14px', gap: '10px' },
					text({ fontSize: lib.fontSize.xs, color: lib.muted, lineHeight: 1.5 }, '{warning}'),
					el('input', {
						type: 'text',
						placeholder: 'Type {phrase} to confirm',
						style: {
							height: lib.control.sm,
							boxSizing: 'border-box',
							width: '100%',
							padding: '0 10px',
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							borderRadius: lib.radius.sm,
							background: lib.surface,
							color: lib.text,
							fontFamily: lib.font,
							fontSize: lib.fontSize.sm,
							outline: 'none'
						}
					}),
					row(
						{ gap: '8px' },
						el(
							'button',
							{
								type: 'button',
								style: {
									...smallButton(lib),
									background: 'transparent',
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: lib.palette.danger.solid,
									color: lib.palette.danger.solid
								}
							},
							'Delete workspace'
						),
						el(
							'button',
							{ type: 'button', style: { ...smallButton(lib), background: 'transparent', border: 'none', color: lib.muted } },
							'Cancel'
						)
					)
				)
			)
		});

		const apiKeys = define({
			slug: `${lib.id}-settings-api-keys`,
			name: 'API Key Row',
			library: lib.id,
			category: 'settings',
			description: `API key management row in the ${lib.label} style — key name with created caption, a masked mono key chip, ghost copy and reveal icon buttons, a last-used caption, and a danger revoke link.`,
			tags: ['settings', 'api-key', 'token', 'developer'],
			args: [
				stringArg('name', 'Production key', { label: 'Key name', maxLength: 40 }),
				stringArg('last4', '4f2a', { label: 'Last 4 chars', maxLength: 6 }),
				stringArg('created', 'Mar 2, 2026', { label: 'Created', maxLength: 24 }),
				stringArg('ago', '2 hours ago', { label: 'Last used', maxLength: 24 })
			],
			render: stack(
				{ ...card(lib), width: '340px', padding: '12px 14px', gap: '10px' },
				row(
					{ justifyContent: 'space-between', gap: '12px' },
					stack(
						{ gap: '2px', minWidth: 0 },
						text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{name}'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Created {created}')
					),
					row(
						{ gap: '4px', flexShrink: 0 },
						el(
							'span',
							{
								style: {
									fontFamily: lib.fontMono,
									fontSize: lib.fontSize.xs,
									color: lib.id === 'reactflow' ? lib.accent : lib.text,
									background: lib.surfaceAlt,
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: lib.borderSoft,
									borderRadius: lib.radius.xs,
									padding: '3px 8px',
									whiteSpace: 'nowrap'
								}
							},
							'sk-••••{last4}'
						),
						ghostIconButton(lib, copyIcon(14, lib.muted)),
						ghostIconButton(lib, eyeIcon(14, lib.muted))
					)
				),
				row(
					{ justifyContent: 'space-between', gap: '12px' },
					text({ fontSize: lib.fontSize.xs, color: lib.faint }, 'Last used {ago}'),
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.palette.danger.solid, cursor: 'pointer' }, 'Revoke')
				)
			)
		});

		const notifications = define({
			slug: `${lib.id}-settings-notifications`,
			name: 'Notification Matrix',
			library: lib.id,
			category: 'settings',
			description: `Notification preference matrix in the ${lib.label} style — Push and Email channel columns over Mentions, Replies, and Digests rows of ${lib.id === 'reactflow' ? 'accent-filled' : lib.id === 'daisyui' ? 'chunky' : 'tone-filled'} checkboxes, with a mono header row.`,
			tags: ['settings', 'notifications', 'matrix', 'checkbox'],
			args: [
				stringArg('title', 'Notifications', { label: 'Title', maxLength: 30 }),
				booleanArg('mentionsPush', true, { label: 'Mentions push' }),
				booleanArg('mentionsEmail', false, { label: 'Mentions email' })
			],
			render: stack(
				{ ...card(lib), padding: '12px 14px' },
				row(
					{ justifyContent: 'space-between', paddingBottom: '8px', ...dividerStyle(lib) },
					monoHeading(lib, '{title}'),
					row(
						{},
						el('span', { style: { width: '48px', textAlign: 'center', fontSize: lib.fontSize.xs, fontWeight: 500, color: lib.faint } }, 'Push'),
						el('span', { style: { width: '48px', textAlign: 'center', fontSize: lib.fontSize.xs, fontWeight: 500, color: lib.faint } }, 'Email')
					)
				),
				matrixRow(lib, 'Mentions', argCheckbox(lib, 'mentionsPush'), argCheckbox(lib, 'mentionsEmail'), true),
				matrixRow(lib, 'Replies', staticCheckbox(lib, true), staticCheckbox(lib, false), true),
				matrixRow(lib, 'Digests', staticCheckbox(lib, false), staticCheckbox(lib, true), false)
			)
		});

		return [settingsRow, section, danger, apiKeys, notifications];
	}
};
