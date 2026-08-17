// Timeline archetype — vertical dot/line timelines in each library's skin.
// Contract: exactly 5 variants, `build(lib)` returns exactly 5 definitions
// (one per variant, same order), slugs `${lib.id}-timeline-<variant>`.

import {
	avatarCircle,
	define,
	div,
	el,
	enumArg,
	icons,
	map,
	merge,
	numberArg,
	repeat,
	stack,
	stringArg,
	text,
	toneArg,
	toneMap
} from '../helpers.mjs';

const shell = (lib) => ({
	listStyle: 'none',
	margin: 0,
	padding: 0,
	width: '280px',
	display: 'flex',
	flexDirection: 'column',
	fontFamily: lib.font,
	color: lib.text
});

// The rail between markers. React Flow gets its dotted-edge personality; the
// rest keep a soft solid hairline.
const connector = (lib) => ({
	width: '2px',
	flexGrow: 1,
	minHeight: '14px',
	marginTop: '4px',
	borderRadius: lib.radius.pill,
	background:
		lib.id === 'reactflow'
			? `repeating-linear-gradient(to bottom, ${lib.edge} 0px, ${lib.edge} 4px, transparent 4px, transparent 8px)`
			: lib.borderSoft
});

// One timeline entry: marker column (marker + descending rail) beside content.
const entry = (lib, markerWidth, marker, ...content) =>
	el(
		'li',
		{ style: { display: 'flex', alignItems: 'stretch', gap: '14px' } },
		stack({ alignItems: 'center', width: markerWidth, flexShrink: 0 }, marker, div(connector(lib))),
		stack({ gap: '2px', paddingBottom: '18px', minWidth: 0 }, ...content)
	);

const markerRadius = (lib) => (lib.id === 'reactflow' ? lib.radius.sm : lib.radius.pill);

// --- tracking helpers (fixed 4 steps, built in JS so states resolve per step)

const STAGES = ['ordered', 'packed', 'shipped', 'delivered'];
const STEP_LABEL_DEFAULTS = ['Order placed', 'Packed at warehouse', 'In transit', 'Delivered'];

const stepState = (stepIndex, stageIndex) => (stepIndex < stageIndex ? 'done' : stepIndex === stageIndex ? 'current' : 'pending');

// For step i, a ttMap over the `stage` arg whose values come from pick(state).
// Compressed: the most frequent value becomes the ttMap default and only
// differing stages are listed — a fixed step yields at most 3 distinct states
// across 4 stages, and the server render cap counts every raw JSON value.
const perStage = (stepIndex, pick) => {
	const byStage = STAGES.map((stage, stageIndex) => pick(stepState(stepIndex, stageIndex)));
	const keyOf = (value) => JSON.stringify(value) ?? 'undefined';
	const freq = new Map();
	byStage.forEach((value) => freq.set(keyOf(value), (freq.get(keyOf(value)) || 0) + 1));
	let defaultKey = null;
	let best = -1;
	for (const [key, count] of freq) {
		if (count > best) {
			best = count;
			defaultKey = key;
		}
	}
	const values = {};
	STAGES.forEach((stage, stageIndex) => {
		if (keyOf(byStage[stageIndex]) !== defaultKey) values[stage] = byStage[stageIndex];
	});
	const fallback = byStage.find((value) => keyOf(value) === defaultKey);
	return map('stage', values, fallback ?? null);
};

export const archetype = {
	id: 'timeline',
	category: 'data-display',
	variants: ['basic', 'icons', 'activity', 'tracking', 'changelog'],
	build(lib) {
		const basic = define({
			slug: `${lib.id}-timeline-basic`,
			name: 'Basic Timeline',
			library: lib.id,
			category: 'data-display',
			description: `Vertical dot-and-rail timeline in the ${lib.label} style — tone-colored dots down a ${lib.id === 'reactflow' ? 'dotted' : 'soft'} rail, titled entries with a muted note and timestamp.`,
			tags: ['timeline', 'history', 'events', 'data'],
			args: [
				stringArg('title', 'Deploy finished', { label: 'Title', maxLength: 40 }),
				stringArg('note', 'Rolled out to production', { label: 'Note', maxLength: 60 }),
				numberArg('count', 4, { label: 'Entries', min: 1, max: 6 }),
				toneArg()
			],
			render: el(
				'ul',
				{ style: shell(lib) },
				repeat(
					'count',
					6,
					entry(
						lib,
						'12px',
						div({
							width: '12px',
							height: '12px',
							borderRadius: markerRadius(lib),
							background: toneMap(lib, (palette) => palette.solid),
							marginTop: '4px',
							flexShrink: 0
						}),
						text({ fontWeight: lib.headingWeight, fontSize: lib.fontSize.md }, '{title}'),
						text({ color: lib.muted, fontSize: lib.fontSize.sm }, '{note}'),
						text({ color: lib.faint, fontSize: lib.fontSize.xs }, '{n}h ago')
					)
				)
			)
		});

		const iconsVariant = define({
			slug: `${lib.id}-timeline-icons`,
			name: 'Icon Timeline',
			library: lib.id,
			category: 'data-display',
			description: `Timeline with icon markers in the ${lib.label} style — a chosen glyph inside tone-tinted ${lib.id === 'reactflow' ? 'squared node' : 'circle'} markers along the rail.`,
			tags: ['timeline', 'icons', 'milestones', 'data'],
			args: [
				enumArg('icon', ['check', 'star', 'bell', 'zap'], 'check', { label: 'Icon' }),
				stringArg('title', 'Milestone reached', { label: 'Title', maxLength: 40 }),
				numberArg('count', 3, { label: 'Entries', min: 1, max: 6 }),
				toneArg()
			],
			render: el(
				'ul',
				{ style: shell(lib) },
				repeat(
					'count',
					6,
					entry(
						lib,
						'28px',
						div(
							{
								width: '28px',
								height: '28px',
								borderRadius: markerRadius(lib),
								background: toneMap(lib, (palette) => palette.soft),
								color: toneMap(lib, (palette) => palette.onSoft),
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0
							},
							map(
								'icon',
								{
									check: icons.check(14, 'currentColor'),
									star: icons.star(14, 'currentColor'),
									bell: icons.bell(14, 'currentColor'),
									zap: icons.zap(14, 'currentColor')
								},
								icons.check(14, 'currentColor')
							)
						),
						text({ fontWeight: lib.headingWeight, fontSize: lib.fontSize.md, marginTop: '4px' }, '{title} {n}'),
						text({ color: lib.muted, fontSize: lib.fontSize.sm }, 'Completed {n}d ago')
					)
				)
			)
		});

		const activity = define({
			slug: `${lib.id}-timeline-activity`,
			name: 'Activity Feed Timeline',
			library: lib.id,
			category: 'data-display',
			description: `Activity feed timeline in the ${lib.label} style — initials avatars as markers, a bold actor name before each action, faint timestamps below.`,
			tags: ['timeline', 'activity', 'feed', 'avatar'],
			args: [
				stringArg('name', 'Alex Rivers', { label: 'Name', maxLength: 40 }),
				stringArg('initials', 'AR', { label: 'Initials', maxLength: 3 }),
				stringArg('action', 'commented on your post', { label: 'Action', maxLength: 60 }),
				numberArg('count', 3, { label: 'Entries', min: 1, max: 6 }),
				toneArg()
			],
			render: el(
				'ul',
				{ style: shell(lib) },
				repeat(
					'count',
					6,
					entry(
						lib,
						'30px',
						avatarCircle(
							'30px',
							toneMap(lib, (palette) => palette.soft),
							toneMap(lib, (palette) => palette.onSoft),
							'{initials}',
							lib.fontSize.xs
						),
						el(
							'span',
							{ style: { fontSize: lib.fontSize.sm, lineHeight: 1.5, marginTop: '5px' } },
							el('strong', { style: { fontWeight: 600 } }, '{name}'),
							' {action}'
						),
						text({ color: lib.faint, fontSize: lib.fontSize.xs }, '{n}h ago')
					)
				)
			)
		});

		// Fixed success accent instead of a tone arg: nesting a 6-tone ttMap
		// inside every 4-stage ttMap quadrupled the template past the server's
		// 600-node render cap — tracking timelines are success-toned anyway.
		const trackAccent = lib.id === 'reactflow' ? lib.accent : lib.palette.success.solid;
		const trackAccentText = lib.id === 'reactflow' ? '#ffffff' : lib.palette.success.onSolid;
		const trackDotStyle = (state) => {
			if (state === 'done') {
				return { background: trackAccent, borderColor: trackAccent, color: trackAccentText };
			}
			if (state === 'current') {
				return { background: lib.surface, borderColor: trackAccent, boxShadow: lib.focusRing };
			}
			return { background: lib.surface, borderColor: lib.border };
		};

		const trackSteps = STAGES.map((stage, index) =>
			el(
				'li',
				{ style: { display: 'flex', alignItems: 'stretch', gap: '14px' } },
				stack(
					{ alignItems: 'center', width: '20px', flexShrink: 0 },
					el(
						'div',
						{
							style: merge(
								{
									width: '20px',
									height: '20px',
									boxSizing: 'border-box',
									borderWidth: '2px',
									borderStyle: 'solid',
									borderRadius: markerRadius(lib),
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									flexShrink: 0
								},
								perStage(index, trackDotStyle)
							)
						},
						perStage(index, (state) =>
							state === 'done'
								? icons.check(11, 'currentColor')
								: state === 'current'
									? div({ width: '8px', height: '8px', borderRadius: lib.radius.pill, background: trackAccent })
									: null
						)
					),
					index < STAGES.length - 1
						? div({
								width: '2px',
								flexGrow: 1,
								minHeight: '22px',
								marginTop: '4px',
								borderRadius: lib.radius.pill,
								background: perStage(index, (state) => (state === 'done' ? trackAccent : lib.borderSoft))
							})
						: null
				),
				stack(
					{ gap: '2px', minWidth: 0, paddingBottom: index < STAGES.length - 1 ? '18px' : '0' },
					el(
						'span',
						{
							style: {
								fontSize: lib.fontSize.md,
								fontWeight: perStage(index, (state) => (state === 'current' ? 700 : 500)),
								color: perStage(index, (state) => (state === 'pending' ? lib.muted : lib.text))
							}
						},
						`{step${index + 1}}`
					),
					el(
						'span',
						{
							style: {
								fontSize: lib.fontSize.xs,
								color: perStage(index, (state) => (state === 'current' ? trackAccent : lib.faint))
							}
						},
						perStage(index, (state) => (state === 'done' ? 'Done' : state === 'current' ? 'In progress' : 'Pending'))
					)
				)
			)
		);

		const tracking = define({
			slug: `${lib.id}-timeline-tracking`,
			name: 'Order Tracking Timeline',
			library: lib.id,
			category: 'data-display',
			description: `Order-tracking timeline in the ${lib.label} style — four steps whose dots, rails, and labels flip between done, current, and pending as the stage advances.`,
			tags: ['timeline', 'tracking', 'steps', 'status'],
			args: [
				enumArg('stage', STAGES, 'shipped', { label: 'Stage' }),
				stringArg('step1', STEP_LABEL_DEFAULTS[0], { label: 'Step 1', maxLength: 40 }),
				stringArg('step2', STEP_LABEL_DEFAULTS[1], { label: 'Step 2', maxLength: 40 }),
				stringArg('step3', STEP_LABEL_DEFAULTS[2], { label: 'Step 3', maxLength: 40 }),
				stringArg('step4', STEP_LABEL_DEFAULTS[3], { label: 'Step 4', maxLength: 40 })
			],
			render: el('ul', { style: shell(lib) }, ...trackSteps)
		});

		const chipRadius = lib.id === 'reactflow' ? lib.radius.xs : lib.id === 'daisyui' ? lib.radius.md : lib.radius.pill;
		const changelog = define({
			slug: `${lib.id}-timeline-changelog`,
			name: 'Changelog Timeline',
			library: lib.id,
			category: 'data-display',
			description: `Changelog timeline in the ${lib.label} style — mono version chips on a tone tint head each entry, with a date mark and a muted release summary.`,
			tags: ['timeline', 'changelog', 'releases', 'versions'],
			args: [
				stringArg('version', '2.4', { label: 'Version', maxLength: 12 }),
				stringArg('summary', 'Performance improvements and bug fixes', { label: 'Summary', maxLength: 80 }),
				numberArg('count', 3, { label: 'Entries', min: 1, max: 5 }),
				toneArg()
			],
			render: el(
				'ul',
				{ style: shell(lib) },
				repeat(
					'count',
					5,
					entry(
						lib,
						'12px',
						div({
							width: '12px',
							height: '12px',
							borderRadius: markerRadius(lib),
							background: lib.faint,
							marginTop: '5px',
							flexShrink: 0
						}),
						el(
							'div',
							{ style: { display: 'flex', alignItems: 'center', gap: '8px' } },
							el(
								'span',
								{
									style: {
										fontFamily: lib.fontMono,
										fontSize: lib.fontSize.xs,
										fontWeight: 600,
										padding: '2px 8px',
										borderRadius: chipRadius,
										background: toneMap(lib, (palette) => palette.soft),
										color: toneMap(lib, (palette) => palette.onSoft),
										borderWidth: '1px',
										borderStyle: 'solid',
										borderColor: toneMap(lib, (palette) => palette.border)
									}
								},
								'v{version}.{n}'
							),
							text({ color: lib.faint, fontSize: lib.fontSize.xs }, 'Aug {n}')
						),
						text({ color: lib.muted, fontSize: lib.fontSize.sm, marginTop: '2px' }, '{summary}')
					)
				)
			)
		});

		return [basic, iconsVariant, activity, tracking, changelog];
	}
};
