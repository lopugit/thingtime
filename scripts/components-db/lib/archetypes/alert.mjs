// Alert archetype — tone-driven alerts in five renditions: compact inline,
// title + description, action buttons, full-width banner strip, and
// dismissible with an x. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-alert-<variant>`.

import {
	booleanArg,
	define,
	el,
	icons,
	iff,
	map,
	merge,
	row,
	stack,
	stringArg,
	text,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

const ALERT_TONES = ['info', 'success', 'warning', 'danger'];

// daisyUI alerts wear chunky corners; mui standard alerts drop the border
// (soft wash only); untitled adds its feather shadow.
const alertRadius = (lib) => (lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md);

const baseAlert = (lib) => ({
	display: 'flex',
	gap: '10px',
	fontFamily: lib.font,
	fontSize: lib.fontSize.sm,
	lineHeight: 1.5,
	borderRadius: alertRadius(lib),
	background: toneMap(lib, (palette) => palette.soft, 'info'),
	color: toneMap(lib, (palette) => palette.onSoft, 'info'),
	...(lib.id === 'mui'
		? {}
		: { borderWidth: '1px', borderStyle: 'solid', borderColor: toneMap(lib, (palette) => palette.border, 'info') }),
	...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {})
});

// Tone-appropriate glyph: check for success, triangle for warning/danger,
// info circle otherwise. currentColor keeps it on the tone's text color.
const toneIcon = (size) =>
	map(
		'tone',
		{
			success: icons.check(size, 'currentColor'),
			warning: icons.alert(size, 'currentColor'),
			danger: icons.alert(size, 'currentColor'),
			info: icons.info(size, 'currentColor')
		},
		icons.info(size, 'currentColor')
	);

const uppercase = (lib) =>
	lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {};

export const archetype = {
	id: 'alert',
	category: 'feedback',
	variants: ['inline', 'titled', 'actions', 'banner', 'dismissible'],
	build(lib) {
		const inline = define({
			slug: `${lib.id}-alert-inline`,
			name: 'Inline Alert',
			library: lib.id,
			category: 'feedback',
			description: `Compact single-line alert in the ${lib.label} style — a tone-tinted strip with a matching glyph and short message.`,
			tags: ['alert', 'feedback', 'inline', 'status'],
			args: [
				stringArg('message', 'Changes saved successfully.', { label: 'Message', maxLength: 80 }),
				toneArg(ALERT_TONES, 'success'),
				booleanArg('showIcon', true, { label: 'Show icon' })
			],
			render: el(
				'div',
				{ style: merge(baseAlert(lib), { display: 'inline-flex', alignItems: 'center', padding: '8px 12px' }) },
				iff('showIcon', toneIcon(16)),
				el('span', { style: { fontWeight: 500 } }, '{message}')
			)
		});

		const titled = define({
			slug: `${lib.id}-alert-titled`,
			name: 'Titled Alert',
			library: lib.id,
			category: 'feedback',
			description: `Alert with a bold title over a description in the ${lib.label} style — tone glyph beside a two-line message block.`,
			tags: ['alert', 'feedback', 'title', 'description'],
			args: [
				stringArg('title', 'Update available', { label: 'Title', maxLength: 60 }),
				textArg('message', 'A new version is ready to install. Restart to apply it.', { label: 'Message', maxLength: 200 }),
				toneArg(ALERT_TONES, 'info')
			],
			render: el(
				'div',
				{ style: merge(baseAlert(lib), { alignItems: 'flex-start', padding: '14px 16px' }) },
				toneIcon(18),
				stack(
					{ gap: '4px' },
					text({ fontWeight: lib.headingWeight, fontSize: lib.fontSize.md }, '{title}'),
					text({ fontSize: lib.fontSize.sm, opacity: 0.9 }, '{message}')
				)
			)
		});

		const actions = define({
			slug: `${lib.id}-alert-actions`,
			name: 'Alert with Actions',
			library: lib.id,
			category: 'feedback',
			description: `Alert with action buttons in the ${lib.label} style — message plus a solid tone button and a quiet text button${lib.uppercaseButtons ? ', uppercase per Material' : ''}.`,
			tags: ['alert', 'feedback', 'actions', 'buttons'],
			args: [
				textArg('message', 'Your trial ends in 3 days. Upgrade to keep your workspaces.', { label: 'Message', maxLength: 200 }),
				toneArg(ALERT_TONES, 'warning'),
				stringArg('actionLabel', 'Upgrade', { label: 'Action label', maxLength: 24 }),
				stringArg('secondaryLabel', 'Dismiss', { label: 'Secondary label', maxLength: 24 })
			],
			render: el(
				'div',
				{ style: merge(baseAlert(lib), { alignItems: 'flex-start', padding: '14px 16px' }) },
				toneIcon(18),
				stack(
					{ gap: '10px' },
					text({}, '{message}'),
					row(
						{ gap: '8px' },
						el(
							'button',
							{
								type: 'button',
								style: {
									height: lib.control.sm,
									padding: '0 12px',
									border: 'none',
									borderRadius: lib.radius.sm,
									background: toneMap(lib, (palette) => palette.solid, 'info'),
									color: toneMap(lib, (palette) => palette.onSolid, 'info'),
									fontFamily: lib.font,
									fontWeight: lib.buttonWeight,
									fontSize: lib.fontSize.sm,
									cursor: 'pointer',
									...uppercase(lib)
								}
							},
							'{actionLabel}'
						),
						el(
							'button',
							{
								type: 'button',
								style: {
									height: lib.control.sm,
									padding: '0 10px',
									border: 'none',
									borderRadius: lib.radius.sm,
									background: 'transparent',
									color: 'inherit',
									fontFamily: lib.font,
									fontWeight: lib.buttonWeight,
									fontSize: lib.fontSize.sm,
									cursor: 'pointer',
									opacity: 0.85,
									...uppercase(lib)
								}
							},
							'{secondaryLabel}'
						)
					)
				)
			)
		});

		const banner = define({
			slug: `${lib.id}-alert-banner`,
			name: 'Banner Alert',
			library: lib.id,
			category: 'feedback',
			description: `Full-width banner strip in the ${lib.label} style — edge-to-edge square corners, tone glyph, message, and an underlined link.`,
			tags: ['alert', 'feedback', 'banner', 'announcement'],
			args: [
				stringArg('message', 'Scheduled maintenance this Sunday 02:00–04:00 UTC.', { label: 'Message', maxLength: 120 }),
				toneArg(ALERT_TONES, 'info'),
				stringArg('linkText', 'Learn more', { label: 'Link text', maxLength: 24 }),
				booleanArg('centered', false, { label: 'Centered' })
			],
			render: el(
				'div',
				{
					style: merge(baseAlert(lib), {
						width: '100%',
						boxSizing: 'border-box',
						borderRadius: '0',
						alignItems: 'center',
						padding: '10px 16px',
						justifyContent: iff('centered', 'center', 'flex-start')
					})
				},
				toneIcon(16),
				el('span', null, '{message}'),
				el(
					'span',
					{ style: { textDecoration: 'underline', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' } },
					'{linkText}'
				)
			)
		});

		const dismissible = define({
			slug: `${lib.id}-alert-dismissible`,
			name: 'Dismissible Alert',
			library: lib.id,
			category: 'feedback',
			description: `Dismissible alert in the ${lib.label} style — tone-tinted body with the message flexed against a quiet x close button.`,
			tags: ['alert', 'feedback', 'dismissible', 'close'],
			args: [
				stringArg('message', 'Could not sync 2 items. Retry from the activity panel.', { label: 'Message', maxLength: 120 }),
				toneArg(ALERT_TONES, 'danger'),
				booleanArg('showIcon', true, { label: 'Show icon' })
			],
			render: el(
				'div',
				{ style: merge(baseAlert(lib), { alignItems: 'center', padding: '12px 14px' }) },
				iff('showIcon', toneIcon(16)),
				el('span', { style: { flex: 1 } }, '{message}'),
				el(
					'button',
					{
						type: 'button',
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: '24px',
							height: '24px',
							padding: '0',
							border: 'none',
							borderRadius: lib.radius.xs,
							background: 'transparent',
							color: 'inherit',
							cursor: 'pointer',
							opacity: 0.8,
							flexShrink: 0
						}
					},
					icons.x(14, 'currentColor')
				)
			)
		});

		return [inline, titled, actions, banner, dismissible];
	}
};
