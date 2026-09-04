import type { SocialFormat, Trend, TrendKey } from './types';

// Twelve visual "trend" styles the social suite and landing variants render
// in. Each is a self-contained palette + typography + motif recipe modelled on
// looks that currently travel well on YouTube thumbnails, TikTok/Reels text
// overlays, Instagram carousels, X/LinkedIn link cards and Facebook posts.
// Brand rainbow stays available in every style through the accent slots.

export const TRENDS: Trend[] = [
	{
		key: 'bold-brutal',
		name: 'Bold brutalist',
		emoji: '🟥',
		platforms: ['Web', 'Instagram', 'X'],
		blurb: 'Thick ink borders, hard offset shadows, hotpink CTAs: the Thingtime landing look, straight from the brand.',
		palette: { bg: '#ffffff', bg2: '#fff5fa', ink: '#1a1a1a', muted: '#6b6b6b', accent: '#ff69b4', accent2: '#6f3198', card: '#ffffff' },
		font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
		weight: 900,
		radius: 0,
		border: 6,
		shadow: 'hard',
		motif: 'grid'
	},
	{
		key: 'gradient-glow',
		name: 'Aurora glow',
		emoji: '🌌',
		platforms: ['Instagram', 'LinkedIn', 'Web'],
		blurb: 'Soft aurora gradients behind a frosted glass card; the premium SaaS look that dominates launch posts.',
		palette: { bg: '#0f0b1f', bg2: '#1b1240', ink: '#ffffff', muted: '#c9c3e6', accent: '#a555e8', accent2: '#47b5e6', card: 'rgba(255,255,255,0.10)' },
		font: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif',
		weight: 700,
		radius: 28,
		border: 1,
		shadow: 'glow',
		motif: 'aurora'
	},
	{
		key: 'bento',
		name: 'Bento grid',
		emoji: '🍱',
		platforms: ['Web', 'X', 'LinkedIn'],
		blurb: 'Feature tiles in a tidy bento grid; Apple-keynote energy that reads at thumbnail size.',
		palette: { bg: '#f4f4f7', bg2: '#ffffff', ink: '#16161a', muted: '#7a7a88', accent: '#58ca70', accent2: '#47b5e6', card: '#ffffff' },
		font: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif',
		weight: 700,
		radius: 22,
		border: 1,
		shadow: 'soft',
		motif: 'none'
	},
	{
		key: 'kinetic-type',
		name: 'Kinetic type',
		emoji: '🔠',
		platforms: ['TikTok', 'Reels', 'Shorts'],
		blurb: 'Three-line hook in giant type with a highlighted word; the text-overlay look that stops thumbs.',
		palette: { bg: '#111111', bg2: '#111111', ink: '#ffffff', muted: '#bdbdbd', accent: '#ffbc48', accent2: '#f34a4a', card: '#1c1c1c' },
		font: '"Space Grotesk", Impact, "Arial Black", sans-serif',
		weight: 900,
		radius: 12,
		border: 0,
		shadow: 'none',
		motif: 'stripes'
	},
	{
		key: 'y2k-chrome',
		name: 'Y2K chrome',
		emoji: '💿',
		platforms: ['TikTok', 'Instagram', 'Pinterest'],
		blurb: 'Silver gradients, lilac and bubblegum, sparkles and stars: the retro-future look Gen Z reposts.',
		palette: { bg: '#e6d9ff', bg2: '#ffd1ec', ink: '#2a1a4a', muted: '#6c5a8f', accent: '#ff5fb0', accent2: '#8a6cff', card: '#ffffff' },
		font: '"Space Grotesk", Verdana, sans-serif',
		weight: 800,
		radius: 40,
		border: 3,
		shadow: 'soft',
		motif: 'stars'
	},
	{
		key: 'dark-neon',
		name: 'Dark neon',
		emoji: '🟢',
		platforms: ['X', 'YouTube', 'Web'],
		blurb: 'Near-black background, neon green code accents, mono labels: the developer-Twitter aesthetic.',
		palette: { bg: '#0b0b0f', bg2: '#131318', ink: '#e6e6ee', muted: '#8a8a95', accent: '#59ff9c', accent2: '#59bdff', card: '#131318' },
		font: '"JetBrains Mono", "SF Mono", Menlo, monospace',
		weight: 700,
		radius: 14,
		border: 1,
		shadow: 'glow',
		motif: 'dots'
	},
	{
		key: 'pastel-soft',
		name: 'Pastel soft',
		emoji: '🧁',
		platforms: ['Instagram', 'Pinterest', 'Facebook'],
		blurb: 'Warm pastels, rounded cards, gentle shadows: the cosy aesthetic that carries lifestyle carousels.',
		palette: { bg: '#fff7ef', bg2: '#ffe9d6', ink: '#3a2f2a', muted: '#8c7b72', accent: '#f38b7a', accent2: '#8fc7a8', card: '#ffffff' },
		font: '"Hanken Grotesk", "Helvetica Neue", Arial, sans-serif',
		weight: 800,
		radius: 32,
		border: 0,
		shadow: 'soft',
		motif: 'rings'
	},
	{
		key: 'meme-caption',
		name: 'Meme caption',
		emoji: '😂',
		platforms: ['X', 'Facebook', 'Reddit'],
		blurb: 'A mock screenshot with a bold caption on top; the relatable format that gets screenshotted and reshared.',
		palette: { bg: '#ffffff', bg2: '#f2f2f2', ink: '#111111', muted: '#555555', accent: '#1d9bf0', accent2: '#f34a4a', card: '#ffffff' },
		font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
		weight: 700,
		radius: 16,
		border: 1,
		shadow: 'none',
		motif: 'none'
	},
	{
		key: 'mono-minimal',
		name: 'Mono minimal',
		emoji: '⬛',
		platforms: ['X', 'LinkedIn', 'Web'],
		blurb: 'Black on white, tiny mono labels, one accent: the Vercel-style restraint that signals craft.',
		palette: { bg: '#ffffff', bg2: '#fafafa', ink: '#000000', muted: '#666666', accent: '#000000', accent2: '#f34a4a', card: '#ffffff' },
		font: '"JetBrains Mono", "SF Mono", Menlo, monospace',
		weight: 600,
		radius: 6,
		border: 1,
		shadow: 'none',
		motif: 'grid'
	},
	{
		key: 'sticker-collage',
		name: 'Sticker collage',
		emoji: '🏷️',
		platforms: ['Instagram', 'TikTok', 'Pinterest'],
		blurb: 'Rotated stickers, badges and doodles on a notebook grid: the scrapbook energy of creator posts.',
		palette: { bg: '#fffdf4', bg2: '#fff6c9', ink: '#1a1a1a', muted: '#6d6a5c', accent: '#f34a4a', accent2: '#58ca70', card: '#ffffff' },
		font: '"Space Grotesk", "Comic Sans MS", sans-serif',
		weight: 800,
		radius: 18,
		border: 3,
		shadow: 'hard',
		motif: 'stickers'
	},
	{
		key: 'listicle',
		name: 'Listicle card',
		emoji: '🔢',
		platforms: ['Instagram', 'LinkedIn', 'Facebook'],
		blurb: 'A numbered three-point card; carousel slide one, the format LinkedIn and Instagram reward.',
		palette: { bg: '#16161a', bg2: '#22222a', ink: '#ffffff', muted: '#b6b6c0', accent: '#ffbc48', accent2: '#58ca70', card: '#22222a' },
		font: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif',
		weight: 800,
		radius: 20,
		border: 0,
		shadow: 'soft',
		motif: 'noise'
	},
	{
		key: 'before-after',
		name: 'Before / after',
		emoji: '↔️',
		platforms: ['YouTube', 'X', 'Facebook'],
		blurb: 'A split card: the messy way versus the Thingtime way. The comparison format thumbnails love.',
		palette: { bg: '#f7f7f9', bg2: '#ffffff', ink: '#16161a', muted: '#7a7a88', accent: '#58ca70', accent2: '#f34a4a', card: '#ffffff' },
		font: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif',
		weight: 800,
		radius: 18,
		border: 2,
		shadow: 'hard',
		motif: 'none'
	}
];

export const TREND_BY_KEY: Record<TrendKey, Trend> = Object.fromEntries(TRENDS.map((trend) => [trend.key, trend])) as Record<TrendKey, Trend>;

export const getTrend = (key: TrendKey): Trend => {
	const trend = TREND_BY_KEY[key];
	if (!trend) throw new Error(`Unknown marketing trend: ${key}`);
	return trend;
};

// Social image formats. Sizes are the platform-recommended pixel dimensions.
export const SOCIAL_FORMATS: SocialFormat[] = [
	{ key: 'ig-square', name: 'Instagram square', platform: 'Instagram', emoji: '📸', width: 1080, height: 1080, label: '1080 × 1080' },
	{ key: 'ig-portrait', name: 'Instagram portrait', platform: 'Instagram', emoji: '📸', width: 1080, height: 1350, label: '1080 × 1350' },
	{ key: 'story', name: 'Story / Reel / TikTok / Shorts', platform: 'TikTok', emoji: '🎬', width: 1080, height: 1920, label: '1080 × 1920' },
	{ key: 'youtube-thumb', name: 'YouTube thumbnail', platform: 'YouTube', emoji: '▶️', width: 1280, height: 720, label: '1280 × 720' },
	{ key: 'x-post', name: 'X post', platform: 'X', emoji: '🐦', width: 1600, height: 900, label: '1600 × 900' },
	{ key: 'facebook-link', name: 'Facebook link / OG', platform: 'Facebook', emoji: '📘', width: 1200, height: 630, label: '1200 × 630' },
	{ key: 'linkedin', name: 'LinkedIn post', platform: 'LinkedIn', emoji: '💼', width: 1200, height: 627, label: '1200 × 627' },
	{ key: 'pinterest', name: 'Pinterest pin', platform: 'Pinterest', emoji: '📌', width: 1000, height: 1500, label: '1000 × 1500' },
	{ key: 'x-header', name: 'X header', platform: 'X', emoji: '🐦', width: 1500, height: 500, label: '1500 × 500' },
	{ key: 'youtube-banner', name: 'YouTube banner', platform: 'YouTube', emoji: '▶️', width: 2560, height: 1440, label: '2560 × 1440' }
];

export const SOCIAL_FORMAT_BY_KEY: Record<string, SocialFormat> = Object.fromEntries(SOCIAL_FORMATS.map((format) => [format.key, format]));

export const getSocialFormat = (key: string): SocialFormat => {
	const format = SOCIAL_FORMAT_BY_KEY[key];
	if (!format) throw new Error(`Unknown social format: ${key}`);
	return format;
};
