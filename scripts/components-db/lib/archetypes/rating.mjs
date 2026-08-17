// Rating archetype — star/heart ratings and score scales in five renditions:
// arg-driven stars, labeled stars + review count, tone-colored hearts, a 1–10
// segmented score bar, and a review summary panel. Follows the button.mjs
// exemplar: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-rating-<variant>`.
//
// The core trick everywhere: the DSL can't do arithmetic, but CSS calc with a
// `{token}` interpolation can — a base row of outline glyphs sits under an
// absolutely positioned overflow-hidden overlay of filled glyphs whose width
// is `calc({arg} * 20px)`, so the arg drives the fill (3.5 clips mid-star).

import {
	booleanArg,
	define,
	el,
	icons,
	iff,
	numberArg,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

// Fixed-count repeat — one glyph node in the raw template serves a whole row,
// keeping the server's raw-JSON node count low.
const times = (count, node) => ({ ttRepeat: { count, max: count, node } });

// reactflow draws its empty glyphs in edge grey; everyone else fades to faint.
const emptyGlyph = (lib) => (lib.id === 'reactflow' ? lib.edge : lib.faint);

// Layered fill: 5 outline glyphs under a calc-clipped row of 5 filled glyphs.
// Glyphs are exactly 20px with zero gap so `calc({arg} * 20px)` clips exactly
// on glyph boundaries (and proportionally inside them for fractions).
const layeredGlyphs = (lib, argName, glyph, fillColor) =>
	el(
		'div',
		{ style: { position: 'relative', display: 'inline-flex' } },
		row({ gap: '0px' }, times(5, glyph(20, emptyGlyph(lib), false))),
		el(
			'div',
			{
				style: {
					position: 'absolute',
					top: '0px',
					left: '0px',
					height: '100%',
					width: `calc({${argName}} * 20px)`,
					overflow: 'hidden',
					whiteSpace: 'nowrap'
				}
			},
			row({ gap: '0px', width: '100px', flexShrink: 0 }, times(5, glyph(20, fillColor, true)))
		)
	);

export const archetype = {
	id: 'rating',
	category: 'data-display',
	variants: ['stars', 'labeled', 'hearts', 'scale', 'summary'],
	build(lib) {
		const starFill = toneMap(lib, (palette) => palette.solid, 'warning');

		const stars = define({
			slug: `${lib.id}-rating-stars`,
			name: 'Star Rating',
			library: lib.id,
			category: 'data-display',
			description: `Five-star rating row in the ${lib.label} style — the filled count is arg-driven through a calc-clipped overlay, so fractional scores like 3.5 fill half a star in the tone color.`,
			tags: ['rating', 'stars', 'score', 'review'],
			args: [
				numberArg('stars', 4, { label: 'Stars (0–5)', min: 0, max: 5 }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'warning'),
				booleanArg('showValue', false, { label: 'Show value' })
			],
			render: row(
				{ display: 'inline-flex', gap: '10px', fontFamily: lib.font },
				layeredGlyphs(lib, 'stars', icons.star, starFill),
				iff('showValue', text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.muted }, '{stars}/5'))
			)
		});

		const labeled = define({
			slug: `${lib.id}-rating-labeled`,
			name: 'Labeled Rating',
			library: lib.id,
			category: 'data-display',
			description: `Star rating with a score readout in the ${lib.label} style — calc-clipped tone stars beside an “out of 5” figure and a muted review count, for product cards and listings.`,
			tags: ['rating', 'stars', 'reviews', 'score'],
			args: [
				numberArg('score', 4.3, { label: 'Score (0–5)', min: 0, max: 5 }),
				stringArg('reviews', '1,284', { label: 'Review count', maxLength: 12 }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'warning')
			],
			render: row(
				{ display: 'inline-flex', gap: '10px', fontFamily: lib.font },
				layeredGlyphs(lib, 'score', icons.star, starFill),
				text({ fontSize: lib.fontSize.md, fontWeight: 600, color: lib.text }, '{score} out of 5'),
				text({ fontSize: lib.fontSize.sm, color: lib.muted }, '({reviews} reviews)')
			)
		});

		const hearts = define({
			slug: `${lib.id}-rating-hearts`,
			name: 'Heart Rating',
			library: lib.id,
			category: 'data-display',
			description: `Five-heart affection rating in the ${lib.label} style — tone-colored filled hearts clipped over ${lib.id === 'reactflow' ? 'edge-grey' : 'faint'} outlines, for favourites, reactions, and cozy scores.`,
			tags: ['rating', 'hearts', 'favorite', 'reaction'],
			args: [
				numberArg('hearts', 3, { label: 'Hearts (0–5)', min: 0, max: 5 }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'danger'),
				booleanArg('showValue', true, { label: 'Show value' })
			],
			render: row(
				{ display: 'inline-flex', gap: '10px', fontFamily: lib.font },
				layeredGlyphs(lib, 'hearts', icons.heart, toneMap(lib, (palette) => palette.solid, 'danger')),
				iff('showValue', text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.muted }, '{hearts}/5'))
			)
		});

		const scaleCell = (background) =>
			el('div', {
				style: {
					width: '20px',
					height: '12px',
					borderRadius: lib.radius.xs,
					background,
					flexShrink: 0
				}
			});

		const scale = define({
			slug: `${lib.id}-rating-scale`,
			name: 'Score Scale',
			library: lib.id,
			category: 'data-display',
			description: `Segmented 1–10 score bar in the ${lib.label} style — ten fixed cells with the active run tone-colored through a calc-clipped overlay, under a ${lib.uppercaseButtons ? 'uppercase ' : ''}label and mono score readout.`,
			tags: ['rating', 'scale', 'score', 'segments', 'meter'],
			args: [
				numberArg('score', 7, { label: 'Score (0–10)', min: 0, max: 10 }),
				stringArg('label', 'Performance', { label: 'Label', maxLength: 24 }),
				toneArg()
			],
			render: stack(
				{ display: 'inline-flex', gap: '8px', fontFamily: lib.font },
				row(
					{ justifyContent: 'space-between', gap: '12px' },
					text(
						{
							fontSize: lib.fontSize.sm,
							fontWeight: lib.headingWeight,
							color: lib.text,
							...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: lib.buttonLetterSpacing } : {})
						},
						'{label}'
					),
					text({ fontSize: lib.fontSize.sm, fontWeight: 600, color: lib.muted, fontFamily: lib.fontMono }, '{score}/10')
				),
				el(
					'div',
					{ style: { position: 'relative', display: 'inline-flex' } },
					row({ gap: '2px' }, times(10, scaleCell(lib.borderSoft))),
					el(
						'div',
						{
							style: {
								position: 'absolute',
								top: '0px',
								left: '0px',
								height: '100%',
								// Cells are 20px on a 2px gap: clipping at n * 22px lands
								// inside the empty gap after cell n, so integers read exact.
								width: 'calc({score} * 22px)',
								overflow: 'hidden',
								whiteSpace: 'nowrap'
							}
						},
						row({ gap: '2px', width: '218px', flexShrink: 0 }, times(10, scaleCell(toneMap(lib, (palette) => palette.solid))))
					)
				)
			)
		});

		const barFill = lib.id === 'thingtime' ? lib.rainbow : toneMap(lib, (palette) => palette.solid, 'warning');
		const distRow = (starCount, width) =>
			row(
				{ gap: '8px' },
				text(
					{ fontSize: lib.fontSize.xs, color: lib.muted, width: '20px', flexShrink: 0, fontFamily: lib.fontMono },
					`${starCount}★`
				),
				el(
					'div',
					{ style: { flex: 1, height: '8px', borderRadius: lib.radius.pill, background: lib.surfaceAlt, overflow: 'hidden' } },
					el('div', { style: { width, height: '100%', borderRadius: lib.radius.pill, background: barFill } })
				)
			);

		const summary = define({
			slug: `${lib.id}-rating-summary`,
			name: 'Rating Summary',
			library: lib.id,
			category: 'data-display',
			description: `Review summary panel in the ${lib.label} style — big average figure, calc-clipped stars, and five fixed distribution bars${lib.id === 'thingtime' ? ' washed in the house rainbow' : lib.id === 'untitled' ? ', floated on feather shadows' : ''}.`,
			tags: ['rating', 'summary', 'reviews', 'distribution', 'panel'],
			args: [
				numberArg('average', 4.6, { label: 'Average (0–5)', min: 0, max: 5 }),
				stringArg('reviews', '2,341', { label: 'Review count', maxLength: 12 }),
				toneArg(['primary', 'success', 'warning', 'danger', 'info', 'neutral'], 'warning')
			],
			render: stack(
				{
					gap: '12px',
					width: '260px',
					padding: '16px',
					boxSizing: 'border-box',
					background: lib.surface,
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: lib.border,
					borderRadius: lib.radius.lg,
					boxShadow: lib.id === 'untitled' ? lib.shadow.lg : lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
					fontFamily: lib.font
				},
				row(
					{ gap: '12px' },
					text({ fontSize: '32px', fontWeight: lib.headingWeight, color: lib.text, lineHeight: 1 }, '{average}'),
					stack(
						{ gap: '4px' },
						layeredGlyphs(lib, 'average', icons.star, starFill),
						text({ fontSize: lib.fontSize.xs, color: lib.muted }, '{reviews} reviews')
					)
				),
				stack(
					{ gap: '6px' },
					distRow(5, '82%'),
					distRow(4, '58%'),
					distRow(3, '31%'),
					distRow(2, '14%'),
					distRow(1, '6%')
				)
			)
		});

		return [stars, labeled, hearts, scale, summary];
	}
};
