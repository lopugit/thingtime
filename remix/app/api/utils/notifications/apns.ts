import type { PushDeliveryReport } from './pushDeliveryCore';
export type { PushDeliveryReport } from './pushDeliveryCore';
import { connect } from 'node:http2';
import { createHash, createPrivateKey, sign } from 'node:crypto';

import { clampPreview, safeInternalHref } from './notifications';
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

export const notificationURL = (notification: Pick<EmitNotificationInput, 'postId' | 'actor'> & Partial<Pick<EmitNotificationInput, 'type' | 'href'>>): string => {
  if (notification.type === 'lopu-reminder') return safeInternalHref(notification.href) || '/settings';
  if (notification.type === 'recording-reminder') return safeInternalHref(notification.href) || '/lopu/recordings';
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
      alert: {
        title: (notification.title || notification.type === 'recording-reminder')
          ? clampPreview(notification.title) || 'A little reminder from Lopu'
          : `${actor} ${action}`,
        ...(preview ? { body: preview } : {})
      },
      ...(notification.delivery === 'quiet' ? {} : { sound: 'default' }),
      'interruption-level': notification.delivery === 'urgent' ? 'time-sensitive' : notification.delivery === 'quiet' ? 'passive' : 'active',
      'thread-id': notification.postId || notification.targetId || notification.type
    },
    notificationId: notification.notificationId,
    type: notification.type,
    url: notificationURL(notification),
    ...(notification.postId ? { postId: notification.postId } : {}),
    ...(notification.targetId ? { targetId: notification.targetId } : {})
  };
};

// APNs collapse identifiers are limited to 64 bytes; reminder/test Thing IDs
// can exceed that. A stable digest preserves coalescing without truncation collisions.
export const apnsCollapseId = (notificationId: string): string =>
  createHash('sha256').update(notificationId).digest('hex');

const sendDevice = async (
  authToken: string,
  device: PushDevice,
  payload: ReturnType<typeof buildApnsPayload>,
  collapseId: string
): Promise<{ status: number; reason: string | null }> => {
  const authority = device.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const client = connect(authority);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      client.on('error', fail);
      client.once('close', () => fail(new Error('APNs connection closed')));
      timeout = setTimeout(() => { fail(new Error('APNs request timed out')); client.destroy(); }, 10_000);
      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${device.token}`,
        authorization: `bearer ${authToken}`,
        'apns-topic': device.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-collapse-id': apnsCollapseId(collapseId)
      });
      let status = 0;
      let body = '';
      request.setEncoding('utf8');
      request.on('response', (headers) => { status = Number(headers[':status'] || 0); });
      request.on('data', (chunk) => { if (body.length < 2048) body += chunk; });
      request.on('error', fail);
      request.once('close', () => fail(new Error('APNs stream closed')));
      request.on('end', () => {
        if (settled) return;
        settled = true;
        let reason: string | null = null;
        try { reason = body ? JSON.parse(body).reason || null : null; } catch {}
        resolve({ status, reason });
      });
      request.end(JSON.stringify(payload));
    });
  } finally {
    clearTimeout(timeout);
    client.destroy();
  }
};

export const pushConfigured = (): boolean => {
  try { const config = apnsConfig(); if (!config) return false; const key = createPrivateKey(config.privateKey); return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1'; }
  catch { return false; }
};

const pushDependencies = {
  token: () => { const config = apnsConfig(); return config ? providerToken(config) : null; },
  devices: listPushDevicesForUser,
  send: sendDevice,
  remove: removePushDeviceById
};

const APNS_REASONS = new Set(['BadCollapseId', 'BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'InvalidProviderToken', 'ExpiredProviderToken', 'MissingProviderToken', 'TopicDisallowed', 'BadTopic', 'MissingTopic', 'TooManyProviderTokenUpdates', 'TooManyRequests', 'PayloadTooLarge', 'Forbidden', 'BadCertificate', 'BadCertificateEnvironment', 'InternalServerError', 'ServiceUnavailable', 'Shutdown']);

// Counts and bounded reason codes only: never expose tokens, signing material,
// provider responses, or another account's registrations to the settings UI.
export const createPushSender = (deps = pushDependencies) => async (notification: PushEnvelope): Promise<PushDeliveryReport> => {
  const report: PushDeliveryReport = { status: 'failed', attempted: 0, accepted: 0, rejected: 0, ios: 0, watchos: 0, reasons: [] };
  let authToken: string | null;
  try { authToken = deps.token(); } catch { return { ...report, status: 'unconfigured' }; }
  if (!authToken) return { ...report, status: 'unconfigured' };
  const devices = await deps.devices(notification.recipientId);
  if (!devices.length) return { ...report, status: 'no-devices' };
  const payload = buildApnsPayload(notification);
  for (let offset = 0; offset < devices.length; offset += 4) {
    await Promise.all(devices.slice(offset, offset + 4).map(async device => {
      report.attempted++;
      try {
        const response = await deps.send(authToken!, device, payload, notification.notificationId);
        if (response.status === 200) { report.accepted++; report[device.platform]++; return; }
        report.rejected++;
        const reason = response.reason && APNS_REASONS.has(response.reason) ? response.reason : 'ProviderRejected';
        report.reasons.push(reason);
        if (response.status === 410 || ['BadDeviceToken', 'Unregistered'].includes(reason)) await deps.remove(device.id).catch(() => {});
      } catch { report.rejected++; report.reasons.push('TransportError'); }
    }));
  }
  report.status = report.accepted === report.attempted ? 'accepted' : report.accepted ? 'partial' : 'failed';
  report.reasons = [...new Set(report.reasons)];
  return report;
};

export const sendNotificationPush = createPushSender();
