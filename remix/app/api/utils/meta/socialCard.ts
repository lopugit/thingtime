import { Resvg } from '@resvg/resvg-js';

import type { SocialPreview } from './socialPreview';
import { SOCIAL_PREVIEW_HEIGHT, SOCIAL_PREVIEW_WIDTH, cleanSocialText, truncateSocialText } from './socialPreview';

const SAFE_IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_CARD_IMAGE_BYTES = 2 * 1024 * 1024;

const escapeXml = (value: string): string =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const wrap = (value: string, width: number, maxLines: number): string[] => {
	const words = cleanSocialText(value).split(' ').filter(Boolean);
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (next.length <= width || !line) line = next;
		else {
			lines.push(line);
			line = word;
			if (lines.length === maxLines) break;
		}
	}
	if (line && lines.length < maxLines) lines.push(line);
	if (words.join(' ').length > lines.join(' ').length && lines.length)
		lines[lines.length - 1] = truncateSocialText(lines[lines.length - 1], Math.max(2, width - 1));
	return lines;
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

const mediaLayout = (preview: SocialPreview, images: readonly (string | null)[]): string => {
	const x = 700;
	const y = 92;
	const width = 430;
	const height = 446;
	const available = images.filter(Boolean);
	const tiles = Math.max(preview.imageCount, available.length);
	if (!tiles) {
		return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="34" fill="url(#empty-panel)" opacity=".95"/>
		${plusMark(824, 200, 40)}
		<circle cx="1070" cy="164" r="42" fill="#FDE047" opacity=".88"/><circle cx="760" cy="488" r="56" fill="#F9A8D4" opacity=".84"/>
		<text x="${x + 46}" y="410" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="30" font-weight="700">Every thing deserves</text>
		<text x="${x + 46}" y="450" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="30" font-weight="700">a little context.</text></g>`;
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
	const titleLines = wrap(preview.title, 38, 3);
	const descriptionLines = wrap(preview.description, 54, preview.options.length ? 2 : 3);
	const badges = preview.badges.slice(0, 3);
	const pollRows = preview.options.slice(0, 3);
	const primary = preview.kind === 'profile' ? '#7C3AED' : preview.kind === 'listing' ? '#EC4899' : preview.kind === 'poll' ? '#2563EB' : '#5B3CC4';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SOCIAL_PREVIEW_WIDTH}" height="${SOCIAL_PREVIEW_HEIGHT}" viewBox="0 0 ${SOCIAL_PREVIEW_WIDTH} ${SOCIAL_PREVIEW_HEIGHT}">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2E1065"/><stop offset=".42" stop-color="${primary}"/><stop offset="1" stop-color="#EC4899"/></linearGradient>
		<linearGradient id="empty-panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#46308C"/><stop offset="1" stop-color="#E060B6"/></linearGradient>
		<filter id="shadow" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#160A35" flood-opacity=".32"/></filter>
	</defs>
	<rect width="1200" height="630" fill="url(#bg)"/>
	<circle cx="1145" cy="-16" r="188" fill="#FDE047" opacity=".30"/><circle cx="100" cy="615" r="190" fill="#67E8F9" opacity=".27"/><circle cx="640" cy="48" r="105" fill="#F9A8D4" opacity=".22"/>
	<rect x="44" y="38" width="1112" height="554" rx="42" fill="#FFFFFF" filter="url(#shadow)"/>
	<rect x="44" y="38" width="1112" height="54" rx="42" fill="#17112D"/>
	<rect x="44" y="70" width="1112" height="22" fill="#17112D"/>
	${plusMark(74, 49, 13)}
	<text x="140" y="72" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="2">THINGTIME</text>
	<text x="1050" y="72" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="17" text-anchor="end">✦  ☺  ✚</text>
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
				`<text x="86" y="${preview.author ? 246 : 198 + index * 50}" fill="#17112D" font-family="Arial, sans-serif" font-size="${
					preview.kind === 'profile' ? 42 : 38
				}" font-weight="800">${escapeXml(line)}</text>`
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
				`<rect x="86" y="${preview.author ? 472 + index * 34 : 454 + index * 34}" width="530" height="25" rx="12" fill="#F0EAFF"/><rect x="86" y="${
					preview.author ? 472 + index * 34 : 454 + index * 34
				}" width="${260 + index * 58}" height="25" rx="12" fill="${primary}" opacity=".85"/><text x="98" y="${
					preview.author ? 491 + index * 34 : 473 + index * 34
				}" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(truncateSocialText(option, 48))}</text>`
		)
		.join('')}
	${badges
		.map(
			(badge, index) =>
				`<rect x="${86 + index * 164}" y="548" width="150" height="28" rx="14" fill="#F2EEF9"/><text x="${
					161 + index * 164
				}" y="567" fill="#5D5275" font-family="Arial, sans-serif" font-size="13" font-weight="700" text-anchor="middle">${escapeXml(
					truncateSocialText(badge, 20)
				)}</text>`
		)
		.join('')}
	${mediaLayout(preview, imageDataUris)}
	</svg>`;
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
	return new Resvg(svg, { fitTo: { mode: 'width', value: SOCIAL_PREVIEW_WIDTH } }).render().asPng();
};
