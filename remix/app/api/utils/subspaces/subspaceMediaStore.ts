import { bindReadyAttachmentsForPurpose, AttachmentBindingError, PROFILE_ATTACHMENT_CONTENT_TYPES, MAX_PROFILE_ATTACHMENT_BYTES } from '../attachments/attachmentStore';
import { findUserById, userPublicUploadsEnabled } from '../auth/users';
import {
  SUBSPACE_MEDIA_SLOTS, subspaceMediaUrl,
  type SubspaceMediaPresentation, type SubspaceMediaPresentationSources, type SubspaceMediaSlot, type parseSubspaceMedia
} from './subspaceMediaCore';

const legacyBrandingTouchesSlot = (branding: unknown, slot: SubspaceMediaSlot) =>
  branding === null || (!!branding && typeof branding === 'object' && `${slot}Url` in branding);

export const createSubspaceMediaReconciler = (dependencies = {
  bind: bindReadyAttachmentsForPurpose,
  canUpload: async (ownerId: string) => {
    const user = await findUserById(ownerId);
    return !!user && userPublicUploadsEnabled(user);
  }
}) => async (input: {
  things: any; session: any; actorId: string; current: any;
  branding: Record<string, unknown>; legacyBranding: unknown;
  media: ReturnType<typeof parseSubspaceMedia>; presentation?: SubspaceMediaPresentation;
  presentationSources?: SubspaceMediaPresentationSources; now: Date;
}): Promise<Record<string, unknown>> => {
  const { things, session, actorId, current, branding, legacyBranding, media, now } = input;
  for (const slot of SUBSPACE_MEDIA_SLOTS) {
    const expectedSource = input.presentationSources?.[slot];
    if (expectedSource === undefined) continue;
    const mutation = media[slot];
    if (input.presentation?.[slot] === undefined || (mutation && mutation.kind !== 'preserve') || legacyBrandingTouchesSlot(legacyBranding, slot)) {
      throw new AttachmentBindingError(400, `An expected ${slot} source requires a presentation edit without a replacement`);
    }
    if (expectedSource !== subspaceMediaUrl(current, slot)) {
      throw new AttachmentBindingError(409, `The ${slot} image changed while you were editing. Reload and try again.`);
    }
  }
  const set: Record<string, unknown> = {};
  for (const slot of SUBSPACE_MEDIA_SLOTS) {
    const mutation = media[slot];
    const legacyEdited = legacyBrandingTouchesSlot(legacyBranding, slot);
    if (mutation?.kind === 'preserve' || (!mutation && !legacyEdited)) continue;
    const field = `${slot}AttachmentId`;
    const previous = current[field];
    let next: string | null = null;
    if (mutation?.kind === 'attachment') {
      if (!await dependencies.canUpload(actorId)) throw new AttachmentBindingError(403, 'Public image uploads need approval');
      const image = await things.findOne({ shareId: mutation.attachmentId, ownerId: actorId, thingtime: 'attachment' }, { session });
      if (!image || image.crystal?.mediaKind !== 'image' || !PROFILE_ATTACHMENT_CONTENT_TYPES.has(image.crystal.contentType) || !Number.isSafeInteger(image.objectSizeBytes) || image.objectSizeBytes < 1 || image.objectSizeBytes > MAX_PROFILE_ATTACHMENT_BYTES || image.crystal.size !== image.objectSizeBytes) throw new AttachmentBindingError(400, 'Choose a supported raster image up to 64 MiB');
      await dependencies.bind(actorId, [mutation.attachmentId], current.shareId, session, `subspace-${slot}`, 1);
      next = mutation.attachmentId;
      branding[`${slot}Url`] = null;
    } else if (mutation?.kind === 'external') branding[`${slot}Url`] = mutation.url;
    else if (mutation?.kind === 'clear') branding[`${slot}Url`] = null;
    set[field] = next;
    // Replaced bytes remain billed until the normal draft reaper deletes the
    // exact S3 version. Unbinding revokes target access immediately.
    if (previous && previous !== next) await things.updateOne(
      { shareId: previous, targetId: current.shareId, attachmentPurpose: `subspace-${slot}` },
      { $set: { attachmentExpiresAt: now, updatedAt: now, acl: ['tt:user'] }, $unset: { targetId: '' } },
      { session }
    );
  }
  // Presentation belongs to the image currently bound to the slot. An edit
  // alone never binds, unbinds, or needs permission to upload an attachment.
  const nextSource = { ...current, ...set, crystal: { ...current.crystal, branding } };
  for (const slot of SUBSPACE_MEDIA_SLOTS) {
    const nextUrl = subspaceMediaUrl(nextSource, slot);
    const presentation = input.presentation?.[slot];
    const key = `${slot}Presentation`;
    if (presentation && !nextUrl) throw new AttachmentBindingError(400, `Choose a ${slot} image before editing its presentation`);
    if (presentation) branding[key] = presentation;
    else if (presentation === null || !nextUrl || nextUrl !== subspaceMediaUrl(current, slot)) delete branding[key];
  }
  return set;
};

export const reconcileSubspaceMedia = createSubspaceMediaReconciler();
