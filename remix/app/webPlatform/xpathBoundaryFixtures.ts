import type { PlatformExpression, PlatformProgram } from './types';
import { XPATH_DOCUMENT } from './xpathFixtures';
import {
	declare,
	domCall,
	domConstruct,
	domDocument,
	domGet,
	domSet,
	domSurface,
	get,
	object,
	perform,
	returns,
	variable as v
} from './programBuilders';
export const XPATH_BOUNDARIES: { name: string; program: PlatformProgram; expected?: unknown; error?: string }[] = [];
const eq = (left: unknown, right: unknown) => ({ op: 'binary', operator: '===', left, right });
const setup = () => [declare('doc', domDocument()), declare('root', domCall(v('doc'), 'querySelector', ['#items']))];
const evaluate = (expression: unknown, type: unknown = 7, resolver: unknown = null, result: unknown = null) =>
	domCall(v('doc'), 'evaluate', [expression, v('root'), resolver, type, result]);
const caught = (value: unknown): PlatformExpression => ({ op: 'try', body: returns(value), error: 'error', catch: returns(get(v('error'), 'name')) });
function check(name: string, steps: PlatformExpression[], expected?: unknown, error?: string) {
	XPATH_BOUNDARIES.push({ name: 'XPath ' + name, program: { version: 1, title: name, document: XPATH_DOCUMENT, steps }, expected, error });
}
check(
	'Node namespace resolver retains native identity',
	[
		...setup(),
		declare('resolver', domCall(v('doc'), 'createNSResolver', [v('root')])),
		...returns(
			object({
				same: eq(v('resolver'), v('root')),
				xml: domCall(v('resolver'), 'lookupNamespaceURI', ['xml']),
				default: domCall(v('resolver'), 'lookupNamespaceURI', [null]),
				missing: domCall(v('resolver'), 'lookupNamespaceURI', ['missing'])
			})
		)
	],
	{ same: true, xml: 'http://www.w3.org/XML/1998/namespace', default: 'http://www.w3.org/1999/xhtml', missing: null }
);
check(
	'data-backed synchronous namespace resolver',
	[...setup(), ...returns(domGet(evaluate('count(.//x:li)', 1, object({ x: 'http://www.w3.org/1999/xhtml' })), 'numberValue'))],
	3
);
check('native Node resolver passed to evaluation', [...setup(), ...returns(domGet(evaluate('count(.//li)', 1, v('root')), 'numberValue'))], 3);
check(
	'namespace keys do not inherit Object properties',
	[...setup(), ...returns(domGet(evaluate('count(.//constructor:li)', 1, object({ constructor: 'http://www.w3.org/1999/xhtml' })), 'numberValue'))],
	3
);
check(
	'snapshot holds nodes after removal',
	[
		...setup(),
		declare('result', evaluate('.//li')),
		declare('first', domCall(v('result'), 'snapshotItem', [0])),
		perform(domCall(v('first'), 'remove')),
		...returns(
			object({
				length: domGet(v('result'), 'snapshotLength'),
				text: domGet(domCall(v('result'), 'snapshotItem', [0]), 'textContent'),
				connected: domGet(v('first'), 'isConnected'),
				same: eq(v('first'), domCall(v('result'), 'snapshotItem', [0])),
				outside: domCall(v('result'), 'snapshotItem', [3])
			})
		)
	],
	{ length: 3, text: 'Alpha', connected: false, same: true, outside: null }
);
check(
	'iterator invalidates after native tree mutation',
	[
		...setup(),
		declare('result', evaluate('.//li', 5)),
		declare('before', domGet(v('result'), 'invalidIteratorState')),
		perform(domSet(domCall(v('doc'), 'querySelector', ['#first']), 'textContent', 'Changed')),
		{
			op: 'try',
			body: [perform(domCall(v('result'), 'iterateNext'))],
			error: 'error',
			catch: returns(object({ before: v('before'), after: domGet(v('result'), 'invalidIteratorState'), error: get(v('error'), 'name') }))
		}
	],
	{ before: false, after: true, error: 'InvalidStateError' }
);
check(
	'scalar wrong accessor preserves native error',
	[...setup(), declare('result', evaluate('count(.//li)', 1)), caught(domGet(v('result'), 'stringValue'))],
	'TypeError'
);
check(
	'wrong result operation preserves native error',
	[...setup(), declare('result', evaluate('count(.//li)', 1)), caught(domCall(v('result'), 'iterateNext'))],
	'TypeError'
);
check('invalid expression preserves native parser error', [...setup(), caught(evaluate('//*['))], 'SyntaxError');
check('unrecognized result type follows native Chromium ANY_TYPE fallback', [...setup(), ...returns(domGet(evaluate('.//li', 10), 'resultType'))], 4);
check('unresolved namespace preserves native error', [...setup(), caught(evaluate('.//missing:li'))], 'NamespaceError');
check('missing single node remains null', [...setup(), ...returns(domGet(evaluate('.//missing', 9), 'singleNodeValue'))], null);
check(
	'compiled expression re-evaluates with optional result',
	[
		...setup(),
		declare('compiled', domCall(v('doc'), 'createExpression', ['count(.//li)'])),
		declare('first', domCall(v('compiled'), 'evaluate', [v('root'), 1])),
		perform(domCall(domCall(v('doc'), 'querySelector', ['#first']), 'remove')),
		declare('next', domCall(v('compiled'), 'evaluate', [v('root'), 1, v('first')])),
		...returns(domGet(v('next'), 'numberValue'))
	],
	2
);
check(
	'optional arguments preserve ANY_TYPE',
	[
		...setup(),
		declare('result', domCall(v('doc'), 'evaluate', ['count(.//li)', v('root')])),
		...returns(object({ type: domGet(v('result'), 'resultType'), value: domGet(v('result'), 'numberValue') }))
	],
	{ type: 1, value: 3 }
);
check(
	'attribute results preserve owned node identity',
	[
		...setup(),
		declare('first', domCall(v('doc'), 'querySelector', ['#first'])),
		declare('attribute', domCall(v('first'), 'getAttributeNode', ['data-kind'])),
		declare('result', evaluate('.//li/@data-kind', 9)),
		...returns(
			object({ same: eq(v('attribute'), domGet(v('result'), 'singleNodeValue')), value: domGet(domGet(v('result'), 'singleNodeValue'), 'nodeValue') })
		)
	],
	{ same: true, value: 'fruit' }
);
check(
	'surface scalar queries cannot access enclosing runtime',
	[declare('surface', domSurface()), ...returns(domConstruct('XPathEvaluator'))],
	undefined,
	'owned detached document'
);
check('construction requires explicit document ownership', returns(domConstruct('XPathEvaluator')), undefined, 'owned detached document');
check(
	'fabricated contexts are rejected',
	[...setup(), ...returns(domCall(v('doc'), 'evaluate', ['count(ancestor::*)', object({ $dom: 'foreign:1', type: 'Element' })]))],
	undefined,
	'stale or belongs'
);
check(
	'wrong context receiver rejected before evaluation',
	[...setup(), declare('evaluator', domConstruct('XPathEvaluator')), ...returns(domCall(v('evaluator'), 'evaluate', ['1', v('evaluator')]))],
	undefined,
	'receiver type'
);
check('result reuse requires native owned XPathResult', [...setup(), ...returns(evaluate('1', 1, null, v('root')))], undefined, 'receiver type');
check(
	'async callbacks cannot impersonate synchronous resolvers',
	[...setup(), ...returns(evaluate('.//x:li', 7, object({ $callback: 1 })))],
	undefined,
	'namespace map'
);
check('nested predicate expansion is rejected', [...setup(), ...returns(evaluate('//*[li[li]]'))], undefined, 'Nested XPath predicates');
check('predicate traversal is rejected', [...setup(), ...returns(evaluate('//*[descendant::li]'))], undefined, 'predicate traversal');
check(
	'whole owned tree is counted before scalar evaluation',
	[...setup(), perform(domSet(v('root'), 'textContent', 'x'.repeat(1025))), ...returns(evaluate('1', 1))],
	undefined,
	'input tree budget'
);
check(
	'compiled evaluation shares the native work budget',
	[
		...setup(),
		declare('compiled', domCall(v('doc'), 'createExpression', ["count(.//li[@data-kind='veg'])"])),
		{ op: 'while', test: true, body: [perform(domCall(v('compiled'), 'evaluate', [v('root'), 1]))] }
	],
	undefined,
	'total work budget'
);
