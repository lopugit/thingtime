import { literalAttachmentId, mapCssMediaUrls, isRenderMediaStyleProp } from '../../../components/Sharing/renderMediaCore';
import { mapAuthoredHtmlMedia } from './authoredHtmlMedia';

// This map contains only newly copied, independently authorized attachments.
// Rewriting is not discovery and cannot grant access to another object. Exact
// URL scalars include persisted component arguments; CSS/HTML use their parsers.
export const rewriteCopiedAttachmentReferences = (
	original: Record<string, any>, copies: ReadonlyMap<string, string>
): Record<string, any> => {
	const url = (value: string): string => {
		const source = literalAttachmentId(value);
		const copied = source && copies.get(source);
		if (!copied) return value;
		const parsed = new URL(value, 'https://local.invalid');
		parsed.searchParams.set('id', copied);
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	};
	let visited = 0;
	const walk = (value: any, key = '', css = false, depth = 0): any => {
		if (++visited > 100_000 || depth > 96) throw new Error('The app is too complex to copy safely');
		if (typeof value === 'string') {
			if (key === 'html') return mapAuthoredHtmlMedia(value, url);
			return css ? mapCssMediaUrls(value, url) : url(value);
		}
		if (!value || typeof value !== 'object') return value;
		if (Array.isArray(value)) return value.map((child) => walk(child, key, css, depth + 1));
		return Object.fromEntries(Object.entries(value).map(([name, child]) => [name,
			walk(child, name, css || name === 'css' || name === 'previewBg' || isRenderMediaStyleProp(name), depth + 1)]));
	};
	return walk(original);
};
