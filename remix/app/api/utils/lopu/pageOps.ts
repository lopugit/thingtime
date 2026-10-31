// Lopu's builder patch-op grammar. ISOMORPHIC: the server applies ops to the
// client's live draft (and persists the result through the ordinary webpage
// write gate), and the client applies the SAME ops to the mounted draft the
// moment a `patch` event lands, so both sides converge on one block tree
// without ever exchanging the whole page. Only the pure tree operations from
// components/Builder/webpageBlocks.ts are used here — the server-side
// sanitizer (schemas/registry.ts sanitizeWebpageCrystal) stays the authority
// on shape and caps, and the executor re-validates every patched tree
// through it before anything is written.

import {
  collectBlockIds,
  countBlocks,
  findBlock,
  findParentId,
  insertBlock,
  MAX_BLOCKS,
  moveBlock,
  newBlockId,
  removeBlock,
  updateBlock,
  type WebpageBlock,
  type WebpageBlockType
} from '~/components/Builder/webpageBlocks';

export type PatchTarget = 'active' | { id: string };

export type PageOp =
  | { op: 'insert'; containerId: string | null; index: number | 'end'; block: WebpageBlock }
  | { op: 'update'; id: string; patch: Partial<WebpageBlock> }
  | { op: 'replace'; id: string; block: WebpageBlock }
  | { op: 'remove'; id: string }
  | { op: 'move'; id: string; containerId: string | null; index: number }
  | { op: 'setBlocks'; blocks: WebpageBlock[] };

export const PAGE_OP_NAMES = ['insert', 'update', 'replace', 'remove', 'move', 'setBlocks'] as const;
export const MAX_PAGE_OPS = 60;
export const MAX_PAGE_OP_DEPTH = 8;
// mirrors WEBPAGE_BLOCK_TYPES in schemas/registry.ts without pulling the
// whole registry into the client bundle; the type annotation keeps the two in
// lockstep (a new WebpageBlockType fails to compile here until listed)
export const PAGE_BLOCK_TYPES: readonly WebpageBlockType[] = ['component', 'container', 'text', 'native', 'media', 'html'];
// the server gate's id rule (COMPONENT_KEY_PATTERN + MAX_WEBPAGE_BLOCK_ID_CHARS)
export const PAGE_BLOCK_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_PAGE_BLOCK_ID_CHARS = 40;

export type PageOpsValidation = { ok: true; ops: PageOp[] } | { ok: false; error: string };
export type PatchTargetValidation = { ok: true; target: PatchTarget } | { ok: false; error: string };

export type ApplyPageOpsResult = {
  blocks: WebpageBlock[];
  applied: number;
  errors: string[];
  // the ops that were actually applied, after id normalisation — what the
  // server broadcasts so a client draft replays exactly the same changes
  ops: PageOp[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const isValidBlockId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_PAGE_BLOCK_ID_CHARS && PAGE_BLOCK_ID_PATTERN.test(value);

// Structural guard only (shape, ids, types, nesting). Field-level safety
// (css values, hrefs, media srcs, html) belongs to the server gate, which
// runs on the whole patched tree before any write.
const checkBlockShape = (value: unknown, depth: number, path: string): string | null => {
  if (!isPlainObject(value)) return `${path} must be a block object`;
  if (depth > MAX_PAGE_OP_DEPTH) return `${path} nests deeper than ${MAX_PAGE_OP_DEPTH} levels`;
  if (typeof value.id !== 'string' || !value.id.trim()) return `${path}.id must be a string`;
  if (typeof value.type !== 'string' || !(PAGE_BLOCK_TYPES as readonly string[]).includes(value.type)) {
    return `${path}.type must be one of ${PAGE_BLOCK_TYPES.join('/')}`;
  }
  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) return `${path}.children must be a list`;
    if (value.type !== 'container') return `${path} is a ${value.type} block — only containers hold children`;
    for (let index = 0; index < value.children.length; index++) {
      const issue = checkBlockShape(value.children[index], depth + 1, `${path}.children[${index}]`);
      if (issue) return issue;
    }
  }
  return null;
};

export const validateBlockShape = (value: unknown, path = 'block'): string | null => checkBlockShape(value, 1, path);

export const validatePatchTarget = (value: unknown): PatchTargetValidation => {
  if (value === undefined || value === null || value === 'active') return { ok: true, target: 'active' };
  if (isPlainObject(value) && typeof value.id === 'string') {
    const id = value.id.trim();
    if (id && id.length <= 128 && !/[$\s]/.test(id)) return { ok: true, target: { id } };
  }
  if (typeof value === 'string' && value.trim() && value.length <= 128 && !/[$\s]/.test(value)) {
    // a bare id is a common model shorthand — accept it
    return { ok: true, target: { id: value.trim() } };
  }
  return { ok: false, error: 'target must be "active" or { id: "<webpage id>" }' };
};

const idField = (value: unknown, path: string): string | null =>
  typeof value === 'string' && value.trim() ? null : `${path} must be a block id`;

const containerField = (value: unknown, path: string): string | null =>
  value === null || value === undefined || (typeof value === 'string' && value.trim()) ? null : `${path} must be a block id or null (the page root)`;

export const validatePageOps = (value: unknown): PageOpsValidation => {
  if (!Array.isArray(value)) return { ok: false, error: 'ops must be a list of patch operations' };
  if (!value.length) return { ok: false, error: 'ops is empty — nothing to change' };
  if (value.length > MAX_PAGE_OPS) return { ok: false, error: `ops can hold at most ${MAX_PAGE_OPS} operations per call` };
  const ops: PageOp[] = [];
  for (let index = 0; index < value.length; index++) {
    const raw = value[index];
    const path = `ops[${index}]`;
    if (!isPlainObject(raw)) return { ok: false, error: `${path} must be an object` };
    const op = raw.op;
    switch (op) {
      case 'insert': {
        const issue = containerField(raw.containerId, `${path}.containerId`) || checkBlockShape(raw.block, 1, `${path}.block`);
        if (issue) return { ok: false, error: issue };
        const indexValue = raw.index === undefined || raw.index === 'end' ? 'end' : Number(raw.index);
        if (indexValue !== 'end' && (!Number.isInteger(indexValue) || indexValue < 0)) {
          return { ok: false, error: `${path}.index must be a non-negative integer or "end"` };
        }
        ops.push({ op: 'insert', containerId: (raw.containerId as string | null | undefined) ?? null, index: indexValue, block: raw.block as unknown as WebpageBlock });
        break;
      }
      case 'update': {
        const issue = idField(raw.id, `${path}.id`);
        if (issue) return { ok: false, error: issue };
        if (!isPlainObject(raw.patch)) return { ok: false, error: `${path}.patch must be an object of block fields` };
        if (raw.patch.children !== undefined) {
          return { ok: false, error: `${path}.patch cannot rewrite children — use insert/remove/move/replace for structure` };
        }
        ops.push({ op: 'update', id: (raw.id as string).trim(), patch: raw.patch as Partial<WebpageBlock> });
        break;
      }
      case 'replace': {
        const issue = idField(raw.id, `${path}.id`) || checkBlockShape(raw.block, 1, `${path}.block`);
        if (issue) return { ok: false, error: issue };
        ops.push({ op: 'replace', id: (raw.id as string).trim(), block: raw.block as unknown as WebpageBlock });
        break;
      }
      case 'remove': {
        const issue = idField(raw.id, `${path}.id`);
        if (issue) return { ok: false, error: issue };
        ops.push({ op: 'remove', id: (raw.id as string).trim() });
        break;
      }
      case 'move': {
        const issue = idField(raw.id, `${path}.id`) || containerField(raw.containerId, `${path}.containerId`);
        if (issue) return { ok: false, error: issue };
        const indexValue = Number(raw.index);
        if (!Number.isInteger(indexValue) || indexValue < 0) return { ok: false, error: `${path}.index must be a non-negative integer` };
        ops.push({ op: 'move', id: (raw.id as string).trim(), containerId: (raw.containerId as string | null | undefined) ?? null, index: indexValue });
        break;
      }
      case 'setBlocks': {
        if (!Array.isArray(raw.blocks)) return { ok: false, error: `${path}.blocks must be a list of blocks` };
        for (let blockIndex = 0; blockIndex < raw.blocks.length; blockIndex++) {
          const issue = checkBlockShape(raw.blocks[blockIndex], 1, `${path}.blocks[${blockIndex}]`);
          if (issue) return { ok: false, error: issue };
        }
        ops.push({ op: 'setBlocks', blocks: raw.blocks as unknown as WebpageBlock[] });
        break;
      }
      default:
        return { ok: false, error: `${path}.op must be one of ${PAGE_OP_NAMES.join('/')}` };
    }
  }
  return { ok: true, ops };
};

// ---------------------------------------------------------------------------
// id normalisation — every block id on a page must be a unique lowercase
// dashed slug (the server gate refuses anything else). A model happily
// reuses "hero" twice or writes "Hero Title"; rather than bounce the whole
// patch we rewrite the offending ids with the builder's own newBlockId and
// broadcast the rewritten ops, so client and server still agree.

const prefixFor = (block: WebpageBlock): string => {
  const raw = typeof block.id === 'string' ? block.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') : '';
  const trimmed = raw.slice(0, 24).replace(/-+$/, '');
  return trimmed || block.type;
};

const normaliseSubtree = (block: WebpageBlock, existing: Set<string>, keepRootId: string | null): WebpageBlock => {
  let id = keepRootId ?? block.id;
  if (keepRootId === null && (!isValidBlockId(id) || existing.has(id))) id = newBlockId(prefixFor(block), existing);
  existing.add(id);
  const next: WebpageBlock = { ...block, id };
  if (Array.isArray(block.children)) next.children = block.children.map((child) => normaliseSubtree(child, existing, null));
  return next;
};

const subtreeIds = (block: WebpageBlock | null): Set<string> => (block ? collectBlockIds([block]) : new Set());

const siblingsOf = (blocks: WebpageBlock[], containerId: string | null): WebpageBlock[] | null => {
  if (containerId === null) return blocks;
  const container = findBlock(blocks, containerId);
  if (!container) return null;
  return Array.isArray(container.children) ? container.children : [];
};

// Apply ops in order against a block tree. Every op is validated against
// the CURRENT tree (a container inserted by op 1 is a valid target for op 2),
// a failing op is skipped and reported, and the returned `ops` list carries
// exactly the ops that were applied — with normalised ids — so the same list
// replays cleanly on a client draft. Never throws.
export const applyPageOps = (blocks: WebpageBlock[], ops: PageOp[]): ApplyPageOpsResult => {
  let current = Array.isArray(blocks) ? blocks : [];
  const applied: PageOp[] = [];
  const errors: string[] = [];

  ops.forEach((op, index) => {
    const label = `${op.op} #${index + 1}`;
    switch (op.op) {
      case 'insert': {
        if (op.containerId !== null) {
          const container = findBlock(current, op.containerId);
          if (!container) {
            errors.push(`${label}: container "${op.containerId}" is not on the page`);
            return;
          }
          if (container.type !== 'container') {
            errors.push(`${label}: "${op.containerId}" is a ${container.type} block — only containers hold children`);
            return;
          }
          if (!Array.isArray(container.children)) current = updateBlock(current, container.id, { children: [] });
        }
        if (countBlocks(current) + countBlocks([op.block]) > MAX_BLOCKS) {
          errors.push(`${label}: the page would exceed ${MAX_BLOCKS} blocks`);
          return;
        }
        const block = normaliseSubtree(op.block, collectBlockIds(current), null);
        const siblings = siblingsOf(current, op.containerId) || [];
        const at = op.index === 'end' ? siblings.length : Math.max(0, Math.min(op.index, siblings.length));
        current = insertBlock(current, op.containerId, at, block);
        applied.push({ op: 'insert', containerId: op.containerId, index: at, block });
        return;
      }
      case 'update': {
        if (!findBlock(current, op.id)) {
          errors.push(`${label}: block "${op.id}" is not on the page`);
          return;
        }
        const { id: _id, type: _type, children: _children, ...patch } = op.patch as Record<string, unknown>;
        current = updateBlock(current, op.id, patch as Partial<WebpageBlock>);
        applied.push({ op: 'update', id: op.id, patch: patch as Partial<WebpageBlock> });
        return;
      }
      case 'replace': {
        const target = findBlock(current, op.id);
        if (!target) {
          errors.push(`${label}: block "${op.id}" is not on the page`);
          return;
        }
        const parentId = findParentId(current, op.id) ?? null;
        const siblings = siblingsOf(current, parentId) || [];
        const at = Math.max(0, siblings.findIndex((sibling) => sibling.id === op.id));
        const without = removeBlock(current, op.id);
        if (countBlocks(without) + countBlocks([op.block]) > MAX_BLOCKS) {
          errors.push(`${label}: the page would exceed ${MAX_BLOCKS} blocks`);
          return;
        }
        const existing = collectBlockIds(without);
        const block = normaliseSubtree({ ...op.block, id: op.id }, existing, op.id);
        current = insertBlock(without, parentId, at, block);
        applied.push({ op: 'replace', id: op.id, block });
        return;
      }
      case 'remove': {
        if (!findBlock(current, op.id)) {
          errors.push(`${label}: block "${op.id}" is not on the page`);
          return;
        }
        current = removeBlock(current, op.id);
        applied.push({ op: 'remove', id: op.id });
        return;
      }
      case 'move': {
        const moving = findBlock(current, op.id);
        if (!moving) {
          errors.push(`${label}: block "${op.id}" is not on the page`);
          return;
        }
        if (op.containerId !== null) {
          const container = findBlock(current, op.containerId);
          if (!container) {
            errors.push(`${label}: container "${op.containerId}" is not on the page`);
            return;
          }
          if (container.type !== 'container') {
            errors.push(`${label}: "${op.containerId}" is a ${container.type} block — only containers hold children`);
            return;
          }
          if (container.id === op.id || subtreeIds(moving).has(container.id)) {
            errors.push(`${label}: cannot move "${op.id}" into its own subtree`);
            return;
          }
          if (!Array.isArray(container.children)) current = updateBlock(current, container.id, { children: [] });
        }
        const next = moveBlock(current, op.id, op.containerId, op.index);
        if (next === current) {
          errors.push(`${label}: move refused`);
          return;
        }
        current = next;
        applied.push({ op: 'move', id: op.id, containerId: op.containerId, index: op.index });
        return;
      }
      case 'setBlocks': {
        if (countBlocks(op.blocks) > MAX_BLOCKS) {
          errors.push(`${label}: the page would exceed ${MAX_BLOCKS} blocks`);
          return;
        }
        const existing = new Set<string>();
        const next = op.blocks.map((block) => normaliseSubtree(block, existing, null));
        current = next;
        applied.push({ op: 'setBlocks', blocks: next });
        return;
      }
      default:
        errors.push(`op #${index + 1}: unknown operation`);
    }
  });

  return { blocks: current, applied: applied.length, errors, ops: applied };
};

// Compact tree listing for prompts and tool results: one line per block,
// indented by depth, carrying just enough (id, type, component/text/style)
// for a model to target blocks by id without reading the whole tree.
export const summarizeBlocks = (blocks: WebpageBlock[], maxLines = MAX_BLOCKS): string => {
  const lines: string[] = [];
  const walk = (list: WebpageBlock[], depth: number) => {
    for (const block of list) {
      if (lines.length >= maxLines) return;
      const bits: string[] = [`${block.id} (${block.type}`];
      if (block.type === 'container') bits.push(`/${block.direction || 'column'}${block.direction === 'grid' && block.columns ? `×${block.columns}` : ''}`);
      if (block.type === 'text' && block.style && block.style !== 'body') bits.push(`/${block.style}`);
      bits.push(')');
      let line = `${'  '.repeat(depth)}- ${bits.join('')}`;
      if (block.type === 'component' && block.component) line += ` component=${block.component}`;
      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        const text = block.text.replace(/\s+/g, ' ').trim();
        line += ` "${text.length > 48 ? `${text.slice(0, 45)}…` : text}"`;
      }
      if (block.type === 'native' && block.native) line += ` native=${block.native}`;
      if (block.type === 'media' && block.media) line += ` media=${block.media}`;
      lines.push(line);
      if (Array.isArray(block.children) && block.children.length) walk(block.children, depth + 1);
    }
  };
  walk(Array.isArray(blocks) ? blocks : [], 0);
  const total = countBlocks(Array.isArray(blocks) ? blocks : []);
  if (total > lines.length) lines.push(`… ${total - lines.length} more block(s)`);
  return lines.length ? lines.join('\n') : '(empty page — no blocks yet)';
};
