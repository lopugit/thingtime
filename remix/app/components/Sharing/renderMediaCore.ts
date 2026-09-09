import valueParser from 'postcss-value-parser';

type MediaUrl = (url: string) => string;

// Only literal, unkeyed first-party attachment references can delegate access.
export const literalAttachmentId = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value.startsWith('/api/v1/attachments/content?') || /[{}$]/.test(value)) return null;
	try {
		const parsed = new URL(value, 'https://local.invalid');
		const id = parsed.searchParams.get('id');
		return parsed.pathname === '/api/v1/attachments/content' && id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) && !parsed.searchParams.has('key') && !parsed.searchParams.has('sharedRoot') ? id : null;
	} catch { return null; }
};

// CSS escapes are decoded before checking origin/path, never by substring.
const cssUnescape = (value: string): string => value.replace(/\\([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\(\r\n|[\n\f\r])|\\(.)/gis, (_match, hex: string | undefined, newline: string | undefined, char: string | undefined) => {
	if (hex) {
		const code = Number.parseInt(hex, 16);
		return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
	}
	return newline ? '' : char || '';
});
const cssQuote = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);

// Parse CSS values, not arbitrary text. Quoted strings/comments and URLs on
// other origins cannot smuggle a nested url(...) into the sharing context.
// Collect first so malformed or over-budget values grant/transform nothing.
export const mapCssMediaUrls = (value: string, mediaUrl: MediaUrl): string => {
	if (value.length > 65536 || !value.includes('(')) return value;
	try {
		const parsed = valueParser(value);
		const candidates: Array<{ node: valueParser.StringNode | valueParser.WordNode; parent: valueParser.Node[]; index: number }> = [];
		let visited = 0;
		const walk = (nodes: valueParser.Node[], depth: number, imageSet = false): void => {
			if (depth > 32) throw new Error('CSS depth limit');
			for (const [index, node] of nodes.entries()) {
				if (++visited > 2048 || ('unclosed' in node && node.unclosed)) throw new Error('Invalid or oversized CSS');
				if (node.type === 'string' && imageSet) candidates.push({ node, parent: nodes, index });
				if (node.type !== 'function') continue;
				const name = cssUnescape(node.value).toLowerCase();
				if (name === 'url') {
					const parts = node.nodes.filter((part) => part.type !== 'space');
					const part = parts[0];
					if (parts.length === 1 && part && (part.type === 'word' || part.type === 'string') && !('unclosed' in part && part.unclosed)) {
						candidates.push({ node: part, parent: node.nodes, index: node.nodes.indexOf(part) });
					}
				} else walk(node.nodes, depth + 1, name === 'image-set' || name === '-webkit-image-set');
			}
		};
		walk(parsed.nodes, 0);
		let changed = false;
		for (const { node, parent, index } of candidates) {
			const decoded = cssUnescape(node.value);
			const mapped = mediaUrl(decoded);
			if (mapped === decoded) continue;
			parent[index] = { ...node, type: 'string', quote: '"', value: cssQuote(mapped) };
			changed = true;
		}
		return changed ? parsed.toString() : value;
	} catch { return value; }
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

// Chakra's responsive/pseudo-selector records are styles; title, data-* and
// other component metadata are not. HTML callers supply only their style prop.
export const mapRenderMediaProps = <T extends Record<string, unknown>>(props: T, mediaUrl: MediaUrl): T => {
	let visited = 0;
	const walk = (record: Record<string, unknown>, depth: number): Record<string, unknown> => {
		if (depth > 16 || ++visited > 1600) return record;
		return Object.fromEntries(Object.entries(record).map(([key, value]) => {
			if (CSS_MEDIA_PROPS.has(key) || STYLE_RECORD_PROPS.has(key) || key.startsWith('--')) return [key, mapStyleMediaUrls(value, mediaUrl)];
			if (key.startsWith('_') && value && typeof value === 'object' && !Array.isArray(value)) return [key, walk(value as Record<string, unknown>, depth + 1)];
			return [key, value];
		}));
	};
	return walk(props, 0) as T;
};
