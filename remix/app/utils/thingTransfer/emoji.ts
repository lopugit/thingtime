import { EMOJI_NAME_PATTERN } from '../../schemas/registry';
import type { ThingTransfer, TransferThing } from './format';

export const isTransferEmoji = (thing: Pick<TransferThing, 'thingtime'>): boolean =>
  thing.thingtime.length === 1 && thing.thingtime[0] === 'custom-emoji';

/** Portable content only: scope, membership, uniqueness keys and image
 * authority are recreated by the dedicated emoji writer, never restored. */
export const emojiTransferFile = (thing: TransferThing, manifest: ThingTransfer) => {
  const file = manifest.files.find(entry => entry.id === thing.crystal.emojiFileId);
  if (!isTransferEmoji(thing) || typeof thing.crystal.name !== 'string' ||
    thing.crystal.name !== thing.crystal.name.trim() || !EMOJI_NAME_PATTERN.test(thing.crystal.name) ||
    Object.keys(thing.crystal).some(key => key !== 'name' && key !== 'emojiFileId') ||
    typeof thing.crystal.emojiFileId !== 'string' || !file || file.targetId !== thing.id ||
    thing.targetId || thing.extended != null || thing.tags?.length ||
    manifest.files.filter(entry => entry.targetId === thing.id).length !== 1 ||
    manifest.links?.some(entry => entry.targetId === thing.id) ||
    manifest.things.some(entry => entry.folderId === thing.id || entry.targetId === thing.id)) {
    throw new Error('An emoji transfer requires a name and exactly one stored image, without community scope, child Things or gallery links');
  }
  // The upload service performs authoritative MIME sniffing and storage
  // checks. This is an early archive check, not permission to bind an object.
  if (!['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mime) ||
    !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 512 * 1024) {
    throw new Error('Custom emoji images must be GIF, PNG, JPEG or WebP files up to 512 KiB');
  }
  return file;
};

/** Never overwrite a recipient's existing :name:. The canonical writer
 * still arbitrates collisions; a failed import may not replace any emoji. */
export const importedEmojiName = (name: string, suffix: string): string => {
  if (name !== name.trim() || !EMOJI_NAME_PATTERN.test(name) || suffix.length !== 8 || !/^[a-z0-9]{8}$/.test(suffix)) {
    throw new Error('Invalid imported emoji name');
  }
  return `${name.slice(0, 23)}-${suffix}`;
};
