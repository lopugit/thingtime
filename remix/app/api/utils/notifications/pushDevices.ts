import { createHash, randomUUID } from 'node:crypto';
import { Binary } from 'mongodb';

import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { getHomeThingsCollection, getSessionsCollection } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter } from '../mongodb/uniqueKeys';

export type PushPlatform = 'ios' | 'watchos';
export type PushEnvironment = 'sandbox' | 'production';

export type PushDevice = {
  id: string;
  ownerId: string;
  token: string;
  platform: PushPlatform;
  environment: PushEnvironment;
  topic: string;
  updatedAt: Date;
};

export type PublicPushDevice = Omit<PushDevice, 'ownerId' | 'token' | 'updatedAt'> & { updatedAt: string };

const MAX_DEVICES_PER_USER = 12;
const MAX_BATCH_SIZE = 4;
const TOKEN_PATTERN = /^[0-9a-f]{32,400}$/i;

export const normalizePushDeviceInput = (
  value: unknown
): { ok: false; error: string } | { ok: true; token: string; platform: PushPlatform; environment: PushEnvironment; topic: string; key: string } => {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const token = typeof input.token === 'string' ? input.token.replace(/[<\s>]/g, '').toLowerCase() : '';
  if (!TOKEN_PATTERN.test(token) || token.length % 2 !== 0) {
    return { ok: false, error: 'Device token must be an even-length hexadecimal APNs token' };
  }
  if (input.platform !== 'ios' && input.platform !== 'watchos') {
    return { ok: false, error: 'Platform must be ios or watchos' };
  }
  if (input.environment !== 'sandbox' && input.environment !== 'production') {
    return { ok: false, error: 'Environment must be sandbox or production' };
  }

  const iosTopic = process.env.APNS_IOS_BUNDLE_ID?.trim() || 'com.thingtime.appletime';
  const watchTopic = process.env.APNS_WATCH_BUNDLE_ID?.trim() || `${iosTopic}.watchkitapp`;
  const topic = input.platform === 'watchos' ? watchTopic : iosTopic;
  const key = createHash('sha256').update(`${input.environment}:${topic}:${token}`).digest('hex');
  return { ok: true, token, platform: input.platform, environment: input.environment, topic, key };
};

const packToken = (token: string) => new Binary(Buffer.from(JSON.stringify({ token }), 'utf8'));

const unpackToken = (value: unknown): string => {
  try {
    let bytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    if (Buffer.isBuffer(value)) {
      bytes = value;
    } else if (value && typeof value === 'object' && 'buffer' in value) {
      const binary = value as { buffer: ArrayBuffer; byteOffset?: number; length?: number; byteLength?: number };
      bytes = Buffer.from(binary.buffer, binary.byteOffset || 0, binary.length ?? binary.byteLength);
    }
    const parsed = JSON.parse(bytes.toString('utf8'));
    return typeof parsed?.token === 'string' ? parsed.token : '';
  } catch {
    return '';
  }
};

const publicDevice = (doc: any): PublicPushDevice => ({
  id: String(doc.shareId),
  platform: doc.crystal?.platform,
  environment: doc.crystal?.environment,
  topic: doc.crystal?.topic,
  updatedAt: new Date(doc.updatedAt).toISOString()
});

export const registerPushDevices = async (
  ownerId: string,
  sessionId: string,
  values: unknown
): Promise<{ ok: false; status: number; error: string } | { ok: true; devices: PublicPushDevice[] }> => {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_BATCH_SIZE) {
    return { ok: false, status: 400, error: `Pass between 1 and ${MAX_BATCH_SIZE} devices` };
  }
  const normalized = values.map(normalizePushDeviceInput);
  const failed = normalized.find((entry) => entry.ok === false);
  if (failed?.ok === false) return { ok: false, status: 400, error: failed.error };

  const things = await getHomeThingsCollection();
  const now = new Date();
  for (const device of normalized) {
    if (device.ok === false) continue;
    await things.updateOne(
      thingUniqueKeyFilter('pushDevice', device.key) as any,
      {
        $set: {
          ownerId,
          crystal: { platform: device.platform, environment: device.environment, topic: device.topic },
          secure: packToken(device.token),
          updatedAt: now
        },
        $setOnInsert: {
          shareId: randomUUID(),
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
          thingtime: ['push-device'],
          uniqueKeys: [thingUniqueKey('pushDevice', device.key)],
          extended: null,
          acl: [ACL_OWNER],
          targetId: sessionId,
          tags: [],
          storageClass: 'control',
          createdAt: now
        }
      } as any,
      { upsert: true }
    );
  }

  const rows = await things
    .find({ thingtime: 'push-device', ownerId } as any)
    .sort({ updatedAt: -1, shareId: 1 })
    .project({ _id: 1, shareId: 1, crystal: 1, updatedAt: 1 })
    .toArray();
  if (rows.length > MAX_DEVICES_PER_USER) {
    await things.deleteMany({ _id: { $in: rows.slice(MAX_DEVICES_PER_USER).map((row: any) => row._id) } } as any);
  }
  return { ok: true, devices: rows.slice(0, MAX_DEVICES_PER_USER).map(publicDevice) };
};

export const listPushDevicesForUser = async (ownerId: string): Promise<PushDevice[]> => {
  const things = await getHomeThingsCollection();
  const rows = await things
    .find({ thingtime: 'push-device', ownerId } as any)
    .sort({ updatedAt: -1, shareId: 1 })
    .limit(MAX_DEVICES_PER_USER)
    .project({ shareId: 1, ownerId: 1, targetId: 1, crystal: 1, secure: 1, updatedAt: 1 })
    .toArray();

  const sessionIds = [...new Set(rows.map((row: any) => String(row.targetId || '')).filter(Boolean))];
  const liveSessions = sessionIds.length
    ? await (await getSessionsCollection())
        .find({
          jti: { $in: sessionIds },
          userId: ownerId,
          revokedAt: null,
          $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
        } as any)
        .project({ jti: 1 })
        .toArray()
    : [];
  const liveSessionIds = new Set(liveSessions.map((session: any) => String(session.jti)));

  return rows.flatMap((row: any) => {
    const token = unpackToken(row.secure);
    const platform = row.crystal?.platform;
    const environment = row.crystal?.environment;
    const topic = row.crystal?.topic;
    if (
      !liveSessionIds.has(String(row.targetId || '')) ||
      !token ||
      (platform !== 'ios' && platform !== 'watchos') ||
      (environment !== 'sandbox' && environment !== 'production') ||
      !topic
    ) {
      return [];
    }
    return [{ id: String(row.shareId), ownerId: String(row.ownerId), token, platform, environment, topic, updatedAt: new Date(row.updatedAt) }];
  });
};

export const unregisterPushDevice = async (ownerId: string, id: unknown): Promise<boolean> => {
  if (typeof id !== 'string' || !id.trim()) return false;
  const things = await getHomeThingsCollection();
  const result = await things.deleteOne({ thingtime: 'push-device', ownerId, shareId: id.trim() } as any);
  return result.deletedCount === 1;
};

export const removePushDeviceById = async (id: string): Promise<void> => {
  const things = await getHomeThingsCollection();
  await things.deleteOne({ thingtime: 'push-device', shareId: id } as any);
};
