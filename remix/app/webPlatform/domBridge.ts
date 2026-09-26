/** Real DOM receivers for data programs. Only this module runs DOM operations
 * on the frame thread; authored JavaScript remains in the terminable worker.
 * A detached document owns every receiver. The visible surface is a projection,
 * never a source of handles, so navigation cannot reach the runtime document. */
type Arg = 'text' | 'selector' | 'tag' | 'attribute' | 'number' | 'boolean' | 'node' | 'nullable-node' | 'node-or-text';
type Method = { args: Arg[]; min?: number; rest?: boolean; mutates?: boolean; iterable?: boolean };
type Policy = { reads: string; writes?: string; calls?: Record<string, Method> };
const call = (args: Arg[] = [], options: Omit<Method, 'args'> = {}): Method => ({ args, ...options });
const mutate = (args: Arg[] = [], options: Omit<Method, 'args'> = {}) => call(args, { ...options, mutates: true });
const parentCalls = {
	querySelector: call(['selector']),
	querySelectorAll: call(['selector']),
	append: mutate(['node-or-text'], { min: 0, rest: true }),
	prepend: mutate(['node-or-text'], { min: 0, rest: true }),
	replaceChildren: mutate(['node-or-text'], { min: 0, rest: true }),
	moveBefore: mutate(['node', 'nullable-node'])
};
const childCalls = {
	before: mutate(['node-or-text'], { min: 0, rest: true }),
	after: mutate(['node-or-text'], { min: 0, rest: true }),
	replaceWith: mutate(['node-or-text'], { min: 0, rest: true }),
	remove: mutate()
};
const parentReads = 'children firstElementChild lastElementChild childElementCount';
const childReads = 'previousElementSibling nextElementSibling';
const iteration = { keys: call([], { iterable: true }), values: call([], { iterable: true }), entries: call([], { iterable: true }) };
export const DOM_RECEIVER_POLICY: Record<string, Policy> = {
	Node: {
		reads:
			'nodeType nodeName baseURI isConnected ownerDocument parentNode parentElement childNodes firstChild lastChild previousSibling nextSibling nodeValue textContent ELEMENT_NODE ATTRIBUTE_NODE TEXT_NODE CDATA_SECTION_NODE ENTITY_REFERENCE_NODE ENTITY_NODE PROCESSING_INSTRUCTION_NODE COMMENT_NODE DOCUMENT_NODE DOCUMENT_TYPE_NODE DOCUMENT_FRAGMENT_NODE NOTATION_NODE DOCUMENT_POSITION_DISCONNECTED DOCUMENT_POSITION_PRECEDING DOCUMENT_POSITION_FOLLOWING DOCUMENT_POSITION_CONTAINS DOCUMENT_POSITION_CONTAINED_BY DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC',
		writes: 'nodeValue textContent',
		calls: {
			getRootNode: call(),
			hasChildNodes: call(),
			normalize: mutate(),
			cloneNode: mutate(['boolean'], { min: 0 }),
			isEqualNode: call(['nullable-node']),
			isSameNode: call(['nullable-node']),
			compareDocumentPosition: call(['node']),
			contains: call(['nullable-node']),
			lookupPrefix: call(['text']),
			lookupNamespaceURI: call(['text']),
			isDefaultNamespace: call(['text']),
			appendChild: mutate(['node']),
			insertBefore: mutate(['node', 'nullable-node']),
			removeChild: mutate(['node']),
			replaceChild: mutate(['node', 'node'])
		}
	},
	Document: {
		reads: `URL documentURI compatMode characterSet charset inputEncoding contentType doctype documentElement body head ${parentReads}`,
		calls: {
			...parentCalls,
			getElementById: call(['text']),
			getElementsByTagName: call(['text']),
			getElementsByClassName: call(['text']),
			createElement: mutate(['tag']),
			createTextNode: mutate(['text']),
			createComment: mutate(['text']),
			createDocumentFragment: mutate(),
			createAttribute: mutate(['attribute']),
			importNode: mutate(['node', 'boolean'], { min: 1 }),
			adoptNode: mutate(['node'])
		}
	},
	Element: {
		reads: `namespaceURI prefix localName tagName id className classList attributes innerHTML outerHTML ${parentReads} ${childReads}`,
		writes: 'id className',
		calls: {
			...parentCalls,
			...childCalls,
			matches: call(['selector']),
			closest: call(['selector']),
			getElementsByTagName: call(['text']),
			getElementsByClassName: call(['text']),
			hasAttributes: call(),
			getAttributeNames: call(),
			getAttribute: call(['text']),
			hasAttribute: call(['text']),
			setAttribute: mutate(['attribute', 'text']),
			removeAttribute: mutate(['attribute']),
			toggleAttribute: mutate(['attribute', 'boolean'], { min: 1 }),
			getAttributeNode: call(['text']),
			setAttributeNode: mutate(['node']),
			removeAttributeNode: mutate(['node']),
			insertAdjacentElement: mutate(['text', 'node']),
			insertAdjacentText: mutate(['text', 'text'])
		}
	},
	DocumentFragment: { reads: parentReads, calls: { ...parentCalls, getElementById: call(['text']) } },
	CharacterData: {
		reads: `data length ${childReads}`,
		writes: 'data',
		calls: {
			...childCalls,
			substringData: call(['number', 'number']),
			appendData: mutate(['text']),
			insertData: mutate(['number', 'text']),
			deleteData: mutate(['number', 'number']),
			replaceData: mutate(['number', 'number', 'text'])
		}
	},
	Text: { reads: 'wholeText', calls: { splitText: mutate(['number']) } },
	Comment: { reads: '' },
	DocumentType: { reads: `name publicId systemId ${childReads}` },
	Attr: { reads: 'namespaceURI prefix localName name value ownerElement specified', writes: 'value' },
	DOMTokenList: {
		reads: 'length value',
		writes: 'value',
		calls: {
			...iteration,
			item: call(['number']),
			contains: call(['text']),
			supports: call(['text']),
			add: mutate(['text'], { min: 0, rest: true }),
			remove: mutate(['text'], { min: 0, rest: true }),
			toggle: mutate(['text', 'boolean'], { min: 1 }),
			replace: mutate(['text', 'text'])
		}
	},
	NodeList: { reads: 'length', calls: { ...iteration, item: call(['number']) } },
	HTMLCollection: { reads: 'length', calls: { item: call(['number']), namedItem: call(['text']) } },
	NamedNodeMap: {
		reads: 'length',
		calls: { item: call(['number']), getNamedItem: call(['text']), setNamedItem: mutate(['node']), removeNamedItem: mutate(['attribute']) }
	}
};

const forbiddenTags = new Set('script style link meta base iframe frame frameset embed object svg math template'.split(' '));
function tag(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z][a-z0-9]{0,40}$/.test(value) || forbiddenTags.has(value))
		throw new Error('Use a local HTML element without an embedded resource or browsing context');
	return value;
}
function attribute(value: unknown): string {
	if (typeof value !== 'string' || !/^(id|class|title|lang|dir|hidden|role|tabindex|name|value|aria-[a-z-]+|data-[a-z0-9-]+)$/i.test(value))
		throw new Error('This attribute is not writable through DOM receivers');
	return value;
}

type Entry = { value: object; type: string };
type Captured = {
	prototype: object;
	reads: Map<string, PropertyDescriptor>;
	writes: Map<string, PropertyDescriptor>;
	calls: Map<string, { descriptor: PropertyDescriptor; policy: Method }>;
};
export function createPlatformDOMBridge(surface: Element) {
	const surfaceDocument = surface.ownerDocument;
	const realm = surfaceDocument.defaultView! as unknown as Record<string, { prototype: object }>;
	const doc = surfaceDocument.implementation.createHTMLDocument('Thingtime DOM program');
	const scope = surfaceDocument.defaultView!.crypto.randomUUID();
	const objects = new Map<string, Entry>();
	const ids = new WeakMap<object, string>();
	const allocated = new WeakSet<object>();
	let allocationCount = 0,
		requestCount = 0,
		work = 0,
		stopped = false;
	const captured = new Map<string, Captured>();
	for (const [name, policy] of Object.entries(DOM_RECEIVER_POLICY)) {
		const prototype = realm[name]?.prototype;
		if (!prototype) continue;
		const descriptors = (names: string) =>
			new Map(
				names
					.split(' ')
					.filter(Boolean)
					.flatMap((key) => {
						const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
						return descriptor ? [[key, descriptor] as const] : [];
					})
			);
		captured.set(name, {
			prototype,
			reads: descriptors(policy.reads),
			writes: descriptors(policy.writes || ''),
			calls: new Map(
				Object.entries(policy.calls || {}).flatMap(([key, policy]) => {
					const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
					return typeof descriptor?.value === 'function' ? [[key, { descriptor, policy }] as const] : [];
				})
			)
		});
	}
	const belongs = (value: object, name: string) => {
		const proto = captured.get(name)?.prototype;
		return !!proto && Object.prototype.isPrototypeOf.call(proto, value);
	};
	// HTMLFormElement named controls override built-ins (including childNodes).
	// Policy checks must read the actual tree through captured accessors, just
	// like authored member requests, never through instance property lookups.
	const reader = <T>(name: string, key: string) => {
		const getter = captured.get(name)?.reads.get(key)?.get;
		if (!getter) throw new Error(`Missing native DOM accessor ${name}.${key}`);
		return (target: object): T => Reflect.apply(getter, target, []);
	};
	const method = <T>(name: string, key: string) => {
		const fn = captured.get(name)?.calls.get(key)?.descriptor.value;
		if (typeof fn !== 'function') throw new Error(`Missing native DOM method ${name}.${key}`);
		return (target: object, ...args: unknown[]): T => Reflect.apply(fn, target, args);
	};
	const ownerDocument = reader<Document | null>('Node', 'ownerDocument');
	const nodeType = reader<number>('Node', 'nodeType');
	const childNodes = reader<NodeListOf<ChildNode>>('Node', 'childNodes');
	const textContent = reader<string | null>('Node', 'textContent');
	const localName = reader<string>('Element', 'localName');
	const attributes = reader<NamedNodeMap>('Element', 'attributes');
	const attrName = reader<string>('Attr', 'name');
	const attrValue = reader<string>('Attr', 'value');
	const body = reader<HTMLElement | null>('Document', 'body');
	const rootNode = method<Node>('Node', 'getRootNode');
	const importNode = method<Node>('Document', 'importNode');
	const appendChild = method<Node>('Node', 'appendChild');
	const replaceChildren = method<void>('Element', 'replaceChildren');
	const inspectTree = (node: Node, depth = 0) => {
		if (depth > 40) throw new Error('DOM tree exceeds its depth budget');
		if (!allocated.has(node)) {
			allocated.add(node);
			if (++allocationCount > 600) throw new Error('DOM node allocation budget exceeded');
		}
		if (node !== doc && ownerDocument(node) !== doc) throw new Error('DOM receiver belongs to another document');
		if (nodeType(node) === 1) {
			tag(localName(node));
			// Initial authored documents use the existing renderer policy. Receiver
			// writes use the narrower attribute policy above; verify every projection.
			for (const attr of Array.from(attributes(node))) {
				const name = attrName(attr).toLowerCase();
				if (/^on/.test(name) || ['srcdoc', 'is', 'nonce', 'action', 'formaction', 'ping', 'pattern', 'autofocus'].includes(name))
					throw new Error('Executable DOM attributes are unavailable');
				if (['src', 'href', 'poster', 'data'].includes(name) && !/^#|^data:image\/(png|jpeg|gif|webp);base64,/.test(attrValue(attr)))
					throw new Error('Use local demo resources');
			}
		}
		const text = textContent(node);
		if (text && text.length > 32768) throw new Error('DOM text budget exceeded');
		for (const child of Array.from(childNodes(node))) inspectTree(child, depth + 1);
	};
	for (const child of Array.from(childNodes(surface))) appendChild(body(doc)!, importNode(doc, child, true));
	inspectTree(doc);
	const publish = () => {
		inspectTree(doc);
		// Keep scripts, styles and runtime scaffolding outside the projected tree.
		const documentBody = body(doc);
		replaceChildren(surface, ...Array.from(documentBody ? childNodes(documentBody) : []).map((node) => importNode(surfaceDocument, node, true)));
	};
	const encode = (value: unknown, depth = 0): unknown => {
		if (depth > 8) throw new Error('DOM result exceeds its depth budget');
		if (value === undefined) return undefined;
		if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
		if (typeof value === 'string') {
			if (value.length > 32768) throw new Error('DOM result exceeds its text budget');
			return value;
		}
		if (Array.isArray(value)) {
			if (value.length > 600) throw new Error('DOM result exceeds its item budget');
			return value.map((item) => encode(item, depth + 1));
		}
		if (!value || typeof value !== 'object') throw new Error('This DOM result is not exposed');
		let type: string | undefined;
		// Most specific interface first; CharacterData/Node describe base types.
		for (const name of [
			'Document',
			'Element',
			'DocumentFragment',
			'Text',
			'Comment',
			'DocumentType',
			'Attr',
			'DOMTokenList',
			'NodeList',
			'HTMLCollection',
			'NamedNodeMap'
		])
			if (belongs(value, name)) {
				type = name;
				break;
			}
		if (!type) throw new Error('This DOM receiver type is not exposed');
		if (belongs(value, 'Node')) inspectTree(value as Node);
		let id = ids.get(value);
		if (!id) {
			if (objects.size >= 800) throw new Error('DOM handle budget exceeded');
			id = `${scope}:${objects.size + 1}`;
			ids.set(value, id);
			objects.set(id, { value, type });
		}
		return { $dom: id, type };
	};
	const receiver = (raw: unknown): Entry => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected a DOM receiver handle');
		const handle = raw as { $dom?: unknown; type?: unknown };
		if (Object.keys(handle).length !== 2 || typeof handle.$dom !== 'string' || handle.$dom.length > 100) throw new Error('Invalid DOM handle');
		const entry = objects.get(handle.$dom);
		if (!entry || handle.type !== entry.type) throw new Error('DOM handle is stale or belongs to another run');
		return entry;
	};
	const argument = (value: unknown, rule: Arg): unknown => {
		if (rule === 'nullable-node' && value === null) return null;
		if (['node', 'nullable-node', 'node-or-text'].includes(rule) && typeof value !== 'string') {
			const node = receiver(value).value;
			if (!belongs(node, 'Node')) throw new Error('Expected a node handle');
			if (belongs(node, 'Attr')) attribute(attrName(node));
			return node;
		}
		if (rule === 'number') {
			if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > 32768) throw new Error('Use a bounded integer DOM argument');
			return value;
		}
		if (rule === 'boolean') {
			if (typeof value !== 'boolean') throw new Error('Expected a boolean DOM argument');
			return value;
		}
		if (typeof value !== 'string' || value.length > (rule === 'selector' ? 500 : 4096)) throw new Error('Expected bounded DOM text');
		if (rule === 'node' || rule === 'nullable-node') throw new Error('Expected a node handle');
		if (rule === 'tag') return tag(value);
		if (rule === 'attribute') return attribute(value);
		return value;
	};
	return {
		stop: () => {
			stopped = true;
			objects.clear();
		},
		request: (raw: unknown): { value?: unknown; error?: { name: string; message: string } } => {
			if (stopped) throw new Error('DOM run has ended');
			if (++requestCount > 256) throw new Error('DOM request budget exceeded');
			if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 6) throw new Error('Invalid DOM request');
			const request = raw as { type: string; id: number; action: string; target: unknown; key: string; args: unknown[] };
			if (
				request.type !== 'tt-platform-dom' ||
				!Number.isSafeInteger(request.id) ||
				request.id !== requestCount ||
				!['document', 'get', 'set', 'call'].includes(request.action) ||
				typeof request.key !== 'string' ||
				request.key.length > 60 ||
				!Array.isArray(request.args) ||
				request.args.length > 8
			)
				throw new Error('Invalid DOM request envelope');
			if (request.action === 'document') {
				if (request.target !== null || request.key || request.args.length) throw new Error('Invalid document request');
				return { value: encode(doc) };
			}
			const target = receiver(request.target).value;
			let descriptor: PropertyDescriptor | undefined,
				policy: Method | undefined,
				registered = false;
			for (const [name, candidate] of captured) {
				if (!Object.prototype.isPrototypeOf.call(candidate.prototype, target)) continue;
				const registeredPolicy = DOM_RECEIVER_POLICY[name];
				registered ||=
					request.action === 'call'
						? Object.prototype.hasOwnProperty.call(registeredPolicy.calls || {}, request.key)
						: (request.action === 'get' ? registeredPolicy.reads : registeredPolicy.writes || '').split(' ').includes(request.key);
				if (request.action === 'call') {
					const method = candidate.calls.get(request.key);
					if (method) {
						({ descriptor, policy } = method);
						break;
					}
				} else {
					descriptor = (request.action === 'get' ? candidate.reads : candidate.writes).get(request.key);
					if (descriptor) break;
				}
			}
			if (!descriptor) {
				if (registered) return { error: { name: 'UnsupportedDOMMember', message: `This browser does not expose DOM member ${request.key}` } };
				throw new Error(`DOM member ${request.key} is not registered for this receiver`);
			}
			const rules = policy?.args || (request.action === 'set' ? (['text'] as Arg[]) : []);
			const min = policy?.min ?? rules.length;
			if (request.args.length < min || (!policy?.rest && request.args.length > rules.length)) throw new Error('Invalid DOM argument count');
			const args = request.args.map((value, index) => argument(value, rules[Math.min(index, rules.length - 1)]));
			if (request.action === 'set' && belongs(target, 'Attr')) attribute(attrName(target));
			work += args.reduce<number>((sum, value) => sum + (typeof value === 'string' ? value.length : 1), 0);
			if (work > 65536) throw new Error('DOM input work budget exceeded');
			let result: unknown;
			try {
				if (request.action === 'get') result = descriptor.get ? descriptor.get.call(target) : descriptor.value;
				else if (request.action === 'set') {
					if (!descriptor.set) throw new Error('DOM property is read-only');
					descriptor.set.call(target, args[0]);
					result = args[0];
				} else result = descriptor.value.apply(target, args);
			} catch (error) {
				// Actual DOM errors remain catchable in authored worker programs.
				return {
					error: { name: error instanceof Error ? error.name : 'DOMException', message: String((error as Error)?.message || error).slice(0, 500) }
				};
			}
			if (policy?.iterable) result = Array.from(result as Iterable<unknown>);
			const value = encode(result);
			if (policy?.mutates || request.action === 'set') {
				if (belongs(target, 'Node')) inspectTree(rootNode(target));
				publish();
			}
			return { value };
		}
	};
}
