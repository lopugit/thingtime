// Chat archetype — messaging surfaces in five renditions: a message bubble
// pair, a short alternating thread, a composer bar, a typing indicator, and a
// chat-list contact row. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-chat-<variant>`.

import {
	avatarCircle,
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	map,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// daisyUI bubbles go extra-round and React Flow stays crisp; the tail-side
// corner drops to the library's xs radius so each bubble points at its sender.
const bubbleRound = (lib) => (lib.id === 'daisyui' ? lib.radius.lg : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.md);
const incomingRadius = (lib) => `${bubbleRound(lib)} ${bubbleRound(lib)} ${bubbleRound(lib)} ${lib.radius.xs}`;
const outgoingRadius = (lib) => `${bubbleRound(lib)} ${bubbleRound(lib)} ${lib.radius.xs} ${bubbleRound(lib)}`;

const bubbleBase = (lib) => ({
	padding: '8px 12px',
	maxWidth: '220px',
	fontSize: lib.fontSize.md,
	lineHeight: 1.45
});

const incomingBubble = (lib, extra = {}) => ({
	...bubbleBase(lib),
	background: lib.surfaceAlt,
	color: lib.text,
	borderRadius: incomingRadius(lib),
	// React Flow incoming bubbles wear the library's signature crisp node border.
	...(lib.id === 'reactflow' ? { borderWidth: '1px', borderStyle: 'solid', borderColor: lib.border } : {}),
	...extra
});

const outgoingBubble = (lib, extra = {}) => ({
	...bubbleBase(lib),
	background: toneMap(lib, (palette) => palette.solid),
	color: toneMap(lib, (palette) => palette.onSolid),
	borderRadius: outgoingRadius(lib),
	...(lib.id === 'mui' ? { boxShadow: lib.shadow.sm } : {}),
	...extra
});

const threadAvatar = (lib) => avatarCircle('28px', lib.palette.neutral.soft, lib.palette.neutral.onSoft, '{initials}', lib.fontSize.xs);

// Composer glyphs the shared icon set lacks (allowlisted svg primitives only).
const composerSvg = (size, color, ...children) =>
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

const sendIcon = (size, color) =>
	composerSvg(size, color, el('line', { x1: 22, y1: 2, x2: 11, y2: 13 }), el('polygon', { points: '22 2 15 22 11 13 2 9 22 2' }));

const micIcon = (size, color) =>
	composerSvg(
		size,
		color,
		el('path', { d: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z' }),
		el('path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }),
		el('line', { x1: 12, y1: 19, x2: 12, y2: 23 })
	);

const iconButton = (lib, extra = {}) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	width: '36px',
	height: '36px',
	flexShrink: 0,
	border: 'none',
	borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
	cursor: 'pointer',
	...extra
});

export const archetype = {
	id: 'chat',
	category: 'messaging',
	variants: ['bubble', 'thread', 'input', 'typing', 'contact'],
	build(lib) {
		const bubble = define({
			slug: `${lib.id}-chat-bubble`,
			name: 'Message Bubble Pair',
			library: lib.id,
			category: 'messaging',
			description: `Incoming and outgoing chat bubbles in the ${lib.label} style — quiet surface on the left, tone-solid reply on the right, ${lib.id === 'daisyui' ? 'extra-round corners' : lib.id === 'reactflow' ? 'crisp node-like corners' : 'library-native corners'} with a sharp tail edge and a timestamp.`,
			tags: ['chat', 'message', 'bubble', 'conversation'],
			args: [
				stringArg('incoming', 'Hey! Did you see the launch?', { label: 'Incoming message', maxLength: 120 }),
				stringArg('outgoing', 'Just saw it — looks great!', { label: 'Outgoing message', maxLength: 120 }),
				toneArg(),
				stringArg('time', '9:41 AM', { label: 'Timestamp', maxLength: 12 })
			],
			render: stack(
				{ gap: '6px', width: '280px', fontFamily: lib.font },
				el('div', { style: incomingBubble(lib, { alignSelf: 'flex-start' }) }, '{incoming}'),
				el('div', { style: outgoingBubble(lib, { alignSelf: 'flex-end' }) }, '{outgoing}'),
				text({ alignSelf: 'flex-end', fontSize: lib.fontSize.xs, color: lib.muted }, '{time}')
			)
		});

		const thread = define({
			slug: `${lib.id}-chat-thread`,
			name: 'Chat Thread',
			library: lib.id,
			category: 'messaging',
			description: `Short alternating conversation in the ${lib.label} style — a date divider chip, incoming bubbles with an initials avatar, and tone-solid replies aligned to the right.`,
			tags: ['chat', 'thread', 'conversation', 'messages'],
			args: [
				stringArg('divider', 'Today', { label: 'Date divider', maxLength: 20 }),
				stringArg('initials', 'AL', { label: 'Avatar initials', maxLength: 3 }),
				stringArg('incoming', 'Are we still on for tonight?', { label: 'First message', maxLength: 120 }),
				stringArg('outgoing', 'Yes! See you at six.', { label: 'Reply', maxLength: 120 }),
				toneArg()
			],
			render: stack(
				{ gap: '8px', width: '300px', fontFamily: lib.font },
				row(
					{ justifyContent: 'center' },
					el(
						'span',
						{
							style: {
								background: lib.surfaceAlt,
								color: lib.muted,
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								padding: '2px 10px',
								borderRadius: lib.radius.pill
							}
						},
						'{divider}'
					)
				),
				row(
					{ gap: '8px', alignItems: 'flex-end', alignSelf: 'flex-start' },
					threadAvatar(lib),
					el('div', { style: incomingBubble(lib) }, '{incoming}')
				),
				el('div', { style: outgoingBubble(lib, { alignSelf: 'flex-end' }) }, '{outgoing}'),
				row(
					{ gap: '8px', alignItems: 'flex-end', alignSelf: 'flex-start' },
					threadAvatar(lib),
					el('div', { style: incomingBubble(lib) }, 'Perfect — bringing snacks.')
				),
				el('div', { style: outgoingBubble(lib, { alignSelf: 'flex-end' }) }, 'Legend.')
			)
		});

		const input = define({
			slug: `${lib.id}-chat-input`,
			name: 'Message Composer',
			library: lib.id,
			category: 'messaging',
			description: `Chat composer bar in the ${lib.label} style — attach button, ${lib.id === 'reactflow' ? 'crisp' : 'rounded'} text field with placeholder, and a tone-solid action that flips between send and mic.`,
			tags: ['chat', 'composer', 'input', 'send'],
			args: [
				stringArg('placeholder', 'Type a message…', { label: 'Placeholder', maxLength: 60 }),
				toneArg(),
				booleanArg('send', true, { label: 'Ready to send' }),
				booleanArg('attach', true, { label: 'Show attach' })
			],
			render: row(
				{ gap: '8px', width: '320px', fontFamily: lib.font },
				iff(
					'attach',
					el(
						'button',
						{ type: 'button', style: iconButton(lib, { background: 'transparent', color: lib.muted }) },
						icons.plus(18, 'currentColor')
					)
				),
				el('input', {
					type: 'text',
					placeholder: '{placeholder}',
					style: {
						flex: 1,
						minWidth: 0,
						height: '36px',
						boxSizing: 'border-box',
						padding: '0 14px',
						background: lib.surfaceAlt,
						color: lib.text,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.border,
						borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
						fontSize: lib.fontSize.md,
						fontFamily: lib.font,
						outline: 'none',
						boxShadow: lib.id === 'untitled' || lib.id === 'mui' ? lib.shadow.sm : 'none'
					}
				}),
				el(
					'button',
					{
						type: 'button',
						style: iconButton(lib, {
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid)
						})
					},
					iff('send', sendIcon(16, 'currentColor'), micIcon(16, 'currentColor'))
				)
			)
		});

		const typing = define({
			slug: `${lib.id}-chat-typing`,
			name: 'Typing Indicator',
			library: lib.id,
			category: 'messaging',
			description: `Incoming typing indicator in the ${lib.label} style — an initials avatar beside a quiet bubble holding three muted dots, with a name-is-typing caption underneath.`,
			tags: ['chat', 'typing', 'indicator', 'presence'],
			args: [
				stringArg('name', 'Alex', { label: 'Name', maxLength: 24 }),
				stringArg('initials', 'AX', { label: 'Avatar initials', maxLength: 3 }),
				booleanArg('showAvatar', true, { label: 'Show avatar' })
			],
			render: row(
				{ gap: '8px', alignItems: 'flex-end', fontFamily: lib.font },
				iff('showAvatar', threadAvatar(lib)),
				stack(
					{ gap: '4px' },
					el(
						'div',
						{
							style: incomingBubble(lib, {
								display: 'inline-flex',
								alignItems: 'center',
								gap: '4px',
								padding: '11px 12px',
								width: 'fit-content'
							})
						},
						{
							ttRepeat: {
								count: 3,
								max: 3,
								node: el('span', { style: { width: '7px', height: '7px', borderRadius: '999px', background: lib.faint } })
							}
						}
					),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{name} is typing…')
				)
			)
		});

		const contact = define({
			slug: `${lib.id}-chat-contact`,
			name: 'Chat List Row',
			library: lib.id,
			category: 'messaging',
			description: `Chat list contact row in the ${lib.label} style — initials avatar with a presence dot, name and one-line preview, timestamp, and an unread pill that hides at zero.`,
			tags: ['chat', 'contact', 'list', 'presence', 'unread'],
			args: [
				stringArg('name', 'Sam Rivera', { label: 'Name', maxLength: 40 }),
				stringArg('initials', 'SR', { label: 'Initials', maxLength: 3 }),
				stringArg('preview', 'Sounds good — see you there!', { label: 'Last message', maxLength: 80 }),
				stringArg('time', '12:47', { label: 'Time', maxLength: 12 }),
				enumArg('presence', ['online', 'away', 'busy'], 'online', { label: 'Presence' }),
				stringArg('count', '3', { label: 'Unread count', maxLength: 4 })
			],
			render: row(
				{
					gap: '10px',
					padding: '10px 12px',
					width: '300px',
					boxSizing: 'border-box',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft,
					borderRadius: lib.radius.md,
					fontFamily: lib.font,
					boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
				},
				el(
					'div',
					{ style: { position: 'relative', flexShrink: 0 } },
					avatarCircle('40px', lib.palette.neutral.soft, lib.palette.neutral.onSoft, '{initials}', lib.fontSize.sm),
					el('span', {
						style: {
							position: 'absolute',
							right: '0',
							bottom: '0',
							width: '10px',
							height: '10px',
							borderRadius: '999px',
							background: map(
								'presence',
								{
									online: lib.palette.success.solid,
									away: lib.palette.warning.solid,
									busy: lib.palette.danger.solid
								},
								lib.palette.success.solid
							),
							boxShadow: `0 0 0 2px ${lib.surface}`
						}
					})
				),
				stack(
					{ flex: 1, minWidth: 0, gap: '2px' },
					row(
						{ justifyContent: 'space-between', gap: '8px' },
						text(
							{
								fontSize: lib.fontSize.md,
								fontWeight: lib.headingWeight,
								color: lib.text,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis'
							},
							'{name}'
						),
						text({ fontSize: lib.fontSize.xs, color: lib.muted, flexShrink: 0 }, '{time}')
					),
					row(
						{ justifyContent: 'space-between', gap: '8px' },
						text(
							{
								fontSize: lib.fontSize.sm,
								color: lib.muted,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								minWidth: 0
							},
							'{preview}'
						),
						iff(
							'count',
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
										background: lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid,
										color: lib.palette.primary.onSolid,
										fontSize: lib.fontSize.xs,
										fontWeight: 700,
										flexShrink: 0
									}
								},
								'{count}'
							)
						)
					)
				)
			)
		});

		return [bubble, thread, input, typing, contact];
	}
};
