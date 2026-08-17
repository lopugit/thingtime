// Productivity archetype — personal productivity surfaces in five renditions:
// note card, todo checklist, pomodoro timer, habit tracker, and saved snippet.
// Follows the button.mjs exemplar: exactly 5 variants, `build(lib)` returns
// exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-productivity-notes-<variant>`.

import {
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

// Library personality: mui floats on elevation, everyone else keeps a feather.
const cardShadow = (lib) => (lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm);

// reactflow chrome runs on its signature accent; everyone else on primary.
const accent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid);

// The soft tint that matches the accent above (reactflow's accent IS its danger).
const accentSoft = (lib) => (lib.id === 'reactflow' ? lib.palette.danger : lib.palette.primary);

// antd chips sit on tight corners, reactflow stays crisp, the rest wear pills.
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);

const upper = (lib) => (lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {});

const card = (lib) => ({
	width: '300px',
	boxSizing: 'border-box',
	padding: '16px',
	display: 'flex',
	flexDirection: 'column',
	gap: '12px',
	background: lib.surface,
	borderRadius: lib.radius.lg,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.borderSoft,
	boxShadow: cardShadow(lib),
	fontFamily: lib.font,
	color: lib.text
});

const caption = (lib, value, extra = {}) => text({ fontSize: lib.fontSize.xs, color: lib.muted, ...extra }, value);

const chip = (lib, style, value) =>
	el(
		'span',
		{
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				padding: '2px 8px',
				borderRadius: chipRadius(lib),
				fontSize: lib.fontSize.xs,
				fontWeight: 600,
				...style
			}
		},
		value
	);

// thingtime's rainbow wink: a slim gradient strip across the card top.
const rainbowStrip = (lib) =>
	lib.id === 'thingtime' ? el('div', { style: { height: '3px', borderRadius: '999px', background: lib.rainbow } }) : null;

// Static-count repeat (the shared helper is arg-driven only).
const repeatN = (count, max, node) => ({ ttRepeat: { count, max, node } });

export const archetype = {
	id: 'productivity-notes',
	category: 'productivity',
	variants: ['note', 'todo', 'pomodoro', 'habits', 'snippet'],
	build(lib) {
		// --- note ------------------------------------------------------------
		const noteInks = {
			sun: lib.palette.warning.solid,
			mint: lib.palette.success.solid,
			sky: lib.palette.info.solid,
			rose: lib.palette.danger.solid
		};
		const noteDot = (key, color) =>
			el('span', {
				style: merge(
					{ width: '14px', height: '14px', borderRadius: '999px', background: color },
					ifEq('noteColor', key, { boxShadow: `0 0 0 2px ${lib.surface}, 0 0 0 4px ${color}` }, {})
				)
			});

		const note = define({
			slug: `${lib.id}-productivity-notes-note`,
			name: 'Note Card',
			library: lib.id,
			category: 'productivity',
			description: `Pinned note card in the ${lib.label} style — title with edited caption, body preview lines, tag chips, a star pin toggle and a four-dot note-color picker.`,
			tags: ['note', 'card', 'productivity', 'pin', 'tags'],
			args: [
				stringArg('title', 'Meeting notes', { label: 'Title', maxLength: 40 }),
				stringArg('edited', 'Edited 2h ago', { label: 'Edited caption', maxLength: 32 }),
				stringArg('tag', 'work', { label: 'First tag', maxLength: 16 }),
				booleanArg('pinned', true, { label: 'Pinned' }),
				enumArg('noteColor', ['sun', 'mint', 'sky', 'rose'], 'sun', { label: 'Note color' })
			],
			render: el(
				'div',
				{ style: card(lib) },
				rainbowStrip(lib),
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					stack(
						{ gap: '2px', minWidth: 0 },
						text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, '{title}'),
						caption(lib, '{edited}')
					),
					el(
						'button',
						{
							type: 'button',
							style: {
								width: '30px',
								height: '30px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: lib.radius.sm,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: iff('pinned', lib.palette.warning.border, lib.border),
								background: iff('pinned', lib.palette.warning.soft, 'transparent'),
								cursor: 'pointer',
								padding: '0',
								flexShrink: 0
							}
						},
						iff('pinned', icons.star(14, lib.palette.warning.solid, true), icons.star(14, lib.faint, false))
					)
				),
				stack(
					{ gap: '6px' },
					el('div', { style: { height: '8px', borderRadius: '999px', background: lib.borderSoft, width: '100%' } }),
					el('div', { style: { height: '8px', borderRadius: '999px', background: lib.borderSoft, width: '86%' } }),
					el('div', { style: { height: '8px', borderRadius: '999px', background: lib.borderSoft, width: '58%' } })
				),
				row(
					{ gap: '6px', flexWrap: 'wrap' },
					chip(lib, { background: accentSoft(lib).soft, color: accentSoft(lib).onSoft }, '{tag}'),
					chip(lib, { background: lib.surfaceAlt, color: lib.muted }, 'personal')
				),
				row(
					{ gap: '10px' },
					noteDot('sun', noteInks.sun),
					noteDot('mint', noteInks.mint),
					noteDot('sky', noteInks.sky),
					noteDot('rose', noteInks.rose)
				)
			)
		});

		// --- todo ------------------------------------------------------------
		const todoAccent = accent(lib);
		const onAccent = lib.palette.primary.onSolid;
		const handle = () => text({ fontSize: lib.fontSize.sm, color: lib.faint, letterSpacing: '1px', flexShrink: 0 }, '⋮⋮');
		const boxBase = {
			width: '18px',
			height: '18px',
			borderRadius: lib.radius.xs,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			flexShrink: 0,
			boxSizing: 'border-box'
		};
		const checkedBox = () => el('span', { style: { ...boxBase, background: todoAccent } }, icons.check(12, onAccent));
		const emptyBox = () =>
			el('span', {
				style: { ...boxBase, borderWidth: '1px', borderStyle: 'solid', borderColor: lib.border, background: lib.surface }
			});
		const doneText = (value) =>
			text({ fontSize: lib.fontSize.sm, color: lib.muted, textDecoration: 'line-through', minWidth: 0 }, value);
		const openText = (value) => text({ fontSize: lib.fontSize.sm, color: lib.text, minWidth: 0 }, value);

		const todo = define({
			slug: `${lib.id}-productivity-notes-todo`,
			name: 'Todo Checklist',
			library: lib.id,
			category: 'productivity',
			description: `Todo checklist card in the ${lib.label} style — list header with done count and thin progress bar, drag-handle task rows with struck completed items, a priority flag and a dashed add-task row.`,
			tags: ['todo', 'checklist', 'tasks', 'productivity', 'progress'],
			args: [
				stringArg('list', 'Today', { label: 'List name', maxLength: 32 }),
				stringArg('task', 'Draft launch email', { label: 'Open task', maxLength: 40 }),
				numberArg('done', 2, { label: 'Done count' }),
				numberArg('total', 4, { label: 'Total count' })
			],
			render: el(
				'div',
				{ style: card(lib) },
				rainbowStrip(lib),
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, '{list}'),
					caption(lib, '{done}/{total} done')
				),
				el(
					'div',
					{ style: { height: '6px', borderRadius: '999px', background: lib.borderSoft, overflow: 'hidden' } },
					el('div', {
						style: { height: '6px', borderRadius: '999px', background: todoAccent, width: 'calc({done} * 25%)' }
					})
				),
				row({ gap: '10px' }, handle(), checkedBox(), doneText('Clear inbox')),
				row({ gap: '10px' }, handle(), checkedBox(), doneText('Stand-up notes')),
				row(
					{ gap: '10px' },
					handle(),
					emptyBox(),
					openText('{task}'),
					chip(
						lib,
						{ background: lib.palette.danger.soft, color: lib.palette.danger.onSoft, marginLeft: 'auto', flexShrink: 0 },
						'High'
					)
				),
				row({ gap: '10px' }, handle(), emptyBox(), openText('Water the plants')),
				row(
					{
						gap: '8px',
						justifyContent: 'center',
						height: lib.control.sm,
						borderWidth: '1px',
						borderStyle: 'dashed',
						borderColor: lib.border,
						borderRadius: lib.radius.sm,
						color: lib.muted,
						cursor: 'pointer',
						fontSize: lib.fontSize.sm,
						fontWeight: lib.buttonWeight,
						...upper(lib)
					},
					icons.plus(14, 'currentColor'),
					'Add task'
				)
			)
		});

		// --- pomodoro --------------------------------------------------------
		// Ring circumference at r=52 is ~327; stepped dasharray = mins/60 of it.
		const ringDash = map(
			'mins',
			{ 15: '82 327', 20: '109 327', 25: '136 327', 30: '163 327', 45: '245 327' },
			'136 327'
		);
		const segment = (key, label) =>
			el(
				'span',
				{
					style: merge(
						{
							flex: 1,
							textAlign: 'center',
							padding: '6px 0',
							borderRadius: lib.radius.sm,
							fontSize: lib.fontSize.sm,
							fontWeight: 600,
							cursor: 'pointer',
							...upper(lib)
						},
						ifEq('mode', key, { background: lib.surface, color: lib.text, boxShadow: lib.shadow.sm }, { color: lib.muted })
					)
				},
				label
			);

		const pomodoro = define({
			slug: `${lib.id}-productivity-notes-pomodoro`,
			name: 'Pomodoro Timer',
			library: lib.id,
			category: 'productivity',
			description: `Focus timer card in the ${lib.label} style — big stepped-dasharray progress ring around the minute readout, done-session dots, a Focus/Break segmented toggle and a tone start/pause circle.`,
			tags: ['pomodoro', 'timer', 'focus', 'productivity', 'ring'],
			args: [
				enumArg('mins', ['15', '20', '25', '30', '45'], '25', { label: 'Minutes' }),
				numberArg('sessions', 3, { label: 'Sessions done' }),
				enumArg('mode', ['focus', 'break'], 'focus', { label: 'Mode' }),
				booleanArg('running', false, { label: 'Running' }),
				toneArg()
			],
			render: el(
				'div',
				{ style: card(lib) },
				rainbowStrip(lib),
				el(
					'div',
					{ style: { position: 'relative', width: '120px', height: '120px', alignSelf: 'center' } },
					el(
						'svg',
						{ width: 120, height: 120, viewBox: '0 0 120 120', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
						el('circle', { cx: 60, cy: 60, r: 52, stroke: lib.borderSoft, strokeWidth: 8 }),
						el('circle', {
							cx: 60,
							cy: 60,
							r: 52,
							stroke: toneMap(lib, (palette) => palette.solid),
							strokeWidth: 8,
							strokeLinecap: 'round',
							style: { strokeDasharray: ringDash, transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }
						})
					),
					el(
						'div',
						{
							style: {
								position: 'absolute',
								top: '0',
								left: '0',
								width: '120px',
								height: '120px',
								display: 'flex',
								flexDirection: 'column',
								alignItems: 'center',
								justifyContent: 'center',
								gap: '2px'
							}
						},
						text({ fontSize: '26px', fontWeight: lib.headingWeight, color: lib.text }, '{mins}:00'),
						caption(lib, map('mode', { focus: 'Focus', break: 'Break' }, 'Focus'), {
							textTransform: 'uppercase',
							letterSpacing: '0.08em'
						})
					)
				),
				row(
					{ gap: '6px', justifyContent: 'center' },
					repeat(
						'sessions',
						8,
						el('span', {
							style: { width: '8px', height: '8px', borderRadius: '999px', background: toneMap(lib, (palette) => palette.solid) }
						})
					),
					caption(lib, '{sessions} done', { marginLeft: '4px' })
				),
				el(
					'div',
					{ style: { display: 'flex', gap: '4px', padding: '4px', background: lib.surfaceAlt, borderRadius: lib.radius.md } },
					segment('focus', 'Focus'),
					segment('break', 'Break')
				),
				el(
					'button',
					{
						type: 'button',
						style: {
							width: '48px',
							height: '48px',
							borderRadius: '999px',
							border: 'none',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							alignSelf: 'center',
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							boxShadow: cardShadow(lib),
							cursor: 'pointer',
							padding: '0'
						}
					},
					iff(
						'running',
						el(
							'svg',
							{
								width: 16,
								height: 16,
								viewBox: '0 0 24 24',
								fill: 'none',
								stroke: 'currentColor',
								strokeWidth: 3,
								strokeLinecap: 'round',
								xmlns: 'http://www.w3.org/2000/svg'
							},
							el('line', { x1: 9, y1: 7, x2: 9, y2: 17 }),
							el('line', { x1: 15, y1: 7, x2: 15, y2: 17 })
						),
						el(
							'svg',
							{ width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor', xmlns: 'http://www.w3.org/2000/svg' },
							el('polygon', { points: '8 5 19 12 8 19' })
						)
					)
				)
			)
		});

		// --- habits ----------------------------------------------------------
		// thingtime dots wear the rainbow; reactflow its accent; others success.
		const habitFill = lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.accent : lib.palette.success.solid;
		const emptyDayDot = el('span', { style: { width: '14px', height: '14px', borderRadius: '999px', background: lib.borderSoft } });
		const habitName = (value) => text({ fontSize: lib.fontSize.sm, fontWeight: 500, minWidth: 0 }, value);
		// Fixed-pattern row: 7 base dots, days in `days` filled via a ttMap on
		// the repeat-scope day number `n`.
		const patternDots = (days) => {
			const values = {};
			for (const day of days) values[day] = { background: habitFill };
			return el(
				'div',
				{ style: { display: 'flex', gap: '6px' } },
				repeatN(
					7,
					7,
					el('span', {
						style: merge({ width: '14px', height: '14px', borderRadius: '999px', background: lib.borderSoft }, {
							ttMap: { arg: 'n', values, default: {} }
						})
					})
				)
			);
		};

		const habits = define({
			slug: `${lib.id}-productivity-notes-habits`,
			name: 'Habit Tracker',
			library: lib.id,
			category: 'productivity',
			description: `Habit tracker card in the ${lib.label} style — week caption with a streak chip, then three habit rows of seven day dots; the first habit's fill is a repeat-driven streak overlay.`,
			tags: ['habits', 'tracker', 'streak', 'productivity', 'week'],
			args: [
				stringArg('habit', 'Morning run', { label: 'Habit name', maxLength: 32 }),
				numberArg('streak', 4, { label: 'Streak days' }),
				stringArg('caption', 'This week', { label: 'Week caption', maxLength: 24 })
			],
			render: el(
				'div',
				{ style: card(lib) },
				rainbowStrip(lib),
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					caption(lib, '{caption}', { fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }),
					chip(lib, { background: lib.palette.success.soft, color: lib.palette.success.onSoft }, '{streak} day streak')
				),
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					habitName('{habit}'),
					el(
						'div',
						{ style: { position: 'relative', display: 'flex', gap: '6px' } },
						repeatN(7, 7, emptyDayDot),
						el(
							'div',
							{ style: { position: 'absolute', top: '0', left: '0', display: 'flex', gap: '6px' } },
							repeat(
								'streak',
								7,
								el('span', { style: { width: '14px', height: '14px', borderRadius: '999px', background: habitFill } })
							)
						)
					)
				),
				row({ justifyContent: 'space-between', gap: '10px' }, habitName('Meditate'), patternDots([1, 2, 4, 5])),
				row({ justifyContent: 'space-between', gap: '10px' }, habitName('Read 20 pages'), patternDots([2, 5, 7]))
			)
		});

		// --- snippet ---------------------------------------------------------
		const darkCode = lib.id === 'thingtime';
		const codeBg = darkCode ? lib.ink : lib.surfaceAlt;
		const codeText = darkCode ? lib.surface : lib.text;
		const codeMuted = darkCode ? lib.faint : lib.muted;
		const kw = lib.id === 'reactflow' ? lib.accent : lib.palette.info.solid;
		const str = lib.palette.success.solid;

		const snippet = define({
			slug: `${lib.id}-productivity-notes-snippet`,
			name: 'Snippet Card',
			library: lib.id,
			category: 'productivity',
			description: `Saved code snippet card in the ${lib.label} style — language chip beside a mono name, tone-highlighted code lines, a ghost copy button with usage count, and tag chips.`,
			tags: ['snippet', 'code', 'productivity', 'clipboard', 'tags'],
			args: [
				stringArg('name', 'useDebounce', { label: 'Snippet name', maxLength: 32 }),
				enumArg('lang', ['js', 'ts', 'py', 'sh'], 'ts', { label: 'Language' }),
				numberArg('count', 12, { label: 'Times used' }),
				stringArg('tag', 'hooks', { label: 'First tag', maxLength: 16 })
			],
			render: el(
				'div',
				{ style: card(lib) },
				rainbowStrip(lib),
				row(
					{ gap: '8px' },
					el(
						'span',
						{
							style: merge(
								{
									display: 'inline-flex',
									alignItems: 'center',
									padding: '2px 8px',
									borderRadius: chipRadius(lib),
									fontSize: lib.fontSize.xs,
									fontWeight: 700,
									textTransform: 'uppercase',
									letterSpacing: '0.04em',
									flexShrink: 0
								},
								map(
									'lang',
									{
										js: { background: lib.palette.warning.soft, color: lib.palette.warning.onSoft },
										ts: { background: lib.palette.info.soft, color: lib.palette.info.onSoft },
										py: { background: lib.palette.success.soft, color: lib.palette.success.onSoft },
										sh: { background: lib.palette.neutral.soft, color: lib.palette.neutral.onSoft }
									},
									{ background: lib.palette.neutral.soft, color: lib.palette.neutral.onSoft }
								)
							)
						},
						'{lang}'
					),
					text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.md, fontWeight: 600, minWidth: 0 }, '{name}')
				),
				stack(
					{
						gap: '4px',
						padding: '12px',
						borderRadius: lib.radius.sm,
						background: codeBg,
						fontFamily: lib.fontMono,
						fontSize: lib.fontSize.xs,
						lineHeight: 1.6
					},
					el(
						'div',
						null,
						text({ color: kw }, 'export const '),
						text({ color: codeText, fontWeight: 600 }, '{name}'),
						text({ color: codeMuted }, ' = (value) => {')
					),
					el(
						'div',
						{ style: { paddingLeft: '14px' } },
						text({ color: codeMuted }, 'return useMemo(() => '),
						text({ color: str }, "'ready'"),
						text({ color: codeMuted }, ')')
					),
					el('div', null, text({ color: codeMuted }, '}'))
				),
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					caption(lib, 'Used {count}×'),
					el(
						'button',
						{
							type: 'button',
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								gap: '6px',
								height: lib.control.sm,
								padding: '0 10px',
								borderRadius: lib.radius.sm,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.border,
								background: 'transparent',
								color: lib.text,
								fontSize: lib.fontSize.xs,
								fontWeight: lib.buttonWeight,
								fontFamily: lib.font,
								cursor: 'pointer',
								...upper(lib)
							}
						},
						icons.file(12, 'currentColor'),
						'Copy'
					)
				),
				row(
					{ gap: '6px', flexWrap: 'wrap' },
					chip(lib, { background: accentSoft(lib).soft, color: accentSoft(lib).onSoft }, '{tag}'),
					chip(lib, { background: lib.surfaceAlt, color: lib.muted }, 'snippets')
				)
			)
		});

		return [note, todo, pomodoro, habits, snippet];
	}
};
