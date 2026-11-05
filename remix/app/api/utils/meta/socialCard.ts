import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Resvg } from '@resvg/resvg-js';

import { loadSocialCardAttachmentImage } from './socialCardImages';
import { SOCIAL_CARD_FONTS } from './socialCardFontData';
import { SOCIAL_CARD_BRAND_FONTS } from './socialCardBrandFontData';
import { SOCIAL_CARD_BRAND as BRAND, socialCardLogo } from './socialCardBrand';
import { resolveSocialPreviewDesign, type SocialPreviewTemplate } from '../../../utils/socialPreviewDesign';
import type { SocialPreview } from './socialPreview';
import { SOCIAL_PREVIEW_HEIGHT, SOCIAL_PREVIEW_WIDTH, cleanSocialText } from './socialPreview';

// Each normalized image is bounded independently; this also bounds the collage.
const MAX_CARD_COLLAGE_PIXELS = 80_000_000;

// The compositional templates share measured typography and the canonical
// branding assets. Presentation choices do not change the public projection.
type CardTemplate = SocialPreviewTemplate;
type CardLayout = 'text' | 'photo' | 'gallery';
const EYEBROW_LETTER_SPACING = 2;
// The bundled face is a Latin/Greek/Cyrillic text font with no pictographs, and
// resvg draws a missing glyph as `.notdef` — a literal tofu box. Emoji are
// common in post titles, so strip them from the PNG rather than print squares
// in a headline. The Open Graph text tags keep them: the unfurler renders those
// with its own fonts, and only the image is limited to what we ship.
const CARD_UNRENDERABLE = /[\p{Extended_Pictographic}\u{200D}\u{FE0E}\u{FE0F}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;

// Escaping is not enough to make a value XML: the characters below have no
// representation at all in XML 1.0 — not literal, not as a numeric reference —
// so resvg's parser rejects the WHOLE document rather than the one glyph, and
// `new Resvg(...)` throws before anything is drawn. `cleanSocialText` strips
// \p{Cc}, but U+FFFE/U+FFFF are \p{Cn} noncharacters: legal in a JS string,
// legal UTF-8, legal in Mongo, and legal in a percent-encoded URL. So they pass
// every existing filter and reach the parser. Two ways that bites:
//   - Any public post/profile/page whose text contains one renders no card at
//     all — the route falls back to the generic one for a perfectly good post.
//   - `/social-card?path=/docs/<U+FFFF>` puts it in `staticSocialPreview`'s own
//     title, which is exactly what the route's catch block re-renders as its
//     "safe fallback" — so both renders throw and the public, unauthenticated
//     endpoint answers 500 instead of a card.
// Tab/LF/CR are the three controls XML does allow and the `\s+` collapse below
// handles them; this class is the rest, kept self-contained rather than relying
// on which upstream helper happened to run first.
const CARD_NON_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

// Single choke point for every user-authored value entering the SVG, so the
// drop and the escape can never be applied to one field and skipped on another.
const escapeXml = (value: string): string =>
	value
		.replace(CARD_UNRENDERABLE, '')
		.replace(CARD_NON_XML, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');

// A character budget cannot express "must not run under the art panel": the
// same 27 characters are 470px of narrow letters or 700px of capitals, and the
// card is drawn where `Arial` does not exist (Vercel/CI resolve the
// `sans-serif` fallback), which is wider again than the Arial these numbers
// were first eyeballed against. So measure instead, with the widest advance
// resvg reported per class for that Linux fallback face — an estimate that is
// never under the real width, and comfortably over it on a machine with real
// Arial. Unknown scripts and emoji bill at a full em.
const glyphEm = (character: string): number => {
	if (character === ' ') return 0.35;
	if (/[iljI.,;:!'|]/.test(character)) return 0.46;
	if (/[MWmw@%]/.test(character)) return 1.11;
	if (/[A-Z]/.test(character)) return 0.85;
	if (/[a-z0-9]/.test(character)) return 0.72;
	return 1.1;
};

export const socialTextWidth = (value: string, fontSize: number): number =>
	Array.from(value).reduce((total, character) => total + glyphEm(character) * fontSize, 0);

// Default text-only measure; photo and gallery templates pass narrower measures.
const TEXT_COLUMN_WIDTH = 780;

// Drop what the bundled face cannot draw before anything is measured, so wrap
// and clamp budget the column against the glyphs that actually get painted.
// Both classes, for the same reason `escapeXml` applies both: a value that
// survives here but is dropped there would be measured, given a slot, and then
// painted as nothing — the exact mismatch `badgeRenders`/`cardInitial` exist to
// prevent.
const cardText = (value: string): string => value.replace(CARD_UNRENDERABLE, '').replace(CARD_NON_XML, '').replace(/\s+/g, ' ').trim();

// A badge that strips to a bare hashtag marker (`#🎉`) is as empty as one that
// strips to nothing at all.
const badgeRenders = (badge: string): boolean => cardText(badge).replace(/^#/, '').length > 0;

// The narrowest advance `glyphEm` can return. A prefix of k code points is
// therefore always at least k*NARROWEST_GLYPH_EM*fontSize wide, which is what
// lets the clamp below discard a tail it has not measured.
const NARROWEST_GLYPH_EM = 0.35;

// `letterSpacing` is the SVG attribute of the same name: resvg adds it after
// every glyph but the last, so a label the width estimate calls safe is really
// that much wider on the eyebrow line.
const clampToWidth = (input: string, maxWidth: number, fontSize: number, letterSpacing = 0, mono = false): string => {
	const width = (text: string): number => (mono ? Math.max(Array.from(text).length * fontSize * 0.6, socialTextWidth(text, fontSize)) : socialTextWidth(text, fontSize)) + Math.max(0, Array.from(text).length - 1) * letterSpacing;
	const value = cardText(input);
	if (width(value) <= maxWidth) return value;
	// Pop-and-remeasure is quadratic — each iteration re-joins and re-measures
	// the WHOLE remaining string — and not every clamped value is bounded before
	// it gets here. Title and description are (TITLE_MAX/DESCRIPTION_MAX), but a
	// badge and a poll row are not: both come from `crystal.thing`, which is
	// deliberately open user JSON with no per-field cap, so `thing.status` or a
	// poll option on an ordinary public post can be arbitrarily long. That made
	// /social-card?path=/post/:id a self-service hang — measured on this
	// estimator, 6.4k code points cost 1.9s and 12.8k cost 7.4s, four times the
	// work for twice the input, on a public and unauthenticated endpoint.
	//
	// Nothing past the widest possible fit can survive the loop anyway: at
	// NARROWEST_GLYPH_EM per glyph (plus letter spacing) no prefix longer than
	// this can measure under `maxWidth`. Dropping that tail up front is not an
	// approximation of the old answer — the loop would have popped every one of
	// those code points — it just stops paying a full re-measure per pop.
	const perGlyph = NARROWEST_GLYPH_EM * fontSize + Math.max(0, letterSpacing);
	const codePoints = perGlyph > 0 ? Array.from(value).slice(0, Math.ceil(maxWidth / perGlyph) + 1) : [];
	while (codePoints.length && width(`${codePoints.join('')}…`) > maxWidth) codePoints.pop();
	return `${codePoints.join('').trimEnd()}…`;
};

const wrap = (value: string, fontSize: number, maxLines: number, maxWidth = TEXT_COLUMN_WIDTH): string[] => {
	const words = cardText(cleanSocialText(value)).split(' ').filter(Boolean);
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (socialTextWidth(next, fontSize) <= maxWidth || !line) line = next;
		else {
			lines.push(line);
			line = word;
			if (lines.length === maxLines) break;
		}
	}
	if (line && lines.length < maxLines) lines.push(line);
	// Dropped words must stay visible as an ellipsis. A last line that already
	// fits the column is not shortened by the clamp, so mark it here rather than
	// letting a cut-off headline read like a complete one. Every line is clamped
	// because a single unbroken word (a pasted URL, say) is never wrapped above
	// and would otherwise print straight through the panel.
	const dropped = words.join(' ').length > lines.join(' ').length;
	return lines.map((entry, index) => {
		const clamped = clampToWidth(entry, maxWidth, fontSize);
		if (index < lines.length - 1 || !dropped || clamped.endsWith('…')) return clamped;
		return clampToWidth(`${clamped}…`, maxWidth, fontSize);
	});
};

const rect = (x: number, y: number, width: number, height: number, fill: string, extra = ''): string =>
	`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" ${extra}/>`;

// These are enlarged fragments of the canonical voxel mark, not illustrative
// stand-ins for the linked content. Photos always remain real attachment pixels.
const brandGeometry = (template: CardTemplate, x: number): string => {
	if (template === 'editorial-white') {
		return `${rect(x + 35, 0, 150, 156, BRAND.sky)}${rect(x + 235, 0, 115, 216, BRAND.mint)}${socialCardLogo(x + 15, 190, 225, 225, true)}<path d="M${x} 420h150v210H${x}v-65h65v-70h-65Z" fill="${BRAND.purple}"/>${rect(x + 150, 500, 130, 130, BRAND.yellow)}${rect(x + 280, 565, 70, 65, BRAND.orange)}`;
	}
	if (template === 'night-garden') {
		return `${socialCardLogo(x + 30, 210, 256, 256, true)}${rect(x + 225, 80, 86, 86, BRAND.sky)}${rect(x + 245, 493, 66, 66, BRAND.pink)}`;
	}
	if (template === 'pink-invitation') {
		return `${rect(x + 136, 16, 162, 162, BRAND.mint)}${rect(x - 16, 182, 162, 162, BRAND.yellow)}${rect(x + 166, 360, 174, 238, BRAND.purple)}${rect(x + 42, 484, 150, 114, BRAND.purple)}`;
	}
	return `${rect(x + 42, 78, 94, 94, BRAND.blue)}<path d="M${x + 174} 80h178v470H${x + 174}V390h80V250h-80Z" fill="${BRAND.purple}"/>`;
};

const imageTile = (href: string | null | undefined, index: number, x: number, y: number, width: number, height: number): string => {
	const fill = [BRAND.pink, BRAND.blue, BRAND.yellow, BRAND.green][index % 4];
	const fallback = rect(x, y, width, height, fill, `data-image-fallback="${index}"`);
	if (!href) return fallback;
	// Only loader-produced data URIs are accepted. Keep even the internal test
	// injection seam from becoming arbitrary URL fetching or XML injection.
	if (!/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(href)) return fallback;
	return `${fallback}<clipPath id="clip-${index}">${rect(x, y, width, height, '#FFFFFF')}</clipPath><image data-preview-image="${index}" href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${index})"/>`;
};

const mediaLayout = (images: readonly (string | null)[], count: number, layout: CardLayout, x: number, y: number, width: number, height: number): string => {
	const tiles = layout === 'photo' ? 1 : Math.min(4, Math.max(1, count));
	if (tiles === 1) return imageTile(images[0], 0, x, y, width, height);
	const gap = 8;
	const tileWidth = (width - gap) / 2;
	if (tiles === 2) return imageTile(images[0], 0, x, y, tileWidth, height) + imageTile(images[1], 1, x + tileWidth + gap, y, tileWidth, height);
	const tileHeight = (height - gap) / 2;
	if (tiles === 3) return imageTile(images[0], 0, x, y, tileWidth, height) + imageTile(images[1], 1, x + tileWidth + gap, y, tileWidth, tileHeight) + imageTile(images[2], 2, x + tileWidth + gap, y + tileHeight + gap, tileWidth, tileHeight);
	return Array.from({ length: tiles }, (_, index) => imageTile(images[index], index, x + index % 2 * (tileWidth + gap), y + Math.floor(index / 2) * (tileHeight + gap), tileWidth, tileHeight)).join('');
};

const fitTitle = (title: string, width: number, maxLines: number, largest: number): { lines: string[]; size: number } => {
	for (let size = largest; size >= 44; size -= 2) {
		const lines = wrap(title, size, maxLines, width);
		if (!lines.some((line) => line.endsWith('…'))) return { lines, size };
	}
	return { lines: wrap(title, 44, maxLines, width), size: 44 };
};

// Colour Blocks uses the approved strip-and-caption composition for galleries
// and an overlapping white headline panel for photo-led pages. Every text area
// has its own measure; content is never painted on top of the photograph.
const colourBlocksMediaCard = (preview: SocialPreview, images: readonly (string | null)[], layout: 'gallery' | 'photo'): string => {
	const gallery = layout === 'gallery';
	const width = gallery ? 750 : 700;
	let title = fitTitle(preview.title, width, 2, 58);
	if (gallery) {
		// The approved gallery caption keeps short headlines on one line while
		// retaining two measured lines for genuinely longer content.
		for (let size = 58; size >= 50; size -= 2) {
			if (socialTextWidth(cardText(preview.title), size) <= width) { title = { lines: [cardText(preview.title)], size }; break; }
		}
	}
	const pitch = Math.ceil(title.size * 1.12);
	const titleY = gallery ? 476 : 444;
	const descriptionY = titleY + (title.lines.length - 1) * pitch + 42;
	const description = wrap(preview.description, 24, gallery ? 1 : 2, width);
	const text = (role: string, value: string, x: number, y: number, size: number, measure = width, font = BRAND.body, extra = ''): string =>
		`<text data-preview-text="${role}" data-max-width="${measure}" x="${x}" y="${y}" fill="${BRAND.ink}" font-family="${font}, ${font === BRAND.mono ? 'monospace' : 'sans-serif'}" font-size="${size}" ${extra}>${escapeXml(value)}</text>`;
	const count = Math.min(4, Math.max(1, preview.imageCount, images.length));
	const tileWidth = (1200 - (count - 1) * 8) / count;
	const artwork = gallery
		? Array.from({ length: count }, (_, index) => imageTile(images[index], index, index * (tileWidth + 8), 0, tileWidth, 450)).join('')
		: `${rect(0, 0, 320, 480, BRAND.sky)}${imageTile(images[0], 0, 320, 0, 880, 480)}${rect(282, 312, 38, 48, BRAND.orange)}`;
	const eyebrowWidth = gallery && preview.author ? 400 : gallery ? width : 208;
	const authorX = gallery ? 520 : 56;
	const authorY = gallery ? 408 : 94;
	const authorWidth = gallery ? 286 : 208;
	const logoX = gallery ? 900 : 860;
	return `<svg xmlns="http://www.w3.org/2000/svg" data-preview-variant="${escapeXml(preview.variant)}" data-preview-template="colour-blocks" data-preview-layout="${layout}" data-preview-composition="${gallery ? 'photo-strip' : 'page-overlap'}" width="1200" height="630" viewBox="0 0 1200 630">
		${rect(0, 0, 1200, 630, '#FFFFFF')}
		<g data-preview-panel="${escapeXml(preview.variant)}">${artwork}</g>
		${rect(0, gallery ? 376 : 360, gallery ? 865 : 820, gallery ? 254 : 270, gallery ? BRAND.yellow : '#FFFFFF', 'data-preview-caption="1"')}
		${rect(gallery ? 865 : 820, gallery ? 450 : 480, gallery ? 335 : 380, gallery ? 180 : 150, '#FFFFFF')}
		${text('eyebrow', clampToWidth(preview.eyebrow, eyebrowWidth, 15, EYEBROW_LETTER_SPACING, true), 56, gallery ? 408 : 58, 15, eyebrowWidth, BRAND.mono, `font-weight="500" letter-spacing="${EYEBROW_LETTER_SPACING}"`)}
		${preview.author ? text('author', clampToWidth(preview.author, authorWidth, 16), authorX, authorY, 16, authorWidth, BRAND.body, 'font-weight="600"') : ''}
		${title.lines.map((line, index) => text('title', line, 56, titleY + index * pitch, title.size, width, BRAND.heading, 'font-weight="700"')).join('')}
		${description.map((line, index) => text('description', line, 56, descriptionY + index * 31, 24)).join('')}
		${socialCardLogo(logoX, gallery ? 500 : 514, 260, 64)}
		${text('site', 'thingtime.com', logoX, 600, 17, 280, BRAND.mono)}
	</svg>`;
};

export const buildSocialCardSvg = (preview: SocialPreview, imageDataUris: readonly (string | null)[] = []): string => {
	const { template, layout } = resolveSocialPreviewDesign(preview);
	const count = Math.max(preview.imageCount, imageDataUris.length);
	if (template === 'colour-blocks' && !preview.options.length && (layout === 'gallery' || (layout === 'photo' && preview.variant === 'webpage'))) return colourBlocksMediaCard(preview, imageDataUris, layout);
	const hasMedia = layout !== 'text';
	const pink = template === 'pink-invitation';
	const dark = template === 'night-garden';
	const blocks = template === 'colour-blocks';
	const inset = pink ? 32 : 0;
	const x = pink ? 68 : 56;
	const mediaX = layout === 'gallery' ? 620 : 650;
	const width = hasMedia ? mediaX - x - 48 : pink ? 744 : 780;
	const foreground = dark ? '#FFFFFF' : BRAND.ink;
	const background = dark ? BRAND.ink : blocks ? (hasMedia ? BRAND.blush : BRAND.mint) : '#FFFFFF';
	const pollRows = preview.options.slice(0, 3);
	const badges = preview.kind === 'invite' ? [] : preview.badges.filter(badgeRenders).slice(0, 3);
	const invitation = preview.kind === 'invite' && !hasMedia;
	const title = fitTitle(preview.title, width, pollRows.length || invitation ? 2 : 3, hasMedia ? 62 : invitation ? 84 : 72);
	const pitch = Math.ceil(title.size * 1.12);
	const titleY = blocks ? 160 : invitation ? 280 : pollRows.length ? 254 : 258;
	const descriptionY = titleY + (title.lines.length - 1) * pitch + 48;
	const description = wrap(preview.description, 24, pollRows.length ? 1 : 2, width);
	const text = (role: string, value: string, tx: number, ty: number, size: number, colour = foreground, font = BRAND.body, extra = ''): string =>
		`<text data-preview-text="${role}" data-max-width="${width}" x="${tx}" y="${ty}" fill="${colour}" font-family="${font}, ${font === BRAND.mono ? 'monospace' : 'sans-serif'}" font-size="${size}" ${extra}>${escapeXml(value)}</text>`;
	const logoY = blocks ? 568 : pink ? 66 : 48;
	const footerY = blocks ? 605 : pink ? 580 : 592;
	const media = hasMedia ? mediaLayout(imageDataUris, count, layout, mediaX, inset, 1200 - mediaX - inset, 630 - inset * 2) : brandGeometry(template, 850);
	const content = `${text('eyebrow', clampToWidth(preview.eyebrow, width, 15, EYEBROW_LETTER_SPACING, true), x, blocks ? 58 : 166, 15, foreground, BRAND.mono, `font-weight="500" letter-spacing="${EYEBROW_LETTER_SPACING}"`)}
		${preview.author ? text('author', clampToWidth(preview.author, width, 18), x, blocks ? 92 : 198, 18, foreground, BRAND.body, 'font-weight="600"') : ''}
		${title.lines.map((line, index) => text('title', line, x, titleY + index * pitch, title.size, foreground, BRAND.heading, 'font-weight="700"')).join('')}
		${description.map((line, index) => text('description', line, x, descriptionY + index * 31, 24)).join('')}
		${pollRows.map((option, index) => `${rect(x, 410 + index * 31, width, 26, dark ? BRAND.purple : BRAND.yellow, 'data-preview-option="1"')}${text('option', clampToWidth(option, width - 24, 14), x + 12, 429 + index * 31, 14, dark ? '#FFFFFF' : BRAND.ink, BRAND.body, 'font-weight="600"')}`).join('')}
		${badges.map((badge, index) => `${rect(x + index * 164, 528, 150, 28, dark ? BRAND.purple : '#FFFFFF', 'data-preview-badge="1"')}${text('badge', clampToWidth(badge, 134, 13), x + 8 + index * 164, 547, 13, dark ? '#FFFFFF' : BRAND.ink, BRAND.body, 'font-weight="600"')}`).join('')}`;
	return `<svg xmlns="http://www.w3.org/2000/svg" data-preview-variant="${escapeXml(preview.variant)}" data-preview-template="${template}" data-preview-layout="${layout}" width="${SOCIAL_PREVIEW_WIDTH}" height="${SOCIAL_PREVIEW_HEIGHT}" viewBox="0 0 1200 630">
		${rect(0, 0, 1200, 630, pink ? BRAND.pink : background)}
		${pink ? rect(32, 32, 1136, 566, '#FFFFFF', 'rx="32"') : ''}
		<g data-preview-panel="${escapeXml(preview.variant)}">${media}</g>
		${blocks ? rect(0, 564, hasMedia ? mediaX : 840, 66, '#FFFFFF') : ''}
		${socialCardLogo(x, logoY, blocks ? 260 : hasMedia ? 330 : 430, blocks ? 56 : 82)}
		${content}
		${text('site', 'thingtime.com', blocks ? 350 : x, footerY, blocks ? 16 : 19, dark ? '#FFFFFF' : BRAND.ink, BRAND.mono)}
	</svg>`;
};

// resvg only loads fonts from a path, so the embedded faces are materialised
// once per process into the runtime's temp dir (writable on Vercel) and reused.
// `loadSystemFonts` is then off deliberately: it keeps the deployed card
// byte-identical to the one CI renders. The conservative text-width envelope
// keeps headline and body copy within their column; mono labels use exact advances.
let cardFontFiles: string[] | null = null;

export const socialCardFontFiles = (): string[] => {
	if (cardFontFiles) return cardFontFiles;
	const directory = join(tmpdir(), 'thingtime-social-card-fonts');
	const files: string[] = [];
	try {
		mkdirSync(directory, { recursive: true });
		for (const font of [...SOCIAL_CARD_FONTS, ...SOCIAL_CARD_BRAND_FONTS]) {
			const path = join(directory, font.file);
			if (!existsSync(path)) writeFileSync(path, Buffer.from(font.base64, 'base64'));
			files.push(path);
		}
	} catch (error) {
		// Never fail a card over this: fall back to whatever the host provides.
		// That is nothing on Vercel — hence the loud log — but it is a full font
		// set on a developer machine, so local rendering still works.
		console.error('[social-card] could not materialise the bundled card font; falling back to system fonts:', error);
		cardFontFiles = [];
		return cardFontFiles;
	}
	cardFontFiles = files;
	return cardFontFiles;
};

export const socialCardRenderOptions = (): ConstructorParameters<typeof Resvg>[1] => {
	const fontFiles = socialCardFontFiles();
	return {
		fitTo: { mode: 'width', value: SOCIAL_PREVIEW_WIDTH },
		font: {
			loadSystemFonts: fontFiles.length === 0,
			fontFiles,
			// Canonical /branding faces are bundled; no network or host font
			// fallback changes the shipped typography.
			defaultFontFamily: BRAND.body,
			sansSerifFamily: BRAND.body,
			monospaceFamily: BRAND.mono
		}
	};
};

/**
 * Read at most `limit` bytes of a response body, giving up the moment the cap
 * is passed.
 *
 * `arrayBuffer()` cannot enforce a cap: it buffers the whole body first and can
 * only be measured afterwards, which is the opposite order from what a limit
 * means. A `content-length` pre-check does not stand in for it either — the
 * header is absent on a chunked response, so the check silently passes and the
 * bound stops existing exactly when it is load-bearing. This endpoint is public
 * and unauthenticated and renders up to four images at once, so the read is
 * bounded as it happens instead.
 *
 * Exported for the unit suite: the caller reaches S3 and cannot be tested here.
 */
export { readBodyWithin } from './socialCardImages';

const readUint32BE = (bytes: Uint8Array, offset: number): number =>
	bytes[offset] * 0x1000000 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
const readUint16BE = (bytes: Uint8Array, offset: number): number => (bytes[offset] << 8) | bytes[offset + 1];
const readUint16LE = (bytes: Uint8Array, offset: number): number => bytes[offset] | (bytes[offset + 1] << 8);
const readUint24LE = (bytes: Uint8Array, offset: number): number => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
const asciiAt = (bytes: Uint8Array, offset: number, length: number): string =>
	Array.from(bytes.subarray(offset, offset + length), (byte) => String.fromCharCode(byte)).join('');

type ImageExtent = { width: number; height: number };
const larger = (a: ImageExtent | null, b: ImageExtent | null): ImageExtent | null =>
	!a ? b : !b ? a : b.width * b.height > a.width * a.height ? b : a;

// AVIF keeps its intrinsic size in an `ispe` box nested meta → iprp → ipco.
// Walk the boxes rather than scanning the file for the fourcc: a raw scan can
// match inside compressed image data and read a bogus — possibly small — size,
// and under-reading is the one direction this guard must never fail in. The
// largest `ispe` wins for the same reason (a multi-item file can describe
// thumbnails alongside the full-size item).
const AVIF_CONTAINER_BOXES = new Set(['meta', 'iprp', 'ipco']);
const avifExtent = (bytes: Uint8Array, start: number, end: number, depth = 0): ImageExtent | null => {
	let offset = start;
	let found: ImageExtent | null = null;
	while (offset + 8 <= end && depth < 6) {
		const size = readUint32BE(bytes, offset);
		const type = asciiAt(bytes, offset + 4, 4);
		// size 0 means "runs to the end of the file"; size 1 means a 64-bit
		// length, which no `ispe` ancestor needs, so stop rather than guess.
		const boxEnd = size === 0 ? end : offset + size;
		if (size === 1 || size < 8 || boxEnd > end) break;
		if (type === 'ispe' && offset + 20 <= end) {
			found = larger(found, { width: readUint32BE(bytes, offset + 12), height: readUint32BE(bytes, offset + 16) });
		} else if (AVIF_CONTAINER_BOXES.has(type)) {
			// `meta` is a full box: a version/flags word precedes its children.
			found = larger(found, avifExtent(bytes, offset + 8 + (type === 'meta' ? 4 : 0), boxEnd, depth + 1));
		}
		offset = boxEnd;
	}
	return found;
};

const jpegExtent = (bytes: Uint8Array): ImageExtent | null => {
	let offset = 2;
	while (offset + 9 <= bytes.length) {
		if (bytes[offset] !== 0xff) return null;
		const marker = bytes[offset + 1];
		// Padding, standalone markers (RSTn/TEM/SOI) carry no length word.
		if (marker === 0xff) {
			offset += 1;
			continue;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			offset += 2;
			continue;
		}
		// SOS begins entropy-coded data and EOI ends the image; a frame header
		// always precedes both, so anything not found by here is not there.
		if (marker === 0xda || marker === 0xd9) return null;
		// SOFn — every frame flavour except DHT (C4), JPG (C8) and DAC (CC).
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { width: readUint16BE(bytes, offset + 7), height: readUint16BE(bytes, offset + 5) };
		}
		const segment = readUint16BE(bytes, offset + 2);
		if (segment < 2) return null;
		offset += 2 + segment;
	}
	return null;
};

const webpExtent = (bytes: Uint8Array): ImageExtent | null => {
	const chunk = asciiAt(bytes, 12, 4);
	if (chunk === 'VP8X' && bytes.length >= 30) {
		// The extended header stores canvas dimensions minus one.
		return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
	}
	if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
		// 14 bits of width-1 then 14 bits of height-1, little-endian.
		const packed = readUint16LE(bytes, 21) + readUint16LE(bytes, 23) * 0x10000;
		return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
	}
	if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
		return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff };
	}
	return null;
};

/**
 * Intrinsic pixel dimensions of an encoded image, read from its own header.
 *
 * Dispatched on the magic bytes, never on the declared Content-Type: the type
 * a stored attachment serves is author-supplied metadata, so trusting it is
 * exactly the gap that lets un-measured bytes reach the decoder. Returns null
 * for anything this cannot measure with certainty, and every caller treats
 * null as "do not render" — the branded tile that `imageTile` already paints
 * for an undecodable href.
 *
 * Exported for the unit suite.
 */
export const socialCardImageExtent = (bytes: Uint8Array): ImageExtent | null => {
	const extent =
		bytes.length >= 24 && asciiAt(bytes, 0, 8) === '\x89PNG\r\n\x1a\n' && asciiAt(bytes, 12, 4) === 'IHDR'
			? { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) }
			: bytes.length >= 10 && asciiAt(bytes, 0, 4) === 'GIF8'
			? { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) }
			: bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
			? jpegExtent(bytes)
			: bytes.length >= 16 && asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP'
			? webpExtent(bytes)
			: bytes.length >= 12 && asciiAt(bytes, 4, 4) === 'ftyp'
			? avifExtent(bytes, 0, bytes.length)
			: null;
	return extent && Number.isFinite(extent.width) && Number.isFinite(extent.height) && extent.width > 0 && extent.height > 0 ? extent : null;
};

export const renderSocialCardPng = async (preview: SocialPreview, providedImageDataUris?: readonly (string | null)[]): Promise<Uint8Array> => {
	let imageDataUris = providedImageDataUris;
	if (!imageDataUris) {
		// The fetches stay concurrent — they are S3 round trips — but the decode
		// budget is spent in tile order afterwards, so four in-budget photos still
		// cannot hand the renderer four times the per-image ceiling at once. A
		// dropped tile is not a blank slab: `imageTile` paints its branded tile
		// wherever an href is missing.
		const loaded = await Promise.all(preview.images.slice(0, 4).map((image) => loadSocialCardAttachmentImage(image.attachmentId)));
		let budget = MAX_CARD_COLLAGE_PIXELS;
		imageDataUris = loaded.map((image) => {
			if (!image || image.pixels > budget) return null;
			budget -= image.pixels;
			return image.uri;
		});
	}
	const svg = buildSocialCardSvg(preview, imageDataUris);
	return new Resvg(svg, socialCardRenderOptions()).render().asPng();
};
