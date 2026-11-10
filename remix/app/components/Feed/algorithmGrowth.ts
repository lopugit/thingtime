// Algorithms grow up: 🥚 → 🐣 → 🐥 → 🧠 (claude-todo/10 🎨). The pulsing
// "learning" dot and the manager labels evolve as an algorithm's trained
// signal count crosses stage boundaries, teaching the doomscroll-training
// mechanic with zero docs. Stage data mirrors the design mockup at
// docs/design/thingtime-algorithm-growth/ exactly (thresholds, copy, colors).

export type GrowthStage = {
	min: number;
	emoji: string;
	name: string;
	/** Tooltip/label line for the current stage. */
	tip: string;
	/** One-shot Lopu toast when the stage is first reached. */
	toast: string;
	color: string;
	glow: string;
};

export const GROWTH_STAGES: GrowthStage[] = [
	{
		min: 0,
		emoji: '🥚',
		name: 'Egg',
		tip: 'Still an egg 🥚 — scroll to start teaching it what you love.',
		toast: 'Your algorithm is waking up 🥚',
		color: '#f34a4a',
		glow: 'rgba(243,74,74,.5)'
	},
	{
		min: 100,
		emoji: '🐣',
		name: 'Hatching',
		tip: "It's hatching 🐣 — starting to notice your taste in types and tags.",
		toast: 'Your algorithm just hatched! 🐣',
		color: '#ffbc48',
		glow: 'rgba(255,188,72,.5)'
	},
	{
		min: 500,
		emoji: '🐥',
		name: 'Fledgling',
		tip: 'Finding its wings 🐥 — ranking with real confidence now.',
		toast: 'Finding its wings 🐥',
		color: '#58ca70',
		glow: 'rgba(88,202,112,.5)'
	},
	{
		min: 2000,
		emoji: '🧠',
		name: 'Thinking',
		tip: 'Thinking for itself 🧠✨ — this feed is unmistakably yours.',
		toast: 'It thinks for itself now 🧠✨',
		color: '#a555e8',
		glow: 'rgba(165,85,232,.5)'
	}
];

const clampSignals = (signals: unknown): number => {
	const value = typeof signals === 'number' && Number.isFinite(signals) ? signals : 0;
	return Math.max(0, Math.floor(value));
};

export const growthStageFor = (signals: unknown): GrowthStage => {
	const count = clampSignals(signals);
	let stage = GROWTH_STAGES[0];
	for (const candidate of GROWTH_STAGES) {
		if (count >= candidate.min) stage = candidate;
	}
	return stage;
};

/** The next stage up, or null at 🧠 (fully grown). */
export const nextGrowthStage = (signals: unknown): GrowthStage | null => {
	const current = growthStageFor(signals);
	const index = GROWTH_STAGES.indexOf(current);
	return GROWTH_STAGES[index + 1] ?? null;
};

/**
 * The stage newly ENTERED by moving from before → after signals, or null when
 * no boundary was crossed. Signals only ever grow, so a crossing fires once —
 * that makes the milestone toast naturally one-shot with no celebrated-store.
 */
export const crossedGrowthStage = (before: unknown, after: unknown): GrowthStage | null => {
	const prev = growthStageFor(before);
	const next = growthStageFor(after);
	return next.min > prev.min ? next : null;
};
