// Gamification archetype — engagement surfaces in five renditions: a daily
// streak card, a four-row leaderboard, an XP progress card, a quest card, and
// a level emblem. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-gamification-<variant>`.
//
// Sanctioned literals: the medal metals #d4af37 / #c0c0c0 / #cd7f32 (named by
// the brief). The streak day-dots use the rating-stars layering idea with a
// repeat twist: a fixed 7-dot faint underlay sits under an absolutely
// positioned overlay whose filled dots are ttRepeat-driven by the `done` arg
// (identical dot geometry, so done dots land exactly on top of faint ones).

import {
	avatarCircle,
	booleanArg,
	define,
	el,
	icons,
	ifEq,
	iff,
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

// Fixed-count repeat — one node in the raw template serves a whole row.
const times = (count, node) => ({ ttRepeat: { count, max: count, node } });

const upper = (lib) =>
	lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {};

// untitled floats on feather shadows, mui on real elevation.
const cardShadow = (lib) => (lib.id === 'untitled' ? lib.shadow.lg : lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm);

const card = (lib, width) => ({
	display: 'flex',
	flexDirection: 'column',
	width,
	padding: '16px',
	boxSizing: 'border-box',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: cardShadow(lib),
	fontFamily: lib.font
});

const dayDot = (background) =>
	el('div', { style: { width: '10px', height: '10px', borderRadius: '999px', background, flexShrink: 0 } });

const MEDALS = { 1: '#d4af37', 2: '#c0c0c0', 3: '#cd7f32' };

const BOARD_ROWS = [
	{ rank: 1, initials: 'MK', name: 'Mila Kang', points: '12,480' },
	{ rank: 2, initials: 'AV', name: 'Ari Voss', points: '11,930' },
	{ rank: 3, initials: 'SI', name: 'Sam Ito', points: '10,215' },
	{ rank: 4, initials: 'NR', name: 'Noa Reyes', points: '9,864' }
];

export const archetype = {
	id: 'gamification',
	category: 'engagement',
	variants: ['streak', 'leaderboard', 'xp', 'quest', 'level'],
	build(lib) {
		// reactflow paints pending days in its canvas-dot grey; thingtime fills
		// done days with the house rainbow.
		const pendingDot = lib.id === 'reactflow' ? lib.dot : lib.borderSoft;
		const doneDot = lib.id === 'thingtime' ? lib.rainbow : lib.palette.warning.solid;

		const streak = define({
			slug: `${lib.id}-gamification-streak`,
			name: 'Streak Card',
			library: lib.id,
			category: 'engagement',
			description: `Daily streak card in the ${lib.label} style — a zap glyph in a warning-tone circle beside the big day count, seven day-dots filled by a repeat-driven overlay${lib.id === 'thingtime' ? ' washed in the house rainbow' : ''}, and a mono personal-best caption.`,
			tags: ['gamification', 'streak', 'engagement', 'card'],
			args: [
				numberArg('days', 12, { label: 'Streak days', min: 0 }),
				numberArg('done', 5, { label: 'Days done this week (0–7)', min: 0, max: 7 }),
				numberArg('best', 21, { label: 'Personal best', min: 0 })
			],
			render: el(
				'div',
				{ style: { ...card(lib, '240px'), gap: '14px' } },
				row(
					{ gap: '12px' },
					el(
						'div',
						{
							style: {
								width: '44px',
								height: '44px',
								borderRadius: lib.radius.pill,
								background: lib.palette.warning.soft,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0
							}
						},
						icons.zap(22, lib.palette.warning.solid)
					),
					stack(
						{ gap: '2px' },
						text({ fontSize: '30px', fontWeight: lib.headingWeight, color: lib.text, lineHeight: 1 }, '{days}'),
						text({ fontSize: lib.fontSize.sm, color: lib.muted, ...upper(lib) }, 'day streak')
					)
				),
				el(
					'div',
					{ style: { position: 'relative', display: 'inline-flex' } },
					row({ gap: '6px' }, times(7, dayDot(pendingDot))),
					el(
						'div',
						{ style: { position: 'absolute', top: '0px', left: '0px' } },
						row({ gap: '6px' }, repeat('done', 7, dayDot(doneDot)))
					)
				),
				text({ fontSize: lib.fontSize.xs, color: lib.muted, fontFamily: lib.fontMono }, 'best: {best} days')
			)
		});

		// thingtime's wink: the viewer row tints pink instead of primary grey.
		const highlightBg = lib.id === 'thingtime' ? lib.palette.info.soft : lib.palette.primary.soft;

		const boardRow = (entry) =>
			el(
				'div',
				{
					style: merge(
						{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px', borderRadius: lib.radius.sm },
						ifEq('you', entry.rank, { background: highlightBg })
					)
				},
				entry.rank <= 3
					? el(
							'div',
							{
								style: {
									width: '22px',
									height: '22px',
									borderRadius: '999px',
									background: MEDALS[entry.rank],
									color: lib.surface,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									fontSize: lib.fontSize.xs,
									fontWeight: 700,
									flexShrink: 0
								}
							},
							String(entry.rank)
						)
					: text(
							{
								width: '22px',
								textAlign: 'center',
								fontSize: lib.fontSize.xs,
								color: lib.muted,
								fontFamily: lib.fontMono,
								flexShrink: 0
							},
							String(entry.rank)
						),
				avatarCircle('26px', lib.surfaceAlt, lib.muted, entry.initials, lib.fontSize.xs),
				el(
					'span',
					{
						style: {
							flex: 1,
							fontSize: lib.fontSize.sm,
							fontWeight: 500,
							color: lib.text,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis'
						}
					},
					ifEq('you', entry.rank, '{name}', entry.name)
				),
				text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.text, fontFamily: lib.fontMono }, entry.points)
			);

		const leaderboard = define({
			slug: `${lib.id}-gamification-leaderboard`,
			name: 'Leaderboard',
			library: lib.id,
			category: 'engagement',
			description: `Four-row leaderboard in the ${lib.label} style — gold, silver, and bronze medal circles for the podium with a plain fourth rank, initials avatars, mono right-aligned points, and the viewer's row tinted and renamed via the you arg.`,
			tags: ['gamification', 'leaderboard', 'ranking', 'engagement'],
			args: [
				stringArg('title', 'Weekly leaders', { label: 'Title', maxLength: 32 }),
				numberArg('you', 2, { label: 'Your rank (1–4)', min: 1, max: 4 }),
				stringArg('name', 'You', { label: 'Your display name', maxLength: 24 })
			],
			render: el(
				'div',
				{ style: { ...card(lib, '280px'), gap: '8px' } },
				text(
					{ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text, ...upper(lib) },
					'{title}'
				),
				stack({ gap: '2px' }, ...BOARD_ROWS.map(boardRow))
			)
		});

		const barFill = lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid);
		// reactflow's marker squares off like a node handle; everyone else rides a dot.
		const markerRadius = lib.id === 'reactflow' ? lib.radius.xs : lib.radius.pill;

		const xp = define({
			slug: `${lib.id}-gamification-xp`,
			name: 'XP Progress',
			library: lib.id,
			category: 'engagement',
			description: `XP progress card in the ${lib.label} style — a Level chip, a tone-colored bar${lib.id === 'thingtime' ? ' washed in the house rainbow' : ''} with a marker ${lib.id === 'reactflow' ? 'handle' : 'dot'} riding the fill edge, and an XP-to-next-level caption.`,
			tags: ['gamification', 'xp', 'progress', 'level'],
			args: [
				numberArg('level', 7, { label: 'Level', min: 1 }),
				numberArg('percent', 68, { label: 'Progress (0–100)', min: 0, max: 100 }),
				stringArg('xp', '1,250', { label: 'XP remaining', maxLength: 10 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: { ...card(lib, '260px'), gap: '12px' } },
				row(
					{ justifyContent: 'space-between', gap: '12px' },
					el(
						'span',
						{
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								padding: '2px 10px',
								borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
								background: toneMap(lib, (palette) => palette.soft),
								color: toneMap(lib, (palette) => palette.onSoft),
								fontSize: lib.fontSize.xs,
								fontWeight: 700,
								...upper(lib)
							}
						},
						'Level {level}'
					),
					text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.muted, fontFamily: lib.fontMono }, '{percent}%')
				),
				el(
					'div',
					{ style: { position: 'relative', height: '10px', borderRadius: lib.radius.pill, background: lib.borderSoft } },
					el('div', {
						style: {
							width: '{percent}%',
							maxWidth: '100%',
							height: '100%',
							borderRadius: lib.radius.pill,
							background: barFill
						}
					}),
					el('div', {
						style: {
							position: 'absolute',
							top: '-3px',
							left: 'calc({percent}% - 8px)',
							width: '16px',
							height: '16px',
							boxSizing: 'border-box',
							borderRadius: markerRadius,
							background: lib.surface,
							borderWidth: '2px',
							borderStyle: 'solid',
							borderColor: toneMap(lib, (palette) => palette.solid),
							boxShadow: lib.shadow.sm
						}
					})
				),
				text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{xp} XP to next level')
			)
		});

		// Quest has no tone arg — its bar keeps a fixed primary fill (rainbow at home).
		const questFill = lib.id === 'thingtime' ? lib.rainbow : lib.palette.primary.solid;

		const quest = define({
			slug: `${lib.id}-gamification-quest`,
			name: 'Quest Card',
			library: lib.id,
			category: 'engagement',
			description: `Quest card in the ${lib.label} style — a star icon tile beside the quest title, a soft success reward chip, a percent-driven progress bar with a mono done/total readout, and a claim button that appears once the quest completes.`,
			tags: ['gamification', 'quest', 'reward', 'progress'],
			args: [
				stringArg('title', 'Post 3 times this week', { label: 'Quest title', maxLength: 40 }),
				numberArg('xp', 50, { label: 'Reward XP', min: 0 }),
				numberArg('done', 2, { label: 'Steps done', min: 0 }),
				numberArg('total', 3, { label: 'Steps total', min: 1 }),
				numberArg('percent', 66, { label: 'Progress (0–100)', min: 0, max: 100 }),
				booleanArg('complete', false, { label: 'Complete' })
			],
			render: el(
				'div',
				{ style: { ...card(lib, '300px'), flexDirection: 'row', gap: '12px', alignItems: 'flex-start' } },
				el(
					'div',
					{
						style: {
							width: '40px',
							height: '40px',
							borderRadius: lib.radius.md,
							background: lib.palette.primary.soft,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							flexShrink: 0
						}
					},
					icons.star(20, lib.palette.primary.onSoft, false)
				),
				stack(
					{ flex: 1, gap: '8px' },
					row(
						{ justifyContent: 'space-between', gap: '8px' },
						text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{title}'),
						el(
							'span',
							{
								style: {
									display: 'inline-flex',
									alignItems: 'center',
									padding: '2px 8px',
									borderRadius: lib.radius.pill,
									background: lib.palette.success.soft,
									color: lib.palette.success.onSoft,
									fontSize: lib.fontSize.xs,
									fontWeight: 700,
									whiteSpace: 'nowrap',
									flexShrink: 0
								}
							},
							'+{xp} XP'
						)
					),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Keep the momentum going to bank the reward.'),
					row(
						{ gap: '8px' },
						el(
							'div',
							{
								style: {
									flex: 1,
									height: '8px',
									borderRadius: lib.radius.pill,
									background: lib.borderSoft,
									overflow: 'hidden'
								}
							},
							el('div', {
								style: {
									width: '{percent}%',
									maxWidth: '100%',
									height: '100%',
									borderRadius: lib.radius.pill,
									background: questFill
								}
							})
						),
						text({ fontSize: lib.fontSize.xs, color: lib.muted, fontFamily: lib.fontMono }, '{done}/{total}')
					),
					iff(
						'complete',
						el(
							'button',
							{
								type: 'button',
								style: {
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									alignSelf: 'flex-start',
									height: lib.control.sm,
									padding: '0 14px',
									border: 'none',
									borderRadius: lib.radius.sm,
									background: lib.palette.success.solid,
									color: lib.palette.success.onSolid,
									fontFamily: lib.font,
									fontWeight: lib.buttonWeight,
									fontSize: lib.fontSize.xs,
									cursor: 'pointer',
									...upper(lib)
								}
							},
							'Claim reward'
						)
					)
				)
			)
		});

		const level = define({
			slug: `${lib.id}-gamification-level`,
			name: 'Level Emblem',
			library: lib.id,
			category: 'engagement',
			description: `Level emblem in the ${lib.label} style — a hexagonal badge filled with the tone color${lib.id === 'reactflow' ? ', edged with the flow accent,' : ''} and the level number overlaid, above a title caption and a next-level XP hint${lib.id === 'thingtime' ? ', underscored by the house rainbow' : ''}.`,
			tags: ['gamification', 'level', 'badge', 'emblem'],
			args: [
				numberArg('level', 12, { label: 'Level', min: 1 }),
				stringArg('title', 'Gold Tier', { label: 'Title', maxLength: 24 }),
				stringArg('next', '2,500', { label: 'Next-level XP', maxLength: 10 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: { display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '8px', fontFamily: lib.font } },
				el(
					'div',
					{ style: { position: 'relative', width: '64px', height: '72px' } },
					el(
						'svg',
						{
							width: 64,
							height: 72,
							viewBox: '0 0 64 72',
							fill: toneMap(lib, (palette) => palette.solid),
							xmlns: 'http://www.w3.org/2000/svg',
							...(lib.id === 'reactflow' ? { stroke: lib.accent, strokeWidth: 2 } : {})
						},
						el('polygon', { points: '32 2 60 19 60 53 32 70 4 53 4 19' })
					),
					el(
						'span',
						{
							style: {
								position: 'absolute',
								top: '0px',
								left: '0px',
								width: '100%',
								height: '100%',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								color: toneMap(lib, (palette) => palette.onSolid),
								fontSize: '22px',
								fontWeight: lib.headingWeight
							}
						},
						'{level}'
					)
				),
				lib.id === 'thingtime' &&
					el('div', { style: { width: '40px', height: '3px', borderRadius: '999px', background: lib.rainbow } }),
				text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text, ...upper(lib) }, '{title}'),
				text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Next level at {next} XP')
			)
		});

		return [streak, leaderboard, xp, quest, level];
	}
};
