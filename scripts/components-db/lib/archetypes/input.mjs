// Input archetype — single-line text fields in five states.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-input-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	merge,
	row,
	stack,
	stringArg,
	text
} from '../helpers.mjs';

const sizeMap = (lib) => ({
	ttMap: {
		arg: 'size',
		values: {
			sm: { height: lib.control.sm, fontSize: lib.fontSize.sm },
			md: { height: lib.control.md, fontSize: lib.fontSize.md },
			lg: { height: lib.control.lg, fontSize: lib.fontSize.lg }
		},
		default: { height: lib.control.md, fontSize: lib.fontSize.md }
	}
});

// React Flow's headline border token is its dark node chrome — inputs use the
// soft border instead; Untitled UI and Thingtime keep their signature feather
// shadow on field chrome.
const fieldBorder = (lib) => `1px solid ${lib.id === 'reactflow' ? lib.borderSoft : lib.border}`;
const fieldShadow = (lib) => (lib.id === 'untitled' || lib.id === 'thingtime' ? { boxShadow: lib.shadow.sm } : {});

const inputChrome = (lib) => ({
	width: '100%',
	padding: '0 12px',
	border: fieldBorder(lib),
	borderRadius: lib.radius.md,
	background: lib.surface,
	color: lib.text,
	fontFamily: lib.font,
	outline: 'none',
	boxSizing: 'border-box',
	...fieldShadow(lib)
});

const bareInput = (lib) => ({
	flex: 1,
	minWidth: 0,
	border: 'none',
	outline: 'none',
	background: 'transparent',
	padding: 0,
	color: lib.text,
	fontFamily: lib.font,
	fontSize: 'inherit'
});

const fieldLabel = (lib) => ({ fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.text, fontFamily: lib.font });

const fieldStack = (lib, ...children) => stack({ gap: '6px', width: '260px', fontFamily: lib.font }, ...children);

export const archetype = {
	id: 'input',
	category: 'forms',
	variants: ['text', 'icon', 'addon', 'error', 'disabled'],
	build(lib) {
		const textField = define({
			slug: `${lib.id}-input-text`,
			name: 'Text Input',
			library: lib.id,
			category: 'forms',
			description: `Plain single-line text field in the ${lib.label} style — label, placeholder and helper hint on the library's control height and radius.`,
			tags: ['input', 'text', 'field', 'form'],
			args: [
				stringArg('label', 'Email', { label: 'Label', maxLength: 40 }),
				stringArg('placeholder', 'you@example.com', { label: 'Placeholder', maxLength: 60 }),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
				stringArg('hint', 'We will never share it.', { label: 'Hint', maxLength: 80 })
			],
			render: fieldStack(
				lib,
				el('label', { style: fieldLabel(lib) }, '{label}'),
				el('input', { type: 'text', placeholder: '{placeholder}', style: merge(inputChrome(lib), sizeMap(lib)) }),
				iff('hint', text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{hint}'))
			)
		});

		const iconField = define({
			slug: `${lib.id}-input-icon`,
			name: 'Icon Input',
			library: lib.id,
			category: 'forms',
			description: `Search field with a leading icon in the ${lib.label} style — muted magnifier inside the field chrome, plus an optional mono shortcut chip.`,
			tags: ['input', 'icon', 'search', 'form'],
			args: [
				stringArg('placeholder', 'Search…', { label: 'Placeholder', maxLength: 60 }),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
				booleanArg('shortcut', true, { label: 'Shortcut chip' })
			],
			render: el(
				'div',
				{
					style: merge(
						{
							display: 'flex',
							alignItems: 'center',
							gap: '8px',
							width: '260px',
							padding: '0 10px',
							border: fieldBorder(lib),
							borderRadius: lib.radius.md,
							background: lib.surface,
							fontFamily: lib.font,
							boxSizing: 'border-box',
							...fieldShadow(lib)
						},
						sizeMap(lib)
					)
				},
				icons.search(16, lib.muted),
				el('input', { type: 'text', placeholder: '{placeholder}', style: bareInput(lib) }),
				iff(
					'shortcut',
					el(
						'span',
						{
							style: {
								fontFamily: lib.fontMono,
								fontSize: lib.fontSize.xs,
								color: lib.faint,
								border: `1px solid ${lib.borderSoft}`,
								borderRadius: lib.radius.xs,
								padding: '2px 5px',
								flexShrink: 0
							}
						},
						'⌘K'
					)
				)
			)
		});

		const addonField = define({
			slug: `${lib.id}-input-addon`,
			name: 'Addon Input',
			library: lib.id,
			category: 'forms',
			description: `Text field with a prefix addon segment in the ${lib.label} style — a tinted https:// block divided from the input by the library border.`,
			tags: ['input', 'addon', 'prefix', 'url', 'form'],
			args: [
				stringArg('label', 'Website', { label: 'Label', maxLength: 40 }),
				stringArg('addon', 'https://', { label: 'Addon', maxLength: 20 }),
				stringArg('placeholder', 'example.com', { label: 'Placeholder', maxLength: 60 }),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' })
			],
			render: stack(
				{ gap: '6px', width: '280px', fontFamily: lib.font },
				el('label', { style: fieldLabel(lib) }, '{label}'),
				el(
					'div',
					{
						style: merge(
							{
								display: 'flex',
								alignItems: 'stretch',
								border: fieldBorder(lib),
								borderRadius: lib.radius.md,
								background: lib.surface,
								overflow: 'hidden',
								boxSizing: 'border-box',
								...fieldShadow(lib)
							},
							sizeMap(lib)
						)
					},
					el(
						'span',
						{
							style: {
								display: 'flex',
								alignItems: 'center',
								padding: '0 12px',
								background: lib.surfaceAlt,
								borderRight: fieldBorder(lib),
								color: lib.muted,
								flexShrink: 0
							}
						},
						'{addon}'
					),
					el('input', { type: 'text', placeholder: '{placeholder}', style: { ...bareInput(lib), padding: '0 12px' } })
				)
			)
		});

		const errorField = define({
			slug: `${lib.id}-input-error`,
			name: 'Error Input',
			library: lib.id,
			category: 'forms',
			description: `Invalid text field in the ${lib.label} style — danger border with an optional soft error glow, and an alert icon beside the message.`,
			tags: ['input', 'error', 'invalid', 'validation', 'form'],
			args: [
				stringArg('label', 'Email', { label: 'Label', maxLength: 40 }),
				stringArg('value', 'not-an-email', { label: 'Value', maxLength: 60 }),
				stringArg('message', 'Enter a valid email address.', { label: 'Message', maxLength: 80 }),
				booleanArg('ring', true, { label: 'Error ring' })
			],
			render: fieldStack(
				lib,
				el('label', { style: fieldLabel(lib) }, '{label}'),
				el('input', {
					type: 'text',
					value: '{value}',
					style: merge(
						inputChrome(lib),
						{ height: lib.control.md, fontSize: lib.fontSize.md, border: `1px solid ${lib.palette.danger.solid}` },
						iff('ring', { boxShadow: `0 0 0 3px ${lib.palette.danger.soft}` }, {})
					)
				}),
				iff(
					'message',
					row(
						{ gap: '6px' },
						icons.alert(13, lib.palette.danger.solid),
						text({ fontSize: lib.fontSize.xs, color: lib.palette.danger.solid }, '{message}')
					)
				)
			)
		});

		const disabledField = define({
			slug: `${lib.id}-input-disabled`,
			name: 'Disabled Input',
			library: lib.id,
			category: 'forms',
			description: `Disabled text field in the ${lib.label} style — muted label over a filled, non-interactive control with a not-allowed cursor and a faint hint.`,
			tags: ['input', 'disabled', 'readonly', 'form'],
			args: [
				stringArg('label', 'API key', { label: 'Label', maxLength: 40 }),
				stringArg('value', 'Managed by your admin', { label: 'Value', maxLength: 60 }),
				stringArg('hint', 'Contact an admin to change this.', { label: 'Hint', maxLength: 80 })
			],
			render: fieldStack(
				lib,
				el('label', { style: { ...fieldLabel(lib), color: lib.muted } }, '{label}'),
				el('input', {
					type: 'text',
					value: '{value}',
					disabled: true,
					style: merge(inputChrome(lib), {
						height: lib.control.md,
						fontSize: lib.fontSize.md,
						background: lib.surfaceAlt,
						color: lib.muted,
						border: `1px solid ${lib.borderSoft}`,
						cursor: 'not-allowed',
						boxShadow: 'none'
					})
				}),
				iff('hint', text({ fontSize: lib.fontSize.xs, color: lib.faint }, '{hint}'))
			)
		});

		return [textField, iconField, addonField, errorField, disabledField];
	}
};
