import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Resvg } from '@resvg/resvg-js';

import { SOCIAL_CARD_FONTS, SOCIAL_CARD_FONT_FAMILY } from './socialCardFontData';
import type { SocialPreview, SocialPreviewVariant } from './socialPreview';
import { SOCIAL_PREVIEW_HEIGHT, SOCIAL_PREVIEW_WIDTH, cleanSocialText } from './socialPreview';

const SAFE_IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_CARD_IMAGE_BYTES = 2 * 1024 * 1024;

// The badge pills are pinned to the bottom of the white panel, so the poll
// strip above them cannot shift with the author line: three rows at this pitch
// end exactly one pixel above the pills, and an author-offset copy of these
// numbers overprinted them on any tagged poll. Two lines of description (the
// cap whenever options exist) end near y=444, which clears POLL_ROW_TOP.
const POLL_ROW_TOP = 454;
const POLL_ROW_PITCH = 34;
const POLL_ROW_HEIGHT = 25;
const BADGE_ROW_TOP = 548;
// Inner label widths: the poll row runs x=86..616 with its text inset at x=98,
// and each badge is a 150px pill. Both labels were budgeted in characters, so
// "Build with Thingtime" (exactly the 20 allowed) printed 187px wide and hung
// out of both ends of its pill.
const POLL_LABEL_WIDTH = 506;
const BADGE_LABEL_WIDTH = 134;

type CardTheme = { primary: string; end: string; panelStart: string; panelEnd: string };

const CARD_THEMES: Record<SocialPreviewVariant, CardTheme> = {
	app: { primary: '#5B3CC4', end: '#EC4899', panelStart: '#46308C', panelEnd: '#E060B6' },
	feed: { primary: '#7C3AED', end: '#EC4899', panelStart: '#6D3EC7', panelEnd: '#EC71BA' },
	explore: { primary: '#0E7490', end: '#7C3AED', panelStart: '#0F766E', panelEnd: '#7C3AED' },
	docs: { primary: '#2563EB', end: '#7C3AED', panelStart: '#1D4ED8', panelEnd: '#8B5CF6' },
	collection: { primary: '#0F766E', end: '#2563EB', panelStart: '#047857', panelEnd: '#2563EB' },
	'text-post': { primary: '#7C3AED', end: '#DB2777', panelStart: '#5B21B6', panelEnd: '#DB2777' },
	'image-post': { primary: '#DB2777', end: '#7C3AED', panelStart: '#BE185D', panelEnd: '#7C3AED' },
	gallery: { primary: '#C026D3', end: '#2563EB', panelStart: '#A21CAF', panelEnd: '#2563EB' },
	poll: { primary: '#2563EB', end: '#06B6D4', panelStart: '#1D4ED8', panelEnd: '#0891B2' },
	listing: { primary: '#EC4899', end: '#F97316', panelStart: '#DB2777', panelEnd: '#EA580C' },
	thingtime: { primary: '#0F766E', end: '#7C3AED', panelStart: '#047857', panelEnd: '#6D28D9' },
	share: { primary: '#D97706', end: '#DB2777', panelStart: '#B45309', panelEnd: '#DB2777' },
	comment: { primary: '#DB2777', end: '#7C3AED', panelStart: '#BE185D', panelEnd: '#7C3AED' },
	reply: { primary: '#7C3AED', end: '#2563EB', panelStart: '#6D28D9', panelEnd: '#2563EB' },
	'media-image': { primary: '#C026D3', end: '#2563EB', panelStart: '#A21CAF', panelEnd: '#2563EB' },
	'media-video': { primary: '#2563EB', end: '#DB2777', panelStart: '#1D4ED8', panelEnd: '#BE185D' },
	'media-audio': { primary: '#0891B2', end: '#7C3AED', panelStart: '#0E7490', panelEnd: '#6D28D9' },
	'media-file': { primary: '#475569', end: '#2563EB', panelStart: '#334155', panelEnd: '#2563EB' },
	webpage: { primary: '#0F766E', end: '#0891B2', panelStart: '#047857', panelEnd: '#0E7490' },
	profile: { primary: '#7C3AED', end: '#EC4899', panelStart: '#6D28D9', panelEnd: '#DB2777' },
	thing: { primary: '#4F46E5', end: '#0F766E', panelStart: '#4338CA', panelEnd: '#047857' }
};

// The bundled face is a Latin/Greek/Cyrillic text font with no pictographs, and
// resvg draws a missing glyph as `.notdef` — a literal tofu box. Emoji are
// common in post titles, so strip them from the PNG rather than print squares
// in a headline. The Open Graph text tags keep them: the unfurler renders those
// with its own fonts, and only the image is limited to what we ship.
const CARD_UNRENDERABLE = /[\p{Extended_Pictographic}\u{200D}\u{FE0E}\u{FE0F}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;

// Single choke point for every user-authored value entering the SVG, so the
// drop and the escape can never be applied to one field and skipped on another.
const escapeXml = (value: string): string =>
	value
		.replace(CARD_UNRENDERABLE, '')
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

// The text column runs from x=86 to the media/art panel at x=700.
const TEXT_COLUMN_WIDTH = 594;

// Drop what the bundled face cannot draw before anything is measured, so wrap
// and clamp budget the column against the glyphs that actually get painted.
const cardText = (value: string): string => value.replace(CARD_UNRENDERABLE, '').replace(/\s+/g, ' ').trim();

const clampToWidth = (input: string, maxWidth: number, fontSize: number): string => {
	const value = cardText(input);
	if (socialTextWidth(value, fontSize) <= maxWidth) return value;
	const codePoints = Array.from(value);
	while (codePoints.length && socialTextWidth(`${codePoints.join('')}…`, fontSize) > maxWidth) codePoints.pop();
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

const plusMark = (x: number, y: number, size = 22): string => {
	const cells = [
		[1, 0],
		[0, 1],
		[1, 1],
		[2, 1],
		[1, 2]
	];
	const colours = ['#FFFFFF', '#FDE047', '#FDA4AF', '#C4B5FD', '#86EFAC'];
	return `<g>${cells
		.map(
			([cx, cy], index) =>
				`<rect x="${x + cx * size}" y="${y + cy * size}" width="${size - 3}" height="${size - 3}" rx="${Math.max(4, size / 4)}" fill="${
					colours[index]
				}" />`
		)
		.join('')}</g>`;
};

const colourTile = (index: number, x: number, y: number, width: number, height: number): string => {
	const palettes = [
		['#F5B4E3', '#E589CE'],
		['#B8A3FF', '#8067E8'],
		['#7DD3FC', '#3B82F6'],
		['#86EFAC', '#22C55E']
	];
	const [start, end] = palettes[index % palettes.length];
	return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="24" fill="url(#tile-${index})" /><defs><linearGradient id="tile-${index}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>`;
};

const imageTile = (href: string | undefined, index: number, x: number, y: number, width: number, height: number): string => {
	const clip = `clip-${index}`;
	if (!href) return colourTile(index, x, y, width, height);
	return `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="24"/></clipPath><image href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`;
};

const panelArt = (variant: SocialPreviewVariant): string => {
	switch (variant) {
		case 'text-post':
			return '<path d="M796 226h190a28 28 0 0 1 28 28v104a28 28 0 0 1-28 28h-93l-44 37v-37h-53a28 28 0 0 1-28-28V254a28 28 0 0 1 28-28Z" fill="#FDE047" opacity=".96"/><path d="M812 282h150M812 316h112" stroke="#5B21B6" stroke-width="14" stroke-linecap="round"/>';
		case 'image-post':
		case 'gallery':
		case 'media-image':
			return '<rect x="764" y="178" width="132" height="144" rx="20" fill="#F9A8D4"/><rect x="912" y="212" width="150" height="170" rx="20" fill="#FDE047"/><path d="m780 300 42-45 32 32 18-20 46 48" stroke="#5B21B6" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="854" cy="224" r="15" fill="#FFFFFF"/>';
		case 'poll':
			return '<rect x="774" y="250" width="86" height="148" rx="22" fill="#67E8F9"/><rect x="884" y="196" width="86" height="202" rx="22" fill="#FDE047"/><rect x="994" y="228" width="86" height="170" rx="22" fill="#F9A8D4"/><path d="M786 430h286" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round"/>';
		case 'listing':
			return '<path d="M812 188h174l88 88-174 174-88-88V188Z" fill="#FDE047"/><circle cx="868" cy="244" r="18" fill="#DB2777"/><text x="936" y="350" fill="#DB2777" font-family="Arial, sans-serif" font-size="92" font-weight="800" text-anchor="middle">$</text>';
		case 'thingtime':
		case 'thing':
			return '<circle cx="912" cy="296" r="66" fill="#FDE047"/><circle cx="786" cy="212" r="30" fill="#67E8F9"/><circle cx="1032" cy="208" r="30" fill="#F9A8D4"/><circle cx="1024" cy="412" r="30" fill="#86EFAC"/><path d="M812 228 862 268m104 0 46-42m-52 82 44 82m-158-82-38 4" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round"/>';
		case 'share':
			return '<path d="M788 262h176l-36-36m36 36-36 36M1036 358H860l36-36m-36 36 36 36" fill="none" stroke="#FDE047" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/><circle cx="798" cy="358" r="28" fill="#F9A8D4"/><circle cx="1044" cy="262" r="28" fill="#67E8F9"/>';
		case 'comment':
		case 'reply':
			return '<path d="M780 226h174a26 26 0 0 1 26 26v92a26 26 0 0 1-26 26h-80l-38 30v-30h-56a26 26 0 0 1-26-26v-92a26 26 0 0 1 26-26Z" fill="#FDE047"/><path d="M902 330h126a26 26 0 0 1 26 26v76a26 26 0 0 1-26 26h-48l-32 26v-26h-46a26 26 0 0 1-26-26v-76a26 26 0 0 1 26-26Z" fill="#F9A8D4"/><path d="M796 280h110m-110 30h74m48 78h86" stroke="#5B21B6" stroke-width="12" stroke-linecap="round"/>';
		case 'media-video':
			return '<rect x="768" y="198" width="344" height="238" rx="34" fill="#111827" opacity=".82"/><path d="m912 258 92 58-92 58Z" fill="#FDE047"/><circle cx="794" cy="222" r="10" fill="#F9A8D4"/>';
		case 'media-audio':
			return '<path d="M770 322h36v-72h32v144h32V216h32v212h32V250h32v144h32V206h32v232h32v-116h36" fill="none" stroke="#FDE047" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>';
		case 'media-file':
			return '<path d="M818 184h166l80 80v186a26 26 0 0 1-26 26H818a26 26 0 0 1-26-26V210a26 26 0 0 1 26-26Z" fill="#FDE047"/><path d="M984 184v80h80M836 326h170m-170 40h138m-138 40h100" stroke="#334155" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
		case 'webpage':
		case 'docs':
			return '<rect x="786" y="172" width="280" height="310" rx="28" fill="#FDE047"/><path d="M832 240h176m-176 48h150m-150 48h176m-176 48h122" stroke="#0F766E" stroke-width="16" stroke-linecap="round"/>';
		case 'collection':
			return '<rect x="778" y="196" width="116" height="116" rx="28" fill="#FDE047"/><rect x="924" y="196" width="116" height="116" rx="28" fill="#F9A8D4"/><rect x="778" y="342" width="116" height="116" rx="28" fill="#67E8F9"/><rect x="924" y="342" width="116" height="116" rx="28" fill="#86EFAC"/>';
		case 'profile':
			return '<circle cx="918" cy="278" r="104" fill="#FDE047"/><circle cx="918" cy="258" r="39" fill="#7C3AED"/><path d="M838 366c16-60 144-60 160 0" fill="#7C3AED"/>';
		case 'feed':
		case 'explore':
			return '<circle cx="820" cy="232" r="52" fill="#FDE047"/><circle cx="1008" cy="224" r="42" fill="#F9A8D4"/><circle cx="936" cy="400" r="76" fill="#67E8F9"/><path d="M820 284 914 354m74-88-34 74" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round"/>';
		case 'app':
		default:
			return `${plusMark(
				824,
				200,
				40
			)}<circle cx="1070" cy="164" r="42" fill="#FDE047" opacity=".88"/><circle cx="760" cy="488" r="56" fill="#F9A8D4" opacity=".84"/>`;
	}
};

const panelCopy = (variant: SocialPreviewVariant): [string, string] => {
	switch (variant) {
		case 'text-post':
			return ['A thought,', 'with its context.'];
		case 'poll':
			return ['A question worth', 'answering together.'];
		case 'listing':
			return ['A good find,', 'ready to share.'];
		case 'thingtime':
		case 'thing':
			return ['A thing with', 'its own little world.'];
		case 'share':
			return ['Pass the good', 'things along.'];
		case 'comment':
		case 'reply':
			return ['A conversation', 'keeps its thread.'];
		case 'media-video':
			return ['Press play on', 'the full moment.'];
		case 'media-audio':
			return ['Listen to the', 'little details.'];
		case 'media-file':
			return ['The file, with', 'its useful context.'];
		case 'webpage':
		case 'docs':
			return ['A page made', 'to be shared.'];
		default:
			return ['Every thing deserves', 'a little context.'];
	}
};

const mediaLayout = (preview: SocialPreview, images: readonly (string | null)[], theme: CardTheme): string => {
	const x = 700;
	const y = 92;
	const width = 430;
	const height = 446;
	const available = images.filter(Boolean);
	const tiles = Math.max(preview.imageCount, available.length);
	if (!tiles) {
		const [firstLine, secondLine] = panelCopy(preview.variant);
		// Each variant positions its illustration independently, but the copy sits
		// at two fixed baselines — so the poll's white axis stroke ran through
		// "answering together" and the docs page rect put white text on yellow.
		// A scrim is the one treatment that works for every variant without
		// pinning twenty pieces of art to a shared bottom edge; it is clipped to
		// the panel so it cannot square off the panel's rounded corners.
		const scrimTop = y + height - 220;
		return `<g data-preview-panel="${
			preview.variant
		}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="34" fill="url(#empty-panel)" opacity=".95"/>
		${panelArt(preview.variant)}
		<defs><clipPath id="empty-panel-clip"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="34"/></clipPath>
		<linearGradient id="panel-scrim" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#160A35" stop-opacity="0"/><stop offset=".55" stop-color="#160A35" stop-opacity=".62"/><stop offset="1" stop-color="#160A35" stop-opacity=".78"/></linearGradient></defs>
		<rect data-preview-scrim="1" x="${x}" y="${scrimTop}" width="${width}" height="${
			y + height - scrimTop
		}" fill="url(#panel-scrim)" clip-path="url(#empty-panel-clip)"/>
		<text x="${x + 46}" y="410" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="30" font-weight="700">${escapeXml(firstLine)}</text>
		<text x="${x + 46}" y="450" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="30" font-weight="700">${escapeXml(secondLine)}</text></g>`;
	}
	const count = Math.min(4, Math.max(1, tiles));
	if (count === 1) return imageTile(images[0] || undefined, 0, x, y, width, height);
	if (count === 2)
		return `${imageTile(images[0] || undefined, 0, x, y, width / 2 - 8, height)}${imageTile(
			images[1] || undefined,
			1,
			x + width / 2 + 8,
			y,
			width / 2 - 8,
			height
		)}`;
	const tileWidth = width / 2 - 8;
	const tileHeight = height / 2 - 8;
	return Array.from({ length: count }, (_, index) =>
		imageTile(
			images[index] || undefined,
			index,
			x + (index % 2) * (tileWidth + 16),
			y + Math.floor(index / 2) * (tileHeight + 16),
			tileWidth,
			tileHeight
		)
	).join('');
};

export const buildSocialCardSvg = (preview: SocialPreview, imageDataUris: readonly (string | null)[] = []): string => {
	const titleFontSize = preview.kind === 'profile' ? 42 : 38;
	const titleLines = wrap(preview.title, titleFontSize, 3);
	const descriptionLines = wrap(preview.description, 21, preview.options.length ? 2 : 3);
	const badges = preview.badges.slice(0, 3);
	const pollRows = preview.options.slice(0, 3);
	const theme = CARD_THEMES[preview.variant];
	const primary = theme.primary;
	return `<svg xmlns="http://www.w3.org/2000/svg" data-preview-variant="${
		preview.variant
	}" width="${SOCIAL_PREVIEW_WIDTH}" height="${SOCIAL_PREVIEW_HEIGHT}" viewBox="0 0 ${SOCIAL_PREVIEW_WIDTH} ${SOCIAL_PREVIEW_HEIGHT}">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2E1065"/><stop offset=".42" stop-color="${primary}"/><stop offset="1" stop-color="${
		theme.end
	}"/></linearGradient>
		<linearGradient id="empty-panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${theme.panelStart}"/><stop offset="1" stop-color="${
		theme.panelEnd
	}"/></linearGradient>
		<filter id="shadow" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#160A35" flood-opacity=".32"/></filter>
	</defs>
	<rect width="1200" height="630" fill="url(#bg)"/>
	<circle cx="1145" cy="-16" r="188" fill="#FDE047" opacity=".30"/><circle cx="100" cy="615" r="190" fill="#67E8F9" opacity=".27"/><circle cx="640" cy="48" r="105" fill="#F9A8D4" opacity=".22"/>
	<rect x="44" y="38" width="1112" height="554" rx="42" fill="#FFFFFF" filter="url(#shadow)"/>
	<rect x="44" y="38" width="1112" height="54" rx="42" fill="#17112D"/>
	<rect x="44" y="70" width="1112" height="22" fill="#17112D"/>
	${plusMark(74, 49, 13)}
	<text x="140" y="72" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="2">THINGTIME</text>
	<!-- The chrome's star/smiley/plus motifs are drawn, not typed: Liberation Sans
	     has no U+2726 or U+271A, so as text they were two .notdef boxes. -->
	<g opacity=".85">
		<path d="M1006 55.5 1009 62 1015.5 65 1009 68 1006 74.5 1003 68 996.5 65 1003 62Z" fill="#FFFFFF"/>
		<circle cx="1052" cy="65" r="8.5" fill="none" stroke="#FFFFFF" stroke-width="2.2"/>
		<circle cx="1048.8" cy="62.4" r="1.3" fill="#FFFFFF"/><circle cx="1055.2" cy="62.4" r="1.3" fill="#FFFFFF"/>
		<path d="M1048.4 67.6a4.4 4.4 0 0 0 7.2 0" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
		<path d="M1098 57.5v15M1090.5 65h15" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round"/>
	</g>
	<text x="86" y="134" fill="#7C3AED" font-family="Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="2">${escapeXml(
		preview.eyebrow
	)}</text>
	${
		preview.author
			? `<circle cx="102" cy="178" r="22" fill="${primary}"/><text x="102" y="186" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle">${escapeXml(
					preview.initial || 'T'
			  )}</text><text x="136" y="184" fill="#2B2440" font-family="Arial, sans-serif" font-size="19" font-weight="700">${escapeXml(
					preview.author
			  )}</text>`
			: ''
	}
	${titleLines
		.map(
			(line, index) =>
				`<text x="86" y="${
					(preview.author ? 246 : 198) + index * 50
				}" fill="#17112D" font-family="Arial, sans-serif" font-size="${titleFontSize}" font-weight="800">${escapeXml(line)}</text>`
		)
		.join('')}
	${descriptionLines
		.map(
			(line, index) =>
				`<text x="86" y="${
					preview.author ? 408 + index * 30 : 368 + index * 30
				}" fill="#5F5872" font-family="Arial, sans-serif" font-size="21">${escapeXml(line)}</text>`
		)
		.join('')}
	${pollRows
		.map(
			(option, index) =>
				`<rect x="86" y="${POLL_ROW_TOP + index * POLL_ROW_PITCH}" width="530" height="${POLL_ROW_HEIGHT}" rx="12" fill="#F0EAFF"/><rect x="86" y="${
					POLL_ROW_TOP + index * POLL_ROW_PITCH
				}" width="${260 + index * 58}" height="${POLL_ROW_HEIGHT}" rx="12" fill="${primary}" opacity=".85"/><text x="98" y="${
					POLL_ROW_TOP + 19 + index * POLL_ROW_PITCH
				}" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(
					clampToWidth(option, POLL_LABEL_WIDTH, 14)
				)}</text>`
		)
		.join('')}
	${badges
		.map(
			(badge, index) =>
				`<rect x="${86 + index * 164}" y="${BADGE_ROW_TOP}" width="150" height="28" rx="14" fill="#F2EEF9"/><text x="${
					161 + index * 164
				}" y="${BADGE_ROW_TOP + 19}" fill="#5D5275" font-family="Arial, sans-serif" font-size="13" font-weight="700" text-anchor="middle">${escapeXml(
					clampToWidth(badge, BADGE_LABEL_WIDTH, 13)
				)}</text>`
		)
		.join('')}
	${mediaLayout(preview, imageDataUris, theme)}
	</svg>`;
};

// resvg only loads fonts from a path, so the embedded faces are materialised
// once per process into the runtime's temp dir (writable on Vercel) and reused.
// `loadSystemFonts` is then off deliberately: it keeps the deployed card
// byte-identical to the one CI renders, so the width estimate in
// `socialTextWidth` is calibrated against the face that actually draws.
let cardFontFiles: string[] | null = null;

export const socialCardFontFiles = (): string[] => {
	if (cardFontFiles) return cardFontFiles;
	const directory = join(tmpdir(), 'thingtime-social-card-fonts');
	const files: string[] = [];
	try {
		mkdirSync(directory, { recursive: true });
		for (const font of SOCIAL_CARD_FONTS) {
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
			// `Arial` does not exist on Linux and the card markup asks for
			// `Arial, sans-serif`, so both the generic fallback and the
			// nothing-matched default have to land on the bundled face.
			defaultFontFamily: SOCIAL_CARD_FONT_FAMILY,
			sansSerifFamily: SOCIAL_CARD_FONT_FAMILY
		}
	};
};

const loadAttachmentDataUri = async (attachmentId: string): Promise<string | null> => {
	try {
		const { getAttachmentDownload } = await import('../attachments/attachments');
		const download = await getAttachmentDownload(null, attachmentId, false);
		if (!download.ok) return null;
		const response = await fetch(download.url, { signal: AbortSignal.timeout(5_000) });
		const contentType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() || '';
		const length = Number(response.headers.get('content-length') || 0);
		if (!response.ok || !SAFE_IMAGE_TYPES.has(contentType) || (Number.isFinite(length) && length > MAX_CARD_IMAGE_BYTES)) return null;
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_CARD_IMAGE_BYTES) return null;
		return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
	} catch {
		return null;
	}
};

export const renderSocialCardPng = async (preview: SocialPreview, providedImageDataUris?: readonly (string | null)[]): Promise<Uint8Array> => {
	const imageDataUris =
		providedImageDataUris ?? (await Promise.all(preview.images.slice(0, 4).map((image) => loadAttachmentDataUri(image.attachmentId))));
	const svg = buildSocialCardSvg(preview, imageDataUris);
	return new Resvg(svg, socialCardRenderOptions()).render().asPng();
};
