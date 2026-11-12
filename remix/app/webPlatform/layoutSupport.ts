/** Closed WebIDL dictionaries for layout. Every Node comes from this run's handle table. */
export function layoutArgument(value: unknown, rule: string, receiver: (value: unknown, types: string) => object): unknown {
	const num = (v: unknown) => {
		if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 32768) throw new Error('Use a bounded layout number');
		return v;
	};
	const bool = (v: unknown) => {
		if (typeof v !== 'boolean') throw new Error('Expected a layout boolean');
		return v;
	};
	const text = (v: unknown) => {
		if (typeof v !== 'string' || v.length > 2048) throw new Error('Use bounded layout text');
		return v;
	};
	const choice = (choices: string) => (v: unknown) => {
		if (typeof v !== 'string' || !choices.split(' ').includes(v)) throw new Error('Invalid layout option');
		return v;
	};
	const node = (v: unknown) => receiver(v, 'Element|Text|ShadowRoot');
	const dictionary = (v: unknown, fields: Record<string, (v: unknown) => unknown>) => {
		if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !Object.prototype.hasOwnProperty.call(fields, k)))
			throw new Error('Unknown layout dictionary field');
		return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, fields[k](item)]));
	};
	const point = (v: unknown) => dictionary(v, { x: num, y: num, z: num, w: num });
	const box = choice('margin border padding content');
	switch (rule) {
		case 'layout-point':
			return point(value);
		case 'layout-rect':
			return dictionary(value, { x: num, y: num, width: num, height: num });
		case 'layout-quad':
			return dictionary(value, { p1: point, p2: point, p3: point, p4: point });
		case 'layout-options':
			if (typeof value === 'boolean') return value;
			return dictionary(value, {
				behavior: choice('auto instant smooth'),
				block: choice('start center end nearest'),
				inline: choice('start center end nearest'),
				container: choice('all nearest')
			});
		case 'layout-scroll':
			return dictionary(value, { behavior: choice('auto instant smooth'), left: num, top: num });
		case 'layout-visibility':
			return dictionary(
				value,
				Object.fromEntries(
					'checkOpacity checkVisibilityCSS contentVisibilityAuto opacityProperty visibilityProperty'.split(' ').map((k) => [k, bool])
				)
			);
		case 'layout-box':
			return dictionary(value, { box, relativeTo: node });
		case 'layout-convert':
			return dictionary(value, { fromBox: box, toBox: box });
		case 'layout-caret':
			return dictionary(value, {
				shadowRoots: (v) => {
					if (!Array.isArray(v) || v.length > 8) throw new Error('Caret shadow-root budget exceeded');
					return v.map((x) => receiver(x, 'ShadowRoot'));
				}
			});
		case 'layout-event':
			return dictionary(value, {
				matches: bool,
				media: text,
				bubbles: bool,
				cancelable: bool,
				composed: bool,
				clientX: num,
				clientY: num,
				screenX: num,
				screenY: num,
				button: num,
				buttons: num
			});
	}
	throw new Error('Unregistered layout argument');
}
/** JSON output of native DOMQuad.toJSON(), never arbitrary object enumeration. */
export function layoutQuadJSON(value: unknown) {
	const quad = value as Record<string, Record<string, number>>;
	return Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((k) => [k, Object.fromEntries(['x', 'y', 'z', 'w'].map((p) => [p, quad[k][p]]))]));
}
/** Engines return undefined or a native ScrollResult dictionary. */
export function layoutScrollResult(value: unknown) {
	if (value === undefined) return undefined;
	if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
		const keys = Reflect.ownKeys(value);
		if (!keys.length) return {};
		const interrupted = Object.getOwnPropertyDescriptor(value, 'interrupted');
		if (keys.length === 1 && typeof interrupted?.value === 'boolean') return { interrupted: interrupted.value as boolean };
	}
	throw new Error('Unregistered native scroll result');
}
