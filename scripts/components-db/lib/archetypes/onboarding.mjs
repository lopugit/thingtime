// Onboarding archetype — first-run surfaces in five renditions: welcome card,
// feature-tour popover step, setup checklist, slim resume banner, and an
// invite-teammates card. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-onboarding-<variant>`.

import {
	define,
	el,
	icons,
	numberArg,
	repeat,
	row,
	stack,
	stringArg,
	text,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Shared card chrome: untitled wears its feather lg shadow, mui gets material
// elevation, everyone else stays on the quiet sm shadow. reactflow's border
// token is its crisp near-black node outline, so cards read as flow nodes.
const cardBase = (lib) => ({
	fontFamily: lib.font,
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'untitled' ? lib.shadow.lg : lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	boxSizing: 'border-box'
});

const buttonBase = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '6px',
	border: 'none',
	borderRadius: lib.radius.md,
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

// 8px dot + 6px gap → 14px pitch for the tour-step active-dot overlay.
const DOT_PITCH_PX = 14;

const dot = (background) => el('span', { style: { width: '8px', height: '8px', borderRadius: '999px', background } });

export const archetype = {
	id: 'onboarding',
	category: 'onboarding',
	variants: ['welcome', 'tour-step', 'checklist', 'progress', 'invite'],
	build(lib) {
		const welcome = define({
			slug: `${lib.id}-onboarding-welcome`,
			name: 'Welcome Card',
			library: lib.id,
			category: 'onboarding',
			description: `First-run welcome card in the ${lib.label} style — a zap emblem in a tone circle over a personal greeting, supporting copy, primary CTA and a quiet skip link${lib.id === 'thingtime' ? ', capped with the house rainbow strip' : ''}.`,
			tags: ['onboarding', 'welcome', 'first-run', 'card'],
			args: [
				stringArg('name', 'Alex', { label: 'Name', maxLength: 24 }),
				textArg('subtext', 'Your workspace is ready. Take the two-minute tour to get the most out of it.', {
					label: 'Subtext',
					maxLength: 160
				}),
				stringArg('ctaLabel', 'Get started', { label: 'CTA label', maxLength: 32 }),
				toneArg()
			],
			previewBg: lib.bg,
			render: stack(
				{
					...cardBase(lib),
					width: '280px',
					alignItems: 'center',
					gap: '14px',
					padding: '28px 24px',
					textAlign: 'center',
					position: 'relative',
					overflow: 'hidden'
				},
				lib.id === 'thingtime'
					? el('div', { style: { position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: lib.rainbow } })
					: null,
				el(
					'div',
					{
						style: {
							width: '48px',
							height: '48px',
							borderRadius: '999px',
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center'
						}
					},
					icons.zap(22, 'currentColor')
				),
				text({ fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight, color: lib.text }, 'Welcome, {name}'),
				text({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.5 }, '{subtext}'),
				el(
					'button',
					{
						type: 'button',
						style: {
							...buttonBase(lib),
							width: '100%',
							height: lib.control.md,
							fontSize: lib.fontSize.md,
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
						}
					},
					'{ctaLabel}'
				),
				el(
					'button',
					{
						type: 'button',
						style: { ...buttonBase(lib), background: 'transparent', color: lib.muted, fontSize: lib.fontSize.sm, padding: 0 }
					},
					'Skip for now'
				)
			)
		});

		const tourStep = define({
			slug: `${lib.id}-onboarding-tour-step`,
			name: 'Tour Step Popover',
			library: lib.id,
			category: 'onboarding',
			description: `Feature-tour popover step in the ${lib.label} style — mono step counter, title and body copy, dot progress (solid ${lib.id === 'reactflow' ? 'accent-pink' : 'tone'} active dot over faint done dots) with back/next actions.`,
			tags: ['onboarding', 'tour', 'popover', 'walkthrough'],
			args: [
				stringArg('title', 'Pin your favorites', { label: 'Title', maxLength: 48 }),
				textArg('body', 'Drag any item onto the sidebar to keep it one click away, on every device.', {
					label: 'Body',
					maxLength: 160
				}),
				numberArg('step', 2, { label: 'Step', min: 1, max: 8 }),
				numberArg('total', 4, { label: 'Total steps', min: 1, max: 8 }),
				toneArg()
			],
			previewBg: lib.bg,
			render: stack(
				{ ...cardBase(lib), width: '272px', gap: '8px', padding: '16px' },
				text(
					{
						fontFamily: lib.fontMono,
						fontSize: lib.fontSize.xs,
						color: lib.muted,
						letterSpacing: '0.05em',
						textTransform: 'uppercase'
					},
					'Step {step} of {total}'
				),
				text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
				text({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.5 }, '{body}'),
				row(
					{ justifyContent: 'space-between', gap: '12px', marginTop: '6px' },
					// Dot track: pending dots underneath, a faint overlay covering the
					// done positions, and a solid active dot placed by calc() pitch.
					row(
						{ position: 'relative', gap: '6px', flexShrink: 0 },
						repeat('total', 8, dot(lib.borderSoft)),
						el(
							'div',
							{ style: { position: 'absolute', top: 0, left: 0, display: 'flex', gap: '6px' } },
							repeat('step', 8, dot(lib.faint))
						),
						el('span', {
							style: {
								position: 'absolute',
								top: 0,
								left: `calc(({step} - 1) * ${DOT_PITCH_PX}px)`,
								width: '8px',
								height: '8px',
								borderRadius: '999px',
								background: lib.id === 'reactflow' ? lib.accent : toneMap(lib, (palette) => palette.solid)
							}
						})
					),
					row(
						{ gap: '8px' },
						el(
							'button',
							{
								type: 'button',
								style: {
									...buttonBase(lib),
									background: 'transparent',
									color: lib.muted,
									height: lib.control.sm,
									padding: '0 10px',
									fontSize: lib.fontSize.sm
								}
							},
							'Back'
						),
						el(
							'button',
							{
								type: 'button',
								style: {
									...buttonBase(lib),
									height: lib.control.sm,
									padding: '0 12px',
									fontSize: lib.fontSize.sm,
									background: toneMap(lib, (palette) => palette.solid),
									color: toneMap(lib, (palette) => palette.onSolid)
								}
							},
							'Next',
							icons.arrowRight(14, 'currentColor')
						)
					)
				)
			)
		});

		const checkRowBase = (lib2) => ({
			gap: '10px',
			padding: '7px 10px',
			borderRadius: lib2.radius.sm,
			borderWidth: '1px',
			borderStyle: 'solid',
			borderColor: 'transparent'
		});

		const doneRow = (token) =>
			row(
				checkRowBase(lib),
				el(
					'div',
					{
						style: {
							width: '18px',
							height: '18px',
							borderRadius: '999px',
							background: lib.palette.success.solid,
							color: lib.palette.success.onSolid,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							flexShrink: 0
						}
					},
					icons.check(10, 'currentColor')
				),
				text({ fontSize: lib.fontSize.sm, color: lib.muted }, token)
			);

		const checklist = define({
			slug: `${lib.id}-onboarding-checklist`,
			name: 'Setup Checklist',
			library: lib.id,
			category: 'onboarding',
			description: `Setup checklist card in the ${lib.label} style — two completed steps with green check circles, the current step highlighted by a tone border and wash, one faint pending step, plus a mono completion caption.`,
			tags: ['onboarding', 'checklist', 'setup', 'progress'],
			args: [
				numberArg('done', 2, { label: 'Done count', min: 0, max: 4 }),
				stringArg('item1', 'Create your account', { label: 'Step 1', maxLength: 40 }),
				stringArg('item2', 'Verify your email', { label: 'Step 2', maxLength: 40 }),
				stringArg('item3', 'Invite your team', { label: 'Step 3', maxLength: 40 }),
				stringArg('item4', 'Create your first thing', { label: 'Step 4', maxLength: 40 }),
				toneArg()
			],
			previewBg: lib.bg,
			render: stack(
				{ ...cardBase(lib), width: '280px', gap: '10px', padding: '16px' },
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, 'Setup checklist'),
					text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: lib.muted }, '{done} of 4 complete')
				),
				stack(
					{ gap: '4px' },
					doneRow('{item1}'),
					doneRow('{item2}'),
					row(
						{
							...checkRowBase(lib),
							borderColor: toneMap(lib, (palette) => palette.border),
							background: toneMap(lib, (palette) => palette.soft)
						},
						el('div', {
							style: {
								width: '18px',
								height: '18px',
								borderRadius: '999px',
								borderWidth: '2px',
								borderStyle: 'solid',
								borderColor: toneMap(lib, (palette) => palette.solid),
								boxSizing: 'border-box',
								flexShrink: 0
							}
						}),
						text(
							{ fontSize: lib.fontSize.sm, fontWeight: 600, color: toneMap(lib, (palette) => palette.onSoft) },
							'{item3}'
						)
					),
					row(
						checkRowBase(lib),
						el('div', {
							style: {
								width: '18px',
								height: '18px',
								borderRadius: '999px',
								borderWidth: '1px',
								borderStyle: 'dashed',
								borderColor: lib.faint,
								boxSizing: 'border-box',
								flexShrink: 0
							}
						}),
						text({ fontSize: lib.fontSize.sm, color: lib.faint }, '{item4}')
					)
				)
			)
		});

		const progress = define({
			slug: `${lib.id}-onboarding-progress`,
			name: 'Onboarding Progress Banner',
			library: lib.id,
			category: 'onboarding',
			description: `Slim finish-setup banner in the ${lib.label} style — label, inline ${lib.id === 'thingtime' ? 'rainbow' : 'tone'} progress bar with a mono percent readout, a resume button and a quiet dismiss cross.`,
			tags: ['onboarding', 'progress', 'banner', 'resume'],
			args: [
				stringArg('label', 'Finish setting up', { label: 'Label', maxLength: 32 }),
				numberArg('percent', 60, { label: 'Percent', min: 0, max: 100 }),
				stringArg('resumeLabel', 'Resume', { label: 'Button label', maxLength: 20 }),
				toneArg()
			],
			previewBg: lib.bg,
			render: row(
				{ ...cardBase(lib), borderRadius: lib.radius.md, width: '360px', gap: '10px', padding: '10px 12px' },
				text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text, whiteSpace: 'nowrap', flexShrink: 0 }, '{label}'),
				el(
					'div',
					{
						style: {
							flex: 1,
							minWidth: '40px',
							height: '6px',
							borderRadius: '999px',
							background: lib.borderSoft,
							overflow: 'hidden'
						}
					},
					el('div', {
						style: {
							width: '{percent}%',
							height: '100%',
							borderRadius: '999px',
							background: lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid)
						}
					})
				),
				text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: lib.muted, flexShrink: 0 }, '{percent}%'),
				el(
					'button',
					{
						type: 'button',
						style: {
							...buttonBase(lib),
							height: lib.control.sm,
							padding: '0 10px',
							fontSize: lib.fontSize.xs,
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							flexShrink: 0
						}
					},
					'{resumeLabel}'
				),
				el(
					'button',
					{
						type: 'button',
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: '22px',
							height: '22px',
							padding: 0,
							border: 'none',
							borderRadius: lib.radius.xs,
							background: 'transparent',
							color: lib.muted,
							cursor: 'pointer',
							flexShrink: 0
						}
					},
					icons.x(14, 'currentColor')
				)
			)
		});

		const chipRadius = lib.id === 'antd' ? lib.radius.xs : lib.radius.pill;
		const inviteRow = (token) =>
			row(
				{ gap: '8px' },
				el(
					'div',
					{
						style: {
							width: '24px',
							height: '24px',
							borderRadius: '999px',
							background: lib.surfaceAlt,
							color: lib.muted,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							flexShrink: 0
						}
					},
					icons.user(12, 'currentColor')
				),
				text(
					{
						flex: 1,
						minWidth: 0,
						fontSize: lib.fontSize.sm,
						color: lib.text,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap'
					},
					token
				),
				el(
					'span',
					{
						style: {
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							padding: '2px 8px',
							borderRadius: chipRadius,
							background: lib.palette.warning.soft,
							color: lib.palette.warning.onSoft,
							flexShrink: 0
						}
					},
					'Pending'
				),
				el(
					'span',
					{
						style: {
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							color: toneMap(lib, (palette) => palette.solid),
							cursor: 'pointer',
							flexShrink: 0
						}
					},
					'Resend'
				)
			);

		const invite = define({
			slug: `${lib.id}-onboarding-invite`,
			name: 'Invite Teammates Card',
			library: lib.id,
			category: 'onboarding',
			description: `Invite-teammates card in the ${lib.label} style — an email field beside a tone invite button, above two pending invites with avatar circles, warning-wash Pending chips and tone resend links.`,
			tags: ['onboarding', 'invite', 'team', 'card'],
			args: [
				stringArg('placeholder', 'teammate@company.com', { label: 'Placeholder', maxLength: 40 }),
				stringArg('email1', 'mia@acme.com', { label: 'Invite 1', maxLength: 40 }),
				stringArg('email2', 'noah@acme.com', { label: 'Invite 2', maxLength: 40 }),
				toneArg()
			],
			previewBg: lib.bg,
			render: stack(
				{ ...cardBase(lib), width: '300px', gap: '12px', padding: '18px' },
				stack(
					{ gap: '2px' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, 'Invite teammates'),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'They will get an email with a join link.')
				),
				row(
					{ gap: '8px' },
					el('input', {
						type: 'text',
						placeholder: '{placeholder}',
						style: {
							flex: 1,
							minWidth: 0,
							height: lib.control.sm,
							padding: '0 10px',
							boxSizing: 'border-box',
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							borderRadius: lib.radius.sm,
							fontFamily: lib.font,
							fontSize: lib.fontSize.sm,
							color: lib.text,
							background: lib.surface,
							outline: 'none'
						}
					}),
					el(
						'button',
						{
							type: 'button',
							style: {
								...buttonBase(lib),
								height: lib.control.sm,
								padding: '0 12px',
								fontSize: lib.fontSize.sm,
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								flexShrink: 0
							}
						},
						'Invite'
					)
				),
				stack({ gap: '10px' }, inviteRow('{email1}'), inviteRow('{email2}'))
			)
		});

		return [welcome, tourStep, checklist, progress, invite];
	}
};
