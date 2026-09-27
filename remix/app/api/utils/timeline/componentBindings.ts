import { createHash } from 'node:crypto';
import { captureComponentBindings, COMPONENT_BINDING_PREFIX, type ComponentBindings } from '../../../timeline/componentBindings.ts';
import type { TimelineEvent } from '../../../timeline/contract.ts';
import { resolvePageComponentCapture } from '../webpages/webpages';
import { appendTimelineEvent, readTimelineEntries } from './repository.ts';

/** Definitions and page revision commit atomically. Reuse unchanged bindings
 * from the preceding version; never read another account's private Timeline. */
export async function recordPageComponentBindings(things: any, session: any, before: any, after: any, event: TimelineEvent) {
	if (!after?.thingtime?.includes('webpage')) return event;
	const resolved = await resolvePageComponentCapture(things, session, after);
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
