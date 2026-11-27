import type { PublicAttachment } from './attachmentTypes';

export type PresentedMedia = { attachment: PublicAttachment; motion?: PublicAttachment };

/** Pair only explicit, complete, unique siblings from this authorized projection. */
export function presentVisualMedia(attachments: readonly PublicAttachment[]): PresentedMedia[] {
	const groups = new Map<string, { photos: PublicAttachment[]; motions: PublicAttachment[] }>();
	for (const attachment of attachments) {
		const pair = attachment.livePhoto;
		if (!pair?.pairId || attachment.url) continue;
		const group = groups.get(pair.pairId) || { photos: [], motions: [] };
		(pair.role === 'photo' ? group.photos : group.motions).push(attachment);
		groups.set(pair.pairId, group);
	}
	const paired = new Map<string, PresentedMedia>();
	for (const group of groups.values()) {
		if (group.photos.length !== 1 || group.motions.length !== 1) continue;
		const [photo] = group.photos;
		const [motion] = group.motions;
		if (photo.mediaKind !== 'image' || motion.mediaKind !== 'video') continue;
		const presentation = { attachment: photo, motion };
		paired.set(photo.id, presentation);
		paired.set(motion.id, presentation);
	}
	const result: PresentedMedia[] = [];
	const seen = new Set<string>();
	for (const attachment of attachments) {
		if (attachment.mediaKind !== 'image' && attachment.mediaKind !== 'video') continue;
		const presentation = paired.get(attachment.id);
		if (presentation) {
			if (seen.has(presentation.attachment.id)) continue;
			seen.add(presentation.attachment.id);
			result.push(presentation);
		} else result.push({ attachment });
	}
	return result;
}
