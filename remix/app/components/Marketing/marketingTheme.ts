import { getTrend } from '~/marketing/trends';
import type { Trend, TrendKey } from '~/marketing/types';

// Maps a marketing trend (marketing/trends.ts) onto the CSS custom
// properties the marketing components read. Everything visual on a marketing
// page flows through these --mk-* variables so a page can be re-cut in any
// of the twelve styles by swapping one object.

export type MarketingVars = Record<`--mk-${string}`, string>;

export const trendVars = (key: TrendKey): MarketingVars => {
	const trend = getTrend(key);
	const p = trend.palette;
	const dark = isDarkTrend(trend);
	const hardShadow = `${Math.max(4, trend.border + 2)}px ${Math.max(4, trend.border + 2)}px 0 ${p.ink}`;
	const shadow =
		trend.shadow === 'hard'
			? hardShadow
			: trend.shadow === 'soft'
				? '0 24px 60px -28px rgba(20,20,40,.28)'
				: trend.shadow === 'glow'
					? `0 0 0 1px ${p.accent}33, 0 24px 80px -24px ${p.accent}88`
					: 'none';
	const shadowLg = trend.shadow === 'hard' ? `${trend.border + 6}px ${trend.border + 6}px 0 ${p.ink}` : shadow;
	return {
		'--mk-bg': p.bg,
		'--mk-bg2': p.bg2,
		'--mk-ink': p.ink,
		'--mk-text': dark ? p.muted : mix(p.ink, p.muted),
		'--mk-muted': p.muted,
		'--mk-accent': p.accent,
		'--mk-accent2': p.accent2,
		'--mk-accent-contrast': readableOn(p.accent),
		'--mk-card': p.card,
		'--mk-card-solid': p.card.startsWith('rgba') ? (dark ? '#1b1b24' : '#ffffff') : p.card,
		'--mk-font': trend.font,
		'--mk-weight': String(trend.weight),
		'--mk-radius': `${trend.radius}px`,
		'--mk-radius-sm': `${Math.round(trend.radius * 0.5)}px`,
		'--mk-border-w': `${Math.min(trend.border, 4)}px`,
		'--mk-border': trend.border ? `${Math.min(trend.border, 4)}px solid ${dark ? `${p.ink}33` : p.ink}` : `1px solid ${dark ? '#ffffff22' : '#00000014'}`,
		'--mk-shadow': shadow,
		'--mk-shadow-lg': shadowLg,
		'--mk-hairline': dark ? '#ffffff22' : '#00000014',
		'--mk-tint': dark ? '#ffffff0f' : `${p.accent}14`,
		'--mk-dark': dark ? '1' : '0'
	};
};

export const isDarkTrend = (trend: Trend) => {
	const hex = trend.palette.bg.replace('#', '');
	if (hex.length !== 6) return false;
	const r = parseInt(hex.slice(0, 2), 16);
	const g = parseInt(hex.slice(2, 4), 16);
	const b = parseInt(hex.slice(4, 6), 16);
	return (r * 299 + g * 587 + b * 114) / 1000 < 128;
};

const readableOn = (colour: string) => {
	const hex = colour.replace('#', '');
	if (hex.length !== 6) return '#ffffff';
	const r = parseInt(hex.slice(0, 2), 16);
	const g = parseInt(hex.slice(2, 4), 16);
	const b = parseInt(hex.slice(4, 6), 16);
	return (r * 299 + g * 587 + b * 114) / 1000 < 150 ? '#ffffff' : '#16161a';
};

const mix = (a: string, b: string) => {
	const ha = a.replace('#', '');
	const hb = b.replace('#', '');
	if (ha.length !== 6 || hb.length !== 6) return a;
	const channel = (index: number) => Math.round((parseInt(ha.slice(index, index + 2), 16) * 2 + parseInt(hb.slice(index, index + 2), 16)) / 3);
	return `#${[0, 2, 4].map((index) => channel(index).toString(16).padStart(2, '0')).join('')}`;
};

export const RAINBOW_TEXT_STYLE = {
	background: 'var(--tt-gradient-rainbow-x, linear-gradient(90deg, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a))',
	backgroundSize: 'calc(100px + 200%)',
	WebkitBackgroundClip: 'text',
	backgroundClip: 'text',
	WebkitTextFillColor: 'transparent',
	color: 'transparent',
	animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
} as const;

export const MK = {
	bg: 'var(--mk-bg)',
	bg2: 'var(--mk-bg2)',
	ink: 'var(--mk-ink)',
	text: 'var(--mk-text)',
	muted: 'var(--mk-muted)',
	accent: 'var(--mk-accent)',
	accent2: 'var(--mk-accent2)',
	accentContrast: 'var(--mk-accent-contrast)',
	card: 'var(--mk-card)',
	cardSolid: 'var(--mk-card-solid)',
	font: 'var(--mk-font)',
	weight: 'var(--mk-weight)',
	radius: 'var(--mk-radius)',
	radiusSm: 'var(--mk-radius-sm)',
	border: 'var(--mk-border)',
	shadow: 'var(--mk-shadow)',
	shadowLg: 'var(--mk-shadow-lg)',
	hairline: 'var(--mk-hairline)',
	tint: 'var(--mk-tint)',
	mono: 'var(--tt-font-mono, "JetBrains Mono", ui-monospace, Menlo, monospace)'
} as const;
