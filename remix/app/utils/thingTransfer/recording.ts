import type { ThingTransfer, TransferThing } from './format';

export const isTransferRecording = (thing: Pick<TransferThing, 'thingtime'>) =>
  thing.thingtime.length === 1 && thing.thingtime[0] === 'attachment';

export const recordingTransferFile = (thing: TransferThing, manifest: ThingTransfer) => {
  const file = manifest.files.find(entry => entry.id === thing.crystal.recordingFileId);
  if (!isTransferRecording(thing) || Object.keys(thing.crystal).length !== 1 ||
    typeof thing.crystal.recordingFileId !== 'string' || !file || file.targetId !== thing.id ||
    thing.targetId || thing.extended != null || thing.tags?.length ||
    manifest.files.filter(entry => entry.targetId === thing.id).length !== 1 ||
    manifest.links?.some(entry => entry.targetId === thing.id) ||
    manifest.things.some(entry => entry.folderId === thing.id || entry.targetId === thing.id)) {
    throw new Error('A recording transfer requires exactly one stored file, without child Things, gallery links or extra fields');
  }
  return file;
};
