import { HTML_FORM_RECEIVER_POLICY } from './htmlFormPolicy';
/** Shared backing for data-authored live DOM bindings. No catalogue IDs here. */
export const LIVE_DOM_METHODS = new Set([
	'show', 'showModal', 'close', 'showPopover', 'hidePopover', 'togglePopover',
	'focus', 'blur', 'click', 'select', 'checkValidity', 'reportValidity', 'reset',
	'requestSubmit', 'stepUp', 'stepDown', 'scrollIntoView', 'animate',
	'setAttribute', 'removeAttribute', 'toggleAttribute'
]);
export const LIVE_DOM_EVENTS = new Set(['click', 'input', 'change', 'submit', 'reset', 'invalid', 'toggle', 'focus', 'blur']);

function nativeDescriptor(target: object, name: string): PropertyDescriptor | undefined {
	// Named form controls appear as instance properties, including reset,
	// requestSubmit, addEventListener and id. Always start at the prototype.
	for (let proto = Object.getPrototypeOf(target); proto; proto = Object.getPrototypeOf(proto)) {
		const descriptor = Object.getOwnPropertyDescriptor(proto, name);
		if (descriptor) return descriptor;
	}
	return undefined;
}
export function nativeDOMMethod(target: object, name: string): (...args: unknown[]) => unknown {
	if (!LIVE_DOM_METHODS.has(name)) throw new Error('This DOM method is not registered');
	const method = nativeDescriptor(target, name)?.value;
	if (typeof method !== 'function') throw new Error('This browser does not implement the method');
	return (...args) => Reflect.apply(method, target, args);
}
function nativeValue(target: object, key: string): unknown {
	const descriptor = nativeDescriptor(target, key);
	return descriptor?.get ? Reflect.apply(descriptor.get, target, []) : descriptor?.value;
}
function eventNode(target: EventTarget | null) {
	if (!target || nativeValue(target, 'nodeType') !== 1) return null;
	const text = (key: string) => {
		const value = nativeValue(target, key);
		return typeof value === 'string' ? value.slice(0, 256) : undefined;
	};
	const validity = nativeValue(target, 'validity');
	return { tag: text('localName'), id: text('id'), name: text('name'), value: text('value'),
		...(validity && typeof validity === 'object' ? {
			validity: Object.fromEntries(HTML_FORM_RECEIVER_POLICY.ValidityState.reads.split(' ').map(key => [key, nativeValue(validity, key)])),
			validationMessage: text('validationMessage')
		} : {}) };
}
/** Fixed, bounded projection of the real dispatched Event; never its object graph. */
export function platformEventReceipt(event: Event) {
	return {
		type: event.type, bubbles: event.bubbles, cancelable: event.cancelable,
		defaultPrevented: event.defaultPrevented, isTrusted: event.isTrusted,
		target: eventNode(event.target), currentTarget: eventNode(event.currentTarget),
		...(nativeDescriptor(event, 'submitter') ? { submitter: eventNode(nativeValue(event, 'submitter') as EventTarget | null) } : {})
	};
}

export function validateLiveDOMBinding(operation: unknown) {
	if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('Expected a DOM binding');
	const op = operation as { target?: unknown; event?: unknown; method?: unknown; args?: unknown };
	const selector = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 500;
	if (!selector(op.target)) throw new Error('Expected a bounded DOM target selector');
	if (op.method !== undefined && (typeof op.method !== 'string' || !LIVE_DOM_METHODS.has(op.method))) throw new Error('This DOM method is not registered');
	if (op.event !== undefined) {
		if (typeof op.event !== 'string') throw new Error('Invalid event binding');
		const parts = op.event.split('|');
		if (parts.length !== 2 || !selector(parts[0]) || !LIVE_DOM_EVENTS.has(parts[1])) throw new Error('Invalid event binding');
	}
	if (op.method === undefined && (op.event === undefined || op.args !== undefined)) throw new Error('Event observations need an event and no arguments');
	if (op.args !== undefined && (!Array.isArray(op.args) || op.args.length > 16)) throw new Error('Expected bounded DOM arguments');
	for (const value of (op.args || []) as unknown[]) {
		if (value && typeof value === 'object' && (value as { op?: unknown }).op === 'element') {
			if (Array.isArray(value) || Object.keys(value).length !== 2 || !selector((value as { selector?: unknown }).selector))
				throw new Error('Expected one bounded element selector');
		}
	}
}
