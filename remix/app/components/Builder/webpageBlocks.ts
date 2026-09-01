// Client-side types + PURE tree operations for the block-based site builder.
// The server-side write gate (sanitizeWebpageCrystal in schemas/registry.ts)
// is the authority on shape and caps — everything here mirrors it for
// optimistic editing and must stay within those bounds (120 blocks, depth 8,
// 48KB serialized). Blocks never carry markup: component blocks reference
// component things resolved through /api/v1/webpages/resolve and drawn by the
// sanitising allowlist renderers, one budget per block.

export type WebpageBlockType = 'component' | 'container' | 'text' | 'native' | 'media' | 'html';
export type WebpageContainerDirection = 'column' | 'row' | 'grid';
export type WebpageTextStyle = 'body' | 'heading' | 'eyebrow';
export type WebpageBlockAlign = 'start' | 'center' | 'end' | 'stretch';
export type WebpageMediaKind = 'image' | 'video' | 'audio';

export interface WebpageBlock {
	id: string;
	type: WebpageBlockType;
	align?: WebpageBlockAlign;
	maxWidth?: number;
	// Figma-style custom CSS: kebab-case property → value, applied to the
	// block's box (mirrors the server gate's css sanitizer)
	css?: Record<string, string>;
	// component
	component?: string;
	args?: Record<string, string | number | boolean>;
	// container
	direction?: WebpageContainerDirection;
	gap?: number;
	columns?: number;
	children?: WebpageBlock[];
	// text
	text?: string;
	style?: WebpageTextStyle;
	// text: rendered element override (h1…h6/p/span/…) + rich WYSIWYG HTML
	// (render-side sanitised through the allowlist renderer — never trusted raw)
	tag?: string;
	html?: string;
	// media
	src?: string;
	alt?: string;
	media?: WebpageMediaKind;
	// native
	native?: string;
}

export interface WebpageCrystal {
	name: string;
	description?: string;
	pageKey?: string;
	siteRoute?: string;
	version?: number;
	forkOf?: string;
	previewBg?: string;
	blocks: WebpageBlock[];
}

export const MAX_BLOCKS = 120;
export const MAX_BLOCK_DEPTH = 8;

// A tree address: the block id path from the root list to the block.
export type BlockPath = string[];

let idCounter = 0;
export const newBlockId = (prefix: string, existing: Set<string>): string => {
	// deterministic-enough ids: prefix + counter, skipping taken ids
	for (;;) {
		idCounter += 1;
		const id = `${prefix}-${idCounter.toString(36)}`;
		if (!existing.has(id)) return id;
	}
};

export const collectBlockIds = (blocks: WebpageBlock[], into: Set<string> = new Set()): Set<string> => {
	for (const block of blocks) {
		into.add(block.id);
		if (block.children) collectBlockIds(block.children, into);
	}
	return into;
};

export const countBlocks = (blocks: WebpageBlock[]): number =>
	blocks.reduce((sum, block) => sum + 1 + (block.children ? countBlocks(block.children) : 0), 0);

export const findBlock = (blocks: WebpageBlock[], id: string): WebpageBlock | null => {
	for (const block of blocks) {
		if (block.id === id) return block;
		if (block.children) {
			const hit = findBlock(block.children, id);
			if (hit) return hit;
		}
	}
	return null;
};

// Parent list containing `id`, or null when id is not in the tree. Root list
// is represented by parentId null.
export const findParentId = (blocks: WebpageBlock[], id: string, parentId: string | null = null): string | null | undefined => {
	for (const block of blocks) {
		if (block.id === id) return parentId;
		if (block.children) {
			const hit = findParentId(block.children, id, block.id);
			if (hit !== undefined) return hit;
		}
	}
	return undefined;
};

const mapTree = (blocks: WebpageBlock[], fn: (list: WebpageBlock[], parentId: string | null) => WebpageBlock[]): WebpageBlock[] => {
	const walk = (list: WebpageBlock[], parentId: string | null): WebpageBlock[] =>
		fn(list, parentId).map((block) =>
			block.children ? { ...block, children: walk(block.children, block.id) } : block
		);
	return walk(blocks, null);
};

// Insert `block` into the list identified by containerId (null = root) at
// `index`. Returns a NEW tree (structural sharing elsewhere).
export const insertBlock = (
	blocks: WebpageBlock[],
	containerId: string | null,
	index: number,
	block: WebpageBlock
): WebpageBlock[] =>
	mapTree(blocks, (list, parentId) => {
		if (parentId !== containerId) return list;
		const next = [...list];
		next.splice(Math.max(0, Math.min(index, next.length)), 0, block);
		return next;
	});

export const removeBlock = (blocks: WebpageBlock[], id: string): WebpageBlock[] =>
	mapTree(blocks, (list) => list.filter((block) => block.id !== id));

export const updateBlock = (blocks: WebpageBlock[], id: string, patch: Partial<WebpageBlock>): WebpageBlock[] =>
	mapTree(blocks, (list) => list.map((block) => (block.id === id ? { ...block, ...patch, id: block.id, type: block.type } : block)));

// Move a block to (containerId, index). Refuses moves into the block's own
// subtree (would orphan it). Index is interpreted against the RENDERED list
// (the one still containing the moving block) — that is what every drop
// caller computes from seam positions — so a same-container downward move
// compensates for the removal happening first.
export const moveBlock = (
	blocks: WebpageBlock[],
	id: string,
	containerId: string | null,
	index: number
): WebpageBlock[] => {
	const moving = findBlock(blocks, id);
	if (!moving) return blocks;
	if (containerId) {
		if (containerId === id) return blocks;
		if (moving.children && findBlock(moving.children, containerId)) return blocks;
		const target = findBlock(blocks, containerId);
		if (!target || target.type !== 'container') return blocks;
	}
	const sourceParent = findParentId(blocks, id, null);
	let insertIndex = index;
	if (sourceParent !== undefined && sourceParent === containerId) {
		const siblings = sourceParent === null ? blocks : findBlock(blocks, sourceParent)?.children || [];
		const sourceIndex = siblings.findIndex((block) => block.id === id);
		if (sourceIndex !== -1 && sourceIndex < index) insertIndex = index - 1;
	}
	const without = removeBlock(blocks, id);
	return insertBlock(without, containerId, insertIndex, moving);
};

// Wrap a block IN PLACE inside a new container (Figma's "wrap in frame"):
// the wrapper takes the block's slot, the block becomes its only child.
// Only containers can hold children in the block model, so the wrapper is
// always a container of the given direction. Depth beyond the server cap is
// rejected at save — the gate stays the authority.
const subtreeDepth = (block: WebpageBlock): number =>
	1 + (block.children?.length ? Math.max(...block.children.map(subtreeDepth)) : 0);

const depthOf = (blocks: WebpageBlock[], id: string, depth = 1): number | null => {
	for (const block of blocks) {
		if (block.id === id) return depth;
		if (block.children) {
			const hit = depthOf(block.children, id, depth + 1);
			if (hit !== null) return hit;
		}
	}
	return null;
};

export const wrapBlock = (
	blocks: WebpageBlock[],
	id: string,
	direction: WebpageContainerDirection
): WebpageBlock[] => {
	const target = findBlock(blocks, id);
	if (!target) return blocks;
	// the wrapper adds one level — refuse when that would breach the server's
	// depth cap (callers surface the refusal; the gate stays the authority)
	const depth = depthOf(blocks, id) ?? 1;
	if (depth + subtreeDepth(target) > MAX_BLOCK_DEPTH) return blocks;
	const wrapper: WebpageBlock = {
		id: newBlockId('box', collectBlockIds(blocks)),
		type: 'container',
		direction,
		gap: 4,
		...(direction === 'grid' ? { columns: 2 } : {}),
		children: [target]
	};
	const walk = (list: WebpageBlock[]): WebpageBlock[] =>
		list.map((block) => {
			if (block.id === id) return wrapper;
			return block.children ? { ...block, children: walk(block.children) } : block;
		});
	return walk(blocks);
};

// Deep-clone a block with fresh ids and insert the copy right after the
// original.
export const duplicateBlock = (blocks: WebpageBlock[], id: string): WebpageBlock[] => {
	const target = findBlock(blocks, id);
	if (!target) return blocks;
	if (countBlocks(blocks) + countBlocks([target]) > MAX_BLOCKS) return blocks;
	const existing = collectBlockIds(blocks);
	const clone = (block: WebpageBlock): WebpageBlock => {
		// keep clone ids well under the server's 40-char id cap
		const prefix = (block.id.replace(/-[a-z0-9]+$/, '') || block.type).slice(0, 24);
		const next: WebpageBlock = { ...block, id: newBlockId(prefix, existing) };
		existing.add(next.id);
		if (block.children) next.children = block.children.map(clone);
		return next;
	};
	const copy = clone(target);
	const parentId = findParentId(blocks, id);
	const siblings = parentId === null ? blocks : findBlock(blocks, parentId as string)?.children || [];
	const index = siblings.findIndex((sibling) => sibling.id === id);
	return insertBlock(blocks, (parentId as string | null) ?? null, index + 1, copy);
};

// Move a block one step up/down within its parent list — the deterministic
// (keyboard/inspector) twin of drag/drop.
export const moveBlockRelative = (blocks: WebpageBlock[], id: string, delta: -1 | 1): WebpageBlock[] => {
	const parentId = findParentId(blocks, id);
	if (parentId === undefined) return blocks;
	const siblings = parentId === null ? blocks : findBlock(blocks, parentId)?.children || [];
	const index = siblings.findIndex((block) => block.id === id);
	const nextIndex = index + delta;
	if (index === -1 || nextIndex < 0 || nextIndex >= siblings.length) return blocks;
	// moveBlock speaks rendered-seam indices: to END UP at nextIndex when
	// stepping down, aim at the seam BELOW the sibling being passed
	return moveBlock(blocks, id, parentId, delta > 0 ? nextIndex + 1 : nextIndex);
};

export const defaultTextBlock = (existing: Set<string>): WebpageBlock => ({
	id: newBlockId('text', existing),
	type: 'text',
	text: 'Write something lovely ✨',
	style: 'body'
});

export const defaultContainerBlock = (existing: Set<string>, direction: WebpageContainerDirection = 'column'): WebpageBlock => ({
	id: newBlockId('box', existing),
	type: 'container',
	direction,
	gap: 4,
	...(direction === 'grid' ? { columns: 2 } : {}),
	children: []
});

export const componentBlockFor = (componentRef: string, existing: Set<string>): WebpageBlock => ({
	id: newBlockId('block', existing),
	type: 'component',
	component: componentRef
});

export const defaultMediaBlock = (existing: Set<string>, src = '', media: WebpageMediaKind = 'image'): WebpageBlock => ({
	id: newBlockId('media', existing),
	type: 'media',
	media,
	src
});

export const defaultHtmlBlock = (existing: Set<string>): WebpageBlock => ({
	id: newBlockId('html', existing),
	type: 'html',
	html: '<div style="padding: 16px; border: 1px dashed #ececef; border-radius: 12px;">\n  <strong>Custom HTML</strong> — edit me in the inspector 🛠️\n</div>'
});

// Human label for the boundary chip / tree rows.
export const blockLabel = (block: WebpageBlock): string => {
	if (block.type === 'component') return block.component || 'component';
	if (block.type === 'container') return `${block.direction || 'column'}${block.type === 'container' && block.direction === 'grid' && block.columns ? ` ×${block.columns}` : ''}`;
	if (block.type === 'text') return block.style === 'heading' ? 'heading' : block.style === 'eyebrow' ? 'eyebrow' : 'text';
	if (block.type === 'media') return block.media || 'media';
	if (block.type === 'html') return 'html';
	return `native · ${block.native || '?'}`;
};
