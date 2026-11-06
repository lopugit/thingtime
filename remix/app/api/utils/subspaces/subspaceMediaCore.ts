import { attachmentContentPath } from '../../../utils/attachmentContentUrl';
import { isExternalProfileImageUrl, type ProfileMediaMutation } from '../../../components/Profile/profileMediaCore';

export const SUBSPACE_MEDIA_SLOTS = ['icon', 'banner'] as const;
export type SubspaceMediaSlot = (typeof SUBSPACE_MEDIA_SLOTS)[number];
export const subspaceMediaUrl = (doc: any, slot: SubspaceMediaSlot): string | null =>
  typeof doc?.[`${slot}AttachmentId`] === 'string' && doc[`${slot}AttachmentId`]
    ? attachmentContentPath(doc[`${slot}AttachmentId`])
    : doc?.crystal?.branding?.[`${slot}Url`] ?? null;

export const parseSubspaceMedia = (value: unknown): Partial<Record<SubspaceMediaSlot, ProfileMediaMutation>> => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('media must be an object');
  const result: Partial<Record<SubspaceMediaSlot, ProfileMediaMutation>> = {};
  for (const [slot, raw] of Object.entries(value)) {
    if (!SUBSPACE_MEDIA_SLOTS.includes(slot as SubspaceMediaSlot) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid subspace image slot');
    const item = raw as Record<string, unknown>;
    const keys = Object.keys(item);
    if ((item.kind === 'preserve' || item.kind === 'clear') && keys.length === 1) result[slot as SubspaceMediaSlot] = { kind: item.kind };
    else if (item.kind === 'external' && keys.length === 2 && isExternalProfileImageUrl(item.url)) result[slot as SubspaceMediaSlot] = { kind: 'external', url: (item.url as string).trim() };
    else if (item.kind === 'attachment' && keys.length === 2 && typeof item.attachmentId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(item.attachmentId)) result[slot as SubspaceMediaSlot] = { kind: 'attachment', attachmentId: item.attachmentId };
    else throw new Error('Choose a valid image upload or http(s) URL');
  }
  return result;
};

// Branding is public directory identity even for private subspaces. Exact
// current slot binding is required; replaced images immediately lose access.
export const subspaceAttachmentTargetAllows = (attachment: { shareId: string; targetId?: string; attachmentPurpose?: string }, target: any): boolean => {
  const slot = attachment.attachmentPurpose === 'subspace-icon' ? 'icon' : attachment.attachmentPurpose === 'subspace-banner' ? 'banner' : null;
  return !!slot && !!target && Array.isArray(target.thingtime) && target.thingtime.length === 1 && target.thingtime[0] === 'subspace' && target.shareId === attachment.targetId && target[`${slot}AttachmentId`] === attachment.shareId;
};
