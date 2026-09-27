import { copyBoundedJson, type JsonValue } from '../utils/boundedJson.ts';
import { parseTimelineEntry, type TimelineDependency, type TimelineEntry, type TimelineEvent, type TimelineSnapshot } from './contract.ts';
import { COMPONENT_BINDING_PREFIX, MAX_COMPONENT_BINDINGS, readComponentBinding, webpageComponentRefs } from './componentBindings.ts';
import type { VersionChoices, VersionConflict, VersionValue } from './versions.ts';

/** Bounded comparison transport only. Definitions remain separate canonical
 * events; these maps are never stored on a Thing or Timeline record. */
export type ComponentVersion = Record<string, TimelineDependency | null>;
export type ComponentMergeContext = {
	base: ComponentVersion;
	current: ComponentVersion;
	incoming: ComponentVersion;
	entries: TimelineEntry[];
	choices: VersionChoices;
};
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: unknown, expected: string[]) =>
	record(value) && Object.keys(value).length === expected.length && expected.every((key) => own(value, key));
export const componentBlocks = (snapshot: TimelineSnapshot) => (snapshot.value as any)?.crystal?.blocks ?? [];

export function componentVersion(event: TimelineEvent, blocks: unknown, entries: TimelineEntry[]): ComponentVersion {
	const byId = new Map(entries.map((entry) => [entry.event.id, entry.event]));
	const recorded = new Map<string, TimelineDependency>();
	for (const link of event.dependencies) {
		if (!link.thingId.startsWith(COMPONENT_BINDING_PREFIX)) throw new Error('This version has dependencies this comparison cannot yet merge.');
		const capture = byId.get(link.eventId);
		if (!capture || capture.ownerId !== event.ownerId || capture.thingId !== link.thingId) throw new Error('A recorded component is unavailable.');
		const binding = readComponentBinding(capture);
		if (!binding || recorded.has(binding.ref)) throw new Error('Invalid recorded component links.');
		recorded.set(binding.ref, link);
	}
	return Object.fromEntries(webpageComponentRefs(blocks).map((ref) => [ref, recorded.get(ref) ?? null]));
}

export function parseComponentMergeContext(
	input: unknown,
	ownerId: string,
	current: TimelineSnapshot,
	incoming: TimelineSnapshot,
	choices: VersionChoices
): ComponentMergeContext {
	if (!keys(input, ['base', 'current', 'incoming', 'entries', 'choices'])) throw new Error('Invalid component comparison.');
	const value = input as ComponentMergeContext;
	if (
		!Array.isArray(value.entries) ||
		value.entries.length > MAX_COMPONENT_BINDINGS * 3 ||
		!record(value.choices) ||
		Object.keys(value.choices).length !== Object.keys(choices).length ||
		Object.keys(choices).some((key) => !own(value.choices, key) || value.choices[key] !== choices[key])
	)
		throw new Error('Invalid component comparison choices.');
	const entries = value.entries.map(parseTimelineEntry);
	const byId = new Map(entries.map((entry) => [entry.event.id, entry.event]));
	if (byId.size !== entries.length || entries.some((entry) => entry.event.ownerId !== ownerId || !readComponentBinding(entry.event)))
		throw new Error('Invalid component comparison records.');
	const used = new Set<string>();
	for (const side of ['base', 'current', 'incoming'] as const) {
		const version = value[side];
		if (!record(version) || Object.keys(version).length > MAX_COMPONENT_BINDINGS) throw new Error('Invalid component comparison references.');
		for (const [ref, link] of Object.entries(version)) {
			if (!ref || ref.length > 128 || /[$\s]/.test(ref)) throw new Error('Invalid component comparison reference.');
			if (link === null) continue;
			if (!keys(link, ['thingId', 'eventId'])) throw new Error('Invalid component comparison link.');
			const event = byId.get(link.eventId);
			if (!event || event.thingId !== link.thingId || readComponentBinding(event)?.ref !== ref)
				throw new Error('Component comparison link does not match its record.');
			used.add(event.id);
		}
	}
	for (const [side, snapshot] of [
		['current', current],
		['incoming', incoming]
	] as const) {
		if (JSON.stringify(Object.keys(value[side]).sort()) !== JSON.stringify(webpageComponentRefs(componentBlocks(snapshot)).sort()))
			throw new Error('Component comparison belongs to another page.');
	}
	if (used.size !== entries.length) throw new Error('Unrelated component comparison records.');
	return { ...value, entries };
}

export function componentVersionBindings(version: ComponentVersion, entries: TimelineEntry[]) {
	const events = new Map(entries.map((entry) => [entry.event.id, entry.event]));
	const result: Record<string, any> = Object.create(null);
	for (const [ref, link] of Object.entries(version)) {
		const event = link && events.get(link.eventId);
		const binding = event && readComponentBinding(event);
		if (binding) result[ref] = binding.component;
	}
	return result;
}

/** Merge each definition as an atomic version. Identical definitions with
 * different capture identities agree. Missing history is never an inferred
 * deletion, and removed page references never retain obsolete dependencies. */
export function mergeComponentVersions(context: ComponentMergeContext, result: TimelineSnapshot) {
	const events = new Map(context.entries.map((entry) => [entry.event.id, entry.event]));
	const valueFor = (link: TimelineDependency | null | undefined): VersionValue => {
		if (!link) return { present: false };
		const event = events.get(link.eventId);
		const binding = event && readComponentBinding(event);
		if (!binding || event!.thingId !== link.thingId) throw new Error('A recorded component is unavailable.');
		return { present: true, value: binding.component as JsonValue };
	};
	const equal = (left: VersionValue, right: VersionValue) => JSON.stringify(left) === JSON.stringify(right);
	const conflicts: VersionConflict[] = [];
	const dependencies: TimelineDependency[] = [];
	const missing: string[] = [];
	const used = new Set<string>();
	const currentValues: Record<string, JsonValue> = Object.create(null);
	const resultValues: Record<string, JsonValue> = Object.create(null);
	for (const ref of Object.keys(context.current)) {
		const value = valueFor(context.current[ref]);
		if (value.present) currentValues[ref] = value.value;
	}
	for (const ref of webpageComponentRefs(componentBlocks(result))) {
		const hasCurrent = own(context.current, ref);
		const hasIncoming = own(context.incoming, ref);
		const a = valueFor(own(context.base, ref) ? context.base[ref] : null);
		const b = valueFor(hasCurrent ? context.current[ref] : null);
		const c = valueFor(hasIncoming ? context.incoming[ref] : null);
		let link: TimelineDependency | null = null;
		if (!hasCurrent) link = hasIncoming ? context.incoming[ref] : null;
		else if (!hasIncoming || equal(b, c)) link = context.current[ref];
		else if (a.present && b.present && c.present && equal(a, b)) link = context.incoming[ref];
		else if (a.present && b.present && c.present && equal(a, c)) link = context.current[ref];
		else {
			const key = JSON.stringify([ref]);
			const choice = own(context.choices, key) ? context.choices[key] : undefined;
			if (choice !== undefined) {
				if (choice !== 'current' && choice !== 'incoming') throw new Error('Invalid component conflict choice.');
				used.add(key);
				link = choice === 'current' ? context.current[ref] : context.incoming[ref];
			} else {
				conflicts.push({ path: [ref], base: a, current: b, incoming: c });
				link = context.current[ref];
			}
		}
		const value = valueFor(link);
		if (link && value.present) {
			dependencies.push(link);
			resultValues[ref] = value.value;
		} else missing.push(ref);
	}
	if (Object.keys(context.choices).some((key) => !used.has(key))) throw new Error('Component conflict choices no longer match this version.');
	const snapshot = (value: Record<string, JsonValue>): TimelineSnapshot => ({
		adapter: 'component-bindings',
		version: 1,
		value: copyBoundedJson(value, { maxBytes: 4 * 1024 * 1024, maxDepth: 90, maxNodes: 200_000, sortKeys: true }, 'Component comparison')
	});
	return { dependencies, conflicts, missing, current: snapshot(currentValues), result: snapshot(resultValues) };
}
