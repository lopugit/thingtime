import type { Arg, Policy } from './domBridge';
export type TraversalArg = 'traversal-node' | 'traversal-mask' | 'traversal-filter';
const call = (args: Arg[] = [], min = args.length) => ({ args, min });
export const TRAVERSAL_CONSTANTS = [
	'FILTER_ACCEPT',
	'FILTER_REJECT',
	'FILTER_SKIP',
	'SHOW_ALL',
	'SHOW_ELEMENT',
	'SHOW_ATTRIBUTE',
	'SHOW_TEXT',
	'SHOW_CDATA_SECTION',
	'SHOW_ENTITY_REFERENCE',
	'SHOW_ENTITY',
	'SHOW_PROCESSING_INSTRUCTION',
	'SHOW_COMMENT',
	'SHOW_DOCUMENT',
	'SHOW_DOCUMENT_TYPE',
	'SHOW_DOCUMENT_FRAGMENT',
	'SHOW_NOTATION'
];
export const TRAVERSAL_CALLS = {
	createNodeIterator: call(['traversal-node', 'traversal-mask', 'traversal-filter'], 1),
	createTreeWalker: call(['traversal-node', 'traversal-mask', 'traversal-filter'], 1)
};
export const TRAVERSAL_RECEIVER_POLICY: Record<string, Policy> = {
	NodeFilter: { reads: TRAVERSAL_CONSTANTS.join(' ') },
	NodeIterator: {
		reads: 'root referenceNode pointerBeforeReferenceNode whatToShow filter',
		calls: { nextNode: call(), previousNode: call(), detach: call() }
	},
	TreeWalker: {
		reads: 'root currentNode whatToShow filter',
		writes: 'currentNode',
		writeArgs: { currentNode: 'traversal-node' },
		calls: Object.fromEntries(
			['parentNode', 'firstChild', 'lastChild', 'previousSibling', 'nextSibling', 'previousNode', 'nextNode'].map((k) => [k, call()])
		)
	}
};
