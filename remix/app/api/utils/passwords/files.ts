import { isDeepStrictEqual } from 'node:util';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { updateAccountedThing, HOME_ACCOUNTED_STORAGE_OPTIONS } from '../storage/accountedThings';
import { createAttachmentService } from '../attachments/attachments';
import { withUserVaultKey } from '../auth/vaultKeys';
import { openVaultValue, sealVaultValue } from '../auth/vaultEnvelope';
import { PASSWORD_ENTRY_KIND, validPasswordId } from '~/passwords/model';
import { passwordFileCipherSize, validatePasswordFile } from '~/passwords/fileCrypto';
import { PasswordManagerError, PASSWORD_STORAGE_DOCUMENT_BYTES } from './passwords';
const entryMatch = (ownerId: string, id: string) => ({ ownerId, shareId: id, thingtime: PASSWORD_ENTRY_KIND, passwordDeleted: { $ne: true } });
const fileMatch = (ownerId: string, id?: string) => ({ ownerId, thingtime: 'attachment', attachmentPurpose: 'password', ...(id ? { shareId: id } : {}) });
const service = createAttachmentService({ passwordVault: true, canViewTarget: async (viewer, doc) => !!viewer?.id && !!doc.targetId && !!await (await getHomeThingsCollection()).findOne(entryMatch(viewer.id, doc.targetId), { projection: { _id: 1 } }) });
const checked = <T extends { ok: boolean; status?: number; error?: string }>(result: T): T => { if (!result.ok) throw new PasswordManagerError(result.status || 503, result.error || 'File unavailable.'); return result; };
const unwrap = (ownerId: string, doc: any) => withUserVaultKey(ownerId, key => validatePasswordFile(JSON.parse(openVaultValue(ownerId, key, doc.shareId, 'secret', doc.passwordFileEnvelope, PASSWORD_STORAGE_DOCUMENT_BYTES))));
export async function passwordFileOperation(ownerId: string, input: any, privateUploadsEnabled = false) {
  const things = await getHomeThingsCollection();
  if (input.operation === 'file-list') {
    const entryIds: string[] = Array.isArray(input.entryIds) ? [...new Set<string>(input.entryIds)] : [input.entryId];
    if (!entryIds.length || !entryIds.every(validPasswordId)) throw new PasswordManagerError(400, 'Select saved password entries.');
    const parents = await things.find({ ...entryMatch(ownerId, ''), shareId: { $in: entryIds } }, { projection: { shareId: 1 } }).toArray();
    if (parents.length !== entryIds.length) throw new PasswordManagerError(404, 'Password entry not found.');
    if (input.cursor !== undefined && (typeof input.cursor !== 'string' || !/^att_[a-f0-9]{64}$/.test(input.cursor))) throw new PasswordManagerError(400, 'Invalid file cursor.');
    const sourceIds = Array.isArray(input.sourceIds) ? input.sourceIds.filter(validPasswordId) : [];
    const sources = sourceIds.length ? await things.find({ ...entryMatch(ownerId, ''), shareId: { $in: sourceIds } }, { projection: { shareId: 1 } }).toArray() : [];
    const docs = await things.find({ ...fileMatch(ownerId), targetId: { $in: [...entryIds, ...sources.map(doc => doc.shareId)] }, attachmentState: 'ready', ...(input.cursor ? { shareId: { $gt: input.cursor } } : {}) }).sort({ shareId: 1 }).limit(51).toArray();
    const files = await withUserVaultKey(ownerId, key => docs.slice(0, 50).map(doc => ({ id: doc.shareId, entryId: doc.targetId, metadata: validatePasswordFile(JSON.parse(openVaultValue(ownerId, key, doc.shareId, 'secret', doc.passwordFileEnvelope, PASSWORD_STORAGE_DOCUMENT_BYTES))) })));
    return { files, nextCursor: docs.length > 50 ? docs[49].shareId : null };
  }
  if (!validPasswordId(input.entryId)) throw new PasswordManagerError(400, 'Select a saved password entry.');
  const parent = await things.findOne(entryMatch(ownerId, input.entryId));
  if (!parent) throw new PasswordManagerError(404, 'Password entry not found.');
  if (input.operation === 'file-start') {
    if (!privateUploadsEnabled) throw new PasswordManagerError(403, 'Private uploads are disabled for this account.');
    let metadata; try { metadata = validatePasswordFile(input.metadata); } catch { throw new PasswordManagerError(400, 'Invalid encrypted file metadata.'); }
    const result: any = checked(await service.start(ownerId, { requestId: metadata.token, purpose: 'password', filename: 'encrypted.bin', contentType: 'application/octet-stream', sizeBytes: passwordFileCipherSize(metadata.size) }));
    const id = result.upload.id;
    await withHomeMongoTransaction(async session => {
      if (!await things.findOne(entryMatch(ownerId, input.entryId), { session })) throw new PasswordManagerError(404, 'Password entry not found.');
      const doc = await things.findOne(fileMatch(ownerId, id), { session });
      if (!doc || !['pending', 'ready'].includes(doc.attachmentState)) throw new PasswordManagerError(409, 'File changed while starting.');
      if (doc.passwordFileEnvelope) {
        if (doc.passwordFileParent !== input.entryId || !isDeepStrictEqual(await unwrap(ownerId, doc), metadata)) throw new PasswordManagerError(409, 'This upload id was used for different file data.');
        return;
      }
      const envelope = await withUserVaultKey(ownerId, key => sealVaultValue(ownerId, key, id, 'secret', JSON.stringify(metadata), PASSWORD_STORAGE_DOCUMENT_BYTES));
      await updateAccountedThing(things, { ...fileMatch(ownerId, id), passwordFileEnvelope: { $exists: false } }, { $set: { passwordFileEnvelope: envelope, passwordFileParent: input.entryId } }, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
      // Touch the parent to serialize attachment creation against entry deletion.
      await updateAccountedThing(things, entryMatch(ownerId, input.entryId), { $set: { updatedAt: new Date() } }, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
    });
    return result;
  }
  if (typeof input.fileId !== 'string') throw new PasswordManagerError(400, 'Select a file.');
  const doc = await things.findOne(fileMatch(ownerId, input.fileId));
  if (!doc || doc.passwordFileParent !== input.entryId || !doc.passwordFileEnvelope) throw new PasswordManagerError(404, 'File not found.');
  if (input.operation === 'file-parts') return checked(await service.signParts(ownerId, { uploadId: doc.shareId, parts: input.parts }));
  if (input.operation === 'file-complete') {
    checked(await service.complete(ownerId, { uploadId: doc.shareId }));
    await withHomeMongoTransaction(async session => {
      if (!await things.findOne(entryMatch(ownerId, input.entryId), { session })) throw new PasswordManagerError(404, 'Password entry not found.');
      const current = await things.findOne(fileMatch(ownerId, doc.shareId), { session });
      if (!current || current.attachmentState !== 'ready' || (current.targetId && current.targetId !== input.entryId) || (!current.targetId && (!current.attachmentExpiresAt || current.attachmentExpiresAt <= new Date()))) throw new PasswordManagerError(409, 'File expired or changed.');
      await updateAccountedThing(things, { ...fileMatch(ownerId, doc.shareId), attachmentState: 'ready' }, { $set: { targetId: input.entryId }, $unset: { attachmentExpiresAt: '' } }, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
      await updateAccountedThing(things, entryMatch(ownerId, input.entryId), { $set: { updatedAt: new Date() } }, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
    });
    return { file: { id: doc.shareId, metadata: await unwrap(ownerId, doc) } };
  }
  if (input.operation === 'file-download') return { ...checked(await service.download({ id: ownerId }, doc.shareId, true)), metadata: await unwrap(ownerId, doc) };
  if (input.operation === 'file-delete') return checked(await service.remove(ownerId, { id: doc.shareId, ...(doc.targetId ? { targetId: input.entryId } : {}) }));
  if (input.operation === 'file-abort') return checked(await service.cancel(ownerId, { uploadId: doc.shareId }));
  throw new PasswordManagerError(400, 'Unknown password file operation.');
}
export async function deletePasswordFiles(ownerId: string, entryId: string) {
  const things = await getHomeThingsCollection();
  // Parent is tombstoned first, so no new file can bind while cleanup advances.
  for await (const doc of things.find({ ...fileMatch(ownerId), passwordFileParent: entryId })) {
    const result = checked(await service.remove(ownerId, { id: doc.shareId, ...(doc.targetId ? { targetId: entryId } : {}) }));
    if ('deferred' in result && result.deferred) throw new PasswordManagerError(409, 'File cleanup is in progress. Retry deleting the entry.');
  }
}
