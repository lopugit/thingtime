import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import { XPATH_CONSTANTS } from './xpathPolicy';
import {
	array,
	awaited,
	base,
	call,
	declare,
	domCall,
	domConstant,
	domConstruct,
	domDocument,
	domGet,
	domSet,
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
const oneOf = (value: unknown, values: number[]) => method(array(...values), 'includes', [value]);
const showNode = (node: unknown) => awaited(call(v('describeNode'), [node]));
const describeNode: PlatformExpression = {
	op: 'function-declaration',
	name: 'describeNode',
	params: ['node'],
	async: true,
	body: [
		{ op: 'if', test: eq(v('node'), null), then: returns(null) },
		...returns(object({ name: domGet(v('node'), 'nodeName'), text: domGet(v('node'), 'textContent') }))
	]
};
const describeResult: PlatformExpression = {
	op: 'function-declaration',
	name: 'describeResult',
	params: ['result'],
	async: true,
	body: [
		declare('type', domGet(v('result'), 'resultType')),
		...(['numberValue', 'stringValue', 'booleanValue'] as const).map((key, i) => ({
			op: 'if',
			test: eq(v('type'), i + 1),
			then: returns(domGet(v('result'), key))
		})),
		{ op: 'if', test: oneOf(v('type'), [8, 9]), then: returns(showNode(domGet(v('result'), 'singleNodeValue'))) },
		declare('nodes', array()),
		{
			op: 'if',
			test: oneOf(v('type'), [6, 7]),
			then: [
				declare('length', domGet(v('result'), 'snapshotLength')),
				declare('i', 0),
				{
					op: 'while',
					test: { op: 'binary', operator: '<', left: v('i'), right: v('length') },
					body: [
						perform(method(v('nodes'), 'push', [showNode(domCall(v('result'), 'snapshotItem', [v('i')]))])),
						{ op: 'assign', name: 'i', value: { op: 'binary', operator: '+', left: v('i'), right: 1 } }
					]
				},
				...returns(object({ length: v('length'), nodes: v('nodes'), selected: showNode(domCall(v('result'), 'snapshotItem', [input('index')])) }))
			]
		},
		{
			op: 'try',
			body: [
				declare('node', domCall(v('result'), 'iterateNext')),
				{
					op: 'while',
					test: { op: 'binary', operator: '!==', left: v('node'), right: null },
					body: [
						perform(method(v('nodes'), 'push', [showNode(v('node'))])),
						{ op: 'assign', name: 'node', value: domCall(v('result'), 'iterateNext') }
					]
				},
				...returns(object({ nodes: v('nodes'), exhausted: eq(domCall(v('result'), 'iterateNext'), null) }))
			],
			error: 'error',
			catch: returns(object({ error: get(v('error'), 'name'), invalid: domGet(v('result'), 'invalidIteratorState') }))
		}
	]
};

export const XPATH_DOCUMENT: PlatformProgram['document'] = [
	{
		tag: 'section',
		attributes: { id: 'items' },
		children: [
			{ tag: 'h3', children: ['Query these saved objects'] },
			{
				tag: 'ul',
				children: [
					{ tag: 'li', attributes: { id: 'first', 'data-kind': 'fruit' }, children: ['Alpha'] },
					{ tag: 'li', attributes: { id: 'second', 'data-kind': 'veg' }, children: ['Beta'] },
					{ tag: 'li', attributes: { id: 'third', 'data-kind': 'fruit' }, children: ['Gamma'] }
				]
			}
		]
	}
];

/** Factories produce ordinary saved program data; no feature-specific renderer. */
export function xpathRecipe(f: Feature): Recipe | undefined {
	if (
		f.language !== 'webapi' ||
		!['XPathEvaluator', 'XPathEvaluatorBase', 'XPathExpression', 'XPathResult', 'XPathNSResolver'].includes(f.interface || f.name)
	)
		return;
	const member = f.member || '',
		resolver = f.interface === 'XPathNSResolver' || member === 'createNSResolver';
	const type =
		f.kind === 'const'
			? XPATH_CONSTANTS.indexOf(member)
			: new Map<string, number>([
					['numberValue', 1],
					['stringValue', 2],
					['booleanValue', 3],
					['iterateNext', 5],
					['invalidIteratorState', 5],
					['singleNodeValue', 9]
			  ]).get(member) ?? 7;
	if (type < 0) return;
	const expression = type === 1 ? 'count(.//li)' : type === 2 ? 'string(.//li[1])' : type === 3 ? 'boolean(.//li)' : './/li';
	const parameters = [
		parameter('expression', 'XPath expression', expression),
		parameter('context', 'Context element selector', '#items'),
		parameter('type', 'Native result type (0–9)', type, 'number'),
		parameter(
			'mode',
			'Evaluator (document, constructed, compiled)',
			f.interface === 'XPathExpression' || member === 'createExpression' ? 'compiled' : f.interface === 'XPathEvaluator' ? 'constructed' : 'document'
		),
		parameter('namespaces', 'Namespace prefix map (or null)', { x: 'http://www.w3.org/1999/xhtml' }, 'json'),
		parameter('prefix', 'Node namespace lookup prefix (or null)', 'xml', 'json'),
		parameter('index', 'Snapshot item index', 0, 'number'),
		parameter('mutate', 'Change the tree before reading the result', member === 'invalidIteratorState', 'boolean'),
		parameter('replacement', 'Replacement first item text', 'Edited Alpha')
	];
	const steps: PlatformExpression[] = [
		describeNode,
		describeResult,
		declare('document', domDocument()),
		declare('context', domCall(v('document'), 'querySelector', [input('context')])),
		declare('evaluator', v('document')),
		{ op: 'if', test: eq(input('mode'), 'constructed'), then: [{ op: 'assign', name: 'evaluator', value: domConstruct('XPathEvaluator') }] },
		declare('resolver', domCall(v('evaluator'), 'createNSResolver', [v('context')])),
		declare('namespace', domCall(v('resolver'), 'lookupNamespaceURI', [input('prefix')])),
		declare('result', null),
		{
			op: 'if',
			test: eq(input('mode'), 'compiled'),
			then: [
				declare('compiled', domCall(v('evaluator'), 'createExpression', [input('expression'), input('namespaces')])),
				{ op: 'assign', name: 'result', value: domCall(v('compiled'), 'evaluate', [v('context'), input('type'), null]) }
			],
			else: [
				{
					op: 'assign',
					name: 'result',
					value: domCall(v('evaluator'), 'evaluate', [input('expression'), v('context'), input('namespaces'), input('type'), null])
				}
			]
		},
		declare('beforeInvalid', domGet(v('result'), 'invalidIteratorState')),
		{
			op: 'if',
			test: input('mutate'),
			then: [perform(domSet(domCall(v('document'), 'querySelector', ['#first']), 'textContent', input('replacement')))]
		},
		...returns(
			object({
				feature: f.name,
				expression: input('expression'),
				type: domGet(v('result'), 'resultType'),
				...(f.kind === 'const' ? { constant: domConstant('XPathResult', member) } : {}),
				resolver: object({ sameNode: eq(v('resolver'), v('context')), prefix: input('prefix'), namespace: v('namespace') }),
				beforeInvalid: v('beforeInvalid'),
				afterInvalid: domGet(v('result'), 'invalidIteratorState'),
				value: awaited(call(v('describeResult'), [v('result')]))
			})
		)
	];
	return recipe(
		{
			...base(f),
			parameters,
			document: XPATH_DOCUMENT,
			styles: [
				{ selector: '#items', declarations: { padding: '20px', background: '#eff6ff', color: '#1e3a8a', 'border-radius': '12px' } },
				{ selector: 'li', declarations: { padding: '6px' } }
			],
			steps
		},
		'interactive',
		resolver
			? 'Reuse a native Node namespace resolver and verify its identity and nullable prefix lookup. Queries also accept an editable synchronous namespace map. Worker callbacks remain asynchronous.'
			: 'Edit the owned document, XPath query, context, namespace map and result type. Use a Document, constructed evaluator or compiled expression. Native values, iterators, snapshots and errors are preserved. Queries have explicit tree and work limits; nested predicates and traversal inside predicates are outside this runtime boundary.'
	);
}
