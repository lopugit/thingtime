// Loading archetype — waiting states: svg arc spinners, pulsing dot rows,
// skeleton text and card placeholders, and a busy button. Follows the
// button.mjs exemplar contract: exactly 5 variants, `build(lib)` returns
// exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-loading-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	iff,
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

// Static arc spinner: a faint full ring plus a 3/4 tone-colored arc.
const spinnerSvg = (size, trackStroke, arcStroke, trackOpacity) =>
	el(
		'svg',
		{ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
		el('circle', {
			cx: 12,
			cy: 12,
			r: 10,
			stroke: trackStroke,
			strokeWidth: 3,
			...(trackOpacity === undefined ? {} : { style: { opacity: trackOpacity } })
		}),
		el('path', { d: 'M12 2a10 10 0 1 1-10 10', stroke: arcStroke, strokeWidth: 3, strokeLinecap: 'round' })
	);

const skeletonBar = (lib, height, width, radius) =>
	el('div', { style: { height, width, borderRadius: radius, background: lib.borderSoft } });

const sizeMap = (lib) => ({
	ttMap: {
		arg: 'size',
		values: {
			sm: { height: lib.control.sm, padding: '0 12px', fontSize: lib.fontSize.sm },
			md: { height: lib.control.md, padding: '0 16px', fontSize: lib.fontSize.md },
			lg: { height: lib.control.lg, padding: '0 20px', fontSize: lib.fontSize.lg }
		},
		default: { height: lib.control.md, padding: '0 16px', fontSize: lib.fontSize.md }
	}
});

export const archetype = {
	id: 'loading',
	category: 'feedback',
	variants: ['spinner', 'dots', 'skeleton-text', 'skeleton-card', 'loading-button'],
	build(lib) {
		const spinner = define({
			slug: `${lib.id}-loading-spinner`,
			name: 'Spinner',
			library: lib.id,
			category: 'feedback',
			description: `Circular spinner in the ${lib.label} style — a faint svg track ring with a tone-colored three-quarter arc, plus an optional caption.`,
			tags: ['loading', 'spinner', 'progress', 'feedback'],
			args: [
				toneArg(),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
				stringArg('label', 'Loading…', { label: 'Label', maxLength: 40 }),
				booleanArg('showLabel', true, { label: 'Show label' })
			],
			render: row(
				{ gap: '10px', fontFamily: lib.font },
				spinnerSvg(
					map('size', { sm: 16, md: 24, lg: 32 }, 24),
					lib.borderSoft,
					toneMap(lib, (palette, tone) => (lib.id === 'reactflow' && tone === 'primary' ? lib.accent : palette.solid))
				),
				iff('showLabel', text({ fontSize: lib.fontSize.sm, color: lib.muted }, '{label}'))
			)
		});

		const dots = define({
			slug: `${lib.id}-loading-dots`,
			name: 'Loading Dots',
			library: lib.id,
			category: 'feedback',
			description: `Row of pulsing loader dots in the ${lib.label} style — tone-colored circles fading toward the edges, with an adjustable dot count.`,
			tags: ['loading', 'dots', 'typing', 'feedback'],
			args: [
				numberArg('count', 3, { label: 'Dots', min: 2, max: 5 }),
				toneArg(),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' })
			],
			render: row(
				{ gap: '6px', fontFamily: lib.font },
				repeat(
					'count',
					5,
					el('span', {
						style: {
							width: map('size', { sm: '6px', md: '8px', lg: '12px' }, '8px'),
							height: map('size', { sm: '6px', md: '8px', lg: '12px' }, '8px'),
							borderRadius: '999px',
							background: toneMap(lib, (palette) => palette.solid),
							opacity: map('n', { 1: 0.3, 2: 0.6, 3: 1, 4: 0.6, 5: 0.3 }, 0.6)
						}
					})
				)
			)
		});

		const skeletonText = define({
			slug: `${lib.id}-loading-skeleton-text`,
			name: 'Skeleton Text',
			library: lib.id,
			category: 'feedback',
			description: `Skeleton paragraph placeholder in the ${lib.label} style — grey bars of varying widths standing in for text lines while content loads.`,
			tags: ['loading', 'skeleton', 'placeholder', 'text'],
			args: [
				numberArg('lines', 3, { label: 'Lines', min: 1, max: 6 }),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Line height' }),
				booleanArg('rounded', true, { label: 'Rounded' })
			],
			render: stack(
				{ gap: '10px', width: '240px' },
				repeat(
					'lines',
					6,
					el('div', {
						style: {
							height: map('size', { sm: '8px', md: '10px', lg: '14px' }, '10px'),
							borderRadius: iff('rounded', lib.radius.pill, lib.radius.xs),
							background: lib.borderSoft,
							width: map('n', { 1: '100%', 2: '92%', 3: '61%', 4: '87%', 5: '74%', 6: '48%' }, '80%')
						}
					})
				)
			)
		});

		const skeletonCard = define({
			slug: `${lib.id}-loading-skeleton-card`,
			name: 'Skeleton Card',
			library: lib.id,
			category: 'feedback',
			description: `Skeleton card placeholder in the ${lib.label} style — avatar circle beside heading bars, body-line bars below, and an optional media block.`,
			tags: ['loading', 'skeleton', 'placeholder', 'card'],
			args: [
				booleanArg('showAvatar', true, { label: 'Show avatar' }),
				booleanArg('showMedia', false, { label: 'Show media block' }),
				numberArg('lines', 3, { label: 'Body lines', min: 1, max: 5 })
			],
			render: stack(
				{
					width: '260px',
					gap: '12px',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.borderSoft,
					borderRadius: lib.radius.lg,
					padding: '16px',
					boxShadow: lib.shadow.sm
				},
				iff('showMedia', el('div', { style: { height: '96px', borderRadius: lib.radius.md, background: lib.borderSoft } })),
				row(
					{ gap: '12px' },
					iff(
						'showAvatar',
						el('div', {
							style: { width: '40px', height: '40px', borderRadius: '999px', background: lib.borderSoft, flexShrink: 0 }
						})
					),
					stack(
						{ gap: '8px', flex: 1 },
						skeletonBar(lib, '10px', '45%', lib.radius.xs),
						skeletonBar(lib, '10px', '70%', lib.radius.xs)
					)
				),
				stack(
					{ gap: '8px' },
					repeat(
						'lines',
						5,
						el('div', {
							style: {
								height: '10px',
								borderRadius: lib.radius.xs,
								background: lib.borderSoft,
								width: map('n', { 1: '100%', 2: '94%', 3: '82%', 4: '64%', 5: '52%' }, '75%')
							}
						})
					)
				)
			)
		});

		const loadingButton = define({
			slug: `${lib.id}-loading-loading-button`,
			name: 'Loading Button',
			library: lib.id,
			category: 'feedback',
			description: `Busy-state button in the ${lib.label} style — an inline arc spinner beside the label${lib.uppercaseButtons ? ', uppercase per Material convention' : ''}, in solid or quiet tinted form.`,
			tags: ['loading', 'button', 'spinner', 'busy'],
			args: [
				stringArg('label', 'Saving…', { label: 'Label', maxLength: 40 }),
				toneArg(),
				enumArg('size', ['sm', 'md', 'lg'], 'md', { label: 'Size' }),
				booleanArg('quiet', false, { label: 'Quiet (tinted)' })
			],
			render: el(
				'button',
				{
					type: 'button',
					style: merge(
						{
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							gap: '8px',
							border: 'none',
							borderRadius: lib.radius.md,
							fontFamily: lib.font,
							fontWeight: lib.buttonWeight,
							cursor: 'wait',
							opacity: 0.9,
							...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
						},
						sizeMap(lib),
						{
							background: iff(
								'quiet',
								toneMap(lib, (palette) => palette.soft),
								toneMap(lib, (palette) => palette.solid)
							),
							color: iff(
								'quiet',
								toneMap(lib, (palette) => palette.onSoft),
								toneMap(lib, (palette) => palette.onSolid)
							),
							boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
						}
					)
				},
				spinnerSvg(16, 'currentColor', 'currentColor', 0.3),
				'{label}'
			)
		});

		return [spinner, dots, skeletonText, skeletonCard, loadingButton];
	}
};
