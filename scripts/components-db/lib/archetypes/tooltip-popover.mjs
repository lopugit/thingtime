// Tooltip / popover archetype — anchored bubbles drawn statically beside a
// trigger element: dark tooltip with a CSS-triangle arrow, titled popover,
// dropdown menu, right-click context menu with kbd shortcuts, and a profile
// hovercard.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-tooltip-popover-<variant>`.

import {
	avatarCircle,
	booleanArg,
	define,
	div,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	numberArg,
	repeat,
	row,
	span,
	stack,
	stringArg,
	text,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Darkest surface each library owns (thingtime has a dedicated ink token).
const inkOf = (lib) => (lib.id === 'thingtime' ? lib.ink : lib.text);

// CSS-triangle arrows built from borders (width/height zero, two transparent
// sides, one solid side pointing at the trigger).
const arrowDown = (color) =>
	div({ width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: `6px solid ${color}` });
const arrowUp = (color) =>
	div({ width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: `6px solid ${color}` });

export const archetype = {
	id: 'tooltip-popover',
	category: 'overlays',
	variants: ['tooltip', 'popover', 'dropdown', 'context', 'hovercard'],
	build(lib) {
		const ink = inkOf(lib);

		const triggerButton = (...children) =>
			el(
				'button',
				{
					type: 'button',
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						gap: '6px',
						height: lib.control.md,
						padding: '0 14px',
						background: lib.surface,
						color: lib.text,
						border: `1px solid ${lib.border}`,
						borderRadius: lib.radius.md,
						fontFamily: lib.font,
						fontSize: lib.fontSize.sm,
						fontWeight: lib.buttonWeight,
						boxShadow: lib.shadow.sm,
						cursor: 'pointer',
						...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
					}
				},
				...children
			);

		const menuSeparator = () =>
			div({ borderTop: `1px ${lib.id === 'reactflow' ? 'dashed' : 'solid'} ${lib.borderSoft}`, margin: '4px 2px' });

		const tooltipBubble = () =>
			div(
				{
					background: ink,
					color: lib.surface,
					padding: '5px 10px',
					borderRadius: lib.radius.sm,
					fontSize: lib.fontSize.xs,
					maxWidth: '220px',
					textAlign: 'center',
					boxShadow: lib.shadow.md
				},
				'{label}'
			);

		const tooltip = define({
			slug: `${lib.id}-tooltip-popover-tooltip`,
			name: 'Tooltip',
			library: lib.id,
			category: 'overlays',
			description: `Dark tooltip bubble in the ${lib.label} style — inverse ink pill anchored above or below its trigger, with a CSS-triangle arrow pointing at the control.`,
			tags: ['tooltip', 'overlay', 'hint', 'arrow'],
			args: [
				stringArg('label', 'Copied to clipboard', { label: 'Tooltip text', maxLength: 60 }),
				stringArg('triggerLabel', 'Hover me', { label: 'Trigger label', maxLength: 24 }),
				enumArg('placement', ['top', 'bottom'], 'top', { label: 'Placement' }),
				booleanArg('showArrow', true, { label: 'Show arrow' })
			],
			render: stack(
				{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontFamily: lib.font },
				ifEq('placement', 'top', stack({ alignItems: 'center' }, tooltipBubble(), iff('showArrow', arrowDown(ink)))),
				triggerButton('{triggerLabel}'),
				ifEq('placement', 'bottom', stack({ alignItems: 'center' }, iff('showArrow', arrowUp(ink)), tooltipBubble()))
			)
		});

		const popover = define({
			slug: `${lib.id}-tooltip-popover-popover`,
			name: 'Popover',
			library: lib.id,
			category: 'overlays',
			description: `Titled popover in the ${lib.label} style — elevated surface card anchored below its trigger with an arrow caret, heading, body copy, and an optional tone action button.`,
			tags: ['popover', 'overlay', 'card', 'anchored'],
			args: [
				stringArg('title', 'Share this view', { label: 'Title', maxLength: 50 }),
				textArg('body', 'Anyone with the link can see live updates. Manage access anytime from settings.', { label: 'Body' }),
				stringArg('triggerLabel', 'Share', { label: 'Trigger label', maxLength: 24 }),
				booleanArg('showAction', true, { label: 'Show action' }),
				stringArg('actionLabel', 'Copy link', { label: 'Action label', maxLength: 24 }),
				toneArg()
			],
			render: stack(
				{ display: 'inline-flex', alignItems: 'flex-start', fontFamily: lib.font },
				triggerButton('{triggerLabel}', icons.chevronDown(14, 'currentColor')),
				stack(
					{ alignItems: 'flex-start', marginTop: '3px' },
					div({ marginLeft: '18px' }, arrowUp(lib.border)),
					stack(
						{
							gap: '8px',
							width: '270px',
							padding: '14px 16px',
							background: lib.surface,
							border: `1px solid ${lib.border}`,
							borderRadius: lib.radius.lg,
							boxShadow: lib.shadow.lg,
							color: lib.text
						},
						text({ fontWeight: lib.headingWeight, fontSize: lib.fontSize.md }, '{title}'),
						text({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.5 }, '{body}'),
						iff(
							'showAction',
							el(
								'button',
								{
									type: 'button',
									style: {
										alignSelf: 'flex-start',
										display: 'inline-flex',
										alignItems: 'center',
										justifyContent: 'center',
										height: lib.control.sm,
										padding: '0 12px',
										border: 'none',
										borderRadius: lib.radius.sm,
										background: toneMap(lib, (palette) => palette.solid),
										color: toneMap(lib, (palette) => palette.onSolid),
										fontFamily: lib.font,
										fontSize: lib.fontSize.sm,
										fontWeight: lib.buttonWeight,
										cursor: 'pointer',
										marginTop: '2px',
										...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
									}
								},
								'{actionLabel}'
							)
						)
					)
				)
			),
			previewBg: lib.bg
		});

		const dropdown = define({
			slug: `${lib.id}-tooltip-popover-dropdown`,
			name: 'Dropdown Menu',
			library: lib.id,
			category: 'overlays',
			description: `Dropdown menu in the ${lib.label} style — chevron trigger over an elevated panel of rows with optional leading icons, a separator, and a danger row at the bottom.`,
			tags: ['dropdown', 'menu', 'overlay', 'actions'],
			args: [
				stringArg('triggerLabel', 'Options', { label: 'Trigger label', maxLength: 24 }),
				numberArg('items', 3, { label: 'Menu items', min: 1, max: 6 }),
				stringArg('dangerLabel', 'Delete project', { label: 'Danger label', maxLength: 32 }),
				booleanArg('showIcons', true, { label: 'Show icons' })
			],
			render: stack(
				{ display: 'inline-flex', alignItems: 'flex-start', gap: '4px', fontFamily: lib.font },
				triggerButton('{triggerLabel}', icons.chevronDown(14, 'currentColor')),
				stack(
					{
						width: '210px',
						padding: lib.id === 'reactflow' ? '3px' : '5px',
						gap: '1px',
						background: lib.surface,
						border: `1px solid ${lib.border}`,
						borderRadius: lib.radius.md,
						boxShadow: lib.shadow.lg,
						fontSize: lib.fontSize.sm,
						color: lib.text
					},
					repeat(
						'items',
						6,
						row(
							{
								gap: '8px',
								padding: '7px 10px',
								borderRadius: lib.radius.xs,
								background: ifEq('index', 0, lib.surfaceAlt, 'transparent'),
								cursor: 'pointer'
							},
							iff('showIcons', span({ display: 'inline-flex', color: lib.muted }, icons.file(14, 'currentColor'))),
							'Menu item {n}'
						)
					),
					menuSeparator(),
					row(
						{ gap: '8px', padding: '7px 10px', borderRadius: lib.radius.xs, color: lib.palette.danger.solid, cursor: 'pointer' },
						iff('showIcons', span({ display: 'inline-flex' }, icons.trash(14, 'currentColor'))),
						'{dangerLabel}'
					)
				)
			),
			previewBg: lib.bg
		});

		const kbd = (shortcut) =>
			el(
				'span',
				{
					style: {
						fontFamily: lib.fontMono,
						fontSize: lib.fontSize.xs,
						color: lib.muted,
						background: lib.surfaceAlt,
						border: `1px solid ${lib.borderSoft}`,
						borderRadius: lib.radius.xs,
						padding: '1px 5px'
					}
				},
				shortcut
			);

		const contextRow = (label, shortcut, extraStyle = {}) =>
			row(
				{
					justifyContent: 'space-between',
					gap: '24px',
					padding: iff('dense', '4px 10px', '7px 10px'),
					borderRadius: lib.radius.xs,
					cursor: 'pointer',
					...extraStyle
				},
				span(null, label),
				iff('showShortcuts', kbd(shortcut))
			);

		const context = define({
			slug: `${lib.id}-tooltip-popover-context`,
			name: 'Context Menu',
			library: lib.id,
			category: 'overlays',
			description: `Right-click context menu in the ${lib.label} style — edit commands with kbd-style shortcut chips, a separator, and a danger row, all on one elevated panel.`,
			tags: ['context-menu', 'menu', 'overlay', 'shortcuts'],
			args: [
				booleanArg('showShortcuts', true, { label: 'Show shortcuts' }),
				stringArg('dangerLabel', 'Move to Trash', { label: 'Danger label', maxLength: 32 }),
				booleanArg('showDanger', true, { label: 'Show danger row' }),
				booleanArg('dense', false, { label: 'Dense rows' })
			],
			render: stack(
				{
					display: 'inline-flex',
					width: '230px',
					padding: '5px',
					gap: '1px',
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.md,
					boxShadow: lib.shadow.lg,
					fontFamily: lib.font,
					fontSize: lib.fontSize.sm,
					color: lib.text
				},
				contextRow('Cut', '⌘X'),
				contextRow('Copy', '⌘C'),
				contextRow('Paste', '⌘V'),
				iff('showDanger', [menuSeparator(), contextRow('{dangerLabel}', '⌘⌫', { color: lib.palette.danger.solid })])
			),
			previewBg: lib.bg
		});

		const hovercard = define({
			slug: `${lib.id}-tooltip-popover-hovercard`,
			name: 'Hovercard',
			library: lib.id,
			category: 'overlays',
			description: `Profile hovercard in the ${lib.label} style — dotted-underline handle trigger above a card with an initials avatar, name, bio, follower stats, and a tone follow button.`,
			tags: ['hovercard', 'profile', 'overlay', 'card'],
			args: [
				stringArg('name', 'Ada Lovelace', { label: 'Name', maxLength: 40 }),
				stringArg('handle', 'ada', { label: 'Handle', maxLength: 24 }),
				stringArg('initials', 'AL', { label: 'Initials', maxLength: 2 }),
				textArg('bio', 'Writing about analytical engines, poetry, and the software in between.', { label: 'Bio' }),
				toneArg()
			],
			render: stack(
				{ display: 'inline-flex', alignItems: 'flex-start', gap: '6px', fontFamily: lib.font },
				text({ fontSize: lib.fontSize.sm, color: lib.muted, textDecoration: 'underline dotted', cursor: 'pointer' }, '@{handle}'),
				stack(
					{
						width: '290px',
						padding: '16px',
						gap: '10px',
						background: lib.surface,
						border: `1px solid ${lib.border}`,
						borderRadius: lib.radius.lg,
						boxShadow: lib.shadow.lg,
						color: lib.text
					},
					row(
						{ gap: '12px' },
						avatarCircle(
							40,
							lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.soft),
							lib.id === 'thingtime' ? lib.ink : toneMap(lib, (palette) => palette.onSoft),
							'{initials}',
							lib.fontSize.md
						),
						stack(
							{ gap: '1px' },
							text({ fontWeight: lib.headingWeight, fontSize: lib.fontSize.md }, '{name}'),
							text({ fontSize: lib.fontSize.sm, color: lib.muted }, '@{handle}')
						)
					),
					text({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.5 }, '{bio}'),
					row(
						{ gap: '14px', fontSize: lib.fontSize.sm },
						row({ gap: '4px' }, text({ fontWeight: lib.headingWeight }, '128'), text({ color: lib.muted }, 'Following')),
						row({ gap: '4px' }, text({ fontWeight: lib.headingWeight }, '2.4k'), text({ color: lib.muted }, 'Followers'))
					),
					el(
						'button',
						{
							type: 'button',
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								width: '100%',
								height: lib.control.sm,
								border: 'none',
								borderRadius: lib.radius.md,
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								fontWeight: lib.buttonWeight,
								cursor: 'pointer',
								marginTop: '2px',
								...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
							}
						},
						'Follow'
					)
				)
			),
			previewBg: lib.bg
		});

		return [tooltip, popover, dropdown, context, hovercard];
	}
};
