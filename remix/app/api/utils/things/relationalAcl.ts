import { createHash, randomUUID } from 'node:crypto';
import { COLLECTION_SCHEMA_VERSIONS, aclFromVisibility, type AclViewer } from '../../../schemas/registry';
import type { ThingDoc } from './things';
import { StorageMutationError } from '../storage/storageCore';
import { ACL_ROOT_BASELINE } from '../mongodb/aclWriteFence';

export const ACL_ENTRY_KIND = 'acl-entry';
export type GrantFamily = 'audience' | 'token';
export const grantFields = (family: GrantFamily) => family === 'token'
  ? { generation: 'tokenAclGeneration', revision: 'tokenAclRevision', count: 'tokenAclEntryCount', value: 'tokenAcl' } as const
  : { generation: 'aclGeneration', revision: 'aclRevision', count: 'aclEntryCount', value: 'acl' } as const;
export const grantFamilyMatch = (family: GrantFamily) => family === 'token' ? { 'crystal.family': 'token' } : { 'crystal.family': { $in: ['audience', null] } };
export const legacyTokenAcl = (doc: ThingDoc): string[] => {
  if (doc.tokenAclGeneration !== undefined) return [];
  const entries = Array.isArray(doc.tokenAcl) ? doc.tokenAcl.filter((entry): entry is string => typeof entry === 'string') : [];
  if (doc.createdByTokenId && !entries.includes(`tt:token/${doc.createdByTokenId}`)) entries.push(`tt:token/${doc.createdByTokenId}`);
  return entries;
};

// Only this finite vocabulary remains on a root. Subject membership is a
// relation, never an ever-growing root document or an authorization snapshot.
const BASELINE = new Set(ACL_ROOT_BASELINE);
/** Legacy full-document conversion uses updatedAt CAS but knows no ACL
 * revision. Always invalidate its captured timestamp, even within one ms. */
export const nextAclUpdatedAt = (previous: Date | string, now = Date.now()): Date => {
  const before = new Date(previous).getTime();
  if (!Number.isFinite(before) || !Number.isFinite(now) || Math.max(now, before + 1) > 8640000000000000)
    throw new StorageMutationError(409, 'storage_conflict', 'The Thing timestamp is unavailable. Refresh before editing grants.');
  return new Date(Math.max(now, before + 1));
};
/** Strict-private flows must not infer an owner-only audience from the finite
 * root baseline when additional entries live in a relation. Missing counts on
 * a relational root are unavailable, never an empty audience. */
export const hasRelationalAclEntries = (doc: { aclGeneration?: unknown; aclEntryCount?: unknown }): boolean => doc?.aclGeneration !== undefined && (typeof doc.aclGeneration !== 'string' || !doc.aclGeneration || doc.aclEntryCount !== 0);
export const aclSubject = (entry: string): string => entry.replace(/^-/, '').replace(/^(tt:(?:user|group)\/[^/]+)\/(?:comment|write)$/, '$1');
export const ACL_BASELINE_VERSION = 1;
/** Old evaluators see only owner authority and exclusions. Negative hints keep
 * the existing acl index useful without admitting an old nonowner reader. */
export const legacyAclFence = (baseline: readonly string[]): string[] => ['tt:user', ...new Set(baseline.map(entry => `-${entry.replace(/^-/, '')}`))];
const validBaseline = (doc: ThingDoc): boolean => doc.aclBaselineVersion === ACL_BASELINE_VERSION && Array.isArray(doc.aclBaseline) &&
  doc.aclBaseline.every(entry => typeof entry === 'string' && (BASELINE.has(entry.replace(/^-/, '')) || (!!doc.appId && entry.replace(/^-/, '') === `tt:app/${doc.appId}`))) &&
  JSON.stringify(doc.acl) === JSON.stringify(legacyAclFence(doc.aclBaseline));
export const validRelationalAclRoot = (doc: ThingDoc): boolean => typeof doc.aclGeneration === 'string' && !!doc.aclGeneration && validBaseline(doc);
export const rootAcl = (doc: Pick<ThingDoc, 'acl' | 'visibility' | 'aclGeneration' | 'aclBaseline' | 'aclBaselineVersion' | 'appId'>): string[] => {
  if (doc.aclGeneration !== undefined) return validBaseline(doc as ThingDoc) ? [...doc.aclBaseline!] : ['-tt:all'];
  return Array.isArray(doc.acl) && doc.acl.length ? doc.acl : aclFromVisibility(doc.visibility) || ['tt:user'];
};
/** Indexed coarse candidates only. Hints lose sign, so the protected baseline
 * must also contain the exact logical marker. The prepared evaluator still
 * validates the full baseline and fence before granting nonowner authority. */
export const aclMarkerClause = (...markers: string[]): any => ({ $or: [
  { aclGeneration: { $exists: false }, acl: { $in: markers } },
  { aclGeneration: { $exists: true }, aclBaselineVersion: ACL_BASELINE_VERSION, acl: { $in: markers.map(entry => `-${entry.replace(/^-/, '')}`) }, aclBaseline: { $in: markers } }
] });
export const aclWithoutMarkersClause = (...markers: string[]): any => ({ $or: [
  { aclGeneration: { $exists: false }, acl: { $exists: true, $nin: markers } },
  { aclGeneration: { $exists: true }, aclBaselineVersion: ACL_BASELINE_VERSION, aclBaseline: { $exists: true, $nin: markers } }
] });
export const aclEntryPrefix = (targetId: string, revision: string, family: GrantFamily = 'audience'): string => `acl-entry:${Buffer.byteLength(targetId, 'utf8')}:${targetId}:${family === 'token' ? 'token:' : ''}${revision}:`;
export const aclEntryId = (targetId: string, revision: string, entry: string, family: GrantFamily = 'audience'): string => `${aclEntryPrefix(targetId, revision, family)}${entry}`;
export const partitionAcl = (entries: readonly string[], appId?: string | null) => {
  const baseline: string[] = [], relational: string[] = [];
  for (const entry of entries) {
    const base = entry.replace(/^-/, '');
    // The namespace clamp admits exactly one app audience; keep that fixed
    // single audience beside its server-stamped namespace for app clients.
    (BASELINE.has(base) || (appId && base === `tt:app/${appId}`) ? baseline : relational).push(entry);
  }
  return { baseline, relational };
};

export const aclSubjectsFor = (viewer: AclViewer): string[] => {
  const subjects: string[] = [];
  if (viewer?.id && viewer.username) subjects.push(`tt:user/${viewer.username.toLowerCase()}`);
  if (viewer?.id) for (const id of viewer.groupIds || []) subjects.push(`tt:group/${id}`);
  if (viewer?.id) for (const id of viewer.extAccountIds || []) subjects.push(`tt:extacct/${id}`);
  return subjects;
};

// A sync caller without a matching, freshly prepared proof fails closed,
// including public roots whose relational rows may contain an exclusion.
const viewerProofKey = (viewer: AclViewer): string => createHash('sha256').update(JSON.stringify([viewer?.id || null, viewer?.username?.toLowerCase() || null, aclSubjectsFor(viewer).sort()])).digest('hex');
const proofs = new WeakMap<object, { viewerKey: string; revision: string; mutationRevision?: string; baselineKey: string; entries: string[] }>();
export const evaluatedAcl = (doc: ThingDoc, viewer: AclViewer): string[] | null => {
  if (doc.aclGeneration === undefined) return rootAcl(doc);
  if (typeof doc.aclGeneration !== 'string' || !doc.aclGeneration || !validBaseline(doc)) return null;
  const proof = proofs.get(doc);
  return proof && proof.viewerKey === viewerProofKey(viewer) && proof.revision === doc.aclGeneration && proof.mutationRevision === doc.aclRevision && proof.baselineKey === JSON.stringify(doc.aclBaseline) ? [...rootAcl(doc), ...proof.entries] : null;
};

/** Page-sized, subject-selective lookup. Does not enumerate an audience. */
export const prepareRelationalAcls = async (things: any, docs: readonly ThingDoc[], viewer: AclViewer, session?: any): Promise<void> => {
  for (const doc of docs) if (doc.aclGeneration !== undefined) proofs.delete(doc);
  const relational = docs.filter(doc => typeof doc.aclGeneration === 'string' && !!doc.aclGeneration);
  if (!relational.length) return;
  const entries = candidateEntriesFor(viewer, true);
  const byTarget = new Map<string, string[]>();
  const ids = relational.flatMap(doc => entries.map(entry => aclEntryId(doc.shareId, doc.aclGeneration!, entry)));
  // Point lookups use the existing unique shareId index. Query batches are
  // backpressure, not an audience or membership limit.
  for (let offset = 0; offset < ids.length; offset += 250) {
    const cursor = things.find({ ...grantFamilyMatch('audience'), thingtime: ACL_ENTRY_KIND, 'crystal.revoked': { $ne: true }, shareId: { $in: ids.slice(offset, offset + 250) } },
      { projection: { targetId: 1, ownerId: 1, crystal: 1 }, ...(session ? { session } : {}) });
    for await (const row of cursor) {
      if (!relational.some(doc => doc.shareId === row.targetId && doc.ownerId === row.ownerId && doc.aclGeneration === row.crystal.revision)) continue;
      const matches = byTarget.get(row.targetId) || [];
      matches.push(row.crystal.entry);
      byTarget.set(row.targetId, matches);
    }
  }
  // A generation replacement removes old rows atomically. Revalidate the
  // root after looking up its rows, otherwise an old public baseline combined
  // with a just-deleted negative entry could grant a reader neither committed
  // audience admitted. A changed/deleted root leaves no usable proof.
  const current = new Map<string, any>();
  const targetIds = [...new Set(relational.map(doc => doc.shareId))];
  for (let offset = 0; offset < targetIds.length; offset += 250) {
    const cursor = things.find({ shareId: { $in: targetIds.slice(offset, offset + 250) } },
      { projection: { shareId: 1, ownerId: 1, appId: 1, acl: 1, aclBaseline: 1, aclBaselineVersion: 1, aclGeneration: 1, aclRevision: 1 }, ...(session ? { session } : {}) });
    for await (const row of cursor) current.set(row.shareId, row);
  }
  const viewerKey = viewerProofKey(viewer);
  for (const doc of relational) {
    const live = current.get(doc.shareId);
    if (live?.ownerId === doc.ownerId && live.aclGeneration === doc.aclGeneration && live.aclRevision === doc.aclRevision && validRelationalAclRoot(live) && JSON.stringify(live.aclBaseline) === JSON.stringify(doc.aclBaseline))
      proofs.set(doc, { viewerKey, revision: doc.aclGeneration!, mutationRevision: doc.aclRevision, baselineKey: JSON.stringify(doc.aclBaseline), entries: byTarget.get(doc.shareId) || [] });
  }
};

/** Relational candidate join, before filtering/sort/limit. The exact evaluator
 * still applies specificity, exclusions and all non-ACL authorization fences. */
export const candidateEntriesFor = (viewer: AclViewer, exclusions = false): string[] => aclSubjectsFor(viewer).flatMap(subject => {
  const grants = /^(tt:user|tt:group)\//.test(subject) ? [subject, `${subject}/comment`, `${subject}/write`] : [subject];
  return exclusions ? [...grants, ...grants.map(entry => `-${entry}`)] : grants;
});

export const relationalAclCandidateStages = (collectionName: string, viewer: AclViewer): any[] => [
  { $set: { _aclCandidateIds: { $map: { input: candidateEntriesFor(viewer), as: 'entry', in: {
    $concat: ['acl-entry:', { $toString: { $strLenBytes: '$shareId' } }, ':', '$shareId', ':', { $ifNull: ['$aclGeneration', ''] }, ':', '$$entry']
  } } } } },
  { $lookup: { from: collectionName, localField: '_aclCandidateIds', foreignField: 'shareId', pipeline: [
    { $match: { ...grantFamilyMatch('audience'), thingtime: ACL_ENTRY_KIND, 'crystal.revoked': { $ne: true } } }, { $limit: 1 }, { $project: { _id: 1 } }
  ], as: '_aclCandidate' } },
  { $unset: '_aclCandidateIds' }
];

/** Called only inside the root's content transaction. Child rows are private,
 * non-billable authorization plumbing and use the same data-plane client. */
export const replaceRelationalAcl = async (things: any, doc: ThingDoc, entries: readonly string[], session: any, family: GrantFamily = 'audience'): Promise<void> => {
  const fields = grantFields(family);
  const { baseline, relational } = family === 'token' ? { baseline: [], relational: entries } : partitionAcl(entries, doc.appId);
  const revision = randomUUID();
  await things.deleteMany({ ...grantFamilyMatch(family), thingtime: ACL_ENTRY_KIND, targetId: doc.shareId, ownerId: doc.ownerId }, { session });
  for (let offset = 0; offset < relational.length; offset += 250) {
    await things.insertMany(relational.slice(offset, offset + 250).map(entry => ({
      schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, shareId: aclEntryId(doc.shareId, revision, entry, family),
      thingtime: [ACL_ENTRY_KIND], ownerId: doc.ownerId, targetId: doc.shareId, parentId: doc.shareId,
      acl: ['tt:user'], storageClass: 'control', crystal: { family, revision, entry, subject: aclSubject(entry) },
      createdAt: doc.updatedAt, updatedAt: doc.updatedAt
    })), { session });
  }
  doc.aclWriteFenceAfter = new Date(doc.updatedAt);
  (doc as any)[fields.value] = family === 'audience' ? legacyAclFence(baseline) : baseline;
  if (family === 'audience') { doc.aclBaseline = baseline; doc.aclBaselineVersion = ACL_BASELINE_VERSION; }
  (doc as any)[fields.generation] = revision;
  (doc as any)[fields.revision] = randomUUID();
  (doc as any)[fields.count] = relational.length;
  if (family === 'token') delete doc.createdByTokenId;
};

export const assertRelationalAclSnapshot = async (things: any, docs: readonly ThingDoc[], counts: ReadonlyMap<string, number>, session?: any, family: GrantFamily = 'audience'): Promise<void> => {
  const fields = grantFields(family);
  const relational = docs.filter(doc => !!(doc as any)[fields.generation]);
  const conflict = () => new StorageMutationError(409, 'storage_conflict', 'The audience changed while it was being read. Refresh and try again.');
  for (const doc of relational) if ((family === 'audience' && !validRelationalAclRoot(doc)) || !Number.isSafeInteger((doc as any)[fields.count]) || (doc as any)[fields.count] < 0 || counts.get(doc.shareId) !== (doc as any)[fields.count]) throw conflict();
  // Before-image snapshots may intentionally follow root deletion in this
  // same transaction. Its snapshot already binds the complete generation.
  if (session || !relational.length) return;
  const current = new Map<string, any>();
  const ids = [...new Set(relational.map(doc => doc.shareId))];
  for (let offset = 0; offset < ids.length; offset += 250) {
    for await (const row of things.find({ shareId: { $in: ids.slice(offset, offset + 250) } }, { projection: { shareId: 1, ownerId: 1, appId: 1, acl: 1, aclBaseline: 1, aclBaselineVersion: 1, [fields.generation]: 1, [fields.revision]: 1 } })) current.set(row.shareId, row);
  }
  for (const doc of relational) {
    const live = current.get(doc.shareId);
    if (!live || live.ownerId !== doc.ownerId || live[fields.generation] !== (doc as any)[fields.generation] || live[fields.revision] !== (doc as any)[fields.revision] || (family === 'audience' && (!validRelationalAclRoot(live) || JSON.stringify(live.aclBaseline) !== JSON.stringify(doc.aclBaseline)))) throw conflict();
  }
};

/** Trusted compatibility only: normal authorization always uses subject queries. */
export const readAllThingAclEntries = async (things: any, doc: ThingDoc, session?: any, family: GrantFamily = 'audience'): Promise<string[]> => {
  const fields = grantFields(family);
  const result = family === 'token' ? legacyTokenAcl(doc) : [...rootAcl(doc)];
  const generation = (doc as any)[fields.generation];
  if (generation === undefined) return result;
  if (family === 'audience' && !validBaseline(doc)) throw new StorageMutationError(409, 'storage_conflict', 'Audience compatibility fence is unavailable. Refresh and retry.');
  if (typeof generation !== 'string' || !generation) throw new StorageMutationError(409, 'storage_conflict', 'Grant generation is unavailable. Refresh and retry.');
  const cursor = things.find({ ...grantFamilyMatch(family), thingtime: ACL_ENTRY_KIND, targetId: doc.shareId, ownerId: doc.ownerId,
    'crystal.revision': generation, 'crystal.revoked': { $ne: true } }, { ...(session ? { session } : {}), projection: { 'crystal.entry': 1 } });
  let count = 0;
  for await (const row of cursor) { result.push(row.crystal.entry); count++; }
  await assertRelationalAclSnapshot(things, [doc], new Map([[doc.shareId, count]]), session, family);
  return result;
};

/** Token grants restrict already-authenticated sandbox PAT mutations only.
 * They never grant audience visibility, app access, or a broader token scope. */
export const tokenGrantAllows = async (things: any, doc: ThingDoc, tokenId: string, session?: any): Promise<boolean> => {
  const entry = `tt:token/${tokenId}`;
  if (doc.tokenAclGeneration === undefined) return legacyTokenAcl(doc).includes(entry);
  if (typeof doc.tokenAclGeneration !== 'string' || !doc.tokenAclGeneration || typeof doc.tokenAclRevision !== 'string' || !doc.tokenAclRevision) return false;
  const grant = await things.findOne({ shareId: aclEntryId(doc.shareId, doc.tokenAclGeneration, entry, 'token'), thingtime: ACL_ENTRY_KIND,
    ownerId: doc.ownerId, targetId: doc.shareId, 'crystal.family': 'token', 'crystal.revision': doc.tokenAclGeneration,
    'crystal.entry': entry, 'crystal.revoked': { $ne: true } }, session ? { session, projection: { _id: 1 } } : { projection: { _id: 1 } });
  if (!grant) return false;
  return !!await things.findOne({ shareId: doc.shareId, ownerId: doc.ownerId,
    tokenAclGeneration: doc.tokenAclGeneration, tokenAclRevision: doc.tokenAclRevision }, session ? { session, projection: { _id: 1 } } : { projection: { _id: 1 } });
};
