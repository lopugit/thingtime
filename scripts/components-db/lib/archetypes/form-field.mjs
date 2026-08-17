// Form-field archetype — label + input compositions: label above input,
// helper text below, character counter, inline label row, and a required
// asterisk / optional hint. Follows the button.mjs exemplar: exactly 5
// variants, build(lib) returns 5 definitions in variant order, slugs
// `${lib.id}-form-field-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	iff,
	map,
	merge,
	numberArg,
	row,
	stack,
	stringArg,
	text
} from '../helpers.mjs';

const fieldRadius = (lib) => (lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm);

const labelStyle = (lib) => ({
	fontFamily: lib.font,
	fontSize: lib.fontSize.sm,
	fontWeight: lib.headingWeight,
	color: lib.text
});

const inputBase = (lib) => ({
	height: lib.control.md,
	padding: '0 12px',
	borderRadius: fieldRadius(lib),
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	background: lib.surface,
	fontFamily: lib.font,
	fontSize: lib.fontSize.md,
	color: lib.text,
	outline: 'none',
	width: '100%',
	boxSizing: 'border-box',
	boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
});

const sizeMap = (lib) =>
	map(
		'size',
		{
			sm: { height: lib.control.sm, fontSize: lib.fontSize.sm },
			md: { height: lib.control.md, fontSize: lib.fontSize.md },
			lg: { height: lib.control.lg, fontSize: lib.fontSize.lg }
		},
		{ height: lib.control.md, fontSize: lib.fontSize.md }
	);

const disabledStyle = (lib) =>
	iff('disabled', { background: lib.surfaceAlt, color: lib.faint, cursor: 'not-allowed', opacity: 0.75 }, {});

const helperStyle = (lib) => ({ fontFamily: lib.font, fontSize: lib.fontSize.sm, color: lib.muted });

export const archetype = {
	id: 'form-field',
	category: 'forms',
	variants: ['labeled', 'helper', 'char-count', 'inline', 'required'],
	build(lib) {
		const labeled = define({
			slug: `${lib.id}-form-field-labeled`,
			name: 'Labeled Field',
			library: lib.id,
			category: 'forms',
			description: `Text input with its label stacked above in the ${lib.label} style — library-native field border, radius, and type scale across three control sizes.`,
			tags: ['form', 'field', 'input', 'label'],
			args: [
				stringArg('label', 'Email address', { label: 'Label', maxLength: 40 }),
				stringArg('placeholder', 'you@example.com', { label: 'Placeholder', maxLength: 60 }),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
				booleanArg('disabled', false, { label: 'Disabled' })
			],
			render: stack(
				{ gap: '6px', width: '280px' },
				text(labelStyle(lib), '{label}'),
				el('input', {
					type: 'text',
					placeholder: '{placeholder}',
					style: merge(inputBase(lib), sizeMap(lib), disabledStyle(lib))
				})
			)
		});

		const helper = define({
			slug: `${lib.id}-form-field-helper`,
			name: 'Field + Helper Text',
			library: lib.id,
			category: 'forms',
			description: `Labeled input with guidance text underneath in the ${lib.label} style — the error toggle turns the border and helper line to the library's danger tone.`,
			tags: ['form', 'field', 'helper', 'validation'],
			args: [
				stringArg('label', 'Workspace name', { label: 'Label', maxLength: 40 }),
				stringArg('placeholder', 'Acme Inc.', { label: 'Placeholder', maxLength: 60 }),
				stringArg('helper', 'This appears on your public profile.', { label: 'Helper text', maxLength: 80 }),
				booleanArg('error', false, { label: 'Error state' })
			],
			render: stack(
				{ gap: '6px', width: '280px' },
				text(labelStyle(lib), '{label}'),
				el('input', {
					type: 'text',
					placeholder: '{placeholder}',
					style: merge(inputBase(lib), {
						borderColor: iff('error', lib.palette.danger.solid, lib.border)
					})
				}),
				text(
					{
						fontFamily: lib.font,
						fontSize: lib.fontSize.sm,
						color: iff('error', lib.palette.danger.solid, lib.muted)
					},
					'{helper}'
				)
			)
		});

		const charCount = define({
			slug: `${lib.id}-form-field-char-count`,
			name: 'Character Count Field',
			library: lib.id,
			category: 'forms',
			description: `Labeled field with a used/limit character counter aligned bottom-right in the ${lib.label} style — the over-limit toggle flips border and counter to the danger tone.`,
			tags: ['form', 'field', 'counter', 'limit'],
			args: [
				stringArg('label', 'Bio', { label: 'Label', maxLength: 40 }),
				stringArg('value', 'Designer, gardener, amateur botanist', { label: 'Value', maxLength: 80 }),
				numberArg('chars', 36, { label: 'Characters used', min: 0, max: 999 }),
				numberArg('maxChars', 120, { label: 'Character limit', min: 1, max: 999 }),
				booleanArg('overLimit', false, { label: 'Over limit' })
			],
			render: stack(
				{ gap: '6px', width: '280px' },
				text(labelStyle(lib), '{label}'),
				el(
					'div',
					{
						style: merge(inputBase(lib), {
							display: 'flex',
							alignItems: 'center',
							overflow: 'hidden',
							whiteSpace: 'nowrap',
							borderColor: iff('overLimit', lib.palette.danger.solid, lib.border)
						})
					},
					'{value}'
				),
				row(
					{ justifyContent: 'flex-end' },
					text(
						{
							fontFamily: lib.fontMono,
							fontSize: lib.fontSize.xs,
							color: iff('overLimit', lib.palette.danger.solid, lib.muted)
						},
						'{chars}/{maxChars}'
					)
				)
			)
		});

		const inline = define({
			slug: `${lib.id}-form-field-inline`,
			name: 'Inline Label Field',
			library: lib.id,
			category: 'forms',
			description: `Horizontal form row in the ${lib.label} style — fixed-width label beside a flexible input${lib.id === 'antd' ? ', with the classic Ant Design label colon' : ''}, in three control sizes.`,
			tags: ['form', 'field', 'inline', 'horizontal'],
			args: [
				stringArg('label', 'Full name', { label: 'Label', maxLength: 30 }),
				stringArg('placeholder', 'Jane Doe', { label: 'Placeholder', maxLength: 60 }),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
				booleanArg('disabled', false, { label: 'Disabled' })
			],
			render: row(
				{ gap: '12px', width: '340px' },
				text(
					{ ...labelStyle(lib), width: '104px', flexShrink: 0, textAlign: lib.id === 'bootstrap' ? 'right' : 'left' },
					lib.id === 'antd' ? '{label}:' : '{label}'
				),
				el('input', {
					type: 'text',
					placeholder: '{placeholder}',
					style: merge(inputBase(lib), sizeMap(lib), { width: 'auto', flex: '1 1 auto' }, disabledStyle(lib))
				})
			)
		});

		const required = define({
			slug: `${lib.id}-form-field-required`,
			name: 'Required Field',
			library: lib.id,
			category: 'forms',
			description: `Labeled input in the ${lib.label} style whose required toggle swaps a ${lib.id === 'untitled' ? 'brand-purple' : 'danger-tone'} asterisk for a muted "(optional)" hint, with fine print below.`,
			tags: ['form', 'field', 'required', 'optional'],
			args: [
				stringArg('label', 'Email', { label: 'Label', maxLength: 40 }),
				stringArg('placeholder', 'you@example.com', { label: 'Placeholder', maxLength: 60 }),
				booleanArg('required', true, { label: 'Required' }),
				stringArg('hint', 'We only use this to sign you in.', { label: 'Hint', maxLength: 80 })
			],
			render: stack(
				{ gap: '6px', width: '280px' },
				row(
					{ gap: '4px' },
					text(labelStyle(lib), '{label}'),
					iff(
						'required',
						text(
							{
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								fontWeight: 600,
								color: lib.id === 'untitled' ? lib.palette.primary.solid : lib.palette.danger.solid
							},
							'*'
						),
						text({ fontFamily: lib.font, fontSize: lib.fontSize.xs, color: lib.faint }, '(optional)')
					)
				),
				el('input', {
					type: 'text',
					placeholder: '{placeholder}',
					style: merge(inputBase(lib), {})
				}),
				text({ ...helperStyle(lib), fontSize: lib.fontSize.xs }, '{hint}')
			)
		});

		return [labeled, helper, charCount, inline, required];
	}
};
