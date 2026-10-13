import type { PlatformProgram, PlatformExpression } from './types';
import {
	declare,
	perform,
	domSurface,
	domCall,
	domGet,
	domSet,
	domConstruct,
	domStatic,
	variable as v,
	returns,
	object,
	array
} from './programBuilders';
export const TYPED_CSS_BOUNDARIES: { name: string; program: PlatformProgram; expected?: unknown; error?: string }[] = [];
function check(name: string, steps: PlatformExpression[], expected?: unknown, error?: string) {
	TYPED_CSS_BOUNDARIES.push({
		name,
		program: { version: 1, title: name, document: [{ tag: 'div', attributes: { id: 'sample' }, children: ['CSS value'] }], steps },
		expected,
		error
	});
}
const unit = (n: unknown, u = 'px') => domConstruct('CSSUnitValue', [n, u]);
const surface = [
	declare('surface', domSurface()),
	declare('sample', domCall(v('surface'), 'querySelector', ['#sample'])),
	declare('map', domGet(v('sample'), 'attributeStyleMap'))
];
check(
	'CSS factory reads native amount',
	[declare('value', domStatic('CSS', 'px', [24])), ...returns(object({ amount: domGet(v('value'), 'value'), unit: domGet(v('value'), 'unit') }))],
	{ amount: 24, unit: 'px' }
);
check('CSS converts actual absolute units', [declare('value', domCall(unit(1, 'in'), 'to', ['px'])), ...returns(domGet(v('value'), 'value'))], 96);
check(
	'CSS map applies native typed width',
	[
		...surface,
		perform(domCall(v('map'), 'set', ['width', unit(120)])),
		...returns(domCall(domCall(domCall(v('sample'), 'computedStyleMap'), 'get', ['width']), 'toString'))
	],
	'120px'
);
check('CSS numeric type retains dimensions', [...returns(domCall(unit(12, 'deg'), 'type'))], { angle: 1 });
check(
	'CSS constructed sheet maps stay reusable',
	[
		declare('sheet', domConstruct('CSSStyleSheet')),
		perform(domCall(v('sheet'), 'insertRule', ['.demo {width: 12px}', 0])),
		declare('rule', domCall(domGet(v('sheet'), 'cssRules'), 'item', [0])),
		declare('map', domGet(v('rule'), 'styleMap')),
		perform(domCall(v('map'), 'set', ['width', unit(48)])),
		...returns(domCall(domCall(v('map'), 'get', ['width']), 'toString'))
	],
	'48px'
);
check(
	'CSS refuses a foreign numeric handle',
	[...returns(domConstruct('CSSMathSum', [object({ $dom: 'not-this-run', type: 'CSSUnitValue' })]))],
	undefined,
	'stale or belongs'
);
check(
	'CSS refuses an arbitrary static namespace',
	[...returns(domStatic('globalThis', 'fetch', ['https://example.com']))],
	undefined,
	'Unregistered CSS native operation'
);
check('CSS refuses prototype static lookup', [...returns(domStatic('__proto__', 'toString'))], undefined, 'Unregistered CSS native operation');
check(
	'CSS refuses unregistered namespace operation',
	[...returns(domStatic('CSS', 'registerProperty', [object({ name: '--demo' })]))],
	undefined,
	'Unregistered CSS native operation'
);
check('CSS refuses coerced number', [...returns(unit('24'))], undefined, 'bounded finite CSS number');
check('CSS refuses oversized text', [...returns(domStatic('CSSNumericValue', 'parse', [' '.repeat(2049)]))], undefined, 'bounded CSS text');
check(
	'CSS refuses oversized transform list',
	[...returns(domConstruct('CSSTransformValue', [array(...Array(33).fill(null))]))],
	undefined,
	'CSS list budget'
);
check('CSS refuses oversized matrix', [...returns(domConstruct('DOMMatrix', [array(...Array(17).fill(0))]))], undefined, 'six or sixteen');
check(
	'CSS refuses extra matrix options',
	[
		declare('matrix', domConstruct('DOMMatrix')),
		...returns(domConstruct('CSSMatrixComponent', [v('matrix'), object({ is2D: true, unknown: true })]))
	],
	undefined,
	'Invalid CSS matrix options'
);
check(
	'CSS refuses stylesheet imports',
	[declare('sheet', domConstruct('CSSStyleSheet')), perform(domCall(v('sheet'), 'insertRule', ['@import "https://example.com/a.css";', 0]))],
	undefined,
	'bounded CSS style rule'
);
check(
	'CSS computed maps remain read-only',
	[...surface, declare('computed', domCall(v('sample'), 'computedStyleMap')), perform(domCall(v('computed'), 'set', ['width', unit(120)]))],
	undefined,
	'not registered for this receiver'
);
check(
	'CSS refuses readonly unit mutation',
	[declare('value', unit(24)), perform(domSet(v('value'), 'unit', 'cm'))],
	undefined,
	'not registered for this receiver'
);
check(
	'CSS bounds repeated expression multiplication',
	[
		declare('value', unit(2, 'number')),
		{
			op: 'for-of',
			name: 'iteration',
			value: array(...Array(12).fill(1)),
			body: [{ op: 'assign', name: 'value', value: domCall(v('value'), 'mul', [v('value')]) }]
		}
	],
	undefined,
	'CSS expression complexity budget'
);

check(
	'CSS literal slash text retains native token semantics',
	[declare('text', domConstruct('CSSUnparsedValue', [array('a/b/c/d/e/f/g/h/i/j/k')])), ...returns(domCall(v('text'), 'toString'))],
	'a/b/c/d/e/f/g/h/i/j/k'
);
