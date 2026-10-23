import type React from 'react';
import { parseColor, rgbaToHex } from './styleColor';

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
	// Legacy numeric px values, or a validated CSS length with explicit units.
	size?: number | string;
	background?: string;
	bold?: boolean;
	italic?: boolean;
	decoration?: string;
	font?: FontKey;
	align?: AlignKey;
};

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

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
	mono: 'var(--tt-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
	rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Comfortaa', system-ui, sans-serif"
};

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 240;
export const FONT_SIZE_UNITS = ['px', 'em', 'rem', 'pt', '%'] as const;
export const SIZE_LIMITS: Record<string, [number, number]> = { px: [1, 240], em: [0.1, 15], rem: [0.1, 15], pt: [1, 180], '%': [10, 1500] };

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
	const parsed = parseColor(trimmed);
	return parsed ? rgbaToHex(parsed) : null;
};

export const sanitizeSize = (value: unknown): number | string | null => {
	if (typeof value === 'string') {
		const match = /^(\d+(?:\.\d+)?)(px|em|rem|pt|%)$/.exec(value.trim());
		if (match) {
			const [min, max] = SIZE_LIMITS[match[2]];
			return `${Math.round(Math.min(max, Math.max(min, Number(match[1]))) * 100) / 100}${match[2]}`;
		}
		if (!value.trim()) return null;
	}
	const parsed = typeof value === 'string' ? Number(value) : value;
	if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return null;
	return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(parsed * 2) / 2));
};

export const sanitizeFont = (value: unknown): FontKey | null =>
	typeof value === 'string' && Object.prototype.hasOwnProperty.call(FONT_STACKS, value) ? (value as FontKey) : null;

export const sanitizeAlign = (value: unknown): AlignKey | null => (value === 'left' || value === 'center' || value === 'right' ? value : null);

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

	const background = sanitizeColor(record.background);
	if (background) out.background = background;
	if (typeof record.bold === 'boolean') out.bold = record.bold;
	if (typeof record.italic === 'boolean') out.italic = record.italic;
	if (
		typeof record.decoration === 'string' &&
		/^(none|(?:underline|overline|line-through)(?: (?:underline|overline|line-through))*)$/.test(record.decoration)
	)
		out.decoration = [...new Set(record.decoration.split(' '))].join(' ');
	return out;
};

// tokens → React style object; built exclusively from validated values
export const styleTokensToCss = (tokens: TextStyleTokens): React.CSSProperties => {
	const css: React.CSSProperties = {};
	if (tokens.color) css.color = tokens.color;
	if (tokens.size) css.fontSize = typeof tokens.size === 'number' ? `${tokens.size}px` : tokens.size;
	if (tokens.background) css.backgroundColor = tokens.background;
	if (tokens.bold !== undefined) css.fontWeight = tokens.bold ? 800 : 400;
	if (tokens.italic !== undefined) css.fontStyle = tokens.italic ? 'italic' : 'normal';
	if (tokens.decoration) css.textDecoration = tokens.decoration;
	if (tokens.font) css.fontFamily = FONT_STACKS[tokens.font];
	if (tokens.align) css.textAlign = tokens.align;
	return css;
};

export const hasStyleTokens = (tokens: TextStyleTokens): boolean => Object.keys(tokens).length > 0;

/** Inline styles share the block token validators, including during SSR. */
export const inlineStyleToTokens = (style: string): TextStyleTokens => {
	const values: Record<string, unknown> = {};
	for (const declaration of style.split(';')) {
		const colon = declaration.indexOf(':');
		if (colon < 0) continue;
		const key = declaration.slice(0, colon).trim().toLowerCase(),
			value = declaration.slice(colon + 1).trim();
		if (key === 'color') values.color = value;
		if (key === 'background-color') values.background = value;
		if (key === 'font-size') values.size = value;
		if (key === 'text-decoration' || key === 'text-decoration-line') values.decoration = value;
		if (key === 'font-weight' && /^(400|800|normal|bold)$/.test(value)) values.bold = value === '800' || value === 'bold';
		if (key === 'font-style' && /^(normal|italic)$/.test(value)) values.italic = value === 'italic';
		if (key === 'font-family')
			values.font = Object.entries(FONT_STACKS).find(([, stack]) => stack.replace(/['"]/g, '') === value.replace(/['"]/g, ''))?.[0];
	}
	return sanitizeStyleTokens(values);
};
export const tokensToInlineStyle = (tokens: TextStyleTokens): string =>
	Object.entries(styleTokensToCss(sanitizeStyleTokens(tokens)))
		.filter(([key]) => key !== 'textAlign')
		.map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${value}`)
		.join(';');
export const sanitizeInlineStyle = (style: string): string => tokensToInlineStyle(inlineStyleToTokens(style));
