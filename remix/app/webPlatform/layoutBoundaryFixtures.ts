import type { PlatformExpression, PlatformProgram } from './types';
import {
	declare,
	perform,
	domSurface,
	domDocument,
	domCall,
	domGet,
	domGlobal,
	domStatic,
	domConstruct,
	object,
	array,
	variable as v,
	returns
} from './programBuilders';
export const LAYOUT_BOUNDARIES: { name: string; program: PlatformProgram; expected?: unknown; error?: string }[] = [];
const surface = [declare('surface', domSurface()), declare('sample', domCall(v('surface'), 'querySelector', ['#sample']))];
function check(name: string, steps: PlatformExpression[], expected?: unknown, error?: string) {
	LAYOUT_BOUNDARIES.push({
		name,
		expected,
		error,
		program: {
			version: 1,
			title: name,
			document: [
				{
					tag: 'div',
					attributes: { id: 'sample', style: 'width:120px;height:60px;overflow:auto;position:relative' },
					children: [{ tag: 'div', attributes: { style: 'width:600px;height:500px' }, children: ['Native layout test'] }]
				}
			],
			steps
		}
	});
}
check(
	'Layout native scroll finishes before metrics are read',
	[
		...surface,
		perform(domCall(v('sample'), 'scrollTo', [object({ left: 35, top: 45, behavior: 'instant' })])),
		...returns(object({ x: domGet(v('sample'), 'scrollLeft'), y: domGet(v('sample'), 'scrollTop') }))
	],
	{ x: 35, y: 45 }
);
check(
	'Layout native rectangle dimensions',
	[
		...surface,
		declare('rect', domCall(v('sample'), 'getBoundingClientRect')),
		...returns(object({ width: domGet(v('rect'), 'width'), height: domGet(v('rect'), 'height') }))
	],
	{ width: 120, height: 60 }
);
check(
	'Layout rect list out-of-range item remains null',
	[...surface, ...returns(domCall(domCall(v('sample'), 'getClientRects'), 'item', [99]))],
	null
);
check(
	'Layout quadrilateral bounds are computed natively',
	[
		...surface,
		declare('quad', domStatic('DOMQuad', 'fromRect', [object({ x: 3, y: 4, width: 25, height: 30 })])),
		declare('bounds', domCall(v('quad'), 'getBounds')),
		...returns(object({ x: domGet(v('bounds'), 'x'), width: domGet(v('bounds'), 'width') }))
	],
	{ x: 3, width: 25 }
);
check('Layout hit testing excludes runtime ancestors', [...surface, ...returns(domStatic('Document', 'elementsFromPoint', [1, 1]))], []);
check('Layout window cannot expose its parent', [...surface, ...returns(domGlobal('Window', 'parent'))], undefined, 'Unregistered layout global');
check(
	'Layout document cannot expose its root receiver',
	[...surface, ...returns(domGlobal('Document', 'documentElement'))],
	undefined,
	'Unregistered layout global'
);
check(
	'Layout native range cannot expose its initial runtime document',
	[...surface, ...returns(domGet(domStatic('Document', 'createRange'), 'startContainer'))],
	undefined,
	'outside this program surface'
);
check(
	'Layout screen cannot expose arbitrary members',
	[...surface, ...returns(domGet(domGlobal('Window', 'screen'), 'constructor'))],
	undefined,
	'not registered'
);
check(
	'Layout global reads require active surface',
	[declare('document', domDocument()), ...returns(domGlobal('Window', 'screen'))],
	undefined,
	'Unregistered layout global'
);
check(
	'Layout globals reject arguments',
	[...surface, ...returns({ op: 'await', value: { op: 'dom', action: 'global', target: 'Window', key: 'innerWidth', args: [1] } })],
	undefined,
	'Unregistered layout global'
);
check(
	'Layout scroll rejects non-finite and unbounded work',
	[...surface, ...returns(domCall(v('sample'), 'scrollTo', [object({ top: 1000000 })]))],
	undefined,
	'bounded layout number'
);
check(
	'Layout options reject executable or foreign fields',
	[...surface, ...returns(domCall(v('sample'), 'scrollTo', [object({ callback: 'alert(1)' })]))],
	undefined,
	'Unknown layout dictionary'
);
check(
	'Layout geometry dictionaries cannot smuggle receiver graphs',
	[...surface, ...returns(domConstruct('DOMQuad', [object({ x: object({ $dom: 'foreign', type: 'Window' }) })]))],
	undefined,
	'bounded layout number'
);
check(
	'Layout caret shadow roots enforce ownership before native call',
	[
		...surface,
		...returns(
			domStatic('Document', 'caretPositionFromPoint', [20, 20, object({ shadowRoots: array(object({ $dom: 'foreign', type: 'ShadowRoot' })) })])
		)
	],
	undefined,
	'stale or belongs'
);
check(
	'Layout element metrics do not authorize surface tree writes',
	[...surface, ...returns(domCall(v('sample'), 'remove'))],
	undefined,
	'Surface tree mutation'
);
