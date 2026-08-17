// Form-flows archetype — form COMPOSITION patterns (the input archetypes own
// individual fields; these are flows): a multi-step wizard shell, a
// review-before-submit summary, a conditional-reveal question, a signature
// pad, and a two-column form section. Follows the button.mjs exemplar:
// exactly 5 variants, `build(lib)` returns exactly 5 definitions (one per
// variant, same order), slugs `${lib.id}-form-flows-<variant>`.

import {
	booleanArg,
	define,
	el,
	icons,
	iff,
	merge,
	numberArg,
	row,
	stack,
	stringArg,
	text
} from '../helpers.mjs';

// reactflow flows run on its signature pink accent; everyone else uses the
// library primary.
const accent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.palette.primary.solid);
const accentText = (lib) => (lib.id === 'reactflow' ? '#ffffff' : lib.palette.primary.onSolid);

// thingtime progress wears the house rainbow wink.
const progressFill = (lib) => (lib.id === 'thingtime' ? lib.rainbow : accent(lib));

// antd keeps its famously tight field corners.
const fieldRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.radius.sm);

const headingColor = (lib) => (lib.id === 'thingtime' ? lib.ink : lib.text);

const upper = (lib) =>
	lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {};

// Card shell every flow sits in — untitled gets its feather shadow, mui its
// elevation, reactflow its crisp ink outline (border token IS the ink).
const shell = (lib, width) => ({
	display: 'flex',
	flexDirection: 'column',
	gap: '14px',
	width,
	maxWidth: '100%',
	boxSizing: 'border-box',
	padding: '16px',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.lg,
	fontFamily: lib.font,
	color: lib.text,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
});

const solidBtn = (lib, label, extra = {}) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				height: lib.control.md,
				padding: '0 16px',
				border: 'none',
				borderRadius: lib.radius.md,
				background: accent(lib),
				color: accentText(lib),
				fontFamily: lib.font,
				fontWeight: lib.buttonWeight,
				fontSize: lib.fontSize.md,
				cursor: 'pointer',
				boxShadow: lib.id === 'mui' ? lib.shadow.md : 'none',
				...upper(lib),
				...extra
			}
		},
		label
	);

const ghostBtn = (lib, label, color) =>
	el(
		'button',
		{
			type: 'button',
			style: {
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				height: lib.control.md,
				padding: '0 12px',
				background: 'transparent',
				border: 'none',
				borderRadius: lib.radius.md,
				color,
				fontFamily: lib.font,
				fontWeight: lib.buttonWeight,
				fontSize: lib.fontSize.md,
				cursor: 'pointer',
				...upper(lib)
			}
		},
		label
	);

// Field mock (no real input — placeholder-styled div). mui reads as its
// filled variant, untitled wears a feather shadow, antd keeps 4px corners.
const fieldBox = (lib, hint, height) =>
	el(
		'div',
		{
			style: {
				display: 'flex',
				alignItems: 'center',
				height: height || lib.control.md,
				padding: '0 12px',
				boxSizing: 'border-box',
				background: lib.id === 'mui' ? lib.surfaceAlt : lib.surface,
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: lib.border,
				borderRadius: fieldRadius(lib),
				boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none',
				fontSize: lib.fontSize.md,
				color: lib.faint
			}
		},
		hint
	);

const fieldLabel = (lib, label) => text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text }, label);

const fieldMock = (lib, label, hint) => stack({ gap: '6px' }, fieldLabel(lib, label), fieldBox(lib, hint));

// Square checkbox mock driven by a boolean arg — daisyui gets chunkier corners.
const checkboxMock = (lib, argName) =>
	el(
		'div',
		{
			style: merge(
				{
					width: '18px',
					height: '18px',
					boxSizing: 'border-box',
					borderRadius: lib.id === 'daisyui' ? lib.radius.sm : lib.radius.xs,
					borderWidth: '1px',
					borderStyle: 'solid',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					flexShrink: 0
				},
				iff(
					argName,
					{ background: accent(lib), borderColor: accent(lib) },
					{ background: lib.surface, borderColor: lib.border }
				)
			)
		},
		iff(argName, icons.check(12, accentText(lib)))
	);

const chevronLeft = (size, color) =>
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
		el('polyline', { points: '15 6 9 12 15 18' })
	);

// Radio circle mock: `flip` renders it selected when the boolean arg is FALSE.
const radioMock = (lib, argName, flip) => {
	const on = { borderColor: accent(lib) };
	const off = { borderColor: lib.border };
	const dot = el('div', { style: { width: '8px', height: '8px', borderRadius: '999px', background: accent(lib) } });
	return el(
		'div',
		{
			style: merge(
				{
					width: '16px',
					height: '16px',
					boxSizing: 'border-box',
					borderRadius: '999px',
					borderWidth: '1.5px',
					borderStyle: 'solid',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					flexShrink: 0
				},
				iff(argName, flip ? off : on, flip ? on : off)
			)
		},
		flip ? iff(argName, '', dot) : iff(argName, dot)
	);
};

const kvRow = (lib, k, v) =>
	row(
		{ justifyContent: 'space-between', gap: '12px' },
		text({ fontSize: lib.fontSize.sm, color: lib.muted }, k),
		text({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text, textAlign: 'right' }, v)
	);

const reviewSection = (lib, title, rows) =>
	stack(
		{
			gap: '8px',
			padding: '12px',
			background: lib.surfaceAlt,
			borderRadius: lib.radius.md,
			...(lib.id === 'reactflow' ? { borderWidth: '1px', borderStyle: 'solid', borderColor: lib.borderSoft } : {})
		},
		row(
			{ justifyContent: 'space-between' },
			text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: headingColor(lib) }, title),
			text(
				{ fontSize: lib.fontSize.xs, fontWeight: 600, color: accent(lib), cursor: 'pointer', ...upper(lib) },
				'Edit'
			)
		),
		...rows
	);

export const archetype = {
	id: 'form-flows',
	category: 'forms',
	variants: ['wizard', 'review', 'conditional', 'signature', 'two-column'],
	build(lib) {
		const wizard = define({
			slug: `${lib.id}-form-flows-wizard`,
			name: 'Wizard Form Shell',
			library: lib.id,
			category: 'forms',
			description: `Multi-step form shell in the ${lib.label} style — back chevron, step counter and progress bar over the current step's fields, with Back/Continue footer${lib.id === 'thingtime' ? ' and a rainbow progress fill' : ''}.`,
			tags: ['form', 'wizard', 'steps', 'progress'],
			args: [
				numberArg('step', 2, { label: 'Step', min: 1, max: 4 }),
				numberArg('total', 4, { label: 'Total steps', min: 1, max: 4 }),
				stringArg('stepTitle', 'Contact details', { label: 'Step title', maxLength: 40 }),
				booleanArg('draftSaved', true, { label: 'Draft saved' })
			],
			render: stack(
				shell(lib, '340px'),
				row(
					{ gap: '10px' },
					chevronLeft(16, lib.muted),
					text(
						{ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.muted, whiteSpace: 'nowrap', ...upper(lib) },
						'Step {step} of {total}'
					),
					el(
						'div',
						{
							style: {
								flex: '1',
								height: '6px',
								background: lib.borderSoft,
								borderRadius: lib.radius.pill,
								overflow: 'hidden'
							}
						},
						el('div', {
							style: {
								width: 'calc({step} * 25%)',
								height: '100%',
								background: progressFill(lib),
								borderRadius: lib.radius.pill
							}
						})
					)
				),
				text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: headingColor(lib) }, '{stepTitle}'),
				fieldMock(lib, 'Full name', 'Jordan Avery'),
				fieldMock(lib, 'Email address', 'you@example.com'),
				row(
					{ justifyContent: 'space-between', marginTop: '2px' },
					ghostBtn(lib, 'Back', lib.muted),
					solidBtn(lib, 'Continue')
				),
				iff(
					'draftSaved',
					row(
						{ gap: '6px', justifyContent: 'center' },
						icons.check(12, lib.palette.success.solid),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Draft saved just now')
					)
				)
			)
		});

		const review = define({
			slug: `${lib.id}-form-flows-review`,
			name: 'Review & Submit',
			library: lib.id,
			category: 'forms',
			description: `Review-before-submit summary in the ${lib.label} style — three label/value sections with per-section Edit links on ${lib.id === 'reactflow' ? 'crisp outlined panels' : 'soft panels'}, a consent checkbox and a full-width submit.`,
			tags: ['form', 'review', 'summary', 'submit'],
			args: [
				stringArg('name', 'Riley Chen', { label: 'Name', maxLength: 40 }),
				stringArg('email', 'riley@thingtime.com', { label: 'Email', maxLength: 60 }),
				booleanArg('agreed', true, { label: 'Consent checked' }),
				stringArg('submitLabel', 'Submit application', { label: 'Submit label', maxLength: 32 })
			],
			render: stack(
				shell(lib, '340px'),
				text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: headingColor(lib) }, 'Review your details'),
				reviewSection(lib, 'Personal', [kvRow(lib, 'Name', '{name}'), kvRow(lib, 'Email', '{email}')]),
				reviewSection(lib, 'Address', [kvRow(lib, 'Street', '12 Harbour Lane'), kvRow(lib, 'City', 'Sydney')]),
				reviewSection(lib, 'Plan', [kvRow(lib, 'Tier', 'Pro monthly'), kvRow(lib, 'Seats', '3')]),
				row(
					{ gap: '10px' },
					checkboxMock(lib, 'agreed'),
					text({ fontSize: lib.fontSize.sm, color: lib.text }, 'I confirm these details are correct')
				),
				solidBtn(lib, '{submitLabel}', { width: '100%' })
			)
		});

		const conditional = define({
			slug: `${lib.id}-form-flows-conditional`,
			name: 'Conditional Reveal Field',
			library: lib.id,
			category: 'forms',
			description: `Conditional form question in the ${lib.label} style — a Yes/No radio pair that reveals an indented follow-up field along a ${lib.id === 'thingtime' ? 'rainbow' : lib.id === 'reactflow' ? 'pink accent' : 'quiet'} connector rail, or a muted all-done row.`,
			tags: ['form', 'conditional', 'radio', 'reveal'],
			args: [
				stringArg('question', 'Have you claimed this benefit before?', { label: 'Question', maxLength: 80 }),
				booleanArg('saidYes', true, { label: 'Yes selected' }),
				stringArg('followLabel', 'When did you last claim?', { label: 'Follow-up label', maxLength: 60 }),
				stringArg('helper', 'We use this to check your eligibility.', { label: 'Helper text', maxLength: 80 })
			],
			render: stack(
				shell(lib, '340px'),
				text({ fontSize: lib.fontSize.md, fontWeight: 500, color: headingColor(lib) }, '{question}'),
				row(
					{ gap: '20px' },
					row({ gap: '8px' }, radioMock(lib, 'saidYes', false), text({ fontSize: lib.fontSize.sm, color: lib.text }, 'Yes')),
					row({ gap: '8px' }, radioMock(lib, 'saidYes', true), text({ fontSize: lib.fontSize.sm, color: lib.text }, 'No'))
				),
				iff(
					'saidYes',
					row(
						{ gap: '12px', alignItems: 'stretch', marginLeft: '7px' },
						el('div', {
							style: {
								width: '2px',
								borderRadius: '999px',
								background: lib.id === 'thingtime' ? lib.rainbow : lib.id === 'reactflow' ? lib.accent : lib.border,
								flexShrink: 0
							}
						}),
						stack(
							{ gap: '6px', flex: '1' },
							fieldLabel(lib, '{followLabel}'),
							fieldBox(lib, 'Select a date'),
							text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{helper}')
						)
					),
					row(
						{ gap: '8px', padding: '10px 12px', background: lib.surfaceAlt, borderRadius: lib.radius.md },
						icons.info(14, lib.faint),
						text({ fontSize: lib.fontSize.sm, color: lib.muted }, 'No further info needed')
					)
				)
			)
		});

		const signature = define({
			slug: `${lib.id}-form-flows-signature`,
			name: 'Signature Pad',
			library: lib.id,
			category: 'forms',
			description: `Signature capture block in the ${lib.label} style — a ${lib.id === 'reactflow' ? 'crisp ink-outlined' : 'dashed'} pad with an inked squiggle over the baseline rule, Clear action, and an adopt-signature checkbox.`,
			tags: ['form', 'signature', 'consent', 'pad'],
			args: [
				stringArg('label', 'Signature', { label: 'Label', maxLength: 30 }),
				stringArg('date', 'Aug 18, 2026', { label: 'Date', maxLength: 24 }),
				booleanArg('signed', true, { label: 'Signed' }),
				booleanArg('adopt', true, { label: 'Adopt signature' })
			],
			render: stack(
				shell(lib, '340px'),
				row(
					{ justifyContent: 'space-between' },
					text({ fontSize: lib.fontSize.sm, fontWeight: lib.headingWeight, color: headingColor(lib) }, '{label}'),
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{date}')
				),
				el(
					'div',
					{
						style: {
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							justifyContent: 'flex-end',
							gap: '6px',
							height: '120px',
							padding: '10px 14px',
							boxSizing: 'border-box',
							background: lib.surfaceAlt,
							borderWidth: '1px',
							borderStyle: lib.id === 'reactflow' ? 'solid' : 'dashed',
							borderColor: lib.border,
							borderRadius: lib.radius.md
						}
					},
					iff(
						'signed',
						el(
							'svg',
							{
								width: 180,
								height: 56,
								viewBox: '0 0 180 56',
								fill: 'none',
								stroke: lib.id === 'thingtime' ? lib.ink : lib.id === 'reactflow' ? lib.accent : lib.text,
								strokeWidth: 2,
								strokeLinecap: 'round',
								strokeLinejoin: 'round',
								xmlns: 'http://www.w3.org/2000/svg'
							},
							el('path', {
								d: 'M8 40 C 24 6 40 50 58 28 C 70 14 78 44 96 32 C 112 22 118 44 138 24 C 150 12 160 34 172 20'
							})
						),
						''
					),
					row(
						{ gap: '8px', width: '100%' },
						text({ fontSize: lib.fontSize.xs, fontWeight: 600, color: lib.faint }, 'X'),
						el('div', { style: { flex: '1', height: '1px', background: lib.border } })
					)
				),
				row(
					{ justifyContent: 'space-between' },
					text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Sign above'),
					ghostBtn(lib, 'Clear', accent(lib))
				),
				row(
					{ gap: '10px' },
					checkboxMock(lib, 'adopt'),
					text({ fontSize: lib.fontSize.sm, color: lib.text }, 'Adopt as my default signature')
				)
			)
		});

		const twoColumn = define({
			slug: `${lib.id}-form-flows-two-column`,
			name: 'Two-Column Form Section',
			library: lib.id,
			category: 'forms',
			description: `Two-column form section in the ${lib.label} style — heading and caption over a name pair with a full-width email row, required asterisks, and ${lib.id === 'mui' ? 'filled Material field chrome' : lib.id === 'untitled' ? 'feather-shadowed field chrome' : 'library-native field chrome'}.`,
			tags: ['form', 'layout', 'two-column', 'grid'],
			args: [
				stringArg('heading', 'Personal information', { label: 'Heading', maxLength: 40 }),
				stringArg('caption', 'Use your legal name as it appears on your ID.', { label: 'Caption', maxLength: 80 }),
				booleanArg('required', true, { label: 'Show required' }),
				booleanArg('dense', false, { label: 'Dense fields' })
			],
			render: stack(
				{ ...shell(lib, '360px'), gap: '4px' },
				text({ fontSize: lib.fontSize.lg, fontWeight: lib.headingWeight, color: headingColor(lib) }, '{heading}'),
				text({ fontSize: lib.fontSize.sm, color: lib.muted, marginBottom: '10px' }, '{caption}'),
				el(
					'div',
					{
						style: {
							display: 'grid',
							gridTemplateColumns: '1fr 1fr',
							gap: iff('dense', '10px', '14px')
						}
					},
					...[
						['First name', 'Jordan', false],
						['Last name', 'Avery', false],
						['Email address', 'you@example.com', true]
					].map(([label, hint, span]) =>
						stack(
							{ gap: '6px', ...(span ? { gridColumn: '1 / -1' } : {}) },
							row(
								{ gap: '4px' },
								fieldLabel(lib, label),
								iff('required', text({ color: lib.palette.danger.solid, fontWeight: 600, fontSize: lib.fontSize.sm }, '*'))
							),
							fieldBox(lib, hint, iff('dense', lib.control.sm, lib.control.md))
						)
					)
				)
			)
		});

		return [wizard, review, conditional, signature, twoColumn];
	}
};
