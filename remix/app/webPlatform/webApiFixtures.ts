import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import { base, get, global, input, literal, make, method, parameter, recipe, returns } from './programBuilders';

const variable = (name: string) => ({ op: 'variable', name });
const receiver = variable('receiver');
const awaited = (value: unknown) => ({ op: 'await', value });
const object = (entries: Record<string, unknown>) => ({ op: 'object', entries: Object.entries(entries) });
const array = (...items: unknown[]) => ({ op: 'array', items });
const declare = (name: string, value: unknown): PlatformExpression => ({ op: 'let', name, value });
const perform = (value: unknown): PlatformExpression => ({ op: 'expression', value });
const project = (value: unknown, names: string[]) => object(Object.fromEntries(names.map((name) => [name, get(value, name)])));
const entries = (value: unknown) => method(global('Array'), 'from', [method(value, 'entries')]);
type Parameters = NonNullable<PlatformProgram['parameters']>;
type Operation = { parameters?: Parameters; steps?: PlatformExpression[]; result: unknown; requires?: string[][] };
type Fixture = {
	global: string;
	parameters: Parameters;
	create: unknown;
	setup?: PlatformExpression[];
	summary: unknown;
	properties?: Record<string, unknown>;
	operations?: Record<string, Operation>;
	iterable?: unknown;
	constants?: boolean;
};

/** These are authored data recipes. The generic worker receives only the saved
 * program; it neither imports this catalogue nor dispatches on a feature ID. */
function fromFixture(f: Feature, fixture: Fixture): Recipe | undefined {
	let operation: Operation | undefined;
	let requires: string[][] = [[fixture.global]];
	if (['interface', 'interface mixin', 'constructor'].includes(f.kind)) operation = { result: fixture.summary };
	else if (f.kind === 'iterable' && fixture.iterable) operation = { result: fixture.iterable };
	else if (f.kind === 'attribute' && Object.hasOwn(fixture.properties || {}, f.member || '')) {
		operation = { result: fixture.properties![f.member!] };
		requires.push([fixture.global, 'prototype', f.member!]);
	} else if (f.kind === 'const' && fixture.constants) {
		operation = { result: get(global(fixture.global), f.member!) };
		requires.push([fixture.global, f.member!]);
	} else if (f.kind === 'operation' && Object.hasOwn(fixture.operations || {}, f.member || '')) {
		operation = fixture.operations![f.member!];
		requires.push(f.static ? [fixture.global, f.member!] : [fixture.global, 'prototype', f.member!]);
	}
	if (!operation) return undefined;
	requires = [...requires, ...(operation.requires || [])];
	const steps = [
		...(f.static || f.kind === 'const' ? [] : [declare('receiver', fixture.create), ...(fixture.setup || [])]),
		...(operation.steps || []),
		...returns(operation.result)
	];
	const used = new Set<string>();
	const collectInputs = (value: unknown) => {
		if (!value || typeof value !== 'object') return;
		if ('op' in value && value.op === 'input' && 'name' in value && typeof value.name === 'string') used.add(value.name);
		for (const item of Object.values(value)) collectInputs(item);
	};
	collectInputs(steps);
	return recipe(
		{
			...base(f),
			parameters: [...fixture.parameters, ...(operation.parameters || [])].filter((p) => used.has(p.name)),
			requires,
			steps
		},
		'interactive',
		'This editable program uses an isolated, in-memory receiver. Change its inputs and run the real browser API. No request is sent.'
	);
}

function keyValueFixture(name: string): Fixture {
	const isHeaders = name === 'Headers',
		isForm = name === 'FormData';
	const initial = isHeaders
		? [
				['X-Theme', 'purple'],
				['Set-Cookie', 'demo=a'],
				['Set-Cookie', 'demo=b']
		  ]
		: [
				['color', 'purple'],
				['color', 'teal'],
				['name', 'Thingtime']
		  ];
	const key = parameter('key', 'Name', isHeaders ? 'X-Theme' : 'color');
	const value = parameter('value', 'Value', 'gold');
	const snapshot = entries(receiver);
	const operations: Record<string, Operation> = {};
	for (const member of ['append', 'set'])
		operations[member] = {
			parameters: [key, value],
			steps: [perform(method(receiver, member, [input('key'), input('value')]))],
			result: snapshot
		};
	operations.delete = { parameters: [key], steps: [perform(method(receiver, 'delete', [input('key')]))], result: snapshot };
	for (const member of ['get', 'getAll', 'has']) operations[member] = { parameters: [key], result: method(receiver, member, [input('key')]) };
	operations.sort = { steps: [perform(method(receiver, 'sort'))], result: snapshot };
	operations.getSetCookie = { result: method(receiver, 'getSetCookie') };
	return {
		global: name,
		parameters: [parameter('pairs', 'Initial name/value pairs (JSON)', initial, 'json')],
		create: make(name, isForm ? [] : [input('pairs')]),
		setup: isForm
			? [
					{
						op: 'for-of',
						name: 'pair',
						value: input('pairs'),
						body: [perform(method(receiver, 'append', [get(variable('pair'), 0), get(variable('pair'), 1)]))]
					}
			  ]
			: [],
		summary: snapshot,
		iterable: snapshot,
		properties: { size: get(receiver, 'size') },
		operations
	};
}

function urlFixture(): Fixture {
	const url = input('url'),
		baseUrl = input('baseUrl');
	const properties = Object.fromEntries(
		'href origin protocol username password host hostname port pathname search hash'.split(' ').map((k) => [k, get(receiver, k)])
	);
	properties.searchParams = entries(get(receiver, 'searchParams'));
	const objectUrl = variable('objectUrl');
	const objectUrlOperation = {
		parameters: [parameter('contents', 'Blob contents', 'Hello Thingtime')],
		steps: [
			declare('objectUrl', method(global('URL'), 'createObjectURL', [make('Blob', [array(input('contents'))])])),
			declare('revokeResult', method(global('URL'), 'revokeObjectURL', [objectUrl]))
		],
		result: object({ createdURL: objectUrl, revokeReturnValue: variable('revokeResult') }),
		requires: [['URL', 'createObjectURL'], ['URL', 'revokeObjectURL'], ['Blob']]
	};
	return {
		global: 'URL',
		parameters: [parameter('url', 'URL or relative path', '/hello?name=Thingtime#demo'), parameter('baseUrl', 'Base URL', 'https://example.com/')],
		create: make('URL', [url, baseUrl]),
		summary: method(receiver, 'toJSON'),
		properties,
		operations: {
			toJSON: { result: method(receiver, 'toJSON') },
			canParse: { result: method(global('URL'), 'canParse', [url, baseUrl]) },
			parse: {
				steps: [declare('parsed', method(global('URL'), 'parse', [url, baseUrl]))],
				result: { op: 'conditional', test: variable('parsed'), then: method(variable('parsed'), 'toJSON'), else: null }
			},
			createObjectURL: objectUrlOperation,
			revokeObjectURL: objectUrlOperation
		}
	};
}

function blobFixture(name: string): Fixture {
	const file = name === 'File';
	const params = [parameter('text', 'Contents', 'Hello 🌈 Thingtime'), parameter('mime', 'Content type', 'text/plain')];
	if (file) params.push(parameter('filename', 'File name', 'example.txt'));
	const options = object({ type: input('mime'), ...(file ? { lastModified: 0 } : {}) });
	const properties = Object.fromEntries(
		['size', 'type', ...(file ? ['name', 'lastModified', 'webkitRelativePath'] : [])].map((k) => [k, get(receiver, k)])
	);
	return {
		global: name,
		parameters: params,
		create: make(name, [array(input('text')), ...(file ? [input('filename')] : []), options]),
		summary: object({ ...properties, text: awaited(method(receiver, 'text')) }),
		properties,
		operations: {
			text: { result: awaited(method(receiver, 'text')) },
			bytes: { result: awaited(method(receiver, 'bytes')) },
			arrayBuffer: { result: make('Uint8Array', [awaited(method(receiver, 'arrayBuffer'))]) },
			slice: {
				parameters: [parameter('start', 'Start byte', 0, 'number'), parameter('end', 'End byte', 5, 'number')],
				result: awaited(method(method(receiver, 'slice', [input('start'), input('end')]), 'text'))
			},
			stream: { result: awaited(method(make('Response', [method(receiver, 'stream')]), 'text')), requires: [['Response']] },
			textStream: { result: awaited(method(method(method(receiver, 'textStream'), 'getReader'), 'read')) }
		}
	};
}

function fetchFixture(name: string): Fixture {
	const request = name === 'Request',
		body = name === 'Body';
	const ctor = request ? 'Request' : 'Response';
	const parameters = request
		? [
				parameter('url', 'URL (no request is sent)', 'https://example.com/demo'),
				parameter('options', 'Request options', { method: 'POST', body: 'Hello Thingtime' }, 'json')
		  ]
		: [
				parameter('body', 'Body text', body ? '{"hello":"Thingtime"}' : 'Hello Thingtime'),
				parameter('options', 'Response options', { status: 201, headers: { 'Content-Type': 'application/json' } }, 'json')
		  ];
	const summary = (value: unknown) =>
		object({
			...Object.fromEntries(
				(request ? ['url', 'method', 'mode', 'credentials'] : ['status', 'statusText', 'ok', 'type']).map((k) => [k, get(value, k)])
			),
			headers: entries(get(value, 'headers'))
		});
	const props = request
		? 'cache credentials destination duplex integrity isHistoryNavigation isReloadNavigation keepalive method mode redirect referrer referrerPolicy targetAddressSpace url'
		: 'ok redirected status statusText type url bodyUsed';
	const properties = Object.fromEntries(props.split(' ').map((k) => [k, get(receiver, k)]));
	properties.headers = entries(get(receiver, 'headers'));
	properties.signal = project(get(receiver, 'signal'), ['aborted', 'reason']);
	properties.body = awaited(method(make('Response', [get(receiver, 'body')]), 'text'));
	const operations: Record<string, Operation> = {
		clone: {
			steps: [declare('clone', method(receiver, 'clone'))],
			result: object({ metadata: summary(variable('clone')), body: awaited(method(variable('clone'), 'text')) })
		},
		error: { result: summary(method(global('Response'), 'error')) },
		redirect: {
			parameters: [parameter('url', 'Redirect URL (no navigation)', 'https://example.com/next')],
			result: summary(method(global('Response'), 'redirect', [input('url'), 307]))
		}
	};
	if (!body)
		operations.json = {
			parameters: [parameter('data', 'JSON data', { hello: 'Thingtime' }, 'json')],
			steps: [declare('jsonResponse', method(global('Response'), 'json', [input('data')]))],
			result: object({ metadata: summary(variable('jsonResponse')), body: awaited(method(variable('jsonResponse'), 'json')) })
		};
	else {
		for (const member of ['text', 'json', 'bytes']) operations[member] = { result: awaited(method(receiver, member)) };
		operations.arrayBuffer = { result: make('Uint8Array', [awaited(method(receiver, 'arrayBuffer'))]) };
		operations.blob = {
			steps: [declare('blob', awaited(method(receiver, 'blob')))],
			result: object({ size: get(variable('blob'), 'size'), type: get(variable('blob'), 'type'), text: awaited(method(variable('blob'), 'text')) })
		};
		operations.formData = {
			parameters: [parameter('form', 'URL-encoded form body', 'name=Thingtime&color=purple')],
			result: entries(
				awaited(method(make('Response', [input('form'), literal({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })]), 'formData'))
			)
		};
		operations.textStream = { result: awaited(method(method(method(receiver, 'textStream'), 'getReader'), 'read')) };
	}
	return {
		global: ctor,
		parameters,
		create: make(ctor, [input(request ? 'url' : 'body'), input('options')]),
		summary: body ? awaited(method(receiver, 'text')) : summary(receiver),
		properties,
		operations
	};
}

function encodingFixture(name: string): Fixture {
	const encoder = name.startsWith('TextEncoder'),
		ctor = encoder ? 'TextEncoder' : 'TextDecoder';
	return {
		global: ctor,
		parameters: encoder
			? [parameter('text', 'Text', 'Hello 🌈')]
			: [
					parameter('bytes', 'Encoded bytes', [72, 101, 108, 108, 111], 'json'),
					parameter('label', 'Encoding label', 'utf-8'),
					parameter('options', 'Decoder options', { fatal: false, ignoreBOM: false }, 'json')
			  ],
		create: make(ctor, encoder ? [] : [input('label'), input('options')]),
		summary: encoder ? method(receiver, 'encode', [input('text')]) : method(receiver, 'decode', [make('Uint8Array', [input('bytes')])]),
		properties: Object.fromEntries(['encoding', 'fatal', 'ignoreBOM'].map((k) => [k, get(receiver, k)])),
		operations: {
			encode: { result: method(receiver, 'encode', [input('text')]) },
			decode: { result: method(receiver, 'decode', [make('Uint8Array', [input('bytes')])]) },
			encodeInto: {
				parameters: [parameter('capacity', 'Destination byte capacity', 12, 'number')],
				steps: [
					declare('destination', make('Uint8Array', [input('capacity')])),
					declare('written', method(receiver, 'encodeInto', [input('text'), variable('destination')]))
				],
				result: object({ ...Object.fromEntries(['read', 'written'].map((k) => [k, get(variable('written'), k)])), bytes: variable('destination') })
			}
		}
	};
}

function geometryFixture(name: string): Fixture {
	const matrix = name.startsWith('DOMMatrix'),
		rect = name.startsWith('DOMRect');
	const coordinates = rect ? ['x', 'y', 'width', 'height'] : ['x', 'y', 'z', 'w'];
	const defaults = rect ? [10, 20, 80, 40] : [3, 4, 0, 1];
	const parameters = matrix
		? [parameter('matrix', 'Matrix coefficients', [1, 0, 0, 1, 10, 20], 'json')]
		: coordinates.map((k, i) => parameter(k, k, defaults[i], 'number'));
	const propertyNames = matrix
		? [...'a b c d e f is2D isIdentity'.split(' '), ...Array.from({ length: 16 }, (_, i) => `m${Math.floor(i / 4) + 1}${(i % 4) + 1}`)]
		: [...coordinates, ...(rect ? ['top', 'right', 'bottom', 'left'] : [])];
	const operations: Record<string, Operation> = { toJSON: { result: method(receiver, 'toJSON') } };
	const json = (value: unknown) => method(value, 'toJSON');
	if (!matrix) {
		const key = rect ? 'fromRect' : 'fromPoint';
		operations[key] = { result: json(method(global(name), key, [object(Object.fromEntries(coordinates.map((k) => [k, input(k)])))])) };
		operations.matrixTransform = {
			parameters: [parameter('transform', 'Transformation matrix', { a: 2, d: 2, e: 10, f: 20 }, 'json')],
			result: json(method(receiver, 'matrixTransform', [input('transform')]))
		};
	} else {
		const args: Record<string, unknown[]> = {
			translate: [10, 20, 0],
			scale: [2, 3, 1],
			scale3d: [2],
			scaleNonUniform: [2, 3],
			rotate: [30],
			rotateFromVector: [1, 1],
			rotateAxisAngle: [0, 0, 1, 45],
			skewX: [20],
			skewY: [20],
			multiply: [{ a: 2, d: 2 }],
			preMultiply: [{ a: 2, d: 2 }],
			inverse: [],
			invert: [],
			flipX: [],
			flipY: [],
			transformPoint: [{ x: 3, y: 4 }]
		};
		for (const [key, defaults] of Object.entries(args))
			for (const member of [key, `${key}Self`]) {
				operations[member] = {
					parameters: defaults.length ? [parameter('arguments', 'Method arguments (JSON array)', defaults, 'json')] : [],
					result: json(method(receiver, member, defaults.length ? [{ op: 'spread', value: input('arguments') }] : []))
				};
			}
		for (const type of ['Float32Array', 'Float64Array']) {
			operations[`from${type}`] = { result: json(method(global(name), `from${type}`, [make(type, [input('matrix')])])) };
			operations[`to${type}`] = { result: method(receiver, `to${type}`) };
		}
		operations.fromMatrix = {
			parameters: [parameter('other', 'Matrix dictionary', { a: 2, d: 3, e: 10, f: 20 }, 'json')],
			result: json(method(global(name), 'fromMatrix', [input('other')]))
		};
	}
	return {
		global: name,
		parameters,
		create: make(name, matrix ? [input('matrix')] : coordinates.map(input)),
		summary: json(receiver),
		properties: Object.fromEntries(propertyNames.map((k) => [k, get(receiver, k)])),
		operations
	};
}

export function workerApiRecipe(f: Feature): Recipe | undefined {
	const name = f.interface || f.name;
	let fixture: Fixture | undefined;
	if (['URLSearchParams', 'Headers', 'FormData'].includes(name)) fixture = keyValueFixture(name);
	else if (name === 'URL') fixture = urlFixture();
	else if (['Blob', 'File'].includes(name)) fixture = blobFixture(name);
	else if (['Request', 'Response', 'Body'].includes(name)) fixture = fetchFixture(name);
	else if (['TextEncoder', 'TextDecoder', 'TextEncoderCommon', 'TextDecoderCommon'].includes(name)) fixture = encodingFixture(name);
	else if (['DOMPoint', 'DOMPointReadOnly', 'DOMRect', 'DOMRectReadOnly', 'DOMMatrix', 'DOMMatrixReadOnly'].includes(name))
		fixture = geometryFixture(name);
	else if (name === 'DOMException')
		fixture = {
			global: name,
			parameters: [parameter('message', 'Message', 'A demonstration error'), parameter('name', 'Error name', 'InvalidStateError')],
			create: make(name, [input('message'), input('name')]),
			summary: project(receiver, ['name', 'message', 'code']),
			constants: true,
			properties: Object.fromEntries(['name', 'message', 'code'].map((k) => [k, get(receiver, k)]))
		};
	return fixture ? fromFixture(f, fixture) : undefined;
}
