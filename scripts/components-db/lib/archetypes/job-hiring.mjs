// Job & hiring archetype — hiring surfaces in five renditions: job posting
// card, applicant pipeline row, interview slot card, offer summary, and a
// four-stage hiring funnel. Follows the button.mjs exemplar: exactly 5
// variants, `build(lib)` returns exactly 5 definitions (one per variant,
// same order), slugs `${lib.id}-job-hiring-<variant>`.

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
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Card chrome: mui floats on elevation, reactflow wears its crisp 0.5px node
// ring, daisyui rounds up chunky, everyone else keeps a quiet 1px border.
const card = (lib, width) => ({
	width,
	boxSizing: 'border-box',
	padding: '16px',
	gap: '12px',
	fontFamily: lib.font,
	color: lib.text,
	background: lib.surface,
	borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.id === 'mui' || lib.id === 'reactflow' ? 'transparent' : lib.border,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.id === 'reactflow' ? lib.shadow.lg : lib.shadow.sm
});

const btnBase = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '6px',
	height: lib.control.sm,
	padding: '0 14px',
	border: 'none',
	borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
	fontFamily: lib.font,
	fontWeight: lib.buttonWeight,
	fontSize: lib.fontSize.sm,
	cursor: 'pointer',
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

const toneBtn = (lib, label) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				...btnBase(lib),
				flex: '1',
				background: toneMap(lib, (palette) => palette.solid),
				color: toneMap(lib, (palette) => palette.onSolid),
				boxShadow: lib.shadow.sm
			}
		},
		label
	);

const ghostBtn = (lib, color, ...children) =>
	el('button', { type: 'button', style: { ...btnBase(lib), background: 'transparent', color } }, ...children);

const chipStyle = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '4px',
	padding: '2px 8px',
	borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
	fontSize: lib.fontSize.xs,
	fontWeight: 600,
	lineHeight: 1.6
});

const captionStyle = (lib) => ({ fontSize: lib.fontSize.xs, color: lib.muted });

// Video-camera glyph for the meet-link chip (allowlisted svg shapes only).
const videoIcon = (size, color) =>
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
		el('rect', { x: 1, y: 6, width: 13, height: 12, rx: 2 }),
		el('polygon', { points: '23 7 16 12 23 17' })
	);

export const archetype = {
	id: 'job-hiring',
	category: 'hiring',
	variants: ['job-card', 'applicant', 'interview', 'offer', 'funnel'],
	build(lib) {
		// thingtime wears its rainbow on the logo tile; reactflow goes crisp ink.
		const logoBg = lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.palette.primary.solid : lib.palette.primary.soft;
		const logoColor =
			lib.id === 'thingtime' ? '#ffffff' : lib.id === 'reactflow' ? lib.palette.primary.onSolid : lib.palette.primary.onSoft;

		const jobCard = define({
			slug: `${lib.id}-job-hiring-job-card`,
			name: 'Job Posting Card',
			library: lib.id,
			category: 'hiring',
			description: `Job posting card in the ${lib.label} style — initials logo tile, role and company header, Remote/Full-time/salary chips, posted-ago caption, and Apply plus Save actions${lib.id === 'thingtime' ? ', with the house rainbow on the logo tile' : ''}.`,
			tags: ['hiring', 'job', 'posting', 'card'],
			args: [
				stringArg('role', 'Senior Product Designer', { label: 'Role', maxLength: 48 }),
				stringArg('company', 'Acme Studio', { label: 'Company', maxLength: 32 }),
				stringArg('initials', 'AS', { label: 'Logo initials', maxLength: 3 }),
				stringArg('salary', '$120k–$150k', { label: 'Salary band', maxLength: 20 }),
				stringArg('ago', '3d ago', { label: 'Posted', maxLength: 16 }),
				toneArg()
			],
			render: stack(
				card(lib, '320px'),
				row(
					{ gap: '12px' },
					el(
						'div',
						{
							style: {
								width: '40px',
								height: '40px',
								flexShrink: 0,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.md,
								background: logoBg,
								color: logoColor,
								fontWeight: 700,
								fontSize: lib.fontSize.sm
							}
						},
						'{initials}'
					),
					stack(
						{ gap: '2px', minWidth: 0 },
						text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{role}'),
						text(captionStyle(lib), '{company} · Sydney, AU')
					)
				),
				row(
					{ gap: '6px', flexWrap: 'wrap' },
					el('span', { style: { ...chipStyle(lib), background: lib.surfaceAlt, color: lib.muted } }, 'Remote'),
					el('span', { style: { ...chipStyle(lib), background: lib.surfaceAlt, color: lib.muted } }, 'Full-time'),
					el('span', { style: { ...chipStyle(lib), background: lib.palette.success.soft, color: lib.palette.success.onSoft } }, '{salary}')
				),
				text(captionStyle(lib), 'Posted {ago} · 84 applicants'),
				row({ gap: '8px' }, toneBtn(lib, 'Apply'), ghostBtn(lib, lib.muted, icons.star(14, 'currentColor'), 'Save'))
			)
		});

		// Match-score ring color: reactflow flashes its accent, thingtime winks
		// pink, everyone else reads success.
		const ringColor = lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.success.solid;
		// r=15.9 → circumference ≈ 100, so the stepped dasharray is just `<score> 100`.
		const scoreRing = el(
			'svg',
			{ width: 32, height: 32, viewBox: '0 0 36 36', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
			el('circle', { cx: 18, cy: 18, r: 15.9, stroke: lib.borderSoft, strokeWidth: 3.5 }),
			el('circle', {
				cx: 18,
				cy: 18,
				r: 15.9,
				stroke: ringColor,
				strokeWidth: 3.5,
				strokeLinecap: 'round',
				style: {
					strokeDasharray: map('score', { 40: '40 100', 55: '55 100', 70: '70 100', 85: '85 100', 95: '95 100' }, '70 100'),
					transform: 'rotate(-90deg)',
					transformOrigin: '50% 50%'
				}
			})
		);

		const applicant = define({
			slug: `${lib.id}-job-hiring-applicant`,
			name: 'Applicant Row',
			library: lib.id,
			category: 'hiring',
			description: `Applicant pipeline row in the ${lib.label} style — initials avatar, name with applied caption, stage chip tinted per pipeline stage, a stepped match-score ring, and a shortlist star toggle.`,
			tags: ['hiring', 'applicant', 'candidate', 'pipeline'],
			args: [
				stringArg('name', 'Maya Chen', { label: 'Name', maxLength: 32 }),
				stringArg('initials', 'MC', { label: 'Initials', maxLength: 3 }),
				stringArg('role', 'Product Designer', { label: 'Role', maxLength: 40 }),
				enumArg('stage', ['screening', 'interview', 'offer', 'hired'], 'interview', { label: 'Stage' }),
				enumArg('score', ['40', '55', '70', '85', '95'], '85', { label: 'Match score' }),
				booleanArg('shortlisted', false, { label: 'Shortlisted' })
			],
			render: row(
				{ ...card(lib, '420px'), padding: '12px 14px' },
				avatarCircle('36px', lib.palette.neutral.soft, lib.palette.neutral.onSoft, '{initials}', lib.fontSize.xs),
				stack(
					{ gap: '2px', flex: '1', minWidth: 0 },
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight }, '{name}'),
					text(captionStyle(lib), '{role} · applied 2d ago')
				),
				el(
					'span',
					{
						style: merge(
							{ ...chipStyle(lib), textTransform: 'capitalize', flexShrink: 0 },
							map('stage', {
								screening: { background: lib.palette.info.soft, color: lib.palette.info.onSoft },
								interview: { background: lib.palette.warning.soft, color: lib.palette.warning.onSoft },
								offer: { background: lib.palette.primary.soft, color: lib.palette.primary.onSoft },
								hired: { background: lib.palette.success.soft, color: lib.palette.success.onSoft }
							})
						)
					},
					'{stage}'
				),
				row({ gap: '5px', flexShrink: 0 }, scoreRing, text({ fontSize: lib.fontSize.sm, fontWeight: 700 }, '{score}%')),
				el(
					'button',
					{
						type: 'button',
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: '28px',
							height: '28px',
							padding: '0',
							border: 'none',
							borderRadius: lib.radius.sm,
							background: 'transparent',
							cursor: 'pointer',
							flexShrink: 0
						}
					},
					iff('shortlisted', icons.star(16, lib.palette.warning.solid, true), icons.star(16, lib.faint))
				)
			)
		});

		const monthColor = lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.palette.info.solid : lib.palette.danger.solid;
		const interview = define({
			slug: `${lib.id}-job-hiring-interview`,
			name: 'Interview Slot Card',
			library: lib.id,
			category: 'hiring',
			description: `Interview slot card in the ${lib.label} style — calendar date block, time with a duration chip, interviewer avatar and role caption, meet-link chip with a video glyph, Confirm and Reschedule actions, and a timezone caption.`,
			tags: ['hiring', 'interview', 'schedule', 'card'],
			args: [
				stringArg('day', '24', { label: 'Day', maxLength: 2 }),
				stringArg('time', '10:30 AM', { label: 'Time', maxLength: 12 }),
				stringArg('duration', '45 min', { label: 'Duration', maxLength: 10 }),
				stringArg('interviewer', 'Sam Ortiz', { label: 'Interviewer', maxLength: 32 }),
				toneArg()
			],
			render: stack(
				card(lib, '320px'),
				row(
					{ gap: '12px' },
					stack(
						{
							alignItems: 'center',
							gap: '0px',
							padding: '6px 12px',
							borderRadius: lib.id === 'reactflow' ? lib.radius.sm : lib.radius.md,
							background: lib.surfaceAlt,
							flexShrink: 0
						},
						text({ fontSize: lib.fontSize.xs, fontWeight: 700, letterSpacing: '0.08em', color: monthColor }, 'AUG'),
						text({ fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight, lineHeight: 1.2 }, '{day}')
					),
					stack(
						{ gap: '4px', flex: '1', minWidth: 0 },
						row(
							{ gap: '8px' },
							text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{time}'),
							el('span', { style: { ...chipStyle(lib), background: lib.surfaceAlt, color: lib.muted } }, '{duration}')
						),
						text(captionStyle(lib), 'Technical interview · Round 2')
					)
				),
				row(
					{ gap: '10px' },
					avatarCircle('28px', lib.palette.neutral.soft, lib.palette.neutral.onSoft, 'SO', lib.fontSize.xs),
					stack(
						{ gap: '0px', flex: '1', minWidth: 0 },
						text({ fontSize: lib.fontSize.sm, fontWeight: 600 }, '{interviewer}'),
						text(captionStyle(lib), 'Engineering Manager')
					),
					el(
						'span',
						{ style: { ...chipStyle(lib), background: lib.palette.info.soft, color: lib.palette.info.onSoft, flexShrink: 0 } },
						videoIcon(12, lib.palette.info.onSoft),
						'Meet link'
					)
				),
				row({ gap: '8px' }, toneBtn(lib, 'Confirm'), ghostBtn(lib, lib.muted, 'Reschedule')),
				text(captionStyle(lib), 'All times in GMT+10 · Sydney')
			)
		});

		const compDivider = { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: lib.borderSoft };
		const offer = define({
			slug: `${lib.id}-job-hiring-offer`,
			name: 'Offer Summary Card',
			library: lib.id,
			category: 'hiring',
			description: `Offer summary card in the ${lib.label} style — role header with a level chip, Base/Equity/Bonus compensation rows in the library mono face, a start-date row, an expiry warning banner, and Accept plus Decline actions.`,
			tags: ['hiring', 'offer', 'compensation', 'card'],
			args: [
				stringArg('role', 'Staff Engineer', { label: 'Role', maxLength: 40 }),
				stringArg('level', 'L5', { label: 'Level', maxLength: 6 }),
				stringArg('base', '$185,000', { label: 'Base salary', maxLength: 14 }),
				stringArg('start', 'Oct 6, 2026', { label: 'Start date', maxLength: 16 }),
				stringArg('expires', '5 days', { label: 'Expires in', maxLength: 12 }),
				toneArg()
			],
			render: stack(
				card(lib, '320px'),
				row(
					{ gap: '8px', justifyContent: 'space-between', alignItems: 'flex-start' },
					stack(
						{ gap: '2px', minWidth: 0 },
						text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight }, '{role}'),
						text(captionStyle(lib), 'Full-time · Sydney HQ')
					),
					el(
						'span',
						{ style: { ...chipStyle(lib), background: lib.palette.primary.soft, color: lib.palette.primary.onSoft, flexShrink: 0 } },
						'{level}'
					)
				),
				stack(
					{ gap: '0px' },
					{
						ttRepeat: {
							count: 3,
							max: 3,
							node: row(
								{ justifyContent: 'space-between', gap: '8px', padding: '8px 0', ...compDivider },
								text({ fontSize: lib.fontSize.sm, color: lib.muted }, map('n', { 1: 'Base salary', 2: 'Equity', 3: 'Signing bonus' }, '')),
								text(
									{ fontSize: lib.fontSize.sm, fontWeight: 600, fontFamily: lib.fontMono },
									map('n', { 1: '{base}', 2: '0.25%', 3: '$15,000' }, '')
								)
							)
						}
					},
					row(
						{ justifyContent: 'space-between', gap: '8px', padding: '8px 0', ...compDivider },
						text({ fontSize: lib.fontSize.sm, color: lib.muted }, 'Start date'),
						text({ fontSize: lib.fontSize.sm, fontWeight: 600, fontFamily: lib.fontMono }, '{start}')
					)
				),
				row(
					{ gap: '6px', padding: '6px 10px', borderRadius: lib.radius.sm, background: lib.palette.warning.soft },
					icons.alert(12, lib.palette.warning.onSoft),
					text({ fontSize: lib.fontSize.xs, color: lib.palette.warning.onSoft, fontWeight: 600 }, 'Offer expires in {expires}')
				),
				row({ gap: '8px' }, toneBtn(lib, 'Accept offer'), ghostBtn(lib, lib.palette.danger.solid, 'Decline'))
			)
		});

		const barRadius = lib.id === 'reactflow' ? lib.radius.xs : lib.radius.pill;
		const funnelStage = stack(
			{ gap: '3px' },
			row(
				{ justifyContent: 'space-between', gap: '8px' },
				text({ fontSize: lib.fontSize.xs, fontWeight: 600 }, map('n', { 1: 'Applied', 2: 'Screened', 3: 'Interviewed', 4: 'Offered' }, '')),
				text(
					{ fontSize: lib.fontSize.xs, color: lib.muted, fontFamily: lib.fontMono },
					map('n', { 1: '{applied}', 2: '146', 3: '52', 4: '11' }, '')
				)
			),
			el(
				'div',
				{ style: { height: '10px', borderRadius: barRadius, background: lib.surfaceAlt } },
				el('div', {
					style: {
						height: '10px',
						borderRadius: barRadius,
						width: map('n', { 1: '100%', 2: '62%', 3: '38%', 4: '16%' }, '100%'),
						background: toneMap(lib, (palette) => palette.solid),
						opacity: map('n', { 1: 1, 2: 0.78, 3: 0.58, 4: 0.4 }, 1)
					}
				})
			),
			// Conversion captions live BETWEEN stages: none after the last bar.
			map('n', {
				1: text({ ...captionStyle(lib), paddingLeft: '2px' }, '45% advance to screening'),
				2: text({ ...captionStyle(lib), paddingLeft: '2px' }, '36% advance to interview'),
				3: text({ ...captionStyle(lib), paddingLeft: '2px' }, '21% advance to offer')
			})
		);

		const funnel = define({
			slug: `${lib.id}-job-hiring-funnel`,
			name: 'Hiring Funnel',
			library: lib.id,
			category: 'hiring',
			description: `Hiring funnel in the ${lib.label} style — four stage bars of decreasing width from Applied through Offered, tone-tinted with fading opacity, conversion captions between stages, and a period select mock in the header.`,
			tags: ['hiring', 'funnel', 'pipeline', 'chart'],
			args: [
				stringArg('title', 'Hiring funnel', { label: 'Title', maxLength: 32 }),
				stringArg('applied', '324', { label: 'Applied count', maxLength: 6 }),
				toneArg(),
				enumArg('period', ['Last 30 days', 'Last 90 days', 'This year'], 'Last 30 days', { label: 'Period' })
			],
			render: stack(
				card(lib, '320px'),
				row(
					{ justifyContent: 'space-between', gap: '8px' },
					text({ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight }, '{title}'),
					row(
						{
							gap: '4px',
							padding: '3px 8px',
							borderRadius: lib.radius.sm,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border,
							background: lib.surface,
							fontSize: lib.fontSize.xs,
							color: lib.muted,
							flexShrink: 0
						},
						'{period}',
						icons.chevronDown(12, lib.muted)
					)
				),
				stack({ gap: '8px' }, { ttRepeat: { count: 4, max: 4, node: funnelStage } })
			)
		});

		return [jobCard, applicant, interview, offer, funnel];
	}
};
