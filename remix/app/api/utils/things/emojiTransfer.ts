import { randomUUID } from 'node:crypto';
import { uploadEmoji, deleteEmoji } from '../messenger/emojis';
import { emojiTransferFile, importedEmojiName } from '../../../utils/thingTransfer/emoji';
import type { ThingTransfer, TransferThing } from '../../../utils/thingTransfer/format';

const defaults = { upload: uploadEmoji, remove: deleteEmoji, uuid: randomUUID };

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
