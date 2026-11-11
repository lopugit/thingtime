import { randomUUID } from 'node:crypto';
import { uploadEmoji, deleteEmoji, emojiImageToString } from '../messenger/emojis';
import { getHomeThingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { EMOJI_NAME_PATTERN } from '../../../schemas/registry';
import { emojiTransferFile, importedEmojiName } from '../../../utils/thingTransfer/emoji';
import type { ThingTransfer, TransferThing } from '../../../utils/thingTransfer/format';

const defaults = { upload: uploadEmoji, remove: deleteEmoji, uuid: randomUUID };

export type TransferEmojiSource = {
  thing: TransferThing;
  attachmentId?: string;
  inlineImage?: { base64: string; mime: string; bytes: number; name: string };
};

const readers = { collection: getHomeThingsCollection, custom: isCustomMongoEndpointActive };
/** Owner-only export, including legacy inline images. Import never rejoins
 * the source community or copies its uniqueness key or creator identity. */
export const readTransferEmoji = async (ownerId: string | undefined, id: string, deps = readers): Promise<TransferEmojiSource | null> => {
  if (!ownerId || deps.custom()) return null;
  const doc = await (await deps.collection()).findOne({ ownerId, shareId: id, thingtime: ['custom-emoji'] } as any);
  if (!doc || String(doc.ownerId) !== ownerId || doc.appId != null || doc.sandbox != null ||
    doc.sandboxSpace != null || doc.moderation?.status === 'blocked') return null;
  return projectTransferEmojiSource(doc, id, true);
};

/** Content projection only, never authorization. Callers must authorize the
 * source first; shared history must not retain someone else's folder placement. */
export const projectTransferEmojiSource = (doc: any, id: string, includeFolder = false): TransferEmojiSource => {
  const name = doc.crystal?.name;
  if (typeof name !== 'string' || name !== name.trim() || !EMOJI_NAME_PATTERN.test(name)) throw new Error('This emoji has an invalid name');
  const thing: TransferThing = { id, thingtime: ['custom-emoji'], crystal: { name, emojiFileId: 'pending' },
    ...(includeFolder && typeof doc.folderId === 'string' && doc.folderId ? { folderId: doc.folderId } : {}) };
  if (typeof doc.emojiAttachmentId === 'string' && doc.emojiAttachmentId) return { thing, attachmentId: doc.emojiAttachmentId };
  const image = emojiImageToString(doc.crystal?.image);
  if (image.length > 700 * 1024) throw new Error('Legacy emoji image is too large');
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match || match[0].length !== image.length) throw new Error('Legacy emoji image is invalid');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 512 * 1024 || bytes.toString('base64') !== match[2]) throw new Error('Legacy emoji image is invalid');
  return { thing, inlineImage: { base64: match[2], mime: match[1], bytes: bytes.length, name: `${name}.${match[1].slice(6)}` } };
};

/** Only the server chooses the attempt ID. The writer validates and binds
 * the fresh upload transactionally; never mint an emoji with generic CRUD. */
export const createTransferEmoji = async (
  ownerId: string, thing: TransferThing, manifest: ThingTransfer, uploadedId: string, deps = defaults
) => {
  if (!ownerId || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(uploadedId) || uploadedId !== uploadedId.trim()) {
    throw new Error('A signed-in owner and uploaded emoji image are required');
  }
  const file = emojiTransferFile(thing, manifest);
  const id = deps.uuid();
  return deps.upload(ownerId, {
    name: importedEmojiName(thing.crystal.name as string, id.slice(0, 8)),
    attachmentId: uploadedId
  }, { id, bytes: file.bytes, mime: file.mime });
};

export const removeTransferEmoji = (ownerId: string, id: string) => defaults.remove(ownerId, { id });
