// Sports-scores archetype — sports surfaces in five renditions: live
// scoreboard, upcoming fixture card, league standings table, player stat
// card, and a tournament bracket. Follows the button.mjs exemplar: exactly
// 5 variants, `build(lib)` returns exactly 5 definitions (one per variant,
// same order), slugs `${lib.id}-sports-scores-<variant>`.

import {
	define,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	map,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Library accent: reactflow's pink handle color, thingtime's rainbow-wink
// pink, everyone else their primary solid.
const accent = (lib) => lib.accent || (lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.primary.solid);

// antd tags sit on tight corners, reactflow chrome stays crisp, the rest pill.
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);

const card = (lib, extra = {}) => ({
	display: 'flex',
	flexDirection: 'column',
	boxSizing: 'border-box',
	fontFamily: lib.font,
	color: lib.text,
	background: lib.surface,
	borderWidth: lib.id === 'daisyui' ? '2px' : '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	...extra
});

const monoCaption = (lib) => ({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: lib.muted });

const roundCaption = (lib) => ({
	fontSize: lib.fontSize.xs,
	fontWeight: 600,
	color: lib.muted,
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: '0.06em' } : {})
});

const chip = (lib, palette) => ({
	display: 'inline-flex',
	alignItems: 'center',
	padding: '2px 8px',
	borderRadius: chipRadius(lib),
	background: palette.soft,
	color: palette.onSoft,
	fontSize: lib.fontSize.xs,
	fontWeight: 600,
	...(lib.id === 'antd' ? { borderWidth: '1px', borderStyle: 'solid', borderColor: palette.border } : {}),
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: '0.04em' } : {})
});

const ellipsis = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// --- scoreboard pieces -------------------------------------------------------

const initialsTile = (lib, letter) =>
	el(
		'div',
		{
			style: {
				width: '26px',
				height: '26px',
				borderRadius: lib.radius.sm,
				background: lib.surfaceAlt,
				color: lib.muted,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				fontSize: lib.fontSize.xs,
				fontWeight: 700,
				flexShrink: 0
			}
		},
		letter
	);

const scoreTeamRow = (lib, letter, nameToken, scoreToken, side) =>
	row(
		{ gap: '10px' },
		initialsTile(lib, letter),
		text({ flex: 1, fontSize: lib.fontSize.md, fontWeight: 600, ...ellipsis }, nameToken),
		ifEq(
			'possession',
			side,
			el('span', { style: { width: '8px', height: '8px', borderRadius: '999px', background: accent(lib), flexShrink: 0 } })
		),
		text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xl, fontWeight: 700, color: lib.id === 'thingtime' ? lib.ink : lib.text }, scoreToken)
	);

// --- fixture pieces ----------------------------------------------------------

const oddChip = (lib, label, value) =>
	stack(
		{ flex: 1, alignItems: 'center', gap: '2px', padding: '6px 0', background: lib.surfaceAlt, borderRadius: lib.radius.sm },
		text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.faint }, label),
		text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.sm, fontWeight: 700, color: lib.text }, value)
	);

// --- standings pieces --------------------------------------------------------

// Cells carry ONLY their width + overrides: fontSize/color/textAlign are
// inherited from the row (standInherit), which keeps the 30-cell table inside
// the server's raw-JSON render node cap.
const standCell = (lib, extra, value) => el('span', { style: { width: '18px', ...extra } }, value);

const standInherit = (lib) => ({ fontSize: lib.fontSize.xs, color: lib.muted, textAlign: 'center' });

const formDot = (lib, win) =>
	el('span', {
		style: { width: '6px', height: '6px', borderRadius: '999px', background: win ? lib.palette.success.solid : lib.palette.danger.solid }
	});

const formDots = (lib, pattern) => iff('formDots', row({ gap: '3px', marginLeft: '8px', flexShrink: 0 }, pattern.map((win) => formDot(lib, win))));

const standRow = (lib, { pos, name, form, played, won, drawn, lost, pts, tint, strong }) =>
	row(
		{
			gap: '4px',
			padding: lib.id === 'daisyui' ? '7px 8px' : '5px 8px',
			borderRadius: lib.radius.sm,
			...standInherit(lib),
			...(tint ? { background: tint.soft } : {})
		},
		standCell(lib, { width: '24px', textAlign: 'left', fontWeight: 700, color: tint ? tint.onSoft : lib.faint }, pos),
		row(
			{ flex: 1, minWidth: 0 },
			text({ fontSize: lib.fontSize.sm, fontWeight: strong ? 700 : 500, color: lib.text, ...ellipsis }, name),
			formDots(lib, form)
		),
		standCell(lib, {}, played),
		standCell(lib, {}, won),
		standCell(lib, {}, drawn),
		standCell(lib, {}, lost),
		standCell(lib, { width: '28px', textAlign: 'right', fontWeight: 700, fontSize: lib.fontSize.sm, color: lib.id === 'thingtime' ? lib.ink : lib.text }, pts)
	);

// --- player pieces -----------------------------------------------------------

const statTile = (lib, label, value) =>
	stack(
		{ flex: 1, alignItems: 'center', gap: '4px', padding: '10px 0', background: lib.surfaceAlt, borderRadius: lib.radius.md },
		text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.muted, ...(lib.uppercaseButtons ? { textTransform: 'uppercase' } : {}) }, label),
		text({ fontSize: lib.fontSize.lg, fontWeight: 700, color: lib.id === 'thingtime' ? lib.ink : lib.text }, value)
	);

// Rating ring: stepped strokeDasharray (circumference of r=16 ≈ 101) keyed on
// the rating enum — no token arithmetic, per the arc rules.
const ratingRing = (lib) =>
	el(
		'div',
		{ style: { position: 'relative', width: '40px', height: '40px' } },
		el(
			'svg',
			{ width: 40, height: 40, viewBox: '0 0 40 40', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
			el('circle', { cx: 20, cy: 20, r: 16, stroke: lib.borderSoft, strokeWidth: 4, fill: 'none' }),
			el('circle', {
				cx: 20,
				cy: 20,
				r: 16,
				stroke: accent(lib),
				strokeWidth: 4,
				fill: 'none',
				strokeLinecap: 'round',
				style: {
					strokeDasharray: map('rating', { 6: '60 101', 7: '70 101', 8: '80 101', 9: '90 101', 10: '101 101' }, '80 101'),
					transform: 'rotate(-90deg)',
					transformOrigin: '50% 50%'
				}
			})
		),
		el(
			'span',
			{
				style: {
					position: 'absolute',
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontSize: lib.fontSize.sm,
					fontWeight: 700
				}
			},
			'{rating}'
		)
	);

// --- bracket pieces ----------------------------------------------------------

const railColor = (lib) => (lib.id === 'reactflow' ? lib.edge : lib.border);

const bracketChip = (lib, name, score, winner) =>
	row(
		{
			justifyContent: 'space-between',
			gap: '10px',
			width: '104px',
			boxSizing: 'border-box',
			padding: '4px 8px',
			borderRadius: lib.radius.sm,
			fontSize: lib.fontSize.xs,
			...(winner
				? { background: toneMap(lib, (palette) => palette.soft), color: toneMap(lib, (palette) => palette.onSoft), fontWeight: 700 }
				: { background: lib.surfaceAlt, color: lib.muted, fontWeight: 500 })
		},
		el('span', { style: ellipsis }, name),
		el('span', { style: { fontFamily: lib.fontMono, flexShrink: 0 } }, score)
	);

const bracketPair = (lib, top, bottom) =>
	row(
		{ alignItems: 'stretch' },
		stack({ gap: '4px', justifyContent: 'center' }, top, bottom),
		el('div', {
			style: {
				width: '10px',
				marginTop: '12px',
				marginBottom: '12px',
				borderTop: `2px solid ${railColor(lib)}`,
				borderRight: `2px solid ${railColor(lib)}`,
				borderBottom: `2px solid ${railColor(lib)}`,
				borderTopRightRadius: '4px',
				borderBottomRightRadius: '4px'
			}
		})
	);

export const archetype = {
	id: 'sports-scores',
	category: 'sports',
	variants: ['scoreboard', 'fixture', 'standings', 'player', 'bracket'],
	build(lib) {
		const scoreboard = define({
			slug: `${lib.id}-sports-scores-scoreboard`,
			name: 'Live Scoreboard',
			library: lib.id,
			category: 'sports',
			description: `Live match scoreboard in the ${lib.label} style — home/away rows with initials tiles and big mono scores, a LIVE chip with period clock, possession dot, and a thin momentum bar${lib.id === 'thingtime' ? ' in the house rainbow' : ''}.`,
			tags: ['sports', 'scoreboard', 'live', 'match'],
			args: [
				stringArg('home', 'Falcons', { label: 'Home team', maxLength: 20 }),
				stringArg('away', 'Rovers', { label: 'Away team', maxLength: 20 }),
				stringArg('homeScore', '2', { label: 'Home score', maxLength: 3 }),
				stringArg('awayScore', '1', { label: 'Away score', maxLength: 3 }),
				stringArg('clock', '2nd · 63:12', { label: 'Period + clock', maxLength: 20 }),
				enumArg('possession', ['home', 'away'], 'home', { label: 'Possession' })
			],
			render: el(
				'div',
				{ style: card(lib, { width: '280px', padding: '14px', gap: '10px' }) },
				row(
					{ justifyContent: 'space-between', gap: '8px' },
					row(
						{
							gap: '6px',
							padding: '2px 8px',
							borderRadius: chipRadius(lib),
							background: lib.palette.danger.soft,
							color: lib.palette.danger.onSoft,
							fontSize: lib.fontSize.xs,
							fontWeight: 700,
							letterSpacing: '0.06em'
						},
						el('span', { style: { width: '6px', height: '6px', borderRadius: '999px', background: lib.palette.danger.solid } }),
						'LIVE'
					),
					text(monoCaption(lib), '{clock}')
				),
				scoreTeamRow(lib, 'H', '{home}', '{homeScore}', 'home'),
				scoreTeamRow(lib, 'A', '{away}', '{awayScore}', 'away'),
				el(
					'div',
					{ style: { height: '4px', borderRadius: lib.radius.pill, background: lib.borderSoft, overflow: 'hidden', display: 'flex' } },
					el('div', { style: { width: '62%', borderRadius: lib.radius.pill, background: lib.id === 'thingtime' ? lib.rainbow : accent(lib) } })
				)
			)
		});

		const fixture = define({
			slug: `${lib.id}-sports-scores-fixture`,
			name: 'Fixture Card',
			library: lib.id,
			category: 'sports',
			description: `Upcoming match card in the ${lib.label} style — league chip and kickoff time, the team pair around a VS divider, venue caption, 1/X/2 odds chips, and a remind-me bell ghost button.`,
			tags: ['sports', 'fixture', 'match', 'odds', 'upcoming'],
			args: [
				stringArg('league', 'Premier League', { label: 'League', maxLength: 24 }),
				stringArg('home', 'Falcons', { label: 'Home team', maxLength: 20 }),
				stringArg('away', 'Rovers', { label: 'Away team', maxLength: 20 }),
				stringArg('kickoff', 'Sat 21:00', { label: 'Kickoff', maxLength: 20 }),
				stringArg('venue', 'Falcon Park', { label: 'Venue', maxLength: 32 })
			],
			render: el(
				'div',
				{ style: card(lib, { width: '280px', padding: '14px', gap: '12px' }) },
				row(
					{ justifyContent: 'space-between', gap: '8px' },
					el('span', { style: chip(lib, lib.palette.primary) }, '{league}'),
					text(monoCaption(lib), '{kickoff}')
				),
				row(
					{ gap: '10px' },
					text({ flex: 1, textAlign: 'right', fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, ...ellipsis }, '{home}'),
					el(
						'span',
						{
							style: {
								padding: '3px 7px',
								borderRadius: lib.radius.pill,
								background: lib.surfaceAlt,
								color: lib.faint,
								fontSize: lib.fontSize.xs,
								fontWeight: 700,
								flexShrink: 0
							}
						},
						'VS'
					),
					text({ flex: 1, fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, ...ellipsis }, '{away}')
				),
				text({ fontSize: lib.fontSize.xs, color: lib.muted, textAlign: 'center' }, '{venue}'),
				row(
					{ gap: '6px' },
					oddChip(lib, '1', '2.10'),
					oddChip(lib, 'X', '3.40'),
					oddChip(lib, '2', '3.60'),
					el(
						'button',
						{
							type: 'button',
							style: {
								width: '30px',
								alignSelf: 'stretch',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								background: 'transparent',
								border: 'none',
								borderRadius: lib.radius.sm,
								color: lib.muted,
								cursor: 'pointer',
								padding: '0',
								flexShrink: 0
							}
						},
						icons.bell(15, 'currentColor')
					)
				)
			)
		});

		const standings = define({
			slug: `${lib.id}-sports-scores-standings`,
			name: 'League Standings',
			library: lib.id,
			category: 'sports',
			description: `League table in the ${lib.label} style — Pos/Team/P/W/D/L/Pts header over four club rows with W/L form dots, the top row tinted for promotion and the bottom row tinted for relegation.`,
			tags: ['sports', 'standings', 'table', 'league'],
			args: [
				stringArg('team', 'Harriers', { label: 'Your team', maxLength: 20 }),
				stringArg('pts', '27', { label: 'Your points', maxLength: 3 }),
				{ name: 'formDots', type: 'boolean', default: true, label: 'Show form dots' }
			],
			render: el(
				'div',
				{ style: card(lib, { width: '300px', padding: '12px', gap: '2px' }) },
				row(
					{
						gap: '4px',
						padding: '0 8px 6px',
						borderBottom: `1px solid ${lib.borderSoft}`,
						fontWeight: 600,
						...standInherit(lib),
						...(lib.uppercaseButtons ? { textTransform: 'uppercase' } : {})
					},
					standCell(lib, { width: '24px', textAlign: 'left' }, 'Pos'),
					el('span', { style: { flex: 1, textAlign: 'left' } }, 'Team'),
					standCell(lib, {}, 'P'),
					standCell(lib, {}, 'W'),
					standCell(lib, {}, 'D'),
					standCell(lib, {}, 'L'),
					standCell(lib, { width: '28px', textAlign: 'right' }, 'Pts')
				),
				standRow(lib, {
					pos: '1',
					name: 'Falcons',
					form: [true, true, true],
					played: '12',
					won: '9',
					drawn: '2',
					lost: '1',
					pts: '29',
					tint: lib.palette.success
				}),
				standRow(lib, {
					pos: '2',
					name: '{team}',
					form: [true, false, true],
					played: '12',
					won: '8',
					drawn: '3',
					lost: '1',
					pts: '{pts}',
					strong: true
				}),
				standRow(lib, { pos: '3', name: 'United', form: [false, true, false], played: '12', won: '5', drawn: '3', lost: '4', pts: '18' }),
				standRow(lib, {
					pos: '4',
					name: 'Rovers',
					form: [false, false, true],
					played: '12',
					won: '2',
					drawn: '2',
					lost: '8',
					pts: '8',
					tint: lib.palette.danger
				})
			)
		});

		const player = define({
			slug: `${lib.id}-sports-scores-player`,
			name: 'Player Stat Card',
			library: lib.id,
			category: 'sports',
			description: `Player profile card in the ${lib.label} style — avatar tile beside the shirt number, name and position chip, Goals/Assists/Rating stat tiles with a stepped-dasharray rating ring, and a team caption.`,
			tags: ['sports', 'player', 'stats', 'profile'],
			args: [
				stringArg('name', 'Jordan Reyes', { label: 'Name', maxLength: 28 }),
				stringArg('number', '10', { label: 'Number', maxLength: 3 }),
				enumArg('position', ['FW', 'MF', 'DF', 'GK'], 'FW', { label: 'Position' }),
				stringArg('goals', '14', { label: 'Goals', maxLength: 3 }),
				enumArg('rating', ['6', '7', '8', '9', '10'], '8', { label: 'Rating' }),
				stringArg('team', 'Falcons FC', { label: 'Team', maxLength: 24 })
			],
			render: el(
				'div',
				{ style: card(lib, { width: '260px', padding: '14px', gap: '12px' }) },
				row(
					{ gap: '10px' },
					el(
						'div',
						{
							style: {
								width: '44px',
								height: '44px',
								borderRadius: lib.radius.md,
								background: lib.surfaceAlt,
								color: lib.muted,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0
							}
						},
						icons.user(22, 'currentColor')
					),
					stack(
						{ flex: 1, minWidth: 0, gap: '3px' },
						text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, ...ellipsis }, '{name}'),
						row(
							{ gap: '6px' },
							text(monoCaption(lib), '#{number}'),
							el('span', { style: chip(lib, lib.palette.primary) }, '{position}')
						)
					)
				),
				row(
					{ gap: '8px', alignItems: 'stretch' },
					statTile(lib, 'Goals', '{goals}'),
					statTile(lib, 'Assists', '7'),
					stack(
						{ flex: 1, alignItems: 'center', gap: '4px', padding: '6px 0', background: lib.surfaceAlt, borderRadius: lib.radius.md },
						text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.muted, ...(lib.uppercaseButtons ? { textTransform: 'uppercase' } : {}) }, 'Rating'),
						ratingRing(lib)
					)
				),
				text({ fontSize: lib.fontSize.xs, color: lib.muted, textAlign: 'center' }, '{team}')
			)
		});

		const bracket = define({
			slug: `${lib.id}-sports-scores-bracket`,
			name: 'Tournament Bracket',
			library: lib.id,
			category: 'sports',
			description: `Knockout bracket in the ${lib.label} style — two semifinal pairs joined to the final by CSS border rails, tone-tinted winner chips with mono scores, and a highlighted champion chip under round captions.`,
			tags: ['sports', 'bracket', 'tournament', 'knockout'],
			args: [
				stringArg('champion', 'Falcons', { label: 'Champion', maxLength: 20 }),
				stringArg('finalScore', '2 – 1', { label: 'Final score', maxLength: 12 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: card(lib, { display: 'inline-flex', padding: '14px', gap: '10px' }) },
				row(
					{ justifyContent: 'space-between', gap: '16px' },
					el('span', { style: roundCaption(lib) }, 'Semifinals'),
					el('span', { style: roundCaption(lib) }, 'Final')
				),
				row(
					{ alignItems: 'stretch' },
					stack(
						{ gap: '14px' },
						bracketPair(lib, bracketChip(lib, '{champion}', '2', true), bracketChip(lib, 'Rovers', '1', false)),
						bracketPair(lib, bracketChip(lib, 'Kings', '3', true), bracketChip(lib, 'United', '2', false))
					),
					el('div', {
						style: {
							width: '10px',
							alignSelf: 'stretch',
							marginTop: '27px',
							marginBottom: '27px',
							borderTop: `2px solid ${railColor(lib)}`,
							borderRight: `2px solid ${railColor(lib)}`,
							borderBottom: `2px solid ${railColor(lib)}`,
							borderTopRightRadius: '4px',
							borderBottomRightRadius: '4px'
						}
					}),
					el('div', { style: { width: '10px', height: '2px', background: railColor(lib), alignSelf: 'center' } }),
					stack(
						{ justifyContent: 'center', alignItems: 'center', gap: '6px', paddingLeft: '2px' },
						row(
							{
								gap: '6px',
								padding: '5px 10px',
								borderRadius: chipRadius(lib),
								background: toneMap(lib, (palette) => palette.solid),
								color: toneMap(lib, (palette) => palette.onSolid),
								fontSize: lib.fontSize.xs,
								fontWeight: 700,
								boxShadow: lib.id === 'mui' ? lib.shadow.sm : 'none',
								...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: '0.04em' } : {})
							},
							icons.star(12, 'currentColor', true),
							'{champion}'
						),
						text(monoCaption(lib), '{finalScore}')
					)
				)
			)
		});

		return [scoreboard, fixture, standings, player, bracket];
	}
};
