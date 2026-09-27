import type { PlatformProgram } from './types';

type Probe = NonNullable<PlatformProgram['probe']>;
const pseudoElements = new Set(['::before', '::after', '::marker', '::first-letter', '::first-line', '::placeholder', '::file-selector-button']);
/** A read-only observation of the program's own rendered document. Syntax
 * acceptance is deliberately separate from the computed result: substitution,
 * cascade and context can prevent an accepted declaration from taking effect. */
export function validateCSSProbe(probe: Probe) {
	for (const key of ['name', 'value', 'target', 'compareTarget'] as const) {
		if (probe[key] !== undefined && (typeof probe[key] !== 'string' || probe[key]!.length > 2048))
			throw new Error('CSS probe fields must be bounded text');
	}
	if (typeof probe.name !== 'string' || !probe.name) throw new Error('CSS probe requires a property');
	if (probe.pseudoElement !== undefined && !pseudoElements.has(probe.pseudoElement)) throw new Error('Unsupported CSS probe pseudo-element');
}
export function readCSSProbe(root: Element, probe: Probe, substitute: (value: unknown) => string) {
	validateCSSProbe(probe);
	const property = substitute(probe.name),
		value = substitute(probe.value || '');
	const target = substitute(probe.target || '#sample');
	const compareTarget = probe.compareTarget ? substitute(probe.compareTarget) : undefined;
	validateCSSProbe({ ...probe, name: property, value, target, compareTarget });
	const pseudoElement = probe.pseudoElement || null;
	const observe = (selector: string) => {
		const element = root.querySelector(selector);
		if (!element) throw new Error(`No CSS probe element matches ${selector}`);
		const rect = element.getBoundingClientRect();
		return {
			computed: getComputedStyle(element, pseudoElement).getPropertyValue(property),
			// Pseudo-elements have no Element rectangle. Keep the originating
			// element's geometry explicitly labelled instead of inventing one.
			elementBounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
		};
	};
	const supported = CSS.supports(property, value);
	const observed = observe(target);
	const comparison = compareTarget ? observe(compareTarget) : undefined;
	return {
		property,
		value,
		target,
		pseudoElement,
		supported,
		status: supported ? 'syntax-accepted' : 'unsupported',
		...observed,
		...(comparison ? { comparison, sameComputedValue: comparison.computed === observed.computed } : {}),
		note: 'Syntax acceptance is not proof of a visual effect. Compare the computed values, originating element bounds and rendered samples.'
	};
}
