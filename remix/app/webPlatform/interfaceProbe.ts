/** Inspect browser descriptors without executing getters on prototype receivers.
 * Intermediate accessors need an actual receiver fixture, not speculative reads. */
export function inspectPlatformInterface(name: string, root: object) {
	const path = typeof name === 'string' ? name.split('.') : [];
	if (
		!path.length ||
		path.length > 8 ||
		path.some((part) => !/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(part) || ['__proto__', 'constructor'].includes(part))
	)
		throw new Error('Invalid inspection path');
	const descriptor = (value: unknown, key: string): PropertyDescriptor | undefined => {
		let target = value == null ? null : Object(value);
		for (let depth = 0; target && depth < 32; depth++, target = Object.getPrototypeOf(target)) {
			const found = Object.getOwnPropertyDescriptor(target, key);
			if (found) return found;
		}
	};
	const result = { interface: name, context: 'opaque-origin document' };
	let value: unknown = root;
	for (let index = 0; index < path.length; index++) {
		const found = descriptor(value, path[index]);
		if (!found) return { ...result, available: false, type: 'undefined', members: [] };
		if (!('value' in found)) {
			if (index === path.length - 1) return { ...result, available: true, type: 'accessor', getter: !!found.get, setter: !!found.set, members: [] };
			return {
				...result,
				available: null,
				type: 'unresolved',
				members: [],
				requiresReceiver: path.slice(0, index + 1).join('.'),
				message: 'This path crosses an accessor. Use a receiver-specific demo to inspect its value.'
			};
		}
		value = found.value;
	}
	const prototype = descriptor(value, 'prototype');
	const membersTarget = prototype && 'value' in prototype && prototype.value != null ? prototype.value : value;
	return {
		...result,
		available: true,
		type: typeof value,
		members: membersTarget == null ? [] : Object.getOwnPropertyNames(Object(membersTarget)).slice(0, 100)
	};
}
