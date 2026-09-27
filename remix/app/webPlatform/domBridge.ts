import {
	ANIMATION_CONSTRUCTORS,
	ANIMATION_ELEMENT_CALLS,
	ANIMATION_GLOBALS,
	ANIMATION_STATIC,
	ANIMATION_RECEIVER_POLICY,
	type AnimationArg
} from './animationPolicy';
import { animationArgument, animationRecord, ANIMATION_LIMITS } from './animationSupport';
import { RANGE_CONSTRUCTORS, RANGE_RECEIVER_POLICY, RANGE_INITIALIZERS, type RangeArg } from './rangePolicy';
import { rangeHTML, rangeInit } from './rangeSupport';
import { OBSERVER_CONSTRUCTORS, OBSERVER_RECEIVER_POLICY, type ObserverArg } from './observerPolicy';
import { observerArgument, OBSERVER_LIMITS } from './observerSupport';
import type { DOMCallback } from './workerLifecycle';
import { LAYOUT_RECEIVER_POLICY, LAYOUT_ELEMENT, LAYOUT_CONSTRUCTORS, LAYOUT_STATIC, LAYOUT_GLOBALS, type LayoutArg } from './layoutPolicy';
import { layoutArgument, layoutQuadJSON, layoutScrollResult } from './layoutSupport';
import { CSSOM_RECEIVER_POLICY, CSSOM_CONSTRUCTORS, CSSOM_STATIC, CSSOM_PROPERTIES, type CSSOMArg } from './cssomPolicy';
import { cssomArgument, cssomText, CSSOM_LIMITS } from './cssomSupport';
import { TYPED_CSS_RECEIVER_POLICY, TYPED_CSS_CONSTRUCTORS, TYPED_CSS_STATIC, type TypedCSSArg } from './typedCSSPolicy';
import { typedCSSArgument, typedCSSArguments, typedCSSNumericType, TYPED_CSS_LIMITS } from './typedCSSSupport';
import { SVG_FILTER_TAGS, svgFilterValue, svgFilterNumbers } from './svgFilterSupport';
/** Real DOM receivers for data programs. Only this module runs DOM operations
 * on the frame thread; authored JavaScript remains in the terminable worker.
 * Programs choose a detached document or their rendered surface. Surface
 * receivers permit Canvas writes and bounded tree reads, never a handle to the
 * runtime document or to connected nodes outside the program root. */
import { SVG_RECEIVER_POLICY, SVG_LIST_TYPES } from './svgPolicy';
import { SVG_NAMESPACE, SVG_LIMITS, svgTag, svgAttribute, svgArgument } from './svgSupport';
import { HTML_FORM_RECEIVER_POLICY } from './htmlFormPolicy';
import { CANVAS_RECEIVER_POLICY } from './canvasPolicy';
import { canvasArgument, canvasContextAttributes, CANVAS_LIMITS } from './canvasSupport';
export type Arg =
	| AnimationArg
	| RangeArg
	| ObserverArg
	| LayoutArg
	| CSSOMArg
	| TypedCSSArg
	| 'svg-matrix'
	| 'svg-number'
	| 'svg-text'
	| 'svg-filter-image'
	| 'svg-unit'
	| 'svg-fragment'
	| 'svg-point'
	| 'svg-box-options'
	| 'svg-length'
	| 'svg-angle'
	| 'svg-number-value'
	| 'svg-point-value'
	| 'svg-transform'
	| 'svg-rect'
	| 'svg-element'
	| 'svg-nullable-element'
	| 'canvas-size'
	| 'pixel-size'
	| 'canvas-blur'
	| 'canvas-context'
	| 'canvas-settings'
	| 'pixel-settings'
	| 'canvas-style'
	| 'canvas-filter'
	| 'canvas-font'
	| 'canvas-matrix'
	| 'canvas-dash'
	| 'canvas-radii'
	| 'canvas-source'
	| 'canvas-path'
	| 'canvas-image-data'
	| 'canvas-fill'
	| 'text'
	| 'selector'
	| 'tag'
	| 'attribute'
	| 'number'
	| 'finite'
	| 'allocation-length'
	| 'boolean'
	| 'node'
	| 'nullable-node'
	| 'node-or-text'
	| 'node-or-index';
type Method = { args: Arg[]; overloads?: Arg[][]; min?: number; rest?: boolean; mutates?: boolean; iterable?: boolean; awaitResult?: boolean };
export type Policy = { reads: string; writes?: string; writeArgs?: Record<string, Arg>; calls?: Record<string, Method> };
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
	...OBSERVER_RECEIVER_POLICY,
	...HTML_FORM_RECEIVER_POLICY,
	...CANVAS_RECEIVER_POLICY,
	...SVG_RECEIVER_POLICY,
	...TYPED_CSS_RECEIVER_POLICY,
	...CSSOM_RECEIVER_POLICY,
	...LAYOUT_RECEIVER_POLICY,
	...RANGE_RECEIVER_POLICY,
	...ANIMATION_RECEIVER_POLICY,
	ShadowRoot: { ...CSSOM_RECEIVER_POLICY.ShadowRoot, calls: { ...CSSOM_RECEIVER_POLICY.ShadowRoot.calls, ...ANIMATION_STATIC.Document } },
	DOMMatrix: { ...SVG_RECEIVER_POLICY.DOMMatrix, calls: { ...SVG_RECEIVER_POLICY.DOMMatrix.calls, setMatrixValue: call(['css-text']) } },
	HTMLElement: { reads: 'attributeStyleMap style offsetHeight offsetLeft offsetParent offsetTop offsetWidth scrollParent' },
	SVGElement: { ...SVG_RECEIVER_POLICY.SVGElement, reads: SVG_RECEIVER_POLICY.SVGElement.reads + ' attributeStyleMap style' },
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
		reads: `URL documentURI compatMode characterSet charset inputEncoding contentType doctype documentElement body head styleSheets ${parentReads}`,
		calls: {
			...parentCalls,
			getElementById: call(['text']),
			getElementsByTagName: call(['text']),
			getElementsByClassName: call(['text']),
			createElement: mutate(['tag']),
			createTextNode: mutate(['text']),
			createComment: mutate(['text']),
			createDocumentFragment: mutate(),
			createRange: call(),
			createAttribute: mutate(['attribute']),
			importNode: mutate(['node', 'boolean'], { min: 1 }),
			adoptNode: mutate(['node'])
		}
	},
	Element: {
		reads: `namespaceURI prefix localName tagName id className classList attributes innerHTML outerHTML shadowRoot ${parentReads} ${childReads} ${LAYOUT_ELEMENT.reads}`,
		writes: 'id className ' + LAYOUT_ELEMENT.writes,
		writeArgs: LAYOUT_ELEMENT.writeArgs,
		calls: {
			...LAYOUT_ELEMENT.calls,
			...ANIMATION_ELEMENT_CALLS,
			...parentCalls,
			computedStyleMap: call(),
			attachShadow: call(['cssom-shadow'], { mutates: true }),
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

const forbiddenTags = new Set('script link meta base iframe frame frameset embed object svg math template'.split(' '));
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
export function createPlatformDOMBridge(surface: Element, deliverCallback?: DOMCallback) {
	const surfaceDocument = surface.ownerDocument;
	const realm = surfaceDocument.defaultView! as unknown as Record<string, { prototype: object }>;
	const doc = surfaceDocument.implementation.createHTMLDocument('Thingtime DOM program');
	let context: 'detached' | 'surface' | undefined;
	const scope = surfaceDocument.defaultView!.crypto.randomUUID();
	const objects = new Map<string, Entry>();
	const shadowRoots = new Set<ShadowRoot>();
	const constructors = {
		...TYPED_CSS_CONSTRUCTORS,
		...CSSOM_CONSTRUCTORS,
		...LAYOUT_CONSTRUCTORS,
		...OBSERVER_CONSTRUCTORS,
		...RANGE_CONSTRUCTORS,
		...ANIMATION_CONSTRUCTORS
	};
	const animations = new Set<object>();
	const animationObjects = new WeakSet<object>();
	const callbackTokens = new WeakMap<object, unknown>();
	let animationCount = 0;
	const globals = { ...LAYOUT_GLOBALS, Document: LAYOUT_GLOBALS.Document + ' ' + ANIMATION_GLOBALS.Document };
	const observers = new Map<object, { type: string; targets: Set<object> }>();
	let callbackCount = 0;
	const statics = {
		...TYPED_CSS_STATIC,
		...CSSOM_STATIC,
		...LAYOUT_STATIC,
		Document: { ...LAYOUT_STATIC.Document, ...ANIMATION_STATIC.Document },
		Window: { ...CSSOM_STATIC.Window, ...LAYOUT_STATIC.Window },
		CSS: { ...TYPED_CSS_STATIC.CSS, ...CSSOM_STATIC.CSS }
	};
	const cssCosts = new WeakMap<object, number>();
	let cssWork = 0;
	const cssCost = (value: unknown, depth = 0): number => {
		if (depth > 8) throw new Error('CSS argument depth budget exceeded');
		if (Array.isArray(value)) return value.reduce((n, item) => n + cssCost(item, depth + 1), 1);
		if (value && typeof value === 'object') {
			const id = (value as { $dom?: string }).$dom;
			if (id) return cssCosts.get(objects.get(id)?.value || {}) || 1;
		}
		if (typeof value === 'string') {
			// Operators inside numeric CSS can expand on toSum(). Ordinary text,
			// including local image URLs, must not be mistaken for arithmetic.
			const numericText = /(?:calc|min|max|clamp)\(/i.test(value);
			return Math.max(1, Math.ceil(value.length / 32), numericText ? 2 ** (value.match(/[+*/]/g)?.length || 0) : 1);
		}
		return 1;
	};
	const reserveCSS = (args: unknown[], target?: object, expands = false) => {
		const initial = 1 + (target ? cssCosts.get(target) || 1 : 0);
		const cost = args.reduce<number>((n, value) => (expands ? n * (1 + cssCost(value)) : n + cssCost(value)), initial);
		cssWork += cost;
		if (cost > TYPED_CSS_LIMITS.complexity || cssWork > TYPED_CSS_LIMITS.totalComplexity)
			throw new Error('CSS expression complexity budget exceeded');
		return cost;
	};
	const ids = new WeakMap<object, string>();
	const owners = new WeakMap<object, Node>();
	const valueKeys = new WeakMap<object, string>();
	const allocated = new WeakSet<object>();
	const canvases = new Set<HTMLCanvasElement>();
	const pathCosts = new WeakMap<object, number>();
	let pathWork = 0;
	const reservePath = (target: object, added: number) => {
		const cost = (pathCosts.get(target) || 0) + added;
		pathWork += added;
		if (cost > 4096 || pathWork > 16384) throw new Error('Canvas path complexity budget exceeded');
		pathCosts.set(target, cost);
	};
	let allocationCount = 0,
		requestCount = 0,
		messageCount = 0,
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
						// WebIDL mixins may insert unnamed native prototype layers (for
						// example Range's node-valued accessors). Capture only registered
						// names from the native chain; never inspect receiver instances.
						let descriptor: PropertyDescriptor | undefined;
						for (let proto: object | null = prototype; proto && !descriptor; proto = Object.getPrototypeOf(proto))
							descriptor = Object.getOwnPropertyDescriptor(proto, key);
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
	// Resolve overrides such as HTMLSelectElement.remove before Element.remove.
	const prototypeDepth = (value: object): number => {
		let depth = 0;
		for (let proto = Object.getPrototypeOf(value); proto; proto = Object.getPrototypeOf(proto)) depth++;
		return depth;
	};
	const resolutionOrder = [...captured].sort(([, a], [, b]) => prototypeDepth(b.prototype) - prototypeDepth(a.prototype));
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
	const connected = reader<boolean>('Node', 'isConnected');
	const contains = method<boolean>('Node', 'contains');
	const childNodes = reader<NodeListOf<ChildNode>>('Node', 'childNodes');
	const textContent = reader<string | null>('Node', 'textContent');
	const localName = reader<string>('Element', 'localName');
	const namespace = reader<string>('Element', 'namespaceURI');
	const attributes = reader<NamedNodeMap>('Element', 'attributes');
	const attrName = reader<string>('Attr', 'name');
	const attrValue = reader<string>('Attr', 'value');
	const body = reader<HTMLElement | null>('Document', 'body');
	const rootNode = method<Node>('Node', 'getRootNode');
	const importNode = method<Node>('Document', 'importNode');
	const appendChild = method<Node>('Node', 'appendChild');
	const replaceChildren = method<void>('Element', 'replaceChildren');
	const cssRuleCount = (container: object, depth = 0): number => {
		if (depth > CSSOM_LIMITS.depth) throw new Error('CSSOM rule depth budget exceeded');
		const rules = reader<CSSRuleList>(belongs(container, 'CSSStyleSheet') ? 'CSSStyleSheet' : 'CSSGroupingRule', 'cssRules')(container);
		const length = reader<number>('CSSRuleList', 'length')(rules);
		if (length > CSSOM_LIMITS.rules) throw new Error('CSSOM rule budget exceeded');
		let count = length;
		for (let i = 0; i < length; i++) {
			const rule = method<CSSRule>('CSSRuleList', 'item')(rules, i);
			if (belongs(rule, 'CSSGroupingRule')) count += cssRuleCount(rule, depth + 1);
			if (count > CSSOM_LIMITS.rules) throw new Error('CSSOM rule budget exceeded');
		}
		return count;
	};
	const insideSurface = (node: Node): boolean => {
		if (contains(surface, node)) return true;
		const root = rootNode(node);
		return shadowRoots.has(root as ShadowRoot) && contains(surface, reader<Node>('ShadowRoot', 'host')(root));
	};
	const inspectTree = (node: Node, depth = 0) => {
		if (depth > 40) throw new Error('DOM tree exceeds its depth budget');
		if (!allocated.has(node)) {
			allocated.add(node);
			if (++allocationCount > 600) throw new Error('DOM node allocation budget exceeded');
		}
		if (context === 'surface') {
			if (node === surfaceDocument || ownerDocument(node) !== surfaceDocument || (connected(node) && !insideSurface(node)))
				throw new Error('DOM receiver is outside this program surface');
		} else if (node !== doc && ownerDocument(node) !== doc) throw new Error('DOM receiver belongs to another document');
		if (belongs(node, 'HTMLCanvasElement')) {
			const canvas = node as HTMLCanvasElement;
			canvasArgument(reader<number>('HTMLCanvasElement', 'width')(canvas), 'canvas-size', () => {
				throw new Error('No handle');
			});
			canvasArgument(reader<number>('HTMLCanvasElement', 'height')(canvas), 'canvas-size', () => {
				throw new Error('No handle');
			});
			canvases.add(canvas);
			if (canvases.size > CANVAS_LIMITS.canvases) throw new Error('Canvas allocation budget exceeded');
		}
		if (belongs(node, 'SVGSVGElement'))
			for (const key of ['width', 'height']) {
				const animated = reader<object>('SVGSVGElement', key)(node);
				const length = reader<object>('SVGAnimatedLength', 'baseVal')(animated);
				const value = reader<number>('SVGLength', 'value')(length);
				if (!Number.isFinite(value) || value < 0 || value > SVG_LIMITS.edge) throw new Error('SVG viewport exceeds its dimension limit');
			}

		if (belongs(node, 'HTMLStyleElement')) {
			cssomText(textContent(node) || '');
			const sheet = reader<CSSStyleSheet | null>('HTMLStyleElement', 'sheet')(node);
			if (sheet) cssRuleCount(sheet);
		}
		if (nodeType(node) === 1) {
			const svg = namespace(node) === SVG_NAMESPACE;
			if (svg) {
				if (context !== 'surface') throw new Error('SVG receivers require the active surface context');
				svgTag(localName(node));
			} else tag(localName(node));
			// Initial authored documents use the existing renderer policy. Receiver
			// writes use the narrower attribute policy above; verify every projection.
			for (const attr of Array.from(attributes(node))) {
				const name = attrName(attr).toLowerCase();
				if (svg) svgAttribute(localName(node), attrName(attr), attrValue(attr), true);
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

	const publish = () => {
		inspectTree(doc);
		// Active-surface programs draw directly; detached programs retain their
		// inert tree projection and never acquire an active document handle.
		const documentBody = body(doc);
		replaceChildren(surface, ...Array.from(documentBody ? childNodes(documentBody) : []).map((node) => importNode(surfaceDocument, node, true)));
	};
	const inspectRange = (range: object) => {
		// Chromium puts these accessors on an unnamed prototype between Range
		// and AbstractRange. Capture from the concrete native receiver chain.
		const type = belongs(range, 'Range') ? 'Range' : 'StaticRange';
		for (const key of ['startContainer', 'endContainer']) inspectTree(reader<Node>(type, key)(range));
	};
	const inspectAnimation = (value: object) => {
		if (belongs(value, 'Animation')) {
			const effect = reader<object | null>('Animation', 'effect')(value);
			if (effect) inspectAnimation(effect);
		} else if (belongs(value, 'KeyframeEffect')) {
			const target = reader<Node | null>('KeyframeEffect', 'target')(value);
			if (target) inspectTree(target);
		}
	};
	const unsupportedAnimationOptions = (options: unknown) =>
		options &&
		typeof options === 'object' &&
		Object.prototype.hasOwnProperty.call(options, 'iterationComposite') &&
		!captured.get('KeyframeEffect')?.reads.has('iterationComposite')
			? { error: { name: 'UnsupportedDOMMember', message: 'This browser does not expose KeyframeEffect.iterationComposite' } }
			: undefined;
	const trackAnimation = (value: object) => {
		inspectAnimation(value);
		if (!animationObjects.has(value)) {
			if (++animationCount > ANIMATION_LIMITS.objects) throw new Error('Animation allocation budget exceeded');
			animationObjects.add(value);
		}
		if (belongs(value, 'Animation') && !animations.has(value)) {
			animations.add(value);
			// Observe rejection without changing the promise returned to authored code.
			reader<Promise<unknown>>('Animation', 'finished')(value).catch(() => {});
		}
	};
	const encode = (value: unknown, depth = 0): unknown => {
		if (depth > 8) throw new Error('DOM result exceeds its depth budget');
		if (value === undefined) return undefined;
		if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
		if (typeof value === 'string') {
			if (value.length > 32768) throw new Error('DOM result exceeds its text budget');
			return value;
		}
		if (ArrayBuffer.isView(value)) {
			if (!(value instanceof Uint8ClampedArray) && value.constructor.name !== 'Float16Array') throw new Error('Unregistered pixel array');
			const pixels = value as unknown as ArrayLike<number>;
			if (pixels.length > CANVAS_LIMITS.pixelValues) throw new Error('Pixel result budget exceeded');
			return Array.from(pixels);
		}
		if (Array.isArray(value)) {
			if (value.length > 600) throw new Error('DOM result exceeds its item budget');
			return value.map((item) => encode(item, depth + 1));
		}
		if (typeof value === 'function' && callbackTokens.has(value)) return callbackTokens.get(value);
		if (!value || typeof value !== 'object') throw new Error('This DOM result is not exposed');
		let type: string | undefined;
		// Most specific interface first; CharacterData/Node describe base types.
		for (const name of [
			...Object.keys(ANIMATION_RECEIVER_POLICY),
			...Object.keys(RANGE_RECEIVER_POLICY),
			...Object.keys(OBSERVER_RECEIVER_POLICY),
			...Object.keys(LAYOUT_RECEIVER_POLICY),
			...Object.keys(CSSOM_RECEIVER_POLICY),
			...Object.keys(TYPED_CSS_RECEIVER_POLICY),
			...Object.keys(HTML_FORM_RECEIVER_POLICY),
			...Object.keys(CANVAS_RECEIVER_POLICY),
			...Object.keys(SVG_RECEIVER_POLICY),
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
		if (!type) throw new Error('This DOM receiver type is not exposed: ' + Object.prototype.toString.call(value));
		if (belongs(value, 'Node')) inspectTree(value as Node);
		if (belongs(value, 'Animation') || belongs(value, 'AnimationEffect')) trackAnimation(value);
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
	const receiverType = (value: unknown, types: string): object => {
		const target = receiver(value).value;
		if (!types.split('|').some((type) => belongs(target, type))) throw new Error('Wrong Canvas receiver type');
		return target;
	};
	const argument = (value: unknown, rule: Arg): unknown => {
		if (rule === 'range-html') return rangeHTML(value);
		if (rule === 'range-init')
			return rangeInit(
				value,
				(raw) => argument(raw, 'range-node') as object,
				(raw) => argument(raw, 'number')
			);
		if (rule === 'range-receiver') {
			const range = receiverType(value, 'Range');
			inspectRange(range);
			return range;
		}
		if (rule === 'range-node' || rule === 'range-relative-node') {
			const node = receiverType(value, 'Node');
			inspectTree(node as Node);
			// Relative boundary setters select the node's parent. In surface mode
			// this must never turn the program root into a range on the runtime UI.
			if (rule === 'range-relative-node') {
				const parent = reader<Node | null>('Node', 'parentNode')(node);
				if (parent) inspectTree(parent);
			}
			return node;
		}
		if (rule === 'animation-callback' && value === null) return null;
		if (rule === 'observer-callback' || rule === 'animation-callback') {
			const token = value as { $callback?: number };
			if (
				!deliverCallback ||
				!value ||
				typeof value !== 'object' ||
				Array.isArray(value) ||
				Object.keys(value).length !== 1 ||
				!Object.prototype.hasOwnProperty.call(value, '$callback') ||
				!Number.isSafeInteger(token.$callback) ||
				token.$callback! < 1 ||
				token.$callback! > 32
			)
				throw new Error('Expected a registered worker callback');
			const callback = function (this: object, records: unknown[], observer: object) {
				if (stopped) return;
				try {
					if (++callbackCount > OBSERVER_LIMITS.callbacks || (rule === 'observer-callback' && records.length > OBSERVER_LIMITS.records))
						throw new Error('Observer callback budget exceeded');
					deliverCallback(
						token.$callback!,
						encode(rule === 'animation-callback' ? [records] : [records, observer]) as unknown[],
						undefined,
						rule === 'animation-callback' ? encode(this) : undefined
					);
				} catch (error) {
					deliverCallback(token.$callback!, [], String((error as Error).message).slice(0, 500));
				}
			};
			callbackTokens.set(callback, value);
			return callback;
		}
		if (rule.startsWith('animation-'))
			return animationArgument(value, rule, (raw, types) => {
				const target = receiverType(raw, types);
				if (belongs(target, 'Node')) inspectTree(target as Node);
				else inspectAnimation(target);
				return target;
			});
		if (rule.startsWith('observer-'))
			return observerArgument(value, rule, (raw, types) => {
				const target = receiverType(raw, types);
				inspectTree(target as Node);
				return target;
			});
		if (rule.startsWith('layout-')) return layoutArgument(value, rule, receiverType);
		if (rule.startsWith('cssom-')) return cssomArgument(value, rule, receiverType);
		if (rule.startsWith('css-')) return typedCSSArgument(value, rule, receiverType);
		if (rule.startsWith('svg-')) return svgArgument(value, rule, receiverType);
		if (rule.startsWith('canvas-') || rule.startsWith('pixel-')) return canvasArgument(value, rule, receiverType);
		if (rule === 'nullable-node' && value === null) return null;
		if (rule === 'node-or-index') {
			if (value === null) return null;
			rule = typeof value === 'number' ? 'number' : 'node';
		}
		if (['node', 'nullable-node', 'node-or-text'].includes(rule) && typeof value !== 'string') {
			const node = receiver(value).value;
			if (!belongs(node, 'Node')) throw new Error('Expected a node handle');
			if (belongs(node, 'Attr')) attribute(attrName(node));
			return node;
		}
		if (rule === 'number' || rule === 'finite' || rule === 'allocation-length') {
			if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 32768 || (rule !== 'finite' && !Number.isSafeInteger(value)))
				throw new Error('Use a bounded numeric DOM argument');
			if (rule === 'allocation-length' && (value < 0 || value > 300)) throw new Error('DOM collection length exceeds its allocation limit');
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
	const bridge = {
		stop: () => {
			stopped = true;
			for (const animation of animations) {
				reader<Promise<unknown>>('Animation', 'finished')(animation).catch(() => {});
				method<void>('Animation', 'cancel')(animation);
			}
			animations.clear();
			for (const [observer, { type }] of observers) method<void>(type, 'disconnect')(observer);
			observers.clear();
			objects.clear();
			if (context !== 'surface') for (const canvas of canvases) canvas.width = 0;
			canvases.clear();
		},
		request: function execute(
			raw: unknown,
			nested = false
		): { value?: unknown; error?: { name: string; message: string } } | Promise<{ value?: unknown; error?: { name: string; message: string } }> {
			if (stopped) throw new Error('DOM run has ended');
			if (++requestCount > 256) throw new Error('DOM request budget exceeded');
			if (!nested) messageCount++;
			if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 6) throw new Error('Invalid DOM request');
			const request = raw as { type: string; id: number; action: string; target: unknown; key: string; args: unknown[] };
			if (
				request.type !== 'tt-platform-dom' ||
				!Number.isSafeInteger(request.id) ||
				request.id !== messageCount ||
				!['document', 'surface', 'get', 'set', 'call', 'construct', 'constant', 'static', 'global', 'batch'].includes(request.action) ||
				typeof request.key !== 'string' ||
				request.key.length > 60 ||
				!Array.isArray(request.args) ||
				request.args.length > 9
			)
				throw new Error('Invalid DOM request envelope');
			if (request.action === 'batch') {
				if (
					nested ||
					request.target !== null ||
					request.key ||
					request.args.length !== 1 ||
					!Array.isArray(request.args[0]) ||
					!request.args[0].length ||
					request.args[0].length > 16
				)
					throw new Error('Expected a bounded synchronous DOM batch');
				const values: unknown[] = [];
				for (const command of request.args[0]) {
					if (
						!command ||
						typeof command !== 'object' ||
						Array.isArray(command) ||
						Object.keys(command).sort().join(',') !== 'action,args,key,target' ||
						!['get', 'set', 'call'].includes(command.action)
					)
						throw new Error('Only synchronous member operations are allowed in a DOM batch');
					const result = execute({ ...command, type: 'tt-platform-dom', id: messageCount }, true);
					if (result instanceof Promise) throw new Error('Asynchronous DOM operations cannot run in a synchronous batch');
					if (result.error) return result;
					values.push(result.value);
				}
				return { value: values };
			}
			if (request.action === 'document' || request.action === 'surface') {
				if (request.target !== null || request.key || request.args.length) throw new Error('Invalid document request');
				const selected = request.action === 'surface' ? 'surface' : 'detached';
				if (context && context !== selected) throw new Error('Choose one DOM document context per run');
				if (!context) {
					context = selected;
					if (context === 'detached') for (const child of Array.from(childNodes(surface))) appendChild(body(doc)!, importNode(doc, child, true));
				}
				return { value: encode(context === 'surface' ? surface : doc) };
			}
			if (request.action === 'constant') {
				const name = request.target;
				if (
					typeof name !== 'string' ||
					request.args.length ||
					!/^[A-Z][A-Z0-9_]{0,59}$/.test(request.key) ||
					!Object.prototype.hasOwnProperty.call(DOM_RECEIVER_POLICY, name) ||
					!DOM_RECEIVER_POLICY[name].reads.split(' ').includes(request.key)
				)
					throw new Error('Unregistered DOM constant');
				const descriptor = captured.get(name)?.reads.get(request.key);
				if (!descriptor) return { error: { name: 'UnsupportedDOMMember', message: `This browser does not expose ${name}.${request.key}` } };
				if (!('value' in descriptor) || !['string', 'number', 'boolean'].includes(typeof descriptor.value))
					throw new Error('Expected a primitive DOM constant');
				return { value: encode(descriptor.value) };
			}
			if (request.action === 'global') {
				const name = request.target;
				if (
					context !== 'surface' ||
					typeof name !== 'string' ||
					!Object.prototype.hasOwnProperty.call(globals, name) ||
					!globals[name].split(' ').includes(request.key) ||
					request.args.length
				)
					throw new Error('Unregistered layout global read');
				const owner = name === 'Window' ? surfaceDocument.defaultView! : surfaceDocument;
				let descriptor: PropertyDescriptor | undefined;
				for (let proto: object | null = owner; proto && !descriptor; proto = Object.getPrototypeOf(proto))
					descriptor = Object.getOwnPropertyDescriptor(proto, request.key);
				if (!descriptor) return { error: { name: 'UnsupportedDOMMember', message: `This browser does not expose ${name}.${request.key}` } };
				const value = descriptor.get ? descriptor.get.call(owner) : descriptor.value;
				// The document root is outside the authored surface. Expose only its
				// native scroll metrics, never a receiver that can navigate the tree.
				if (name === 'Document' && request.key !== 'timeline')
					return {
						value: value
							? {
									nodeName: reader<string>('Node', 'nodeName')(value),
									...Object.fromEntries(
										['scrollTop', 'scrollLeft', 'scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight'].map((k) => [
											k,
											reader<number>('Element', k)(value)
										])
									)
							  }
							: null
					};
				return { value: encode(value) };
			}
			if (request.action === 'static' || (request.action === 'construct' && Object.prototype.hasOwnProperty.call(constructors, request.key))) {
				const isStatic = request.action === 'static';
				const namespace = request.target;
				const registry =
					isStatic && typeof namespace === 'string' && Object.prototype.hasOwnProperty.call(statics, namespace)
						? (statics as Record<string, Record<string, Method>>)[namespace]
						: undefined;
				const shape = isStatic
					? registry && Object.prototype.hasOwnProperty.call(registry, request.key) && registry[request.key]
					: (constructors as Record<string, Method>)[request.key];
				if (!shape || (!isStatic && request.target !== null)) throw new Error('Unregistered CSS native operation');
				if (!isStatic && Object.prototype.hasOwnProperty.call(RANGE_CONSTRUCTORS, request.key) && !context)
					throw new Error('Ranges require an owned document context');
				const animationConstructor = !isStatic && Object.prototype.hasOwnProperty.call(ANIMATION_CONSTRUCTORS, request.key);
				if (animationConstructor && context !== 'surface') throw new Error('Animations require the owned surface context');
				if (animationConstructor && animationCount >= ANIMATION_LIMITS.objects) throw new Error('Animation allocation budget exceeded');
				const observerConstructor = !isStatic && Object.prototype.hasOwnProperty.call(OBSERVER_CONSTRUCTORS, request.key);
				if (observerConstructor && (!context || (request.key !== 'MutationObserver' && context !== 'surface')))
					throw new Error('Observers require their owned document context');
				if (observerConstructor && observers.size >= OBSERVER_LIMITS.observers) throw new Error('Observer allocation budget exceeded');
				const unsupportedOptions = request.key === 'KeyframeEffect' ? unsupportedAnimationOptions(request.args[2]) : undefined;
				if (unsupportedOptions) return unsupportedOptions;
				const args = typedCSSArguments(shape, request.args, argument);
				if (isStatic && ['Document', 'Window'].includes(String(namespace)) && context !== 'surface')
					throw new Error('Layout operations require the active surface');
				const owner = isStatic
					? namespace === 'Window'
						? surfaceDocument.defaultView
						: namespace === 'Document'
						? surfaceDocument
						: realm[String(namespace)]
					: undefined;
				const native = isStatic
					? owner &&
					  (
							Object.getOwnPropertyDescriptor(owner, request.key) ||
							(namespace === 'Document' ? Object.getOwnPropertyDescriptor(realm.Document.prototype, request.key) : undefined)
					  )?.value
					: realm[request.key];
				if (typeof native !== 'function')
					return {
						error: { name: 'UnsupportedDOMMember', message: `This browser does not expose ${isStatic ? namespace + '.' : ''}${request.key}` }
					};
				const cost = reserveCSS(request.args, undefined, request.key === 'CSSMathProduct');
				work += JSON.stringify(request.args).length;
				if (work > 65536) throw new Error('DOM input work budget exceeded');
				try {
					let value = isStatic ? Reflect.apply(native, owner, args) : Reflect.construct(native, args);
					if (observerConstructor && request.key !== 'IntersectionObserverEntry')
						observers.set(value as object, { type: request.key, targets: new Set() });
					if (animationConstructor && value && typeof value === 'object') trackAnimation(value);
					if (namespace === 'Document') {
						if (request.key === 'getAnimations')
							value = (value as object[]).filter((animation) => {
								const effect = reader<object | null>('Animation', 'effect')(animation);
								const target = effect && belongs(effect, 'KeyframeEffect') ? reader<Node | null>('KeyframeEffect', 'target')(effect) : null;
								return target && insideSurface(target);
							});
						if (request.key === 'elementFromPoint' && value && !insideSurface(value as Node)) value = null;
						if (request.key === 'elementsFromPoint') value = (value as Node[]).filter((node) => insideSurface(node));
						if (
							request.key === 'caretPositionFromPoint' &&
							value &&
							!insideSurface(reader<Node>('CaretPosition', 'offsetNode')(value as object) as Node)
						)
							value = null;
					}
					if (value && typeof value === 'object') cssCosts.set(value, cost);
					if (shape.awaitResult)
						return Promise.resolve(value).then(
							(result) => {
								if (stopped) throw new Error('DOM run has ended');
								return { value: layoutScrollResult(result) };
							},
							(error) => ({ error: { name: String(error?.name || 'DOMException'), message: String(error?.message || error).slice(0, 500) } })
						);
					return { value: encode(value) };
				} catch (error) {
					if (
						observerConstructor &&
						request.key === 'IntersectionObserverEntry' &&
						(error as Error).name === 'TypeError' &&
						/Illegal constructor/.test((error as Error).message)
					)
						return {
							error: {
								name: 'UnsupportedDOMMember',
								message: 'This browser exposes IntersectionObserverEntry records but not their standard constructor.'
							}
						};
					return { error: { name: (error as Error).name, message: String((error as Error).message).slice(0, 500) } };
				}
			}
			if (request.action === 'construct') {
				if (request.target !== null || !['Path2D', 'ImageData'].includes(request.key)) throw new Error('Unregistered DOM constructor');
				const args = request.args.slice();
				if (request.key === 'Path2D') {
					if (args.length > 1) throw new Error('Invalid Path2D arguments');
					if (args.length) args[0] = typeof args[0] === 'string' ? argument(args[0], 'text') : receiverType(args[0], 'Path2D');
				} else {
					const pixels = Array.isArray(args[0]);
					if (args.length < 2 || args.length > (pixels ? 4 : 3)) throw new Error('Invalid ImageData arguments');
					const offset = pixels ? 1 : 0;
					args[offset] = argument(args[offset], 'pixel-size');
					if (!pixels || args.length >= 3) args[offset + 1] = argument(args[offset + 1], 'pixel-size');
					if (args.length > offset + 2) args[offset + 2] = argument(args[offset + 2], 'pixel-settings');
					if (Number(args[offset]) < 0 || (args[offset + 1] !== undefined && Number(args[offset + 1]) < 0))
						throw new Error('ImageData dimensions must be nonnegative');
					if (pixels) {
						const data = args[0] as unknown[];
						if (data.length > CANVAS_LIMITS.pixelValues || data.some((v) => typeof v !== 'number' || !Number.isFinite(v)))
							throw new Error('Pixel input budget exceeded');
						if (args.length === 2 && Number(args[1]) > 0 && data.length / 4 / Number(args[1]) > CANVAS_LIMITS.pixelEdge)
							throw new Error('Inferred ImageData height exceeds its limit');
						const settings = args[3] as { pixelFormat?: string } | undefined;
						const ArrayType = (surfaceDocument.defaultView! as any)[settings?.pixelFormat === 'rgba-float16' ? 'Float16Array' : 'Uint8ClampedArray'];
						if (!ArrayType) return { error: { name: 'UnsupportedDOMMember', message: 'This browser does not expose the requested pixel array' } };
						args[0] = new ArrayType(data);
					}
				}
				work += JSON.stringify(request.args).length;
				if (work > 65536) throw new Error('DOM input work budget exceeded');
				const Constructor = realm[request.key];
				if (typeof Constructor !== 'function')
					return { error: { name: 'UnsupportedDOMMember', message: `This browser does not expose ${request.key}` } };
				const pathCost =
					request.key === 'Path2D' ? (typeof args[0] === 'string' ? args[0].length : args[0] ? pathCosts.get(args[0] as object) || 0 : 0) : 0;
				if (pathCost > 4096 || pathWork + pathCost > 16384) throw new Error('Canvas path complexity budget exceeded');
				try {
					const value = Reflect.construct(Constructor, args) as object;
					if (request.key === 'Path2D') reservePath(value, pathCost);
					return { value: encode(value) };
				} catch (error) {
					return { error: { name: (error as Error).name, message: String((error as Error).message).slice(0, 500) } };
				}
			}
			const target = receiver(request.target).value;
			if (belongs(target, 'Animation') || belongs(target, 'AnimationEffect')) inspectAnimation(target);
			// A native new Range() initially points at the realm document. Permit
			// an owned boundary initializer before reading or operating on it.
			if (belongs(target, 'AbstractRange') && !(request.action === 'call' && RANGE_INITIALIZERS.has(request.key))) inspectRange(target);
			let descriptor: PropertyDescriptor | undefined,
				namedCSSProperty = false,
				policy: Method | undefined,
				writeRule: Arg = 'text',
				registered = false,
				resolvedInterface = '';
			for (const [name, candidate] of resolutionOrder) {
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
						resolvedInterface = name;
						break;
					}
				} else {
					descriptor = (request.action === 'get' ? candidate.reads : candidate.writes).get(request.key);
					if (descriptor) {
						writeRule = registeredPolicy.writeArgs?.[request.key] || 'text';
						resolvedInterface = name;
						break;
					}
				}
			}
			if (
				!descriptor &&
				CSSOM_PROPERTIES.includes(request.key) &&
				belongs(target, 'CSSStyleDeclaration') &&
				['get', 'set'].includes(request.action)
			) {
				descriptor = Object.getOwnPropertyDescriptor(target, request.key);
				if (descriptor) {
					namedCSSProperty = true;
					resolvedInterface = 'CSSStyleDeclaration';
					writeRule = 'cssom-text';
				}
			}
			// Event.isTrusted is an unforgeable own native accessor, not a prototype member.
			if (
				!descriptor &&
				registered &&
				request.action === 'get' &&
				request.key === 'isTrusted' &&
				realm.Event &&
				Object.prototype.isPrototypeOf.call(realm.Event.prototype, target)
			) {
				const own = Object.getOwnPropertyDescriptor(target, request.key);
				if (own?.get && own.configurable === false) descriptor = own;
			}
			if (!descriptor) {
				if (registered) return { error: { name: 'UnsupportedDOMMember', message: `This browser does not expose DOM member ${request.key}` } };
				throw new Error(`DOM member ${request.key} is not registered for this receiver`);
			}
			const animationPromise = request.action === 'get' && belongs(target, 'Animation') && ['ready', 'finished'].includes(request.key);
			if (nested && (policy?.awaitResult || animationPromise)) throw new Error('Asynchronous DOM operations cannot run in a synchronous batch');
			if (
				context === 'surface' &&
				(policy?.mutates || request.action === 'set') &&
				!Object.prototype.hasOwnProperty.call(CANVAS_RECEIVER_POLICY, resolvedInterface) &&
				!Object.prototype.hasOwnProperty.call(SVG_RECEIVER_POLICY, resolvedInterface) &&
				!Object.prototype.hasOwnProperty.call(TYPED_CSS_RECEIVER_POLICY, resolvedInterface) &&
				!Object.prototype.hasOwnProperty.call(CSSOM_RECEIVER_POLICY, resolvedInterface) &&
				!Object.prototype.hasOwnProperty.call(ANIMATION_RECEIVER_POLICY, resolvedInterface) &&
				!(request.action === 'call' && request.key === 'replaceChildren' && shadowRoots.has(target as ShadowRoot)) &&
				!(resolvedInterface === 'Element' && request.action === 'set' && LAYOUT_ELEMENT.writes!.split(' ').includes(request.key)) &&
				request.key !== 'attachShadow'
			)
				throw new Error('Surface tree mutation is not registered; use authored document nodes');
			if (Object.prototype.hasOwnProperty.call(ANIMATION_ELEMENT_CALLS, request.key) && context !== 'surface')
				throw new Error('Animations require the owned surface context');
			const unsupportedOptions = request.key === 'animate' ? unsupportedAnimationOptions(request.args[1]) : undefined;
			if (unsupportedOptions) return unsupportedOptions;
			if (request.key === 'animate' && animationCount >= ANIMATION_LIMITS.objects) throw new Error('Animation allocation budget exceeded');
			if (resolvedInterface === 'HTMLCanvasElement' && request.key === 'getContext' && context !== 'surface')
				throw new Error('Canvas drawing requires the active surface context');
			if (belongs(target, 'SVGAnimatedString')) {
				const owner = owners.get(target),
					property = valueKeys.get(target);
				if (
					property === 'className' ||
					(owner && SVG_FILTER_TAGS.has(localName(owner)) && ['in1', 'in2', 'result', 'crossOrigin', 'href'].includes(property || ''))
				)
					writeRule = property === 'href' && owner && localName(owner) === 'feImage' ? 'svg-filter-image' : 'svg-text';
			}
			if (request.key === 'attachShadow' && (context !== 'surface' || target === surface || !insideSurface(target as Node) || shadowRoots.size >= 8))
				throw new Error('Shadow roots require a bounded program-owned surface element');
			if (request.action === 'set' && request.key === 'textContent' && belongs(target, 'HTMLStyleElement')) cssomText(request.args[0]);
			const rules = policy?.args || (request.action === 'set' ? [writeRule] : []);
			let args: unknown[] | undefined;
			if (policy?.overloads) {
				for (const shape of policy.overloads) {
					if (shape.length !== request.args.length) continue;
					try {
						args = request.args.map((value, index) => argument(value, shape[index]));
						break;
					} catch {
						/* Try the next registered overload. */
					}
				}
				if (!args) throw new Error('Invalid or unbounded Canvas overload arguments');
			} else {
				const min = policy?.min ?? rules.length;
				if (request.args.length < min || (!policy?.rest && request.args.length > rules.length)) throw new Error('Invalid DOM argument count');
				args = request.args.map((value, index) => argument(value, rules[Math.min(index, rules.length - 1)]));
			}

			const svgOwner = owners.get(target);
			const filterOwner = belongs(target, 'Node') ? (target as Node) : svgOwner;
			if (
				filterOwner &&
				belongs(filterOwner, 'SVGElement') &&
				SVG_FILTER_TAGS.has(localName(filterOwner)) &&
				(request.action === 'set' || policy?.mutates)
			) {
				const property = valueKeys.get(target) || request.key;
				if (request.action === 'set') svgFilterValue(localName(filterOwner), property, args[0]);
				if (request.key === 'setStdDeviation') for (const value of args) svgFilterNumbers('stdDeviation', value);
				if (belongs(target, 'SVGNumberList') && ['initialize', 'insertItemBefore', 'replaceItem', 'appendItem'].includes(request.key))
					svgFilterNumbers(property, reader<number>('SVGNumber', 'value')(args[0] as object));
				if (belongs(target, 'SVGLength')) {
					if (['newValueSpecifiedUnits', 'convertToSpecifiedUnits'].includes(request.key) && ![1, 5].includes(Number(args[0])))
						throw new Error('Use user units for filter region writes');
					if (request.key === 'valueInSpecifiedUnits' && ![1, 5].includes(reader<number>('SVGLength', 'unitType')(target)))
						throw new Error('Use user units for filter region writes');
					if (request.key === 'valueAsString') svgFilterNumbers(property, String(args[0]).replace(/px$/, ''));
					if (request.key === 'newValueSpecifiedUnits') svgFilterNumbers(property, args[1]);
				}
			}
			if (
				belongs(target, 'SVGLength') &&
				svgOwner &&
				belongs(svgOwner, 'SVGSVGElement') &&
				['width', 'height'].includes(valueKeys.get(target) || '') &&
				(request.action === 'set' || policy?.mutates)
			) {
				let value: unknown;
				if (request.key === 'value') value = args[0];
				else if (request.key === 'valueAsString') {
					if (typeof args[0] !== 'string' || !/^\d+(?:\.\d+)?(?:px)?$/.test(args[0])) throw new Error('Use pixel values for SVG viewport writes');
					value = parseFloat(args[0]);
				} else if (request.key === 'valueInSpecifiedUnits') {
					if (![1, 5].includes(reader<number>('SVGLength', 'unitType')(target))) throw new Error('Use pixel values for SVG viewport writes');
					value = args[0];
				} else if (request.key === 'newValueSpecifiedUnits') {
					if (![1, 5].includes(Number(args[0]))) throw new Error('Use pixel values for SVG viewport writes');
					value = args[1];
				}
				if (value !== undefined && (typeof value !== 'number' || value < 0 || value > SVG_LIMITS.edge))
					throw new Error('SVG viewport exceeds its dimension limit');
			}
			if (request.action === 'set' && belongs(target, 'Attr')) attribute(attrName(target));
			work += JSON.stringify(request.args).length;
			if (work > 65536) throw new Error('DOM input work budget exceeded');
			if (request.action === 'call' && (belongs(target, 'Path2D') || belongs(target, 'CanvasRenderingContext2D'))) {
				if (request.key === 'beginPath' || request.key === 'reset') pathCosts.set(target, 0);
				if (request.key === 'addPath') reservePath(target, pathCosts.get(args[0] as object) || 0);
				else if (
					['closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arcTo', 'rect', 'arc', 'ellipse', 'roundRect'].includes(request.key)
				)
					reservePath(target, 1);
			}
			if (request.action === 'call' && ['appendItem', 'insertItemBefore'].includes(request.key)) {
				for (const type of SVG_LIST_TYPES)
					if (belongs(target, type) && reader<number>(type, 'numberOfItems')(target) >= SVG_LIMITS.list)
						throw new Error('SVG list item budget exceeded');
			}
			const typedCSS = Object.prototype.hasOwnProperty.call(TYPED_CSS_RECEIVER_POLICY, resolvedInterface);
			const cssCost = typedCSS
				? reserveCSS(request.args, target, belongs(target, 'CSSNumericValue') && ['mul', 'div', 'toSum'].includes(request.key))
				: 0;
			const cssContainer = belongs(target, 'CSSStyleSheet')
				? target
				: belongs(target, 'CSSRule')
				? reader<CSSStyleSheet | null>('CSSRule', 'parentStyleSheet')(target)
				: undefined;
			if (cssContainer && ['insertRule', 'addRule'].includes(request.key)) {
				const added = Math.max(
					1,
					String(args[0])
						.match(/[{}]/g)
						?.filter((c) => c === '{').length || 0
				);
				if (cssRuleCount(cssContainer) + added > CSSOM_LIMITS.rules) throw new Error('CSS rule budget exceeded');
			}

			const observerState = observers.get(target);
			if (
				observerState &&
				request.key === 'observe' &&
				!observerState.targets.has(args[0] as object) &&
				observerState.targets.size >= OBSERVER_LIMITS.targets
			)
				throw new Error('Observer target budget exceeded');
			let result: unknown;
			try {
				if (request.action === 'get') result = descriptor.get ? descriptor.get.call(target) : descriptor.value;
				else if (request.action === 'set') {
					if (namedCSSProperty && descriptor.writable) Reflect.set(target, request.key, args[0]);
					else {
						if (!descriptor.set) throw new Error('DOM property is read-only');
						descriptor.set.call(target, args[0]);
					}
					result = args[0];
				} else result = descriptor.value.apply(target, args);
				if (observerState) {
					if (request.key === 'observe') observerState.targets.add(args[0] as object);
					if (request.key === 'unobserve') observerState.targets.delete(args[0] as object);
					if (request.key === 'disconnect') observerState.targets.clear();
				}
			} catch (error) {
				// Actual DOM errors remain catchable in authored worker programs.
				return {
					error: { name: error instanceof Error ? error.name : 'DOMException', message: String((error as Error)?.message || error).slice(0, 500) }
				};
			}
			const complete = (result: unknown) => {
				if (stopped) throw new Error('DOM run has ended');
				if (belongs(target, 'AbstractRange')) inspectRange(target);
				if (cssContainer && (policy?.mutates || request.action === 'set')) cssRuleCount(cssContainer);
				if (request.key === 'attachShadow' && result) shadowRoots.add(result as ShadowRoot);
				if (policy?.iterable) {
					const items: unknown[] = [];
					for (const item of result as Iterable<unknown>) {
						if (items.length >= 600) throw new Error('DOM iterable budget exceeded');
						items.push(item);
					}
					result = items;
				}
				if (result && typeof result === 'object' && typedCSS) {
					cssCosts.set(result, cssCost);
					if (Array.isArray(result)) for (const item of result) if (item && typeof item === 'object') cssCosts.set(item, cssCost);
				}
				const owner = belongs(target, 'Node') ? (target as Node) : owners.get(target);
				if (result && typeof result === 'object' && !Array.isArray(result) && owner) {
					owners.set(result, owner);
					valueKeys.set(result, belongs(target, 'Node') ? request.key : valueKeys.get(target) || request.key);
				}
				// Offset ancestors can be outside the program. Preserve null instead
				// of leaking the runtime's body or document through a layout read.
				if (['offsetParent', 'scrollParent'].includes(request.key) && result && !insideSurface(result as Node)) result = null;
				const value =
					resolvedInterface === 'Element' && /^scroll(?:To|By|IntoView)?$/.test(request.key)
						? layoutScrollResult(result)
						: request.key === 'toJSON' && belongs(target, 'DOMQuad')
						? layoutQuadJSON(result)
						: request.key === 'getContextAttributes' && belongs(target, 'CanvasRenderingContext2D')
						? canvasContextAttributes(result)
						: request.key === 'type' && belongs(target, 'CSSNumericValue')
						? typedCSSNumericType(result)
						: belongs(target, 'AnimationEffect') && ['getTiming', 'getComputedTiming', 'getKeyframes'].includes(request.key)
						? animationRecord(result)
						: encode(result);
				if (policy?.mutates || request.action === 'set') {
					// Collections retain their originating node, even after that subtree
					// is detached. Indirect option allocations still spend the node budget.
					if (owner) inspectTree(context === 'surface' ? owner : rootNode(owner));
					if (context !== 'surface') publish();
				}
				return { value };
			};
			if (policy?.awaitResult || animationPromise)
				return Promise.resolve(result).then(complete, (error) => ({
					error: { name: String(error?.name || 'DOMException'), message: String(error?.message || error).slice(0, 500) }
				}));
			return complete(result);
		}
	};
	return { stop: bridge.stop, request: (raw: unknown) => bridge.request(raw) };
}
