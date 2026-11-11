import { isTimelinePersistence } from './persistence';
import { StorageMutationError } from '../storage/storageCore';
import { getThingsTransactionBinding, type ThingsReads, type ThingsTransaction } from '../things/persistence';
import { createHash } from 'node:crypto';
import { captureComponentBindings, COMPONENT_BINDING_PREFIX, type ComponentBindings } from '../../../timeline/componentBindings.ts';
import type { TimelineEvent } from '../../../timeline/contract.ts';
import { resolvePageComponentCapture } from '../webpages/webpages';
import { appendTimelineEvent, readTimelineEntries } from './repository.ts';

/** Definitions and page revision commit atomically. Reuse unchanged bindings
 * from the preceding version; never read another account's private Timeline. */
export async function recordPageComponentBindings(things: any, session: any, before: any, after: any, event: TimelineEvent, reads?: ThingsReads) {
	if (!after && before?.thingtime?.includes('webpage') && before.timelineHeadId) {
		const prior = (await readTimelineEntries(things, event.ownerId, [before.timelineHeadId], session))[0];
		if (!prior || prior.event.thingId !== event.thingId) throw new Error("The deleted page's saved version is unavailable");
		// Keep the saved version's existing captures without charging new content
		// during deletion, including when the account is at its storage ceiling.
		return { ...event, dependencies: prior.event.dependencies };
	}
	if (!after?.thingtime?.includes('webpage')) return event;
	if (isTimelinePersistence(things)) {
		if (!reads) throw new StorageMutationError(503, 'storage_invariant', 'Native page capture requires its active content transaction');
		const binding = getThingsTransactionBinding(reads as ThingsTransaction, event.ownerId);
		if (binding.kind !== 'native' || binding.session !== session) throw new StorageMutationError(503, 'storage_invariant', 'Page capture requires the exact native content session');
		things.assertTransaction(binding.session);
	}
	const resolved = await resolvePageComponentCapture(things, session, after, reads);
	const byId = new Map(resolved.components.map((component) => [component.id, component]));
	const bindings: ComponentBindings = Object.create(null);
	for (const [ref, id] of Object.entries(resolved.refs)) bindings[ref] = id ? byId.get(id) ?? null : null;
	const prior = before?.timelineHeadId ? (await readTimelineEntries(things, event.ownerId, [before.timelineHeadId], session))[0]?.event : null;
	const ids = prior?.dependencies.filter((item) => item.thingId.startsWith(COMPONENT_BINDING_PREFIX)).map((item) => item.eventId) ?? [];
	if (ids.length > 120) throw new Error('Invalid previous component capture count');
	const previous = ids.length ? (await readTimelineEntries(things, event.ownerId, ids, session)).map((item) => item.event) : [];
	const captured = captureComponentBindings(event, bindings, previous, (ref) =>
		createHash('sha256')
			.update(event.id + '\0' + ref)
			.digest('hex')
	);
	const known = new Set(previous.map((item) => item.id));
	for (const item of captured.events) if (!known.has(item.id)) await appendTimelineEvent(things, item, session);
	return { ...event, dependencies: captured.dependencies };
}
