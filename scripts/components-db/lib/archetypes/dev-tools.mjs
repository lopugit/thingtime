// Dev-tools archetype — developer-tooling surfaces in five renditions: a
// commit row with diff stats and a churn strip, a CI pipeline stepper, a dark
// log viewer, environment-variable rows, and a pull-request card. Follows the
// button.mjs exemplar: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs `${lib.id}-dev-tools-<variant>`.

import {
	avatarCircle,
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	map,
	merge,
	row,
	stack,
	stringArg,
	text
} from '../helpers.mjs';

const spacer = () => el('span', { style: { flex: 1 } });

// Two-rect copy glyph (clipboard-ish) — no external assets, allowlisted svg only.
const copyIcon = (size, color) =>
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
		el('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
		el('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
	);

// daisyUI keeps its chunky corners, everyone else the library card radius;
// Material UI cards float on real elevation while the rest whisper.
const cardRadius = (lib) => (lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md);
const cardShadow = (lib) => (lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm);

const card = (lib) => ({
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: cardRadius(lib),
	boxShadow: cardShadow(lib),
	fontFamily: lib.font
});

// Signature accent for "active" dev chrome: React Flow flashes its pink,
// Thingtime winks with its info pink, everyone else uses their primary.
const devAccent = (lib) =>
	lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.primary.solid;

// Dark log panel: React Flow reuses its ink-navy node border, Thingtime its
// house ink, the rest a tokyo-night charcoal (same recipe as the terminal).
const panelBg = (lib) => (lib.id === 'reactflow' ? lib.border : lib.id === 'thingtime' ? lib.ink : '#1a1b26');

const monoChip = (lib, child) =>
	el(
		'span',
		{
			style: {
				fontFamily: lib.fontMono,
				fontSize: lib.fontSize.xs,
				color: lib.id === 'reactflow' ? lib.accent : lib.text,
				background: lib.surfaceAlt,
				padding: '2px 8px',
				borderRadius: lib.radius.xs,
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: lib.borderSoft,
				flexShrink: 0
			}
		},
		child
	);

const churnSquare = (color) =>
	el('span', { style: { width: '8px', height: '8px', borderRadius: '2px', background: color } });

const statusDot = (color) =>
	el('span', { style: { width: '8px', height: '8px', borderRadius: '999px', background: color, flexShrink: 0 } });

const PIPELINE_STAGES = ['Build', 'Test', 'Deploy', 'Verify'];

export const archetype = {
	id: 'dev-tools',
	category: 'developer',
	variants: ['diff-stat', 'pipeline', 'logs', 'env-vars', 'pr-card'],
	build(lib) {
		const diffStat = define({
			slug: `${lib.id}-dev-tools-diff-stat`,
			name: 'Commit Diff Stat',
			library: lib.id,
			category: 'developer',
			description: `Commit row in the ${lib.label} style — monospace short-hash chip, subject line with author and time caption, +/− diff counters in the library's success and danger inks, and a five-square churn strip.`,
			tags: ['developer', 'commit', 'diff', 'git', 'changelog'],
			args: [
				stringArg('hash', 'f3a92c1', { label: 'Short hash', maxLength: 12 }),
				stringArg('message', 'Fix flaky pipeline retry logic', { label: 'Commit message', maxLength: 60 }),
				stringArg('author', 'nikolaj', { label: 'Author', maxLength: 24 }),
				stringArg('time', '2h ago', { label: 'Time', maxLength: 16 }),
				stringArg('added', '128', { label: 'Lines added', maxLength: 6 }),
				stringArg('removed', '41', { label: 'Lines removed', maxLength: 6 })
			],
			render: el(
				'div',
				{
					style: {
						...card(lib),
						display: 'flex',
						alignItems: 'center',
						gap: '12px',
						padding: '12px 16px',
						minWidth: '360px'
					}
				},
				monoChip(lib, '{hash}'),
				stack(
					{ gap: '2px', flex: 1, minWidth: 0 },
					text(
						{
							fontSize: lib.fontSize.sm,
							fontWeight: 600,
							color: lib.text,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis'
						},
						'{message}'
					),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{author} · {time}')
				),
				text(
					{ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, fontWeight: 700, color: lib.palette.success.onSoft },
					'+{added}'
				),
				text(
					{ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, fontWeight: 700, color: lib.palette.danger.onSoft },
					'−{removed}'
				),
				row(
					{ gap: '2px', flexShrink: 0 },
					churnSquare(lib.palette.success.solid),
					churnSquare(lib.palette.success.solid),
					churnSquare(lib.palette.success.solid),
					churnSquare(lib.palette.danger.solid),
					churnSquare(lib.borderSoft)
				)
			)
		});

		// --- pipeline ---------------------------------------------------------
		// Per-stage state comes from a compact ttMap over the current-stage enum:
		// list only the minority states, let `default` carry the rest.
		const passedCircle = el(
			'div',
			{
				style: {
					width: '28px',
					height: '28px',
					borderRadius: '999px',
					background: lib.palette.success.solid,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center'
				}
			},
			icons.check(14, lib.palette.success.onSolid)
		);
		const runningCircle = el(
			'svg',
			{ width: 28, height: 28, viewBox: '0 0 28 28', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
			el('circle', { cx: 14, cy: 14, r: 11, fill: 'none', stroke: lib.borderSoft, strokeWidth: 3 }),
			el('circle', {
				cx: 14,
				cy: 14,
				r: 11,
				fill: 'none',
				stroke: devAccent(lib),
				strokeWidth: 3,
				strokeLinecap: 'round',
				style: { strokeDasharray: '52 18', transform: 'rotate(-90deg)', transformOrigin: '14px 14px' }
			})
		);
		const pendingCircle = el(
			'div',
			{
				style: {
					width: '28px',
					height: '28px',
					borderRadius: '999px',
					background: lib.surface,
					borderWidth: '2px',
					borderStyle: 'solid',
					borderColor: lib.borderSoft,
					boxSizing: 'border-box',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center'
				}
			},
			el('span', {
				style: {
					width: '6px',
					height: '6px',
					borderRadius: '999px',
					background: lib.id === 'reactflow' ? lib.dot : lib.faint
				}
			})
		);
		const stageCircles = [
			map('stage', { Build: runningCircle }, passedCircle),
			map('stage', { Build: pendingCircle, Test: runningCircle }, passedCircle),
			map('stage', { Deploy: runningCircle, Verify: passedCircle }, pendingCircle),
			map('stage', { Verify: runningCircle }, pendingCircle)
		];
		const stageCell = (index) =>
			stack(
				{ alignItems: 'center', gap: '6px', width: '58px', flexShrink: 0 },
				stageCircles[index],
				text(
					{ fontSize: lib.fontSize.xs, fontWeight: 500, color: map('stage', { [PIPELINE_STAGES[index]]: lib.text }, lib.muted) },
					PIPELINE_STAGES[index]
				)
			);
		const rail = (colorMap) =>
			el('div', { style: { flex: 1, height: '2px', marginTop: '13px', background: colorMap } });

		const pipeline = define({
			slug: `${lib.id}-dev-tools-pipeline`,
			name: 'CI Pipeline',
			library: lib.id,
			category: 'developer',
			description: `CI pipeline stepper in the ${lib.label} style — Build, Test, Deploy and Verify stage nodes joined by connector rails: solid success checks behind the current stage's ${lib.id === 'reactflow' ? 'signature-pink' : 'accent'} spinner arc, muted dots ahead, plus a duration caption.`,
			tags: ['developer', 'pipeline', 'ci', 'stages', 'progress'],
			args: [
				stringArg('label', 'Deploy pipeline', { label: 'Pipeline name', maxLength: 40 }),
				enumArg('stage', PIPELINE_STAGES, 'Deploy', { label: 'Current stage' }),
				stringArg('duration', '3m 42s', { label: 'Duration', maxLength: 16 })
			],
			render: stack(
				{ ...card(lib), padding: '14px 16px', gap: '14px', minWidth: '340px' },
				row(
					{ gap: '8px' },
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: lib.text }, '{label}'),
					spacer(),
					row({ gap: '5px', color: lib.muted, fontSize: lib.fontSize.xs }, icons.clock(12, 'currentColor'), '{duration}')
				),
				row(
					{ alignItems: 'flex-start' },
					stageCell(0),
					rail(map('stage', { Build: lib.borderSoft }, lib.palette.success.solid)),
					stageCell(1),
					rail(map('stage', { Build: lib.borderSoft, Test: lib.borderSoft }, lib.palette.success.solid)),
					stageCell(2),
					rail(map('stage', { Verify: lib.palette.success.solid }, lib.borderSoft)),
					stageCell(3)
				)
			)
		});

		// --- logs -------------------------------------------------------------
		const levelChip = (palette, label) =>
			el(
				'span',
				{
					style: {
						fontSize: lib.fontSize.xs,
						fontWeight: 700,
						padding: '1px 6px',
						borderRadius: lib.radius.xs,
						background: palette.solid,
						color: palette.onSolid,
						flexShrink: 0
					}
				},
				label
			);
		const logLine = (ts, palette, level, message, highlight) =>
			el(
				'div',
				{
					style: {
						display: 'flex',
						alignItems: 'center',
						gap: '8px',
						padding: '3px 12px',
						...(highlight
							? {
									background: 'rgba(255, 255, 255, 0.08)',
									borderLeftWidth: '2px',
									borderLeftStyle: 'solid',
									borderLeftColor: devAccent(lib),
									paddingLeft: '10px'
								}
							: {})
					}
				},
				iff('timestamps', el('span', { style: { color: 'rgba(255, 255, 255, 0.35)', flexShrink: 0 } }, ts)),
				levelChip(palette, level),
				el('span', { style: { color: 'rgba(255, 255, 255, 0.85)', whiteSpace: 'nowrap' } }, message)
			);
		const filterChip = (label, active) =>
			el(
				'span',
				{
					style: {
						padding: '3px 10px',
						borderRadius: lib.radius.pill,
						fontSize: lib.fontSize.xs,
						fontWeight: 600,
						...(active
							? { background: devAccent(lib), color: lib.palette.primary.onSolid }
							: {
									background: lib.surfaceAlt,
									color: lib.muted,
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: lib.borderSoft
								})
					}
				},
				label
			);

		const logs = define({
			slug: `${lib.id}-dev-tools-logs`,
			name: 'Log Viewer',
			library: lib.id,
			category: 'developer',
			description: `Log viewer in the ${lib.label} style — a filter chip row over a dark monospace panel of INFO, WARN and ERROR lines with level chips and timestamps, the matching line highlighted with the library's ${lib.id === 'reactflow' ? 'signature pink' : 'accent'} rail.`,
			tags: ['developer', 'logs', 'console', 'monitoring', 'filter'],
			args: [
				stringArg('service', 'api-server', { label: 'Service', maxLength: 24 }),
				stringArg('filter', 'payments', { label: 'Active filter', maxLength: 20 }),
				booleanArg('timestamps', true, { label: 'Show timestamps' })
			],
			render: stack(
				{ ...card(lib), overflow: 'hidden', minWidth: '380px' },
				row(
					{ gap: '6px', padding: '10px 12px' },
					text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: lib.muted }, '{service}'),
					spacer(),
					filterChip('all', false),
					filterChip('{filter}', true),
					filterChip('errors', false)
				),
				stack(
					{ background: panelBg(lib), padding: '10px 0', fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, lineHeight: 1.6 },
					logLine('14:02:31', lib.palette.info, 'INFO', 'GET /api/v1/things 200 in 84 ms', false),
					logLine('14:02:32', lib.palette.info, 'INFO', 'cache warmed for feed', false),
					logLine('14:02:33', lib.palette.warning, 'WARN', 'retry scheduled (attempt 2)', false),
					logLine('14:02:34', lib.palette.danger, 'ERROR', '{filter}: connection reset — restarting', true),
					logLine('14:02:35', lib.palette.info, 'INFO', 'worker restarted cleanly', false)
				)
			)
		});

		// --- env-vars ---------------------------------------------------------
		const keyStyle = {
			fontFamily: lib.fontMono,
			fontSize: lib.fontSize.sm,
			fontWeight: 600,
			color: lib.text,
			minWidth: '150px',
			flexShrink: 0
		};
		const valueStyle = {
			fontFamily: lib.fontMono,
			fontSize: lib.fontSize.xs,
			color: lib.muted,
			flex: 1,
			whiteSpace: 'nowrap',
			overflow: 'hidden',
			textOverflow: 'ellipsis'
		};
		const scopeChipBase = {
			fontSize: lib.fontSize.xs,
			fontWeight: 600,
			padding: '2px 8px',
			borderRadius: lib.radius.pill,
			flexShrink: 0
		};
		const scopeChip = (palette, label) =>
			el('span', { style: { ...scopeChipBase, background: palette.soft, color: palette.onSoft } }, label);
		const copyGhost = row(
			{
				gap: '4px',
				color: lib.muted,
				fontSize: lib.fontSize.xs,
				cursor: 'pointer',
				flexShrink: 0,
				...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
			},
			copyIcon(12, 'currentColor'),
			'Copy'
		);
		const envRowStyle = (first) => ({
			gap: '12px',
			padding: '10px 14px',
			...(first ? {} : { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft })
		});

		const envVars = define({
			slug: `${lib.id}-dev-tools-env-vars`,
			name: 'Environment Variables',
			library: lib.id,
			category: 'developer',
			description: `Environment-variable rows in the ${lib.label} style — monospace KEY names with masked dot values (the first revealable), Production and Preview scope chips, quiet copy ghosts, and a dashed add-variable row.`,
			tags: ['developer', 'env', 'secrets', 'settings', 'config'],
			args: [
				stringArg('name', 'DATABASE_URL', { label: 'Variable name', maxLength: 32 }),
				stringArg('value', 'postgres://cluster-syd.internal:5432/app', { label: 'Value', maxLength: 60 }),
				booleanArg('revealed', true, { label: 'Reveal first value' }),
				enumArg('scope', ['Production', 'Preview'], 'Production', { label: 'First row scope' })
			],
			render: stack(
				{ ...card(lib), overflow: 'hidden', minWidth: '400px' },
				row(
					envRowStyle(true),
					text(keyStyle, '{name}'),
					text(valueStyle, iff('revealed', '{value}', '••••••••')),
					el(
						'span',
						{
							style: merge(
								scopeChipBase,
								map('scope', {
									Production: { background: lib.palette.primary.soft, color: lib.palette.primary.onSoft },
									Preview: { background: lib.palette.neutral.soft, color: lib.palette.neutral.onSoft }
								})
							)
						},
						'{scope}'
					),
					copyGhost
				),
				row(
					envRowStyle(false),
					text(keyStyle, 'STRIPE_SECRET_KEY'),
					text(valueStyle, '••••••••'),
					scopeChip(lib.palette.primary, 'Production'),
					copyGhost
				),
				row(
					envRowStyle(false),
					text(keyStyle, 'FEATURE_FLAGS_URL'),
					text(valueStyle, '••••••••'),
					scopeChip(lib.palette.neutral, 'Preview'),
					copyGhost
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							gap: '6px',
							margin: '10px 14px 14px',
							padding: '9px 0',
							borderWidth: '1px',
							borderStyle: 'dashed',
							borderColor: lib.border,
							borderRadius: lib.radius.sm,
							color: lib.muted,
							fontSize: lib.fontSize.sm,
							fontWeight: 500,
							cursor: 'pointer'
						}
					},
					icons.plus(14, 'currentColor'),
					'Add variable'
				)
			)
		});

		// --- pr-card ----------------------------------------------------------
		const branchChip = (child) =>
			el(
				'span',
				{
					style: {
						fontFamily: lib.fontMono,
						fontSize: lib.fontSize.xs,
						padding: '2px 8px',
						borderRadius: lib.radius.xs,
						background: lib.palette.primary.soft,
						color: lib.palette.primary.onSoft
					}
				},
				child
			);
		const checkItem = (color, label) =>
			row({ gap: '5px' }, statusDot(color), text({ fontSize: lib.fontSize.xs, color: lib.muted }, label));
		const reviewer = (initials, overlap) =>
			avatarCircle('24px', lib.palette.info.soft, lib.palette.info.onSoft, initials, lib.fontSize.xs, {
				borderWidth: '2px',
				borderStyle: 'solid',
				borderColor: lib.surface,
				boxSizing: 'content-box',
				...(overlap ? { marginLeft: '-8px' } : {})
			});

		const prCard = define({
			slug: `${lib.id}-dev-tools-pr-card`,
			name: 'Pull Request Card',
			library: lib.id,
			category: 'developer',
			description: `Pull-request card in the ${lib.label} style — numbered title with an Open chip, monospace branch chips joined by an arrow, status-check dots with captions, reviewer avatars beside an approved chip, and a ${lib.uppercaseButtons ? 'uppercase ' : ''}merge button that disables until checks are ready${lib.id === 'thingtime' ? ', capped with the house rainbow strip' : ''}.`,
			tags: ['developer', 'pull-request', 'review', 'git', 'merge'],
			args: [
				stringArg('number', '482', { label: 'PR number', maxLength: 8 }),
				stringArg('title', 'Add schema drawer components', { label: 'Title', maxLength: 60 }),
				stringArg('branch', 'feat/schema-drawer', { label: 'Source branch', maxLength: 32 }),
				booleanArg('ready', true, { label: 'Ready to merge' })
			],
			render: stack(
				{ ...card(lib), overflow: 'hidden', minWidth: '360px' },
				lib.id === 'thingtime' ? el('div', { style: { height: '3px', background: lib.rainbow } }) : null,
				stack(
					{ padding: '14px 16px', gap: '12px' },
					row(
						{ gap: '8px', alignItems: 'flex-start' },
						el(
							'span',
							{
								style: {
									fontSize: lib.fontSize.xs,
									fontWeight: 700,
									padding: '2px 10px',
									borderRadius: lib.radius.pill,
									background: lib.palette.success.soft,
									color: lib.palette.success.onSoft,
									flexShrink: 0
								}
							},
							'Open'
						),
						el(
							'div',
							{ style: { fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, color: lib.text, lineHeight: 1.4 } },
							el('span', { style: { color: lib.muted, fontWeight: 500 } }, '#{number} '),
							'{title}'
						)
					),
					row({ gap: '6px' }, branchChip('{branch}'), icons.arrowRight(12, lib.faint), branchChip('main')),
					row(
						{ gap: '14px' },
						checkItem(lib.palette.success.solid, 'build'),
						checkItem(lib.palette.success.solid, 'tests'),
						checkItem(lib.id === 'reactflow' ? lib.dot : lib.palette.warning.solid, 'deploy · queued')
					),
					row(
						{ gap: '8px' },
						reviewer('NK', false),
						reviewer('AR', true),
						row(
							{ gap: '4px', color: lib.palette.success.onSoft, fontSize: lib.fontSize.xs, fontWeight: 600 },
							icons.check(12, 'currentColor'),
							'Approved'
						),
						spacer(),
						el(
							'button',
							{
								type: 'button',
								style: merge(
									{
										display: 'inline-flex',
										alignItems: 'center',
										justifyContent: 'center',
										gap: '6px',
										height: lib.control.sm,
										padding: '0 14px',
										border: 'none',
										borderRadius: lib.radius.sm,
										fontFamily: lib.font,
										fontWeight: lib.buttonWeight,
										fontSize: lib.fontSize.sm,
										...(lib.uppercaseButtons
											? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing }
											: {})
									},
									iff(
										'ready',
										{
											background: lib.palette.success.solid,
											color: lib.palette.success.onSolid,
											boxShadow: lib.shadow.sm,
											cursor: 'pointer'
										},
										{ background: lib.palette.neutral.soft, color: lib.faint, cursor: 'not-allowed' }
									)
								)
							},
							iff('ready', 'Merge pull request', 'Checks pending')
						)
					)
				)
			)
		});

		return [diffStat, pipeline, logs, envVars, prCard];
	}
};
