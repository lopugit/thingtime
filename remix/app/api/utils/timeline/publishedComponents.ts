import {
	createPublishedComponentTools,
	componentDefinitionFields as fields,
	componentComparisonText
} from '../../../timeline/publishedComponentTools.ts';
import { createHash } from 'node:crypto';
import { COMPONENT_BINDING_PREFIX, componentBindingSnapshot, webpageComponentRefs } from '../../../timeline/componentBindings.ts';
import { componentVersion, componentVersionBindings } from '../../../timeline/componentMerge.ts';
import { componentValues, definitionSnapshot } from '../../../timeline/componentDefinitions.ts';
import type { TimelineEvent } from '../../../timeline/contract.ts';
import { resolvePageComponentCapture } from '../webpages/webpages';
import { StorageMutationError } from '../storage/storageCore';
import { readRecordedComponentEntries } from './service';

function refuse(message: string): never {
	throw new StorageMutationError(422, 'storage_invariant', message);
}
const hash = (value: unknown) => {
	try {
		return createHash('sha256').update(componentComparisonText(value)).digest('hex');
	} catch {
		throw new StorageMutationError(
			413,
			'storage_invariant',
			'These components are too large to compare together. Their recorded versions remain retained.'
		);
	}
};
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

export const { comparePublishedComponents, planPublishedComponentCopies } = createPublishedComponentTools(hash, refuse);
