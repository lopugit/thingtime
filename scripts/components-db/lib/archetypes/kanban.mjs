// Kanban archetype — project-board surfaces in five renditions: task card,
// board column, mini three-lane board, filter bar, and card activity feed.
// Follows the button.mjs exemplar: exactly 5 variants, `build(lib)` returns
// exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-kanban-<variant>`.

import {
	avatarCircle,
	define,
	el,
	icons,
	numberArg,
	repeat,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// reactflow keeps its crisp near-black node chrome and hot-pink accent;
// thingtime leads with ink and saves the rainbow for a wink.
const accent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid);

const muiCaps = (lib) =>
	lib.id === 'mui' ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {};

// Small closable "x" affordance used by every filter chip.
const closeX = (lib) =>
	el('span', { style: { display: 'inline-flex', color: lib.faint, cursor: 'pointer' } }, icons.x(9, 'currentColor'));

// One slim lane of the mini board. Card bars are plain skeleton rows; the
// highlighted lane gets the accent border (and thingtime's rainbow strip).
const boardLane = (lib, nameToken, cardCount, highlighted) =>
	stack(
		{
			flex: '1',
			gap: '6px',
			padding: '8px',
			background: highlighted ? lib.surface : lib.bg,
			border: highlighted ? `1.5px solid ${accent(lib)}` : `1px solid ${lib.borderSoft}`,
			borderRadius: lib.radius.md,
			boxShadow: highlighted ? lib.shadow.sm : 'none'
		},
		highlighted && lib.id === 'thingtime'
			? el('div', { style: { height: '3px', borderRadius: lib.radius.pill, background: lib.rainbow } })
			: null,
		text(
			{
				fontSize: lib.fontSize.xs,
				fontWeight: lib.headingWeight,
				color: highlighted ? accent(lib) : lib.muted,
				...muiCaps(lib)
			},
			nameToken
		),
		Array.from({ length: cardCount }, () =>
			el('div', {
				style: {
					height: '16px',
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.xs,
					boxShadow: lib.shadow.sm
				}
			})
		)
	);

// One line of the activity feed: avatar + rich sentence + timestamp.
const activityRow = (lib, avatarBg, avatarFg, initials, spans, when) =>
	row(
		{ gap: '8px', alignItems: 'flex-start' },
		avatarCircle('24px', avatarBg, avatarFg, initials, '10px'),
		stack(
			{ gap: '2px', flex: '1' },
			el('span', { style: { fontSize: lib.fontSize.sm, color: lib.text, lineHeight: 1.4 } }, ...spans),
			text({ fontSize: lib.fontSize.xs, color: lib.faint }, when)
		)
	);

const strong = (value) => el('strong', { style: { fontWeight: 600 } }, value);

export const archetype = {
	id: 'kanban',
	category: 'project',
	variants: ['card', 'column', 'board', 'filters', 'activity'],
	build(lib) {
		const card = define({
			slug: `${lib.id}-kanban-card`,
			name: 'Kanban Card',
			library: lib.id,
			category: 'project',
			description: `Board task card in the ${lib.label} style — tone label chips over the title, a due-date chip, checklist count and an avatar pair on the library's card chrome.`,
			tags: ['kanban', 'card', 'task', 'board'],
			args: [
				stringArg('title', 'Ship onboarding flow', { label: 'Title', maxLength: 60 }),
				toneArg(),
				stringArg('due', 'Aug 24', { label: 'Due', maxLength: 12 }),
				stringArg('checklist', '3/5', { label: 'Checklist', maxLength: 8 })
			],
			render: stack(
				{
					width: '250px',
					boxSizing: 'border-box',
					gap: '10px',
					padding: '12px',
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.md,
					boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
					fontFamily: lib.font
				},
				row(
					{ gap: '6px' },
					el('span', {
						style: {
							width: '32px',
							height: '8px',
							borderRadius: lib.radius.pill,
							background: toneMap(lib, (palette) => palette.solid)
						}
					}),
					el('span', {
						style: {
							width: '20px',
							height: '8px',
							borderRadius: lib.radius.pill,
							background: lib.id === 'thingtime' ? lib.rainbow : lib.palette.success.solid
						}
					})
				),
				text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text, lineHeight: 1.35 }, '{title}'),
				row(
					{ gap: '10px' },
					row(
						{
							gap: '4px',
							padding: '2px 8px',
							background: lib.surfaceAlt,
							borderRadius: lib.radius.pill,
							color: lib.muted,
							fontSize: lib.fontSize.xs,
							fontWeight: 500
						},
						icons.calendar(11, 'currentColor'),
						'{due}'
					),
					row({ gap: '4px', color: lib.muted, fontSize: lib.fontSize.xs, fontWeight: 500 }, icons.check(11, 'currentColor'), '{checklist}'),
					row(
						{ marginLeft: 'auto' },
						avatarCircle('20px', toneMap(lib, (palette) => palette.solid), toneMap(lib, (palette) => palette.onSolid), 'AK', '9px', {
							border: `2px solid ${lib.surface}`
						}),
						avatarCircle('20px', lib.surfaceAlt, lib.muted, 'JR', '9px', {
							border: `2px solid ${lib.surface}`,
							marginLeft: '-6px'
						})
					)
				)
			)
		});

		const column = define({
			slug: `${lib.id}-kanban-column`,
			name: 'Kanban Column',
			library: lib.id,
			category: 'project',
			description: `Board column in the ${lib.label} style — header with a tone count pill and kebab menu, stacked mini cards, and a dashed add-card footer row.`,
			tags: ['kanban', 'column', 'board', 'project'],
			args: [
				stringArg('name', 'In progress', { label: 'Column name', maxLength: 24 }),
				numberArg('cards', 3, { label: 'Cards', min: 1, max: 4 }),
				toneArg()
			],
			render: stack(
				{
					width: '230px',
					boxSizing: 'border-box',
					gap: '8px',
					padding: '10px',
					background: lib.id === 'reactflow' ? lib.surfaceAlt : lib.bg,
					border: `1px solid ${lib.borderSoft}`,
					borderRadius: lib.radius.lg,
					fontFamily: lib.font
				},
				row(
					{ gap: '8px', padding: '2px 2px 4px' },
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text, ...muiCaps(lib) }, '{name}'),
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
								background: toneMap(lib, (palette) => palette.soft),
								color: toneMap(lib, (palette) => palette.onSoft),
								fontSize: lib.fontSize.xs,
								fontWeight: 700
							}
						},
						'{cards}'
					),
					el('span', { style: { marginLeft: 'auto', display: 'inline-flex', color: lib.muted } }, icons.dots(14, 'currentColor'))
				),
				repeat(
					'cards',
					4,
					el(
						'div',
						{
							style: {
								padding: '9px 10px',
								background: lib.surface,
								border: `1px solid ${lib.border}`,
								borderRadius: lib.radius.sm,
								boxShadow: lib.shadow.sm,
								fontSize: lib.fontSize.sm,
								fontWeight: 500,
								color: lib.text
							}
						},
						'Card {n}'
					)
				),
				row(
					{
						gap: '6px',
						justifyContent: 'center',
						padding: '7px',
						border: `1px dashed ${lib.id === 'reactflow' ? lib.faint : lib.border}`,
						borderRadius: lib.radius.sm,
						color: lib.muted,
						fontSize: lib.fontSize.sm,
						fontWeight: lib.buttonWeight,
						cursor: 'pointer'
					},
					icons.plus(12, 'currentColor'),
					'Add card'
				)
			)
		});

		const board = define({
			slug: `${lib.id}-kanban-board`,
			name: 'Mini Kanban Board',
			library: lib.id,
			category: 'project',
			description: `Miniature three-lane board in the ${lib.label} style — To do, Doing and Done lanes with tiny skeleton cards, the Doing lane highlighted with the library accent.`,
			tags: ['kanban', 'board', 'lanes', 'overview'],
			args: [
				stringArg('todo', 'To do', { label: 'First lane', maxLength: 16 }),
				stringArg('doing', 'Doing', { label: 'Middle lane', maxLength: 16 }),
				stringArg('done', 'Done', { label: 'Last lane', maxLength: 16 })
			],
			render: row(
				{
					gap: '8px',
					alignItems: 'stretch',
					width: '310px',
					boxSizing: 'border-box',
					padding: '10px',
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.lg,
					boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
					fontFamily: lib.font
				},
				boardLane(lib, '{todo}', 2, false),
				boardLane(lib, '{doing}', 2, true),
				boardLane(lib, '{done}', 1, false)
			)
		});

		const filters = define({
			slug: `${lib.id}-kanban-filters`,
			name: 'Board Filter Bar',
			library: lib.id,
			category: 'project',
			description: `Board filter bar in the ${lib.label} style — closable assignee, tone label and due chips beside a clear-all ghost and a saved-view select mock.`,
			tags: ['kanban', 'filters', 'toolbar', 'board'],
			args: [
				stringArg('assignee', 'Ana', { label: 'Assignee', maxLength: 16 }),
				stringArg('label', 'Design', { label: 'Label chip', maxLength: 16 }),
				toneArg(),
				stringArg('due', 'This week', { label: 'Due filter', maxLength: 16 }),
				stringArg('view', 'Sprint 12', { label: 'Saved view', maxLength: 20 })
			],
			render: row(
				{
					flexWrap: 'wrap',
					gap: '8px',
					padding: '8px 10px',
					boxSizing: 'border-box',
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.md,
					boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none',
					fontFamily: lib.font
				},
				text({ fontSize: lib.fontSize.xs, fontWeight: lib.headingWeight, color: lib.muted, ...muiCaps(lib) }, 'Filter'),
				row(
					{
						gap: '5px',
						padding: '2px 7px 2px 2px',
						background: lib.surfaceAlt,
						border: `1px solid ${lib.border}`,
						borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
						fontSize: lib.fontSize.xs,
						fontWeight: 500,
						color: lib.text
					},
					avatarCircle('16px', accent(lib), '#ffffff', el('span', { style: { display: 'inline-flex' } }, icons.user(9, 'currentColor')), '8px'),
					'{assignee}',
					closeX(lib)
				),
				row(
					{
						gap: '5px',
						padding: '3px 7px',
						background: lib.surfaceAlt,
						border: `1px solid ${lib.border}`,
						borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
						fontSize: lib.fontSize.xs,
						fontWeight: 500,
						color: lib.text
					},
					el('span', {
						style: { width: '8px', height: '8px', borderRadius: lib.radius.pill, background: toneMap(lib, (palette) => palette.solid), flexShrink: 0 }
					}),
					'{label}',
					closeX(lib)
				),
				row(
					{
						gap: '5px',
						padding: '3px 7px',
						background: lib.surfaceAlt,
						border: `1px solid ${lib.border}`,
						borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
						fontSize: lib.fontSize.xs,
						fontWeight: 500,
						color: lib.text
					},
					el('span', { style: { display: 'inline-flex', color: lib.muted } }, icons.calendar(10, 'currentColor')),
					'{due}',
					closeX(lib)
				),
				text({ fontSize: lib.fontSize.xs, fontWeight: lib.buttonWeight, color: lib.muted, cursor: 'pointer', ...muiCaps(lib) }, 'Clear all'),
				row(
					{
						marginLeft: 'auto',
						gap: '5px',
						padding: '4px 9px',
						background: lib.surface,
						border: `1px solid ${lib.border}`,
						borderRadius: lib.radius.sm,
						fontSize: lib.fontSize.xs,
						fontWeight: 500,
						color: lib.text,
						cursor: 'pointer'
					},
					'{view}',
					el('span', { style: { display: 'inline-flex', color: lib.muted } }, icons.chevronDown(11, 'currentColor'))
				)
			)
		});

		const activity = define({
			slug: `${lib.id}-kanban-activity`,
			name: 'Card Activity Feed',
			library: lib.id,
			category: 'project',
			description: `Card activity feed in the ${lib.label} style — three avatar rows with bold-name move, attach and comment events plus timestamps, and a comment input mock below.`,
			tags: ['kanban', 'activity', 'feed', 'comments'],
			args: [
				stringArg('name', 'Maya', { label: 'Actor name', maxLength: 20 }),
				stringArg('column', 'Doing', { label: 'Moved to', maxLength: 16 }),
				stringArg('time', '2h ago', { label: 'Timestamp', maxLength: 12 }),
				stringArg('placeholder', 'Write a comment…', { label: 'Comment placeholder', maxLength: 40 })
			],
			render: stack(
				{
					width: '270px',
					boxSizing: 'border-box',
					gap: '12px',
					padding: '12px',
					background: lib.surface,
					border: `1px solid ${lib.border}`,
					borderRadius: lib.radius.md,
					boxShadow: lib.shadow.sm,
					fontFamily: lib.font
				},
				activityRow(
					lib,
					lib.id === 'thingtime' ? lib.rainbow : accent(lib),
					'#ffffff',
					'M',
					[strong('{name}'), ' moved this card to ', strong('{column}')],
					'{time}'
				),
				activityRow(lib, lib.palette.success.solid, '#ffffff', 'A', [strong('Ana'), ' attached ', strong('spec-v2.pdf')], '5h ago'),
				activityRow(lib, lib.surfaceAlt, lib.muted, 'L', [strong('Leo'), ' commented: “Nice progress”'], 'Yesterday'),
				row(
					{ gap: '8px' },
					avatarCircle('24px', lib.surfaceAlt, lib.muted, 'ME', '9px'),
					el('input', {
						type: 'text',
						placeholder: '{placeholder}',
						style: {
							flex: '1',
							minWidth: '0',
							height: lib.control.sm,
							boxSizing: 'border-box',
							padding: '0 10px',
							background: lib.surface,
							border: `1px solid ${lib.border}`,
							borderRadius: lib.id === 'daisyui' ? lib.radius.pill : lib.radius.sm,
							fontSize: lib.fontSize.sm,
							fontFamily: lib.font,
							color: lib.text,
							outline: 'none'
						}
					})
				)
			)
		});

		return [card, column, board, filters, activity];
	}
};
