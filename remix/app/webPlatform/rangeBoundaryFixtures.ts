import type { PlatformExpression, PlatformProgram } from './types';
import { declare, domCall, domConstruct, domDocument, domGet, domSurface, object, perform, returns, variable as v } from './programBuilders';
export const RANGE_BOUNDARIES: { name: string; program: PlatformProgram; expected?: unknown; error?: string }[] = [];
function check(name: string, steps: PlatformExpression[], expected?: unknown, error?: string) {
	RANGE_BOUNDARIES.push({
		name,
		expected,
		error,
		program: { version: 1, title: name, document: [{ tag: 'p', attributes: { id: 'sample' }, children: ['abcdefghij'] }], steps }
	});
}
const setup = (active = false) => [
	declare('root', active ? domSurface() : domDocument()),
	declare('sample', domCall(v('root'), 'querySelector', ['#sample'])),
	declare('text', domGet(v('sample'), 'firstChild')),
	declare('range', domConstruct('Range'))
];
const select = [perform(domCall(v('range'), 'setStart', [v('text'), 2])), perform(domCall(v('range'), 'setEnd', [v('text'), 6]))];
check(
	'Range native text and clone identity',
	[
		...setup(),
		...select,
		declare('copy', domCall(v('range'), 'cloneRange')),
		perform(domCall(v('copy'), 'collapse', [true])),
		...returns(
			object({ original: domCall(v('range'), 'toString'), copy: domCall(v('copy'), 'toString'), copyStart: domGet(v('copy'), 'startOffset') })
		)
	],
	{ original: 'cdef', copy: '', copyStart: 2 }
);
check(
	'Range extraction moves selected text',
	[
		...setup(),
		...select,
		declare('fragment', domCall(v('range'), 'extractContents')),
		...returns(
			object({
				extracted: domGet(v('fragment'), 'textContent'),
				remaining: domGet(v('sample'), 'textContent'),
				collapsed: domGet(v('range'), 'collapsed')
			})
		)
	],
	{ extracted: 'cdef', remaining: 'abghij', collapsed: true }
);
check(
	'StaticRange offsets stay fixed while live boundaries follow insertion',
	[
		...setup(),
		...select,
		declare('fixed', domConstruct('StaticRange', [object({ startContainer: v('text'), startOffset: 2, endContainer: v('text'), endOffset: 6 })])),
		perform(domCall(v('text'), 'insertData', [0, 'XYZ'])),
		...returns(object({ live: domGet(v('range'), 'startOffset'), fixed: domGet(v('fixed'), 'startOffset'), text: domCall(v('range'), 'toString') }))
	],
	{ live: 5, fixed: 2, text: 'cdef' }
);
check(
	'Range native invalid offsets remain catchable',
	[
		...setup(),
		...select,
		{
			op: 'try',
			body: [perform(domCall(v('range'), 'setStart', [v('text'), 99]))],
			error: 'error',
			catch: returns({ op: 'get', target: v('error'), key: 'name' })
		}
	],
	'IndexSizeError'
);
check(
	'Range surface relative selection cannot select the runtime parent',
	[...setup(true), ...select, ...returns(domCall(v('range'), 'selectNode', [v('root')]))],
	undefined,
	'outside this program surface'
);
check(
	'Range uninitialized constructor cannot read runtime text',
	[...setup(true), ...returns(domCall(v('range'), 'toString'))],
	undefined,
	'outside this program surface'
);
check(
	'Range surface edits remain unavailable',
	[...setup(true), ...select, ...returns(domCall(v('range'), 'deleteContents'))],
	undefined,
	'Surface tree mutation'
);
check(
	'Range unsafe fragments reject before parsing',
	[...setup(), ...select, ...returns(domCall(v('range'), 'createContextualFragment', ['<img src="https://example.com/a">']))],
	undefined,
	'without attributes'
);
check(
	'Range script fragments reject before parsing',
	[...setup(), ...select, ...returns(domCall(v('range'), 'createContextualFragment', ['<script>1</script>']))],
	undefined,
	'without attributes'
);
check(
	'Range foreign fragment content is unavailable',
	[...setup(), ...select, ...returns(domCall(v('range'), 'createContextualFragment', ['<svg><use></use></svg>']))],
	undefined,
	'without attributes'
);
check(
	'Range fragment token budget',
	[...setup(), ...select, ...returns(domCall(v('range'), 'createContextualFragment', ['<b></b>'.repeat(65)]))],
	undefined,
	'without attributes'
);
check(
	'Range escaped tags remain inert text',
	[...setup(), ...select, ...returns(domGet(domCall(v('range'), 'createContextualFragment', ['&lt;script&gt;hello&lt;/script&gt;']), 'textContent'))],
	'<script>hello</script>'
);
check(
	'StaticRange rejects unknown dictionary fields',
	[
		...setup(),
		...select,
		...returns(
			domConstruct('StaticRange', [object({ startContainer: v('text'), startOffset: 2, endContainer: v('text'), endOffset: 6, extra: true })])
		)
	],
	undefined,
	'exactly four'
);
check(
	'Range handle spoofing remains unavailable',
	[...setup(), ...select, ...returns(domCall(v('range'), 'compareBoundaryPoints', [0, object({ $dom: 'another-run:1', type: 'Range' })]))],
	undefined,
	'stale or belongs'
);
