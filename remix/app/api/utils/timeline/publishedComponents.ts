import { createHash } from 'node:crypto';
import { copyBoundedJson, type JsonValue } from '../../../utils/boundedJson.ts';
import {
	COMPONENT_BINDING_PREFIX,
	componentBindingSnapshot,
	type CapturedComponent,
	webpageComponentRefs
} from '../../../timeline/componentBindings.ts';
import { componentVersion, componentVersionBindings } from '../../../timeline/componentMerge.ts';
import {
	alignDefinitionsToPage,
	componentValues,
	definitionSnapshot,
	mergeComponentDefinitions,
	unavailableComponentCrystal,
	type ComponentDefinitionVersion
} from '../../../timeline/componentDefinitions.ts';
import type { PublishedComponents, VersionRequest } from '../../../timeline/publishedVersion.ts';
import type { TimelineEvent } from '../../../timeline/contract.ts';
import { resolvePageComponentCapture } from '../webpages/webpages';
import { rewriteComposition } from '../actions/forkCompositionCore';
import { validateThingtimeCrystal } from '../../../schemas/registry';
import { StorageMutationError } from '../storage/storageCore';
import { readRecordedComponentEntries } from './service';

function refuse(message: string): never {
	throw new StorageMutationError(422, 'storage_invariant', message);
}
const hash = (value: unknown) => {
	try {
		return createHash('sha256')
			.update(
				JSON.stringify(
					copyBoundedJson(value, { maxBytes: 16 * 1024 * 1024, maxDepth: 96, maxNodes: 800_000, sortKeys: true }, 'Component comparison')
				)
			)
			.digest('hex');
	} catch {
		throw new StorageMutationError(
			413,
			'storage_invariant',
			'These components are too large to compare together. Their recorded versions remain retained.'
		);
	}
};
const fieldFor = (values: ComponentDefinitionVersion, ref: string) =>
	Object.prototype.hasOwnProperty.call(values, ref) ? values[ref] : { present: false as const };
const fields = (refs: string[], values: Record<string, any>): ComponentDefinitionVersion =>
	Object.fromEntries(
		refs.map((ref) => [
			ref,
			Object.prototype.hasOwnProperty.call(values, ref) ? { present: true, value: values[ref] as JsonValue } : { present: false }
		])
	);

/** Same batched resolver as rendering and mutation capture, including the
 * owner delegation and foreign private-definition fences. */
export async function liveComponentVersion(things: any, session: any, page: any, content: any) {
	const refs = page.thingtime?.includes('webpage') ? webpageComponentRefs(content.crystal?.blocks) : [];
	if (!refs.length) return {};
	const resolved = await resolvePageComponentCapture(things, session, { ...page, crystal: content.crystal });
	const docs = new Map(resolved.components.map((component) => [component.id, component]));
	const result = fields(
		refs,
		Object.fromEntries(
			refs.map((ref) => {
				const doc = docs.get(resolved.refs[ref] ?? '');
				return [ref, (componentBindingSnapshot(ref, doc ? { id: doc.id, crystal: doc.crystal } : null).value as any).component];
			})
		)
	);
	try {
		definitionSnapshot(componentValues(result));
	} catch {
		throw new StorageMutationError(413, 'storage_invariant', 'Current components exceed the comparison budget.');
	}
	return result;
}
export async function liveComponentContext(things: any, session: any, page: any, currentContent: any, resultContent: any) {
	const current = await liveComponentVersion(things, session, page, currentContent);
	const result = await liveComponentVersion(things, session, page, resultContent);
	return { current, result, fingerprint: hash({ current, result }) };
}
export async function recordedComponentVersions(things: any, ownerId: string, sources: { event: TimelineEvent; content: any }[]) {
	if (sources.some(({ event }) => event.dependencies.some((link) => !link.thingId.startsWith(COMPONENT_BINDING_PREFIX))))
		refuse('This version has dependencies this comparison cannot yet restore.');
	const entries = await readRecordedComponentEntries(
		things,
		ownerId,
		sources.flatMap(({ event }) => event.dependencies)
	);
	return sources.map(({ event, content }) => {
		const refs = webpageComponentRefs(content.crystal?.blocks);
		const version = componentVersion(event, content.crystal?.blocks, entries);
		return fields(refs, componentVersionBindings(version, entries));
	});
}
export function comparePublishedComponents(
	request: VersionRequest,
	base: ComponentDefinitionVersion,
	incoming: ComponentDefinitionVersion,
	live: Awaited<ReturnType<typeof liveComponentContext>>,
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
export function planPublishedComponentCopies(operationId: string, content: any, definitions: ComponentDefinitionVersion) {
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
