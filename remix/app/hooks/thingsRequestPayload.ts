type ThingRequestArgs = Record<string, unknown> | null | undefined;

// Capability selection only: 5,000 was the old data-string cap, not a new
// validation limit. Walk iteratively and tolerate aliases/cycles so checking
// an in-progress editor object cannot recurse forever or change its contents.
export const requiresUncappedDataStrings = (input: unknown): boolean => {
	const pending = [input];
	const seen = new WeakSet<object>();
	while (pending.length) {
		const value = pending.pop();
		if (typeof value === 'string' && value.length > 5000) return true;
		if (!value || typeof value !== 'object' || seen.has(value)) continue;
		seen.add(value);
		for (const child of Object.values(value)) pending.push(child);
	}
	return false;
};

// Keep the browser's post vocabulary in one testable transport boundary.
// Rebuilding these payloads field-by-field is intentional (unknown UI fields
// must not reach the API), but every supported post field has to be listed or
// it silently falls back to the plain `text` projection after publication.
export const buildThingCreateRequestPayload = (args: ThingRequestArgs): Record<string, unknown> => {
	const input = args || {};
	const {
		type,
		text,
		richText,
		images,
		listing,
		thing,
		mediaLayout,
		title,
		subspaceId,
		flairId,
		thingtime,
		crystal,
		targetId,
		folderId,
		acl,
		visibility,
		tags,
		tokenAcl,
		attachmentIds,
		shareId,
    geo
	} = input;

	// Unified writes carry rich text inside `crystal`; legacy post writes use
	// the first-class `richText` field beside their canonical text fallback.
	return Array.isArray(thingtime)
		? { thingtime, crystal, targetId, folderId, acl, visibility, tags, tokenAcl, attachmentIds, shareId, ...(geo !== undefined ? { geo } : {}) }
		: { type, text, richText, images, listing, thing, mediaLayout, title, subspaceId, flairId, acl, visibility, tags, attachmentIds, shareId, ...(geo !== undefined ? { geo } : {}) };
};

export const buildThingCommentRequestPayload = (args: ThingRequestArgs): Record<string, unknown> => {
	const input = args || {};
	const { id, text, richText, type, images, listing, thing, mediaLayout, tags, shareId, attachmentIds } = input;
	return { id, text, richText, type, images, listing, thing, mediaLayout, tags, shareId, attachmentIds };
};
