import { features } from './generated/inventory.json';
import type { Feature } from './types';
import { cssomRecipe } from './cssomFixtures';
import { editCSSOMProgram } from './cssomTestCases';
import type { PlatformExpression, PlatformProgram } from './types';
import {
	declare,
	perform,
	domSurface,
	domDocument,
	domGet,
	domSet,
	domCall,
	domConstruct,
	domStatic,
	object,
	array,
	variable as v,
	get,
	returns
} from './programBuilders';
export const CSSOM_BOUNDARIES: { name: string; program: PlatformProgram; expected?: unknown; error?: string }[] = [];
function check(name: string, steps: PlatformExpression[], expected?: unknown, error?: string) {
	CSSOM_BOUNDARIES.push({
		name,
		program: { version: 1, title: name, document: [{ tag: 'div', attributes: { id: 'sample' }, children: ['CSSOM sample'] }], steps },
		expected,
		error
	});
}
const surface = [declare('surface', domSurface()), declare('sample', domCall(v('surface'), 'querySelector', ['#sample']))];
const sheet = [...surface, declare('sheet', domConstruct('CSSStyleSheet'))];
const shadow = [...sheet, declare('shadow', domCall(v('sample'), 'attachShadow', [object({ mode: 'open' })]))];
const detached = [declare('document', domDocument()), declare('style', domCall(v('document'), 'createElement', ['style']))];
const rule = (sheet: unknown = v('sheet')) => domCall(domGet(sheet, 'cssRules'), 'item', [0]);
const caught = (expr: unknown): PlatformExpression => ({ op: 'try', body: returns(expr), error: 'error', catch: returns(get(v('error'), 'name')) });
check(
	'CSSOM inline priority and resolved width are native',
	[
		...surface,
		declare('style', domGet(v('sample'), 'style')),
		perform(domCall(v('style'), 'setProperty', ['width', '123px', 'important'])),
		...returns(
			object({
				priority: domCall(v('style'), 'getPropertyPriority', ['width']),
				computed: domCall(domStatic('Window', 'getComputedStyle', [v('sample')]), 'getPropertyValue', ['width'])
			})
		)
	],
	{ priority: 'important', computed: '123px' }
);
check(
	'CSSOM awaited replacement yields the actual sheet',
	[
		...sheet,
		declare('returned', domCall(v('sheet'), 'replace', ['.demo {width:123px}'])),
		...returns(
			object({ same: { op: 'binary', operator: '===', left: v('sheet'), right: v('returned') }, text: domGet(rule(v('returned')), 'cssText') })
		)
	],
	{ same: true, text: '.demo { width: 123px; }' }
);
check(
	'CSSOM shadow adoption affects its native host',
	[
		...shadow,
		perform(domCall(v('sheet'), 'replaceSync', [':host {width:123px;display:block}'])),
		perform(domSet(v('shadow'), 'adoptedStyleSheets', array(v('sheet')))),
		...returns(domCall(domStatic('Window', 'getComputedStyle', [v('sample')]), 'getPropertyValue', ['width']))
	],
	'123px'
);
check(
	'CSSOM rule cssText setter keeps its specified no-op behavior',
	[
		...sheet,
		perform(domCall(v('sheet'), 'insertRule', ['.demo {width:123px}'])),
		declare('rule', rule()),
		perform(domSet(v('rule'), 'cssText', '.demo {width:456px}')),
		...returns(domGet(v('rule'), 'cssText'))
	],
	'.demo { width: 123px; }'
);
check(
	'CSSOM computed declarations preserve native readonly errors',
	[...surface, caught(domCall(domStatic('Window', 'getComputedStyle', [v('sample')]), 'setProperty', ['color', 'red']))],
	'NoModificationAllowedError'
);
check(
	'CSSOM grouping edits retain real parent identity',
	[
		...sheet,
		perform(domCall(v('sheet'), 'insertRule', ['@media screen {.a{width:1px}}'])),
		declare('group', rule()),
		perform(domCall(v('group'), 'insertRule', ['.b {width:2px}', 1])),
		declare('child', rule(v('group'))),
		...returns(
			object({
				same: { op: 'binary', operator: '===', left: domGet(v('child'), 'parentRule'), right: v('group') },
				length: domGet(domGet(v('group'), 'cssRules'), 'length')
			})
		)
	],
	{ same: true, length: 2 }
);
check('CSSOM escaped identifiers still select their actual node', [...surface, ...returns(domStatic('CSS', 'escape', ['a:b']))], 'a\\:b');
check(
	'CSSOM detached style association preserves owner node',
	[
		...detached,
		perform(domSet(v('style'), 'textContent', '.demo {width:123px}')),
		perform(domCall(domGet(v('document'), 'body'), 'appendChild', [v('style')])),
		declare('sheet', domGet(v('style'), 'sheet')),
		...returns({ op: 'binary', operator: '===', left: domGet(v('sheet'), 'ownerNode'), right: v('style') })
	],
	true
);
check(
	'CSSOM cannot expose the runtime document through shadow host',
	[...shadow, ...returns(domGet(domGet(v('shadow'), 'host'), 'ownerDocument'))],
	undefined,
	'outside this program surface'
);
check(
	'CSSOM cannot attach a root to the runtime surface itself',
	[...surface, ...returns(domCall(v('surface'), 'attachShadow', [object({ mode: 'open' })]))],
	undefined,
	'program-owned surface'
);
check(
	'CSSOM refuses foreign adopted sheet handles',
	[...shadow, perform(domSet(v('shadow'), 'adoptedStyleSheets', array(object({ $dom: 'other:1', type: 'CSSStyleSheet' }))))],
	undefined,
	'stale or belongs'
);
check(
	'CSSOM bounds adopted sheet allocation',
	[...shadow, perform(domSet(v('shadow'), 'adoptedStyleSheets', array(...Array(9).fill(v('sheet')))))],
	undefined,
	'adopted sheet budget'
);
check(
	'CSSOM bounds nested rule parsing before native replacement',
	[...sheet, perform(domCall(v('sheet'), 'replaceSync', ['@media screen {'.repeat(9) + '.a{}' + '}'.repeat(9)]))],
	undefined,
	'rule budget'
);
check(
	'CSSOM bounds accumulated rules across grouping receivers',
	[
		...sheet,
		perform(domCall(v('sheet'), 'replaceSync', ['@media screen {' + '.a{}'.repeat(30) + '}'])),
		declare('group', rule()),
		perform(domCall(v('group'), 'insertRule', ['@media print {.b{}}']))
	],
	undefined,
	'CSS rule budget'
);
check(
	'CSSOM bounds detached style text before native setter',
	[...detached, perform(domSet(v('style'), 'textContent', 'x'.repeat(4097)))],
	undefined,
	'CSSOM text budget'
);
check(
	'CSSOM refuses closed or unregistered shadow options',
	[...surface, ...returns(domCall(v('sample'), 'attachShadow', [object({ mode: 'closed' })]))],
	undefined,
	'program-owned shadow'
);
check(
	'CSSOM refuses unregistered Window globals',
	[...surface, ...returns(domStatic('Window', 'open', ['https://example.com']))],
	undefined,
	'Unregistered CSS native operation'
);
check('CSSOM does not expose stylesheet document adoption', [...sheet, ...returns(domGet(v('sheet'), 'constructor'))], undefined, 'not registered');

// Exercise the complete shipped recipe, including its outer authored stylesheet:
// an outer width/color must not silently override the shadow's adopted CSS.
const adoptionFeature = features.find((f) => f.name === 'DocumentOrShadowRoot.adoptedStyleSheets') as Feature;
for (const edited of [false, true]) {
	const original = cssomRecipe(adoptionFeature)!.program;
	const program = edited ? editCSSOMProgram(original) : structuredClone(original);
	const last = program.steps![program.steps!.length - 1] as { op: string; value: unknown };
	last.value = get(get(last.value, 'value'), 'computedWidth');
	CSSOM_BOUNDARIES.push({
		name: 'CSSOM authored adoption recipe computes ' + (edited ? '180px' : '120px'),
		program,
		expected: edited ? '180px' : '120px'
	});
}
