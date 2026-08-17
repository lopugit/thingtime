// Stat / metric archetype — data-display statistics: single stat cards, KPI
// rows, trend stats, sparkline cards, and side-by-side comparisons.
// Contract mirrors button.mjs: exactly 5 variants, `build(lib)` returns
// exactly 5 definitions (one per variant, same order), slugs
// `${lib.id}-stat-metric-<variant>`.

import {
	booleanArg,
	define,
	el,
	enumArg,
	icons,
	ifEq,
	iff,
	row,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

const TONES = ['primary', 'success', 'warning', 'danger', 'info', 'neutral'];

// Stat surfaces stay light even for React Flow (dark borders belong on nodes).
const card = (lib, extra = {}) => ({
	fontFamily: lib.font,
	background: lib.surface,
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: lib.id === 'reactflow' ? lib.borderSoft : lib.border,
	borderRadius: lib.radius.lg,
	boxShadow: lib.id === 'mui' ? lib.shadow.md : lib.shadow.sm,
	boxSizing: 'border-box',
	...extra
});

const labelStyle = (lib) => ({
	fontSize: lib.fontSize.xs,
	fontWeight: lib.id === 'untitled' ? 500 : 400,
	color: lib.muted,
	...(lib.uppercaseButtons ? { textTransform: 'uppercase', letterSpacing: '0.08em' } : {})
});

const valueStyle = (lib, size = '24px') => ({
	fontSize: size,
	fontWeight: lib.headingWeight,
	color: lib.text,
	lineHeight: 1.15,
	fontVariantNumeric: 'tabular-nums'
});

const deltaPill = (lib) => ({
	display: 'inline-flex',
	alignItems: 'center',
	padding: '2px 8px',
	borderRadius: lib.radius.pill,
	fontSize: lib.fontSize.xs,
	fontWeight: 600,
	background: toneMap(lib, (palette) => palette.soft, 'success'),
	color: toneMap(lib, (palette) => palette.onSoft, 'success'),
	...(lib.id === 'untitled' || lib.id === 'shadcn'
		? { borderWidth: '1px', borderStyle: 'solid', borderColor: toneMap(lib, (palette) => palette.border, 'success') }
		: {})
});

const kpiTile = (lib, labelToken, valueToken) =>
	stack(
		{ gap: '4px', flex: '1 1 0', minWidth: '0', padding: '0 4px' },
		text(labelStyle(lib), labelToken),
		text(valueStyle(lib, lib.fontSize.xl), valueToken)
	);

const dividerV = (lib) =>
	el('div', { style: { width: '1px', alignSelf: 'stretch', background: lib.borderSoft, flexShrink: 0 } });

const SPARK_POINTS = '0 26 16 20 32 24 48 12 64 17 80 8 96 14 112 4 128 10';

export const archetype = {
	id: 'stat-metric',
	category: 'data-display',
	variants: ['card', 'kpi-row', 'trend', 'sparkline', 'comparison'],
	build(lib) {
		const statCard = define({
			slug: `${lib.id}-stat-metric-card`,
			name: 'Stat Card',
			library: lib.id,
			category: 'data-display',
			description: `Single-metric stat card in the ${lib.label} style — quiet label, large tabular value, and a tinted delta pill on ${lib.label} surface, border, and radius tokens.`,
			tags: ['stat', 'metric', 'card', 'kpi'],
			args: [
				stringArg('label', 'Monthly revenue', { label: 'Label', maxLength: 40 }),
				stringArg('value', '$48,210', { label: 'Value', maxLength: 20 }),
				stringArg('delta', '+12.4%', { label: 'Delta', maxLength: 12 }),
				toneArg(TONES, 'success')
			],
			render: stack(
				card(lib, { display: 'inline-flex', padding: '16px 20px', gap: '6px', minWidth: '200px' }),
				text(labelStyle(lib), '{label}'),
				text(valueStyle(lib), '{value}'),
				row(
					{ gap: '8px', marginTop: '2px' },
					el('span', { style: deltaPill(lib) }, '{delta}'),
					text({ fontSize: lib.fontSize.xs, color: lib.faint }, 'vs last month')
				)
			)
		});

		const kpiRow = define({
			slug: `${lib.id}-stat-metric-kpi-row`,
			name: 'KPI Row',
			library: lib.id,
			category: 'data-display',
			description: `Row of three KPI tiles in the ${lib.label} style — label-over-value pairs separated by hairline dividers inside one ${lib.label} card surface.`,
			tags: ['stat', 'kpi', 'row', 'dashboard'],
			args: [
				stringArg('label1', 'Views', { label: 'Label 1', maxLength: 24 }),
				stringArg('value1', '86.4k', { label: 'Value 1', maxLength: 16 }),
				stringArg('label2', 'Clicks', { label: 'Label 2', maxLength: 24 }),
				stringArg('value2', '12.9k', { label: 'Value 2', maxLength: 16 }),
				stringArg('label3', 'Signups', { label: 'Label 3', maxLength: 24 }),
				stringArg('value3', '1,204', { label: 'Value 3', maxLength: 16 })
			],
			render: row(
				card(lib, { padding: '16px 20px', gap: '16px', alignItems: 'stretch', maxWidth: '520px' }),
				kpiTile(lib, '{label1}', '{value1}'),
				dividerV(lib),
				kpiTile(lib, '{label2}', '{value2}'),
				dividerV(lib),
				kpiTile(lib, '{label3}', '{value3}')
			)
		});

		const trend = define({
			slug: `${lib.id}-stat-metric-trend`,
			name: 'Trend Stat',
			library: lib.id,
			category: 'data-display',
			description: `Trend stat card in the ${lib.label} style — large value with an up or down arrow whose glyph and color flip on the direction enum (green rise, red fall).`,
			tags: ['stat', 'trend', 'delta', 'arrow'],
			args: [
				stringArg('label', 'Active users', { label: 'Label', maxLength: 40 }),
				stringArg('value', '12,480', { label: 'Value', maxLength: 20 }),
				stringArg('change', '8.2%', { label: 'Change', maxLength: 12 }),
				enumArg('direction', ['up', 'down'], 'up', { label: 'Direction' })
			],
			render: stack(
				card(lib, { display: 'inline-flex', padding: '16px 20px', gap: '8px', minWidth: '200px' }),
				text(labelStyle(lib), '{label}'),
				row(
					{ gap: '10px' },
					text(valueStyle(lib), '{value}'),
					row(
						{ gap: '4px' },
						ifEq('direction', 'up', icons.arrowUp(14, lib.palette.success.solid), icons.arrowDown(14, lib.palette.danger.solid)),
						text(
							{
								fontSize: lib.fontSize.sm,
								fontWeight: 600,
								color: ifEq('direction', 'up', lib.palette.success.onSoft, lib.palette.danger.onSoft)
							},
							'{change}'
						)
					)
				)
			)
		});

		const sparkline = define({
			slug: `${lib.id}-stat-metric-sparkline`,
			name: 'Sparkline Stat',
			library: lib.id,
			category: 'data-display',
			description: `Stat card with an inline svg polyline sparkline in the ${lib.label} style — tone-colored stroke with an optional soft area fill under the line.`,
			tags: ['stat', 'sparkline', 'chart', 'svg'],
			args: [
				stringArg('label', 'Weekly sessions', { label: 'Label', maxLength: 40 }),
				stringArg('value', '4,732', { label: 'Value', maxLength: 20 }),
				toneArg(),
				booleanArg('filled', true, { label: 'Area fill' })
			],
			render: stack(
				card(lib, { display: 'inline-flex', padding: '16px 20px', gap: '10px', minWidth: '200px' }),
				stack({ gap: '4px' }, text(labelStyle(lib), '{label}'), text(valueStyle(lib), '{value}')),
				el(
					'svg',
					{ width: 128, height: 32, viewBox: '0 0 128 32', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
					iff('filled', el('polygon', { points: `${SPARK_POINTS} 128 32 0 32`, fill: toneMap(lib, (palette) => palette.soft) })),
					el('polyline', {
						points: SPARK_POINTS,
						stroke: toneMap(lib, (palette) => palette.solid),
						strokeWidth: 2,
						strokeLinecap: 'round',
						strokeLinejoin: 'round'
					})
				)
			)
		});

		const comparison = define({
			slug: `${lib.id}-stat-metric-comparison`,
			name: 'Comparison Stat',
			library: lib.id,
			category: 'data-display',
			description: `Two-value comparison card in the ${lib.label} style — current figure in the tone color beside the previous figure, split by a vertical divider${lib.id === 'thingtime' ? ' with the house rainbow wink' : ''}.`,
			tags: ['stat', 'comparison', 'versus', 'card'],
			args: [
				stringArg('leftLabel', 'This week', { label: 'Left label', maxLength: 24 }),
				stringArg('leftValue', '1,284', { label: 'Left value', maxLength: 16 }),
				stringArg('rightLabel', 'Last week', { label: 'Right label', maxLength: 24 }),
				stringArg('rightValue', '1,102', { label: 'Right value', maxLength: 16 }),
				toneArg()
			],
			render: row(
				card(lib, { display: 'inline-flex', padding: '16px 20px', gap: '18px', alignItems: 'stretch' }),
				stack(
					{ gap: '4px', flex: '1 1 0', minWidth: '90px' },
					text(labelStyle(lib), '{leftLabel}'),
					text({ ...valueStyle(lib, lib.fontSize.xl), color: toneMap(lib, (palette) => palette.solid) }, '{leftValue}')
				),
				el('div', {
					style: {
						width: '2px',
						alignSelf: 'stretch',
						borderRadius: lib.radius.pill,
						background: lib.id === 'thingtime' ? lib.rainbow : lib.borderSoft,
						flexShrink: 0
					}
				}),
				stack(
					{ gap: '4px', flex: '1 1 0', minWidth: '90px' },
					text(labelStyle(lib), '{rightLabel}'),
					text(valueStyle(lib, lib.fontSize.xl), '{rightValue}')
				)
			)
		});

		return [statCard, kpiRow, trend, sparkline, comparison];
	}
};
