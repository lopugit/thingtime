import { literalAttachmentId, mapCssMediaUrls, isRenderMediaStyleProp } from '../../../components/Sharing/renderMediaCore';
import { mapAuthoredHtmlMedia } from './authoredHtmlMedia';

// This map contains only newly copied, independently authorized attachments.
// Rewriting is not discovery and cannot grant access to another object. Exact
// URL scalars include persisted component arguments; CSS/HTML use their parsers.
export const rewriteCopiedAttachmentReferences = (
	original: Record<string, any>, copies: ReadonlyMap<string, string>, options: { attachmentIds?: boolean } = {}
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
	const walk = (value: any, key = '', css = false, depth = 0, attachmentIds = false, mapKeys = false): any => {
		if (++visited > 100_000 || depth > 96) throw new Error('The app is too complex to copy safely');
		if (typeof value === 'string') {
			// Persisted args may carry an attachment ID rather than its whole URL.
			// Only exact IDs of authorized copies are mapped, and only in argument
			// values/defaults. Labels, template source and arbitrary prose stay put.
			if (attachmentIds && copies.has(value)) return copies.get(value);
			if (key === 'html') return mapAuthoredHtmlMedia(value, url);
			return css ? mapCssMediaUrls(value, url) : url(value);
		}
		if (!value || typeof value !== 'object') return value;
		if (Array.isArray(value)) return value.map((child) => walk(child, key, css, depth + 1, attachmentIds));
		return Object.fromEntries(Object.entries(value).map(([name, child]) => [mapKeys ? copies.get(name) || name : name,
			walk(child, name, css || name === 'css' || name === 'previewBg' || isRenderMediaStyleProp(name), depth + 1,
				attachmentIds || name === 'savedArgs' || (name === 'args' && !Array.isArray(child)) || (key === 'args' && name === 'default') ||
				(key === 'ttIf' && (name === 'equals' || name === 'value')), key === 'ttMap' && name === 'values')]));
	};
	return walk(original, '', false, 0, options.attachmentIds);
};
