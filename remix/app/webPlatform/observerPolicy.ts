import type { Arg, Policy } from './domBridge';
export type ObserverArg =
	| 'observer-callback'
	| 'observer-node'
	| 'observer-element'
	| 'observer-mutation'
	| 'observer-resize'
	| 'observer-intersection'
	| 'observer-entry';
const call = (args: Arg[] = [], min = args.length) => ({ args, min });
export const OBSERVER_CONSTRUCTORS = {
	MutationObserver: call(['observer-callback']),
	ResizeObserver: call(['observer-callback']),
	IntersectionObserver: call(['observer-callback', 'observer-intersection'], 1),
	IntersectionObserverEntry: call(['observer-entry'])
};
export const OBSERVER_RECEIVER_POLICY: Record<string, Policy> = {
	MutationObserver: { reads: '', calls: { observe: call(['observer-node', 'observer-mutation']), disconnect: call(), takeRecords: call() } },
	MutationRecord: { reads: 'type target addedNodes removedNodes previousSibling nextSibling attributeName attributeNamespace oldValue' },
	ResizeObserver: {
		reads: '',
		calls: { observe: call(['observer-element', 'observer-resize'], 1), unobserve: call(['observer-element']), disconnect: call() }
	},
	ResizeObserverEntry: { reads: 'target contentRect borderBoxSize contentBoxSize devicePixelContentBoxSize' },
	ResizeObserverSize: { reads: 'inlineSize blockSize' },
	IntersectionObserver: {
		reads: 'root rootMargin scrollMargin thresholds delay trackVisibility',
		calls: { observe: call(['observer-element']), unobserve: call(['observer-element']), disconnect: call(), takeRecords: call() }
	},
	IntersectionObserverEntry: { reads: 'time rootBounds boundingClientRect intersectionRect isIntersecting isVisible intersectionRatio target' }
};
