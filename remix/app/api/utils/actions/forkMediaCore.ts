import { literalAttachmentId, mapCssMediaUrls, isRenderMediaStyleProp } from '../../../components/Sharing/renderMediaCore';
import { mapAuthoredHtmlMedia } from './authoredHtmlMedia';
import { copiedMediaRefs } from '../../../components/Sharing/copiedMediaRefs';

// Preserve the editable template and its argument semantics. Only unresolved
// rendered media gets late-bound; a re-fork composes targets instead of chains.
export const bindCopiedTemplateMedia = (crystal: Record<string, any>, copies: ReadonlyMap<string, string>, unresolved: Iterable<string>): Record<string, any> => {
	if (!crystal.render || typeof crystal.render !== 'object' || Array.isArray(crystal.render)) return crystal;
	const refs = copiedMediaRefs(crystal.render.ttMediaRefs);
	for (const [source, target] of refs) refs.set(source, copies.get(target) || target);
	for (const id of unresolved) if (copies.has(id) && !refs.has(id)) refs.set(id, copies.get(id)!);
	if (!refs.size) return crystal;
	if (refs.size > 512) throw new Error('The app has too many templated file references to copy safely');
	return { ...crystal, render: { ...crystal.render, ttMediaRefs: [...refs] } };
};

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
