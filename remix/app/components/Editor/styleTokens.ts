import type React from 'react';

// Safe text-style customisation: style is stored as validated TOKENS, never
// raw CSS. Every value passes a whitelist/clamp before it can touch the DOM,
// and rendering builds React style objects (no string-injected CSS), so a
// stored token can never express url(), expression(), position:fixed, or any
// other escape hatch — full colour/size/font/alignment freedom, zero
// injection surface. Used by the Editor.js Style tune and the rich-text kind.

export type FontKey = 'body' | 'serif' | 'mono' | 'rounded';
export type AlignKey = 'left' | 'center' | 'right';

export type TextStyleTokens = {
	// #rgb/#rrggbb/#rrggbbaa or one of the theme token vars below
	color?: string;
	// px, clamped to 10–72
	size?: number;
	font?: FontKey;
	align?: AlignKey;
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// theme-token colours allowed verbatim (exact strings only)
const THEME_COLOR_VARS = new Set([
	'var(--tt-ink, #16161a)',
	'var(--tt-text, #5a5a66)',
	'var(--tt-muted, #9a9aa6)',
	'var(--tt-accent, hotpink)',
	'var(--tt-link, #2f8fd6)',
	'var(--tt-positive, #2f8f4f)',
	'var(--tt-danger, #d6455a)'
]);

export const FONT_STACKS: Record<FontKey, string> = {
	body: "var(--tt-font-body, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif)",
	serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
	mono: "var(--tt-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
	rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Comfortaa', system-ui, sans-serif"
};

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 72;

// swatches offered by the tune UI (any valid hex is also accepted from data)
export const STYLE_PALETTE: Array<{ key: string; label: string; css: string }> = [
	{ key: 'ink', label: 'Ink', css: 'var(--tt-ink, #16161a)' },
	{ key: 'muted', label: 'Muted', css: 'var(--tt-muted, #9a9aa6)' },
	{ key: 'accent', label: 'Accent', css: 'var(--tt-accent, hotpink)' },
	{ key: 'link', label: 'Blue', css: 'var(--tt-link, #2f8fd6)' },
	{ key: 'positive', label: 'Green', css: 'var(--tt-positive, #2f8f4f)' },
	{ key: 'danger', label: 'Red', css: 'var(--tt-danger, #d6455a)' },
	{ key: 'pink', label: 'Pink', css: '#ff69b4' },
	{ key: 'orange', label: 'Orange', css: '#ff9457' },
	{ key: 'yellow', label: 'Gold', css: '#e3a008' },
	{ key: 'purple', label: 'Purple', css: '#8f6fff' }
];

export const SIZE_PRESETS: Array<{ label: string; px: number }> = [
	{ label: 'S', px: 13 },
	{ label: 'M', px: 15 },
	{ label: 'L', px: 19 },
	{ label: 'XL', px: 24 },
	{ label: '2XL', px: 32 },
	{ label: '3XL', px: 44 }
];

export const sanitizeColor = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (HEX_COLOR.test(trimmed)) return trimmed;
	if (THEME_COLOR_VARS.has(trimmed)) return trimmed;
	return null;
};

export const sanitizeSize = (value: unknown): number | null => {
	const parsed = typeof value === 'string' ? Number(value) : value;
	if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return null;
	return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(parsed * 2) / 2));
};

export const sanitizeFont = (value: unknown): FontKey | null =>
	typeof value === 'string' && value in FONT_STACKS ? (value as FontKey) : null;

export const sanitizeAlign = (value: unknown): AlignKey | null =>
	value === 'left' || value === 'center' || value === 'right' ? value : null;

// the one gate: whatever arrives (tune data from a stored doc, UI input,
// pasted JSON) leaves as clean tokens or nothing
export const sanitizeStyleTokens = (raw: unknown): TextStyleTokens => {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const record = raw as Record<string, unknown>;
	const out: TextStyleTokens = {};

	const color = sanitizeColor(record.color);
	if (color) out.color = color;

	const size = sanitizeSize(record.size);
	if (size !== null) out.size = size;

	const font = sanitizeFont(record.font);
	if (font) out.font = font;

	const align = sanitizeAlign(record.align);
	if (align) out.align = align;

	return out;
};

// tokens → React style object; built exclusively from validated values
export const styleTokensToCss = (tokens: TextStyleTokens): React.CSSProperties => {
	const css: React.CSSProperties = {};
	if (tokens.color) css.color = tokens.color;
	if (tokens.size) css.fontSize = `${tokens.size}px`;
	if (tokens.font) css.fontFamily = FONT_STACKS[tokens.font];
	if (tokens.align) css.textAlign = tokens.align;
	return css;
};

export const hasStyleTokens = (tokens: TextStyleTokens): boolean => Object.keys(tokens).length > 0;
