import { declare, perform, domSurface, domCall, domGet, domSet, domConstruct, variable as v, returns, object, literal } from './programBuilders';
import type { PlatformProgram } from './types';
export const CANVAS_BOUNDARY_FIXTURES: { name: string; program: PlatformProgram; test: string; expected?: unknown }[] = [];
const call = (key: string, args: any[] = []) => domCall(v('ctx'), key, args),
	exec = (key: string, args: any[] = []) => perform(call(key, args)),
	set = (key: string, value: any) => perform(domSet(v('ctx'), key, value));
const init = [
	declare('doc', domSurface()),
	declare('canvas', domCall(v('doc'), 'querySelector', ['#sample'])),
	declare('ctx', domCall(v('canvas'), 'getContext', ['2d']))
];
const probe = (name: string, steps: any[], expected?: any) => {
	CANVAS_BOUNDARY_FIXTURES.push({
		name,
		program: {
			version: 1,
			title: name,
			document: [{ tag: 'canvas', attributes: { id: 'sample', width: 256, height: 160 } }],
			steps: [...init, ...steps]
		},
		test: expected === undefined ? 'error' : 'exact',
		expected
	});
};
probe(
	'exact native pixel',
	[set('fillStyle', '#ff0000'), exec('fillRect', [0, 0, 32, 32]), ...returns(domGet(call('getImageData', [16, 16, 1, 1]), 'data'))],
	[255, 0, 0, 255]
);
probe('native edited font', [set('font', '24px serif'), ...returns(domGet(v('ctx'), 'font'))], '24px serif');
probe('surface parent escape', [...returns(domGet(v('doc'), 'parentNode'))]);
probe('surface root mutation', [perform(domCall(v('doc'), 'remove')), ...returns(true)]);
probe(
	'native state restore',
	[set('lineWidth', 9), exec('save'), set('lineWidth', 3), exec('restore'), ...returns(domGet(v('ctx'), 'lineWidth'))],
	9
);
probe(
	'native width reset',
	[
		set('globalAlpha', 0.5),
		exec('fillRect', [0, 0, 32, 32]),
		perform(domSet(v('canvas'), 'width', 256)),
		...returns(object({ alpha: domGet(v('ctx'), 'globalAlpha'), pixel: domGet(call('getImageData', [16, 16, 1, 1]), 'data') }))
	],
	{ alpha: 1, pixel: [0, 0, 0, 0] }
);
probe(
	'native matrix',
	[
		exec('translate', [12, 24]),
		declare('matrix', call('getTransform')),
		...returns(object({ a: domGet(v('matrix'), 'a'), e: domGet(v('matrix'), 'e'), f: domGet(v('matrix'), 'f') }))
	],
	{ a: 1, e: 12, f: 24 }
);
probe(
	'native negative radius',
	[{ op: 'try', body: [exec('arc', [0, 0, -1, 0, 1])], error: 'error', catch: returns({ op: 'get', target: v('error'), key: 'name' }) }],
	'IndexSizeError'
);
probe('path exponential growth', [
	declare('path', domConstruct('Path2D', ['M0 0L1 1'])),
	...Array.from({ length: 15 }, () => perform(domCall(v('path'), 'addPath', [v('path')]))),
	...returns(true)
]);
probe('large canvas size', [perform(domSet(v('canvas'), 'width', 513)), ...returns(true)]);
probe('negative ImageData', [...returns(domConstruct('ImageData', [-1, 1]))]);
probe('inferred ImageData size', [...returns(domConstruct('ImageData', [Array(4096).fill(255), 1]))]);
probe('oversized pixel read', [...returns(call('getImageData', [0, 0, 33, 1]))]);
probe('external canvas filter', [set('filter', 'url(https://example.com/filter)'), ...returns(true)]);
probe('huge canvas font', [set('font', 'calc(100000 * 24px) serif'), ...returns(true)]);
probe('unowned image source', [exec('drawImage', [literal({ $dom: 'old:1', type: 'HTMLCanvasElement' }), 0, 0]), ...returns(true)]);
probe('unregistered context', [...returns(domCall(v('canvas'), 'getContext', ['webgl']))]);
probe('owner window escape', [...returns(domGet(v('doc'), 'defaultView'))]);
const tooMany = structuredClone(CANVAS_BOUNDARY_FIXTURES.at(-1)!);
tooMany.name = 'canvas node budget';
tooMany.program.document!.push(...Array.from({ length: 4 }, () => ({ tag: 'canvas' })));
CANVAS_BOUNDARY_FIXTURES.push(tooMany);

probe('surface contexts cannot mix', [...returns({ op: 'await', value: { op: 'dom', action: 'document' } })]);
probe(
	'native evenodd hole',
	[
		exec('beginPath'),
		exec('rect', [0, 0, 32, 32]),
		exec('rect', [8, 8, 16, 16]),
		exec('fill', ['evenodd']),
		...returns(domGet(call('getImageData', [16, 16, 1, 1]), 'data'))
	],
	[0, 0, 0, 0]
);
probe(
	'native text metrics scale',
	[
		set('font', '12px sans-serif'),
		declare('small', domGet(call('measureText', ['Thingtime']), 'width')),
		set('font', '24px sans-serif'),
		declare('large', domGet(call('measureText', ['Thingtime']), 'width')),
		...returns({ op: 'binary', operator: '>', left: v('large'), right: { op: 'binary', operator: '*', left: v('small'), right: 1.8 } })
	],
	true
);

CANVAS_BOUNDARY_FIXTURES.push({
	name: 'Live bindings cannot bypass canvas dimensions',
	test: 'error',
	program: {
		version: 1,
		title: 'Canvas live attribute bound',
		document: [{ tag: 'canvas', attributes: { id: 'sample', width: 256, height: 160 } }],
		dom: [{ target: '#sample', method: 'setAttribute', args: ['width', 513] }]
	}
});
