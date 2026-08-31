type ThingRequestArgs = Record<string, unknown> | null | undefined;

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
		thingtime,
		crystal,
		targetId,
		folderId,
		acl,
		visibility,
		tags,
		tokenAcl,
		attachmentIds,
		shareId
	} = input;

	// Unified writes carry rich text inside `crystal`; legacy post writes use
	// the first-class `richText` field beside their canonical text fallback.
	return Array.isArray(thingtime)
		? { thingtime, crystal, targetId, folderId, acl, visibility, tags, tokenAcl, attachmentIds, shareId }
		: { type, text, richText, images, listing, thing, mediaLayout, acl, visibility, tags, attachmentIds, shareId };
};

export const buildThingCommentRequestPayload = (args: ThingRequestArgs): Record<string, unknown> => {
	const input = args || {};
	const { id, text, richText, type, images, listing, thing, mediaLayout, tags, shareId, attachmentIds } = input;
	return { id, text, richText, type, images, listing, thing, mediaLayout, tags, shareId, attachmentIds };
};
