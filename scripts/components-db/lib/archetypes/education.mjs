// Education archetype — learning surfaces in five renditions: course card,
// curriculum lesson list, quiz card, completion certificate, and learning
// path. Follows the button.mjs exemplar: exactly 5 variants, `build(lib)`
// returns exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-education-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
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

// antd sits on tight corners and reactflow keeps its node chrome crisp;
// everyone else wears the library's large radius. mui gets real elevation,
// untitled its feather shadow.
const cardRadius = (lib) => (lib.id === 'antd' ? lib.radius.sm : lib.id === 'reactflow' ? lib.radius.md : lib.radius.lg);
const cardShadow = (lib) => (lib.id === 'mui' ? lib.shadow.md : lib.id === 'untitled' ? lib.shadow.lg : lib.shadow.sm);

const card = (lib, extra = {}) => ({
	fontFamily: lib.font,
	color: lib.text,
	background: lib.surface,
	border: `${lib.id === 'daisyui' ? '2px' : '1px'} solid ${lib.border}`,
	borderRadius: cardRadius(lib),
	boxShadow: cardShadow(lib),
	boxSizing: 'border-box',
	overflow: 'hidden',
	...extra
});

const chip = (lib, style, label) =>
	el(
		'span',
		{
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				padding: '2px 8px',
				borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
				fontSize: lib.fontSize.xs,
				fontWeight: 600,
				whiteSpace: 'nowrap',
				...style
			}
		},
		label
	);

// Fixed per-library accent for the path rail — a tone map nested inside the
// per-milestone state maps would blow the server node budget.
const railAccent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid);

const bookIcon = (size, stroke) =>
	el(
		'svg',
		{ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', xmlns: 'http://www.w3.org/2000/svg' },
		el('path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }),
		el('path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' })
	);

const playIcon = (size, fill) =>
	el('svg', { width: size, height: size, viewBox: '0 0 24 24', fill, xmlns: 'http://www.w3.org/2000/svg' }, el('polygon', { points: '7 4 19 12 7 20' }));

const laurelIcon = (size, stroke) =>
	el(
		'svg',
		{ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.5, strokeLinecap: 'round', xmlns: 'http://www.w3.org/2000/svg' },
		el('path', { d: 'M7 3C3.5 7.5 3.5 16.5 7 21' }),
		el('path', { d: 'M17 3c3.5 4.5 3.5 13.5 0 18' })
	);

const actionButton = (lib, extra = {}) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	height: lib.control.sm,
	padding: '0 16px',
	border: 'none',
	borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	fontSize: lib.fontSize.sm,
	cursor: 'pointer',
	background: toneMap(lib, (palette) => palette.solid),
	color: toneMap(lib, (palette) => palette.onSolid),
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {}),
	...extra
});

export const archetype = {
	id: 'education',
	category: 'learning',
	variants: ['course', 'curriculum', 'quiz', 'certificate', 'path'],
	build(lib) {
		const course = define({
			slug: `${lib.id}-education-course`,
			name: 'Course Card',
			library: lib.id,
			category: 'learning',
			description: `Course card in the ${lib.label} style — tinted cover band with a book glyph, title and instructor, lesson/duration/level chips, and a progress bar with a Continue action.`,
			tags: ['education', 'course', 'card', 'progress'],
			args: [
				stringArg('title', 'Design Systems 101', { label: 'Title', maxLength: 60 }),
				stringArg('instructor', 'Maya Chen', { label: 'Instructor', maxLength: 40 }),
				numberArg('lessons', 24, { label: 'Lessons', min: 1, max: 999 }),
				enumArg('level', ['Beginner', 'Intermediate', 'Advanced'], 'Beginner', { label: 'Level' }),
				numberArg('percent', 60, { label: 'Percent complete', min: 0, max: 100 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: card(lib, { width: '300px' }) },
				lib.id === 'thingtime' ? el('div', { style: { height: '4px', background: lib.rainbow } }) : null,
				el(
					'div',
					{
						style: {
							height: '84px',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							backgroundColor: toneMap(lib, (palette) => palette.soft),
							...(lib.id === 'reactflow'
								? { backgroundImage: `radial-gradient(${lib.dot} 1px, transparent 1px)`, backgroundSize: '12px 12px' }
								: {})
						}
					},
					bookIcon(30, toneMap(lib, (palette) => palette.solid))
				),
				stack(
					{ padding: '14px 16px 16px', gap: '10px' },
					stack(
						{ gap: '2px' },
						text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, '{title}'),
						text({ fontSize: lib.fontSize.sm, color: lib.muted }, 'by {instructor}')
					),
					row(
						{ gap: '6px', flexWrap: 'wrap' },
						chip(lib, { background: lib.surfaceAlt, color: lib.muted }, '{lessons} lessons'),
						chip(lib, { background: lib.surfaceAlt, color: lib.muted }, '6h 20m'),
						chip(lib, { background: toneMap(lib, (palette) => palette.soft), color: toneMap(lib, (palette) => palette.onSoft) }, '{level}')
					),
					row(
						{ gap: '10px' },
						el(
							'div',
							{
								style: {
									flex: 1,
									height: lib.id === 'daisyui' ? '10px' : '8px',
									background: lib.borderSoft,
									borderRadius: lib.radius.pill,
									overflow: 'hidden'
								}
							},
							el('div', {
								style: {
									width: '{percent}%',
									height: '100%',
									borderRadius: lib.radius.pill,
									background: lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid)
								}
							})
						),
						text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.muted }, '{percent}%')
					),
					el('button', { type: 'button', style: actionButton(lib, { width: '100%' }) }, 'Continue')
				)
			)
		});

		const successDot = el(
			'div',
			{
				style: {
					width: '18px',
					height: '18px',
					borderRadius: '999px',
					background: lib.palette.success.solid,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					flexShrink: 0
				}
			},
			icons.check(10, lib.palette.success.onSolid)
		);

		const duration = (value) => iff('durations', text({ fontSize: lib.fontSize.xs, fontFamily: lib.fontMono, color: lib.faint }, value));

		const curriculum = define({
			slug: `${lib.id}-education-curriculum`,
			name: 'Curriculum List',
			library: lib.id,
			category: 'learning',
			description: `Lesson list in the ${lib.label} style — module header over four lesson rows: checked-off done lessons, a tone-accented current lesson with a play glyph, and a locked lesson with a hollow dot.`,
			tags: ['education', 'curriculum', 'lessons', 'list'],
			args: [
				stringArg('module', 'Module 3 · Components', { label: 'Module', maxLength: 48 }),
				stringArg('lesson', 'Design tokens explained', { label: 'First lesson', maxLength: 48 }),
				toneArg(),
				booleanArg('durations', true, { label: 'Show durations' })
			],
			render: el(
				'div',
				{ style: card(lib, { width: '300px' }) },
				row(
					{ justifyContent: 'space-between', gap: '8px', padding: '12px 16px', borderBottom: `1px solid ${lib.borderSoft}` },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{module}'),
					chip(lib, { background: lib.surfaceAlt, color: lib.muted }, '4 lessons')
				),
				stack(
					{ padding: '6px 0' },
					row({ gap: '10px', padding: '8px 16px' }, successDot, text({ flex: 1, fontSize: lib.fontSize.sm, color: lib.muted }, '{lesson}'), duration('4:12')),
					row(
						{ gap: '10px', padding: '8px 16px' },
						successDot,
						text({ flex: 1, fontSize: lib.fontSize.sm, color: lib.muted }, 'Design tokens in practice'),
						duration('6:40')
					),
					row(
						{
							gap: '10px',
							padding: '8px 16px 8px 13px',
							background: lib.surfaceAlt,
							borderLeftWidth: '3px',
							borderLeftStyle: 'solid',
							borderLeftColor: toneMap(lib, (palette) => palette.solid)
						},
						el(
							'div',
							{ style: { width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
							playIcon(14, toneMap(lib, (palette) => palette.solid))
						),
						text({ flex: 1, fontSize: lib.fontSize.sm, fontWeight: 700 }, 'Building the library'),
						duration('8:15')
					),
					row(
						{ gap: '10px', padding: '8px 16px' },
						el('div', { style: { width: '18px', height: '18px', borderRadius: '999px', border: `2px solid ${lib.borderSoft}`, boxSizing: 'border-box', flexShrink: 0 } }),
						text({ flex: 1, fontSize: lib.fontSize.sm, color: lib.faint }, 'Shipping to production'),
						duration('5:05')
					)
				)
			)
		});

		const answerBase = {
			display: 'flex',
			alignItems: 'center',
			gap: '10px',
			padding: '10px 12px',
			borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
			borderWidth: '1px',
			borderStyle: 'solid',
			borderColor: lib.border,
			background: lib.surface,
			fontSize: lib.fontSize.sm,
			fontWeight: 500,
			cursor: 'pointer'
		};

		const answerLetter = (letter) =>
			el(
				'span',
				{
					style: {
						width: '20px',
						height: '20px',
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						borderRadius: lib.radius.xs,
						border: `1px solid ${lib.borderSoft}`,
						fontSize: lib.fontSize.xs,
						fontWeight: 700,
						color: lib.muted,
						flexShrink: 0
					}
				},
				letter
			);

		const quiz = define({
			slug: `${lib.id}-education-quiz`,
			name: 'Quiz Card',
			library: lib.id,
			category: 'learning',
			description: `Quiz question card in the ${lib.label} style — mono progress caption over a hairline meter, the question, three answer rows (one tone-ringed selection, one success flash on reveal), and a Next action.`,
			tags: ['education', 'quiz', 'question', 'assessment'],
			args: [
				textArg('question', 'Which layer owns design tokens?', { label: 'Question', maxLength: 120 }),
				numberArg('num', 3, { label: 'Question number', min: 1, max: 12 }),
				numberArg('total', 5, { label: 'Total questions', min: 1, max: 12 }),
				booleanArg('reveal', false, { label: 'Reveal answer' }),
				toneArg()
			],
			render: stack(
				{ ...card(lib, { width: '300px' }), padding: '16px', gap: '12px' },
				stack(
					{ gap: '8px' },
					text(
						{ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, letterSpacing: '0.08em', textTransform: 'uppercase', color: lib.muted, fontWeight: 600 },
						'Question {num} of {total}'
					),
					el(
						'div',
						{ style: { height: '3px', background: lib.borderSoft, borderRadius: lib.radius.pill, overflow: 'hidden' } },
						el('div', {
							style: {
								width: 'calc({num} * 54px)',
								maxWidth: '100%',
								height: '100%',
								borderRadius: lib.radius.pill,
								background: lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid)
							}
						})
					)
				),
				text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, lineHeight: 1.35 }, '{question}'),
				stack(
					{ gap: '8px' },
					el('div', { style: answerBase }, answerLetter('A'), 'Each product team'),
					el(
						'div',
						{
							style: {
								...answerBase,
								borderColor: toneMap(lib, (palette) => palette.solid),
								background: toneMap(lib, (palette) => palette.soft),
								color: toneMap(lib, (palette) => palette.onSoft),
								boxShadow: lib.focusRing
							}
						},
						answerLetter('B'),
						'The component library'
					),
					el(
						'div',
						{
							style: merge(
								answerBase,
								iff('reveal', {
									borderColor: lib.palette.success.solid,
									background: lib.palette.success.soft,
									color: lib.palette.success.onSoft
								})
							)
						},
						answerLetter('C'),
						'A shared token source',
						iff('reveal', el('span', { style: { marginLeft: 'auto', display: 'inline-flex' } }, icons.check(14, lib.palette.success.solid)))
					)
				),
				row({ justifyContent: 'flex-end' }, el('button', { type: 'button', style: actionButton(lib) }, 'Next'))
			)
		});

		const signatureColumn = (topNode, label) =>
			stack(
				{ flex: 1, gap: '4px', alignItems: 'center' },
				topNode,
				el('div', { style: { width: '100%', borderTop: `1px solid ${lib.border}` } }),
				text({ fontSize: lib.fontSize.xs, color: lib.faint, textTransform: 'uppercase', letterSpacing: '0.08em' }, label)
			);

		const certificate = define({
			slug: `${lib.id}-education-certificate`,
			name: 'Completion Certificate',
			library: lib.id,
			category: 'learning',
			description: `Certificate of completion in the ${lib.label} style — bordered card with an inner hairline frame, laurel flourish, letterspaced heading, script-large recipient name, and a signature/date line pair.`,
			tags: ['education', 'certificate', 'award', 'completion'],
			args: [
				stringArg('name', 'Alex Morgan', { label: 'Recipient', maxLength: 40 }),
				stringArg('course', 'Modern Web Architecture', { label: 'Course', maxLength: 60 }),
				stringArg('date', '17 Aug 2026', { label: 'Date', maxLength: 24 }),
				toneArg()
			],
			render: el(
				'div',
				{ style: card(lib, { width: '320px', padding: '10px', textAlign: 'center' }) },
				stack(
					{
						alignItems: 'center',
						gap: '8px',
						padding: '20px 18px 16px',
						border: `1px ${lib.id === 'reactflow' ? 'dashed' : 'solid'} ${lib.borderSoft}`,
						borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm
					},
					lib.id === 'thingtime'
						? el('div', { style: { width: '48px', height: '3px', borderRadius: lib.radius.pill, background: lib.rainbow } })
						: null,
					laurelIcon(30, toneMap(lib, (palette) => palette.solid)),
					text(
						{
							fontSize: lib.fontSize.xs,
							fontWeight: lib.headingWeight,
							letterSpacing: '0.22em',
							textTransform: 'uppercase',
							color: toneMap(lib, (palette) => palette.onSoft)
						},
						'Certificate of Completion'
					),
					text({ fontSize: '26px', fontStyle: 'italic', fontWeight: lib.headingWeight, lineHeight: 1.2 }, '{name}'),
					text({ fontSize: lib.fontSize.sm, color: lib.muted }, 'for completing {course}'),
					row(
						{ gap: '24px', width: '100%', marginTop: '12px' },
						signatureColumn(text({ fontSize: lib.fontSize.sm, fontStyle: 'italic' }, 'E. Hartley'), 'Instructor'),
						signatureColumn(text({ fontSize: lib.fontSize.sm, fontStyle: 'italic' }, '{date}'), 'Date')
					)
				)
			)
		});

		const accent = railAccent(lib);
		const dotBase = { width: '16px', height: '16px', borderRadius: '999px', borderWidth: '2px', borderStyle: 'solid', boxSizing: 'border-box', flexShrink: 0 };
		const doneDot = { background: accent, borderColor: accent };
		const currentDot = { background: lib.surface, borderColor: accent, boxShadow: lib.focusRing };
		const upcomingDot = { background: lib.surface, borderColor: lib.border };

		const railCell = (dotStyle, connectorBg) =>
			stack(
				{ alignItems: 'center', gap: '4px', width: '16px', flexShrink: 0 },
				el('div', { style: merge(dotBase, dotStyle) }),
				connectorBg ? el('div', { style: { width: '2px', height: '24px', borderRadius: '2px', background: connectorBg } }) : null
			);

		const milestoneBody = (titleStyle, title, xp) =>
			row(
				{ flex: 1, justifyContent: 'space-between', gap: '8px', minHeight: '16px' },
				text({ fontSize: lib.fontSize.sm, ...titleStyle }, title),
				chip(lib, { background: lib.surfaceAlt, color: lib.muted }, xp)
			);

		const path = define({
			slug: `${lib.id}-education-path`,
			name: 'Learning Path',
			library: lib.id,
			category: 'learning',
			description: `Learning path in the ${lib.label} style — four milestone dots on a vertical rail with filled connectors, done/current/upcoming states, milestone titles with XP chips, and a progress caption.`,
			tags: ['education', 'path', 'milestones', 'progress'],
			args: [
				enumArg('done', ['1', '2', '3'], '2', { label: 'Milestones done' }),
				stringArg('step1', 'HTML & CSS basics', { label: 'Milestone 1', maxLength: 40 }),
				stringArg('step2', 'JavaScript deep dive', { label: 'Milestone 2', maxLength: 40 }),
				stringArg('step3', 'Component patterns', { label: 'Milestone 3', maxLength: 40 }),
				stringArg('step4', 'Capstone project', { label: 'Milestone 4', maxLength: 40 })
			],
			render: el(
				'div',
				{ style: card(lib, { width: '300px', padding: '16px' }) },
				row(
					{ justifyContent: 'space-between', gap: '8px', marginBottom: '14px' },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, 'Learning path'),
					text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.muted }, '{done} of 4 complete')
				),
				stack(
					{},
					row(
						{ gap: '12px', alignItems: 'flex-start' },
						railCell(doneDot, accent),
						milestoneBody({ color: lib.muted }, '{step1}', '+50 XP')
					),
					row(
						{ gap: '12px', alignItems: 'flex-start' },
						railCell(map('done', { 1: currentDot }, doneDot), map('done', { 1: lib.borderSoft }, accent)),
						milestoneBody({ fontWeight: map('done', { 1: 700 }, 500), color: map('done', { 1: lib.text }, lib.muted) }, '{step2}', '+75 XP')
					),
					row(
						{ gap: '12px', alignItems: 'flex-start' },
						railCell(map('done', { 2: currentDot, 3: doneDot }, upcomingDot), map('done', { 3: accent }, lib.borderSoft)),
						milestoneBody({ fontWeight: map('done', { 2: 700 }, 500), color: map('done', { 2: lib.text, 3: lib.muted }, lib.faint) }, '{step3}', '+100 XP')
					),
					row(
						{ gap: '12px', alignItems: 'flex-start' },
						railCell(map('done', { 3: currentDot }, upcomingDot), null),
						milestoneBody({ fontWeight: map('done', { 3: 700 }, 500), color: map('done', { 3: lib.text }, lib.faint) }, '{step4}', '+150 XP')
					)
				)
			)
		});

		return [course, curriculum, quiz, certificate, path];
	}
};
