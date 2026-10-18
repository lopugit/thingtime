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
  if (node.ttFormat) return [{ id: id('value'), type: 'element', tag: 'span', format: node.ttFormat }];
  if (!node.tag || Object.keys(node).some(key => key.startsWith('tt') && !['ttAction', 'ttActionInputs'].includes(key))) throw new Error('This template operator cannot yet be expanded into blocks.');
  const { itemTemplate, ...props } = node.props || {};
  if (node.ttAction) props['data-tt-action'] = node.ttAction;
  if (node.ttActionInputs !== undefined) props['data-tt-action-inputs'] = node.ttActionInputs;
  if (node.tag === 'tt-collection') return [{ id: id('collection'), type: 'collection', props, children: visit(itemTemplate) }];
  if (node.tag.startsWith('tt-')) throw new Error(`The ${node.tag} control cannot yet be expanded into blocks.`);
  const children = Array.isArray(node.children) ? node.children : node.children == null ? [] : [node.children];
  const textOnly = children.every((child: unknown) => typeof child === 'string' || typeof child === 'number');
  return [{ id: id(node.tag), type: 'element', tag: node.tag, props,
   ...(textOnly ? { text: children.join('') } : { children: children.flatMap(visit) }) }];
 };
 return visit(template);
}
