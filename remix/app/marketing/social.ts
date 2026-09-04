import { captionFor, hashString, highlightWord, hookFor, pick, truncate, type HookPlatform } from './copy';
import { FEATURES, FEATURE_CATEGORY_LABELS, getFeature } from './features';
import { SOCIAL_FORMATS, TRENDS, getSocialFormat, getTrend } from './trends';
import type { Feature, SocialFormat, Trend, TrendKey } from './types';

// The social-image suite: every feature × every trend style × every platform
// format renders as a self-contained SVG string (no external fonts, images
// or scripts) so it previews inline as an <img> and rasterises to PNG in a
// canvas at the exact platform size. Everything is pure string building.

export type SocialAssetRef = { feature: string; trend: TrendKey; format: string };

export const RAINBOW = ['#f34a4a', '#ffbc48', '#58ca70', '#47b5e6', '#a555e8'] as const;

export const PLATFORM_FOR_FORMAT: Record<string, HookPlatform> = {
	'ig-square': 'instagram',
	'ig-portrait': 'instagram',
	story: 'tiktok',
	'youtube-thumb': 'youtube',
	'x-post': 'x',
	'facebook-link': 'facebook',
	linkedin: 'linkedin',
	pinterest: 'pinterest',
	'x-header': 'x',
	'youtube-banner': 'youtube'
};

export const socialAssetKey = ({ feature, trend, format }: SocialAssetRef) => `${feature}__${trend}__${format}`;

export const parseSocialAssetKey = (key: string): SocialAssetRef | null => {
	const [feature, trend, format] = key.split('__');
	if (!feature || !trend || !format) return null;
	return { feature, trend: trend as TrendKey, format };
};

export const socialAssetFilename = (ref: SocialAssetRef, extension: 'png' | 'svg') => {
	const format = getSocialFormat(ref.format);
	return `thingtime-${ref.feature}-${ref.trend}-${ref.format}-${format.width}x${format.height}.${extension}`;
};

export const enumerateSocialAssets = (): SocialAssetRef[] => {
	const out: SocialAssetRef[] = [];
	for (const feature of FEATURES) for (const trend of TRENDS) for (const format of SOCIAL_FORMATS) out.push({ feature: feature.key, trend: trend.key, format: format.key });
	return out;
};

export const SOCIAL_ASSET_COUNT = FEATURES.length * TRENDS.length * SOCIAL_FORMATS.length;

// ------------------------------------------------------------ helpers
export const escapeXml = (text: string) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Approximate wrapping: average glyph ≈ 0.56em for grotesks, 0.62em for
// mono. Emoji count double. Good enough for headline layout without a DOM.
export const wrapText = (text: string, maxWidthPx: number, fontSizePx: number, mono = false): string[] => {
	const unit = fontSizePx * (mono ? 0.62 : 0.56);
	const budget = Math.max(4, Math.floor(maxWidthPx / unit));
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = '';
	const width = (value: string) => Array.from(value).reduce((sum, char) => sum + (char.codePointAt(0)! > 0xffff ? 2 : 1), 0);
	for (const word of words) {
		const candidate = line ? `${line} ${word}` : word;
		if (width(candidate) > budget && line) {
			lines.push(line);
			line = word;
		} else {
			line = candidate;
		}
	}
	if (line) lines.push(line);
	return lines;
};

const textBlock = (
	lines: string[],
	options: { x: number; y: number; size: number; weight: number; fill: string; font: string; anchor?: 'start' | 'middle' | 'end'; lineHeight?: number; highlight?: { word: string; fill: string }; letterSpacing?: string }
) => {
	const lineHeight = options.lineHeight ?? 1.05;
	const spans = lines
		.map((line, index) => {
			const dy = index === 0 ? 0 : options.size * lineHeight;
			let content = escapeXml(line);
			if (options.highlight?.word) {
				const target = options.highlight.word;
				const parts = line.split(new RegExp(`(${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'));
				if (parts.length > 1) {
					content = parts
						.map((part) => (part.toLowerCase() === target.toLowerCase() ? `<tspan fill="${options.highlight!.fill}">${escapeXml(part)}</tspan>` : escapeXml(part)))
						.join('');
				}
			}
			return `<tspan x="${options.x}" dy="${dy}">${content}</tspan>`;
		})
		.join('');
	const spacing = options.letterSpacing ? ` letter-spacing="${options.letterSpacing}"` : '';
	return `<text x="${options.x}" y="${options.y}" font-family='${options.font}' font-size="${options.size}" font-weight="${options.weight}" fill="${options.fill}" text-anchor="${options.anchor ?? 'start'}"${spacing}>${spans}</text>`;
};

const voxelLogo = (x: number, y: number, cell: number, gap = 0) => {
	const pos = [
		[1, 0, RAINBOW[3]],
		[0, 1, RAINBOW[2]],
		[1, 1, RAINBOW[1]],
		[2, 1, RAINBOW[4]],
		[1, 2, RAINBOW[0]]
	] as const;
	return pos.map(([cx, cy, fill]) => `<rect x="${x + cx * (cell + gap)}" y="${y + cy * (cell + gap)}" width="${cell}" height="${cell}" fill="${fill}"/>`).join('');
};

const brandChip = (x: number, y: number, scale: number, trend: Trend, align: 'start' | 'end' = 'start') => {
	const cell = 10 * scale;
	const textSize = 26 * scale;
	const width = cell * 3 + 12 * scale + textSize * 5.2;
	const originX = align === 'end' ? x - width : x;
	return `<g>${voxelLogo(originX, y, cell)}<text x="${originX + cell * 3 + 12 * scale}" y="${y + cell * 3 - 6 * scale}" font-family='${trend.font}' font-size="${textSize}" font-weight="800" fill="${trend.palette.ink}" letter-spacing="-0.02em">thingtime</text></g>`;
};

const motif = (trend: Trend, width: number, height: number, seed: string) => {
	const p = trend.palette;
	switch (trend.motif) {
		case 'grid':
			return `<defs><pattern id="grid" width="${Math.round(width / 16)}" height="${Math.round(width / 16)}" patternUnits="userSpaceOnUse"><path d="M ${Math.round(width / 16)} 0 L 0 0 0 ${Math.round(width / 16)}" fill="none" stroke="${p.ink}" stroke-opacity="0.08" stroke-width="2"/></pattern></defs><rect width="${width}" height="${height}" fill="url(#grid)"/>`;
		case 'aurora': {
			const blobs = [
				[0.2, 0.25, RAINBOW[4]],
				[0.8, 0.2, RAINBOW[3]],
				[0.5, 0.85, RAINBOW[0]],
				[0.9, 0.75, RAINBOW[1]]
			] as const;
			return (
				`<defs>${blobs.map(([, , fill], index) => `<radialGradient id="au${index}"><stop offset="0" stop-color="${fill}" stop-opacity="0.75"/><stop offset="1" stop-color="${fill}" stop-opacity="0"/></radialGradient>`).join('')}</defs>` +
				blobs.map(([fx, fy], index) => `<circle cx="${Math.round(width * fx)}" cy="${Math.round(height * fy)}" r="${Math.round(Math.max(width, height) * 0.45)}" fill="url(#au${index})"/>`).join('')
			);
		}
		case 'stars': {
			const count = 26;
			let out = '';
			for (let index = 0; index < count; index++) {
				const h = hashString(`${seed}:star:${index}`);
				const cx = (h % 1000) / 1000;
				const cy = ((h >> 10) % 1000) / 1000;
				const size = 14 + (h % 40);
				const fill = index % 3 === 0 ? '#ffffff' : index % 3 === 1 ? p.accent : p.accent2;
				const x = Math.round(cx * width);
				const y = Math.round(cy * height);
				out += `<path d="M ${x} ${y - size} Q ${x} ${y} ${x + size} ${y} Q ${x} ${y} ${x} ${y + size} Q ${x} ${y} ${x - size} ${y} Q ${x} ${y} ${x} ${y - size} Z" fill="${fill}" opacity="0.85"/>`;
			}
			return out;
		}
		case 'stickers': {
			const labels = ['NEW ✨', 'FREE 🌈', 'OPEN SOURCE', 'NO ADS', 'YOURS 💖', '⌘P', 'v1'];
			let out = '';
			for (let index = 0; index < 6; index++) {
				const h = hashString(`${seed}:sticker:${index}`);
				const x = Math.round(((h % 1000) / 1000) * width);
				const y = Math.round((((h >> 10) % 1000) / 1000) * height);
				const rot = (h % 40) - 20;
				const label = labels[(h + index) % labels.length];
				const w = 34 + label.length * 22;
				const fill = index % 2 ? p.accent : p.accent2;
				out += `<g transform="rotate(${rot} ${x} ${y})" opacity="0.55"><rect x="${x - w / 2}" y="${y - 30}" width="${w}" height="60" rx="14" fill="${fill}" stroke="${p.ink}" stroke-width="4"/><text x="${x}" y="${y + 12}" text-anchor="middle" font-family='${trend.font}' font-size="30" font-weight="800" fill="${p.ink}">${escapeXml(label)}</text></g>`;
			}
			return out;
		}
		case 'noise':
			return `<defs><pattern id="noise" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#ffffff" fill-opacity="0.07"/><circle cx="4" cy="4" r="0.6" fill="#000000" fill-opacity="0.2"/></pattern></defs><rect width="${width}" height="${height}" fill="url(#noise)"/>`;
		case 'rings': {
			let out = '';
			for (let index = 0; index < 5; index++) {
				const r = Math.round(Math.max(width, height) * (0.25 + index * 0.16));
				out += `<circle cx="${Math.round(width * 0.85)}" cy="${Math.round(height * 0.15)}" r="${r}" fill="none" stroke="${index % 2 ? p.accent : p.accent2}" stroke-opacity="0.18" stroke-width="${18 - index * 2}"/>`;
			}
			return out;
		}
		case 'dots':
			return `<defs><pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="${p.accent}" fill-opacity="0.25"/></pattern></defs><rect width="${width}" height="${height}" fill="url(#dots)"/>`;
		case 'stripes':
			return `<defs><pattern id="stripes" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)"><rect width="40" height="8" fill="${p.accent}" fill-opacity="0.09"/></pattern></defs><rect width="${width}" height="${height}" fill="url(#stripes)"/>`;
		default:
			return '';
	}
};

const shadowFor = (trend: Trend, x: number, y: number, w: number, h: number, r: number) => {
	if (trend.shadow === 'hard') return `<rect x="${x + 14}" y="${y + 14}" width="${w}" height="${h}" rx="${r}" fill="${trend.palette.ink}"/>`;
	if (trend.shadow === 'soft') return `<rect x="${x}" y="${y + 18}" width="${w}" height="${h}" rx="${r}" fill="#000000" opacity="0.10"/>`;
	if (trend.shadow === 'glow') return `<rect x="${x - 8}" y="${y - 8}" width="${w + 16}" height="${h + 16}" rx="${r + 8}" fill="${trend.palette.accent}" opacity="0.22"/>`;
	return '';
};

const card = (trend: Trend, x: number, y: number, w: number, h: number, fill = trend.palette.card) =>
	`${shadowFor(trend, x, y, w, h, trend.radius)}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${trend.radius}" fill="${fill}" stroke="${trend.border ? trend.palette.ink : 'none'}" stroke-width="${trend.border}" stroke-opacity="${trend.key === 'gradient-glow' || trend.key === 'dark-neon' ? 0.25 : 1}"/>`;

const pill = (trend: Trend, x: number, y: number, label: string, size: number, fill: string, color: string, anchor: 'start' | 'middle' = 'start') => {
	const w = Math.round(label.length * size * 0.6 + size * 1.6);
	const originX = anchor === 'middle' ? x - w / 2 : x;
	const r = trend.radius === 0 ? 0 : 999;
	return `<rect x="${originX}" y="${y}" width="${w}" height="${Math.round(size * 1.9)}" rx="${r}" fill="${fill}" stroke="${trend.border ? trend.palette.ink : 'none'}" stroke-width="${Math.min(trend.border, 4)}"/><text x="${originX + w / 2}" y="${y + size * 1.3}" text-anchor="middle" font-family='${trend.font}' font-size="${size}" font-weight="800" fill="${color}">${escapeXml(label)}</text>`;
};

// A tiny mock of the product: a window with a tree of key/value rows. Used
// by meme captions, before/after splits and the wide formats.
const mockPanel = (trend: Trend, feature: Feature, x: number, y: number, w: number, h: number, seed: string) => {
	const p = trend.palette;
	const rowH = Math.round(h / 6);
	const rows = [
		['📦', feature.route.replace('/', '') || 'home', ''],
		['💬', 'tagline', truncate(feature.tagline, 22)],
		['✨', 'highlights', '3'],
		['🌈', 'theme', pick(`${seed}:theme`, ['Fable', 'Prism', 'Mine'])],
		['🔐', 'shared with', pick(`${seed}:acl`, ['you', 'family', 'team', 'public'])]
	];
	const font = '"JetBrains Mono", "SF Mono", Menlo, monospace';
	const size = Math.round(rowH * 0.36);
	const body = rows
		.map(([emoji, key, value], index) => {
			const ry = y + rowH * 1.1 + index * rowH * 0.85;
			const dot = RAINBOW[index % 5];
			return `<rect x="${x + 22}" y="${ry - size * 0.9}" width="6" height="${size * 1.3}" fill="${dot}" opacity="0.7"/><text x="${x + 44}" y="${ry}" font-family='${font}' font-size="${size}" fill="${p.ink}">${escapeXml(emoji)} ${escapeXml(key)}</text><text x="${x + w - 22}" y="${ry}" text-anchor="end" font-family='${font}' font-size="${size}" fill="${p.muted}">${escapeXml(value)}</text>`;
		})
		.join('');
	const lights = [RAINBOW[0], RAINBOW[1], RAINBOW[2]].map((fill, index) => `<rect x="${x + 18 + index * 22}" y="${y + 16}" width="12" height="12" fill="${fill}"/>`).join('');
	return `${card(trend, x, y, w, h, p.bg2)}<line x1="${x}" y1="${y + 44}" x2="${x + w}" y2="${y + 44}" stroke="${p.ink}" stroke-opacity="0.15" stroke-width="2"/>${lights}<text x="${x + w / 2}" y="${y + 30}" text-anchor="middle" font-family='${font}' font-size="${Math.round(size * 0.9)}" fill="${p.muted}">tt · ${escapeXml(feature.key.replace(/-/g, '.'))}</text>${body}`;
};

// ------------------------------------------------------------ layouts
type Layout = 'stack' | 'wide' | 'banner';

const layoutFor = (format: SocialFormat): Layout => {
	const ratio = format.width / format.height;
	if (ratio >= 2.4) return 'banner';
	if (ratio >= 1.4) return 'wide';
	return 'stack';
};

export type SocialSvgOptions = SocialAssetRef & { seed?: string };

export const buildSocialSvg = (options: SocialSvgOptions): string => {
	const feature = getFeature(options.feature);
	const trend = getTrend(options.trend);
	const format = getSocialFormat(options.format);
	const seed = options.seed ?? socialAssetKey(options);
	const platform = PLATFORM_FOR_FORMAT[format.key] ?? 'instagram';
	const p = trend.palette;
	const { width, height } = format;
	const layout = layoutFor(format);
	const pad = Math.round(Math.min(width, height) * 0.07);
	const hook = truncate(hookFor(platform, feature, seed), 72);
	const highlight = highlightWord(hook, `${seed}:hl`);
	const categoryLabel = FEATURE_CATEGORY_LABELS[feature.category];

	const parts: string[] = [];
	parts.push(`<rect width="${width}" height="${height}" fill="${p.bg}"/>`);
	if (p.bg !== p.bg2) parts.push(`<defs><linearGradient id="bgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#bgg)"/>`);
	parts.push(motif(trend, width, height, seed));

	const contentW = width - pad * 2;

	if (layout === 'banner') {
		const scale = height / 500;
		parts.push(brandChip(pad, pad, 1.6 * scale, trend));
		const size = Math.round(height * 0.19);
		const lines = wrapText(hook, contentW * 0.62, size, trend.key === 'mono-minimal' || trend.key === 'dark-neon');
		parts.push(textBlock(lines.slice(0, 2), { x: pad, y: height * 0.55 + size * 0.35 - (lines.length > 1 ? size * 0.5 : 0), size, weight: trend.weight, fill: p.ink, font: trend.font, highlight: { word: highlight, fill: p.accent } }));
		parts.push(`<text x="${width - pad}" y="${height * 0.55 + size * 0.6}" text-anchor="end" font-size="${Math.round(height * 0.42)}">${escapeXml(feature.emoji)}</text>`);
		parts.push(pill(trend, width - pad, height - pad - Math.round(height * 0.11), 'thingtime.com', Math.round(height * 0.055), p.accent, trend.key === 'mono-minimal' ? p.bg : '#ffffff', 'middle'));
		return wrap(width, height, parts.join(''), format, feature, trend);
	}

	if (trend.key === 'listicle') {
		parts.push(brandChip(pad, pad, layout === 'wide' ? 1.1 : 1.3, trend));
		const title = `3 things ${feature.name.toLowerCase()} does`;
		const titleSize = Math.round(Math.min(width, height) * (layout === 'wide' ? 0.075 : 0.07));
		const titleLines = wrapText(title, contentW, titleSize);
		const titleY = pad + 90 + titleSize;
		parts.push(textBlock(titleLines, { x: pad, y: titleY, size: titleSize, weight: trend.weight, fill: p.ink, font: trend.font, highlight: { word: '3', fill: p.accent } }));
		const startY = titleY + titleLines.length * titleSize * 1.05 + pad * 0.8;
		const rowH = Math.min(Math.round((height - startY - pad * 1.6) / 3), Math.round(height * 0.2));
		feature.highlights.forEach((item, index) => {
			const y = startY + index * (rowH + 16);
			parts.push(card(trend, pad, y, contentW, rowH));
			const size = Math.round(rowH * 0.3);
			parts.push(`<text x="${pad + 34}" y="${y + rowH / 2 + size * 0.4}" font-family='${trend.font}' font-size="${Math.round(size * 1.6)}" font-weight="900" fill="${index === 0 ? p.accent : index === 1 ? p.accent2 : RAINBOW[0]}">${index + 1}</text>`);
			const lines = wrapText(item, contentW - 140, size);
			parts.push(textBlock(lines.slice(0, 2), { x: pad + 110, y: y + rowH / 2 + (lines.length > 1 ? -size * 0.15 : size * 0.4), size, weight: 700, fill: p.ink, font: trend.font }));
		});
		parts.push(pill(trend, width / 2, height - pad - 60, 'Free while in beta · thingtime.com', Math.round(height * 0.024), p.accent, '#16161a', 'middle'));
		return wrap(width, height, parts.join(''), format, feature, trend);
	}

	if (trend.key === 'before-after') {
		parts.push(brandChip(width / 2 + 120, pad, 1.1, trend));
		const colW = (contentW - 24) / 2;
		const top = pad + 90;
		const colH = height - top - pad - 100;
		parts.push(card(trend, pad, top, colW, colH, '#fff1f1'));
		parts.push(card(trend, pad + colW + 24, top, colW, colH, '#eefaf1'));
		const size = Math.round(Math.min(width, height) * 0.05);
		parts.push(textBlock(['Before 😩'], { x: pad + 28, y: top + size + 24, size, weight: 900, fill: p.accent2, font: trend.font }));
		parts.push(textBlock(['After 🌈'], { x: pad + colW + 52, y: top + size + 24, size, weight: 900, fill: p.accent, font: trend.font }));
		const pains = ['five apps', 'data you rent', 'ads everywhere', 'all or nothing sharing'];
		const rowSize = Math.round(size * 0.62);
		pains.slice(0, 3).forEach((pain, index) => {
			parts.push(textBlock(wrapText(`✕ ${pain}`, colW - 56, rowSize).slice(0, 2), { x: pad + 28, y: top + size * 2.3 + index * rowSize * 2.6, size: rowSize, weight: 600, fill: p.ink, font: trend.font }));
		});
		feature.highlights.forEach((item, index) => {
			parts.push(textBlock(wrapText(`✓ ${item}`, colW - 56, rowSize).slice(0, 2), { x: pad + colW + 52, y: top + size * 2.3 + index * rowSize * 2.6, size: rowSize, weight: 700, fill: p.ink, font: trend.font }));
		});
		parts.push(textBlock(wrapText(hook, contentW, Math.round(size * 0.9)).slice(0, 1), { x: width / 2, y: height - pad - 28, size: Math.round(size * 0.9), weight: 900, fill: p.ink, font: trend.font, anchor: 'middle', highlight: { word: highlight, fill: p.accent } }));
		return wrap(width, height, parts.join(''), format, feature, trend);
	}

	if (trend.key === 'meme-caption') {
		const capSize = Math.round(Math.min(width, height) * (layout === 'wide' ? 0.07 : 0.06));
		const capLines = wrapText(hook, contentW, capSize).slice(0, 3);
		parts.push(textBlock(capLines, { x: pad, y: pad + capSize, size: capSize, weight: 700, fill: p.ink, font: trend.font }));
		const panelTop = pad + capLines.length * capSize * 1.1 + 30;
		const panelH = height - panelTop - pad - 80;
		parts.push(mockPanel(trend, feature, pad, panelTop, contentW, Math.max(200, panelH), seed));
		parts.push(brandChip(pad, height - pad - 40, 0.9, trend));
		parts.push(`<text x="${width - pad}" y="${height - pad - 6}" text-anchor="end" font-family='${trend.font}' font-size="${Math.round(capSize * 0.5)}" fill="${p.muted}">${escapeXml(feature.emoji)} ${escapeXml(feature.name)}</text>`);
		return wrap(width, height, parts.join(''), format, feature, trend);
	}

	if (trend.key === 'bento') {
		parts.push(brandChip(pad, pad, 1.1, trend));
		const top = pad + 80;
		const gap = 18;
		const tileW = (contentW - gap) / 2;
		const bodyH = height - top - pad;
		const tallH = layout === 'wide' ? bodyH : bodyH * 0.55 - gap / 2;
		const shortH = layout === 'wide' ? (bodyH - gap) / 2 : bodyH * 0.45 - gap / 2;
		const size = Math.round(Math.min(width, height) * 0.06);
		parts.push(card(trend, pad, top, tileW, tallH));
		parts.push(`<text x="${pad + 30}" y="${top + size * 2}" font-size="${Math.round(size * 1.8)}">${escapeXml(feature.emoji)}</text>`);
		parts.push(textBlock(wrapText(hook, tileW - 60, size).slice(0, 4), { x: pad + 30, y: top + size * 3.6, size, weight: trend.weight, fill: p.ink, font: trend.font, highlight: { word: highlight, fill: p.accent } }));
		const rightX = pad + tileW + gap;
		if (layout === 'wide') {
			parts.push(card(trend, rightX, top, tileW, shortH, p.accent));
			parts.push(textBlock(wrapText(feature.highlights[0], tileW - 60, size * 0.6).slice(0, 2), { x: rightX + 30, y: top + shortH / 2 + size * 0.1, size: size * 0.6, weight: 700, fill: '#ffffff', font: trend.font }));
			parts.push(card(trend, rightX, top + shortH + gap, tileW, shortH));
			parts.push(textBlock(wrapText(feature.highlights[1], tileW - 60, size * 0.6).slice(0, 2), { x: rightX + 30, y: top + shortH + gap + shortH / 2 + size * 0.1, size: size * 0.6, weight: 700, fill: p.ink, font: trend.font }));
		} else {
			parts.push(card(trend, rightX, top, tileW, tallH, p.accent));
			parts.push(textBlock(wrapText(feature.highlights[0], tileW - 60, size * 0.7).slice(0, 4), { x: rightX + 30, y: top + size * 1.4, size: size * 0.7, weight: 700, fill: '#ffffff', font: trend.font }));
			const lowY = top + tallH + gap;
			parts.push(card(trend, pad, lowY, tileW, shortH));
			parts.push(textBlock(wrapText(feature.highlights[1], tileW - 60, size * 0.6).slice(0, 3), { x: pad + 30, y: lowY + size, size: size * 0.6, weight: 700, fill: p.ink, font: trend.font }));
			parts.push(card(trend, rightX, lowY, tileW, shortH, p.accent2));
			parts.push(textBlock(wrapText(feature.highlights[2], tileW - 60, size * 0.6).slice(0, 3), { x: rightX + 30, y: lowY + size, size: size * 0.6, weight: 700, fill: '#ffffff', font: trend.font }));
		}
		return wrap(width, height, parts.join(''), format, feature, trend);
	}

	// Default composition: hook headline + tagline + CTA (+ mock panel when wide).
	const isMono = trend.key === 'mono-minimal' || trend.key === 'dark-neon';
	const useCard = trend.key === 'gradient-glow' || trend.key === 'pastel-soft' || trend.key === 'y2k-chrome';
	let textX = pad;
	let textW = contentW;
	let textAnchor: 'start' | 'middle' = 'start';
	if (useCard) {
		const inset = Math.round(pad * 0.7);
		parts.push(card(trend, inset, inset, width - inset * 2, height - inset * 2));
		textX = pad + inset * 0.6;
		textW = width - textX * 2;
	}
	if (layout === 'wide') textW = contentW * 0.56;
	if (layout === 'stack' && (trend.key === 'kinetic-type' || trend.key === 'y2k-chrome' || trend.key === 'pastel-soft')) {
		textAnchor = 'middle';
		textX = width / 2;
	}
	parts.push(brandChip(textAnchor === 'middle' ? width / 2 - 100 : textX, pad + (useCard ? pad * 0.4 : 0), layout === 'wide' ? 1.1 : 1.3, trend));
	parts.push(pill(trend, textAnchor === 'middle' ? width / 2 : textX, pad + (useCard ? pad * 0.4 : 0) + 70, `${categoryLabel.emoji} ${categoryLabel.name}`, Math.round(Math.min(width, height) * 0.022), p.bg2 === p.bg ? p.card : p.bg2, p.ink, textAnchor));

	const hookSize = Math.round(Math.min(width, height) * (layout === 'wide' ? 0.095 : trend.key === 'kinetic-type' ? 0.105 : 0.085));
	const hookLines = wrapText(hook, textW, hookSize, isMono).slice(0, 4);
	const emojiSize = Math.round(hookSize * 1.6);
	let cursorY = layout === 'stack' ? height * 0.32 : height * 0.36;
	if (layout === 'stack') {
		parts.push(`<text x="${textAnchor === 'middle' ? width / 2 : textX}" y="${cursorY}" text-anchor="${textAnchor}" font-size="${emojiSize}">${escapeXml(feature.emoji)}</text>`);
		cursorY += hookSize * 1.35;
	}
	parts.push(textBlock(hookLines, { x: textAnchor === 'middle' ? width / 2 : textX, y: cursorY, size: hookSize, weight: trend.weight, fill: p.ink, font: trend.font, anchor: textAnchor, highlight: { word: highlight, fill: p.accent }, letterSpacing: trend.key === 'kinetic-type' ? '-0.03em' : undefined }));
	cursorY += hookLines.length * hookSize * 1.05 + hookSize * 0.4;
	const tagSize = Math.round(hookSize * 0.42);
	const tagLines = wrapText(feature.tagline, textW, tagSize, isMono).slice(0, 3);
	parts.push(textBlock(tagLines, { x: textAnchor === 'middle' ? width / 2 : textX, y: cursorY + tagSize, size: tagSize, weight: 500, fill: p.muted, font: trend.font, anchor: textAnchor, lineHeight: 1.25 }));
	cursorY += tagLines.length * tagSize * 1.25 + tagSize * 1.4;
	const cta = pick(`${seed}:cta`, ['Try it free', 'Open thingtime.com', 'Yours, not rented', 'Start with one thing', 'No ads. Ever.']);
	parts.push(pill(trend, textAnchor === 'middle' ? width / 2 : textX, Math.min(cursorY, height - pad - tagSize * 3.2), cta, Math.round(tagSize * 0.95), p.accent, trend.key === 'mono-minimal' ? p.bg : '#ffffff', textAnchor));

	if (layout === 'wide') {
		const panelX = pad + contentW * 0.6;
		const panelW = contentW * 0.4;
		const panelH = Math.min(height * 0.62, panelW * 0.95);
		parts.push(mockPanel(trend, feature, panelX, (height - panelH) / 2 + 20, panelW, panelH, seed));
	} else {
		parts.push(`<text x="${width - pad}" y="${height - pad}" text-anchor="end" font-family='${trend.font}' font-size="${Math.round(tagSize * 0.85)}" fill="${p.muted}">${escapeXml(format.platform)} · ${format.width}×${format.height}</text>`);
	}
	return wrap(width, height, parts.join(''), format, feature, trend);
};

const wrap = (width: number, height: number, body: string, format: SocialFormat, feature: Feature, trend: Trend) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`${feature.name} — ${trend.name} — ${format.name}`)}"><title>${escapeXml(`${feature.name} · ${trend.name} · ${format.name}`)}</title>${body}</svg>`;

export const socialCaption = (ref: SocialAssetRef) => captionFor(PLATFORM_FOR_FORMAT[ref.format] ?? 'instagram', getFeature(ref.feature), socialAssetKey(ref));

export const svgToDataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
