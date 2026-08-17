// Security & privacy archetype — five security surfaces: a 2FA setup card,
// a password-vault row, a permission request dialog, an audit log, and a VPN
// status card. Follows the button.mjs exemplar: exactly 5 variants, `build(lib)`
// returns exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-security-privacy-<variant>`.

import {
	arg,
	avatarCircle,
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	map,
	merge,
	numberArg,
	repeat,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// mui + untitled cards float on their signature elevation/feather shadows;
// everyone else keeps a quiet sm shadow.
const cardShadow = (lib) => (lib.id === 'mui' || lib.id === 'untitled' ? lib.shadow.lg : lib.shadow.sm);

const cardStyle = (lib, extra = {}) => ({
	display: 'flex',
	flexDirection: 'column',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	fontFamily: lib.font,
	boxShadow: cardShadow(lib),
	boxSizing: 'border-box',
	...extra
});

// Thingtime's rainbow wink: a thin gradient strip across the top of its cards.
const rainbowStrip = (lib) =>
	lib.id === 'thingtime'
		? el('div', { style: { height: '4px', borderRadius: lib.radius.pill, background: lib.rainbow } })
		: null;

// reactflow links glow in the graph accent; thingtime borrows its info pink.
const linkColor = (lib) =>
	lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.primary.solid;

const ghostBtn = (lib, label, color) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				background: 'transparent',
				border: 'none',
				color,
				fontFamily: lib.font,
				fontSize: lib.fontSize.xs,
				fontWeight: 600,
				cursor: 'pointer',
				padding: '4px 8px',
				borderRadius: lib.radius.sm,
				whiteSpace: 'nowrap',
				...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
			}
		},
		label
	);

const captionStyle = (lib) => ({ fontSize: lib.fontSize.xs, color: lib.muted });

// --- 2fa: mock QR (grid of small rects, ticket-stub school) -----------------

const qrFinder = (x, y, ink) => [
	el('rect', { x, y, width: 12, height: 12, fill: 'none', stroke: ink, strokeWidth: 2 }),
	el('rect', { x: x + 4, y: y + 4, width: 4, height: 4 })
];

const QR_MODULES = [
	[18, 4], [26, 6], [18, 12], [24, 14], [32, 18], [4, 18],
	[10, 22], [18, 22], [26, 26], [34, 30], [18, 32], [26, 36]
];

const qrSvg = (lib) => {
	const ink = lib.id === 'thingtime' ? lib.ink : lib.text;
	return el(
		'svg',
		{ width: 64, height: 64, viewBox: '0 0 44 44', fill: ink, xmlns: 'http://www.w3.org/2000/svg' },
		...qrFinder(2, 2, ink),
		...qrFinder(30, 2, ink),
		...qrFinder(2, 30, ink),
		...QR_MODULES.map(([x, y]) => el('rect', { x, y, width: 4, height: 4 }))
	);
};

// --- vpn + vault status color maps ------------------------------------------

const statusColor = (lib) =>
	map(
		'status',
		{
			connected: lib.palette.success.solid,
			connecting: lib.palette.warning.solid,
			disconnected: lib.faint
		},
		lib.palette.success.solid
	);

const strengthColor = (lib) =>
	map(
		'strength',
		{
			weak: lib.palette.danger.solid,
			fair: lib.palette.warning.solid,
			strong: lib.palette.success.solid
		},
		lib.palette.success.solid
	);

// --- permission glyphs (camera / location / contacts — mic-free) ------------

const permGlyph = (lib, ...shapes) =>
	el(
		'span',
		{ style: { color: lib.muted, display: 'flex', flexShrink: 0 } },
		el(
			'svg',
			{
				width: 16,
				height: 16,
				viewBox: '0 0 24 24',
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: 2,
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
				xmlns: 'http://www.w3.org/2000/svg'
			},
			...shapes
		)
	);

const permRow = (lib, glyph, label) =>
	row({ gap: '10px', padding: '7px 0' }, glyph, text({ fontSize: lib.fontSize.sm, color: lib.text, fontWeight: 500 }, label));

// --- audit log row ----------------------------------------------------------

const auditTile = (lib, palette, icon) =>
	el(
		'div',
		{
			style: {
				width: '32px',
				height: '32px',
				borderRadius: lib.radius.sm,
				background: palette.soft,
				color: palette.onSoft,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				flexShrink: 0
			}
		},
		icon
	);

const auditTime = (lib, when) =>
	text(
		{ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: lib.faint, marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 },
		when
	);

const auditLine = (lib, actorNode, action) =>
	el(
		'span',
		{ style: { fontSize: lib.fontSize.sm, color: lib.text, lineHeight: 1.4 } },
		el('strong', { style: { fontWeight: 600 } }, actorNode),
		action
	);

export const archetype = {
	id: 'security-privacy',
	category: 'security',
	variants: ['2fa', 'vault-row', 'permission', 'audit-log', 'vpn'],
	build(lib) {
		const twofa = define({
			slug: `${lib.id}-security-privacy-2fa`,
			name: 'Two-Factor Setup Card',
			library: lib.id,
			category: 'security',
			description: `Two-factor setup card in the ${lib.label} style — step caption, mock QR rect grid, mono secret chip with a copy ghost, paired verify-code box groups, and a can't-scan escape link.`,
			tags: ['security', '2fa', 'authentication', 'card', 'qr'],
			args: [
				numberArg('step', 1, { label: 'Step' }),
				stringArg('secret', 'JBSW-Y3DP-EHPK-3PXP', { label: 'Secret', maxLength: 32 }),
				numberArg('boxes', 3, { label: 'Boxes per group' }),
				booleanArg('helpLink', true, { label: 'Show help link' })
			],
			render: el(
				'div',
				{ style: cardStyle(lib, { width: '290px', padding: '18px', gap: '14px' }) },
				rainbowStrip(lib),
				text(
					{ fontSize: lib.fontSize.xs, color: lib.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' },
					'Step {step} of 2 · Scan in your authenticator'
				),
				row(
					{ justifyContent: 'center' },
					el(
						'div',
						{
							style: {
								padding: '10px',
								background: lib.surface,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.borderSoft,
								borderRadius: lib.radius.md,
								display: 'flex'
							}
						},
						qrSvg(lib)
					)
				),
				row(
					{ gap: '10px', justifyContent: 'space-between', background: lib.surfaceAlt, borderRadius: lib.radius.md, padding: '8px 12px' },
					el(
						'code',
						{ style: { fontFamily: lib.fontMono, fontSize: lib.fontSize.sm, color: lib.text, letterSpacing: '0.08em' } },
						'{secret}'
					),
					ghostBtn(lib, 'Copy', linkColor(lib))
				),
				text(captionStyle(lib), 'Then enter the 6-digit code to verify'),
				row(
					{ gap: '10px', justifyContent: 'center' },
					el('div', { style: { display: 'flex', gap: '6px' } }, repeat('boxes', 4, verifyBox(lib))),
					text({ color: lib.faint, fontSize: lib.fontSize.md }, '—'),
					el('div', { style: { display: 'flex', gap: '6px' } }, repeat('boxes', 4, verifyBox(lib)))
				),
				iff(
					'helpLink',
					el(
						'a',
						{
							href: '#',
							style: {
								color: linkColor(lib),
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								fontFamily: lib.font,
								textDecoration: 'none',
								textAlign: 'center'
							}
						},
						'Can’t scan? Enter the key manually'
					)
				)
			)
		});

		const vaultRow = define({
			slug: `${lib.id}-security-privacy-vault-row`,
			name: 'Vault Password Row',
			library: lib.id,
			category: 'security',
			description: `Password-manager vault row in the ${lib.label} style — favicon initial tile, site and username captions, a strength dot, last-changed note, copy/reveal ghosts, and a reused-password warning chip.`,
			tags: ['security', 'password', 'vault', 'row'],
			args: [
				stringArg('site', 'github.com', { label: 'Site', maxLength: 40 }),
				stringArg('initial', 'G', { label: 'Favicon initial', maxLength: 2 }),
				stringArg('username', 'nikolaj@thingtime.com', { label: 'Username', maxLength: 60 }),
				enumArg('strength', ['weak', 'fair', 'strong'], 'strong', { label: 'Strength' }),
				booleanArg('reused', false, { label: 'Reused password' }),
				stringArg('changed', '3 mo ago', { label: 'Last changed', maxLength: 20 })
			],
			render: row(
				{
					gap: '12px',
					width: '400px',
					boxSizing: 'border-box',
					padding: '10px 14px',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.radius.md,
					fontFamily: lib.font,
					boxShadow: cardShadow(lib)
				},
				avatarCircle('36px', lib.palette.primary.soft, lib.palette.primary.onSoft, '{initial}', lib.fontSize.md, {
					borderRadius: lib.radius.sm
				}),
				stack(
					{ gap: '2px', minWidth: 0, flex: 1 },
					row(
						{ gap: '8px' },
						text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '{site}'),
						iff(
							'reused',
							el(
								'span',
								{
									style: {
										background: lib.palette.warning.soft,
										color: lib.palette.warning.onSoft,
										fontSize: lib.fontSize.xs,
										fontWeight: 600,
										padding: '1px 8px',
										borderRadius: lib.radius.pill,
										whiteSpace: 'nowrap',
										...(lib.id === 'antd'
											? { borderWidth: '1px', borderStyle: 'solid', borderColor: lib.palette.warning.border }
											: {})
									}
								},
								'Reused'
							)
						)
					),
					text(captionStyle(lib), '{username}'),
					row(
						{ gap: '6px' },
						el('span', {
							style: { width: '7px', height: '7px', borderRadius: '999px', background: strengthColor(lib), flexShrink: 0 }
						}),
						el(
							'span',
							{ style: { fontSize: lib.fontSize.xs, fontWeight: 600, color: strengthColor(lib), textTransform: 'capitalize' } },
							'{strength}'
						),
						text({ fontSize: lib.fontSize.xs, color: lib.faint }, '· Updated {changed}')
					)
				),
				row(
					{ gap: '2px', marginLeft: 'auto', flexShrink: 0 },
					ghostBtn(lib, 'Copy', lib.muted),
					ghostBtn(lib, 'Reveal', linkColor(lib))
				)
			)
		});

		const permission = define({
			slug: `${lib.id}-security-privacy-permission`,
			name: 'Permission Request Dialog',
			library: lib.id,
			category: 'security',
			description: `Permission request dialog in the ${lib.label} style — app tile beside a wants-to-access header, camera/location/contacts rows with glyphs, a remember checkbox, and a Deny ghost paired with a tone-filled Allow.`,
			tags: ['security', 'permission', 'dialog', 'privacy'],
			args: [
				stringArg('app', 'Figma', { label: 'App name', maxLength: 30 }),
				toneArg(),
				booleanArg('remember', true, { label: 'Remember checked' }),
				stringArg('allowLabel', 'Allow', { label: 'Allow label', maxLength: 20 })
			],
			render: el(
				'div',
				{ style: cardStyle(lib, { width: '320px', padding: '18px', gap: '12px' }) },
				row(
					{ gap: '12px' },
					el(
						'div',
						{
							style: {
								width: '38px',
								height: '38px',
								borderRadius: lib.radius.md,
								background: toneMap(lib, (palette) => palette.soft),
								color: toneMap(lib, (palette) => palette.onSoft),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0
							}
						},
						icons.zap(18, 'currentColor')
					),
					stack(
						{ gap: '2px' },
						text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{app} wants to access'),
						text(captionStyle(lib), 'You can change this later in Settings')
					)
				),
				stack(
					{ borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft, paddingTop: '4px' },
					permRow(
						lib,
						permGlyph(
							lib,
							el('path', { d: 'M23 7l-7 5 7 5V7z' }),
							el('rect', { x: 1, y: 5, width: 15, height: 14, rx: 2 })
						),
						'Camera'
					),
					permRow(
						lib,
						permGlyph(
							lib,
							el('path', { d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' }),
							el('circle', { cx: 12, cy: 10, r: 3 })
						),
						'Location'
					),
					permRow(
						lib,
						permGlyph(
							lib,
							el('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
							el('circle', { cx: 12, cy: 7, r: 4 })
						),
						'Contacts'
					)
				),
				row(
					{ gap: '8px' },
					el('input', { type: 'checkbox', checked: arg('remember'), style: { width: '15px', height: '15px', margin: 0 } }),
					text(captionStyle(lib), 'Remember my choice for {app}')
				),
				row(
					{ gap: '8px', justifyContent: 'flex-end' },
					el(
						'button',
						{
							type: 'button',
							style: {
								height: lib.control.sm,
								padding: '0 14px',
								background: 'transparent',
								border: 'none',
								borderRadius: lib.radius.md,
								color: lib.muted,
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								fontWeight: lib.buttonWeight,
								cursor: 'pointer',
								...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
							}
						},
						'Deny'
					),
					el(
						'button',
						{
							type: 'button',
							style: {
								height: lib.control.sm,
								padding: '0 16px',
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								border: 'none',
								borderRadius: lib.radius.md,
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								fontWeight: lib.buttonWeight,
								cursor: 'pointer',
								boxShadow: lib.id === 'mui' ? lib.shadow.md : 'none',
								...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
							}
						},
						'{allowLabel}'
					)
				)
			)
		});

		const auditLog = define({
			slug: `${lib.id}-security-privacy-audit-log`,
			name: 'Security Audit Log',
			library: lib.id,
			category: 'security',
			description: `Security audit log in the ${lib.label} style — three event rows with icon tiles, bold actor plus action text, IP and device captions, mono timestamps, and a danger-tinted suspicious entry with a review link.`,
			tags: ['security', 'audit', 'log', 'activity'],
			args: [
				stringArg('actor', 'Nikolaj', { label: 'Actor', maxLength: 30 }),
				stringArg('action', ' changed the account password', { label: 'Action', maxLength: 60 }),
				stringArg('ip', '49.180.12.77', { label: 'IP address', maxLength: 40 }),
				booleanArg('flagged', true, { label: 'Flag suspicious entry' })
			],
			render: el(
				'div',
				{ style: cardStyle(lib, { width: '400px', padding: '10px', gap: '4px' }) },
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: lib.radius.md } },
					auditTile(lib, lib.palette.neutral, icons.settings(15, 'currentColor')),
					stack(
						{ gap: '2px', minWidth: 0, flex: 1 },
						auditLine(lib, '{actor}', '{action}'),
						text(captionStyle(lib), '{ip} · MacBook Pro · Sydney, AU')
					),
					auditTime(lib, '2m ago')
				),
				el(
					'div',
					{
						style: merge(
							{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: lib.radius.md },
							iff('flagged', { background: lib.palette.danger.soft }, {})
						)
					},
					auditTile(lib, lib.palette.danger, icons.alert(15, 'currentColor')),
					stack(
						{ gap: '2px', minWidth: 0, flex: 1 },
						auditLine(lib, 'Unknown device', ' signed in from a new location'),
						text(captionStyle(lib), '185.220.101.4 · Windows · Riga, LV'),
						iff(
							'flagged',
							el(
								'a',
								{
									href: '#',
									style: {
										color: lib.palette.danger.solid,
										fontSize: lib.fontSize.xs,
										fontWeight: 600,
										textDecoration: 'underline'
									}
								},
								'Review this sign-in'
							)
						)
					),
					auditTime(lib, '1h ago')
				),
				el(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: lib.radius.md } },
					auditTile(lib, lib.palette.neutral, icons.user(15, 'currentColor')),
					stack(
						{ gap: '2px', minWidth: 0, flex: 1 },
						auditLine(lib, 'Mia K.', ' generated an API token'),
						text(captionStyle(lib), '10.0.12.4 · CLI · read-only scope')
					),
					auditTime(lib, 'Yesterday')
				)
			)
		});

		// daisyui gets its chunky oversized toggle.
		const chunky = lib.id === 'daisyui';
		const vpn = define({
			slug: `${lib.id}-security-privacy-vpn`,
			name: 'VPN Status Card',
			library: lib.id,
			category: 'security',
			description: `VPN status card in the ${lib.label} style — shield outline and status dot flipping success/warning/muted, a server row with a change ghost, up/down speed captions, and a big status-driven toggle.`,
			tags: ['security', 'vpn', 'status', 'card', 'toggle'],
			args: [
				enumArg('status', ['connected', 'connecting', 'disconnected'], 'connected', { label: 'Status' }),
				stringArg('location', 'Sydney, AU', { label: 'Server location', maxLength: 40 }),
				stringArg('down', '312', { label: 'Down Mbps', maxLength: 8 }),
				stringArg('up', '86', { label: 'Up Mbps', maxLength: 8 })
			],
			render: el(
				'div',
				{ style: cardStyle(lib, { width: '290px', padding: '16px', gap: '14px' }) },
				rainbowStrip(lib),
				row(
					{ gap: '12px' },
					el(
						'svg',
						{
							width: 28,
							height: 28,
							viewBox: '0 0 24 24',
							fill: 'none',
							stroke: statusColor(lib),
							strokeWidth: 2,
							strokeLinecap: 'round',
							strokeLinejoin: 'round',
							xmlns: 'http://www.w3.org/2000/svg'
						},
						el('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
						el('polyline', { points: '9 12 11 14 15 10' })
					),
					stack(
						{ gap: '2px', flex: 1, minWidth: 0 },
						row(
							{ gap: '6px' },
							el('span', {
								style: { width: '8px', height: '8px', borderRadius: '999px', background: statusColor(lib), flexShrink: 0 }
							}),
							el(
								'span',
								{
									style: {
										fontSize: lib.fontSize.lg,
										fontWeight: lib.headingWeight,
										color: lib.text,
										textTransform: 'capitalize'
									}
								},
								'{status}'
							)
						),
						text(captionStyle(lib), 'Private connection')
					),
					el(
						'div',
						{
							style: {
								width: chunky ? '56px' : '48px',
								height: chunky ? '32px' : '28px',
								borderRadius: lib.radius.pill,
								padding: '3px',
								boxSizing: 'border-box',
								background: map(
									'status',
									{
										connected: lib.palette.success.solid,
										connecting: lib.palette.warning.solid,
										disconnected: lib.border
									},
									lib.palette.success.solid
								),
								display: 'flex',
								alignItems: 'center',
								justifyContent: ifEq('status', 'disconnected', 'flex-start', 'flex-end'),
								flexShrink: 0
							}
						},
						el('div', {
							style: {
								width: chunky ? '26px' : '22px',
								height: chunky ? '26px' : '22px',
								borderRadius: lib.radius.pill,
								background: lib.surface,
								boxShadow: lib.shadow.sm
							}
						})
					)
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							alignItems: 'center',
							gap: '10px',
							background: lib.surfaceAlt,
							borderRadius: lib.radius.md,
							padding: '8px 12px'
						}
					},
					stack(
						{ gap: '1px', flex: 1, minWidth: 0 },
						text(
							{ fontSize: lib.fontSize.xs, color: lib.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' },
							'Server'
						),
						text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '{location}')
					),
					ghostBtn(lib, 'Change', linkColor(lib))
				),
				row(
					{ gap: '14px' },
					text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: lib.muted }, '↓ {down} Mbps'),
					text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: lib.muted }, '↑ {up} Mbps')
				)
			)
		});

		return [twofa, vaultRow, permission, auditLog, vpn];
	}
};

// Verify-code entry box (empty on purpose — never text inside an input value).
function verifyBox(lib) {
	return el('div', {
		style: {
			width: '30px',
			height: '38px',
			borderWidth: '1px',
			borderStyle: 'solid',
			borderColor: lib.border,
			borderRadius: lib.radius.sm,
			background: lib.surfaceAlt,
			boxSizing: 'border-box'
		}
	});
}
