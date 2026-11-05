import { passwordWebsiteOrigins } from '~/passwords/icons';
import { passwordAutofillOrigins } from '~/passwords/websites';
import { openPasswordIcon, sealPasswordIcon } from './icons';
import { deletePasswordFiles } from './files';
import { PASSWORD_STORAGE_DOCUMENT_BYTES } from '../../../passwords/capacity';
import { BSON, ObjectId } from 'mongodb';
import { createHmac } from 'node:crypto';
import { ensureIndexes, getHomeThingsCollection, getUsersCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { insertAccountedThing, updateAccountedThing, HOME_ACCOUNTED_STORAGE_OPTIONS } from '../storage/accountedThings';
import { withUserVaultKey } from '../auth/vaultKeys';
import { openVaultValue, sealVaultValue } from '../auth/vaultEnvelope';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { PASSWORD_ENTRY_KIND, passwordPreviewUsername, isPasswordFillEntry, validatePasswordEntry, validPasswordId, type PasswordMetadata } from '~/passwords/model';

export { PASSWORD_STORAGE_DOCUMENT_BYTES } from '../../../passwords/capacity';

export class PasswordManagerError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const storageSizeError = () => new PasswordManagerError(413, 'This entry exceeds the database document capacity after encryption. Your source data has not been truncated.');
const match = (ownerId: string, id?: string) => ({ ownerId, thingtime: PASSWORD_ENTRY_KIND, ...(id ? { shareId: id } : {}) });
const project = (doc: any): PasswordMetadata => ({ id: doc.shareId, title: doc.crystal.title, passwordType: doc.crystal.passwordType, revision: doc.passwordRevision, updatedAt: new Date(doc.updatedAt).toISOString() });
const pageCursor = (doc: any) => Buffer.from(JSON.stringify([new Date(doc.createdAt).toISOString(), doc.shareId])).toString('base64url');
const pageMatch = (cursor?: string | null) => {
  if (!cursor) return {};
  try {
    if (typeof cursor !== 'string' || cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const [timestamp, id, ...extra] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (extra.length || typeof timestamp !== 'string' || !validPasswordId(id) || new Date(timestamp).toISOString() !== timestamp) throw new Error();
    const createdAt = new Date(timestamp);
    return { $or: [{ createdAt: { $lt: createdAt } }, { createdAt, shareId: { $gt: id } }] };
  } catch { throw new PasswordManagerError(400, 'Invalid cursor.'); }
};
export async function listPasswords(ownerId: string, cursor?: string | null, query = '', previews = false) {
  // Match private title metadata before the page limit, without decrypting
  // fields for search. Optional previews below decode only the selected page.
  const title = query.trim();
  const titleMatch = title ? { 'crystal.title': { $regex: title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
  // Reuse the existing schema/owner/createdAt/shareId index: things_v2 is
  // already at Mongo's index budget. Immutable creation time keeps page order.
  const docs = await (await getHomeThingsCollection()).find({ ...match(ownerId), passwordDeleted: { $ne: true }, ...pageMatch(cursor), ...titleMatch },
    { projection: { shareId: 1, 'crystal.title': 1, 'crystal.passwordType': 1, 'crystal.encryptedIcon': 1, ...(previews ? {'crystal.encryptedValue':1} : {}), passwordRevision: 1, updatedAt: 1, createdAt: 1 } }).sort({ createdAt: -1, shareId: 1 }).limit(51).toArray();
  const page = docs.slice(0, 50);
  // Username is an explicitly allowlisted private preview. Only the bounded
  // selected page is decoded; passwords/keys never enter metadata responses.
  const entries = previews || page.some(doc=>doc.crystal.encryptedIcon) ? await withUserVaultKey(ownerId, key => page.map(doc => {
    const entry = previews ? validatePasswordEntry(JSON.parse(openVaultValue(ownerId, key, doc.shareId, 'secret', doc.crystal.encryptedValue, PASSWORD_STORAGE_DOCUMENT_BYTES))) : null;
    const username = entry ? passwordPreviewUsername(entry) : '';
    const icon = openPasswordIcon(ownerId, key, doc.shareId, doc.crystal.encryptedIcon, PASSWORD_STORAGE_DOCUMENT_BYTES) || entry?.icon;
    return { ...project(doc), ...(icon ? { icon } : {}), ...(username ? {username} : {}), ...(!icon && entry && passwordWebsiteOrigins(entry).length ? {websiteIcon:true} : {}) };
  })) : page.map(project);
  return { entries, nextCursor: docs.length > 50 ? pageCursor(docs[49]) : null };
}
export async function readPassword(ownerId: string, id: unknown) {
  if (!validPasswordId(id)) throw new PasswordManagerError(400, 'Invalid password entry.');
  const doc = await (await getHomeThingsCollection()).findOne({ ...match(ownerId, id), passwordDeleted: { $ne: true } });
  if (!doc) throw new PasswordManagerError(404, 'Password entry not found.');
  const entry = validatePasswordEntry(JSON.parse(await withUserVaultKey(ownerId, key => openVaultValue(ownerId, key, id, 'secret', doc.crystal.encryptedValue, PASSWORD_STORAGE_DOCUMENT_BYTES))));
  return { ...project(doc), entry, verificationChangedAt: doc.passwordVerificationChangedAt ?? 0 };
}
// The native picker gets names and exact domains, never passwords, TOTP seeds,
// or signing keys. One bounded query per page; no per-entry database queries.
export async function exportPasswordPage(ownerId: string, cursor?: string | null) {
  const docs = await (await getHomeThingsCollection()).find({ ...match(ownerId), passwordDeleted: { $ne: true }, ...pageMatch(cursor) }).sort({ createdAt: -1, shareId: 1 }).limit(51).toArray();
  const entries = await withUserVaultKey(ownerId, key => docs.slice(0, 50).map(doc => ({ ...project(doc), entry: validatePasswordEntry(JSON.parse(openVaultValue(ownerId, key, doc.shareId, 'secret', doc.crystal.encryptedValue, PASSWORD_STORAGE_DOCUMENT_BYTES))) })));
  return { entries, nextCursor: docs.length > 50 ? pageCursor(docs[49]) : null };
}
export async function passwordCatalog(ownerId: string, cursor?: string | null) {
  const page = await exportPasswordPage(ownerId, cursor);
  const catalog = page.entries.map(({ id, entry }) => {
    const value = (id: string) => entry.fields.find(field => field.id === id)?.value || '';
    const origins = passwordAutofillOrigins(entry.fields);
    const domains = [...new Set(origins.map(origin => new URL(origin).hostname.toLowerCase()))];
    return { id, title: entry.title, username: passwordPreviewUsername(entry), domains, origins,
      fillEligible: isPasswordFillEntry(entry), hasPassword: entry.passwordType !== 'passkey' && !!value('password'), hasTotp: entry.fields.some(field => field.type === 'totp' && field.value),
      ...(entry.passwordType === 'passkey' ? { relyingParty: value('relyingParty'), credentialId: value('credentialId'), userHandle: value('userHandle') } : {}) };
  });
  return { catalog, nextCursor: page.nextCursor };
}
export async function savePassword(ownerId: string, input: any) {
  if (!validPasswordId(input.id) || !validPasswordId(input.writeId) || !Number.isSafeInteger(input.revision) || input.revision < 0)
    throw new PasswordManagerError(400, 'A valid entry id, write id, and revision are required.');
  let entry;
  try { entry = validatePasswordEntry(input.entry); }
  catch (error) { throw new PasswordManagerError(400, (error as Error).message); }
  const plain = JSON.stringify(entry);
  if (Buffer.byteLength(plain) >= PASSWORD_STORAGE_DOCUMENT_BYTES) throw storageSizeError();
  // Keyed digest gives stable retry identity without publishing password hashes.
  const digest = await withUserVaultKey(ownerId, key => createHmac('sha256', key.bytes).update(input.id).update(plain).digest('base64url'));
  const { encryptedValue, encryptedIcon } = await withUserVaultKey(ownerId, key => ({
    encryptedValue: sealVaultValue(ownerId, key, input.id, 'secret', plain, PASSWORD_STORAGE_DOCUMENT_BYTES),
    encryptedIcon: entry.icon ? sealPasswordIcon(ownerId, key, input.id, entry.icon, PASSWORD_STORAGE_DOCUMENT_BYTES) : undefined
  }));
  await ensureIndexes();
  const things = await getHomeThingsCollection();
  return withHomeMongoTransaction(async session => {
    const previous = await things.findOne({ shareId: input.id }, { session });
    if (previous && (previous.ownerId !== ownerId || previous.thingtime?.length !== 1 || previous.thingtime[0] !== PASSWORD_ENTRY_KIND)) throw new PasswordManagerError(404, 'Password entry not found.');
    if (previous?.passwordDeleted) throw new PasswordManagerError(410, 'This entry was deleted. Save a new entry instead.');
    if (previous?.passwordWriteId === input.writeId) {
      if (previous.passwordWriteDigest !== digest) throw new PasswordManagerError(409, 'This save id was already used for different content.');
      return { ...project(previous), ...(entry.icon ? { icon: entry.icon } : {}) };
    }
    if ((previous?.passwordRevision ?? 0) !== input.revision) throw new PasswordManagerError(409, 'This entry changed elsewhere. Reopen it before saving.');
    if (entry.icon?.kind === 'attachment' && !await things.findOne({ ownerId, shareId: entry.icon.fileId, thingtime: 'attachment', attachmentPurpose: 'password', targetId: input.id, passwordFileParent: input.id, attachmentState: 'ready' }, { session, projection: { _id: 1 } })) throw new PasswordManagerError(400, 'Choose an uploaded icon belonging to this entry.');
    const now = new Date();
    const doc = { shareId: input.id, ownerId, thingtime: [PASSWORD_ENTRY_KIND], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
      acl: [ACL_OWNER], crystal: { title: entry.title, passwordType: entry.passwordType, encryptedValue, ...(encryptedIcon ? { encryptedIcon } : {}) }, extended: null, tags: [], targetId: null,
      passwordVerificationChangedAt: previous?.passwordVerificationChangedAt ?? 0, passwordRevision: input.revision + 1, passwordWriteId: input.writeId, passwordWriteDigest: digest, createdAt: previous?.createdAt ?? now, updatedAt: now };
    if (previous) {
      const old = validatePasswordEntry(JSON.parse(await withUserVaultKey(ownerId, key => openVaultValue(ownerId, key, input.id, 'secret', previous.crystal.encryptedValue, PASSWORD_STORAGE_DOCUMENT_BYTES))));
      if ((old.verificationWindow ?? 'global') !== (entry.verificationWindow ?? 'global')) {
        doc.passwordVerificationChangedAt = Date.now();
        // One account-wide policy epoch avoids same-millisecond ambiguity and
        // covers every canonical writer, including imports and editor saves.
        const owner = await things.findOne({shareId:ownerId,thingtime:'user'},{session,projection:{shareId:1}});
        if(owner)await updateAccountedThing(things,{shareId:ownerId,thingtime:'user'},{$set:{passwordVerificationEpoch:crypto.randomUUID()}},{session,...HOME_ACCOUNTED_STORAGE_OPTIONS});
        else if(ObjectId.isValid(ownerId))await(await getUsersCollection()).updateOne({_id:new ObjectId(ownerId)},{$set:{passwordVerificationEpoch:crypto.randomUUID()}},{session});
        else throw new PasswordManagerError(401,'Your account changed.');
      }
    }
    if (BSON.calculateObjectSize({ ...previous, ...doc }) >= PASSWORD_STORAGE_DOCUMENT_BYTES) throw storageSizeError();
    if (previous) {
      const updated = await updateAccountedThing(things, { ...match(ownerId, input.id), passwordRevision: previous.passwordRevision }, { $set: { crystal: doc.crystal, passwordVerificationChangedAt: doc.passwordVerificationChangedAt, passwordRevision: doc.passwordRevision, passwordWriteId: input.writeId, passwordWriteDigest: digest, updatedAt: now } }, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
      if (updated.matchedCount !== 1) throw new PasswordManagerError(409, 'This entry changed while saving.');
    } else await insertAccountedThing(things, doc, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
    return { ...project(doc), ...(entry.icon ? { icon: entry.icon } : {}) };
  });
}
export async function deletePassword(ownerId: string, input: any) {
  if (!validPasswordId(input.id) || !Number.isSafeInteger(input.revision)) throw new PasswordManagerError(400, 'Select an entry and its current revision.');
  const things = await getHomeThingsCollection();
  await withHomeMongoTransaction(async session => {
    const previous = await things.findOne(match(ownerId, input.id), { session });
    if (!previous) throw new PasswordManagerError(404, 'Password entry not found.');
    if (previous.passwordDeleted) return;
    if (previous.passwordRevision !== input.revision) throw new PasswordManagerError(409, 'This entry changed. Reopen it before deleting.');
    // Minimal tombstone stops delayed saves resurrecting deleted credentials.
    await updateAccountedThing(things, match(ownerId, input.id), { $set: { crystal: {}, passwordDeleted: true, passwordVerificationChangedAt: previous?.passwordVerificationChangedAt ?? 0, passwordRevision: input.revision + 1, updatedAt: new Date() }, $unset: { passwordWriteDigest: '', passwordWriteId: '' } }, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
  });
  await deletePasswordFiles(ownerId, input.id);
}
