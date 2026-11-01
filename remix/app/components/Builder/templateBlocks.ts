import { parseTransientBinding, TRANSIENT_BLOCK_ACTION } from './transientBlockActions';
import { EACH_HARD_CAP, componentScopeValue, defaultsFromArgs, resolveTemplate, sanitizeArgSpecs } from '../ComponentsLibrary/componentTemplate';
import type { WebpageBlock } from './webpageBlocks';

/** Expand authored HTML templates, preserving bindings rather than a rendered snapshot.
 * Unsupported executable/template operators fail explicitly: never flatten away behaviour. */
export function templateToBlocks(template: unknown, id: (kind: string) => string): WebpageBlock[] {
 const visit = (node: any): WebpageBlock[] => {
  if (node == null) return [];
  if (Array.isArray(node)) return node.flatMap(visit);
  if (typeof node === 'string' || typeof node === 'number') return [{ id: id('text'), type: 'element', tag: 'span', text: String(node) }];
  if (typeof node !== 'object') throw new Error('Unsupported template value');
  if (node.ttTemplate) return visit(node.ttTemplate);
  if (node.ttIf) {
   const { then, else: otherwise, ...condition } = node.ttIf;
   return [{ id: id('condition'), type: 'condition', condition, children: visit(then) },
    ...(otherwise === undefined ? [] : [{ id: id('otherwise'), type: 'condition' as const, condition: { ...condition, negate: true }, children: visit(otherwise) }])];
  }
  if (node.ttEach) {
   const { arg, node: row, empty, max } = node.ttEach;
   if (typeof arg !== 'string' || row === undefined) throw new Error('This repeated template cannot be expanded into blocks.');
   if (empty !== undefined && typeof empty !== 'string') throw new Error('This repeated template has an empty branch that cannot yet be expanded into editable blocks.');
   return [{ id: id('collection'), type: 'collection', props: { itemsPath: arg, transparent: true, templateEach: true, ...(empty === undefined ? {} : { empty }), ...(max === undefined ? {} : { maxItems: max }) }, children: visit(row) }];
  }
  if (node.ttFormat) return [{ id: id('value'), type: 'element', tag: 'span', format: node.ttFormat }];
  if (!node.tag || Object.keys(node).some(key => key.startsWith('tt') && !['ttAction', 'ttActionInputs'].includes(key))) throw new Error('This template operator cannot yet be expanded into blocks.');
  const { itemTemplate, ...props } = node.props || {};
  if (node.ttAction) props['data-tt-action'] = node.ttAction;
  if (node.ttActionInputs !== undefined) props['data-tt-action-inputs'] = node.ttActionInputs;
  if (node.tag === 'tt-collection') return [{ id: id('collection'), type: 'collection', props, children: visit(itemTemplate) }];
  // These are existing guarded Builder primitives. Keep the intrinsic node as
  // an editable boundary and expand its authored children independently.
  if (node.tag.startsWith('tt-') && !['tt-media-pipeline', 'tt-mapbox', 'tt-form', 'tt-select', 'tt-style', 'tt-change'].includes(node.tag))
   throw new Error(`The ${node.tag} control cannot yet be expanded into blocks.`);
  const children = Array.isArray(node.children) ? node.children : node.children == null ? [] : [node.children];
  const textOnly = children.every((child: unknown) => typeof child === 'string' || typeof child === 'number');
  return [{ id: id(node.tag), type: 'element', tag: node.tag, props,
   ...(textOnly ? { text: children.join('') } : { children: children.flatMap(visit) }) }];
 };
 return visit(template);
}

/** The same ttEach list/object-entry conversion and author-hint cap as the
 * canonical template resolver; ordinary collections retain their own rules. */
export function templateEachRows(raw: unknown, maximum: unknown): unknown[] {
 const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && !Array.isArray(raw) && (Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null)
  ? Object.entries(raw).map(([key, value]) => ({ key, value })) : [];
 const requested = Math.trunc(Number(maximum) || 0);
 return list.slice(0, requested > 0 ? Math.min(requested, EACH_HARD_CAP) : EACH_HARD_CAP);
}

export function templateEachRowScope(scope: Record<string, unknown>, item: unknown, index: number, count: number): Record<string, unknown> {
 return { ...scope, item, index, n: index + 1, count, first: index === 0, last: index === count - 1, collection: { index, count } };
}

/** Build the JSON-only replacement for an expanded Component block. Timeline
 * draft events reject undefined values, even on optional metadata keys. */
export function expandedComponentBlock(entry: WebpageBlock, componentCrystal: Record<string, any> | undefined, children: WebpageBlock[]): WebpageBlock {
 const source = entry.source || componentCrystal?.source;
 const args = { ...defaultsFromArgs(sanitizeArgSpecs(componentCrystal?.args)), ...componentCrystal?.savedArgs, ...entry.args };
 return {
  id: entry.id, type: 'container', direction: 'column', gap: 0,
  ...(entry.css ? { css: entry.css } : {}),
  ...(source ? { source } : {}),
  args: Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) as WebpageBlock['args'],
  children
 };
}

/** DOM properties preserve scalar types for exact bindings; interpolated text stays text. */
export function resolveBlockProps(props: Record<string, unknown>, scope: Record<string, unknown>): Record<string, unknown> {
 const resolved = resolveTemplate(props, scope) as Record<string, unknown>;
 if (props['data-tt-action-refs']) {
  const node = resolveTemplate({ tag:'button', ttAction:props['data-tt-action'], ttActionRefs:props['data-tt-action-refs'] },scope) as any;
  resolved['data-tt-action'] = node?.props?.['data-tt-action'];
  delete resolved['data-tt-action-refs'];
 }
 for (const [key, value] of Object.entries(props)) {
  if (typeof value !== 'string' || (key === 'data-tt-action' && props['data-tt-action-refs'])) continue;
  const match = value.match(/^\{([^{}]+)\}$/);
  if (match) resolved[key] = componentScopeValue(scope, match[1]);
 }
 // Compatibility for saved intrinsic layouts authored before action inputs
 // became structured props. Parse only the closed transient scalar envelope;
 // other Action strings retain their normal binding semantics.
 if (props['data-tt-action'] === TRANSIENT_BLOCK_ACTION && typeof props['data-tt-action-inputs'] === 'string') {
  const legacy = parseTransientBinding(props['data-tt-action-inputs']);
  if (legacy) resolved['data-tt-action-inputs'] = resolveTemplate({ operation: legacy.operation, ...legacy.inputs }, scope);
 }
 return resolved;
}
