import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	array,
	awaited,
	base,
	call,
	declare,
	domCall,
	domConstant,
	domDocument,
	domGet,
	domSet,
	domSyncCallback,
	get,
	input,
	method,
	object,
	parameter,
	perform,
	recipe,
	returns,
	variable as v
} from './programBuilders';
const eq = (left: unknown, right: unknown) => ({ op: 'binary', operator: '===', left, right });
const syncGet = (target: unknown, key: string) => ({ op: 'dom', action: 'get', target, key });
const syncCall = (target: unknown, key: string, args: unknown[] = []) => ({ op: 'dom', action: 'call', target, key, args });
export const TRAVERSAL_FILTER = {
	op: 'function',
	params: ['node'],
	body: [
		{
			op: 'if',
			test: { op: 'binary', operator: '&&', left: eq(syncGet(v('node'), 'nodeType'), 1), right: syncCall(v('node'), 'matches', [input('selector')]) },
			then: returns(input('decision'))
		},
		...returns(1)
	]
};
/** A separately editable program: select spans by node name, without using the
 * template's selector or decision bindings. Used to verify changes to logic. */
export const TRAVERSAL_SPAN_FILTER = {
	op: 'function',
	params: ['node'],
	value: { op: 'conditional', test: eq(syncGet(v('node'), 'nodeName'), 'SPAN'), then: 1, else: 3 }
};
export const TRAVERSAL_DOCUMENT: PlatformProgram['document'] = [
	{
		tag: 'section',
		attributes: { id: 'tree' },
		children: [
			{
				tag: 'div',
				attributes: { id: 'branch' },
				children: [
					{ tag: 'span', attributes: { id: 'first' }, children: ['Alpha'] },
					{ tag: 'span', attributes: { id: 'second' }, children: ['Beta'] }
				]
			},
			{ tag: 'p', attributes: { id: 'third' }, children: ['Gamma'] }
		]
	}
];
const describeNode: PlatformExpression = {
	op: 'function-declaration',
	name: 'describeNode',
	params: ['node'],
	async: true,
	body: [
		{ op: 'if', test: eq(v('node'), null), then: returns(null) },
		...returns(
			object({
				name: domGet(v('node'), 'nodeName'),
				value: { op: 'conditional', test: eq(domGet(v('node'), 'nodeType'), 1), then: domGet(v('node'), 'id'), else: domGet(v('node'), 'nodeValue') }
			})
		)
	]
};
const show = (node: unknown) => awaited(call(v('describeNode'), [node]));
const collect: PlatformExpression = {
	op: 'function-declaration',
	name: 'collect',
	params: ['traverser'],
	async: true,
	body: [
		declare('nodes', array()),
		declare('node', domCall(v('traverser'), 'nextNode')),
		{
			op: 'while',
			test: { op: 'binary', operator: '!==', left: v('node'), right: null },
			body: [perform(method(v('nodes'), 'push', [show(v('node'))])), { op: 'assign', name: 'node', value: domCall(v('traverser'), 'nextNode') }]
		},
		...returns(v('nodes'))
	]
};
const constantValues: Record<string, number> = {
	FILTER_ACCEPT: 1,
	FILTER_REJECT: 2,
	FILTER_SKIP: 3,
	SHOW_ALL: 0xffffffff,
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
export function traversalRecipe(f: Feature): Recipe | undefined {
	const documentFactory = f.interface === 'Document' && ['createTreeWalker', 'createNodeIterator'].includes(f.member || '');
	if (f.language !== 'webapi' || (!['TreeWalker', 'NodeIterator', 'NodeFilter'].includes(f.interface || f.name) && !documentFactory)) return;
	const member = f.member || '',
		walker = f.interface === 'TreeWalker' || member === 'createTreeWalker',
		constant = f.kind === 'const';
	const factory = walker ? 'createTreeWalker' : 'createNodeIterator';
	const mask = constant && member.startsWith('SHOW_') ? constantValues[member] : 1;
	const decision = constant && member.startsWith('FILTER_') ? constantValues[member] : 3;
	const starting =
		(
			{ parentNode: '#first', nextSibling: '#first', previousSibling: '#third', previousNode: '#third', currentNode: '#first' } as Record<
				string,
				string
			>
		)[member] || '#tree';
	const setup = [
		describeNode,
		collect,
		declare('document', domDocument()),
		declare('root', domCall(v('document'), 'querySelector', [input('root')])),
		declare('filter', {
			op: 'conditional',
			test: input('filterEnabled'),
			then: domSyncCallback('acceptNode', input('filter'), object({ selector: input('selector'), decision: input('decision') })),
			else: null
		}),
		declare('traverser', domCall(v('document'), factory, [v('root'), input('mask'), v('filter')])),
		declare(
			'before',
			object({
				root: show(domGet(v('traverser'), 'root')),
				position: show(domGet(v('traverser'), walker ? 'currentNode' : 'referenceNode')),
				...(!walker ? { pointer: domGet(v('traverser'), 'pointerBeforeReferenceNode') } : {})
			})
		)
	];
	const probe: PlatformExpression[] = [];
	if (walker) probe.push(perform(domSet(v('traverser'), 'currentNode', domCall(v('document'), 'querySelector', [input('start')]))));
	if (!walker && member === 'previousNode') probe.push(perform(domCall(v('traverser'), 'nextNode')), perform(domCall(v('traverser'), 'nextNode')));
	if (member === 'detach') probe.push(perform(domCall(v('traverser'), 'detach')));
	let value: unknown;
	if (constant) value = domConstant('NodeFilter', member);
	else if (f.interface === 'NodeFilter') value = domCall(v('filter'), 'acceptNode', [domCall(v('document'), 'querySelector', ['#branch'])]);
	else if (f.kind === 'attribute') {
		const read = domGet(v('traverser'), member);
		value = member === 'filter' ? eq(read, v('filter')) : ['root', 'currentNode', 'referenceNode'].includes(member) ? show(read) : read;
	} else
		value = show(
			domCall(
				v('traverser'),
				['nextNode', 'previousNode', 'parentNode', 'firstChild', 'lastChild', 'nextSibling', 'previousSibling'].includes(member) ? member : 'nextNode'
			)
		);
	probe.push(declare('value', value));
	const program: PlatformProgram = {
		...base(f),
		document: TRAVERSAL_DOCUMENT,
		styles: [
			{ selector: '#tree', declarations: { padding: '20px', background: '#f0f7ff', color: '#24365c' } },
			{ selector: '#branch', declarations: { padding: '12px', border: '1px solid #9bb3d0' } },
			{ selector: 'span', declarations: { display: 'block' } }
		],
		parameters: [
			parameter('root', 'Root selector', '#tree'),
			parameter('start', 'TreeWalker starting selector', starting),
			parameter('mask', 'whatToShow bitmask', mask, 'number'),
			parameter('selector', 'Filter match selector', '#branch'),
			parameter('decision', 'Matching nodes: accept 1, reject 2, skip 3', decision, 'number'),
			parameter('filterEnabled', 'Use the saved callback', true, 'boolean'),
			parameter('filter', 'Editable synchronous filter program', TRAVERSAL_FILTER, 'json')
		],
		steps: [
			...setup,
			...probe,
			declare(
				'after',
				object({
					position: show(domGet(v('traverser'), walker ? 'currentNode' : 'referenceNode')),
					...(!walker ? { pointer: domGet(v('traverser'), 'pointerBeforeReferenceNode') } : {})
				})
			),
			declare('all', domCall(v('document'), factory, [v('root'), input('mask'), v('filter')])),
			declare('other', domCall(v('document'), walker ? 'createNodeIterator' : 'createTreeWalker', [v('root'), input('mask'), v('filter')])),
			...returns(
				object({
					feature: f.name,
					before: v('before'),
					value: v('value'),
					after: v('after'),
					mask: domGet(v('all'), 'whatToShow'),
					sameFilter: eq(domGet(v('all'), 'filter'), v('filter')),
					nodes: awaited(call(v('collect'), [v('all')])),
					comparisonNodes: awaited(call(v('collect'), [v('other')]))
				})
			)
		]
	};
	return recipe(
		program,
		'interactive',
		'Edit the tree, traversal mask and synchronous filter program. Native skip/reject, direction, pointer and identity behavior is preserved. Callback data uses bounded local expressions, statements and registered DOM calls; asynchronous functions and global access are unavailable. Legacy node-type masks can return no nodes in this HTML document.'
	);
}
export function editTraversalProgram(program: PlatformProgram): PlatformProgram {
	const edited = structuredClone(program);
	for (const p of edited.parameters || []) {
		if (p.name === 'selector') p.default = '#first';
		if (p.name === 'decision') p.default = 2;
		if (p.name === 'start') p.default = '#second';
		if (p.name === 'mask' && Number(p.default) !== 1) p.default = 1;
	}
	return edited;
}
