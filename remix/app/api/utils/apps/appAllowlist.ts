import { createHash, randomUUID } from 'node:crypto';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import { normalizeAppOrigin, normalizeAppOriginEntry, originAllowedBy } from './appOriginsCore';
import { normalizeDesktopRedirectUri } from './desktopOAuthRedirect';
import { StorageMutationError } from '../storage/storageCore';

export const APP_ALLOWLIST_KIND = 'app-allowlist-entry';
export const appAllowlistPrefix = (appId: string): string => `app-allowlist:${Buffer.byteLength(appId, 'utf8')}:${appId}:`;
export const appAllowlistEntryId = (appId: string, generation: string, kind: 'origin' | 'native', entry: string): string =>
  `${appAllowlistPrefix(appId)}${generation}:${kind}:${createHash('sha256').update(entry).digest('hex')}`;

export const deleteAppAllowlist = async (things: any, app: any, session: any): Promise<void> => {
  const prefix = appAllowlistPrefix(app.shareId);
  await things.deleteMany({ thingtime: APP_ALLOWLIST_KIND, ownerId: app.ownerId, shareId: { $gte: prefix, $lt: `${prefix}\uffff` } }, { session });
};

export const replaceAppAllowlist = async (things: any, app: any, origins: readonly string[], native: readonly string[], session: any): Promise<void> => {
  const generation = randomUUID();
  await deleteAppAllowlist(things, app, session);
  for (const [kind, entries] of [['origin', origins], ['native', native]] as const) {
    for (let offset = 0; offset < entries.length; offset += 250) {
      await things.insertMany(entries.slice(offset, offset + 250).map((entry, index) => ({
        shareId: appAllowlistEntryId(app.shareId, generation, kind, entry), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
        thingtime: [APP_ALLOWLIST_KIND], ownerId: app.ownerId, targetId: app.shareId, parentId: app.shareId,
        acl: ['tt:user'], storageClass: 'control', crystal: { generation, kind, entry, order: offset + index, wildcard: kind === 'origin' && entry.includes('*') },
        createdAt: app.updatedAt, updatedAt: app.updatedAt
      })), { session });
    }
  }
  app.crystal = { ...app.crystal, allowlistVersion: 1, allowlistGeneration: generation, allowlistCounts: { origins: origins.length, nativeRedirectUris: native.length } };
  delete app.crystal.origins;
  delete app.crystal.nativeRedirectUris;
};

export const readAppAllowlist = async (things: any, app: any, session?: any): Promise<{ origins: string[]; nativeRedirectUris: string[] }> => {
  if (app.crystal?.allowlistVersion === undefined) return {
    origins: Array.isArray(app.crystal?.origins) ? app.crystal.origins : [],
    nativeRedirectUris: Array.isArray(app.crystal?.nativeRedirectUris) ? app.crystal.nativeRedirectUris : []
  };
  if (app.crystal.allowlistVersion !== 1 || typeof app.crystal.allowlistGeneration !== 'string') throw Error('App allowlist is unavailable');
  const ordered = { origins: [] as Array<{ entry: string; order: number }>, nativeRedirectUris: [] as Array<{ entry: string; order: number }> };
  const cursor = things.find({ thingtime: APP_ALLOWLIST_KIND, targetId: app.shareId, ownerId: app.ownerId,
    'crystal.generation': app.crystal.allowlistGeneration }, { ...(session ? { session } : {}), projection: { crystal: 1 } }).batchSize(100);
  for await (const row of cursor) {
    if (row.crystal.kind === 'origin') ordered.origins.push(row.crystal);
    if (row.crystal.kind === 'native') ordered.nativeRedirectUris.push(row.crystal);
  }
  const result = { origins: ordered.origins.sort((a, b) => a.order - b.order).map(row => row.entry), nativeRedirectUris: ordered.nativeRedirectUris.sort((a, b) => a.order - b.order).map(row => row.entry) };
  const counts = app.crystal.allowlistCounts;
  if (!counts || counts.origins !== result.origins.length || counts.nativeRedirectUris !== result.nativeRedirectUris.length || (!session && !(await currentGeneration(things, app, false))))
    throw new StorageMutationError(409, 'storage_conflict', 'The app allowlist changed while it was being read. Refresh and try again.');
  return result;
};

/** A valid DNS hostname's leftmost label is at most 63 bytes. Enumerating its
 * one-star patterns gives indexed point candidates independent of allowlist
 * size. The streaming fallback preserves legacy syntactic URL acceptance for
 * names beyond the DNS protocol, without quadratic work on hostile labels. */
export const originPatternCandidates = (origin: string): string[] | null => {
  const url = new URL(origin), labels = url.hostname.split('.');
  if (url.protocol !== 'https:' || labels.length < 3) return [];
  const first = labels[0];
  if (Buffer.byteLength(first, 'utf8') > 63) return null;
  const suffix = `.${labels.slice(1).join('.')}${url.port ? `:${url.port}` : ''}`;
  const result: string[] = [];
  for (let start = 0; start <= first.length; start++) for (let end = start; end <= first.length; end++)
    result.push(`https://${first.slice(0, start)}*${first.slice(end)}${suffix}`);
  return result;
};

const currentGeneration = async (things: any, app: any, requireActive = true): Promise<boolean> => !!await things.findOne({
  shareId: app.shareId, thingtime: 'app', ownerId: app.ownerId, 'crystal.clientId': app.crystal.clientId,
  'crystal.allowlistVersion': 1, 'crystal.allowlistGeneration': app.crystal.allowlistGeneration,
  ...(requireActive ? { 'crystal.revokedAt': { $in: [null] } } : {})
}, { projection: { _id: 1 } });

export const relationalAppAllowsOrigin = async (things: any, app: any, origin: string): Promise<boolean> => {
  const normalized = normalizeAppOrigin(origin);
  if (!normalized) return false;
  if (app?.crystal?.allowlistVersion === undefined) return originAllowedBy(app?.crystal?.origins, normalized);
  if (app.crystal.allowlistVersion !== 1 || typeof app.crystal.allowlistGeneration !== 'string') return false;
  const base = { thingtime: APP_ALLOWLIST_KIND, targetId: app.shareId, ownerId: app.ownerId,
    'crystal.generation': app.crystal.allowlistGeneration, 'crystal.kind': 'origin' };
  const exact = await things.findOne({ ...base, shareId: appAllowlistEntryId(app.shareId, app.crystal.allowlistGeneration, 'origin', normalized) });
  if (exact?.crystal?.entry === normalized) return currentGeneration(things, app);
  const patterns = originPatternCandidates(normalized);
  if (patterns && !patterns.length) return false;
  const filter = patterns ? { ...base, shareId: { $in: patterns.map(pattern => appAllowlistEntryId(app.shareId, app.crystal.allowlistGeneration, 'origin', pattern)) } } : { ...base, 'crystal.wildcard': true };
  const cursor = things.find(filter, { projection: { 'crystal.entry': 1 } }).batchSize(100);
  try {
    for await (const row of cursor) {
      const entry = row.crystal.entry;
      if (normalizeAppOriginEntry(entry) === entry && originAllowedBy([entry], normalized)) return currentGeneration(things, app);
    }
  } finally { await cursor.close(); }
  return false;
};

export const relationalAppAllowsNative = async (things: any, app: any, value: string): Promise<boolean> => {
  const redirect = normalizeDesktopRedirectUri(value);
  if (!redirect?.native) return false;
  if (app?.crystal?.allowlistVersion === undefined) return Array.isArray(app?.crystal?.nativeRedirectUris) && app.crystal.nativeRedirectUris.includes(redirect.uri);
  if (app.crystal.allowlistVersion !== 1 || typeof app.crystal.allowlistGeneration !== 'string') return false;
  const entry = await things.findOne({ shareId: appAllowlistEntryId(app.shareId, app.crystal.allowlistGeneration, 'native', redirect.uri),
    thingtime: APP_ALLOWLIST_KIND, targetId: app.shareId, ownerId: app.ownerId, 'crystal.generation': app.crystal.allowlistGeneration,
    'crystal.kind': 'native', 'crystal.entry': redirect.uri });
  return !!entry && currentGeneration(things, app);
};
