import { normalizePublicAttachment } from '~/components/Attachments/attachmentUiCore';
import type { PublicAttachment } from '~/components/Attachments/attachmentTypes';
import type { PublicPost } from '~/components/Feed/feedTypes';

// `/thing/:id` is a generic permalink, so attachment detection must be based
// on its persisted discriminator rather than a filename or MIME heuristic.
// `normalizePublicAttachment` additionally keeps the inline-media allowlist
// intact before a detail page uses a browser media sink.
export const attachmentFromThing = (thing: Record<string, unknown> | null): PublicAttachment | null => {
	if (!thing || !Array.isArray(thing.thingtime) || !thing.thingtime.includes('attachment')) return null;
	const id = typeof thing.id === 'string' ? thing.id : '';
	const crystal = thing.crystal;
	if (!id || !crystal || typeof crystal !== 'object' || Array.isArray(crystal)) return null;
	return normalizePublicAttachment({ id, ...(crystal as Record<string, unknown>) });
};

// An attachment is a relational Thing with one canonical `targetId`. The API
// has already ACL-checked and projected that target as `parent`; keeping the
// list shape here makes the UI honest now and leaves it ready for a future
// multi-reference projection without ever rendering a post as the attachment.
export const directAttachmentReferences = (parent: PublicPost | null): PublicPost[] => (parent ? [parent] : []);
