// Breadcrumb & pagination archetype — wayfinding chrome: breadcrumb trails
// (plain and icon-led), numbered pagination, a compact prev/next pager, and a
// results summary. Follows the button.mjs exemplar contract: exactly 5
// variants, `build(lib)` returns exactly 5 definitions (one per variant, same
// order), slugs `${lib.id}-breadcrumb-pagination-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	ifEq,
	iff,
	map,
	merge,
	numberArg,
	row,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// helpers.mjs ships chevronRight but no left twin — mirror it locally.
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

// Library personality: Bootstrap and Thingtime separate crumbs with a slash,
// the rest use a chevron glyph.
const separator = (lib) =>
	['bootstrap', 'thingtime'].includes(lib.id)
		? el('span', { style: { color: lib.faint, padding: '0 8px', fontSize: lib.fontSize.sm } }, '/')
		: el(
				'span',
				{ style: { display: 'inline-flex', alignItems: 'center', padding: '0 4px', color: lib.faint } },
				icons.chevronRight(14, lib.faint)
			);

const currentCrumb = (lib, value) =>
	el(
		'span',
		{
			style: {
				color: toneMap(lib, (palette) => palette.solid),
				fontWeight: lib.headingWeight
			}
		},
		value
	);

const roundItems = (lib) => lib.id === 'mui' || lib.id === 'thingtime';

export const archetype = {
	id: 'breadcrumb-pagination',
	category: 'navigation',
	variants: ['breadcrumb', 'breadcrumb-icons', 'pagination', 'compact', 'summary'],
	build(lib) {
		const breadcrumb = define({
			slug: `${lib.id}-breadcrumb-pagination-breadcrumb`,
			name: 'Breadcrumb',
			library: lib.id,
			category: 'navigation',
			description: `Three-level breadcrumb trail in the ${lib.label} style — muted ancestor crumbs, ${['bootstrap', 'thingtime'].includes(lib.id) ? 'slash' : 'chevron'} separators, and a tone-colored current page.`,
			tags: ['breadcrumb', 'navigation', 'trail', 'path'],
			args: [
				stringArg('root', 'Home', { label: 'Root', maxLength: 30 }),
				stringArg('section', 'Library', { label: 'Section', maxLength: 30 }),
				stringArg('page', 'Components', { label: 'Current page', maxLength: 30 }),
				toneArg()
			],
			render: el(
				'nav',
				{ style: { display: 'flex', alignItems: 'center', fontFamily: lib.font, fontSize: lib.fontSize.sm } },
				el('span', { style: { color: lib.muted } }, '{root}'),
				separator(lib),
				el('span', { style: { color: lib.muted } }, '{section}'),
				separator(lib),
				currentCrumb(lib, '{page}')
			)
		});

		const breadcrumbIcons = define({
			slug: `${lib.id}-breadcrumb-pagination-breadcrumb-icons`,
			name: 'Breadcrumb with Icons',
			library: lib.id,
			category: 'navigation',
			description: `Icon-led breadcrumb in the ${lib.label} style — a tone-colored home glyph, a folder-labeled section crumb, and the current page in library type.`,
			tags: ['breadcrumb', 'navigation', 'icons', 'home'],
			args: [
				stringArg('section', 'Projects', { label: 'Section', maxLength: 30 }),
				stringArg('page', 'Roadmap', { label: 'Current page', maxLength: 30 }),
				toneArg(),
				booleanArg('showHome', true, { label: 'Show home icon' })
			],
			render: el(
				'nav',
				{ style: { display: 'flex', alignItems: 'center', fontFamily: lib.font, fontSize: lib.fontSize.sm } },
				iff('showHome', [
					el(
						'span',
						{ style: { display: 'inline-flex', alignItems: 'center', color: toneMap(lib, (palette) => palette.solid) } },
						icons.home(15, 'currentColor')
					),
					separator(lib)
				]),
				el(
					'span',
					{ style: { display: 'inline-flex', alignItems: 'center', gap: '6px', color: lib.muted } },
					icons.folder(14, 'currentColor'),
					'{section}'
				),
				separator(lib),
				currentCrumb(lib, '{page}')
			)
		});

		// Numbered pagination: fixed five-page row, active page picked by enum.
		const outlined = ['antd', 'bootstrap'].includes(lib.id);
		const itemBase = {
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			width: map('size', { sm: lib.control.sm, md: lib.control.md }, lib.control.sm),
			height: map('size', { sm: lib.control.sm, md: lib.control.md }, lib.control.sm),
			borderRadius: roundItems(lib) ? lib.radius.pill : lib.radius.sm,
			fontFamily: lib.font,
			fontSize: map('size', { sm: lib.fontSize.sm, md: lib.fontSize.md }, lib.fontSize.sm),
			fontWeight: lib.buttonWeight,
			cursor: 'pointer',
			background: outlined ? lib.surface : 'transparent',
			color: lib.text,
			borderWidth: '1px',
			borderStyle: 'solid',
			borderColor: outlined ? lib.border : 'transparent'
		};
		const activeItem = {
			background: toneMap(lib, (palette) => palette.solid),
			color: toneMap(lib, (palette) => palette.onSolid),
			borderColor: toneMap(lib, (palette) => palette.solid)
		};
		const pageButton = (n) =>
			el('button', { type: 'button', style: merge(itemBase, ifEq('page', String(n), activeItem)) }, String(n));
		const edgeButton = (icon) => el('button', { type: 'button', style: { ...itemBase, color: lib.muted } }, icon);

		const pagination = define({
			slug: `${lib.id}-breadcrumb-pagination-pagination`,
			name: 'Pagination',
			library: lib.id,
			category: 'navigation',
			description: `Numbered pagination in the ${lib.label} style — chevron edges around five ${roundItems(lib) ? 'circular' : outlined ? 'bordered' : 'quiet'} page buttons, with the active page filled in the chosen tone.`,
			tags: ['pagination', 'navigation', 'pages', 'numbered'],
			args: [
				enumArg('page', ['1', '2', '3', '4', '5'], '3', { label: 'Active page' }),
				toneArg(),
				enumArg('size', ['sm', 'md'], 'sm', { label: 'Size' })
			],
			render: row(
				{ gap: '6px' },
				edgeButton(chevronLeft(16, 'currentColor')),
				[1, 2, 3, 4, 5].map(pageButton),
				edgeButton(icons.chevronRight(16, 'currentColor'))
			)
		});

		const controlBase = {
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			gap: '6px',
			height: lib.control.sm,
			padding: '0 12px',
			borderRadius: lib.radius.md,
			fontFamily: lib.font,
			fontSize: lib.fontSize.sm,
			fontWeight: lib.buttonWeight,
			cursor: 'pointer',
			...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
		};

		const compact = define({
			slug: `${lib.id}-breadcrumb-pagination-compact`,
			name: 'Compact Pagination',
			library: lib.id,
			category: 'navigation',
			description: `Compact prev/next pager in the ${lib.label} style — outlined previous button, "Page X of Y" readout, and a tone-solid next button.`,
			tags: ['pagination', 'navigation', 'compact', 'pager'],
			args: [
				numberArg('page', 2, { label: 'Page', min: 1 }),
				numberArg('pages', 8, { label: 'Total pages', min: 1 }),
				toneArg(),
				booleanArg('labels', true, { label: 'Show labels' })
			],
			render: row(
				{ gap: '12px', fontFamily: lib.font },
				el(
					'button',
					{
						type: 'button',
						style: {
							...controlBase,
							background: lib.surface,
							color: lib.text,
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: lib.border
						}
					},
					chevronLeft(14, 'currentColor'),
					iff('labels', 'Prev')
				),
				text({ fontSize: lib.fontSize.sm, color: lib.muted }, 'Page {page} of {pages}'),
				el(
					'button',
					{
						type: 'button',
						style: {
							...controlBase,
							border: 'none',
							background: toneMap(lib, (palette) => palette.solid),
							color: toneMap(lib, (palette) => palette.onSolid),
							boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm
						}
					},
					iff('labels', 'Next'),
					icons.chevronRight(14, 'currentColor')
				)
			)
		});

		const summaryButton = (icon) =>
			el(
				'button',
				{
					type: 'button',
					style: {
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: lib.control.sm,
						height: lib.control.sm,
						borderRadius: roundItems(lib) ? lib.radius.pill : lib.radius.sm,
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: lib.border,
						background: lib.surface,
						color: toneMap(lib, (palette) => palette.solid),
						cursor: 'pointer'
					}
				},
				icon
			);

		const summary = define({
			slug: `${lib.id}-breadcrumb-pagination-summary`,
			name: 'Results Summary',
			library: lib.id,
			category: 'navigation',
			description: `Results summary pager in the ${lib.label} style — "Showing X–Y of Z" with emphasized counts beside tone-colored prev/next chevron buttons.`,
			tags: ['pagination', 'navigation', 'summary', 'results'],
			args: [
				numberArg('from', 1, { label: 'From', min: 1 }),
				numberArg('to', 10, { label: 'To', min: 1 }),
				numberArg('total', 42, { label: 'Total', min: 1 }),
				toneArg()
			],
			render: row(
				{ gap: '16px', justifyContent: 'space-between', width: '320px', fontFamily: lib.font },
				el(
					'span',
					{ style: { fontSize: lib.fontSize.sm, color: lib.muted } },
					'Showing ',
					el('strong', { style: { color: lib.text, fontWeight: lib.headingWeight } }, '{from}–{to}'),
					' of ',
					el('strong', { style: { color: lib.text, fontWeight: lib.headingWeight } }, '{total}')
				),
				row(
					{ gap: '8px' },
					summaryButton(chevronLeft(16, 'currentColor')),
					summaryButton(icons.chevronRight(16, 'currentColor'))
				)
			)
		});

		return [breadcrumb, breadcrumbIcons, pagination, compact, summary];
	}
};
