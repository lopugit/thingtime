import valueParser from 'postcss-value-parser';

type MediaUrl = (url: string) => string;

// Discovery re-exports the transport module's grant predicate rather than
// restating it: the parser below decides WHERE a URL sits, sharedMediaCore
// decides WHETHER that URL is a grantable first-party attachment reference.
export { literalAttachmentId } from './sharedMediaCore';

// CSS escapes are decoded before checking origin/path, never by substring.
const cssUnescape = (value: string): string => value.replace(/\\([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\(\r\n|[\n\f\r])|\\(.)/gis, (_match, hex: string | undefined, newline: string | undefined, char: string | undefined) => {
	if (hex) {
		const code = Number.parseInt(hex, 16);
		return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
	}
	return newline ? '' : char || '';
});
const cssQuote = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);

// The value parser splits the optional whitespace terminating a hex escape
// into separate tokens, even inside an identifier (u\\72 l). Rejoin only that
// exact boundary. Preserve the original tokens when serializing the value.
const cssFunctionName = (nodes: valueParser.Node[], index: number): string => {
	let name = nodes[index].value;
	for (let parts = 0; index >= 2 && parts < 32; parts++, index -= 2) {
		const separator = nodes[index - 1];
		const prefix = nodes[index - 2];
		if (separator.type !== 'space' || !/^(?:\r\n|[\t\n\f\r ])$/.test(separator.value) || prefix.type !== 'word' || !/\\[\da-f]{1,6}$/i.test(prefix.value)) break;
		name = prefix.value + separator.value + name;
	}
	return cssUnescape(name).toLowerCase();
};

// Escaped url identifiers do not get the parser's special unquoted-url token.
// Validate the serialized argument as a CSS URL token before decoding it; in
// particular, do not turn malformed whitespace/quotes/nested calls into URLs.
const isUnquotedCssUrl = (value: string): boolean => {
	for (let index = 0; index < value.length; index++) {
		const char = value[index];
		if (char !== '\\') {
			if (char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || /["'()]/.test(char)) return false;
			continue;
		}
		if (++index === value.length || /[\n\r\f]/.test(value[index])) return false;
		if (/[\da-f]/i.test(value[index])) {
			let count = 1;
			while (count < 6 && index + 1 < value.length && /[\da-f]/i.test(value[index + 1])) { index++; count++; }
			if (index + 1 < value.length && /[\t\n\f\r ]/.test(value[index + 1])) {
				index++;
				if (value[index] === '\r' && value[index + 1] === '\n') index++;
			}
		}
	}
	return true;
};

// Parse CSS values, not arbitrary text. Quoted strings/comments and URLs on
// other origins cannot smuggle a nested url(...) into the sharing context.
// Collect first so malformed or over-budget values grant/transform nothing.
export const mapCssMediaUrls = (value: string, mediaUrl: MediaUrl, options: { stored?: boolean; signal?: AbortSignal } = {}): string => {
	if ((!options.stored && value.length > 65536) || !value.includes('(')) return value;
	try {
		const parsed = valueParser(value);
		const candidates: Array<{ value: string; replace: (value: string) => void }> = [];
		const stringNode = (node: valueParser.Node, value: string): valueParser.StringNode => ({ type: 'string', sourceIndex: node.sourceIndex, sourceEndIndex: node.sourceEndIndex, quote: '"', value: cssQuote(value) });
		let visited = 0;
		const stack = [{ nodes: parsed.nodes, entries: parsed.nodes.entries(), depth: 0, imageSet: false }];
		while (stack.length) {
			const frame = stack[stack.length - 1];
			if (!options.stored && frame.depth > 32) throw new Error('CSS depth limit');
			const next = frame.entries.next();
			if (next.done) { stack.pop(); continue; }
			const [index, node] = next.value;
			options.signal?.throwIfAborted();
			if ((!options.stored && ++visited > 2048) || ('unclosed' in node && node.unclosed)) throw new Error('Invalid or oversized CSS');
			if (node.type === 'string' && frame.imageSet) candidates.push({ value: node.value, replace: (value) => { frame.nodes[index] = stringNode(node, value); } });
			if (node.type !== 'function') continue;
			const name = cssFunctionName(frame.nodes, index);
			if (name === 'url') {
				visited += node.nodes.length;
				if ((!options.stored && visited > 2048) || node.nodes.some((part) => 'unclosed' in part && part.unclosed)) throw new Error('Invalid or oversized CSS');
				const parts = node.nodes.filter((part) => part.type !== 'space'), part = parts[0], raw = valueParser.stringify(node.nodes);
				const argument = parts.length === 1 && part?.type === 'string' ? part.value : isUnquotedCssUrl(raw) ? raw : null;
				if (argument !== null) candidates.push({ value: argument, replace: (value) => { node.nodes = [stringNode(node, value)]; } });
			} else stack.push({ nodes: node.nodes, entries: node.nodes.entries(), depth: frame.depth + 1, imageSet: name === 'image-set' || name === '-webkit-image-set' });
		}
		let changed = false;
		for (const candidate of candidates) {
			const decoded = cssUnescape(candidate.value);
			const mapped = mediaUrl(decoded);
			if (mapped === decoded) continue;
			candidate.replace(mapped);
			changed = true;
		}
		return changed ? parsed.toString() : value;
	} catch (error) { if (options.stored) throw error; return value; }
};

export const mapStyleMediaUrls = <T>(style: T, mediaUrl: MediaUrl): T => {
	let visited = 0;
	const walk = (value: unknown, depth: number): unknown => {
		if (++visited > 1600 || depth > 16) return value;
		if (typeof value === 'string') return mapCssMediaUrls(value, mediaUrl);
		if (!value || typeof value !== 'object') return value;
		if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, depth + 1)]));
	};
	return walk(style, 0) as T;
};

const CSS_MEDIA_PROPS = new Set(['background', 'backgroundImage', 'bg', 'bgImage', 'bgImg', 'borderImage', 'borderImageSource', 'mask', 'maskImage', 'WebkitMask', 'WebkitMaskImage', 'listStyle', 'listStyleImage', 'cursor', 'content', 'shapeOutside', 'filter', 'clipPath', 'fill', 'stroke']);
const STYLE_RECORD_PROPS = new Set(['style', 'css', 'sx']);

export const isRenderMediaStyleProp = (key: string): boolean =>
	CSS_MEDIA_PROPS.has(key) || STYLE_RECORD_PROPS.has(key) || key.startsWith('--');

// Chakra's responsive/pseudo-selector records are styles; title, data-* and
// other component metadata are not. HTML callers supply only their style prop.
export const mapRenderMediaProps = <T extends Record<string, unknown>>(props: T, mediaUrl: MediaUrl): T => {
	let visited = 0;
	const walk = (record: Record<string, unknown>, depth: number): Record<string, unknown> => {
		if (depth > 16 || ++visited > 1600) return record;
		return Object.fromEntries(Object.entries(record).map(([key, value]) => {
			if (isRenderMediaStyleProp(key)) return [key, mapStyleMediaUrls(value, mediaUrl)];
			if (key.startsWith('_') && value && typeof value === 'object' && !Array.isArray(value)) return [key, walk(value as Record<string, unknown>, depth + 1)];
			return [key, value];
		}));
	};
	return walk(props, 0) as T;
};
