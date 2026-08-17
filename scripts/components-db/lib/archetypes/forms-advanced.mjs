// Forms-advanced archetype — advanced input patterns in five renditions:
// one-time-code boxes, password field + strength meter, tag/token field,
// phone input with a country mock, and a compact address block. Follows the
// button.mjs exemplar: exactly 5 variants, `build(lib)` returns exactly 5
// definitions (one per variant, same order), slugs
// `${lib.id}-forms-advanced-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	map,
	numberArg,
	repeat,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Library accents: reactflow focuses with its hot-pink handle color and
// thingtime with its ink; everyone else uses their primary solid.
const accent = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid);

// Shadow a field wears at rest — untitled keeps its feather shadow.
const restShadow = (lib) => (lib.id === 'untitled' ? lib.shadow.sm : 'none');

// Shared field chrome: daisyui goes chunky (2px borders), mui takes the
// filled-input wash, untitled wears its feather shadow.
const fieldBase = (lib) => ({
	display: 'flex',
	alignItems: 'center',
	boxSizing: 'border-box',
	height: lib.control.md,
	padding: '0 12px',
	background: lib.id === 'mui' ? lib.surfaceAlt : lib.surface,
	borderWidth: lib.id === 'daisyui' ? '2px' : '1px',
	borderStyle: 'solid',
	borderColor: lib.border,
	borderRadius: lib.radius.sm,
	fontFamily: lib.font,
	fontSize: lib.fontSize.md,
	color: lib.text,
	...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {})
});

// Focus treatment driven by a boolean arg named `focused`.
const focusable = (lib) => ({
	borderColor: iff('focused', accent(lib), lib.border),
	boxShadow: iff('focused', lib.focusRing, restShadow(lib))
});

// Text-cursor mock — a thin accent bar.
const caretBar = (lib, height) =>
	el('div', { style: { width: '2px', height, borderRadius: '1px', background: accent(lib), flexShrink: 0 } });

// One square OTP code box; `extra` overrides layered on last.
const otpBox = (lib, extra, ...children) =>
	el(
		'div',
		{
			style: {
				width: lib.control.lg,
				height: lib.control.lg,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				boxSizing: 'border-box',
				background: lib.id === 'mui' ? lib.surfaceAlt : lib.surface,
				borderWidth: lib.id === 'daisyui' ? '2px' : '1px',
				borderStyle: 'solid',
				borderColor: lib.border,
				borderRadius: lib.radius.sm,
				fontFamily: lib.fontMono,
				fontSize: lib.fontSize.xl,
				fontWeight: lib.headingWeight,
				color: lib.text,
				...(lib.id === 'untitled' ? { boxShadow: lib.shadow.sm } : {}),
				...extra
			}
		},
		...children
	);

export const archetype = {
	id: 'forms-advanced',
	category: 'forms',
	variants: ['otp', 'password', 'tag-input', 'phone', 'address'],
	build(lib) {
		const otp = define({
			slug: `${lib.id}-forms-advanced-otp`,
			name: 'OTP Code Input',
			library: lib.id,
			category: 'forms',
			description: `One-time-code entry in the ${lib.label} style — six square code boxes with four digits typed in, an active box carrying the text caret, and a resend helper caption.`,
			tags: ['form', 'otp', 'code', 'verification'],
			args: [
				stringArg('digit1', '7', { label: 'First digit', maxLength: 1 }),
				stringArg('digit2', '3', { label: 'Second digit', maxLength: 1 }),
				booleanArg('active', true, { label: 'Active box' }),
				stringArg('helper', "Didn't get a code?", { label: 'Helper text', maxLength: 40 })
			],
			render: stack(
				{ gap: '10px', fontFamily: lib.font },
				row(
					{ gap: '8px' },
					otpBox(lib, {}, '{digit1}'),
					otpBox(lib, {}, '{digit2}'),
					otpBox(lib, {}, '4'),
					otpBox(lib, {}, '1'),
					otpBox(
						lib,
						{
							borderColor: iff('active', accent(lib), lib.border),
							boxShadow: iff('active', lib.focusRing, restShadow(lib))
						},
						iff('active', caretBar(lib, '20px'))
					),
					otpBox(lib, {})
				),
				row(
					{ gap: '6px', fontSize: lib.fontSize.sm },
					text({ color: lib.muted }, '{helper}'),
					text({ color: accent(lib), fontWeight: 600, cursor: 'pointer' }, 'Resend')
				)
			)
		});

		// Strength meter: segment k of 4 fills once the strength reaches it.
		// thingtime celebrates a strong password with the house rainbow.
		const track = lib.borderSoft;
		const strongFill = lib.id === 'thingtime' ? lib.rainbow : lib.palette.success.solid;
		const segFill = (k) =>
			map(
				'strength',
				{
					weak: k <= 1 ? lib.palette.danger.solid : track,
					fair: k <= 2 ? lib.palette.warning.solid : track,
					good: k <= 3 ? lib.palette.info.solid : track,
					strong: strongFill
				},
				track
			);

		const password = define({
			slug: `${lib.id}-forms-advanced-password`,
			name: 'Password Strength Field',
			library: lib.id,
			category: 'forms',
			description: `Password field in the ${lib.label} style — masked dot glyphs inside the field plus a four-segment strength meter sweeping from danger to ${lib.id === 'thingtime' ? 'the house rainbow' : 'success'} with a matching caption.`,
			tags: ['form', 'password', 'strength', 'security'],
			args: [
				stringArg('label', 'Password', { label: 'Label', maxLength: 30 }),
				numberArg('dots', 8, { label: 'Characters', min: 1, max: 12 }),
				enumArg('strength', ['weak', 'fair', 'good', 'strong'], 'fair', { label: 'Strength' }),
				booleanArg('focused', false, { label: 'Focused' })
			],
			render: stack(
				{ gap: '6px', width: '260px', fontFamily: lib.font },
				text(
					{
						fontSize: lib.fontSize.sm,
						fontWeight: 600,
						color: lib.text,
						...(lib.uppercaseButtons
							? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing, fontSize: lib.fontSize.xs }
							: {})
					},
					'{label}'
				),
				el(
					'div',
					{ style: { ...fieldBase(lib), gap: '4px', ...focusable(lib) } },
					repeat(
						'dots',
						12,
						el('span', { style: { width: '6px', height: '6px', borderRadius: '999px', background: lib.text, flexShrink: 0 } })
					)
				),
				row(
					{ gap: '4px' },
					...[1, 2, 3, 4].map((k) =>
						el('div', {
							style: {
								flex: 1,
								height: lib.id === 'daisyui' ? '8px' : '6px',
								borderRadius: lib.radius.pill,
								background: segFill(k)
							}
						})
					)
				),
				text(
					{
						fontSize: lib.fontSize.xs,
						fontWeight: 500,
						color: map(
							'strength',
							{
								weak: lib.palette.danger.onSoft,
								fair: lib.palette.warning.onSoft,
								good: lib.palette.info.onSoft,
								strong: lib.palette.success.onSoft
							},
							lib.muted
						)
					},
					map(
						'strength',
						{
							weak: 'Too weak',
							fair: 'Could be stronger',
							good: 'Good password',
							strong: 'Strong password'
						},
						'Could be stronger'
					)
				)
			)
		});

		// Tag chip: soft tone wash; antd wears its classic tag border, and antd/
		// reactflow keep tight corners while everyone else takes the pill.
		const chipRadius = lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill;
		const chip = (labelNode) =>
			el(
				'span',
				{
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						gap: '4px',
						padding: '2px 8px',
						borderRadius: chipRadius,
						background: toneMap(lib, (palette) => palette.soft),
						color: toneMap(lib, (palette) => palette.onSoft),
						fontSize: lib.fontSize.xs,
						fontWeight: 600,
						...(lib.id === 'antd'
							? { borderWidth: '1px', borderStyle: 'solid', borderColor: toneMap(lib, (palette) => palette.border) }
							: {})
					}
				},
				labelNode,
				icons.x(12, 'currentColor')
			);

		const tagInput = define({
			slug: `${lib.id}-forms-advanced-tag-input`,
			name: 'Tag Input',
			library: lib.id,
			category: 'forms',
			description: `Token field in the ${lib.label} style — three removable tag chips in the tone wash, an inline text-cursor mock, and a press-Enter helper caption.`,
			tags: ['form', 'tags', 'tokens', 'chips'],
			args: [
				stringArg('tag1', 'react', { label: 'First tag', maxLength: 20 }),
				stringArg('tag2', 'design', { label: 'Second tag', maxLength: 20 }),
				toneArg(),
				booleanArg('caret', true, { label: 'Cursor' })
			],
			render: stack(
				{ gap: '6px', width: '300px', fontFamily: lib.font },
				el(
					'div',
					{
						style: {
							...fieldBase(lib),
							height: 'auto',
							minHeight: lib.control.md,
							flexWrap: 'wrap',
							gap: '6px',
							padding: '6px 10px'
						}
					},
					chip('{tag1}'),
					chip('{tag2}'),
					chip('ux'),
					iff('caret', caretBar(lib, '16px'))
				),
				text({ fontSize: lib.fontSize.xs, color: lib.muted }, 'Press Enter to add')
			)
		});

		const phone = define({
			slug: `${lib.id}-forms-advanced-phone`,
			name: 'Phone Input',
			library: lib.id,
			category: 'forms',
			description: `Phone number field in the ${lib.label} style — a dial-prefix country mock with chevron on the left, muted placeholder digits, and a success check when the number validates.`,
			tags: ['form', 'phone', 'input', 'validation'],
			args: [
				stringArg('prefix', '61', { label: 'Dial prefix', maxLength: 4 }),
				stringArg('number', '412 345 678', { label: 'Number', maxLength: 20 }),
				booleanArg('valid', true, { label: 'Valid' }),
				booleanArg('focused', false, { label: 'Focused' })
			],
			render: el(
				'div',
				{ style: { ...fieldBase(lib), gap: '10px', width: '280px', ...focusable(lib) } },
				row(
					{
						gap: '4px',
						paddingRight: '10px',
						borderRightWidth: '1px',
						borderRightStyle: 'solid',
						borderRightColor: lib.borderSoft,
						fontWeight: 500,
						flexShrink: 0
					},
					'+{prefix}',
					icons.chevronDown(14, lib.muted)
				),
				el('span', { style: { flex: 1, color: lib.faint } }, '{number}'),
				iff('valid', icons.check(16, lib.palette.success.solid))
			)
		});

		const addressField = (child, extra = {}) => el('div', { style: { ...fieldBase(lib), ...extra } }, child);

		const address = define({
			slug: `${lib.id}-forms-advanced-address`,
			name: 'Address Block',
			library: lib.id,
			category: 'forms',
			description: `Compact address form in the ${lib.label} style — street field, a city and postcode pair, a country select mock with chevron, and a use-as-billing checkbox row.`,
			tags: ['form', 'address', 'checkout', 'fields'],
			args: [
				stringArg('street', '12 Wattle Lane', { label: 'Street', maxLength: 40 }),
				stringArg('city', 'Sydney', { label: 'City', maxLength: 24 }),
				stringArg('zip', '2000', { label: 'Postcode', maxLength: 10 }),
				stringArg('country', 'Australia', { label: 'Country', maxLength: 24 }),
				booleanArg('billing', true, { label: 'Use as billing' })
			],
			render: stack(
				{ gap: '8px', width: '300px', fontFamily: lib.font },
				addressField('{street}'),
				row({ gap: '8px' }, addressField('{city}', { flex: 1 }), addressField('{zip}', { width: '90px' })),
				el(
					'div',
					{ style: { ...fieldBase(lib), justifyContent: 'space-between' } },
					'{country}',
					icons.chevronDown(14, lib.muted)
				),
				row(
					{ gap: '8px' },
					el(
						'div',
						{
							style: {
								width: '16px',
								height: '16px',
								boxSizing: 'border-box',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: lib.radius.xs,
								borderWidth: lib.id === 'daisyui' ? '2px' : '1px',
								borderStyle: 'solid',
								borderColor: iff('billing', accent(lib), lib.border),
								background: iff('billing', accent(lib), lib.surface),
								flexShrink: 0
							}
						},
						iff('billing', icons.check(11, lib.palette.primary.onSolid))
					),
					text({ fontSize: lib.fontSize.sm, color: lib.text }, 'Use as billing')
				)
			)
		});

		return [otp, password, tagInput, phone, address];
	}
};
