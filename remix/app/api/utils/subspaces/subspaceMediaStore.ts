import { bindReadyAttachmentsForPurpose, AttachmentBindingError, PROFILE_ATTACHMENT_CONTENT_TYPES, MAX_PROFILE_ATTACHMENT_BYTES } from '../attachments/attachmentStore';
import { findUserById, userPublicUploadsEnabled } from '../auth/users';
import { SUBSPACE_MEDIA_SLOTS, type parseSubspaceMedia } from './subspaceMediaCore';

export const createSubspaceMediaReconciler = (dependencies = {
  bind: bindReadyAttachmentsForPurpose,
  canUpload: async (ownerId: string) => {
    const user = await findUserById(ownerId);
    return !!user && userPublicUploadsEnabled(user);
  }
}) => async (input: {
  things: any; session: any; actorId: string; current: any;
  branding: Record<string, unknown>; legacyBranding: unknown;
  media: ReturnType<typeof parseSubspaceMedia>; now: Date;
}): Promise<Record<string, unknown>> => {
  const { things, session, actorId, current, branding, legacyBranding, media, now } = input;
  const set: Record<string, unknown> = {};
  for (const slot of SUBSPACE_MEDIA_SLOTS) {
    const mutation = media[slot];
    const legacyEdited = legacyBranding === null || (legacyBranding && typeof legacyBranding === 'object' && `${slot}Url` in legacyBranding);
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
  return set;
};

export const reconcileSubspaceMedia = createSubspaceMediaReconciler();
