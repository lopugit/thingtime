import { copyBoundedJson } from '../utils/boundedJson.ts';
import { parseTimelineEvent, type TimelineEvent, type TimelineSnapshot } from './contract.ts';

/** Each authored reference is an atomic immutable capture, linked through the
 * ordinary Timeline relation records. No page accumulates a version list. */
export const COMPONENT_BINDING_ADAPTER = 'component-binding';
export const COMPONENT_BINDING_PREFIX = 'timeline-component-';
export const MAX_COMPONENT_BINDINGS = 120;
export type CapturedComponent = { id: string; crystal: Record<string, any> };
export type ComponentBindings = Record<string, CapturedComponent | null>;
export type ComponentBinding = { ref: string; component: CapturedComponent | null };
const validRef = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 128 && !/[$\s]/.test(value);

export function webpageComponentRefs(blocks: unknown): string[] {
	const refs = new Set<string>();
	let visited = 0;
	const walk = (items: unknown, depth: number) => {
		if (!Array.isArray(items)) return;
		if (depth > 24) throw new Error('Page components exceed the nesting limit.');
		for (const raw of items) {
			if (++visited > 1200) throw new Error('Page components exceed the block limit.');
			if (!raw || typeof raw !== 'object') continue;
			if (raw.type === 'component' && typeof raw.component === 'string' && validRef(raw.component.trim())) refs.add(raw.component.trim());
			if (refs.size > MAX_COMPONENT_BINDINGS) throw new Error('Page components exceed the capture limit.');
			if (raw.type === 'container') walk(raw.children, depth + 1);
		}
	};
	walk(blocks, 0);
	return [...refs];
}

/** Deliberately omit authors, ACL/grants, hidden-link keys, credentials and all
 * Mongo envelope fields. This is readable render content, not source history. */
export function componentBindingSnapshot(ref: string, component: CapturedComponent | null): TimelineSnapshot {
	if (
		!validRef(ref) ||
		(component !== null &&
			(!component ||
				typeof component.id !== 'string' ||
				!component.id ||
				!component.crystal ||
				typeof component.crystal !== 'object' ||
				Array.isArray(component.crystal)))
	)
		throw new Error('Invalid captured component');
	return {
		adapter: COMPONENT_BINDING_ADAPTER,
		version: 1,
		value: copyBoundedJson(
			{ ref, component: component === null ? null : { id: component.id, crystal: component.crystal } },
			{ maxBytes: 3 * 1024 * 1024, maxDepth: 80, maxNodes: 90_000, sortKeys: true },
			'Captured component'
		)
	};
}
export function readComponentBinding(event: TimelineEvent): ComponentBinding | null {
	if (!event.thingId.startsWith(COMPONENT_BINDING_PREFIX) || event.after?.adapter !== COMPONENT_BINDING_ADAPTER || event.after.version !== 1)
		return null;
	const value = event.after.value as any;
	if (!value || Object.keys(value).sort().join(',') !== 'component,ref') throw new Error('Invalid component capture');
	const checked = componentBindingSnapshot(value.ref, value.component);
	if (JSON.stringify(checked.value) !== JSON.stringify(event.after.value)) throw new Error('Invalid component capture projection');
	return checked.value as ComponentBinding;
}
export function captureComponentBindings(
	page: TimelineEvent,
	bindings: ComponentBindings,
	previous: TimelineEvent[],
	idForRef: (ref: string) => string
) {
	const reusable = new Map<string, TimelineEvent>();
	for (const event of previous) {
		if (event.ownerId !== page.ownerId) continue;
		const binding = readComponentBinding(event);
		if (binding) reusable.set(binding.ref, event);
	}
	const events: TimelineEvent[] = [];
	for (const [ref, component] of Object.entries(bindings)) {
		if (events.length >= MAX_COMPONENT_BINDINGS) throw new Error('Too many captured components.');
		const after = componentBindingSnapshot(ref, component);
		const old = reusable.get(ref);
		if (old && JSON.stringify(old.after?.value) === JSON.stringify(after.value)) {
			events.push(old);
			continue;
		}
		const id = idForRef(ref);
		events.push(
			parseTimelineEvent({
				...page,
				id,
				thingId: COMPONENT_BINDING_PREFIX + id,
				branchId: 'captures',
				parentIds: [],
				operation: 'create',
				label: `Captured component ${ref}`,
				before: null,
				after,
				dependencies: []
			})
		);
	}
	return { events, dependencies: events.map((event) => ({ thingId: event.thingId, eventId: event.id })) };
}
export function bindingsForBlocks(blocks: unknown, components: ComponentBindings): ComponentBindings {
	const out: ComponentBindings = Object.create(null);
	// A missing property means not loaded/recorded. Explicit null means the
	// resolver confirmed the reference was unavailable at capture time.
	for (const ref of webpageComponentRefs(blocks)) if (Object.prototype.hasOwnProperty.call(components, ref)) out[ref] = components[ref];
	return out;
}
export function capturedComponentBindings(page: TimelineEvent, entries: TimelineEvent[], blocks: unknown) {
	const expected = new Map(
		page.dependencies.filter((item) => item.thingId.startsWith(COMPONENT_BINDING_PREFIX)).map((item) => [item.eventId, item.thingId])
	);
	const refs = webpageComponentRefs(blocks);
	const wanted = new Set(refs);
	const components: ComponentBindings = Object.create(null);
	for (const event of entries) {
		if (event.ownerId !== page.ownerId || expected.get(event.id) !== event.thingId) throw new Error('Component capture belongs to another version.');
		const binding = readComponentBinding(event);
		if (!binding) throw new Error('Invalid component dependency.');
		if (Object.prototype.hasOwnProperty.call(components, binding.ref)) throw new Error('Duplicate captured component reference.');
		if (wanted.has(binding.ref)) components[binding.ref] = binding.component;
	}
	return { components, missing: refs.filter((ref) => !Object.prototype.hasOwnProperty.call(components, ref)) };
}
