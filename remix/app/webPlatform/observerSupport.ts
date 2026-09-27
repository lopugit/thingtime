import { layoutArgument } from './layoutSupport';
export const OBSERVER_LIMITS = { observers: 16, targets: 32, callbacks: 64, records: 64 } as const;
/** Closed dictionaries. Only handles owned by the current bridge become Nodes. */
export function observerArgument(value: unknown, rule: string, receiver: (value: unknown, types: string) => object): unknown {
	const dictionary = (v: unknown, fields: Record<string, (v: unknown) => unknown>) => {
		if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !Object.prototype.hasOwnProperty.call(fields, k)))
			throw new Error('Unknown observer dictionary field');
		return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fields[k](x)]));
	};
	const boolean = (v: unknown) => {
		if (typeof v !== 'boolean') throw new Error('Expected observer boolean');
		return v;
	};
	const number = (v: unknown, max = 32768) => {
		if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new Error('Expected bounded observer number');
		return v;
	};
	const text = (v: unknown) => {
		if (typeof v !== 'string' || v.length > 1024) throw new Error('Expected bounded observer text');
		return v;
	};
	const element = (v: unknown) => receiver(v, 'Element');
	const rectangle = (v: unknown) => layoutArgument(v, 'layout-rect', receiver);
	const margin = (v: unknown) => {
		const parts = text(v).trim().split(/\s+/);
		if (!parts.length || parts.length > 4 || parts.some((p) => !/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%)$/.test(p) || Math.abs(parseFloat(p)) > 32768))
			throw new Error('Use one to four bounded px or percent observer margins');
		return v;
	};
	switch (rule) {
		case 'observer-element':
			return element(value);
		case 'observer-node':
			return receiver(value, 'Node');
		case 'observer-mutation':
			return dictionary(value, {
				childList: boolean,
				attributes: boolean,
				characterData: boolean,
				subtree: boolean,
				attributeOldValue: boolean,
				characterDataOldValue: boolean,
				attributeFilter: (v) => {
					if (!Array.isArray(v) || v.length > 32) throw new Error('Observer attribute filter budget exceeded');
					return v.map(text);
				}
			});
		case 'observer-resize':
			return dictionary(value, {
				box: (v) => {
					if (!['content-box', 'border-box', 'device-pixel-content-box'].includes(text(v))) throw new Error('Unknown observer box');
					return v;
				}
			});
		case 'observer-intersection':
			return dictionary(value, {
				root: (v) => (v === null ? null : receiver(v, 'Element|Document')),
				rootMargin: margin,
				scrollMargin: margin,
				threshold: (v) => {
					if (!Array.isArray(v)) return number(v, 1);
					if (v.length > 32) throw new Error('Observer threshold budget exceeded');
					return v.map((x) => number(x, 1));
				},
				delay: (v) => number(v, 1000),
				trackVisibility: boolean
			});
		case 'observer-entry':
			return dictionary(value, {
				time: (v) => number(v),
				rootBounds: (v) => (v === null ? null : rectangle(v)),
				boundingClientRect: rectangle,
				intersectionRect: rectangle,
				isIntersecting: boolean,
				isVisible: boolean,
				intersectionRatio: (v) => number(v, 1),
				target: element
			});
	}
	throw new Error('Unregistered observer argument');
}
