// Mail archetype — email surfaces in five renditions: inbox list row, open
// thread, compose window, folder sidebar, and attachment chips. Follows the
// button.mjs exemplar: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs `${lib.id}-mail-<variant>`.

import {
	avatarCircle,
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	ifEq,
	iff,
	merge,
	numberArg,
	stringArg,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

// reactflow's hot-pink accent and thingtime's pink wink stand in for the
// classic "unread blue"; everyone else leans on their primary.
const accentColor = (lib) => lib.accent ?? (lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.primary.solid);

// antd chips sit on tight corners, reactflow chrome stays crisp,
// everyone else keeps their native medium radius (chunky for daisyui).
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.md);

const hairline = (lib) => `1px solid ${lib.borderSoft}`;
const edge = (lib) => `${lib.id === 'daisyui' ? '2px' : '1px'} solid ${lib.border}`;

const upper = (lib) => (lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {});

const ghostButton = (lib, color) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '6px',
	height: lib.control.sm,
	padding: '0 10px',
	border: 'none',
	background: 'transparent',
	borderRadius: chipRadius(lib),
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	fontSize: lib.fontSize.sm,
	color,
	cursor: 'pointer',
	...upper(lib)
});

export const archetype = {
	id: 'mail',
	category: 'communication',
	variants: ['inbox-row', 'thread', 'compose', 'sidebar', 'attachments'],
	build(lib) {
		const inboxRow = define({
			slug: `${lib.id}-mail-inbox-row`,
			name: 'Inbox Row',
			library: lib.id,
			category: 'communication',
			description: `Mail list row in the ${lib.label} style — unread dot and bold sender on a fresh message, subject with muted snippet on one ellipsized line, time and star on the right.`,
			tags: ['mail', 'inbox', 'list', 'row', 'email'],
			args: [
				booleanArg('unread', true, { label: 'Unread' }),
				stringArg('sender', 'Ada Lovelace', { label: 'Sender', maxLength: 32 }),
				stringArg('subject', 'Q3 forecast review', { label: 'Subject', maxLength: 48 }),
				stringArg('snippet', 'Sharing the updated numbers ahead of tomorrow', { label: 'Snippet', maxLength: 80 }),
				stringArg('time', '9:41 AM', { label: 'Time', maxLength: 12 }),
				booleanArg('starred', false, { label: 'Starred' })
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						gap: '10px',
						width: '100%',
						maxWidth: '560px',
						boxSizing: 'border-box',
						padding: '10px 14px',
						background: iff('unread', lib.surface, lib.surfaceAlt),
						borderBottom: hairline(lib),
						fontFamily: lib.font
					}
				},
				el('span', {
					style: {
						width: '8px',
						height: '8px',
						borderRadius: lib.radius.pill,
						background: iff('unread', accentColor(lib), 'transparent'),
						flexShrink: 0
					}
				}),
				el(
					'span',
					{
						style: {
							width: '104px',
							flexShrink: 0,
							fontSize: lib.fontSize.sm,
							fontWeight: iff('unread', 700, 500),
							color: iff('unread', lib.text, lib.muted),
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis'
						}
					},
					'{sender}'
				),
				el(
					'div',
					{
						style: {
							flex: 1,
							minWidth: 0,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							fontSize: lib.fontSize.sm
						}
					},
					el('span', { style: { fontWeight: iff('unread', 600, 400), color: lib.text } }, '{subject}'),
					el('span', { style: { color: lib.muted } }, ' — {snippet}')
				),
				el(
					'span',
					{
						style: {
							flexShrink: 0,
							fontSize: lib.fontSize.xs,
							fontWeight: iff('unread', 600, 400),
							color: iff('unread', accentColor(lib), lib.muted)
						}
					},
					'{time}'
				),
				iff('starred', icons.star(16, lib.palette.warning.solid, true), icons.star(16, lib.faint))
			)
		});

		const avatarBg = lib.id === 'thingtime' ? lib.rainbow : lib.id === 'mui' ? lib.palette.primary.solid : lib.palette.primary.soft;
		const avatarFg = lib.id === 'thingtime' || lib.id === 'mui' ? lib.palette.primary.onSolid : lib.palette.primary.onSoft;

		const thread = define({
			slug: `${lib.id}-mail-thread`,
			name: 'Email Thread',
			library: lib.id,
			category: 'communication',
			description: `Open email thread in the ${lib.label} style — avatar sender header with a 'to me' caption and time, a collapsed earlier-messages bar, body paragraphs, and reply/forward ghost buttons.`,
			tags: ['mail', 'thread', 'message', 'email', 'conversation'],
			args: [
				stringArg('sender', 'Ada Lovelace', { label: 'Sender', maxLength: 32 }),
				stringArg('initials', 'AL', { label: 'Initials', maxLength: 3 }),
				stringArg('time', 'Mon 9:41 AM', { label: 'Time', maxLength: 16 }),
				textArg('body', 'Thanks for the notes — the revised forecast is looking much stronger this quarter.', {
					label: 'Body',
					maxLength: 240
				}),
				numberArg('earlier', 2, { label: 'Earlier messages', min: 1, max: 99 })
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						flexDirection: 'column',
						gap: '12px',
						maxWidth: '440px',
						boxSizing: 'border-box',
						padding: '16px',
						background: lib.surface,
						border: edge(lib),
						borderRadius: lib.radius.lg,
						boxShadow: lib.id === 'untitled' || lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
						fontFamily: lib.font
					}
				},
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '10px' } },
					avatarCircle('36px', avatarBg, avatarFg, '{initials}', lib.fontSize.sm),
					el(
						'div',
						{ style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
						el('span', { style: { fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text } }, '{sender}'),
						el(
							'span',
							{ style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: lib.fontSize.xs, color: lib.muted } },
							'to me',
							icons.chevronDown(12, lib.faint)
						)
					),
					el('span', { style: { marginLeft: 'auto', fontSize: lib.fontSize.xs, color: lib.muted, flexShrink: 0 } }, '{time}')
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							padding: '6px 12px',
							background: lib.surfaceAlt,
							border: hairline(lib),
							borderRadius: chipRadius(lib),
							fontSize: lib.fontSize.xs,
							color: lib.muted,
							cursor: 'pointer'
						}
					},
					'••• {earlier} earlier messages'
				),
				el('p', { style: { margin: 0, fontSize: lib.fontSize.sm, lineHeight: 1.6, color: lib.text } }, '{body}'),
				el(
					'p',
					{ style: { margin: 0, fontSize: lib.fontSize.sm, lineHeight: 1.6, color: lib.text } },
					'Happy to walk through the details whenever suits — the numbers are in the attached deck.'
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '4px' } },
					el('button', { type: 'button', style: ghostButton(lib, lib.palette.primary.solid) }, 'Reply'),
					el(
						'button',
						{ type: 'button', style: ghostButton(lib, lib.muted) },
						'Forward',
						icons.arrowRight(14, 'currentColor')
					)
				)
			)
		});

		const fieldLabel = (labelText) =>
			el('span', { style: { width: '56px', flexShrink: 0, fontSize: lib.fontSize.sm, color: lib.muted } }, labelText);

		const compose = define({
			slug: `${lib.id}-mail-compose`,
			name: 'Compose Window',
			library: lib.id,
			category: 'communication',
			description: `Compose window in the ${lib.label} style — To and Subject rows split by hairline dividers, placeholder body area, and a footer with a tone Send button, attach/format ghosts, and a discard trash icon.`,
			tags: ['mail', 'compose', 'email', 'editor', 'form'],
			args: [
				stringArg('to', 'ada@example.com', { label: 'To', maxLength: 48 }),
				stringArg('subject', 'Q3 forecast review', { label: 'Subject', maxLength: 48 }),
				textArg('placeholder', 'Write your message…', { label: 'Body placeholder', maxLength: 80 }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						flexDirection: 'column',
						maxWidth: '400px',
						overflow: 'hidden',
						background: lib.surface,
						border: edge(lib),
						borderRadius: lib.radius.lg,
						boxShadow: lib.shadow.lg,
						fontFamily: lib.font
					}
				},
				el(
					'div',
					{
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							padding: '8px 14px',
							background: lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid,
							color: lib.palette.primary.onSolid,
							fontSize: lib.fontSize.sm,
							fontWeight: lib.headingWeight
						}
					},
					'New message',
					icons.x(14, 'currentColor')
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: hairline(lib) } },
					fieldLabel('To'),
					el('span', { style: { fontSize: lib.fontSize.sm, color: lib.text } }, '{to}')
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: hairline(lib) } },
					fieldLabel('Subject'),
					el('span', { style: { fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text } }, '{subject}')
				),
				el(
					'div',
					{ style: { minHeight: '96px', padding: '12px 14px', fontSize: lib.fontSize.sm, lineHeight: 1.6, color: lib.faint } },
					'{placeholder}'
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '4px', padding: '10px 14px', borderTop: hairline(lib) } },
					el(
						'button',
						{
							type: 'button',
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								height: lib.control.sm,
								padding: '0 18px',
								marginRight: '6px',
								border: 'none',
								borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.id === 'daisyui' ? lib.radius.md : lib.radius.pill,
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								fontFamily: lib.font,
								fontWeight: lib.buttonWeight,
								fontSize: lib.fontSize.sm,
								cursor: 'pointer',
								boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
								...upper(lib)
							}
						},
						'Send'
					),
					el('button', { type: 'button', style: ghostButton(lib, lib.muted) }, icons.file(16, 'currentColor')),
					el('button', { type: 'button', style: ghostButton(lib, lib.muted) }, icons.edit(16, 'currentColor')),
					el(
						'button',
						{ type: 'button', style: { ...ghostButton(lib, lib.muted), marginLeft: 'auto' } },
						icons.trash(16, 'currentColor')
					)
				)
			)
		});

		const activeStyle =
			lib.id === 'reactflow'
				? { background: lib.palette.danger.soft, color: lib.palette.danger.onSoft, fontWeight: 600 }
				: lib.id === 'thingtime'
					? { background: lib.surfaceAlt, color: lib.ink, fontWeight: 600 }
					: { background: lib.palette.primary.soft, color: lib.palette.primary.onSoft, fontWeight: 600 };

		const folderRow = (key, icon, labelText, pill) =>
			el(
				'div',
				{
					style: merge(
						{
							display: 'flex',
							alignItems: 'center',
							gap: '10px',
							height: lib.control.sm,
							padding: '0 10px',
							borderRadius: chipRadius(lib),
							fontSize: lib.fontSize.sm,
							fontWeight: 500,
							color: lib.muted,
							cursor: 'pointer'
						},
						ifEq('active', key, activeStyle, {})
					)
				},
				icon,
				el('span', { style: { flex: 1 } }, labelText),
				pill
			);

		const countPill = (value, solid) =>
			el(
				'span',
				{
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						minWidth: '18px',
						height: '18px',
						padding: '0 5px',
						boxSizing: 'border-box',
						borderRadius: lib.radius.pill,
						background: solid ? accentColor(lib) : lib.surfaceAlt,
						color: solid ? lib.palette.primary.onSolid : lib.muted,
						fontSize: lib.fontSize.xs,
						fontWeight: 700,
						flexShrink: 0
					}
				},
				value
			);

		const sidebar = define({
			slug: `${lib.id}-mail-sidebar`,
			name: 'Mail Sidebar',
			library: lib.id,
			category: 'communication',
			description: `Mail folder rail in the ${lib.label} style — tone Compose button on top, then Inbox, Starred, Sent, Drafts, and Trash rows with icons, count pills, and one active folder highlight.`,
			tags: ['mail', 'sidebar', 'folders', 'navigation', 'email'],
			args: [
				enumArg('active', ['inbox', 'starred', 'sent', 'drafts', 'trash'], 'inbox', { label: 'Active folder' }),
				stringArg('inboxCount', '12', { label: 'Inbox count', maxLength: 5 }),
				stringArg('draftsCount', '3', { label: 'Drafts count', maxLength: 5 }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						display: 'flex',
						flexDirection: 'column',
						gap: '4px',
						width: '220px',
						boxSizing: 'border-box',
						padding: '12px',
						background: lib.surface,
						border: edge(lib),
						borderRadius: lib.radius.lg,
						boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none',
						fontFamily: lib.font
					}
				},
				el(
					'button',
					{
						type: 'button',
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							gap: '8px',
							height: lib.control.md,
							marginBottom: '8px',
							border: 'none',
							borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							fontFamily: lib.font,
							fontWeight: lib.buttonWeight,
							fontSize: lib.fontSize.sm,
							cursor: 'pointer',
							boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
							...upper(lib)
						}
					},
					icons.edit(16, 'currentColor'),
					'Compose'
				),
				folderRow('inbox', icons.mail(16, 'currentColor'), 'Inbox', countPill('{inboxCount}', true)),
				folderRow('starred', icons.star(16, 'currentColor'), 'Starred'),
				folderRow('sent', icons.arrowRight(16, 'currentColor'), 'Sent'),
				folderRow('drafts', icons.file(16, 'currentColor'), 'Drafts', countPill('{draftsCount}', false)),
				folderRow('trash', icons.trash(16, 'currentColor'), 'Trash')
			)
		});

		const attachmentChip = (icon, nameNode, sizeNode) =>
			el(
				'div',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						gap: '8px',
						padding: '6px 10px',
						background: lib.surface,
						border: edge(lib),
						borderRadius: chipRadius(lib),
						boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none',
						fontSize: lib.fontSize.sm
					}
				},
				icon,
				el('span', { style: { fontWeight: 500, color: lib.text } }, nameNode),
				el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, sizeNode)
			);

		const attachments = define({
			slug: `${lib.id}-mail-attachments`,
			name: 'Attachment Chips',
			library: lib.id,
			category: 'communication',
			description: `Attachment strip in the ${lib.label} style — file chips with type icon, name, and size, an image-attachment thumbnail tile on the library's soft surface, and a download-all ghost link.`,
			tags: ['mail', 'attachments', 'files', 'chips', 'email'],
			args: [
				stringArg('fileName', 'Q3-report.pdf', { label: 'File name', maxLength: 32 }),
				stringArg('fileSize', '2.4 MB', { label: 'File size', maxLength: 10 }),
				booleanArg('showImage', true, { label: 'Image thumbnail' }),
				toneArg()
			],
			render: el(
				'div',
				{ style: { display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '440px', fontFamily: lib.font } },
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
					attachmentChip(
						icons.file(
							16,
							toneMap(lib, (palette) => palette.solid)
						),
						'{fileName}',
						'{fileSize}'
					),
					attachmentChip(icons.file(16, lib.muted), 'Notes.docx', '18 KB'),
					iff(
						'showImage',
						el(
							'div',
							{
								style: {
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									width: '64px',
									height: '64px',
									background: lib.surfaceAlt,
									border: edge(lib),
									borderRadius: chipRadius(lib),
									flexShrink: 0
								}
							},
							icons.image(22, lib.faint)
						)
					)
				),
				el(
					'button',
					{
						type: 'button',
						style: {
							...ghostButton(
								lib,
								toneMap(lib, (palette) => palette.solid)
							),
							alignSelf: 'flex-start',
							padding: 0
						}
					},
					icons.download(14, 'currentColor'),
					'Download all'
				)
			)
		});

		return [inboxRow, thread, compose, sidebar, attachments];
	}
};
