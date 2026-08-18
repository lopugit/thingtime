// Accessibility archetype — accessibility & i18n surfaces in five renditions:
// locale picker, accessibility settings menu, contrast toggle preview,
// text-to-speech bar, and a keyboard-shortcuts overlay. Follows the button.mjs
// exemplar: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-accessibility-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	iff,
	ifEq,
	map,
	merge,
	numberArg,
	row,
	stack,
	stringArg
} from '../helpers.mjs';

// reactflow gets its hot-pink accent, thingtime its ink; everyone else the
// library primary.
const accentOf = (lib) => (lib.id === 'reactflow' ? lib.accent : lib.id === 'thingtime' ? lib.ink : lib.palette.primary.solid);
const accentOnOf = (lib) => (lib.id === 'reactflow' ? lib.palette.danger.onSolid : lib.palette.primary.onSolid);

// Highlight tint pair (soft bg + deep text) for the accent.
const highlightOf = (lib) =>
	lib.id === 'reactflow' ? lib.palette.danger : lib.id === 'thingtime' ? lib.palette.info : lib.palette.primary;

// Shared surface panel: mui/untitled wear their elevation/feather shadows,
// reactflow keeps a crisp dark outline and tighter corners.
const panel = (lib, extra = {}) => ({
	display: 'flex',
	flexDirection: 'column',
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.id === 'reactflow' ? lib.border : lib.borderSoft,
	borderRadius: lib.id === 'reactflow' ? lib.radius.md : lib.radius.lg,
	boxShadow: lib.id === 'mui' || lib.id === 'untitled' ? lib.shadow.lg : lib.shadow.md,
	fontFamily: lib.font,
	color: lib.text,
	boxSizing: 'border-box',
	...extra
});

// Boolean switch — thingtime flips on with its rainbow, daisyui runs chunky.
const switchEl = (lib, argName) =>
	el(
		'span',
		{
			style: {
				display: 'flex',
				alignItems: 'center',
				width: lib.id === 'daisyui' ? '40px' : '34px',
				height: lib.id === 'daisyui' ? '22px' : '20px',
				padding: '2px',
				boxSizing: 'border-box',
				borderRadius: lib.radius.pill,
				flexShrink: 0,
				background: iff(argName, lib.id === 'thingtime' ? lib.rainbow : accentOf(lib), lib.border),
				justifyContent: iff(argName, 'flex-end', 'flex-start')
			}
		},
		el('span', {
			style: {
				width: lib.id === 'daisyui' ? '18px' : '16px',
				height: lib.id === 'daisyui' ? '18px' : '16px',
				borderRadius: '999px',
				background: lib.surface,
				boxShadow: lib.shadow.sm
			}
		})
	);

const globeIcon = (lib, size) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: lib.muted,
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		el('circle', { cx: 12, cy: 12, r: 9 }),
		el('line', { x1: 3, y1: 12, x2: 21, y2: 12 }),
		el('path', { d: 'M12 3c2.5 2.3 4 5.5 4 9s-1.5 6.7-4 9c-2.5-2.3-4-5.5-4-9s1.5-6.7 4-9z' })
	);

const personIcon = (lib, size) =>
	el(
		'svg',
		{
			width: size,
			height: size,
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: accentOf(lib),
			strokeWidth: 2,
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			xmlns: 'http://www.w3.org/2000/svg'
		},
		el('circle', { cx: 12, cy: 12, r: 10 }),
		el('circle', { cx: 12, cy: 8.5, r: 2.5 }),
		el('path', { d: 'M7 17.5a5.5 5.5 0 0 1 10 0' })
	);

// Keycap chip — antd/reactflow stay tight-cornered, daisyui rounds off.
const kbdChip = (lib, content) =>
	el(
		'span',
		{
			style: {
				fontFamily: lib.fontMono,
				fontSize: '11px',
				lineHeight: 1.4,
				color: lib.text,
				background: lib.surfaceAlt,
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: lib.border,
				borderBottomWidth: '2px',
				borderRadius: lib.id === 'daisyui' ? lib.radius.sm : lib.radius.xs,
				padding: '1px 6px'
			}
		},
		content
	);

const mutedLabel = (lib) => ({ fontSize: lib.fontSize.sm, color: lib.text });

const upper = (lib) => (lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {});

export const archetype = {
	id: 'accessibility',
	category: 'accessibility',
	variants: ['language', 'a11y-menu', 'contrast', 'tts', 'shortcuts'],
	build(lib) {
		const accent = accentOf(lib);
		const hi = highlightOf(lib);

		const language = define({
			slug: `${lib.id}-accessibility-language`,
			name: 'Language Picker',
			library: lib.id,
			category: 'accessibility',
			description: `Locale picker in the ${lib.label} style — a globe trigger with the current language and chevron over an open menu of four locales with code chips, an active check, and an auto-detect toggle footer.`,
			tags: ['accessibility', 'i18n', 'language', 'locale', 'picker'],
			args: [
				stringArg('lang', 'EN', { label: 'Current language', maxLength: 8 }),
				enumArg('active', ['EN', 'ES', 'FR', 'JA'], 'EN', { label: 'Active locale' }),
				booleanArg('autoDetect', true, { label: 'Auto-detect' })
			],
			render: stack(
				{ width: '230px', gap: '8px', fontFamily: lib.font },
				row(
					{
						display: 'inline-flex',
						alignSelf: 'flex-start',
						gap: '8px',
						height: lib.control.sm,
						padding: '0 12px',
						background: lib.surface,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.border,
						borderRadius: lib.radius.md,
						boxShadow: lib.shadow.sm,
						color: lib.text
					},
					globeIcon(lib, 16),
					el('span', { style: { fontSize: lib.fontSize.sm, fontWeight: lib.buttonWeight } }, '{lang}'),
					icons.chevronDown(14, lib.muted)
				),
				el(
					'div',
					{ style: panel(lib, { padding: '4px', gap: '2px' }) },
					{
						ttRepeat: {
							count: 4,
							max: 4,
							node: row(
								{ gap: '8px', padding: '6px 8px', borderRadius: lib.radius.sm },
								el(
									'span',
									{
										style: {
											fontFamily: lib.fontMono,
											fontSize: lib.fontSize.xs,
											color: lib.muted,
											background: lib.surfaceAlt,
											borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
											padding: '1px 5px'
										}
									},
									map('n', { 1: 'EN', 2: 'ES', 3: 'FR', 4: 'JA' }, 'EN')
								),
								el(
									'span',
									{ style: { fontSize: lib.fontSize.sm, color: lib.text, flexGrow: 1 } },
									map('n', { 1: 'English', 2: 'Español', 3: 'Français', 4: '日本語' }, 'English')
								),
								el(
									'span',
									{ style: { fontSize: lib.fontSize.sm, fontWeight: 700, color: accent } },
									map(
										'n',
										{
											1: ifEq('active', 'EN', '✓', ''),
											2: ifEq('active', 'ES', '✓', ''),
											3: ifEq('active', 'FR', '✓', ''),
											4: ifEq('active', 'JA', '✓', '')
										},
										''
									)
								)
							)
						}
					},
					el('div', { style: { height: '1px', background: lib.borderSoft, margin: '2px 4px' } }),
					row(
						{ gap: '8px', padding: '6px 8px', justifyContent: 'space-between' },
						el('span', { style: { fontSize: lib.fontSize.sm, color: lib.muted } }, 'Auto-detect'),
						switchEl(lib, 'autoDetect')
					)
				)
			)
		});

		const stepBtn = (label) =>
			el(
				'button',
				{
					type: 'button',
					style: {
						width: '24px',
						height: '22px',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						padding: '0',
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.border,
						borderRadius: lib.radius.xs,
						background: lib.surface,
						color: lib.text,
						fontSize: lib.fontSize.xs,
						fontWeight: 600,
						cursor: 'pointer'
					}
				},
				label
			);

		const settingRow = (label, argName) =>
			row(
				{ justifyContent: 'space-between', gap: '10px' },
				el('span', { style: mutedLabel(lib) }, label),
				switchEl(lib, argName)
			);

		const a11yMenu = define({
			slug: `${lib.id}-accessibility-a11y-menu`,
			name: 'Accessibility Menu',
			library: lib.id,
			category: 'accessibility',
			description: `Accessibility settings menu in the ${lib.label} style — person-in-circle header, an A−/A+ text-size stepper, switches for reduce motion, screen-reader hints and dyslexia-friendly type, and a quiet reset footer.`,
			tags: ['accessibility', 'settings', 'menu', 'toggles'],
			args: [
				numberArg('textSize', 100, { label: 'Text size %' }),
				booleanArg('reduceMotion', true, { label: 'Reduce motion' }),
				booleanArg('srHints', false, { label: 'Screen-reader hints' }),
				booleanArg('dyslexiaFont', false, { label: 'Dyslexia-friendly font' })
			],
			render: el(
				'div',
				{ style: panel(lib, { width: '250px', padding: '12px', gap: '11px' }) },
				row(
					{ gap: '10px' },
					personIcon(lib, 22),
					stack(
						{ gap: '1px' },
						el('span', { style: { fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, ...upper(lib) } }, 'Accessibility'),
						el('span', { style: { fontSize: lib.fontSize.xs, color: lib.muted } }, 'Reading & display')
					)
				),
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					el('span', { style: mutedLabel(lib) }, 'Text size'),
					row(
						{ gap: '6px' },
						stepBtn('A−'),
						el(
							'span',
							{ style: { fontFamily: lib.fontMono, fontSize: lib.fontSize.sm, minWidth: '42px', textAlign: 'center' } },
							'{textSize}%'
						),
						stepBtn('A+')
					)
				),
				settingRow('Reduce motion', 'reduceMotion'),
				settingRow('Screen-reader hints', 'srHints'),
				settingRow('Dyslexia-friendly font', 'dyslexiaFont'),
				el(
					'button',
					{
						type: 'button',
						style: {
							background: 'transparent',
							border: 'none',
							color: lib.muted,
							fontFamily: lib.font,
							fontSize: lib.fontSize.sm,
							fontWeight: lib.buttonWeight,
							padding: '3px 0 0',
							cursor: 'pointer',
							...upper(lib)
						}
					},
					'Reset to defaults'
				)
			)
		});

		// High-contrast tile flips to white-on-black in inverted mode.
		const hcInk = () => ifEq('mode', 'inverted', '#ffffff', '#000000');
		const hcPaper = () => ifEq('mode', 'inverted', '#000000', '#ffffff');
		const mockLine = (background, width) =>
			el('div', { style: { height: '4px', borderRadius: '2px', background, width } });

		const seg = (value, label) =>
			el(
				'span',
				{
					style: merge(
						{
							fontSize: lib.fontSize.xs,
							fontWeight: 600,
							padding: '3px 10px',
							borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
							color: lib.muted,
							cursor: 'pointer',
							...upper(lib)
						},
						ifEq('mode', value, { background: accent, color: accentOnOf(lib) }, {})
					)
				},
				label
			);

		const contrast = define({
			slug: `${lib.id}-accessibility-contrast`,
			name: 'Contrast Preview',
			library: lib.id,
			category: 'accessibility',
			description: `Contrast toggle preview in the ${lib.label} style — side-by-side mini card mocks (library-normal vs thick-bordered ink-on-white high contrast) over a normal/high/inverted segmented toggle and a WCAG level chip.`,
			tags: ['accessibility', 'contrast', 'wcag', 'preview'],
			args: [
				enumArg('mode', ['normal', 'high', 'inverted'], 'high', { label: 'Contrast mode' }),
				enumArg('wcag', ['AA', 'AAA'], 'AA', { label: 'WCAG level' }),
				stringArg('sample', 'Aa', { label: 'Sample glyphs', maxLength: 6 })
			],
			render: el(
				'div',
				{ style: panel(lib, { width: '270px', padding: '12px', gap: '10px' }) },
				row(
					{ gap: '10px', alignItems: 'stretch' },
					el(
						'div',
						{
							style: {
								display: 'flex',
								flexDirection: 'column',
								gap: '6px',
								padding: '10px',
								flexGrow: 1,
								minWidth: 0,
								borderRadius: lib.radius.md,
								background: lib.surfaceAlt,
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: lib.borderSoft,
								boxShadow: ifEq('mode', 'normal', lib.focusRing, 'none')
							}
						},
						el('div', { style: { fontSize: lib.fontSize.xl, fontWeight: lib.headingWeight, color: lib.text } }, '{sample}'),
						mockLine(lib.faint, '90%'),
						mockLine(lib.faint, '65%'),
						el(
							'span',
							{
								style: {
									alignSelf: 'flex-start',
									fontSize: lib.fontSize.xs,
									fontWeight: 600,
									padding: '2px 8px',
									borderRadius: lib.radius.sm,
									background: lib.palette.primary.soft,
									color: lib.palette.primary.onSoft
								}
							},
							'Button'
						)
					),
					el(
						'div',
						{
							style: {
								display: 'flex',
								flexDirection: 'column',
								gap: '6px',
								padding: '10px',
								flexGrow: 1,
								minWidth: 0,
								borderRadius: lib.radius.md,
								background: hcPaper(),
								borderWidth: '2px',
								borderStyle: 'solid',
								borderColor: hcInk(),
								boxShadow: ifEq('mode', 'normal', 'none', lib.focusRing)
							}
						},
						el('div', { style: { fontSize: lib.fontSize.xl, fontWeight: 700, color: hcInk() } }, '{sample}'),
						mockLine(hcInk(), '90%'),
						mockLine(hcInk(), '65%'),
						el(
							'span',
							{
								style: {
									alignSelf: 'flex-start',
									fontSize: lib.fontSize.xs,
									fontWeight: 700,
									padding: '2px 8px',
									borderRadius: lib.radius.sm,
									background: hcInk(),
									color: hcPaper()
								}
							},
							'Button'
						)
					)
				),
				row(
					{ gap: '8px', justifyContent: 'space-between', flexWrap: 'wrap' },
					row(
						{ gap: '2px', padding: '2px', background: lib.surfaceAlt, borderRadius: lib.radius.md },
						seg('normal', 'Normal'),
						seg('high', 'High'),
						seg('inverted', 'Inverted')
					),
					row(
						{ gap: '6px' },
						el('span', { style: { fontSize: lib.fontSize.xs, color: lib.faint } }, 'WCAG'),
						el(
							'span',
							{
								style: {
									fontSize: lib.fontSize.xs,
									fontWeight: 700,
									padding: '2px 8px',
									borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.pill,
									background: lib.palette.success.soft,
									color: lib.palette.success.onSoft
								}
							},
							'{wcag}'
						)
					)
				)
			)
		});

		const glyphSvg = (...children) =>
			el('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'currentColor', xmlns: 'http://www.w3.org/2000/svg' }, ...children);

		const tts = define({
			slug: `${lib.id}-accessibility-tts`,
			name: 'Text-to-Speech Bar',
			library: lib.id,
			category: 'accessibility',
			description: `Text-to-speech bar in the ${lib.label} style — accent play/pause circle beside the current sentence with a highlighted spoken word, a mono speed chip, a voice select mock, and a progress hairline.`,
			tags: ['accessibility', 'tts', 'speech', 'audio', 'player'],
			args: [
				booleanArg('playing', true, { label: 'Playing' }),
				stringArg('word', 'gently', { label: 'Highlighted word', maxLength: 16 }),
				numberArg('speed', 1.5, { label: 'Speed' }),
				stringArg('voice', 'Samantha', { label: 'Voice', maxLength: 16 }),
				numberArg('progress', 40, { label: 'Progress %' })
			],
			render: el(
				'div',
				{ style: panel(lib, { width: '290px', padding: '12px', gap: '10px' }) },
				row(
					{ gap: '10px', alignItems: 'flex-start' },
					el(
						'button',
						{
							type: 'button',
							style: {
								width: '36px',
								height: '36px',
								borderRadius: lib.radius.pill,
								border: 'none',
								background: accent,
								color: accentOnOf(lib),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0,
								cursor: 'pointer',
								boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
							}
						},
						iff(
							'playing',
							glyphSvg(el('rect', { x: 6, y: 5, width: 4, height: 14, rx: 1 }), el('rect', { x: 14, y: 5, width: 4, height: 14, rx: 1 })),
							glyphSvg(el('polygon', { points: '8 5 19 12 8 19' }))
						)
					),
					stack(
						{ gap: '8px', flexGrow: 1, minWidth: 0 },
						el(
							'div',
							{ style: { fontSize: lib.fontSize.sm, color: lib.muted, lineHeight: 1.5 } },
							'Each word is spoken ',
							el(
								'span',
								{
									style: {
										background: hi.soft,
										color: hi.onSoft,
										borderRadius: lib.radius.xs,
										padding: '0 4px',
										fontWeight: 600
									}
								},
								'{word}'
							),
							' as the narration moves.'
						),
						row(
							{ gap: '6px', flexWrap: 'wrap' },
							el(
								'span',
								{
									style: {
										fontFamily: lib.fontMono,
										fontSize: lib.fontSize.xs,
										fontWeight: 600,
										color: lib.text,
										background: lib.surfaceAlt,
										borderRadius: lib.radius.pill,
										padding: '2px 8px'
									}
								},
								'{speed}×'
							),
							row(
								{
									display: 'inline-flex',
									gap: '6px',
									padding: '2px 8px',
									background: lib.surface,
									borderWidth: '1px',
									borderStyle: 'solid',
									borderColor: lib.border,
									borderRadius: lib.id === 'antd' ? lib.radius.xs : lib.radius.sm,
									fontSize: lib.fontSize.xs,
									color: lib.text
								},
								'{voice}',
								icons.chevronDown(12, lib.muted)
							)
						)
					)
				),
				el(
					'div',
					{ style: { height: '3px', borderRadius: lib.radius.pill, background: lib.borderSoft, overflow: 'hidden' } },
					el('div', {
						style: {
							height: '3px',
							width: '{progress}%',
							borderRadius: lib.radius.pill,
							background: lib.id === 'thingtime' ? lib.rainbow : accent
						}
					})
				)
			)
		});

		const catDivider = (label) =>
			row(
				{ gap: '6px', padding: '6px 0 3px' },
				el(
					'span',
					{
						style: {
							fontFamily: lib.fontMono,
							fontSize: '10px',
							letterSpacing: '0.08em',
							textTransform: 'uppercase',
							color: lib.faint
						}
					},
					label
				),
				el('span', { style: { height: '1px', background: lib.borderSoft, flexGrow: 1 } })
			);

		const shortcuts = define({
			slug: `${lib.id}-accessibility-shortcuts`,
			name: 'Keyboard Shortcuts Overlay',
			library: lib.id,
			category: 'accessibility',
			description: `Keyboard hints overlay in the ${lib.label} style — titled panel with an esc-to-close caption, two-column shortcut rows pairing actions with keycap chips (⌘ K, G then D), mono category dividers, and a Show all ghost.`,
			tags: ['accessibility', 'keyboard', 'shortcuts', 'overlay'],
			args: [
				stringArg('title', 'Keyboard shortcuts', { label: 'Title', maxLength: 32 }),
				numberArg('rows', 5, { label: 'Rows shown' }),
				booleanArg('dense', false, { label: 'Dense rows' })
			],
			render: el(
				'div',
				{ style: panel(lib, { width: '280px', padding: '12px', gap: '6px' }) },
				row(
					{ justifyContent: 'space-between', gap: '10px' },
					el('span', { style: { fontSize: lib.fontSize.md, fontWeight: lib.headingWeight, ...upper(lib) } }, '{title}'),
					row(
						{ gap: '5px' },
						kbdChip(lib, 'esc'),
						el('span', { style: { fontSize: lib.fontSize.xs, color: lib.faint } }, 'to close')
					)
				),
				{
					ttRepeat: {
						arg: 'rows',
						max: 6,
						node: stack(
							{},
							map('n', { 1: catDivider('General'), 4: catDivider('Navigation') }),
							row(
								{ justifyContent: 'space-between', gap: '12px', padding: iff('dense', '2px 0', '5px 0') },
								el(
									'span',
									{ style: { fontSize: lib.fontSize.sm, color: lib.text } },
									map(
										'n',
										{
											1: 'Command palette',
											2: 'Show shortcuts',
											3: 'Search things',
											4: 'Go to dashboard',
											5: 'New thing',
											6: 'Toggle theme'
										},
										'Command palette'
									)
								),
								row(
									{ gap: '4px', flexShrink: 0 },
									kbdChip(lib, map('n', { 1: '⌘ K', 2: '?', 3: '/', 4: 'G', 5: 'N', 6: '⇧ T' }, '·')),
									map('n', {
										4: [
											el('span', { style: { fontSize: '10px', color: lib.faint } }, 'then'),
											kbdChip(lib, 'D')
										]
									})
								)
							)
						)
					}
				},
				el(
					'button',
					{
						type: 'button',
						style: {
							background: 'transparent',
							border: 'none',
							color: accent,
							fontFamily: lib.font,
							fontSize: lib.fontSize.sm,
							fontWeight: lib.buttonWeight,
							padding: '4px 0 0',
							cursor: 'pointer',
							alignSelf: 'flex-start',
							...upper(lib)
						}
					},
					'Show all'
				)
			)
		});

		return [language, a11yMenu, contrast, tts, shortcuts];
	}
};
