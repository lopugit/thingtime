import { connect } from 'node:http2';
import { createHash, createPrivateKey, sign } from 'node:crypto';

import { clampPreview } from './notifications';
import type { EmitNotificationInput } from './notifications';
import { listPushDevicesForUser, removePushDeviceById, type PushDevice } from './pushDevices';

type ApnsConfig = { keyId: string; teamId: string; privateKey: string };
type PushEnvelope = EmitNotificationInput & { notificationId: string };

const ACTIONS: Record<string, string> = {
  'friend-request': 'sent you a friend request',
  'friend-accepted': 'accepted your friend request',
  'new-follower': 'followed you',
  'post-from-followed': 'shared a new post',
  'post-from-friend': 'shared a post with friends',
  comment: 'commented on your post',
  reply: 'replied to your comment',
  reaction: 'reacted to your post',
  share: 'shared your post',
  mention: 'mentioned you',
  groups: 'sent a group update'
};

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

const apnsConfig = (): ApnsConfig | null => {
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const raw = process.env.APNS_PRIVATE_KEY?.trim();
  if (!keyId || !teamId || !raw) return null;
  const decoded = raw.includes('BEGIN PRIVATE KEY') ? raw.replace(/\\n/g, '\n') : Buffer.from(raw, 'base64').toString('utf8');
  if (!decoded.includes('BEGIN PRIVATE KEY')) return null;
  return { keyId, teamId, privateKey: decoded };
};

let cachedProviderToken: { value: string; issuedAt: number; signature: string } | null = null;

const providerToken = (config: ApnsConfig): string => {
  const now = Math.floor(Date.now() / 1000);
  const signatureKey = createHash('sha256')
    .update(`${config.teamId}:${config.keyId}:`)
    .update(config.privateKey)
    .digest('hex');
  if (cachedProviderToken && cachedProviderToken.signature === signatureKey && now - cachedProviderToken.issuedAt < 45 * 60) {
    return cachedProviderToken.value;
  }
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: now }));
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(config.privateKey),
    dsaEncoding: 'ieee-p1363'
  });
  const value = `${signingInput}.${base64url(signature)}`;
  cachedProviderToken = { value, issuedAt: now, signature: signatureKey };
  return value;
};

export const notificationURL = (notification: Pick<EmitNotificationInput, 'postId' | 'actor'>): string => {
  if (notification.postId) return `/post/${encodeURIComponent(notification.postId)}`;
  if (notification.actor.username) return `/profile/${encodeURIComponent(notification.actor.username)}`;
  return '/notifications';
};

// Clamp at this channel's own boundary, exactly as emails.ts does for the mail
// template. `emitNotification` hands every channel the RAW input, and a preview
// is raw post/comment text (things.ts) bounded only by MAX_TEXT_CHARS = 5000 —
// well past the 4 KB APNs payload ceiling. Unclamped, a long comment made APNs
// reject the whole push with 413/PayloadTooLarge, and since only
// 410/BadDeviceToken/Unregistered is actioned below it failed silently: the
// bell and the email still arrived, the iPhone and Watch got nothing.
export const buildApnsPayload = (notification: PushEnvelope) => {
  const actor = notification.actor.displayName || notification.actor.username || 'Someone';
  const action = ACTIONS[notification.type] || 'sent you a Thingtime notification';
  const preview = clampPreview(notification.preview);
  return {
    aps: {
      alert: { title: `${actor} ${action}`, ...(preview ? { body: preview } : {}) },
      sound: 'default',
      'thread-id': notification.postId || notification.targetId || notification.type
    },
    notificationId: notification.notificationId,
    type: notification.type,
    url: notificationURL(notification),
    ...(notification.postId ? { postId: notification.postId } : {}),
    ...(notification.targetId ? { targetId: notification.targetId } : {})
  };
};

const sendDevice = async (
  authToken: string,
  device: PushDevice,
  payload: ReturnType<typeof buildApnsPayload>,
  collapseId: string
): Promise<{ status: number; reason: string | null }> => {
  const authority = device.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const client = connect(authority);
  client.setTimeout(8_000, () => client.destroy(new Error('APNs request timed out')));
  try {
    return await new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        client.off('error', fail);
        reject(error);
      };
      client.once('error', fail);
      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${device.token}`,
        authorization: `bearer ${authToken}`,
        'apns-topic': device.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-collapse-id': collapseId
      });
      let status = 0;
      let body = '';
      request.setEncoding('utf8');
      request.on('response', (headers) => {
        status = Number(headers[':status'] || 0);
      });
      request.on('data', (chunk) => {
        if (body.length < 2048) body += chunk;
      });
      request.on('error', fail);
      request.on('end', () => {
        client.off('error', fail);
        let reason: string | null = null;
        try {
          reason = body ? JSON.parse(body).reason || null : null;
        } catch {
          // APNs may close a successful request with an empty response body.
        }
        resolve({ status, reason });
      });
      request.end(JSON.stringify(payload));
    });
  } finally {
    client.close();
  }
};

export const sendNotificationPush = async (notification: PushEnvelope): Promise<void> => {
  const config = apnsConfig();
  if (!config) return;
  const devices = await listPushDevicesForUser(notification.recipientId);
  if (!devices.length) return;
  const authToken = providerToken(config);
  const payload = buildApnsPayload(notification);
  const results = await Promise.allSettled(
    devices.map(async (device) => ({ device, response: await sendDevice(authToken, device, payload, notification.notificationId) }))
  );
  await Promise.all(
    results.flatMap((result) => {
      if (result.status !== 'fulfilled') return [];
      const { device, response } = result.value;
      if (response.status === 410 || response.reason === 'BadDeviceToken' || response.reason === 'Unregistered') {
        return [removePushDeviceById(device.id)];
      }
      return [];
    })
  );
};
