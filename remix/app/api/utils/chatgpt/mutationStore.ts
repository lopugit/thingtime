import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { getSessionsCollection } from '../mongodb/collections';
import type { SessionDoc } from '../auth/sessions';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

export type MutationStorageScope = {
  ownerId: string;
  connectionSessionJti: string;
  resource: string;
  accountId: string;
  endpoint: string;
};

type PayloadKind = 'preview' | 'history' | 'upload';
type PayloadRef = { digest: string; chunks: number };
type StoredPayload = { value: unknown; digest: string };
export type MutationStore = {
  put(scope: MutationStorageScope, kind: PayloadKind, id: string, value: unknown): Promise<'saved' | 'same' | 'conflict'>;
  get(scope: MutationStorageScope, kind: PayloadKind, id: string): Promise<StoredPayload | null>;
  claim(scope: MutationStorageScope, id: string, digest: string): Promise<boolean>;
  historyIds(scope: MutationStorageScope, before: string | null, limit: number): Promise<string[]>;
};

const PURPOSE = 'chatgpt-mcp-mutation';
const CHUNK_PURPOSE = 'chatgpt-mcp-mutation-chunk';
const REVIEW_TTL_MS = 30 * 60 * 1000;
// Mongo documents have a BSON size limit. This is a storage unit, not an
// admission limit. Batches keep each write small and respect driver backpressure.
const CHUNK_BYTES = 256 * 1024;
const CHUNKS_PER_WRITE = 8;

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const mutationDigest = (value: unknown) => sha256(JSON.stringify(value));

const scopeKey = (scope: MutationStorageScope) => sha256(JSON.stringify([
  scope.ownerId, scope.connectionSessionJti, scope.resource, scope.accountId, scope.endpoint
]));
const prefixFor = (scope: MutationStorageScope, kind: PayloadKind) => `mcp:${scopeKey(scope)}:${kind}:`;
const identityFor = (scope: MutationStorageScope, kind: PayloadKind, id: string) => `${prefixFor(scope, kind)}${id}`;
const chunkIdentity = (root: string, digest: string, index: number) => `${root}:${digest}:${index}`;

const seal = (key: Buffer, binding: string, plain: Buffer) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(binding));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
};

const open = (key: Buffer, binding: string, value: string) => {
  const envelope = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(0, 12));
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(envelope.subarray(12, 28));
  return Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]);
};

const doc = (jti: string, scope: MutationStorageScope, purpose: SessionDoc['purpose'], createdAt: Date, expiresAt: Date | null, meta: Record<string, unknown>): SessionDoc => ({
  jti,
  userId: scope.ownerId,
  schemaVersion: COLLECTION_SCHEMA_VERSIONS.sessions,
  createdAt,
  expiresAt,
  revokedAt: null,
  type: 'tt.session',
  purpose,
  meta: { connectionSessionJti: scope.connectionSessionJti, ...meta }
});

const unexpired = () => ({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });

const liveRootFilter = (scope: MutationStorageScope, jti: string) => ({
  jti,
  userId: scope.ownerId,
  purpose: PURPOSE,
  revokedAt: null,
  ...unexpired()
});

export const createMutationStore = (key: Buffer): MutationStore => ({
  async put(scope, kind, id, value) {
    const collection = await getSessionsCollection();
    const root = identityFor(scope, kind, id);
    const bytes = Buffer.from(JSON.stringify(value));
    const digest = sha256(bytes);
    const existing = await collection.findOne(liveRootFilter(scope, root));
    if (existing) return existing.meta?.digest === digest ? 'same' : 'conflict';
    const now = new Date();
    // History is durable while its connection remains live. Only an
    // unsubmitted review receipt or transfer part has the review lifetime.
    const expires = kind === 'history' ? null : new Date(now.getTime() + REVIEW_TTL_MS);
    const chunks = Math.ceil(bytes.byteLength / CHUNK_BYTES);
    for (let offset = 0; offset < chunks; offset += CHUNKS_PER_WRITE) {
      const writes = Array.from({ length: Math.min(CHUNKS_PER_WRITE, chunks - offset) }, (_, index) => {
        const part = offset + index;
        const jti = chunkIdentity(root, digest, part);
        const ciphertext = seal(key, jti, bytes.subarray(part * CHUNK_BYTES, (part + 1) * CHUNK_BYTES));
        const session = doc(jti, scope, CHUNK_PURPOSE, now, expires, { ciphertext });
        const { expiresAt: _expiresAt, ...insert } = session;
        return {
          updateOne: {
            filter: { jti, userId: scope.ownerId, purpose: CHUNK_PURPOSE },
            // Keep repeated writes of a staged part live through the same
            // deadline as its root, without changing the sealed bytes.
            update: expires ? { $setOnInsert: insert, $max: { expiresAt: expires } } : { $setOnInsert: session },
            upsert: true
          }
        };
      });
      await collection.bulkWrite(writes, { ordered: true });
    }
    const reference: PayloadRef = { digest, chunks };
    await collection.updateOne({ jti: root, userId: scope.ownerId, purpose: PURPOSE }, {
      $setOnInsert: doc(root, scope, PURPOSE, now, expires, reference)
    }, { upsert: true });
    const stored = await collection.findOne(liveRootFilter(scope, root));
    return stored?.meta?.digest === digest ? 'saved' : 'conflict';
  },
  async get(scope, kind, id) {
    const collection = await getSessionsCollection();
    const root = identityFor(scope, kind, id);
    const stored = await collection.findOne(liveRootFilter(scope, root));
    const digest = stored?.meta?.digest;
    const count = stored?.meta?.chunks;
    if (typeof digest !== 'string' || !Number.isSafeInteger(count) || count < 1) return null;
    const parts: Buffer[] = [];
    try {
      for (let offset = 0; offset < count; offset += CHUNKS_PER_WRITE) {
        const ids = Array.from({ length: Math.min(CHUNKS_PER_WRITE, count - offset) }, (_, index) => chunkIdentity(root, digest, offset + index));
        const docs = await collection.find({ jti: { $in: ids }, userId: scope.ownerId, purpose: CHUNK_PURPOSE, revokedAt: null, ...unexpired() }).toArray();
        const byId = new Map<string, SessionDoc>(docs.map((entry) => [entry.jti, entry]));
        for (const jti of ids) {
          const ciphertext = byId.get(jti)?.meta?.ciphertext;
          if (typeof ciphertext !== 'string') return null;
          parts.push(open(key, jti, ciphertext));
        }
      }
      const bytes = Buffer.concat(parts);
      if (sha256(bytes) !== digest) return null;
      return { digest, value: JSON.parse(bytes.toString('utf8')) };
    } catch {
      return null;
    }
  },
  async claim(scope, id, digest) {
    const collection = await getSessionsCollection();
    const claimed = await collection.updateOne({
      ...liveRootFilter(scope, identityFor(scope, 'preview', id)),
      'meta.digest': digest,
      'meta.claimedAt': { $exists: false }
    }, { $set: { 'meta.claimedAt': new Date() } });
    return claimed.modifiedCount === 1;
  },
  async historyIds(scope, before, limit) {
    const collection = await getSessionsCollection();
    const prefix = prefixFor(scope, 'history');
    const rows = await collection.find({
      userId: scope.ownerId, purpose: PURPOSE, revokedAt: null, ...unexpired(),
      jti: { $gte: prefix, $lt: before ? `${prefix}${before}` : `${prefix}~` }
    }).project({ jti: 1 }).sort({ jti: -1 }).limit(limit).toArray();
    return rows.map((row) => row.jti.slice(prefix.length));
  }
});
