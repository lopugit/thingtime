import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	array,
	base,
	declare,
	domCall,
	domDocument,
	domGet,
	domSet,
	get,
	input,
	object,
	parameter,
	perform,
	recipe,
	returns,
	variable
} from './programBuilders';

const doc = variable('doc'),
	sample = variable('sample'),
	receiver = variable('receiver'),
	result = variable('result');
const p = (name: string, value: unknown, type: 'text' | 'number' | 'boolean' = 'text') =>
	parameter(name, name[0].toUpperCase() + name.slice(1), value, type);
type Operation = { args?: unknown[]; parameters?: NonNullable<PlatformProgram['parameters']>; setup?: PlatformExpression[] };
const nodeSummary = (target: unknown) => ({
	op: 'conditional',
	test: target,
	then: object({ nodeName: domGet(target, 'nodeName'), nodeType: domGet(target, 'nodeType'), textContent: domGet(target, 'textContent') }),
	else: null
});
const describe = (target: unknown): unknown => ({
	op: 'conditional',
	test: { op: 'binary', operator: '&&', left: target, right: get(target, '$dom') },
	then: {
		op: 'conditional',
		test: { op: 'method', target: array('NodeList', 'HTMLCollection', 'NamedNodeMap'), key: 'includes', args: [get(target, 'type')] },
		then: object({ type: get(target, 'type'), length: domGet(target, 'length'), first: nodeSummary(domCall(target, 'item', [0])) }),
		else: {
			op: 'conditional',
			test: { op: 'binary', operator: '===', left: get(target, 'type'), right: 'DOMTokenList' },
			then: object({ value: domGet(target, 'value'), length: domGet(target, 'length') }),
			else: nodeSummary(target)
		}
	},
	else: target
});
const textArg = input('value');
const newNode = domCall(doc, 'createTextNode', [textArg]);
const first = domGet(sample, 'firstChild');
const nodeOperations: Record<string, Operation> = {
	appendChild: { args: [newNode] },
	insertBefore: { args: [newNode, first] },
	replaceChild: { args: [newNode, first] },
	removeChild: { args: [first] },
	cloneNode: { args: [input('deep')], parameters: [p('deep', true, 'boolean')] },
	contains: { args: [first] },
	compareDocumentPosition: { args: [first] },
	isSameNode: { args: [sample] },
	isEqualNode: { args: [domCall(sample, 'cloneNode', [true])] },
	getRootNode: {},
	hasChildNodes: {},
	normalize: { setup: [perform(domCall(sample, 'append', [' · ', textArg]))] },
	lookupPrefix: { args: ['http://www.w3.org/1999/xhtml'] },
	lookupNamespaceURI: { args: [''] },
	isDefaultNamespace: { args: ['http://www.w3.org/1999/xhtml'] }
};
const parentOperations: Record<string, Operation> = {
	append: { args: [newNode] },
	prepend: { args: [newNode] },
	replaceChildren: { args: [newNode] },
	moveBefore: { args: [domGet(sample, 'lastChild'), first] },
	querySelector: { args: [input('selector')], parameters: [p('selector', '#first')] },
	querySelectorAll: { args: [input('selector')], parameters: [p('selector', 'span')] }
};
const childOperations: Record<string, Operation> = {
	before: { args: [newNode] },
	after: { args: [newNode] },
	replaceWith: { args: [newNode] },
	remove: {}
};
const elementOperations: Record<string, Operation> = {
	...parentOperations,
	getAttribute: { args: [input('attribute')] },
	hasAttribute: { args: [input('attribute')] },
	getAttributeNode: { args: [input('attribute')] },
	removeAttribute: { args: [input('attribute')] },
	setAttribute: { args: [input('attribute'), textArg] },
	toggleAttribute: { args: [input('attribute')] },
	getAttributeNames: {},
	hasAttributes: {},
	setAttributeNode: { args: [domCall(doc, 'createAttribute', [input('attribute')])] },
	removeAttributeNode: { args: [domCall(sample, 'getAttributeNode', [input('attribute')])] },
	matches: { args: [input('selector')], parameters: [p('selector', '.card')] },
	closest: { args: [input('selector')], parameters: [p('selector', 'section')] },
	getElementsByTagName: { args: [input('tag')], parameters: [p('tag', 'span')] },
	getElementsByClassName: { args: [input('className')], parameters: [p('className', 'item')] },
	insertAdjacentText: { args: [input('position'), textArg], parameters: [p('position', 'beforeend')] },
	insertAdjacentElement: { args: [input('position'), domCall(doc, 'createElement', ['hr'])], parameters: [p('position', 'beforeend')] }
};
const documentOperations: Record<string, Operation> = {
	getElementById: { args: [input('id')], parameters: [p('id', 'first')] },
	getElementsByTagName: elementOperations.getElementsByTagName,
	getElementsByClassName: elementOperations.getElementsByClassName,
	createElement: { args: [input('tag')], parameters: [p('tag', 'article')] },
	createTextNode: { args: [textArg] },
	createComment: { args: [textArg] },
	createDocumentFragment: {},
	createAttribute: { args: [input('attribute')] },
	importNode: { args: [sample, true] },
	adoptNode: { args: [sample] }
};
const characterOperations: Record<string, Operation> = {
	appendData: { args: [textArg] },
	insertData: { args: [input('offset'), textArg] },
	deleteData: { args: [input('offset'), input('count')] },
	replaceData: { args: [input('offset'), input('count'), textArg] },
	substringData: { args: [input('offset'), input('count')] },
	splitText: { args: [input('offset')] }
};
const tokenOperations: Record<string, Operation> = {
	add: { args: [textArg] },
	remove: { args: [textArg] },
	contains: { args: [textArg] },
	toggle: { args: [textArg, input('force')], parameters: [p('force', true, 'boolean')] },
	replace: { args: ['card', textArg] },
	item: { args: [input('index')] }
};
const reads: Record<string, string> = {
	Node: 'baseURI childNodes firstChild isConnected lastChild nextSibling nodeName nodeType nodeValue ownerDocument parentElement parentNode previousSibling textContent',
	Element: 'attributes classList className id innerHTML localName namespaceURI outerHTML prefix tagName',
	Document: 'body characterSet charset compatMode contentType doctype documentElement documentURI head inputEncoding URL',
	ParentNode: 'childElementCount children firstElementChild lastElementChild',
	NonDocumentTypeChildNode: 'nextElementSibling previousElementSibling',
	CharacterData: 'data length',
	Text: 'wholeText',
	DOMTokenList: 'length value',
	NodeList: 'length',
	HTMLCollection: 'length',
	NamedNodeMap: 'length',
	Attr: 'localName name namespaceURI ownerElement prefix specified value'
};

/** Catalogue examples are complete editable programs. Native backing dispatches
 * by operation/member only; it never reads a feature ID or this recipe module. */
export function domApiRecipe(f: Feature): Recipe | undefined {
	const name = f.interface || f.name;
	if (
		![
			'Node',
			'Element',
			'Document',
			'ParentNode',
			'ChildNode',
			'NonDocumentTypeChildNode',
			'NonElementParentNode',
			'DocumentFragment',
			'CharacterData',
			'Text',
			'Comment',
			'DOMTokenList',
			'NodeList',
			'HTMLCollection',
			'NamedNodeMap',
			'Attr'
		].includes(name)
	)
		return;
	let create: unknown = sample;
	if (name === 'Node' && f.member === 'nodeValue') create = domGet(first, 'firstChild');
	if (name === 'Node' && f.member === 'nextSibling') create = first;
	if (name === 'Node' && f.member === 'previousSibling') create = domGet(sample, 'lastChild');
	if (name === 'Document' || name === 'NonElementParentNode') create = doc;
	if (name === 'ChildNode' || name === 'NonDocumentTypeChildNode') create = first;
	if (name === 'DocumentFragment') create = domCall(doc, 'createDocumentFragment');
	if (name === 'CharacterData' || name === 'Text') create = domCall(doc, 'createTextNode', [input('text')]);
	if (name === 'Comment') create = domCall(doc, 'createComment', [input('text')]);
	if (name === 'DOMTokenList') create = domGet(sample, 'classList');
	if (name === 'NodeList') create = domGet(sample, 'childNodes');
	if (name === 'HTMLCollection') create = domGet(sample, 'children');
	if (name === 'NamedNodeMap') create = domGet(sample, 'attributes');
	if (name === 'Attr') create = domCall(sample, 'getAttributeNode', ['class']);
	const operations =
		name === 'Node'
			? nodeOperations
			: name === 'Element'
			? elementOperations
			: name === 'Document'
			? documentOperations
			: name === 'ParentNode'
			? parentOperations
			: name === 'ChildNode'
			? childOperations
			: name === 'NonElementParentNode'
			? { getElementById: documentOperations.getElementById }
			: ['CharacterData', 'Text'].includes(name)
			? characterOperations
			: name === 'DOMTokenList'
			? tokenOperations
			: ['NodeList', 'HTMLCollection', 'NamedNodeMap'].includes(name)
			? { item: { args: [input('index')] } }
			: {};
	const member = f.member || '';
	const operation = f.kind === 'operation' && Object.prototype.hasOwnProperty.call(operations, member) ? operations[member] : undefined;
	let expression: unknown;
	if (['interface', 'interface mixin'].includes(f.kind)) expression = receiver;
	else if (f.kind === 'const' && name === 'Node') expression = domGet(receiver, member);
	else if (f.kind === 'attribute' && reads[name]?.split(' ').includes(member)) expression = domGet(receiver, member);
	else if (operation) expression = domCall(receiver, member, operation.args);
	else if (f.kind === 'iterable' && ['NodeList', 'DOMTokenList'].includes(name)) expression = domCall(receiver, 'entries');
	else return;
	const setup: PlatformExpression[] = [];
	if (['CharacterData', 'Text', 'Comment', 'DocumentFragment'].includes(name)) {
		if (name === 'DocumentFragment') setup.push(perform(domCall(receiver, 'append', [input('text')])));
		else setup.push(perform(domCall(sample, 'appendChild', [receiver])));
	}
	// Writable string properties demonstrate assignment as well as their getter.
	if (f.kind === 'attribute' && ['id', 'className', 'data', 'value', 'nodeValue', 'textContent'].includes(member))
		setup.push(perform(domSet(receiver, member, textArg)));
	const steps = [
		declare('doc', domDocument()),
		declare('sample', domCall(doc, 'getElementById', ['sample'])),
		declare('receiver', create),
		...setup,
		...(operation?.setup || []),
		declare('result', expression),
		...returns(object({ result: describe(result), document: domGet(domGet(doc, 'body'), 'innerHTML') }))
	];
	const parameters = [
		p('text', 'Hello Thingtime'),
		p('value', 'gold'),
		p('attribute', 'data-color'),
		p('offset', 2, 'number'),
		p('count', 3, 'number'),
		p('index', 0, 'number'),
		...(operation?.parameters || [])
	];
	const used = new Set<string>(['text']);
	const collect = (value: unknown) => {
		if (!value || typeof value !== 'object') return;
		if ('op' in value && value.op === 'input' && 'name' in value) used.add(String(value.name));
		for (const item of Object.values(value)) collect(item);
	};
	collect(steps);
	return recipe(
		{
			...base(f),
			description: 'Edit a real detached HTML document. Observe the native DOM result and the updated document preview.',
			parameters: parameters.filter((parameter) => used.has(parameter.name)),
			document: [
				{
					tag: 'section',
					children: [
						{
							tag: 'div',
							attributes: { id: 'sample', class: 'card', 'data-color': 'purple' },
							children: [
								{ tag: 'span', attributes: { id: 'first', class: 'item' }, children: ['[[text]]'] },
								{ tag: 'span', attributes: { id: 'second', class: 'item' }, children: ['Second child'] }
							]
						}
					]
				}
			],
			styles: [
				{ selector: '.card', declarations: { padding: '16px', border: '2px solid #a78bfa', 'border-radius': '12px' } },
				{ selector: '.item', declarations: { display: 'block', padding: '4px' } }
			],
			steps
		},
		'interactive',
		'Runs the named DOM operation on real detached document objects. Changes are projected into the preview; layout, browsing-context and permission APIs need their own examples.'
	);
}
