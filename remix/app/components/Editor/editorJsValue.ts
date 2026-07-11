export type EditorJsBlock = {
	type: string;
	data: Record<string, unknown>;
	id?: string;
	tunes?: Record<string, unknown>;
};

export type EditorJsDoc = {
	blocks: EditorJsBlock[];
} & Record<string, unknown>;

export const EDITOR_JS_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type EditorJsHeadingLevel = (typeof EDITOR_JS_HEADING_LEVELS)[number];

// Chakra's reset deliberately makes native h1-h6 elements inherit their
// surrounding text size. Keep one explicit scale for Editor.js edit and view
// rendering so a saved header level is both semantic and visibly hierarchical.
export const EDITOR_JS_HEADING_FONT_SIZES: Record<EditorJsHeadingLevel, string> = {
	1: '1.875rem',
	2: '1.5rem',
	3: '1.25rem',
	4: '1.125rem',
	5: '1rem',
	6: '0.875rem'
};

export const normalizeEditorJsHeadingLevel = (value: unknown): EditorJsHeadingLevel => {
	const numericLevel =
		typeof value === 'number' ? value : typeof value === 'string' && value.trim().length > 0 ? Number(value) : Number.NaN;

	if (!Number.isFinite(numericLevel)) return 2;
	return Math.max(1, Math.min(6, Math.trunc(numericLevel))) as EditorJsHeadingLevel;
};

export const getEditorJsHeadingFontSize = (value: unknown): string =>
	EDITOR_JS_HEADING_FONT_SIZES[normalizeEditorJsHeadingLevel(value)];

export const EDITOR_JS_AUTO_DETECT_LIMITS = {
	sourceLength: 1_000_000,
	blocks: 500,
	values: 10_000,
	depth: 32,
	fieldLength: 100_000
} as const;

const referenceIds = new WeakMap<object, number>();
let nextReferenceId = 1;

const referenceSignature = (value: object): string => {
	let id = referenceIds.get(value);
	if (!id) {
		id = nextReferenceId;
		nextReferenceId += 1;
		referenceIds.set(value, id);
	}
	return `reference:${id}`;
};

const structuralSignature = (value: unknown, seen: Map<object, number>): string => {
	if (value === null) return 'null';

	switch (typeof value) {
		case 'string':
			return `string:${value.length}:${value}`;
		case 'boolean':
			return `boolean:${value}`;
		case 'number':
			if (Number.isNaN(value)) return 'number:NaN';
			if (Object.is(value, -0)) return 'number:-0';
			return `number:${value}`;
		case 'bigint':
			return `bigint:${value}`;
		case 'undefined':
			return 'undefined';
		case 'symbol':
			return `symbol:${String(value.description)}`;
		case 'function':
			return referenceSignature(value);
	}
	if (typeof value !== 'object' || value === null) return `${typeof value}:${String(value)}`;

	const existing = seen.get(value);
	if (existing) return `cycle:${existing}`;

	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return referenceSignature(value);

	const seenId = seen.size + 1;
	seen.set(value, seenId);

	if (Array.isArray(value)) return `array:[${value.map((item) => structuralSignature(item, seen)).join(',')}]`;

	return `object:{${Object.keys(value)
		.sort()
		.map((key) => `${key.length}:${key}=${structuralSignature(value[key], seen)}`)
		.join(',')}}`;
};

// LongTextEditor uses signatures only to distinguish a parent echo from an
// external replacement. Editor.js metadata is open-ended, so this must remain
// total for cyclic objects, BigInt values, throwing getters/toJSON methods,
// functions, and custom class instances.
export const getEditorJsValueSignature = (value: unknown): string => {
	try {
		return structuralSignature(value, new Map());
	} catch {
		return value && (typeof value === 'object' || typeof value === 'function') ? referenceSignature(value) : `${typeof value}:${String(value)}`;
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isEditorJsDocSafeToEdit = (value: EditorJsDoc): boolean => {
	if (value.blocks.length > EDITOR_JS_AUTO_DETECT_LIMITS.blocks) return false;
	const seen = new WeakSet<object>();
	const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
	let enqueuedValues = 1;
	let textLength = 0;

	try {
		while (stack.length) {
			const current = stack.pop()!;
			if (current.depth > EDITOR_JS_AUTO_DETECT_LIMITS.depth) return false;
			if (typeof current.value === 'string') {
				if (current.value.length > EDITOR_JS_AUTO_DETECT_LIMITS.fieldLength) return false;
				textLength += current.value.length;
				if (textLength > EDITOR_JS_AUTO_DETECT_LIMITS.sourceLength) return false;
			}
			if (!current.value || typeof current.value !== 'object') continue;
			if (seen.has(current.value)) continue;
			seen.add(current.value);

			const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
			enqueuedValues += children.length;
			if (enqueuedValues > EDITOR_JS_AUTO_DETECT_LIMITS.values) return false;
			for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
		}
		return true;
	} catch {
		return false;
	}
};

// Native Editor.js output is the persistent rich-text datatype. Keep this
// structural so documents with time/version/kind metadata remain compatible.
export const isEditorJsDoc = (value: unknown): value is EditorJsDoc => {
	if (!isRecord(value) || !Array.isArray(value.blocks)) return false;

	return value.blocks.every((block) => isRecord(block) && typeof block.type === 'string' && block.type.length > 0 && isRecord(block.data));
};

// Clipboard/API clients can leave Editor.js output JSON-encoded inside a
// string. Recognise only a complete native document — ordinary long or
// multi-line strings deliberately remain plain strings.
export const parseEditorJsDocString = (value: unknown): EditorJsDoc | null => {
	if (typeof value !== 'string') return null;
	if (value.length > EDITOR_JS_AUTO_DETECT_LIMITS.sourceLength) return null;

	const source = value.trim();
	if (!source.startsWith('{') || !source.endsWith('}') || !source.includes('"blocks"')) return null;

	try {
		const parsed = JSON.parse(source);
		if (!isRecord(parsed) || !Array.isArray(parsed.blocks) || parsed.blocks.length > EDITOR_JS_AUTO_DETECT_LIMITS.blocks) return null;
		return isEditorJsDoc(parsed) && isEditorJsDocSafeToEdit(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

export const getEditorJsDoc = (value: unknown): EditorJsDoc | null => {
	if (isEditorJsDoc(value)) return value;
	return parseEditorJsDocString(value);
};
