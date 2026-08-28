import type { ThingDocument, ThingVisibility } from './runtime';

// Which opener messages actually name the thing the popup is editing.
//
// The runtime posts three message shapes at the bridge. `init` and
// `request-save` carry createBridgePayload() — `{ value, thing }` — and are the
// opener asserting the document it loaded. `state` is a value-only sync: commit,
// undo and redo all post `{ value }` with NO `thing`.
//
// Reading `payload.thing || {}` inline therefore made every host-side edit
// re-project the identity from an empty object, resetting the popup to the
// defaults: a thing the user had set to Private silently went back to `public`
// (public embeds are anonymously readable cross-origin), the name reverted, and
// documentMeta dropped to null so the next confirmed save took the *create*
// branch — a duplicate thing with a fresh shareId instead of the version-checked
// update, orphaning the original and skipping its CAS check.
//
// So: a payload that names no thing returns null, and the popup keeps whatever
// identity `init` / `request-save` / its own last save established.

export type BridgeThingIdentity = {
	name: string;
	visibility: ThingVisibility;
	documentMeta: Pick<ThingDocument, 'id' | 'version'> | null;
};

export const DEFAULT_BRIDGE_THING_NAME = 'Embedded thing';
const MAX_BRIDGE_NAME_CHARS = 120;

export const readBridgeThingIdentity = (payload: unknown): BridgeThingIdentity | null => {
	const thing = (payload as any)?.thing;
	if (!thing || typeof thing !== 'object' || Array.isArray(thing)) return null;

	const version = Number(thing.version);
	// The id/version pair must satisfy saveEmbeddedThing's update contract
	// (non-empty id, version >= 1) or it is not an update — falling back to null
	// takes the create branch instead of posting a save the server must 400.
	const isExistingDocument = typeof thing.id === 'string' && !!thing.id && Number.isSafeInteger(version) && version >= 1;

	return {
		name: typeof thing.name === 'string' && thing.name.trim() ? thing.name.slice(0, MAX_BRIDGE_NAME_CHARS) : DEFAULT_BRIDGE_THING_NAME,
		visibility: thing.visibility === 'private' ? 'private' : 'public',
		documentMeta: isExistingDocument ? { id: thing.id, version } : null
	};
};
