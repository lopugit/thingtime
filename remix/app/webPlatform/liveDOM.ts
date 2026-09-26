import { HTML_FORM_RECEIVER_POLICY } from './htmlFormPolicy';
import type { PlatformBooleanInput, PlatformDOMBinding } from './types';
/** Shared native backing for data-authored DOM bindings. No catalogue IDs here. */
export const LIVE_DOM_METHODS = new Set([
	'show',
	'showModal',
	'close',
	'requestClose',
	'showPopover',
	'hidePopover',
	'togglePopover',
	'focus',
	'blur',
	'click',
	'select',
	'setSelectionRange',
	'checkValidity',
	'reportValidity',
	'reset',
	'requestSubmit',
	'stepUp',
	'stepDown',
	'scrollIntoView',
	'scrollTo',
	'scrollBy',
	'animate',
	'setAttribute',
	'removeAttribute',
	'toggleAttribute'
]);
export const LIVE_DOM_EVENTS = new Set([
	'click',
	'auxclick',
	'dblclick',
	'contextmenu',
	'mousedown',
	'mouseup',
	'mouseenter',
	'mouseleave',
	'mousemove',
	'mouseover',
	'mouseout',
	'pointerdown',
	'pointerup',
	'pointerenter',
	'pointerleave',
	'pointermove',
	'pointerover',
	'pointerout',
	'pointercancel',
	'wheel',
	'keydown',
	'keypress',
	'keyup',
	'beforeinput',
	'input',
	'change',
	'submit',
	'reset',
	'invalid',
	'formdata',
	'toggle',
	'beforetoggle',
	'cancel',
	'close',
	'command',
	'focus',
	'blur',
	'focusin',
	'focusout',
	'select',
	'selectstart',
	'selectionchange',
	'scroll',
	'scrollend',
	'drag',
	'dragstart',
	'dragend',
	'dragenter',
	'dragleave',
	'dragover',
	'drop',
	'animationstart',
	'animationiteration',
	'animationend',
	'animationcancel',
	'transitionrun',
	'transitionstart',
	'transitionend',
	'transitioncancel',
	'load',
	'error'
]);
export class UnsupportedDOMFeature extends Error {}
function nativeDescriptor(target: object, name: string): PropertyDescriptor | undefined {
	// Named form controls can shadow any instance property. Start at the prototype.
	for (let proto = Object.getPrototypeOf(target); proto; proto = Object.getPrototypeOf(proto)) {
		const descriptor = Object.getOwnPropertyDescriptor(proto, name);
		if (descriptor) return descriptor;
	}
	return undefined;
}
export function nativeDOMMethod(target: object, name: string): (...args: unknown[]) => unknown {
	if (!LIVE_DOM_METHODS.has(name)) throw new Error('This DOM method is not registered');
	const method = nativeDescriptor(target, name)?.value;
	if (typeof method !== 'function') throw new UnsupportedDOMFeature('This browser does not implement the method ' + name);
	return (...args) => Reflect.apply(method, target, args);
}
function nativeValue(target: object, key: string): unknown {
	const descriptor = nativeDescriptor(target, key);
	return descriptor?.get ? Reflect.apply(descriptor.get, target, []) : descriptor?.value;
}
function nativeScalars(target: object, keys: string[]) {
	return Object.fromEntries(
		keys.flatMap((key) => {
			const value = nativeValue(target, key);
			return typeof value === 'string'
				? [[key, value.slice(0, 256)]]
				: value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
				? [[key, value]]
				: [];
		})
	);
}
function eventNode(target: EventTarget | null) {
	if (!target || nativeValue(target, 'nodeType') !== 1) return null;
	const text = (key: string) => {
		const value = nativeValue(target, key);
		return typeof value === 'string' ? value.slice(0, 256) : undefined;
	};
	const validity = nativeValue(target, 'validity');
	return {
		tag: text('localName'),
		id: text('id'),
		name: text('name'),
		value: text('value'),
		...nativeScalars(target, ['checked', 'open', 'returnValue', 'selectionStart', 'selectionEnd', 'selectionDirection', 'scrollTop', 'scrollLeft']),
		...(validity && typeof validity === 'object'
			? {
					validity: Object.fromEntries(HTML_FORM_RECEIVER_POLICY.ValidityState.reads.split(' ').map((key) => [key, nativeValue(validity, key)])),
					validationMessage: text('validationMessage')
			  }
			: {})
	};
}
/** Fixed bounded projection of the actual Event, never arbitrary object graphs. */
export function platformEventReceipt(event: Event) {
	return {
		type: event.type,
		bubbles: event.bubbles,
		cancelable: event.cancelable,
		defaultPrevented: event.defaultPrevented,
		isTrusted: event.isTrusted,
		composed: event.composed,
		eventPhase: event.eventPhase,
		target: eventNode(event.target),
		currentTarget: eventNode(event.currentTarget),
		...nativeScalars(event, [
			'key',
			'code',
			'location',
			'repeat',
			'altKey',
			'ctrlKey',
			'metaKey',
			'shiftKey',
			'isComposing',
			'button',
			'buttons',
			'clientX',
			'clientY',
			'movementX',
			'movementY',
			'detail',
			'pointerId',
			'pointerType',
			'isPrimary',
			'pressure',
			'width',
			'height',
			'tiltX',
			'tiltY',
			'deltaX',
			'deltaY',
			'deltaZ',
			'deltaMode',
			'inputType',
			'data',
			'oldState',
			'newState',
			'animationName',
			'elapsedTime',
			'pseudoElement',
			'propertyName',
			'command'
		]),
		...(nativeDescriptor(event, 'submitter') ? { submitter: eventNode(nativeValue(event, 'submitter') as EventTarget | null) } : {}),
		...(nativeDescriptor(event, 'relatedTarget') ? { relatedTarget: eventNode(nativeValue(event, 'relatedTarget') as EventTarget | null) } : {}),
		...(nativeDescriptor(event, 'source') ? { source: eventNode(nativeValue(event, 'source') as EventTarget | null) } : {})
	};
}
const boolKeys = ['preventDefault', 'stopPropagation', 'stopImmediatePropagation', 'returnFalse'] as const;
function validateBoolean(value: unknown) {
	if (value === undefined || typeof value === 'boolean') return;
	if (
		value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).length === 2 &&
		(value as any).op === 'input' &&
		typeof (value as any).name === 'string' &&
		/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test((value as any).name)
	)
		return;
	throw new Error('Expected a boolean or one named boolean input');
}
export function resolveDOMBoolean(value: PlatformBooleanInput | undefined, input: Record<string, unknown>) {
	if (value === undefined) return false;
	if (typeof value === 'boolean') return value;
	const resolved = Object.prototype.hasOwnProperty.call(input, value.name) ? input[value.name] : undefined;
	if (typeof resolved !== 'boolean') throw new Error('Expected a boolean input for ' + value.name);
	return resolved;
}
export function validateLiveDOMBinding(operation: unknown) {
	if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('Expected a DOM binding');
	const op = operation as PlatformDOMBinding;
	const selector = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 500;
	const allowed = new Set(['target', 'event', 'method', 'args', 'label', 'binding', 'options', ...boolKeys]);
	if (Object.keys(op).some((key) => !allowed.has(key))) throw new Error('Unknown DOM binding field');
	if (!selector(op.target)) throw new Error('Expected a bounded DOM target selector');
	if (op.label !== undefined && (typeof op.label !== 'string' || op.label.length > 100)) throw new Error('Expected a bounded binding label');
	if (op.method !== undefined && (typeof op.method !== 'string' || !LIVE_DOM_METHODS.has(op.method)))
		throw new Error('This DOM method is not registered');
	if (op.event !== undefined) {
		if (typeof op.event !== 'string') throw new Error('Invalid event binding');
		const parts = op.event.split('|');
		if (parts.length !== 2 || !selector(parts[0]) || !LIVE_DOM_EVENTS.has(parts[1])) throw new Error('Invalid event binding');
	}
	if (op.method === undefined && (op.event === undefined || op.args !== undefined))
		throw new Error('Event observations need an event and no arguments');
	if (op.binding !== undefined && !['listener', 'handler'].includes(op.binding)) throw new Error('Unknown event binding mode');
	if (op.event === undefined && (op.binding !== undefined || op.options !== undefined || boolKeys.some((key) => op[key] !== undefined)))
		throw new Error('Event controls require an event');
	for (const key of boolKeys) validateBoolean(op[key]);
	if (op.returnFalse !== undefined && op.binding !== 'handler') throw new Error('Returning false requires an IDL event handler');
	if (op.options !== undefined) {
		if (
			!op.options ||
			typeof op.options !== 'object' ||
			Array.isArray(op.options) ||
			op.binding === 'handler' ||
			Object.keys(op.options).some((key) => !['capture', 'once', 'passive'].includes(key))
		)
			throw new Error('Expected listener options');
		for (const value of Object.values(op.options)) validateBoolean(value);
	}
	if (op.args !== undefined && (!Array.isArray(op.args) || op.args.length > 16)) throw new Error('Expected bounded DOM arguments');
	for (const value of op.args || []) {
		if (value && typeof value === 'object' && (value as { op?: unknown }).op === 'element') {
			if (Array.isArray(value) || Object.keys(value).length !== 2 || !selector((value as { selector?: unknown }).selector))
				throw new Error('Expected one bounded element selector');
		}
	}
}
/** Native listener/IDL registration. Options and effects are reusable saved data. */
export function bindLiveDOMEvent(
	target: EventTarget,
	eventName: string,
	operation: PlatformDOMBinding,
	input: Record<string, unknown>,
	execute: (event: Event) => void
) {
	if (!LIVE_DOM_EVENTS.has(eventName)) throw new Error('This DOM event is not registered');
	const flags = Object.fromEntries(boolKeys.map((key) => [key, resolveDOMBoolean(operation[key], input)]));
	let active = true;
	const listener = (event: Event) => {
		if (!active) return;
		if (flags.preventDefault) Event.prototype.preventDefault.call(event);
		if (flags.stopPropagation) Event.prototype.stopPropagation.call(event);
		if (flags.stopImmediatePropagation) Event.prototype.stopImmediatePropagation.call(event);
		execute(event);
		return flags.returnFalse ? false : undefined;
	};
	if (operation.binding === 'handler') {
		const descriptor = nativeDescriptor(target, 'on' + eventName);
		if (!descriptor?.set || !descriptor?.get) throw new UnsupportedDOMFeature('This browser does not implement the on' + eventName + ' handler');
		descriptor.set.call(target, listener);
		return () => {
			active = false;
			// Do not remove a later replacement bound to the same native property.
			if (descriptor.get!.call(target) === listener) descriptor.set!.call(target, null);
		};
	}
	const options = Object.fromEntries(Object.entries(operation.options || {}).map(([key, value]) => [key, resolveDOMBoolean(value, input)]));
	EventTarget.prototype.addEventListener.call(target, eventName, listener, options);
	return () => {
		active = false;
		EventTarget.prototype.removeEventListener.call(target, eventName, listener, options);
	};
}
