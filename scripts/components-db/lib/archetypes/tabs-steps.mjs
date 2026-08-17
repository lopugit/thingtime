// Tabs & Steps archetype — tab rows and progress steppers.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-tabs-steps-<variant>`.

import {
	define,
	el,
	enumArg,
	icons,
	ifEq,
	map,
	merge,
	row,
	stack,
	stringArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

const CATEGORY = 'navigation';

// Tab-label type treatment (uppercase only where the library does it — MUI).
const tabType = (lib) => ({
	fontFamily: lib.font,
	fontWeight: Math.max(lib.buttonWeight, 500),
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
});

const buttonReset = {
	border: 'none',
	background: 'transparent',
	cursor: 'pointer',
	padding: 0,
	margin: 0
};

const tabArgs = () => [
	stringArg('tab1', 'Overview', { label: 'Tab 1', maxLength: 24 }),
	stringArg('tab2', 'Activity', { label: 'Tab 2', maxLength: 24 }),
	stringArg('tab3', 'Settings', { label: 'Tab 3', maxLength: 24 }),
	enumArg('active', ['1', '2', '3'], '1', { label: 'Active tab' }),
	toneArg()
];

const stepArgs = () => [
	stringArg('step1', 'Account', { label: 'Step 1', maxLength: 24 }),
	stringArg('step2', 'Profile', { label: 'Step 2', maxLength: 24 }),
	stringArg('step3', 'Finish', { label: 'Step 3', maxLength: 24 }),
	enumArg('current', ['1', '2', '3'], '2', { label: 'Current step' }),
	toneArg()
];

// Pick a template branch for step `index` (1-based) from the `current` enum:
// steps before `current` are done, the `current` one active, the rest upcoming.
const stepPhase = (index, { done, active, upcoming }) =>
	map(
		'current',
		Object.fromEntries(
			['1', '2', '3'].map((cur) => [cur, Number(cur) > index ? done : Number(cur) === index ? active : upcoming])
		),
		upcoming
	);

// Connector line after step `afterIndex` — lit once that step is done.
// React Flow gets its dashed-edge personality; everyone else a solid rail.
const connector = (lib, afterIndex) => {
	const fill = stepPhase(afterIndex, {
		done: toneMap(lib, (palette) => palette.solid),
		active: lib.borderSoft,
		upcoming: lib.borderSoft
	});
	return el('div', {
		style:
			lib.id === 'reactflow'
				? { flex: 1, height: '0px', borderTopWidth: '2px', borderTopStyle: 'dashed', borderTopColor: fill, margin: '0 6px' }
				: { flex: 1, height: '2px', borderRadius: lib.radius.pill, background: fill, margin: '0 6px' }
	});
};

const underlineTab = (lib, index) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				...buttonReset,
				...tabType(lib),
				display: 'inline-flex',
				flexDirection: 'column',
				alignItems: 'center',
				fontSize: lib.fontSize.md,
				marginBottom: '-1px',
				color: ifEq('active', String(index), toneMap(lib, (palette) => palette.solid), lib.muted)
			}
		},
		el('span', { style: { padding: '9px 2px' } }, `{tab${index}}`),
		el('div', {
			style: {
				height: lib.id === 'thingtime' ? '3px' : '2px',
				width: '100%',
				borderRadius: lib.radius.pill,
				background: ifEq(
					'active',
					String(index),
					lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid),
					'transparent'
				)
			}
		})
	);

const pillTab = (lib, index) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				...buttonReset,
				...tabType(lib),
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				height: lib.control.sm,
				padding: '0 14px',
				fontSize: lib.fontSize.sm,
				borderRadius: lib.radius.pill,
				background: ifEq('active', String(index), toneMap(lib, (palette) => palette.solid), 'transparent'),
				color: ifEq('active', String(index), toneMap(lib, (palette) => palette.onSolid), lib.muted),
				boxShadow: ifEq('active', String(index), lib.shadow.sm, 'none')
			}
		},
		`{tab${index}}`
	);

const segmentedTab = (lib, index) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				...buttonReset,
				...tabType(lib),
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				height: lib.control.sm,
				padding: '0 14px',
				fontSize: lib.fontSize.sm,
				borderRadius: lib.id === 'daisyui' ? lib.radius.pill : lib.radius.sm,
				background: ifEq('active', String(index), lib.surface, 'transparent'),
				color: ifEq('active', String(index), toneMap(lib, (palette) => palette.solid), lib.muted),
				boxShadow: ifEq('active', String(index), lib.shadow.sm, 'none')
			}
		},
		`{tab${index}}`
	);

const stepGroup = (lib, index) =>
	row(
		{ gap: '8px' },
		el(
			'div',
			{
				style: merge(
					{
						width: '28px',
						height: '28px',
						borderRadius: lib.radius.pill,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						flexShrink: 0,
						boxSizing: 'border-box'
					},
					stepPhase(index, {
						done: {
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid)
						},
						active: {
							background: toneMap(lib, (palette) => palette.soft),
							border: toneMap(lib, (palette) => `2px solid ${palette.solid}`)
						},
						upcoming: { background: lib.surface, border: `2px solid ${lib.borderSoft}` }
					})
				)
			},
			stepPhase(index, {
				done: icons.check(14, 'currentColor'),
				active: el('div', {
					style: { width: '8px', height: '8px', borderRadius: '999px', background: toneMap(lib, (palette) => palette.solid) }
				}),
				upcoming: el('div', { style: { width: '8px', height: '8px', borderRadius: '999px', background: lib.faint } })
			})
		),
		el(
			'span',
			{
				style: merge(
					{ fontFamily: lib.font, fontSize: lib.fontSize.sm, fontWeight: 500 },
					stepPhase(index, {
						done: { color: lib.muted },
						active: { color: lib.text, fontWeight: 600 },
						upcoming: { color: lib.faint }
					})
				)
			},
			`{step${index}}`
		)
	);

const STEP_DESCRIPTIONS = ['Tell us the basics', 'Configure the details', 'Review and launch'];

const numberedStep = (lib, index) =>
	row(
		{ gap: '10px', alignItems: 'flex-start' },
		el(
			'div',
			{
				style: merge(
					{
						width: '30px',
						height: '30px',
						borderRadius: lib.radius.pill,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						flexShrink: 0,
						boxSizing: 'border-box',
						fontFamily: lib.font,
						fontSize: lib.fontSize.sm,
						fontWeight: 600
					},
					stepPhase(index, {
						done: {
							background: toneMap(lib, (palette) => palette.soft),
							color: toneMap(lib, (palette) => palette.onSoft),
							border: toneMap(lib, (palette) => `1px solid ${palette.border}`)
						},
						active: {
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid)
						},
						upcoming: { background: lib.surface, border: `1px solid ${lib.border}`, color: lib.muted }
					})
				)
			},
			String(index)
		),
		stack(
			{ gap: '2px', fontFamily: lib.font },
			el(
				'span',
				{
					style: merge(
						{ fontSize: lib.fontSize.md, fontWeight: lib.headingWeight },
						stepPhase(index, {
							done: { color: lib.text },
							active: { color: lib.text },
							upcoming: { color: lib.muted }
						})
					)
				},
				`{step${index}}`
			),
			el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, STEP_DESCRIPTIONS[index - 1])
		)
	);

const numberedDivider = (lib) =>
	el('div', {
		style:
			lib.id === 'reactflow'
				? { flex: 1, height: '0px', borderTopWidth: '1px', borderTopStyle: 'dashed', borderTopColor: lib.edge, margin: '15px 6px 0' }
				: { flex: 1, height: '1px', background: lib.borderSoft, margin: '15px 6px 0' }
	});

export const archetype = {
	id: 'tabs-steps',
	category: CATEGORY,
	variants: ['underline', 'pills', 'segmented', 'steps', 'steps-numbered'],
	build(lib) {
		const underline = define({
			slug: `${lib.id}-tabs-steps-underline`,
			name: 'Underline Tabs',
			library: lib.id,
			category: CATEGORY,
			description: `Underline tab row in the ${lib.label} style — quiet labels with a tone-colored indicator bar beneath the active tab${lib.id === 'thingtime' ? ' (the house rainbow)' : ''}.`,
			tags: ['tabs', 'navigation', 'underline'],
			args: tabArgs(),
			render: row(
				{ gap: '22px', alignItems: 'flex-end', borderBottom: `1px solid ${lib.border}`, fontFamily: lib.font },
				underlineTab(lib, 1),
				underlineTab(lib, 2),
				underlineTab(lib, 3)
			)
		});

		const pills = define({
			slug: `${lib.id}-tabs-steps-pills`,
			name: 'Pill Tabs',
			library: lib.id,
			category: CATEGORY,
			description: `Pill-shaped tab row in the ${lib.label} style — the active tab fills with the tone color while inactive tabs stay quiet text.`,
			tags: ['tabs', 'navigation', 'pills'],
			args: tabArgs(),
			render: row(
				{ gap: lib.id === 'daisyui' ? '8px' : '6px', fontFamily: lib.font },
				pillTab(lib, 1),
				pillTab(lib, 2),
				pillTab(lib, 3)
			)
		});

		const segmented = define({
			slug: `${lib.id}-tabs-steps-segmented`,
			name: 'Segmented Tabs',
			library: lib.id,
			category: CATEGORY,
			description: `Segmented control in the ${lib.label} style — tabs sit in a tinted track and the active segment lifts onto a raised surface chip.`,
			tags: ['tabs', 'segmented', 'control', 'navigation'],
			args: tabArgs(),
			render: row(
				{
					display: 'inline-flex',
					padding: '3px',
					gap: '2px',
					background: lib.borderSoft,
					border: `1px solid ${lib.borderSoft}`,
					borderRadius: lib.id === 'daisyui' ? lib.radius.pill : lib.radius.md,
					fontFamily: lib.font
				},
				segmentedTab(lib, 1),
				segmentedTab(lib, 2),
				segmentedTab(lib, 3)
			)
		});

		const steps = define({
			slug: `${lib.id}-tabs-steps-steps`,
			name: 'Progress Steps',
			library: lib.id,
			category: CATEGORY,
			description: `Horizontal progress steps in the ${lib.label} style — completed steps collapse to tone-filled check circles joined by connector lines.`,
			tags: ['steps', 'stepper', 'progress', 'navigation'],
			args: stepArgs(),
			render: row(
				{ width: '100%', fontFamily: lib.font },
				stepGroup(lib, 1),
				connector(lib, 1),
				stepGroup(lib, 2),
				connector(lib, 2),
				stepGroup(lib, 3)
			)
		});

		const stepsNumbered = define({
			slug: `${lib.id}-tabs-steps-steps-numbered`,
			name: 'Numbered Steps',
			library: lib.id,
			category: CATEGORY,
			description: `Numbered step list in the ${lib.label} style — circled step numbers with titles and helper descriptions, the current step filled with the tone color.`,
			tags: ['steps', 'stepper', 'numbered', 'onboarding'],
			args: stepArgs(),
			render: row(
				{ width: '100%', alignItems: 'flex-start', fontFamily: lib.font },
				numberedStep(lib, 1),
				numberedDivider(lib),
				numberedStep(lib, 2),
				numberedDivider(lib),
				numberedStep(lib, 3)
			)
		});

		return [underline, pills, segmented, steps, stepsNumbered];
	}
};
