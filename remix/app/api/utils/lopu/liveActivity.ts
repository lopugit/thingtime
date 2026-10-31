import { createHash } from 'node:crypto';
import { Binary } from 'mongodb';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { getHomeThingsCollection, getSessionsCollection } from '../mongodb/collections';
import { thingUniqueKey } from '../mongodb/uniqueKeys';
import { sendLiveActivityPush } from '../notifications/apns';
import { AI_TASK_KIND } from './backgroundTaskCore';
import { LOPU_ACTIVITY_LIFETIME_MS, LOPU_ACTIVITY_PURPOSE, lopuActivityPushPayload, lopuActivityState, normalizeLopuActivityInput } from './liveActivityCore';

const registrationId = (ownerId: string, scope: string, activityId: string) =>
  `lopu-activity-${createHash('sha256').update(JSON.stringify([ownerId, scope, activityId])).digest('hex')}`;
const registrationFilter = (ownerId: string, taskScope: string) => ({ thingtime: 'push-device', ownerId, taskScope, 'crystal.purpose': LOPU_ACTIVITY_PURPOSE });

export async function registerLopuLiveActivity(ownerId: string, sessionId: string, taskScope: string, input: unknown) {
  const value = normalizeLopuActivityInput(input);
  if (!value) return { ok: false as const, status: 400, error: 'Provide a valid activity token and up to 100 active chats.' };
  const things = await getHomeThingsCollection(), now = new Date();
  const shareId = registrationId(ownerId, taskScope, value.activityId);
  const topic = `${process.env.APNS_IOS_BUNDLE_ID?.trim() || 'com.thingtime.appletime'}.push-type.liveactivity`;
  await things.updateOne({ shareId, ...registrationFilter(ownerId, taskScope) } as any, {
    $set: { targetId: sessionId, taskScope, updatedAt: now,
      expiresAt: new Date(now.getTime() + LOPU_ACTIVITY_LIFETIME_MS),
      crystal: { purpose: LOPU_ACTIVITY_PURPOSE, activityId: value.activityId, chats: value.chats, environment: value.environment, platform: 'ios', topic },
      secure: new Binary(Buffer.from(value.token, 'utf8')) },
    $setOnInsert: { shareId, ownerId, thingtime: ['push-device'], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
      uniqueKeys: [thingUniqueKey('pushDevice', shareId)], storageClass: 'control', acl: [ACL_OWNER], tags: [], createdAt: now }
  } as any, { upsert: true });
  const accountFilter = { thingtime: 'push-device', ownerId, 'crystal.purpose': LOPU_ACTIVITY_PURPOSE };
  const rows = await things.find(accountFilter as any).sort({ updatedAt: -1, shareId: 1 }).project({ shareId: 1 }).toArray();
  if (rows.length > 4) await things.deleteMany({ shareId: { $in: rows.slice(4).map(row => row.shareId) }, ...accountFilter } as any);
  await refreshLopuLiveActivitiesForOwner(ownerId, taskScope);
  return { ok: true as const };
}

export async function unregisterLopuLiveActivity(ownerId: string, taskScope: string, activityId: string) {
  const things = await getHomeThingsCollection();
  await things.deleteOne({ shareId: registrationId(ownerId, taskScope, activityId), ...registrationFilter(ownerId, taskScope) } as any);
}

/** Best effort display only: this never changes task execution or transcript state. */
export async function refreshLopuLiveActivitiesForOwner(ownerId: string, taskScope: string): Promise<void> {
  const things = await getHomeThingsCollection(), now = new Date();
  const filter = registrationFilter(ownerId, taskScope);
  await things.deleteMany({ ...filter, expiresAt: { $lte: now } } as any);
  const rows = await things.find({ ...filter, expiresAt: { $gt: now } } as any).limit(4).toArray();
  if (!rows.length) return;
  const sessions = await (await getSessionsCollection()).find({
    jti: { $in: rows.map(row => row.targetId) }, userId: ownerId, revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  } as any).project({ jti: 1 }).toArray();
  const live = new Set(sessions.map(session => session.jti));
  const chatIds = [...new Set(rows.flatMap(row => (row.crystal?.chats ?? []).map((chat: any) => chat.chatId)))];
  const tasks = await things.find({ ownerId, taskScope, thingtime: AI_TASK_KIND, rootTaskId: { $exists: false }, targetId: { $in: chatIds } } as any)
    .sort({ createdAt: -1, shareId: -1 })
    .project({ targetId: 1, crystal: 1 }).limit(1000).toArray();
  await Promise.all(rows.map(async row => {
    if (!live.has(row.targetId)) {
      await things.deleteOne({ shareId: row.shareId, targetId: row.targetId, updatedAt: row.updatedAt } as any);
      return;
    }
    const state = lopuActivityState(row.crystal?.chats ?? [], tasks);
    const signature = JSON.stringify(state);
    if (row.activityLastState === signature && now.getTime() - new Date(row.activityLastPushedAt ?? 0).getTime() < 60_000) return;
    const raw = row.secure;
    const token = raw instanceof Binary ? Buffer.from(raw.value()).toString('utf8') : '';
    if (!/^[0-9a-f]{32,400}$/.test(token)) return;
    try {
      const response = await sendLiveActivityPush({ id: row.shareId, ownerId, token, platform: 'ios', environment: row.crystal.environment, topic: row.crystal.topic, updatedAt: row.updatedAt }, lopuActivityPushPayload(state), row.crystal.activityId);
      const exact = { shareId: row.shareId, targetId: row.targetId, updatedAt: row.updatedAt };
      if (response.status === 410 || ['BadDeviceToken', 'Unregistered'].includes(response.reason ?? '') || (response.status === 200 && state.activeCount === 0)) {
        await things.deleteOne(exact as any);
      } else if (response.status === 200) {
        await things.updateOne(exact as any, { $set: { activityLastState: signature, activityLastPushedAt: now } } as any);
      }
    } catch {
      // Activity updates must not fail or retry a billed chat turn. The next
      // checkpoint/foreground sync retries; the widget marks old status stale.
    }
  }));
}
