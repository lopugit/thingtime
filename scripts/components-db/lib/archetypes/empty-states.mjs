// Empty-state archetype — centered feedback panels: dashed-border empty state
// with a call to action, no-search-results, error with retry, success /
// complete, and an onboarding CTA with a steps hint.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-empty-states-<variant>`.

import {
	booleanArg,
	define,
	div,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	map,
	numberArg,
	repeat,
	row,
	stack,
	stringArg,
	text,
	textArg,
	toneArg,
	toneMap
} from '../helpers.mjs';

export const archetype = {
	id: 'empty-states',
	category: 'feedback',
	variants: ['empty', 'no-results', 'error', 'success', 'onboarding'],
	build(lib) {
		const panel = (styleExtra, ...children) =>
			stack(
				{
					alignItems: 'center',
					justifyContent: 'center',
					textAlign: 'center',
					gap: '6px',
					width: '340px',
					padding: '36px 24px',
					background: lib.surface,
					borderRadius: lib.radius.lg,
					fontFamily: lib.font,
					color: lib.text,
					...styleExtra
				},
				...children
			);

		const iconBubble = (background, color, iconNode) =>
			div(
				{
					width: '46px',
					height: '46px',
					borderRadius: '999px',
					background,
					color,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					marginBottom: '4px'
				},
				iconNode
			);

		const ctaButton = (labelToken, extra = {}) =>
			el(
				'button',
				{
					type: 'button',
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						height: lib.control.md,
						padding: '0 18px',
						border: 'none',
						borderRadius: lib.id === 'daisyui' ? lib.radius.md : lib.radius.sm,
						background: toneMap(lib, (palette) => palette.solid),
						color: toneMap(lib, (palette) => palette.onSolid),
						fontFamily: lib.font,
						fontSize: lib.fontSize.sm,
						fontWeight: lib.buttonWeight,
						boxShadow: lib.shadow.sm,
						cursor: 'pointer',
						...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {}),
						...extra
					}
				},
				labelToken
			);

		const heading = (token, size = lib.fontSize.lg) => text({ fontWeight: lib.headingWeight, fontSize: size }, token);
		const bodyText = (token, maxWidth = '250px') =>
			text({ fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.5, maxWidth }, token);

		const empty = define({
			slug: `${lib.id}-empty-states-empty`,
			name: 'Empty State',
			library: lib.id,
			category: 'feedback',
			description: `Dashed-border empty state in the ${lib.label} style — centered icon bubble, title, helper copy, and a tone call-to-action${lib.id === 'reactflow' ? ' over a dotted node-canvas background' : ''}.`,
			tags: ['empty-state', 'placeholder', 'feedback', 'cta'],
			args: [
				stringArg('title', 'No things yet', { label: 'Title', maxLength: 50 }),
				textArg('body', 'Anything you create will land here. Start with your first item.', { label: 'Body' }),
				stringArg('ctaLabel', 'Create a thing', { label: 'CTA label', maxLength: 32 }),
				enumArg('icon', ['folder', 'inbox', 'file', 'image'], 'folder', { label: 'Icon' }),
				toneArg()
			],
			render: panel(
				{
					border: `2px dashed ${lib.id === 'reactflow' ? lib.edge : lib.border}`,
					...(lib.id === 'reactflow'
						? {
								backgroundColor: lib.surface,
								backgroundImage: `radial-gradient(${lib.dot} 1px, transparent 1px)`,
								backgroundSize: '14px 14px'
							}
						: {})
				},
				iconBubble(
					lib.surfaceAlt,
					lib.muted,
					map(
						'icon',
						{
							folder: icons.folder(20, 'currentColor'),
							inbox: icons.mail(20, 'currentColor'),
							file: icons.file(20, 'currentColor'),
							image: icons.image(20, 'currentColor')
						},
						icons.folder(20, 'currentColor')
					)
				),
				heading('{title}'),
				bodyText('{body}'),
				ctaButton('{ctaLabel}', { marginTop: '10px' })
			),
			previewBg: lib.bg
		});

		const noResults = define({
			slug: `${lib.id}-empty-states-no-results`,
			name: 'No Results',
			library: lib.id,
			category: 'feedback',
			description: `No-search-results panel in the ${lib.label} style — magnifier icon, the searched query echoed in the title, a helper hint, and an optional clear-search button.`,
			tags: ['empty-state', 'search', 'no-results', 'feedback'],
			args: [
				stringArg('query', 'quarterly report', { label: 'Search query', maxLength: 40 }),
				textArg('hint', 'Check the spelling or try a broader search term.', { label: 'Hint' }),
				stringArg('clearLabel', 'Clear search', { label: 'Clear label', maxLength: 24 }),
				booleanArg('showClear', true, { label: 'Show clear button' })
			],
			render: panel(
				{ border: `1px solid ${lib.border}`, boxShadow: lib.shadow.sm },
				iconBubble(lib.surfaceAlt, lib.muted, icons.search(20, 'currentColor')),
				heading('No results for “{query}”'),
				bodyText('{hint}'),
				iff(
					'showClear',
					el(
						'button',
						{
							type: 'button',
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								height: lib.control.sm,
								padding: '0 14px',
								background: 'transparent',
								color: lib.text,
								border: `1px solid ${lib.border}`,
								borderRadius: lib.radius.sm,
								fontFamily: lib.font,
								fontSize: lib.fontSize.sm,
								fontWeight: lib.buttonWeight,
								cursor: 'pointer',
								marginTop: '10px',
								...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
							}
						},
						'{clearLabel}'
					)
				)
			),
			previewBg: lib.bg
		});

		const error = define({
			slug: `${lib.id}-empty-states-error`,
			name: 'Error State',
			library: lib.id,
			category: 'feedback',
			description: `Error panel in the ${lib.label} style — alert triangle in a tone-tinted bubble, reassuring copy, and a solid tone retry button beneath.`,
			tags: ['error', 'empty-state', 'retry', 'feedback'],
			args: [
				stringArg('title', 'Something went wrong', { label: 'Title', maxLength: 50 }),
				textArg('message', 'We could not load this view. Your data is safe — try again in a moment.', { label: 'Message' }),
				stringArg('retryLabel', 'Try again', { label: 'Retry label', maxLength: 24 }),
				toneArg(['danger', 'warning', 'neutral'], 'danger')
			],
			render: panel(
				{ border: `1px solid ${lib.border}`, boxShadow: lib.shadow.sm },
				iconBubble(toneMap(lib, (palette) => palette.soft), toneMap(lib, (palette) => palette.onSoft), icons.alert(20, 'currentColor')),
				heading('{title}'),
				bodyText('{message}'),
				ctaButton('{retryLabel}', { marginTop: '10px' })
			),
			previewBg: lib.bg
		});

		const success = define({
			slug: `${lib.id}-empty-states-success`,
			name: 'Success State',
			library: lib.id,
			category: 'feedback',
			description: `Success / complete panel in the ${lib.label} style — check circle in a soft tone bubble, congratulatory title and message, and an optional continue button.`,
			tags: ['success', 'complete', 'empty-state', 'feedback'],
			args: [
				stringArg('title', 'You’re all set', { label: 'Title', maxLength: 50 }),
				textArg('message', 'Your workspace is ready. Invite your team or jump straight in.', { label: 'Message' }),
				stringArg('ctaLabel', 'Go to dashboard', { label: 'CTA label', maxLength: 32 }),
				booleanArg('showCta', true, { label: 'Show CTA' }),
				toneArg(['success', 'primary', 'info'], 'success')
			],
			render: panel(
				{ border: `1px solid ${lib.border}`, boxShadow: lib.shadow.md },
				iconBubble(toneMap(lib, (palette) => palette.soft), toneMap(lib, (palette) => palette.solid), icons.check(22, 'currentColor')),
				heading('{title}'),
				bodyText('{message}'),
				iff('showCta', ctaButton('{ctaLabel}', { marginTop: '10px' }))
			),
			previewBg: lib.bg
		});

		const stepActiveBg = lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid);
		const stepActiveFg = lib.id === 'thingtime' ? lib.ink : toneMap(lib, (palette) => palette.onSolid);

		const onboarding = define({
			slug: `${lib.id}-empty-states-onboarding`,
			name: 'Onboarding CTA',
			library: lib.id,
			category: 'feedback',
			description: `Onboarding call-to-action panel in the ${lib.label} style — welcome heading, numbered step dots hinting at the setup flow${lib.id === 'thingtime' ? ' (active step wears the house rainbow)' : ''}, and a solid tone start button.`,
			tags: ['onboarding', 'empty-state', 'steps', 'cta'],
			args: [
				stringArg('title', 'Welcome to your workspace', { label: 'Title', maxLength: 50 }),
				textArg('body', 'A few quick steps and you’re up and running.', { label: 'Body' }),
				stringArg('ctaLabel', 'Start setup', { label: 'CTA label', maxLength: 32 }),
				numberArg('steps', 3, { label: 'Steps', min: 2, max: 6 }),
				toneArg()
			],
			render: panel(
				{ border: `1px solid ${lib.border}`, boxShadow: lib.shadow.lg, width: '360px', padding: '40px 28px' },
				iconBubble(toneMap(lib, (palette) => palette.soft), toneMap(lib, (palette) => palette.onSoft), icons.zap(20, 'currentColor')),
				heading('{title}', lib.fontSize.xl),
				bodyText('{body}', '270px'),
				row(
					{ gap: '8px', marginTop: '10px', justifyContent: 'center' },
					repeat(
						'steps',
						6,
						div(
							{
								width: '24px',
								height: '24px',
								borderRadius: '999px',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontSize: lib.fontSize.xs,
								fontWeight: 600,
								background: ifEq('n', 1, stepActiveBg, lib.surfaceAlt),
								color: ifEq('n', 1, stepActiveFg, lib.muted)
							},
							'{n}'
						)
					)
				),
				text({ fontSize: lib.fontSize.xs, color: lib.faint }, 'Step 1 of {steps}'),
				ctaButton('{ctaLabel}', { marginTop: '8px' })
			),
			previewBg: lib.bg
		});

		return [empty, noResults, error, success, onboarding];
	}
};
