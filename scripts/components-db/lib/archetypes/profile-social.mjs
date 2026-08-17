// Profile & social identity archetype — five identity surfaces: profile
// header, compact user card, follower list row, achievement tile, and a
// profile stats band. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-profile-social-<variant>`.

import {
	avatarCircle,
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	ifEq,
	iff,
	map,
	merge,
	numberArg,
	row,
	stack,
	stringArg,
	text,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

const btnBase = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	borderRadius: lib.radius.sm,
	fontFamily: lib.font,
	fontSize: lib.fontSize.sm,
	fontWeight: lib.buttonWeight,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

const cardBase = (lib) => ({
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	fontFamily: lib.font,
	boxShadow: lib.shadow.sm
});

// Cover-band personality: thingtime wears the house rainbow, reactflow its
// dotted node-canvas, everyone else a flat tone-soft wash.
const coverStyle = (lib) =>
	lib.id === 'thingtime'
		? { background: lib.rainbow }
		: lib.id === 'reactflow'
			? {
					backgroundColor: lib.surfaceAlt,
					backgroundImage: `radial-gradient(${lib.dot} 1px, transparent 1px)`,
					backgroundSize: '12px 12px'
				}
			: { background: toneMap(lib, (palette) => palette.soft) };

const coverBlurb = (lib) =>
	lib.id === 'thingtime' ? 'rainbow cover band' : lib.id === 'reactflow' ? 'dotted-canvas cover band' : 'flat tone-soft cover band';

// Follow chips keep pill corners except on React Flow's crisp chrome.
const chipRadius = (lib) => (lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);

export const archetype = {
	id: 'profile-social',
	category: 'social',
	variants: ['header', 'user-card', 'follower-row', 'achievement', 'stats'],
	build(lib) {
		const header = define({
			slug: `${lib.id}-profile-social-header`,
			name: 'Profile Header',
			library: lib.id,
			category: 'social',
			description: `Profile header in the ${lib.label} style — ${coverBlurb(lib)}, overlapping initials avatar, name, handle and bio, with follow and message actions.`,
			tags: ['profile', 'header', 'avatar', 'identity', 'social'],
			args: [
				stringArg('initials', 'JR', { label: 'Initials', maxLength: 3 }),
				stringArg('name', 'Jordan Reyes', { label: 'Name', maxLength: 40 }),
				stringArg('handle', 'jordanmakes', { label: 'Handle', maxLength: 24 }),
				textArg('bio', 'Designing calm tools for busy teams. Coffee first.', { label: 'Bio', maxLength: 140 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: { ...cardBase(lib), width: '320px', overflow: 'hidden' } },
				el('div', { style: { height: '64px', ...coverStyle(lib) } }),
				stack(
					{ padding: '0 16px 16px' },
					avatarCircle(
						56,
						toneMap(lib, (palette) => palette.solid),
						toneMap(lib, (palette) => palette.onSolid),
						'{initials}',
						lib.fontSize.lg,
						{ marginTop: '-28px', borderWidth: '3px', borderStyle: 'solid', borderColor: lib.surface }
					),
					text({ marginTop: '10px', fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: lib.text }, '{name}'),
					text({ marginTop: '2px', fontSize: lib.fontSize.sm, color: lib.muted }, '@{handle}'),
					text({ marginTop: '8px', fontSize: lib.fontSize.sm, color: lib.text, lineHeight: 1.5 }, '{bio}'),
					row(
						{ marginTop: '14px', gap: '8px' },
						el(
							'button',
							{
								type: 'button',
								style: {
									...btnBase(lib),
									height: lib.control.sm,
									padding: '0 14px',
									border: 'none',
									background: toneMap(lib, (palette) => palette.solid),
									color: toneMap(lib, (palette) => palette.onSolid)
								}
							},
							'Follow'
						),
						el(
							'button',
							{
								type: 'button',
								style: {
									...btnBase(lib),
									height: lib.control.sm,
									padding: '0 14px',
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: lib.border,
									background: lib.surface,
									color: lib.text
								}
							},
							'Message'
						)
					)
				)
			)
		});

		const userCard = define({
			slug: `${lib.id}-profile-social-user-card`,
			name: 'User Card',
			library: lib.id,
			category: 'social',
			description: `Compact vertical user card in the ${lib.label} style — initials avatar, name and role caption over follower mini-stats, with a tone follow button that flips to a 'Following' outline.`,
			tags: ['profile', 'card', 'avatar', 'follow', 'social'],
			args: [
				stringArg('initials', 'AK', { label: 'Initials', maxLength: 3 }),
				stringArg('name', 'Avery Kim', { label: 'Name', maxLength: 40 }),
				stringArg('role', 'Product Designer', { label: 'Role', maxLength: 32 }),
				stringArg('followers', '1,024', { label: 'Followers', maxLength: 10 }),
				toneArg(),
				booleanArg('isFollowing', false, { label: 'Following' })
			],
			render: el(
				'div',
				{
					style: {
						...cardBase(lib),
						width: '220px',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						textAlign: 'center',
						padding: '20px 16px',
						boxSizing: 'border-box'
					}
				},
				avatarCircle(56, toneMap(lib, (palette) => palette.solid), toneMap(lib, (palette) => palette.onSolid), '{initials}', lib.fontSize.lg),
				text({ marginTop: '10px', fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{name}'),
				text({ marginTop: '2px', fontSize: lib.fontSize.xs, color: lib.muted }, '{role}'),
				row(
					{ marginTop: '12px', gap: '18px', justifyContent: 'center' },
					stack(
						{ alignItems: 'center' },
						text({ fontSize: lib.fontSize.sm, fontWeight: 700, color: lib.text }, '{followers}'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Followers')
					),
					stack(
						{ alignItems: 'center' },
						text({ fontSize: lib.fontSize.sm, fontWeight: 700, color: lib.text }, '412'),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Following')
					)
				),
				el(
					'button',
					{
						type: 'button',
						style: merge(
							btnBase(lib),
							{
								marginTop: '14px',
								width: '100%',
								height: lib.control.sm,
								padding: '0 12px',
								borderWidth: '1px',
								borderStyle: 'solid',
								boxSizing: 'border-box'
							},
							iff(
								'isFollowing',
								{
									background: 'transparent',
									color: toneMap(lib, (palette) => palette.solid),
									borderColor: toneMap(lib, (palette) => palette.solid)
								},
								{
									background: toneMap(lib, (palette) => palette.solid),
									color: toneMap(lib, (palette) => palette.onSolid),
									borderColor: 'transparent'
								}
							)
						)
					},
					iff('isFollowing', 'Following', 'Follow')
				)
			)
		});

		const followerRow = define({
			slug: `${lib.id}-profile-social-follower-row`,
			name: 'Follower Row',
			library: lib.id,
			category: 'social',
			description: `Follower list row in the ${lib.label} style — initials avatar wearing a presence dot, name with a mutuals caption, and a small tone-tinted follow chip on the right.`,
			tags: ['profile', 'list', 'follower', 'presence', 'social'],
			args: [
				stringArg('initials', 'SM', { label: 'Initials', maxLength: 3 }),
				stringArg('name', 'Sam Mercer', { label: 'Name', maxLength: 40 }),
				stringArg('mutuals', '12 mutual friends', { label: 'Mutuals', maxLength: 40 }),
				enumArg('presence', ['online', 'away', 'offline'], 'online', { label: 'Presence' }),
				toneArg()
			],
			render: el(
				'div',
				{
					style: {
						...cardBase(lib),
						borderRadius: lib.radius.md,
						width: '300px',
						display: 'flex',
						alignItems: 'center',
						gap: '12px',
						padding: '10px 12px',
						boxSizing: 'border-box'
					}
				},
				el(
					'div',
					{ style: { position: 'relative', flexShrink: 0 } },
					avatarCircle(40, lib.palette.neutral.soft, lib.palette.neutral.onSoft, '{initials}', lib.fontSize.sm),
					el('span', {
						style: {
							position: 'absolute',
							right: '-1px',
							bottom: '-1px',
							width: '10px',
							height: '10px',
							borderRadius: '999px',
							borderWidth: '2px',
							borderStyle: 'solid',
							borderColor: lib.surface,
							background: map(
								'presence',
								{
									online: lib.palette.success.solid,
									away: lib.palette.warning.solid,
									offline: lib.faint
								},
								lib.palette.success.solid
							)
						}
					})
				),
				stack(
					{ flex: 1, minWidth: 0 },
					text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text }, '{name}'),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{mutuals}')
				),
				el(
					'span',
					{
						style: {
							padding: '4px 12px',
							borderRadius: chipRadius(lib),
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft),
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							flexShrink: 0,
							...(lib.id === 'antd'
								? { borderWidth: '1px', borderStyle: 'solid', borderColor: toneMap(lib, (palette) => palette.border) }
								: {})
						}
					},
					'Follow'
				)
			)
		});

		const achievement = define({
			slug: `${lib.id}-profile-social-achievement`,
			name: 'Achievement Tile',
			library: lib.id,
			category: 'social',
			description: `Achievement badge tile in the ${lib.label} style — a star or zap emblem in a tone-soft circle with a tone border, title, and a progress bar with percent and 'x of y' captions.`,
			tags: ['profile', 'achievement', 'progress', 'gamification', 'social'],
			args: [
				stringArg('title', 'Streak Master', { label: 'Title', maxLength: 32 }),
				enumArg('icon', ['star', 'zap'], 'star', { label: 'Icon' }),
				toneArg(),
				numberArg('percent', 60, { label: 'Progress %', min: 0, max: 100 }),
				numberArg('done', 3, { label: 'Done', min: 0 }),
				numberArg('total', 5, { label: 'Total', min: 1 })
			],
			render: el(
				'div',
				{
					style: {
						...cardBase(lib),
						width: '216px',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						textAlign: 'center',
						padding: '18px 16px',
						boxSizing: 'border-box'
					}
				},
				el(
					'div',
					{
						style: {
							width: '48px',
							height: '48px',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							borderRadius: '999px',
							background: toneMap(lib, (palette) => palette.soft),
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: toneMap(lib, (palette) => palette.border),
							color: toneMap(lib, (palette) => palette.onSoft)
						}
					},
					ifEq('icon', 'zap', icons.zap(22, 'currentColor'), icons.star(22, 'currentColor'))
				),
				text({ marginTop: '10px', fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
				el(
					'div',
					{
						style: {
							marginTop: '12px',
							width: '100%',
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
							background: toneMap(lib, (palette) => palette.solid)
						}
					})
				),
				row(
					{ marginTop: '8px', width: '100%', justifyContent: 'space-between' },
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{done} of {total}'),
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: toneMap(lib, (palette) => palette.onSoft) }, '{percent}%')
				)
			)
		});

		// Stats accent personality: reactflow flashes its node-editor pink,
		// thingtime winks with the house magenta, everyone else stays primary.
		const accent = lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.primary.solid;

		const statBlock = (key, label) =>
			el(
				'div',
				{
					style: merge(
						{
							flex: 1,
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: '2px',
							padding: '14px 10px',
							borderTopWidth: '2px',
							borderTopStyle: 'solid'
						},
						ifEq('highlight', key, { borderTopColor: accent }, { borderTopColor: 'transparent' })
					)
				},
				text({ fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight, color: lib.text }, `{${key}}`),
				text({ fontSize: lib.fontSize.xs, color: lib.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }, label)
			);

		const statDivider = () => el('div', { style: { width: '1px', background: lib.borderSoft, flexShrink: 0 } });

		const stats = define({
			slug: `${lib.id}-profile-social-stats`,
			name: 'Profile Stats Band',
			library: lib.id,
			category: 'social',
			description: `Profile stats band in the ${lib.label} style — posts, followers and following counts as big numbers over quiet captions, divider-separated, with one block highlighted by an accent top border.`,
			tags: ['profile', 'stats', 'metrics', 'counters', 'social'],
			args: [
				stringArg('posts', '128', { label: 'Posts', maxLength: 10 }),
				stringArg('followers', '2,304', { label: 'Followers', maxLength: 10 }),
				stringArg('following', '180', { label: 'Following', maxLength: 10 }),
				enumArg('highlight', ['posts', 'followers', 'following', 'none'], 'followers', { label: 'Highlight' })
			],
			render: el(
				'div',
				{
					style: {
						...cardBase(lib),
						width: '320px',
						display: 'flex',
						alignItems: 'stretch',
						overflow: 'hidden'
					}
				},
				statBlock('posts', 'Posts'),
				statDivider(),
				statBlock('followers', 'Followers'),
				statDivider(),
				statBlock('following', 'Following')
			)
		});

		return [header, userCard, followerRow, achievement, stats];
	}
};
