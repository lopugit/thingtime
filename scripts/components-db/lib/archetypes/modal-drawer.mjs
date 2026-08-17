// Modal/drawer archetype — static overlay panels drawn ON a dimmed backdrop.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-modal-drawer-<variant>`.

import {
	define,
	div,
	el,
	icons,
	ifEq,
	merge,
	numberArg,
	repeat,
	stringArg,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

const SCRIM = 'rgba(12, 12, 16, 0.45)';

const backdrop = (lib, extra = {}) => ({
	display: 'flex',
	width: '340px',
	minHeight: '280px',
	boxSizing: 'border-box',
	background: SCRIM,
	borderRadius: lib.radius.md,
	overflow: 'hidden',
	fontFamily: lib.font,
	...extra
});

const panel = (lib, extra = {}) => ({
	background: lib.surface,
	color: lib.text,
	borderRadius: lib.radius.lg,
	boxShadow: lib.shadow.lg,
	display: 'flex',
	flexDirection: 'column',
	overflow: 'hidden',
	...extra
});

const buttonBase = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: lib.control.sm,
	padding: '0 14px',
	borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
	fontFamily: lib.font,
	fontSize: lib.fontSize.sm,
	fontWeight: lib.buttonWeight,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

const primaryBtn = (lib, label, extra = {}) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				...buttonBase(lib),
				border: 'none',
				background: toneMap(lib, (palette) => palette.solid),
				color: toneMap(lib, (palette) => palette.onSolid),
				boxShadow: lib.shadow.sm,
				...extra
			}
		},
		label
	);

// MUI cancels as a text button; everyone else gets a quiet bordered button.
const cancelBtn = (lib, label) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				...buttonBase(lib),
				...(lib.id === 'mui'
					? { border: 'none', background: 'transparent', color: lib.palette.primary.solid }
					: {
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							background: lib.surface,
							color: lib.text
						})
			}
		},
		label
	);

const closeBtn = (lib) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				border: 'none',
				background: 'transparent',
				color: lib.faint,
				cursor: 'pointer',
				padding: '4px',
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				borderRadius: lib.radius.sm,
				flexShrink: 0
			}
		},
		icons.x(16, 'currentColor')
	);

const heading = (lib, value, extra = {}) =>
	el('h3', { style: { margin: 0, fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, ...extra } }, value);

const bodyText = (lib, value, extra = {}) =>
	el('p', { style: { margin: 0, color: lib.muted, fontSize: lib.fontSize.sm, lineHeight: 1.6, ...extra } }, value);

// Thingtime's rainbow wink: a slim gradient strip across the panel top.
const rainbowStrip = (lib) => (lib.id === 'thingtime' ? div({ height: '4px', background: lib.rainbow, flexShrink: 0 }) : null);

export const archetype = {
	id: 'modal-drawer',
	category: 'overlays',
	variants: ['dialog', 'confirm', 'drawer', 'sheet', 'form'],
	build(lib) {
		const dialog = define({
			slug: `${lib.id}-modal-drawer-dialog`,
			name: 'Dialog Modal',
			library: lib.id,
			category: 'overlays',
			description: `Centered dialog on a dimmed backdrop in the ${lib.label} style — title with a close glyph, muted body copy, and cancel/confirm actions footed to the right.`,
			tags: ['modal', 'dialog', 'overlay', 'actions'],
			args: [
				stringArg('title', 'Update available', { label: 'Title', maxLength: 40 }),
				textArg('body', 'A new version of the workspace is ready to install. You can update now or do it later.', { label: 'Body', maxLength: 200 }),
				stringArg('confirmLabel', 'Update now', { label: 'Confirm label', maxLength: 24 }),
				stringArg('cancelLabel', 'Later', { label: 'Cancel label', maxLength: 24 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: backdrop(lib, { alignItems: 'center', justifyContent: 'center', padding: '24px' }) },
				el(
					'div',
					{ style: panel(lib, { width: '272px' }) },
					rainbowStrip(lib),
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '16px 12px 0 20px' } },
						heading(lib, '{title}'),
						closeBtn(lib)
					),
					bodyText(lib, '{body}', { padding: '10px 20px 16px' }),
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', padding: '0 16px 16px' } },
						cancelBtn(lib, '{cancelLabel}'),
						primaryBtn(lib, '{confirmLabel}')
					)
				)
			)
		});

		const confirm = define({
			slug: `${lib.id}-modal-drawer-confirm`,
			name: 'Confirm Dialog',
			library: lib.id,
			category: 'overlays',
			description: `Destructive confirm dialog in the ${lib.label} style — a tone-tinted alert badge over centered title and body, cancel beside a danger-toned commit button.`,
			tags: ['modal', 'confirm', 'danger', 'overlay'],
			args: [
				stringArg('title', 'Delete this file?', { label: 'Title', maxLength: 40 }),
				textArg('body', 'This will permanently remove the file from your workspace. This action cannot be undone.', { label: 'Body', maxLength: 200 }),
				stringArg('confirmLabel', 'Delete', { label: 'Confirm label', maxLength: 24 }),
				stringArg('cancelLabel', 'Cancel', { label: 'Cancel label', maxLength: 24 }),
				toneArg(undefined, 'danger')
			],
			render: el(
				'div',
				{ style: backdrop(lib, { alignItems: 'center', justifyContent: 'center', padding: '24px' }) },
				el(
					'div',
					{ style: panel(lib, { width: '272px', alignItems: 'center', textAlign: 'center', padding: '20px' }) },
					div(
						{
							width: '40px',
							height: '40px',
							borderRadius: lib.radius.pill,
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft),
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							flexShrink: 0
						},
						icons.alert(20, 'currentColor')
					),
					heading(lib, '{title}', { margin: '12px 0 4px' }),
					bodyText(lib, '{body}'),
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '16px' } },
						cancelBtn(lib, '{cancelLabel}'),
						primaryBtn(lib, '{confirmLabel}')
					)
				)
			)
		});

		const drawer = define({
			slug: `${lib.id}-modal-drawer-drawer`,
			name: 'Side Drawer',
			library: lib.id,
			category: 'overlays',
			description: `Right-side drawer panel over a dimmed backdrop in the ${lib.label} style — flush to the edge with rounded inner corners, a titled header, and a tone-highlighted menu.`,
			tags: ['drawer', 'panel', 'overlay', 'navigation'],
			args: [
				stringArg('title', 'Workspace settings', { label: 'Title', maxLength: 40 }),
				stringArg('item', 'Menu item', { label: 'Item label', maxLength: 40 }),
				numberArg('items', 4, { label: 'Items', min: 1, max: 6 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: backdrop(lib, { justifyContent: 'flex-end', alignItems: 'stretch', minHeight: '300px' }) },
				el(
					'div',
					{ style: panel(lib, { width: '224px', borderRadius: `${lib.radius.lg} 0 0 ${lib.radius.lg}` }) },
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '16px 12px 12px 16px' } },
						heading(lib, '{title}', { fontSize: lib.fontSize.md }),
						closeBtn(lib)
					),
					div({ height: '1px', background: lib.borderSoft, margin: '0 0 8px', flexShrink: 0 }),
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 8px' } },
						repeat(
							'items',
							6,
							el(
								'div',
								{
									style: merge(
										{
											display: 'flex',
											alignItems: 'center',
											gap: '10px',
											padding: '8px 10px',
											borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
											fontSize: lib.fontSize.sm
										},
										ifEq(
											'n',
											1,
											{
												background: toneMap(lib, (palette) => palette.soft),
												color: toneMap(lib, (palette) => palette.onSoft),
												fontWeight: 600
											},
											{ color: lib.muted }
										)
									)
								},
								icons.folder(15, 'currentColor'),
								'{item} {n}'
							)
						)
					)
				)
			)
		});

		const sheet = define({
			slug: `${lib.id}-modal-drawer-sheet`,
			name: 'Bottom Sheet',
			library: lib.id,
			category: 'overlays',
			description: `Bottom sheet rising over a dimmed backdrop in the ${lib.label} style — a ${lib.id === 'daisyui' ? 'chunky' : 'slim'} grab handle above the title, body copy, and a full-width tone action.`,
			tags: ['sheet', 'mobile', 'overlay', 'bottom'],
			args: [
				stringArg('title', 'Share this page', { label: 'Title', maxLength: 40 }),
				textArg('body', 'Send a link to your teammates or copy it to your clipboard.', { label: 'Body', maxLength: 200 }),
				stringArg('actionLabel', 'Copy link', { label: 'Action label', maxLength: 24 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: backdrop(lib, { flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch' }) },
				el(
					'div',
					{ style: panel(lib, { borderRadius: `${lib.radius.lg} ${lib.radius.lg} 0 0`, padding: '10px 20px 20px' }) },
					div({
						width: '40px',
						height: lib.id === 'daisyui' ? '6px' : '4px',
						borderRadius: lib.radius.pill,
						background: lib.border,
						margin: '0 auto 14px',
						flexShrink: 0
					}),
					heading(lib, '{title}', { margin: '0 0 6px' }),
					bodyText(lib, '{body}', { margin: '0 0 16px' }),
					primaryBtn(lib, '{actionLabel}', { height: lib.control.md, width: '100%' })
				)
			)
		});

		const inputStyle = {
			height: lib.control.sm,
			padding: '0 10px',
			borderRadius: lib.radius.sm,
			borderWidth: '1px',
			borderStyle: 'solid',
			borderColor: lib.border,
			background: lib.surface,
			color: lib.text,
			fontSize: lib.fontSize.sm,
			fontFamily: lib.font,
			boxSizing: 'border-box',
			width: '100%',
			outline: 'none'
		};
		const formField = (labelToken) =>
			el(
				'div',
				{ style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
				el('label', { style: { fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.text } }, `{${labelToken}}`),
				el('input', { type: 'text', placeholder: `Enter {${labelToken}}`, style: inputStyle })
			);

		const form = define({
			slug: `${lib.id}-modal-drawer-form`,
			name: 'Form Dialog',
			library: lib.id,
			category: 'overlays',
			description: `Dialog with a small form on a dimmed backdrop in the ${lib.label} style — two labeled text inputs under the title, cancel and a tone submit in the footer.`,
			tags: ['modal', 'form', 'overlay', 'inputs'],
			args: [
				stringArg('title', 'Create project', { label: 'Title', maxLength: 40 }),
				stringArg('label1', 'Name', { label: 'Field 1 label', maxLength: 24 }),
				stringArg('label2', 'Description', { label: 'Field 2 label', maxLength: 24 }),
				stringArg('submitLabel', 'Create', { label: 'Submit label', maxLength: 24 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: backdrop(lib, { alignItems: 'center', justifyContent: 'center', padding: '24px' }) },
				el(
					'div',
					{ style: panel(lib, { width: '272px' }) },
					rainbowStrip(lib),
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '16px 12px 12px 20px' } },
						heading(lib, '{title}'),
						closeBtn(lib)
					),
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0 20px' } },
						formField('label1'),
						formField('label2')
					),
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', padding: '16px' } },
						cancelBtn(lib, 'Cancel'),
						primaryBtn(lib, '{submitLabel}')
					)
				)
			)
		});

		return [dialog, confirm, drawer, sheet, form];
	}
};
