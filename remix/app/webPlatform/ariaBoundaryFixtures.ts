import type { PlatformExpression, PlatformProgram } from './types';
import {
	array,
	declare,
	domCall,
	domDocument,
	domGet,
	domSet,
	domSurface,
	get,
	global,
	method,
	object,
	perform,
	returns,
	variable as v
} from './programBuilders';
export const ARIA_BOUNDARIES: { name: string; program: PlatformProgram; expected?: unknown; error?: string }[] = [];
const eq = (left: unknown, right: unknown) => ({ op: 'binary', operator: '===', left, right });
const setup = (surface = true) => [
	declare('root', surface ? domSurface() : domDocument()),
	declare('sample', domCall(v('root'), 'querySelector', ['#sample'])),
	declare('first', domCall(v('root'), 'querySelector', ['#first']))
];
const references = () => domGet(v('sample'), 'ariaDescribedByElements');
function check(name: string, steps: PlatformExpression[], expected?: unknown, error?: string) {
	ARIA_BOUNDARIES.push({
		name,
		expected,
		error,
		program: {
			version: 1,
			title: name,
			document: [
				{ tag: 'div', attributes: { id: 'sample' }, children: ['Sample'] },
				{ tag: 'p', attributes: { id: 'first' }, children: ['Reference'] },
				{ tag: 'div', attributes: { id: 'host' } }
			],
			steps
		}
	});
}
check(
	'ARIA null removes string reflection',
	[
		...setup(),
		perform(domSet(v('sample'), 'ariaLabel', 'Saved label')),
		perform(domSet(v('sample'), 'ariaLabel', null)),
		...returns(object({ property: domGet(v('sample'), 'ariaLabel'), attribute: domCall(v('sample'), 'getAttribute', ['aria-label']) }))
	],
	{ property: null, attribute: null }
);
check(
	'ARIA false text remains distinct from null',
	[
		...setup(),
		perform(domSet(v('sample'), 'ariaHidden', 'false')),
		...returns(object({ property: domGet(v('sample'), 'ariaHidden'), attribute: domCall(v('sample'), 'getAttribute', ['aria-hidden']) }))
	],
	{ property: 'false', attribute: 'false' }
);
check(
	'ARIA reference identity and frozen cached lists survive transport',
	[
		...setup(),
		perform(domSet(v('sample'), 'ariaDescribedByElements', array(v('first')))),
		declare('a', references()),
		declare('b', references()),
		...returns(
			object({
				element: eq(get(v('a'), 0), v('first')),
				same: eq(v('a'), v('b')),
				frozen: method(global('Object'), 'isFrozen', [v('a')]),
				attribute: domCall(v('sample'), 'getAttribute', ['aria-describedby'])
			})
		)
	],
	{ element: true, same: true, frozen: true, attribute: '' }
);
check(
	'ARIA null clears element lists',
	[
		...setup(),
		perform(domSet(v('sample'), 'ariaDescribedByElements', array(v('first')))),
		perform(domSet(v('sample'), 'ariaDescribedByElements', null)),
		...returns(object({ property: references(), attribute: domCall(v('sample'), 'getAttribute', ['aria-describedby']) }))
	],
	{ property: null, attribute: null }
);
check(
	'ARIA empty list differs from a missing relationship',
	[
		...setup(),
		perform(domSet(v('sample'), 'ariaDescribedByElements', array())),
		...returns(object({ length: get(references(), 'length'), attribute: domCall(v('sample'), 'getAttribute', ['aria-describedby']) }))
	],
	{ length: 0, attribute: '' }
);
check(
	'ARIA content attributes reset explicit element relationships',
	[
		...setup(),
		perform(domSet(v('sample'), 'ariaDescribedByElements', array(v('first')))),
		declare('old', references()),
		perform(domCall(v('sample'), 'setAttribute', ['aria-describedby', 'missing'])),
		...returns(object({ oldLength: get(v('old'), 'length'), currentLength: get(references(), 'length'), unchanged: eq(v('old'), references()) }))
	],
	{ oldLength: 1, currentLength: 0, unchanged: false }
);
check(
	'ARIA native frozen lists reject authored mutation',
	[
		...setup(),
		perform(domSet(v('sample'), 'ariaDescribedByElements', array(v('first')))),
		{ op: 'try', body: [perform(method(references(), 'push', [v('first')]))], error: 'error', catch: returns(get(v('error'), 'name')) }
	],
	'TypeError'
);
check(
	'ARIA single element identity and null',
	[
		...setup(),
		perform(domSet(v('sample'), 'ariaActiveDescendantElement', v('first'))),
		declare('same', eq(domGet(v('sample'), 'ariaActiveDescendantElement'), v('first'))),
		perform(domSet(v('sample'), 'ariaActiveDescendantElement', null)),
		...returns(object({ same: v('same'), cleared: domGet(v('sample'), 'ariaActiveDescendantElement') }))
	],
	{ same: true, cleared: null }
);
check(
	'ARIA shadow descendant can refer to an owned ancestor-tree element',
	[
		...setup(),
		declare('host', domCall(v('root'), 'querySelector', ['#host'])),
		declare('shadow', domCall(v('host'), 'attachShadow', [object({ mode: 'open' })])),
		perform(domCall(v('shadow'), 'replaceChildren', [v('sample')])),
		perform(domSet(v('sample'), 'ariaDescribedByElements', array(v('first')))),
		...returns(eq(get(references(), 0), v('first')))
	],
	true
);
check(
	'ARIA wrong receiver types are rejected',
	[...setup(), ...returns(domSet(v('sample'), 'ariaDescribedByElements', array(domGet(v('first'), 'firstChild'))))],
	undefined,
	'receiver type'
);
check(
	'ARIA fabricated references are rejected',
	[...setup(), ...returns(domSet(v('sample'), 'ariaActiveDescendantElement', object({ $dom: 'foreign:1', type: 'Element' })))],
	undefined,
	'stale or belongs'
);
check(
	'ARIA element reference allocation is bounded',
	[
		...setup(),
		...returns(
			domSet(
				v('sample'),
				'ariaDescribedByElements',
				method(array(), 'concat', [method(method(global('Array'), 'from', [object({ length: 65 })]), 'fill', [v('first')])])
			)
		)
	],
	undefined,
	'at most 64'
);
check(
	'ARIA detached references cannot silently lose their visible relationship',
	[...setup(false), ...returns(domSet(v('sample'), 'ariaDescribedByElements', array(v('first'))))],
	undefined,
	'owned surface'
);
check(
	'ARIA reflection does not allow resource attributes',
	[...setup(), ...returns(domCall(v('sample'), 'setAttribute', ['src', 'https://example.com/']))],
	undefined,
	'Surface tree mutation'
);
check(
	'ARIA mutation cannot obtain the runtime parent',
	[...setup(), ...returns(domGet(v('root'), 'parentElement'))],
	undefined,
	'outside this program surface'
);
