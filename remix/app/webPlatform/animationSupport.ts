export const ANIMATION_LIMITS = { objects: 32, frames: 64, properties: 32, values: 512, text: 4096 } as const;
const number = (v: unknown, min = -32768, max = 32768) => {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error('Expected a bounded animation number');
	return v;
};
const text = (v: unknown) => {
	if (typeof v !== 'string' || v.length > ANIMATION_LIMITS.text) throw new Error('Animation text budget exceeded');
	return v;
};
const boolean = (v: unknown) => {
	if (typeof v !== 'boolean') throw new Error('Expected an animation boolean');
	return v;
};
const dictionary = (v: unknown, fields: Record<string, (v: unknown) => unknown>) => {
	if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !Object.prototype.hasOwnProperty.call(fields, k)))
		throw new Error('Unknown animation dictionary field');
	return Object.fromEntries(Object.entries(v).map(([k, value]) => [k, fields[k](value)]));
};
/** Validate allocation bounds before native Web IDL conversion. Keyframe property
 * syntax and interpolation remain native; the runtime CSP fences CSS resources. */
export function animationKeyframes(value: unknown): unknown {
	if (value === null) return null;
	let count = 0;
	const scalar = (v: unknown, key: string): unknown => {
		if (++count > ANIMATION_LIMITS.values) throw new Error('Animation keyframe value budget exceeded');
		if (key === 'offset') return v === null ? null : number(v, 0, 1);
		return typeof v === 'number' ? number(v) : text(v);
	};
	const frame = (v: unknown, indexed: boolean) => {
		if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > ANIMATION_LIMITS.properties)
			throw new Error('Animation keyframe property budget exceeded');
		return Object.fromEntries(
			Object.entries(v).map(([key, val]) => {
				if (!/^(?:[a-zA-Z][a-zA-Z0-9]*|--[a-zA-Z0-9_-]+)$/.test(key) || ['constructor', 'prototype'].includes(key))
					throw new Error('Invalid animation keyframe property');
				if (indexed && Array.isArray(val)) {
					if (val.length > ANIMATION_LIMITS.frames) throw new Error('Animation keyframe count exceeded');
					return [key, val.map((x) => scalar(x, key))];
				}
				return [key, scalar(val, key)];
			})
		);
	};
	if (!Array.isArray(value)) return frame(value, true);
	if (value.length > ANIMATION_LIMITS.frames) throw new Error('Animation keyframe count exceeded');
	return value.map((v) => frame(v, false));
}
export function animationArgument(value: unknown, rule: string, receiver: (value: unknown, types: string) => object): unknown {
	const nullable = (type: string) => (v: unknown) => v === null ? null : receiver(v, type);
	const time = (v: unknown) => (v === null ? null : number(v));
	const timing = {
		delay: number,
		endDelay: number,
		duration: (v: unknown) => (v === 'auto' ? v : number(v, 0)),
		iterationStart: (v: unknown) => number(v, 0, 1000),
		iterations: (v: unknown) => number(v, 0, 1000),
		fill: text,
		direction: text,
		easing: text
	};
	const effects = { ...timing, composite: text, iterationComposite: text, pseudoElement: (v: unknown) => (v === null ? null : text(v)) };
	switch (rule) {
		case 'animation-keyframes':
			return animationKeyframes(value);
		case 'animation-element':
			return nullable('Element')(value);
		case 'animation-effect':
			return nullable('AnimationEffect')(value);
		case 'animation-source':
			return receiver(value, 'KeyframeEffect');
		case 'animation-timeline':
			return nullable('AnimationTimeline')(value);
		case 'animation-time':
			return time(value);
		case 'animation-timing':
			return dictionary(value, timing);
		case 'animation-effect-options':
			return typeof value === 'number' ? number(value, 0) : dictionary(value, effects);
		case 'animation-options':
			return typeof value === 'number' ? number(value, 0) : dictionary(value, { ...effects, id: text, timeline: nullable('AnimationTimeline') });
		case 'animation-timeline-options':
			return dictionary(value, { originTime: number });
		case 'animation-query':
			return dictionary(value, { subtree: boolean, pseudoElement: (v) => (v === null ? null : text(v)) });
		case 'animation-event':
			return dictionary(value, { bubbles: boolean, cancelable: boolean, composed: boolean, currentTime: time, timelineTime: time });
	}
	throw new Error('Unregistered animation argument');
}
/** Only native timing/keyframe record-returning methods use this projection. */
export function animationRecord(value: unknown, depth = 0, budget = { count: 0 }): unknown {
	if (++budget.count > 4096 || depth > 8) throw new Error('Animation result budget exceeded');
	if (value === null || ['boolean', 'number', 'undefined'].includes(typeof value)) return value;
	if (typeof value === 'string') return text(value);
	if (Array.isArray(value)) return value.map((v) => animationRecord(v, depth + 1, budget));
	if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
		throw new Error('Expected a native animation record');
	return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, animationRecord(v, depth + 1, budget)]));
}
