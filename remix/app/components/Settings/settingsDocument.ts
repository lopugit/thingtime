import { sanitizeWebpageBlocks } from '~/schemas/registry';
import type { WebpageBlock } from '../Builder/webpageBlocks';

export const SETTINGS_BLOCK_TYPES: readonly WebpageBlock['type'][] = ['element', 'container', 'text', 'media', 'condition', 'collection'];

export type SettingsDocument = { blocks: WebpageBlock[]; name: string; revision: string | null; id?: string };
export type SettingsDocumentScope = { origin: string; ownerId: string; dataPlane: string; documentKey: string };
export interface SettingsDocumentAdapter {
  load(signal: AbortSignal): Promise<SettingsDocument | null>;
  save(document: SettingsDocument, signal: AbortSignal): Promise<SettingsDocument>;
}

export function settingsDocumentKey(scope: SettingsDocumentScope): string {
  const origin = new URL(scope.origin);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== scope.origin || !scope.ownerId ||
    !/^[a-z][a-z0-9-]*$/.test(scope.documentKey)) throw new Error('Invalid settings document scope.');
  return `tt-settings-document:${JSON.stringify([scope.origin, scope.ownerId, scope.dataPlane, scope.documentKey])}`;
}

/** Sensitive settings use the ordinary block format, but cannot mount another
 * executable source or native/component authority before event interception. */
export function settingsDocumentBlocks(value: unknown): WebpageBlock[] {
  const visit = (nodes: unknown) => {
    if (!Array.isArray(nodes)) throw new Error('Settings must contain a block document.');
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Invalid settings block.');
      const block = node as Record<string, unknown>;
      if (block.source !== undefined || !SETTINGS_BLOCK_TYPES.includes(block.type as WebpageBlock['type']))
        throw new Error('Settings documents cannot mount external components, native slots or Action sources.');
      const props = block.props as Record<string, unknown> | undefined;
      if ((typeof block.tag === 'string' && !/^[a-z][a-z0-9]*$/.test(block.tag)) ||
        (typeof block.html === 'string' && /<\s*tt-/i.test(block.html)) ||
        (props && ['source', 'itemTemplate', 'render', 'template'].some(key => props[key] !== undefined)))
        throw new Error('Use intrinsic blocks and public display bindings inside settings.');
      if (block.tag === 'input' && props && ['password', 'file'].includes(String(props.type)) &&
        ['value', 'defaultValue', 'default-value'].some(key => props[key] !== undefined))
        throw new Error('Private input values cannot be saved in a settings layout.');
      if (block.children !== undefined) visit(block.children);
      if (block.else !== undefined) visit(block.else);
      if (block.empty !== undefined) visit(block.empty);
    }
  };
  visit(value);
  const result = sanitizeWebpageBlocks(value);
  if (result.ok === false) throw new Error(result.error);
  return result.blocks as unknown as WebpageBlock[];
}

export function parseSettingsDocument(value: unknown): SettingsDocument {
  const input = value as Partial<SettingsDocument> | null;
  if (!input || typeof input !== 'object' || typeof input.name !== 'string' ||
    (input.revision !== null && typeof input.revision !== 'string') ||
    (input.id !== undefined && typeof input.id !== 'string')) throw new Error('The saved settings document is invalid.');
  return { name: input.name, blocks: settingsDocumentBlocks(input.blocks), revision: input.revision, ...(input.id ? { id: input.id } : {}) };
}

/** Local recovery uses the same authored document, never a captured form DOM.
 * Web Locks fence cross-tab compare-and-set; unsupported browsers can read but
 * must not silently perform a racy durable write. */
export function localSettingsDocumentAdapter(scope: SettingsDocumentScope, storage: Pick<Storage, 'getItem' | 'setItem'>,
  locks: Pick<LockManager, 'request'> | undefined, randomId: () => string = () => crypto.randomUUID()): SettingsDocumentAdapter {
  const key = settingsDocumentKey(scope);
  const read = () => { const raw = storage.getItem(key); return raw === null ? null : parseSettingsDocument(JSON.parse(raw)); };
  return {
    async load(signal) { signal.throwIfAborted(); return read(); },
    async save(document, signal) {
      if (!locks) throw new Error('This browser cannot safely save the offline layout.');
      return locks.request(key, { signal }, async () => {
        signal.throwIfAborted();
        const previous = read();
        if ((previous?.revision ?? null) !== document.revision) throw new Error('This layout changed in another window. Reload it before saving.');
        const next = parseSettingsDocument({ ...document, revision: randomId() });
        storage.setItem(key, JSON.stringify(next));
        return next;
      });
    }
  };
}
