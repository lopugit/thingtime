// Table archetype — real table/thead/tbody markup in five flavors.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-table-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	ifEq,
	iff,
	numberArg,
	repeat,
	stringArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

const CATEGORY = 'data-display';

const PEOPLE = [
	['Ada Lovelace', 'Engineering', 'ada@example.com'],
	['Grace Hopper', 'Research', 'grace@example.com'],
	['Alan Turing', 'Design', 'alan@example.com'],
	['Margaret Hamilton', 'Operations', 'margaret@example.com'],
	['Katherine Johnson', 'Science', 'katherine@example.com']
];

// [task, owner, badge tone, badge label]
const STATUS_ROWS = [
	['Nightly backup', 'Ops', 'success', 'Active'],
	['Invoice sync', 'Finance', 'warning', 'Pending'],
	['Edge deploy', 'Platform', 'danger', 'Failed'],
	['Legacy import', 'Data', 'neutral', 'Archived']
];

const MEMBERS = [
	['Ada Lovelace', 'Pro'],
	['Grace Hopper', 'Team'],
	['Alan Turing', 'Free']
];

// Card shell around every table — Thingtime gets its rainbow topline,
// Untitled its feather shadow, daisyUI its chunky corners, React Flow its
// crisp near-black node border (lib.border already carries it).
const shell = (lib, table) =>
	el(
		'div',
		{
			style: {
				width: '100%',
				overflow: 'hidden',
				boxSizing: 'border-box',
				background: lib.surface,
				border: `1px solid ${lib.border}`,
				borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
				boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none',
				fontFamily: lib.font
			}
		},
		lib.id === 'thingtime' ? el('div', { style: { height: '3px', background: lib.rainbow } }) : null,
		table
	);

const tableEl = (lib, dense, ...children) =>
	el(
		'table',
		{ style: { width: '100%', borderCollapse: 'collapse', fontSize: dense ? lib.fontSize.sm : lib.fontSize.md, color: lib.text } },
		...children
	);

const th = (lib, child, extra = {}) =>
	el(
		'th',
		{
			style: {
				textAlign: 'left',
				padding: '10px 14px',
				fontSize: lib.id === 'untitled' ? lib.fontSize.xs : lib.fontSize.sm,
				fontWeight: lib.headingWeight,
				color: lib.muted,
				background: lib.id === 'antd' || lib.id === 'untitled' ? lib.surfaceAlt : 'transparent',
				borderBottom: `1px solid ${lib.border}`,
				...extra
			}
		},
		child
	);

const td = (lib, child, extra = {}) =>
	el(
		'td',
		{
			style: {
				padding: '9px 14px',
				borderBottom: `1px solid ${lib.borderSoft}`,
				color: lib.text,
				...extra
			}
		},
		child
	);

export const archetype = {
	id: 'table',
	category: CATEGORY,
	variants: ['basic', 'striped', 'badges', 'compact', 'selectable'],
	build(lib) {
		const colBorder = iff('bordered', `1px solid ${lib.borderSoft}`);

		const basic = define({
			slug: `${lib.id}-table-basic`,
			name: 'Basic Table',
			library: lib.id,
			category: CATEGORY,
			description: `Simple data table in the ${lib.label} style — real thead/tbody markup, three text columns, hairline row dividers, and optional column borders.`,
			tags: ['table', 'data', 'rows'],
			args: [
				stringArg('col1', 'Name', { label: 'Column 1', maxLength: 24 }),
				stringArg('col2', 'Team', { label: 'Column 2', maxLength: 24 }),
				stringArg('col3', 'Email', { label: 'Column 3', maxLength: 24 }),
				booleanArg('bordered', false, { label: 'Column borders' })
			],
			render: shell(
				lib,
				tableEl(
					lib,
					false,
					el(
						'thead',
						null,
						el(
							'tr',
							null,
							th(lib, '{col1}', { borderRight: colBorder }),
							th(lib, '{col2}', { borderRight: colBorder }),
							th(lib, '{col3}')
						)
					),
					el(
						'tbody',
						null,
						PEOPLE.slice(0, 4).map(([name, team, email]) =>
							el(
								'tr',
								null,
								td(lib, name, { fontWeight: 500, borderRight: colBorder }),
								td(lib, team, { color: lib.muted, borderRight: colBorder }),
								td(lib, email, { color: lib.muted })
							)
						)
					)
				)
			)
		});

		// Striped: rows written explicitly so backgrounds truly alternate.
		const striped = define({
			slug: `${lib.id}-table-striped`,
			name: 'Striped Table',
			library: lib.id,
			category: CATEGORY,
			description: `Zebra-striped table in the ${lib.label} style — explicitly alternating tone-tinted row backgrounds over real table markup.`,
			tags: ['table', 'striped', 'zebra', 'data'],
			args: [
				stringArg('col1', 'Name', { label: 'Column 1', maxLength: 24 }),
				stringArg('col2', 'Team', { label: 'Column 2', maxLength: 24 }),
				stringArg('col3', 'Email', { label: 'Column 3', maxLength: 24 }),
				toneArg(undefined, 'neutral')
			],
			render: shell(
				lib,
				tableEl(
					lib,
					false,
					el('thead', null, el('tr', null, th(lib, '{col1}'), th(lib, '{col2}'), th(lib, '{col3}'))),
					el(
						'tbody',
						null,
						PEOPLE.map(([name, team, email], index) =>
							el(
								'tr',
								{
									style: {
										background: index % 2 === 1 ? toneMap(lib, (palette) => palette.soft) : 'transparent'
									}
								},
								td(lib, name, { fontWeight: 500, borderBottom: 'none' }),
								td(lib, team, { color: lib.muted, borderBottom: 'none' }),
								td(lib, email, { color: lib.muted, borderBottom: 'none' })
							)
						)
					)
				)
			)
		});

		const badge = (tone, labelText) =>
			el(
				'span',
				{
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						padding: '2px 9px',
						fontSize: lib.fontSize.xs,
						fontWeight: 600,
						lineHeight: '18px',
						borderRadius: iff('pill', lib.radius.pill, lib.radius.xs),
						background: ifEq('badgeStyle', 'solid', lib.palette[tone].solid, lib.palette[tone].soft),
						color: ifEq('badgeStyle', 'solid', lib.palette[tone].onSolid, lib.palette[tone].onSoft),
						border: ifEq('badgeStyle', 'solid', '1px solid transparent', `1px solid ${lib.palette[tone].border}`)
					}
				},
				labelText
			);

		const badges = define({
			slug: `${lib.id}-table-badges`,
			name: 'Badge Table',
			library: lib.id,
			category: CATEGORY,
			description: `Status table in the ${lib.label} style — task rows with a column of tone badges, switchable between soft tints and solid fills.`,
			tags: ['table', 'badges', 'status', 'data'],
			args: [
				stringArg('col1', 'Task', { label: 'Column 1', maxLength: 24 }),
				stringArg('col2', 'Owner', { label: 'Column 2', maxLength: 24 }),
				stringArg('col3', 'Status', { label: 'Column 3', maxLength: 24 }),
				enumArg('badgeStyle', ['soft', 'solid'], 'soft', { label: 'Badge style' }),
				booleanArg('pill', true, { label: 'Pill badges' })
			],
			render: shell(
				lib,
				tableEl(
					lib,
					false,
					el('thead', null, el('tr', null, th(lib, '{col1}'), th(lib, '{col2}'), th(lib, '{col3}'))),
					el(
						'tbody',
						null,
						STATUS_ROWS.map(([task, owner, tone, status]) =>
							el(
								'tr',
								null,
								td(lib, task, { fontWeight: 500 }),
								td(lib, owner, { color: lib.muted }),
								td(lib, badge(tone, status))
							)
						)
					)
				)
			)
		});

		const denseCell = { padding: '5px 10px', fontSize: lib.fontSize.sm };

		const compact = define({
			slug: `${lib.id}-table-compact`,
			name: 'Compact Table',
			library: lib.id,
			category: CATEGORY,
			description: `Dense compact table in the ${lib.label} style — tight paddings, small monospace ids, and an adjustable repeated row count.`,
			tags: ['table', 'compact', 'dense', 'data'],
			args: [
				stringArg('col1', 'ID', { label: 'Column 1', maxLength: 24 }),
				stringArg('col2', 'Description', { label: 'Column 2', maxLength: 24 }),
				stringArg('col3', 'Slot', { label: 'Column 3', maxLength: 24 }),
				numberArg('rows', 6, { label: 'Rows', min: 1, max: 10 })
			],
			render: shell(
				lib,
				tableEl(
					lib,
					true,
					el(
						'thead',
						null,
						el(
							'tr',
							null,
							th(lib, '{col1}', { padding: '7px 10px', fontSize: lib.fontSize.xs }),
							th(lib, '{col2}', { padding: '7px 10px', fontSize: lib.fontSize.xs }),
							th(lib, '{col3}', { padding: '7px 10px', fontSize: lib.fontSize.xs })
						)
					),
					el(
						'tbody',
						null,
						repeat(
							'rows',
							10,
							el(
								'tr',
								null,
								td(lib, '#10{n}', { ...denseCell, fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: lib.muted }),
								td(lib, 'Queued job {n}', denseCell),
								td(lib, '{n} of {rows}', { ...denseCell, color: lib.muted })
							)
						)
					)
				)
			)
		});

		const checkbox = (checkedDsl) =>
			el('input', {
				type: 'checkbox',
				...(checkedDsl === undefined ? {} : { checked: checkedDsl }),
				style: {
					width: '15px',
					height: '15px',
					margin: 0,
					accentColor: toneMap(lib, (palette) => palette.solid),
					display: 'block'
				}
			});

		const selectable = define({
			slug: `${lib.id}-table-selectable`,
			name: 'Selectable Table',
			library: lib.id,
			category: CATEGORY,
			description: `Selectable table in the ${lib.label} style — header checkbox, per-row checkboxes, and a tone-tinted highlight on the selected row.`,
			tags: ['table', 'selectable', 'checkbox', 'data'],
			args: [
				stringArg('col1', 'Member', { label: 'Column 1', maxLength: 24 }),
				stringArg('col2', 'Plan', { label: 'Column 2', maxLength: 24 }),
				enumArg('selected', ['1', '2', '3', 'none'], '2', { label: 'Selected row' }),
				toneArg()
			],
			render: shell(
				lib,
				tableEl(
					lib,
					false,
					el(
						'thead',
						null,
						el(
							'tr',
							null,
							th(lib, checkbox(), { width: '40px', padding: '10px 0 10px 14px' }),
							th(lib, '{col1}'),
							th(lib, '{col2}')
						)
					),
					el(
						'tbody',
						null,
						MEMBERS.map(([name, plan], index) => {
							const idx = String(index + 1);
							return el(
								'tr',
								{ style: { background: ifEq('selected', idx, toneMap(lib, (palette) => palette.soft), 'transparent') } },
								td(lib, checkbox(ifEq('selected', idx, true)), { width: '40px', padding: '9px 0 9px 14px' }),
								td(lib, name, { fontWeight: ifEq('selected', idx, 600, 500) }),
								td(lib, plan, { color: lib.muted })
							);
						})
					)
				)
			)
		});

		return [basic, striped, badges, compact, selectable];
	}
};
