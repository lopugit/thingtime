import type { Feature } from './types';
const node = (id: string | null): unknown =>
	id === null
		? null
		: {
				name: (
					{ tree: 'SECTION', branch: 'DIV', first: 'SPAN', second: 'SPAN', third: 'P', Alpha: '#text', Beta: '#text', Gamma: '#text' } as Record<
						string,
						string
					>
				)[id],
				value: id
		  };
/** Independent native outcomes for the fixed authored tree. These pin node order
 * and pointer state rather than merely checking that an edited input is echoed. */
export function expectedTraversal(f: Feature, edited = false) {
	const member = f.member || '',
		walker = f.interface === 'TreeWalker' || member === 'createTreeWalker';
	const constants: Record<string, number> = {
		FILTER_ACCEPT: 1,
		FILTER_REJECT: 2,
		FILTER_SKIP: 3,
		SHOW_ALL: 4294967295,
		SHOW_ELEMENT: 1,
		SHOW_ATTRIBUTE: 2,
		SHOW_TEXT: 4,
		SHOW_CDATA_SECTION: 8,
		SHOW_ENTITY_REFERENCE: 16,
		SHOW_ENTITY: 32,
		SHOW_PROCESSING_INSTRUCTION: 64,
		SHOW_COMMENT: 128,
		SHOW_DOCUMENT: 256,
		SHOW_DOCUMENT_TYPE: 512,
		SHOW_DOCUMENT_FRAGMENT: 1024,
		SHOW_NOTATION: 2048
	};
	const mask = !edited && f.kind === 'const' && member.startsWith('SHOW_') ? constants[member] : 1;
	const iterator =
		mask === 1
			? edited
				? ['tree', 'branch', 'second', 'third']
				: member === 'FILTER_ACCEPT'
				? ['tree', 'branch', 'first', 'second', 'third']
				: ['tree', 'first', 'second', 'third']
			: mask === 4
			? ['Alpha', 'Beta', 'Gamma']
			: mask === 4294967295
			? ['tree', 'first', 'Alpha', 'second', 'Beta', 'third', 'Gamma']
			: [];
	const treeWalker =
		mask === 1
			? edited
				? ['branch', 'second', 'third']
				: member === 'FILTER_ACCEPT'
				? ['branch', 'first', 'second', 'third']
				: member === 'FILTER_REJECT'
				? ['third']
				: ['first', 'second', 'third']
			: mask === 4
			? ['Alpha', 'Beta', 'Gamma']
			: mask === 4294967295
			? ['first', 'Alpha', 'second', 'Beta', 'third', 'Gamma']
			: [];
	const before = { root: node('tree'), position: node('tree'), ...(!walker ? { pointer: true } : {}) };
	let position = walker
		? edited
			? 'second'
			: (
					{ currentNode: 'first', parentNode: 'first', nextSibling: 'first', previousSibling: 'third', previousNode: 'third' } as Record<
						string,
						string
					>
			  )[member] || 'tree'
		: 'tree';
	let pointer = true,
		value: unknown;
	if (f.kind === 'const') value = constants[member];
	else if (f.interface === 'NodeFilter') value = edited ? 1 : 3;
	else if (f.kind === 'attribute')
		value = ['root', 'referenceNode'].includes(member)
			? node('tree')
			: member === 'currentNode'
			? node(position)
			: member === 'filter'
			? true
			: member === 'whatToShow'
			? mask
			: true;
	else if (walker) {
		const result = (
			edited
				? { parentNode: 'branch', firstChild: null, lastChild: null, nextSibling: null, previousSibling: null, previousNode: 'branch' }
				: { parentNode: 'tree', firstChild: 'first', lastChild: 'third', nextSibling: 'second', previousSibling: 'second', previousNode: 'second' }
		) as Record<string, string | null>;
		const next = member in result ? result[member] : edited ? 'third' : 'first';
		value = node(next);
		if (next !== null) position = next;
	} else {
		position = member === 'previousNode' ? (edited ? 'branch' : 'first') : 'tree';
		pointer = member === 'previousNode';
		value = node(position);
	}
	return {
		feature: f.name,
		before,
		value,
		after: { position: node(position), ...(!walker ? { pointer } : {}) },
		mask,
		sameFilter: true,
		nodes: (walker ? treeWalker : iterator).map(node),
		comparisonNodes: (walker ? iterator : treeWalker).map(node)
	};
}
