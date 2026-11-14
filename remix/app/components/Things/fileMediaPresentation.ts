import { hasRenderComponent } from '../Thingtime/renderComponentDeclaration';
import { attachmentFromThing } from './thingAttachmentDetailCore';
import type { PublicAttachment } from '../Attachments/attachmentTypes';

export type MediaThing = { id: string; thingtime: string[]; crystal?: Record<string, unknown>; targetId?: string | null; executionHeld?: boolean };
export type FileMediaReference = { attachmentId: string; version: string; size: number; name: string };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function fileMediaReference(thing: MediaThing): FileMediaReference | null {
  const crystal = thing.crystal;
  // A declared renderer owns presentation, including explicit null/invalid.
  // Symlinks and trashed files must not cause a read of their old contents.
  if (!thing.thingtime.includes('file') || !crystal || hasRenderComponent(crystal) || crystal.trashed || crystal.symbolicLink || !record(crystal.content)) return null;
  const { attachmentId, version, size } = crystal.content;
  if (typeof attachmentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(attachmentId) ||
    typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version) || !Number.isSafeInteger(size) || Number(size) < 0) return null;
  return { attachmentId, version, size: Number(size), name: typeof crystal.name === 'string' ? crystal.name : 'File' };
}

export function fileMediaAttachment(thing: MediaThing, referenced: unknown): PublicAttachment | null {
  const ref = fileMediaReference(thing);
  if (!ref || !record(referenced) || referenced.id !== ref.attachmentId || referenced.targetId !== thing.id) return null;
  const attachment = attachmentFromThing(referenced);
  if (!attachment || attachment.url || attachment.size !== ref.size) return null;
  return { ...attachment, name: ref.name };
}

export const fileMediaPresentation = (attachment: PublicAttachment, thumbnail = false, version?: string) => ({
  attachments: [attachment],
  renderComponent: { name: 'File media', render: thumbnail && attachment.mediaKind === 'image' && !attachment.nsfw
    ? { tag: 'img', props: { src: `/api/v1/attachments/content?id=${encodeURIComponent(attachment.id)}`, alt: attachment.description || attachment.name,
      loading: 'lazy', style: { display: 'block', width: '100%', height: '100%', maxHeight: '150px', objectFit: 'contain', borderRadius: '8px' } } }
    : { tag: 'tt-media', props: { attachments: { ttArg: 'attachments' }, ...(version ? { contentVersion: version } : {}) } } }
});
