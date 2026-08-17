// Toast / notification archetype — transient and persistent feedback surfaces:
// floating toast pill, dark snackbar with action, rich notification card,
// inline callout box, and a full-width top banner.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-toast-notification-<variant>`.

import {
	booleanArg,
	define,
	div,
	icons,
	iff,
	ifEq,
	map,
	row,
	span,
	stack,
	stringArg,
	text,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Status glyph keyed by tone — check for success, triangle for warnings and
// errors, info dot otherwise. Inherits color from the wrapping span.
const toneIcon = (size) =>
	map(
		'tone',
		{
			primary: icons.info(size, 'currentColor'),
			success: icons.check(size, 'currentColor'),
			warning: icons.alert(size, 'currentColor'),
			danger: icons.alert(size, 'currentColor'),
			info: icons.info(size, 'currentColor'),
			neutral: icons.bell(size, 'currentColor')
		},
		icons.info(size, 'currentColor')
	);

// Darkest surface each library owns (thingtime has a dedicated ink token).
const inkOf = (lib) => (lib.id === 'thingtime' ? lib.ink : lib.text);

export const archetype = {
	id: 'toast-notification',
	category: 'feedback',
	variants: ['toast', 'snackbar', 'card', 'callout', 'top-banner'],
	build(lib) {
		const ink = inkOf(lib);

		const toast = define({
			slug: `${lib.id}-toast-notification-toast`,
			name: 'Toast',
			library: lib.id,
			category: 'feedback',
			description: `Floating toast pill in the ${lib.label} style — tone-colored status icon beside a short message on an elevated surface, with an optional dismiss glyph.`,
			tags: ['toast', 'notification', 'feedback', 'transient'],
			args: [
				stringArg('message', 'Changes saved', { label: 'Message', maxLength: 60 }),
				toneArg(undefined, 'success'),
				booleanArg('showIcon', true, { label: 'Show icon' }),
				booleanArg('dismissible', false, { label: 'Dismissible' })
			],
			render: row(
				{
					display: 'inline-flex',
					gap: '10px',
					padding: '10px 16px',
					background: lib.surface,
					color: lib.text,
					border: `1px solid ${lib.borderSoft}`,
					borderRadius: lib.id === 'reactflow' ? lib.radius.md : lib.radius.pill,
					boxShadow: lib.shadow.md,
					fontFamily: lib.font,
					fontSize: lib.fontSize.md
				},
				iff('showIcon', span({ display: 'inline-flex', color: toneMap(lib, (palette) => palette.solid) }, toneIcon(16))),
				text({ fontWeight: 500 }, '{message}'),
				iff(
					'dismissible',
					span({ display: 'inline-flex', color: lib.faint, marginLeft: '2px', cursor: 'pointer' }, icons.x(14, 'currentColor'))
				)
			)
		});

		const snackbar = define({
			slug: `${lib.id}-toast-notification-snackbar`,
			name: 'Snackbar',
			library: lib.id,
			category: 'feedback',
			description: `Dark snackbar bar in the ${lib.label} style — inverse ink surface with the message on the left and a tone-tinted action link${lib.uppercaseButtons ? ' (uppercase, Material-style)' : ''} on the right.`,
			tags: ['snackbar', 'toast', 'feedback', 'action'],
			args: [
				stringArg('message', 'Conversation archived', { label: 'Message', maxLength: 60 }),
				stringArg('actionLabel', 'Undo', { label: 'Action label', maxLength: 24 }),
				toneArg(),
				booleanArg('showClose', false, { label: 'Show close' })
			],
			render: row(
				{
					gap: '16px',
					justifyContent: 'space-between',
					minWidth: '300px',
					padding: '10px 16px',
					background: ink,
					color: lib.surface,
					borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.sm,
					boxShadow: lib.shadow.lg,
					fontFamily: lib.font,
					fontSize: lib.fontSize.sm
				},
				text({ fontWeight: 400 }, '{message}'),
				row(
					{ gap: '12px' },
					text(
						{
							color: toneMap(lib, (palette) => palette.border),
							fontWeight: 600,
							cursor: 'pointer',
							...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
						},
						'{actionLabel}'
					),
					iff('showClose', span({ display: 'inline-flex', color: lib.border, cursor: 'pointer' }, icons.x(14, 'currentColor')))
				)
			)
		});

		const card = define({
			slug: `${lib.id}-toast-notification-card`,
			name: 'Notification Card',
			library: lib.id,
			category: 'feedback',
			description: `Rich notification card in the ${lib.label} style — tone-tinted icon bubble, title row with an unread dot, body preview, and a quiet timestamp on an elevated surface.`,
			tags: ['notification', 'card', 'feedback', 'inbox'],
			args: [
				stringArg('title', 'New comment', { label: 'Title', maxLength: 50 }),
				textArg('body', 'Mira replied to your thread: “This is exactly what we needed — shipping it.”', { label: 'Body' }),
				stringArg('time', '2 min ago', { label: 'Timestamp', maxLength: 24 }),
				booleanArg('unread', true, { label: 'Unread' }),
				toneArg()
			],
			render: row(
				{
					alignItems: 'flex-start',
					gap: '12px',
					width: '330px',
					padding: '14px 16px',
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.lg,
					boxShadow: lib.shadow.lg,
					fontFamily: lib.font
				},
				div(
					{
						width: '34px',
						height: '34px',
						borderRadius: lib.id === 'reactflow' ? lib.radius.sm : '999px',
						background: toneMap(lib, (palette) => palette.soft),
						color: toneMap(lib, (palette) => palette.onSoft),
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						flexShrink: 0
					},
					toneIcon(16)
				),
				stack(
					{ gap: '3px', flex: '1 1 auto', minWidth: 0 },
					row(
						{ justifyContent: 'space-between', gap: '8px' },
						text({ fontWeight: lib.headingWeight, fontSize: lib.fontSize.md, color: lib.text }, '{title}'),
						iff(
							'unread',
							div({ width: '8px', height: '8px', borderRadius: '999px', background: toneMap(lib, (palette) => palette.solid), flexShrink: 0 })
						)
					),
					text({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.45 }, '{body}'),
					text({ fontSize: lib.fontSize.xs, color: lib.faint, marginTop: '3px' }, '{time}')
				)
			)
		});

		const callout = define({
			slug: `${lib.id}-toast-notification-callout`,
			name: 'Callout',
			library: lib.id,
			category: 'feedback',
			description: `Inline callout box in the ${lib.label} style — soft tone wash with a matching border${lib.id === 'mui' || lib.id === 'untitled' ? ', accent left edge,' : ''} and an optional status icon beside the title and body.`,
			tags: ['callout', 'alert', 'feedback', 'inline'],
			args: [
				stringArg('title', 'Heads up', { label: 'Title', maxLength: 50 }),
				textArg('body', 'Scheduled maintenance runs this Sunday between 02:00 and 03:00 UTC.', { label: 'Body' }),
				toneArg(undefined, 'info'),
				booleanArg('showIcon', true, { label: 'Show icon' })
			],
			render: row(
				{
					alignItems: 'flex-start',
					gap: '10px',
					width: '360px',
					padding: '12px 14px',
					background: toneMap(lib, (palette) => palette.soft),
					color: toneMap(lib, (palette) => palette.onSoft),
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: toneMap(lib, (palette) => palette.border),
					...(lib.id === 'mui' || lib.id === 'untitled'
						? { borderLeftWidth: '3px', borderLeftColor: toneMap(lib, (palette) => palette.solid) }
						: {}),
					borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
					fontFamily: lib.font
				},
				iff('showIcon', span({ display: 'inline-flex', marginTop: '1px' }, toneIcon(16))),
				stack(
					{ gap: '2px' },
					text({ fontWeight: lib.headingWeight, fontSize: lib.fontSize.md }, '{title}'),
					text({ fontSize: lib.fontSize.sm, lineHeight: 1.5, opacity: 0.9 }, '{body}')
				)
			)
		});

		const topBannerBg =
			lib.id === 'thingtime'
				? ifEq('tone', 'primary', lib.rainbow, toneMap(lib, (palette) => palette.solid))
				: toneMap(lib, (palette) => palette.solid);
		const topBannerFg =
			lib.id === 'thingtime'
				? ifEq('tone', 'primary', lib.ink, toneMap(lib, (palette) => palette.onSolid))
				: toneMap(lib, (palette) => palette.onSolid);

		const topBanner = define({
			slug: `${lib.id}-toast-notification-top-banner`,
			name: 'Top Banner',
			library: lib.id,
			category: 'feedback',
			description: `Full-width announcement banner in the ${lib.label} style — solid tone strip${lib.id === 'thingtime' ? ' (the house rainbow on the primary tone)' : ''} with a bold message, inline link, and dismiss control.`,
			tags: ['banner', 'announcement', 'feedback', 'dismiss'],
			args: [
				stringArg('message', 'A new version is available.', { label: 'Message', maxLength: 80 }),
				stringArg('linkLabel', 'See what changed', { label: 'Link label', maxLength: 32 }),
				toneArg(),
				booleanArg('dismissible', true, { label: 'Dismissible' })
			],
			render: row(
				{
					width: '100%',
					minWidth: '360px',
					justifyContent: 'space-between',
					gap: '16px',
					padding: '10px 16px',
					background: topBannerBg,
					color: topBannerFg,
					fontFamily: lib.font,
					fontSize: lib.fontSize.sm
				},
				row(
					{ gap: '10px', flexWrap: 'wrap' },
					text({ fontWeight: 600 }, '{message}'),
					iff('linkLabel', text({ textDecoration: 'underline', fontWeight: 600, cursor: 'pointer', opacity: 0.9 }, '{linkLabel}'))
				),
				iff('dismissible', span({ display: 'inline-flex', cursor: 'pointer', opacity: 0.8 }, icons.x(14, 'currentColor')))
			)
		});

		return [toast, snackbar, card, callout, topBanner];
	}
};
