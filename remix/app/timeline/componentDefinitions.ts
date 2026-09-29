import { copyBoundedJson, type JsonValue } from '../utils/boundedJson.ts';
import type { TimelineSnapshot } from './contract.ts';
import type { VersionChoices, VersionConflict, VersionValue } from './versions.ts';

/** Transient comparison values. An absent map key means the page did not use
 * the ref; present:false means it used the ref but has no recorded definition. */
export type ComponentDefinitionVersion = Record<string, VersionValue>;
export type ComponentDefinitionContext = {
	base: ComponentDefinitionVersion;
	current: ComponentDefinitionVersion;
	incoming: ComponentDefinitionVersion;
	choices: VersionChoices;
};
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const missing: VersionValue = { present: false };
const equal = (a: VersionValue, b: VersionValue) => JSON.stringify(a) === JSON.stringify(b);
export const definitionSnapshot = (value: Record<string, JsonValue>): TimelineSnapshot => ({
	adapter: 'component-bindings',
	version: 1,
	value: copyBoundedJson(value, { maxBytes: 4 * 1024 * 1024, maxDepth: 90, maxNodes: 200_000, sortKeys: true }, 'Component comparison')
});

/** Shared atomic-definition merge for recorded branches and published pages.
 * The caller supplies provenance separately; live values never become fake
 * accepted Timeline events just to participate in a comparison. */
export function mergeComponentDefinitions(context: ComponentDefinitionContext, refs: string[]) {
	const conflicts: VersionConflict[] = [],
		absent: string[] = [];
	const selected: Record<string, 'current' | 'incoming'> = Object.create(null);
	const current: Record<string, JsonValue> = Object.create(null),
		result: Record<string, JsonValue> = Object.create(null);
	const used = new Set<string>();
	for (const [ref, value] of Object.entries(context.current)) if (value.present) current[ref] = value.value;
	for (const ref of refs) {
		const hasCurrent = own(context.current, ref),
			hasIncoming = own(context.incoming, ref);
		const a = own(context.base, ref) ? context.base[ref] : missing;
		const b = hasCurrent ? context.current[ref] : missing,
			c = hasIncoming ? context.incoming[ref] : missing;
		let side: 'current' | 'incoming' = 'current';
		if (!hasCurrent) side = 'incoming';
		else if (!hasIncoming || equal(b, c)) side = 'current';
		else if (a.present && b.present && c.present && equal(a, b)) side = 'incoming';
		else if (a.present && b.present && c.present && equal(a, c)) side = 'current';
		else {
			const key = JSON.stringify([ref]);
			const choice = own(context.choices, key) ? context.choices[key] : undefined;
			if (choice !== undefined) {
				if (choice !== 'current' && choice !== 'incoming') throw new Error('Invalid component conflict choice.');
				used.add(key);
				side = choice;
			} else conflicts.push({ path: [ref], base: a, current: b, incoming: c });
		}
		selected[ref] = side;
		const value = side === 'current' ? b : c;
		if (value.present) result[ref] = value.value;
		else absent.push(ref);
	}
	if (Object.keys(context.choices).some((key) => !used.has(key))) throw new Error('Component conflict choices no longer match this version.');
	return { selected, conflicts, missing: absent, current: definitionSnapshot(current), result: definitionSnapshot(result) };
}

export const componentValues = (version: ComponentDefinitionVersion) =>
	Object.fromEntries(
		Object.entries(version)
			.filter(([, field]) => field.present)
			.map(([ref, field]) => [ref, field.present ? field.value : null])
	);

/** Known historical absence is different from missing history. Materialize
 * a harmless ordinary Component so a future resolver match cannot fill it. */
export const unavailableComponentCrystal = {
	name: 'Unavailable recorded component',
	library: 'custom',
	category: 'general',
	render: { tag: 'p', children: 'This component was unavailable in the recorded version.' }
};
export const previewComponentValues = (version: ComponentDefinitionVersion, placeholders: boolean) =>
	Object.fromEntries(
		Object.entries(componentValues(version)).map(([ref, value]) => [
			ref,
			value === null && placeholders ? { id: 'recorded-unavailable', crystal: unavailableComponentCrystal } : value
		])
	);

/** A restored page has new component references. Match stable block identities
 * before comparing definitions, so a later branch change to the original ref
 * is reviewed instead of disappearing because the copied ref has a new id. */
export function alignDefinitionsToPage(version: ComponentDefinitionVersion, blocks: unknown, resultBlocks: unknown): ComponentDefinitionVersion {
	const collect = (input: unknown) => {
		const found = new Map<string, string>();
		const ids = new Set<string>();
		let visited = 0;
		const walk = (list: unknown, depth: number) => {
			if (!Array.isArray(list)) return;
			if (depth > 24) throw new Error('Page comparison exceeds the nesting limit.');
			for (const block of list) {
				if (++visited > 1200) throw new Error('Page comparison exceeds the block limit.');
				if (!block || typeof block !== 'object') continue;
				if (typeof block.id === 'string') {
					if (ids.has(block.id)) throw new Error('Page comparison has duplicate block identities.');
					ids.add(block.id);
					if (block.type === 'component' && typeof block.component === 'string') found.set(block.id, block.component.trim());
				}
				if (block.type === 'container') walk(block.children, depth + 1);
			}
		};
		walk(input, 0);
		return found;
	};
	const source = collect(blocks),
		result = collect(resultBlocks);
	const aligned: ComponentDefinitionVersion = Object.create(null);
	const chosen = new Map<string, VersionValue>();
	for (const [blockId, ref] of result) {
		const sourceRef = source.get(blockId);
		const field = sourceRef && own(version, sourceRef) ? version[sourceRef] : own(version, ref) ? version[ref] : undefined;
		if (!field) continue;
		if (chosen.has(ref) && !equal(chosen.get(ref)!, field))
			throw new Error('One shared result component has different definitions across blocks. Separate those page references before merging.');
		chosen.set(ref, field);
		aligned[ref] = field;
	}
	return aligned;
}
