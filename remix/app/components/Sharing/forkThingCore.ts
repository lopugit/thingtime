// Copy content, never account/credential/control records or relationship rows.
// Their dedicated endpoints retain ownership of all lifecycle side effects.
// Keep the browser predicate small: importing the full schema catalog here
// would eagerly load every schema example into the permalink route.
export const FORKABLE_CONTENT_KINDS = ['post', 'data', 'schema', 'component', 'webpage', 'action'] as const;
export const canForkThing = (thing: { thingtime?: string[]; targetId?: unknown }): boolean =>
	!!thing.thingtime?.length && !thing.targetId &&
	thing.thingtime.every((kind) => (FORKABLE_CONTENT_KINDS as readonly string[]).includes(kind));
