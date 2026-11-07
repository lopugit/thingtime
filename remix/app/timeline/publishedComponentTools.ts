import { copyBoundedJson, type JsonValue } from '../utils/boundedJson.ts';
import type { CapturedComponent } from './componentBindings.ts';
import {
	alignDefinitionsToPage,
	mergeComponentDefinitions,
	unavailableComponentCrystal,
	type ComponentDefinitionVersion
} from './componentDefinitions.ts';
import type { PublishedComponents, VersionRequest } from './publishedVersion.ts';
import { rewriteComposition } from '../api/utils/actions/forkCompositionCore.ts';
import { validateThingtimeCrystal } from '../schemas/registry';
/** Canonical hash preimage shared by browser WebCrypto and the server. */
export const componentComparisonText = (value: unknown) =>
	JSON.stringify(copyBoundedJson(value, { maxBytes: 16 * 1024 * 1024, maxDepth: 96, maxNodes: 800_000, sortKeys: true }, 'Component comparison'));
const fieldFor = (values: ComponentDefinitionVersion, ref: string) =>
	Object.prototype.hasOwnProperty.call(values, ref) ? values[ref] : { present: false as const };
export const componentDefinitionFields = (refs: string[], values: Record<string, any>): ComponentDefinitionVersion =>
	Object.fromEntries(
		refs.map((ref) => [
			ref,
			Object.prototype.hasOwnProperty.call(values, ref) ? { present: true, value: values[ref] as JsonValue } : { present: false }
		])
	);

/** No storage or account access. Hashing is supplied by each runtime; comparison
 * uses hashes only for equality/counting and copies use the exact SHA-256 IDs. */
export function createPublishedComponentTools(hash: (value: unknown) => string, refuse: (message: string) => never) {
	function comparePublishedComponents(
		request: VersionRequest,
		base: ComponentDefinitionVersion,
		incoming: ComponentDefinitionVersion,
		live: { current: ComponentDefinitionVersion; result: ComponentDefinitionVersion; fingerprint: string },
		refs: string[],
		pages?: { base: any; current: any; incoming: any; result: any }
	): PublishedComponents {
		let result: ComponentDefinitionVersion;
		let conflicts: PublishedComponents['conflicts'] = [];
		if (request.componentMode === 'current') result = live.result;
		else if (request.mode === 'restore') result = Object.fromEntries(refs.map((ref) => [ref, fieldFor(incoming, ref)]));
		else {
			const align = (version: ComponentDefinitionVersion, side: 'base' | 'current' | 'incoming') =>
				pages ? alignDefinitionsToPage(version, pages[side]?.crystal?.blocks, pages.result?.crystal?.blocks) : version;
			const aligned = { base: align(base, 'base'), current: align(live.current, 'current'), incoming: align(incoming, 'incoming') };
			const merged = mergeComponentDefinitions({ ...aligned, choices: request.componentChoices ?? {} }, refs);
			conflicts = merged.conflicts;
			result = Object.fromEntries(refs.map((ref) => [ref, fieldFor(aligned[merged.selected[ref]], ref)]));
		}
		const missing = Object.entries(result)
			.filter(([, field]) => !field.present)
			.map(([ref]) => ref)
			.sort();
		const unavailable = Object.entries(result)
			.filter(([, field]) => field.present && field.value === null)
			.map(([ref]) => ref)
			.sort();
		// Known absence becomes an inert placeholder; missing history is refused.
		const copyCount =
			request.componentMode === 'recorded'
				? new Set(
						Object.values(result)
							.filter((field) => field.present)
							.map((field) => hash(field))
				  ).size
				: 0;
		return { current: live.current, incoming, result, conflicts, missing, unavailable, copyCount, fingerprint: live.fingerprint };
	}

	/** New identities are derived once from the operation and content. A fresh
	 * componentKey prevents owner-local references on other pages changing. */
	function planPublishedComponentCopies(operationId: string, content: any, definitions: ComponentDefinitionVersion) {
		const copies = new Map<string, { shareId: string; crystal: Record<string, unknown> }>();
		const mapping = new Map<string, string>();
		for (const [ref, field] of Object.entries(definitions)) {
			if (!field.present) refuse('Some component definitions were not recorded. Choose current components or another version before restoring.');
			const component = field.value as CapturedComponent | null;
			const identity = 'restored-' + hash({ operationId, component }).slice(0, 48);
			const checked = validateThingtimeCrystal(['component'], {
				...(component?.crystal ?? unavailableComponentCrystal),
				componentKey: identity,
				version: 1,
				...(component ? { forkOf: component.id } : {})
			});
			if (checked.ok === false) refuse('A recorded component no longer passes validation. Choose another version.');
			copies.set(identity, { shareId: identity, crystal: checked.crystal });
			mapping.set(ref, identity);
		}
		return {
			copies: [...copies.values()],
			content: {
				...content,
				crystal: rewriteComposition(['webpage'], content.crystal, (kind, ref) => (kind === 'component' ? mapping.get(ref.trim()) ?? ref : ref))
			}
		};
	}

	return { comparePublishedComponents, planPublishedComponentCopies };
}
