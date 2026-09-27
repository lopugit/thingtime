import type { PlatformExpression, PlatformProgram } from './types';
import { TRAVERSAL_DOCUMENT, TRAVERSAL_FILTER, TRAVERSAL_SPAN_FILTER } from './traversalFixtures';
import {
	array,
	declare,
	domCall,
	domDocument,
	domGet,
	domSet,
	domSurface,
	domSyncCallback,
	domCallback,
	fn,
	get,
	input,
	literal,
	object,
	perform,
	returns,
	variable as v
} from './programBuilders';
type Fixture = { name: string; program: PlatformProgram; expected?: unknown; error?: string };
const eq = (left: unknown, right: unknown) => ({ op: 'binary', operator: '===', left, right });
const raw = (action: string, target: unknown, key: string, args: unknown[] = []) => ({ op: 'dom', action, target, key, args });
const setup = [declare('document', domDocument()), declare('root', domCall(v('document'), 'querySelector', ['#tree']))];
const at = (id: string) => domCall(v('document'), 'querySelector', ['#' + id]);
const id = (node: unknown) => domGet(node, 'id');
const filter = (definition: unknown = TRAVERSAL_FILTER, bindings: unknown = object({ selector: '#branch', decision: 3 }), key = 'acceptNode') =>
	declare('filter', domSyncCallback(key, literal(definition), bindings));
const iterator = (filterValue: unknown = null, mask: unknown = 1) =>
	declare('iterator', domCall(v('document'), 'createNodeIterator', [v('root'), mask, filterValue]));
const walker = (filterValue: unknown = null) => declare('walker', domCall(v('document'), 'createTreeWalker', [v('root'), 1, filterValue]));
const fixture = (name: string, steps: PlatformExpression[], expected?: unknown, error?: string): Fixture => ({
	name,
	program: { version: 1, title: name, document: TRAVERSAL_DOCUMENT, steps },
	expected,
	error
});
const caught = (body: PlatformExpression[]) => ({ op: 'try', body, error: 'error', catch: returns(get(v('error'), 'name')) });
const reentrant = {
	op: 'function',
	params: ['node'],
	body: [{ op: 'if', test: input('reenter'), then: [perform(raw('call', input('iterator'), 'nextNode'))] }, ...returns(1)]
};
export const TRAVERSAL_BOUNDARIES: Fixture[] = [
	fixture(
		'Changing the saved callback logic changes native selection',
		[
			...setup,
			filter(TRAVERSAL_SPAN_FILTER),
			walker(v('filter')),
			...returns(array(id(domCall(v('walker'), 'nextNode')), id(domCall(v('walker'), 'nextNode')), domCall(v('walker'), 'nextNode')))
		],
		['first', 'second', null]
	),
	fixture(
		'Iterator reverses the pointer before advancing again',
		[
			...setup,
			iterator(),
			declare('first', domCall(v('iterator'), 'nextNode')),
			declare('back', domCall(v('iterator'), 'previousNode')),
			declare('before', domGet(v('iterator'), 'pointerBeforeReferenceNode')),
			declare('again', domCall(v('iterator'), 'nextNode')),
			...returns(array(eq(v('first'), v('back')), v('before'), eq(v('first'), v('again')), domGet(v('iterator'), 'pointerBeforeReferenceNode')))
		],
		[true, true, true, false]
	),
	...[false, true].map((before) =>
		fixture(
			'Iterator removal adjusts ' + (before ? 'before' : 'after') + ' pointer',
			[
				...setup,
				iterator(),
				perform(domCall(v('iterator'), 'nextNode')),
				perform(domCall(v('iterator'), 'nextNode')),
				perform(domCall(v('iterator'), 'nextNode')),
				...(before ? [perform(domCall(v('iterator'), 'previousNode'))] : []),
				perform(domCall(at('first'), 'remove')),
				declare('position', id(domGet(v('iterator'), 'referenceNode'))),
				declare('pointer', domGet(v('iterator'), 'pointerBeforeReferenceNode')),
				...returns(array(v('position'), v('pointer'), id(domCall(v('iterator'), 'nextNode'))))
			],
			before ? ['second', true, 'second'] : ['branch', false, 'second']
		)
	),
	fixture(
		'TreeWalker currentNode can leave the original root in the owned document',
		[
			...setup,
			declare('walker', domCall(v('document'), 'createTreeWalker', [at('branch'), 1, null])),
			perform(domSet(v('walker'), 'currentNode', at('third'))),
			...returns(array(id(domGet(v('walker'), 'root')), id(domCall(v('walker'), 'parentNode'))))
		],
		['branch', 'tree']
	),
	fixture(
		'Traversal zero mask suppresses callback invocation',
		[
			...setup,
			filter({ op: 'function', params: ['node'], body: [{ op: 'throw', value: 'must not run' }] }),
			iterator(v('filter'), 0),
			...returns(domCall(v('iterator'), 'nextNode'))
		],
		null
	),
	fixture(
		'Traversal null filter and negative mask use native WebIDL conversion',
		[
			...setup,
			iterator(null, -1),
			...returns(array(domGet(v('iterator'), 'whatToShow'), domGet(v('iterator'), 'filter'), eq(domCall(v('iterator'), 'nextNode'), v('root'))))
		],
		[4294967295, null, true]
	),
	fixture(
		'Synchronous callback returning 65537 converts to FILTER_ACCEPT',
		[
			...setup,
			filter({ op: 'function', params: ['node'], value: 65537 }),
			iterator(v('filter')),
			...returns(eq(domCall(v('iterator'), 'nextNode'), v('root')))
		],
		true
	),
	fixture(
		'Traversal filter identity and callback this are preserved',
		[
			...setup,
			filter(
				{ op: 'function-expression', params: ['node'], value: { op: 'conditional', test: eq({ op: 'this' }, input('self')), then: 1, else: 2 } },
				object({})
			),
			perform(domSet(v('filter'), 'bindings', object({ self: v('filter') }))),
			iterator(v('filter')),
			...returns(array(eq(domGet(v('iterator'), 'filter'), v('filter')), eq(domCall(v('iterator'), 'nextNode'), v('root'))))
		],
		[true, true]
	),
	fixture(
		'Callable filter objects preserve native callback conversion',
		[
			...setup,
			filter({ op: 'function', params: ['node'], value: 1 }, object({}), 'function'),
			iterator(v('filter')),
			...returns(array(eq(domGet(v('iterator'), 'filter'), v('filter')), eq(domCall(v('iterator'), 'nextNode'), v('root'))))
		],
		[true, true]
	),
	...['function', 'function-expression'].map((op) =>
		fixture(
			'Callable filter preserves undefined this for ' + op,
			[
				...setup,
				filter(
					{ op, params: ['node'], value: { op: 'conditional', test: eq({ op: 'this' }, { op: 'undefined' }), then: 1, else: 2 } },
					object({}),
					'function'
				),
				iterator(v('filter')),
				...returns(eq(domCall(v('iterator'), 'nextNode'), v('root')))
			],
			true
		)
	),
	fixture(
		'Arrow filter retains lexical undefined this on an object receiver',
		[
			...setup,
			filter({ op: 'function', params: ['node'], value: { op: 'conditional', test: eq({ op: 'this' }, { op: 'undefined' }), then: 1, else: 2 } }),
			iterator(v('filter')),
			...returns(eq(domCall(v('iterator'), 'nextNode'), v('root')))
		],
		true
	),
	fixture(
		'Native iterator adjusts its position when the callback removes the previous reference',
		[
			...setup,
			filter(
				{
					op: 'function',
					params: ['node'],
					body: [{ op: 'if', test: eq(raw('get', v('node'), 'id'), 'first'), then: [perform(raw('call', input('branch'), 'remove'))] }, ...returns(1)]
				},
				object({ branch: at('branch') })
			),
			iterator(v('filter')),
			perform(domCall(v('iterator'), 'nextNode')),
			perform(domCall(v('iterator'), 'nextNode')),
			...returns(array(id(domCall(v('iterator'), 'nextNode')), id(domGet(v('iterator'), 'referenceNode')), id(domCall(v('iterator'), 'nextNode'))))
		],
		// Filtering captures the returned node before removal adjusts the live
		// candidate reference to the parent; the next traversal resumes there.
		['first', 'tree', 'third']
	),
	fixture(
		'Native reentrant filter throws InvalidStateError and resets its active flag',
		[
			...setup,
			filter(reentrant, object({})),
			iterator(v('filter')),
			perform(domSet(v('filter'), 'bindings', object({ iterator: v('iterator'), reenter: true }))),
			declare('failure', ''),
			{
				op: 'try',
				body: [perform(domCall(v('iterator'), 'nextNode'))],
				error: 'error',
				catch: [{ op: 'assign', name: 'failure', value: get(v('error'), 'name') }]
			},
			perform(domSet(v('filter'), 'bindings', object({ iterator: v('iterator'), reenter: false }))),
			...returns(array(v('failure'), id(domCall(v('iterator'), 'nextNode'))))
		],
		['InvalidStateError', 'tree']
	),
	...['text', null, false, 0, ''].map((value) =>
		fixture(
			'Callback thrown data survives ' + JSON.stringify(value),
			[
				...setup,
				filter({ op: 'function', params: ['node'], body: [{ op: 'throw', value }] }),
				iterator(v('filter')),
				{ op: 'try', body: returns(domCall(v('iterator'), 'nextNode')), error: 'caught', catch: returns(v('caught')) }
			],
			value
		)
	),
	fixture(
		'Shared synchronous callback resolves XPath namespaces',
		[
			...setup,
			filter(
				{
					op: 'function',
					params: ['prefix'],
					value: { op: 'conditional', test: eq(v('prefix'), 'x'), then: 'http://www.w3.org/1999/xhtml', else: null }
				},
				object({}),
				'lookupNamespaceURI'
			),
			declare('result', domCall(v('document'), 'evaluate', ['count(.//x:span)', v('root'), v('filter'), 1, null])),
			...returns(domGet(v('result'), 'numberValue'))
		],
		2
	),
	fixture(
		'Synchronous filters reject asynchronous worker tokens',
		[...setup, iterator(domCallback(fn(['node'], 1))), ...returns(true)],
		undefined,
		'Invalid DOM handle'
	),
	fixture(
		'Synchronous filters reject foreign handles',
		[...setup, iterator(object({ $dom: 'another-run:1', type: 'AuthoredCallback' })), ...returns(true)],
		undefined,
		'another run'
	),
	fixture(
		'Synchronous callbacks reject unbounded globals',
		[...setup, filter({ op: 'function', params: ['node'], value: { op: 'global', name: 'window' } }), ...returns(true)],
		undefined,
		'Unsupported synchronous callback operation'
	),
	fixture(
		'Synchronous callbacks reject asynchronous definitions',
		[...setup, filter({ op: 'function', async: true, params: ['node'], value: 1 }), ...returns(true)],
		undefined,
		'synchronous data function'
	),
	fixture(
		'Synchronous callback loops terminate at their budget',
		[
			...setup,
			filter({ op: 'function', params: ['node'], body: [{ op: 'while', test: true, body: [] }] }),
			iterator(v('filter')),
			...returns(domCall(v('iterator'), 'nextNode'))
		],
		undefined,
		'execution budget'
	),
	fixture(
		'Synchronous callbacks cannot expose prototype constructors',
		[
			...setup,
			filter({ op: 'function', params: ['node'], value: get(v('node'), 'constructor') }),
			iterator(v('filter')),
			...returns(domCall(v('iterator'), 'nextNode'))
		],
		undefined,
		'prototype access'
	),
	fixture(
		'TreeWalker rejects a wrong currentNode receiver',
		[...setup, walker(), perform(domSet(v('walker'), 'currentNode', v('walker'))), ...returns(true)],
		undefined,
		'receiver type'
	),
	fixture(
		'Traversal cannot switch an active surface to the detached document',
		[declare('root', domSurface()), declare('document', domDocument()), ...returns(true)],
		undefined,
		'Choose one DOM document context'
	),
	fixture(
		'Traversal prototype members remain inaccessible',
		[...setup, walker(), ...returns(domGet(v('walker'), 'constructor'))],
		undefined,
		'not registered'
	),
	fixture('Traversal oversized masks are refused', [...setup, iterator(null, 4294967296), ...returns(true)], undefined, 'traversal mask'),
	fixture(
		'Callback native errors are catchable in the data function',
		[
			...setup,
			filter({ op: 'function', params: ['node'], body: [caught(returns(raw('call', v('node'), 'matches', ['['])))] }),
			...returns(domCall(v('filter'), 'acceptNode', [v('root')]))
		],
		'SyntaxError'
	)
];
TRAVERSAL_BOUNDARIES.push({
	...fixture(
		'Traversal checks the whole owned tree before native filtering',
		[...setup, iterator(), ...returns(domCall(v('iterator'), 'nextNode'))],
		undefined,
		'Traversal tree budget'
	),
	program: {
		version: 1,
		title: 'Traversal checks the whole owned tree before native filtering',
		document: [{ tag: 'section', attributes: { id: 'tree' }, children: Array.from({ length: 129 }, () => ({ tag: 'span', children: ['x'] })) }],
		steps: [...setup, iterator(), ...returns(domCall(v('iterator'), 'nextNode'))]
	}
});
