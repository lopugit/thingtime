// Navbar archetype — app navigation chrome: top bars, search bar, account
// cluster, sidebar rail, and a mobile bottom tab bar.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-navbar-<variant>`.

import {
	avatarCircle,
	define,
	el,
	enumArg,
	icons,
	ifEq,
	row,
	stack,
	stringArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

const CATEGORY = 'navigation';

const barHeight = (lib) => (lib.id === 'daisyui' ? '64px' : lib.id === 'reactflow' ? '48px' : '56px');

// Square logo mark — tone-filled, except Thingtime keeps its rainbow wink.
// `filled` = mark sits on a filled (MUI-style) primary bar.
const brandMark = (lib, filled = false) =>
	el(
		'div',
		{
			style: {
				width: '26px',
				height: '26px',
				borderRadius: lib.radius.sm,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				flexShrink: 0,
				background: filled
					? 'rgba(255, 255, 255, 0.2)'
					: lib.id === 'thingtime'
						? lib.rainbow
						: toneMap(lib, (palette) => palette.solid),
				color: filled || lib.id === 'thingtime' ? '#ffffff' : toneMap(lib, (palette) => palette.onSolid)
			}
		},
		icons.zap(14, 'currentColor')
	);

const brandGroup = (lib, filled = false) =>
	row(
		{ gap: '9px' },
		brandMark(lib, filled),
		el(
			'span',
			{
				style: {
					fontFamily: lib.font,
					fontWeight: lib.headingWeight,
					fontSize: lib.fontSize.lg,
					color: filled ? toneMap(lib, (palette) => palette.onSolid) : lib.text
				}
			},
			'{brand}'
		)
	);

const barStyle = (lib, filled = false) => ({
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: '24px',
	width: '100%',
	boxSizing: 'border-box',
	height: barHeight(lib),
	padding: '0 18px',
	fontFamily: lib.font,
	background: filled ? toneMap(lib, (palette) => palette.solid) : lib.surface,
	borderBottom: filled ? 'none' : `1px solid ${lib.border}`,
	boxShadow: filled ? lib.shadow.md : lib.shadow.sm
});

const mutedIcon = (lib, icon, filled = false) =>
	el('div', { style: { display: 'flex', color: filled ? 'rgba(255, 255, 255, 0.85)' : lib.muted } }, icon(18, 'currentColor'));

export const archetype = {
	id: 'navbar',
	category: CATEGORY,
	variants: ['top', 'search', 'user', 'sidebar', 'bottom-tabs'],
	build(lib) {
		const filled = lib.id === 'mui'; // MUI AppBars ship filled with the primary color

		const navLink = (lib_, label, activeLink) =>
			el(
				'span',
				{
					style: {
						fontSize: lib_.fontSize.sm,
						fontWeight: activeLink ? 600 : 500,
						cursor: 'pointer',
						color: activeLink
							? filled
								? toneMap(lib_, (palette) => palette.onSolid)
								: toneMap(lib_, (palette) => palette.solid)
							: filled
								? 'rgba(255, 255, 255, 0.72)'
								: lib_.muted
					}
				},
				label
			);

		const top = define({
			slug: `${lib.id}-navbar-top`,
			name: 'Top Navbar',
			library: lib.id,
			category: CATEGORY,
			description: `Top app bar in the ${lib.label} style — brand mark and name on the left, inline navigation links, and a quiet bell on the right${filled ? ', set on a filled primary bar' : ''}.`,
			tags: ['navbar', 'navigation', 'header', 'links'],
			args: [
				stringArg('brand', 'Acme', { label: 'Brand', maxLength: 24 }),
				stringArg('link1', 'Home', { label: 'Link 1', maxLength: 24 }),
				stringArg('link2', 'Projects', { label: 'Link 2', maxLength: 24 }),
				stringArg('link3', 'Pricing', { label: 'Link 3', maxLength: 24 }),
				toneArg()
			],
			render: el(
				'nav',
				{ style: barStyle(lib, filled) },
				brandGroup(lib, filled),
				row({ gap: '18px' }, navLink(lib, '{link1}', true), navLink(lib, '{link2}', false), navLink(lib, '{link3}', false)),
				mutedIcon(lib, icons.bell, filled)
			)
		});

		const search = define({
			slug: `${lib.id}-navbar-search`,
			name: 'Search Navbar',
			library: lib.id,
			category: CATEGORY,
			description: `Navigation bar with a centered search field in the ${lib.label} style — brand on the left, keyboard-shortcut hint in the input, utility icons on the right.`,
			tags: ['navbar', 'search', 'header', 'navigation'],
			args: [
				stringArg('brand', 'Acme', { label: 'Brand', maxLength: 24 }),
				stringArg('placeholder', 'Search anything…', { label: 'Placeholder', maxLength: 40 }),
				stringArg('shortcut', '⌘K', { label: 'Shortcut hint', maxLength: 8 }),
				toneArg()
			],
			render: el(
				'nav',
				{ style: barStyle(lib) },
				brandGroup(lib),
				el(
					'div',
					{ style: { flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 } },
					row(
						{
							gap: '8px',
							height: lib.id === 'daisyui' ? '40px' : '34px',
							padding: '0 10px',
							width: '100%',
							maxWidth: '300px',
							boxSizing: 'border-box',
							background: lib.surfaceAlt,
							border: `1px solid ${lib.borderSoft}`,
							borderRadius: lib.id === 'daisyui' ? lib.radius.pill : lib.radius.md
						},
						el('div', { style: { display: 'flex', color: lib.faint } }, icons.search(15, 'currentColor')),
						el('input', {
							type: 'text',
							placeholder: '{placeholder}',
							style: {
								flex: 1,
								minWidth: 0,
								border: 'none',
								outline: 'none',
								background: 'transparent',
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								color: lib.text,
								padding: 0
							}
						}),
						el(
							'span',
							{
								style: {
									fontFamily: lib.fontMono,
									fontSize: lib.fontSize.xs,
									color: lib.muted,
									background: lib.surface,
									border: `1px solid ${lib.border}`,
									borderRadius: lib.radius.xs,
									padding: '1px 5px',
									flexShrink: 0
								}
							},
							'{shortcut}'
						)
					)
				),
				row({ gap: '14px' }, mutedIcon(lib, icons.bell), mutedIcon(lib, icons.settings))
			)
		});

		const user = define({
			slug: `${lib.id}-navbar-user`,
			name: 'Account Navbar',
			library: lib.id,
			category: CATEGORY,
			description: `Account navigation bar in the ${lib.label} style — brand on the left and an avatar with name, role, and a disclosure chevron on the right.`,
			tags: ['navbar', 'account', 'avatar', 'header'],
			args: [
				stringArg('brand', 'Acme', { label: 'Brand', maxLength: 24 }),
				stringArg('name', 'Jamie Chen', { label: 'Name', maxLength: 30 }),
				stringArg('initials', 'JC', { label: 'Initials', maxLength: 3 }),
				stringArg('role', 'Product lead', { label: 'Role', maxLength: 30 }),
				toneArg()
			],
			render: el(
				'nav',
				{ style: barStyle(lib) },
				brandGroup(lib),
				row(
					{ gap: '10px' },
					avatarCircle(
						30,
						toneMap(lib, (palette) => palette.solid),
						toneMap(lib, (palette) => palette.onSolid),
						'{initials}',
						lib.fontSize.xs
					),
					stack(
						{ gap: '1px' },
						el('span', { style: { fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text } }, '{name}'),
						el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, '{role}')
					),
					mutedIcon(lib, icons.chevronDown)
				)
			)
		});

		const sideItem = (index, icon) =>
			row(
				{
					gap: '10px',
					height: '36px',
					padding: '0 10px',
					borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
					cursor: 'pointer',
					fontSize: lib.fontSize.sm,
					fontWeight: ifEq('active', String(index), 600, 500),
					background: ifEq('active', String(index), toneMap(lib, (palette) => palette.soft), 'transparent'),
					color: ifEq('active', String(index), toneMap(lib, (palette) => palette.onSoft), lib.muted)
				},
				el('div', { style: { display: 'flex' } }, icon(16, 'currentColor')),
				el('span', null, `{item${index}}`)
			);

		const divider = () => el('div', { style: { height: '1px', background: lib.borderSoft, margin: '4px 0 8px' } });

		const sidebar = define({
			slug: `${lib.id}-navbar-sidebar`,
			name: 'Sidebar Nav',
			library: lib.id,
			category: CATEGORY,
			description: `Vertical sidebar rail in the ${lib.label} style — brand header, icon-and-label rows with a tone-tinted active item, and a settings footer.`,
			tags: ['sidebar', 'navigation', 'rail', 'menu'],
			args: [
				stringArg('brand', 'Acme', { label: 'Brand', maxLength: 24 }),
				stringArg('item1', 'Home', { label: 'Item 1', maxLength: 24 }),
				stringArg('item2', 'Projects', { label: 'Item 2', maxLength: 24 }),
				stringArg('item3', 'Messages', { label: 'Item 3', maxLength: 24 }),
				enumArg('active', ['1', '2', '3'], '1', { label: 'Active item' }),
				toneArg()
			],
			render: stack(
				{
					width: '220px',
					padding: '12px',
					gap: '2px',
					boxSizing: 'border-box',
					fontFamily: lib.font,
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.lg,
					boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
				},
				row({ gap: '9px', padding: '2px 6px 10px' }, brandMark(lib), el('span', { style: { fontWeight: lib.headingWeight, fontSize: lib.fontSize.lg, color: lib.text } }, '{brand}')),
				divider(),
				sideItem(1, icons.home),
				sideItem(2, icons.folder),
				sideItem(3, icons.mail),
				el('div', { style: { height: '1px', background: lib.borderSoft, margin: '8px 0 4px' } }),
				row(
					{ gap: '10px', height: '36px', padding: '0 10px', color: lib.muted, fontSize: lib.fontSize.sm, fontWeight: 500, cursor: 'pointer' },
					el('div', { style: { display: 'flex' } }, icons.settings(16, 'currentColor')),
					el('span', null, 'Settings')
				)
			)
		});

		const bottomTab = (index, icon) =>
			stack(
				{
					alignItems: 'center',
					gap: '3px',
					flex: 1,
					padding: '0 0 8px',
					cursor: 'pointer',
					fontFamily: lib.font,
					fontSize: lib.fontSize.xs,
					fontWeight: 500,
					color: ifEq('active', String(index), toneMap(lib, (palette) => palette.solid), lib.faint)
				},
				el('div', {
					style: {
						width: '20px',
						height: '3px',
						borderRadius: lib.radius.pill,
						marginBottom: '4px',
						background: ifEq(
							'active',
							String(index),
							lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid),
							'transparent'
						)
					}
				}),
				icon(20, 'currentColor'),
				el('span', null, `{tab${index}}`)
			);

		const bottomTabs = define({
			slug: `${lib.id}-navbar-bottom-tabs`,
			name: 'Bottom Tab Bar',
			library: lib.id,
			category: CATEGORY,
			description: `Mobile bottom tab bar in the ${lib.label} style — four icon tabs with labels, the active tab tinted with the tone color under a small indicator bar.`,
			tags: ['tabbar', 'mobile', 'navigation', 'bottom'],
			args: [
				stringArg('tab1', 'Home', { label: 'Tab 1', maxLength: 14 }),
				stringArg('tab2', 'Search', { label: 'Tab 2', maxLength: 14 }),
				stringArg('tab3', 'Alerts', { label: 'Tab 3', maxLength: 14 }),
				stringArg('tab4', 'Profile', { label: 'Tab 4', maxLength: 14 }),
				enumArg('active', ['1', '2', '3', '4'], '1', { label: 'Active tab' }),
				toneArg()
			],
			render: el(
				'nav',
				{
					style: {
						display: 'flex',
						alignItems: 'stretch',
						width: '100%',
						maxWidth: '420px',
						background: lib.surface,
						borderTop: `1px solid ${lib.border}`,
						fontFamily: lib.font
					}
				},
				bottomTab(1, icons.home),
				bottomTab(2, icons.search),
				bottomTab(3, icons.bell),
				bottomTab(4, icons.user)
			)
		});

		return [top, search, user, sidebar, bottomTabs];
	}
};
