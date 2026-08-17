// Docs & wiki archetype — five documentation surfaces: article header,
// on-this-page ToC rail, stacked callouts, footnote references, and a docs
// version picker. Follows the button.mjs exemplar: exactly 5 variants,
// `build(lib)` returns exactly 5 definitions (one per variant, same order),
// slugs `${lib.id}-docs-wiki-<variant>`.

import {
	avatarCircle,
	booleanArg,
	define,
	el,
	icons,
	ifEq,
	iff,
	map,
	merge,
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

// antd chips sit on tight corners and reactflow chrome stays crisp; everyone
// else wears the pill (mirrors the badge exemplar).
const chipRadius = (lib) => (lib.id === 'antd' ? lib.radius.xs : lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);

// thingtime headings run in ink.
const headingInk = (lib) => (lib.id === 'thingtime' ? lib.ink : lib.text);

// Docs link color: reactflow signs links in its accent, shadcn/thingtime have
// near-black primaries so their info hue carries links; everyone else links in
// the primary tone.
const linkColor = (lib) =>
	lib.id === 'reactflow'
		? lib.accent
		: lib.id === 'shadcn' || lib.id === 'thingtime'
		? lib.palette.info.solid
		: lib.palette.primary.solid;

// Mono section kicker ('ON THIS PAGE', 'REFERENCES').
const kicker = (lib, label) =>
	text({ fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, fontWeight: 600, letterSpacing: '0.08em', color: lib.faint }, label);

// Quiet card shell shared by the doc surfaces.
const card = (lib, extra = {}) => ({
	background: lib.surface,
	border: `1px solid ${lib.borderSoft}`,
	borderRadius: lib.radius.lg,
	padding: '16px',
	fontFamily: lib.font,
	...extra
});

// thingtime signs its hairline rule with the rainbow; reactflow dashes it like
// a canvas edge; everyone else keeps a quiet hairline.
const hairline = (lib) =>
	lib.id === 'thingtime'
		? el('div', { style: { height: '2px', borderRadius: lib.radius.pill, background: lib.rainbow } })
		: lib.id === 'reactflow'
		? el('div', { style: { height: '0px', borderTop: `1px dashed ${lib.dot}` } })
		: el('div', { style: { height: '1px', background: lib.borderSoft } });

// On-this-page entries: [label, indented] — nesting mirrors h2/h3 levels.
const TOC_ITEMS = [
	['Overview', false],
	['Prerequisites', true],
	['Install the CLI', true],
	['Configuration', false],
	['Environment variables', true],
	['Troubleshooting', false]
];

// One ToC row: hairline-quiet by default, tone accent bar + bold when active.
const tocItem = (lib, n, label, indented) =>
	el(
		'div',
		{
			style: merge(
				{
					display: 'flex',
					alignItems: 'center',
					minHeight: '26px',
					paddingLeft: indented ? '16px' : '0px',
					fontSize: lib.fontSize.sm,
					lineHeight: 1.3
				},
				ifEq(
					'active',
					n,
					{ color: headingInk(lib), fontWeight: lib.id === 'daisyui' ? 700 : 600 },
					{ color: lib.muted, fontWeight: 400 }
				)
			)
		},
		ifEq(
			'active',
			n,
			el('span', {
				style: {
					width: '3px',
					height: '14px',
					borderRadius: lib.radius.pill,
					background: toneMap(lib, (palette) => palette.solid),
					marginRight: '8px',
					flexShrink: 0
				}
			}),
			el('span', { style: { width: '3px', height: '14px', marginRight: '8px', flexShrink: 0 } })
		),
		label
	);

// One doc callout: icon + bold title + one-line body on a soft tone tint.
const callout = (lib, palette, icon, titleChild, bodyChild) =>
	el(
		'div',
		{
			style: merge(
				{
					display: 'flex',
					alignItems: 'flex-start',
					gap: '10px',
					padding: '12px 14px',
					borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
					background: palette.soft,
					fontFamily: lib.font
				},
				iff('bordered', { border: `1px solid ${palette.border}` })
			)
		},
		el('div', { style: { display: 'flex', flexShrink: 0, marginTop: '1px' } }, icon),
		stack(
			{ gap: '2px' },
			text({ fontSize: lib.fontSize.sm, fontWeight: lib.id === 'daisyui' ? 700 : 600, color: palette.onSoft }, titleChild),
			text({ fontSize: lib.fontSize.sm, color: lib.text, lineHeight: 1.4 }, bodyChild)
		)
	);

export const archetype = {
	id: 'docs-wiki',
	category: 'documentation',
	variants: ['article-header', 'toc', 'callouts', 'references', 'version'],
	build(lib) {
		// mui avatars sit on solid primary; thingtime winks with the rainbow.
		const avatarBg = lib.id === 'thingtime' ? lib.rainbow : lib.id === 'mui' ? lib.palette.primary.solid : lib.palette.primary.soft;
		const avatarFg = lib.id === 'thingtime' ? lib.surface : lib.id === 'mui' ? lib.palette.primary.onSolid : lib.palette.primary.onSoft;

		const articleHeader = define({
			slug: `${lib.id}-docs-wiki-article-header`,
			name: 'Doc Article Header',
			library: lib.id,
			category: 'documentation',
			description: `Documentation page header in the ${lib.label} style — breadcrumb trail, article title, updated caption, read-time chip and author row over a ${
				lib.id === 'thingtime' ? 'rainbow' : lib.id === 'reactflow' ? 'dashed' : 'quiet'
			} hairline rule.`,
			tags: ['docs', 'header', 'breadcrumb', 'article'],
			args: [
				stringArg('title', 'Getting started', { label: 'Title', maxLength: 60 }),
				stringArg('section', 'Guides', { label: 'Section', maxLength: 32 }),
				stringArg('author', 'Mara Chen', { label: 'Author', maxLength: 40 }),
				stringArg('readTime', '6 min read', { label: 'Read time', maxLength: 20 }),
				stringArg('updated', 'Updated Aug 12', { label: 'Updated', maxLength: 32 })
			],
			render: stack(
				card(lib, { gap: '12px', minWidth: '320px', maxWidth: '460px' }),
				row(
					{ gap: '6px', fontSize: lib.fontSize.xs, color: lib.muted },
					'Docs',
					text({ color: lib.faint }, '/'),
					'{section}',
					text({ color: lib.faint }, '/'),
					text({ color: headingInk(lib), fontWeight: 500 }, '{title}')
				),
				el(
					'h1',
					{ style: { margin: 0, fontSize: lib.fontSize.xl, lineHeight: 1.2, fontWeight: lib.headingWeight, color: headingInk(lib) } },
					'{title}'
				),
				row(
					{ gap: '12px', flexWrap: 'wrap', fontSize: lib.fontSize.xs, color: lib.muted },
					'{updated}',
					el(
						'span',
						{
							style: {
								display: 'inline-flex',
								alignItems: 'center',
								gap: '5px',
								padding: '2px 8px',
								borderRadius: chipRadius(lib),
								background: lib.surfaceAlt,
								border: `1px solid ${lib.border}`,
								color: lib.muted,
								fontWeight: 500,
								boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
							}
						},
						icons.clock(11, 'currentColor'),
						'{readTime}'
					),
					row(
						{ gap: '6px' },
						avatarCircle('20px', avatarBg, avatarFg, icons.user(11, avatarFg), lib.fontSize.xs),
						text({ color: lib.text, fontWeight: 500 }, '{author}')
					)
				),
				hairline(lib)
			)
		});

		const toc = define({
			slug: `${lib.id}-docs-wiki-toc`,
			name: 'On This Page ToC',
			library: lib.id,
			category: 'documentation',
			description: `On-this-page rail in the ${lib.label} style — mono kicker over nested section links, a tone accent bar bolding the active item, and a tone-filled reading-progress hairline on the left.`,
			tags: ['docs', 'toc', 'navigation', 'progress'],
			args: [
				numberArg('active', 3, { label: 'Active item', min: 1, max: 6 }),
				numberArg('progress', 45, { label: 'Progress %', min: 0, max: 100 }),
				toneArg()
			],
			render: stack(
				card(lib, { gap: '10px', width: '240px' }),
				kicker(lib, 'ON THIS PAGE'),
				row(
					{ gap: '10px', alignItems: 'stretch' },
					el(
						'div',
						{ style: { width: '3px', borderRadius: lib.radius.pill, background: lib.borderSoft, overflow: 'hidden', flexShrink: 0 } },
						el('div', {
							style: {
								width: '100%',
								height: '{progress}%',
								background: toneMap(lib, (palette) => palette.solid),
								borderRadius: lib.radius.pill
							}
						})
					),
					stack({ gap: '2px', flexGrow: 1 }, ...TOC_ITEMS.map(([label, indented], index) => tocItem(lib, index + 1, label, indented)))
				)
			)
		});

		const callouts = define({
			slug: `${lib.id}-docs-wiki-callouts`,
			name: 'Doc Callout Stack',
			library: lib.id,
			category: 'documentation',
			description: `Stacked documentation callouts in the ${lib.label} style — an info note, a warning and a success tip, each pairing an icon with a bold title and one-line body on a soft tone tint.`,
			tags: ['docs', 'callout', 'note', 'warning', 'tip'],
			args: [
				stringArg('title', 'Note', { label: 'Note title', maxLength: 40 }),
				textArg('body', 'Environment variables load from .env.local before every build.', { label: 'Note body', maxLength: 120 }),
				booleanArg('bordered', true, { label: 'Bordered' })
			],
			render: stack(
				{ gap: '10px', minWidth: '300px', maxWidth: '420px', fontFamily: lib.font },
				callout(lib, lib.palette.info, icons.info(16, lib.palette.info.onSoft), '{title}', '{body}'),
				callout(
					lib,
					lib.palette.warning,
					icons.alert(16, lib.palette.warning.onSoft),
					'Warning',
					'Rotating this key signs out every active session immediately.'
				),
				callout(
					lib,
					lib.palette.success,
					icons.zap(16, lib.palette.success.onSoft),
					'Tip',
					'Pass --watch to rebuild the docs preview on every save.'
				)
			)
		});

		const references = define({
			slug: `${lib.id}-docs-wiki-references`,
			name: 'Doc References',
			library: lib.id,
			category: 'documentation',
			description: `Footnote reference block in the ${lib.label} style — mono REFERENCES kicker over numbered link-colored citations with source captions, closed by a back-to-article chip.`,
			tags: ['docs', 'references', 'footnote', 'citation'],
			args: [
				stringArg('refTitle', 'Structured docs at scale', { label: 'First title', maxLength: 60 }),
				stringArg('refSource', 'writethedocs.org', { label: 'First source', maxLength: 40 }),
				numberArg('count', 3, { label: 'References', min: 2, max: 3 })
			],
			render: stack(
				card(lib, { gap: '10px', minWidth: '300px', maxWidth: '420px' }),
				kicker(lib, 'REFERENCES'),
				repeat(
					'count',
					3,
					el(
						'div',
						{ style: { display: 'flex', alignItems: 'flex-start', gap: '10px' } },
						el(
							'span',
							{ style: { fontFamily: lib.fontMono, fontSize: lib.fontSize.xs, color: lib.faint, paddingTop: '2px', flexShrink: 0 } },
							'[{n}]'
						),
						stack(
							{ gap: '2px' },
							el(
								'span',
								{
									style: {
										fontSize: lib.fontSize.sm,
										fontWeight: 500,
										color: linkColor(lib),
										...(lib.id === 'bootstrap' ? { textDecoration: 'underline' } : {})
									}
								},
								map('n', { 1: '{refTitle}', 2: 'HTTP caching primer', 3: 'Semantic line breaks' }, '{refTitle}')
							),
							el(
								'span',
								{ style: { fontSize: lib.fontSize.xs, color: lib.muted } },
								map('n', { 1: '{refSource}', 2: 'developer.mozilla.org', 3: 'sembr.org' }, '{refSource}')
							)
						)
					)
				),
				el(
					'span',
					{
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							gap: '6px',
							alignSelf: 'flex-start',
							padding: '3px 10px',
							borderRadius: chipRadius(lib),
							background: lib.surfaceAlt,
							border: `1px solid ${lib.border}`,
							fontSize: lib.fontSize.xs,
							fontWeight: 500,
							color: lib.muted,
							boxShadow: lib.id === 'untitled' ? lib.shadow.sm : 'none'
						}
					},
					icons.arrowUp(12, 'currentColor'),
					'Back to article'
				)
			)
		});

		const version = define({
			slug: `${lib.id}-docs-wiki-version`,
			name: 'Docs Version Picker',
			library: lib.id,
			category: 'documentation',
			description: `Docs version picker in the ${lib.label} style — mono version pill trigger over an ${
				lib.id === 'mui' ? 'elevated' : 'open'
			} menu that tags the latest release with a tone chip, checks the active row and ends in a ghost changelog row.`,
			tags: ['docs', 'version', 'picker', 'menu'],
			args: [
				stringArg('version', '2.4', { label: 'Version', maxLength: 12 }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'success'),
				booleanArg('open', true, { label: 'Menu open' })
			],
			render: stack(
				{ gap: '8px', alignItems: 'flex-start', fontFamily: lib.font },
				el(
					'button',
					{
						type: 'button',
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							gap: '6px',
							height: lib.control.sm,
							padding: '0 12px',
							borderRadius: lib.id === 'antd' || lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill,
							border: `1px solid ${lib.border}`,
							background: lib.surface,
							color: lib.text,
							fontFamily: lib.fontMono,
							fontSize: lib.fontSize.sm,
							fontWeight: 600,
							cursor: 'pointer',
							boxShadow: lib.id === 'untitled' || lib.id === 'mui' ? lib.shadow.sm : 'none'
						}
					},
					'v{version}',
					icons.chevronDown(14, 'currentColor')
				),
				iff(
					'open',
					stack(
						{
							gap: '2px',
							width: '220px',
							padding: '6px',
							background: lib.surface,
							borderRadius: lib.id === 'daisyui' ? lib.radius.lg : lib.radius.md,
							border: `1px solid ${lib.id === 'reactflow' ? lib.border : lib.borderSoft}`,
							boxShadow: lib.shadow.lg
						},
						el(
							'div',
							{
								style: {
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									padding: '6px 10px',
									borderRadius: lib.radius.sm,
									background: lib.surfaceAlt
								}
							},
							row(
								{ gap: '8px' },
								el(
									'span',
									{ style: { fontFamily: lib.fontMono, fontSize: lib.fontSize.sm, fontWeight: 600, color: headingInk(lib) } },
									'v{version}'
								),
								el(
									'span',
									{
										style: {
											display: 'inline-flex',
											alignItems: 'center',
											padding: '1px 7px',
											borderRadius: chipRadius(lib),
											background: toneMap(lib, (palette) => palette.soft),
											color: toneMap(lib, (palette) => palette.onSoft),
											fontSize: lib.fontSize.xs,
											fontWeight: 700,
											...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: '0.04em' } : {})
										}
									},
									'latest'
								)
							),
							icons.check(14, toneMap(lib, (palette) => palette.solid))
						),
						el(
							'div',
							{ style: { padding: '6px 10px', borderRadius: lib.radius.sm, fontFamily: lib.fontMono, fontSize: lib.fontSize.sm, color: lib.muted } },
							'v2.3'
						),
						el(
							'div',
							{ style: { padding: '6px 10px', borderRadius: lib.radius.sm, fontFamily: lib.fontMono, fontSize: lib.fontSize.sm, color: lib.muted } },
							'v1.9'
						),
						el('div', { style: { height: '1px', background: lib.borderSoft, margin: '4px 2px' } }),
						row(
							{ gap: '6px', padding: '6px 10px', fontSize: lib.fontSize.sm, fontWeight: 500, color: lib.muted, cursor: 'pointer' },
							'View changelog',
							icons.arrowRight(12, 'currentColor')
						)
					)
				)
			)
		});

		return [articleHeader, toc, callouts, references, version];
	}
};
