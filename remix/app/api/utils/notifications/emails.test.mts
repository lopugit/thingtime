import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { beforeEach, mock, test } from 'node:test';

const ENV_KEYS = [
  'APP_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_ENV', 'VERCEL_TARGET_ENV', 'THINGTIME_EMAIL_UNSUB_SECRET'
] as const;
const recipientId = 'synthetic-email-recipient';
const unsubscribeSecret = 'synthetic-notification-email-test-key';
const itemPath = '/thing/synthetic-reminder-item';
const makeTarget = () => ({
  id: recipientId,
  email: 'reminder-recipient@example.invalid',
  emailVerified: true,
  notificationPrefs: { masters: { email: true }, email: { 'lopu-reminder': true } }
});
let target = makeTarget();
let sent: Array<{ to: string; subject: string; html: string; text: string; stream: string }> = [];
const unexpectedAccess = () => { throw new Error('Unexpected persistence or push access in email test'); };

mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: {
  getEmailNotificationTargets: async (ids: string[]) => {
    assert.deepEqual(ids, [recipientId]);
    return [target];
  },
  getUserNotificationPrefs: unexpectedAccess
} });
mock.module(new URL('../email/service.ts', import.meta.url).href, { namedExports: {
  sendEmail: async (message: typeof sent[number]) => { sent.push(message); }
} });
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
  getEmailMessagesCollection: async () => ({
    countDocuments: async (query: any) => {
      assert.equal(query.stream, 'notification');
      assert.equal(query.to, target.email);
      return 0;
    }
  }),
  getHomeThingsCollection: unexpectedAccess,
  getUsersCollection: unexpectedAccess,
  withHomeMongoTransaction: unexpectedAccess
} });
mock.module(new URL('./apns.ts', import.meta.url).href, { namedExports: {
  sendNotificationPush: unexpectedAccess
} });
const { maybeEmailNotification } = await import('./emails');

const notification = {
  recipientId,
  type: 'lopu-reminder' as const,
  actor: { id: 'synthetic-reminder-actor', displayName: 'Reminder test' },
  title: 'Synthetic reminder',
  preview: 'A synthetic reminder with a public item link.',
  href: itemPath
};

beforeEach(() => { target = makeTarget(); sent = []; });

async function withEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, run: () => Promise<void>) {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { THINGTIME_EMAIL_UNSUB_SECRET: unsubscribeSecret }, env);
  try { await run(); } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function assertRenderedLinks(origin: string) {
  await maybeEmailNotification(notification);
  assert.equal(sent.length, 1, 'the synthetic notification must reach the mocked delivery boundary');
  const message = sent[0];
  assert.equal(message.to, target.email);
  assert.equal(message.subject, notification.title);
  assert.equal(message.stream, 'notification');
  const token = createHmac('sha256', unsubscribeSecret).update(`email-unsub:v1:${recipientId}`).digest('hex');
  const expectedLinks = [
    `${origin}${itemPath}`,
    `${origin}/settings`,
    `${origin}/api/v1/notifications/email/unsubscribe?uid=${recipientId}&token=${token}`
  ];
  const htmlLinks = [...message.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, '&'));
  const textLinks = message.text.match(/https?:\/\/[^\s]+/g) || [];
  assert.deepEqual(htmlLinks, expectedLinks, 'HTML item, settings and unsubscribe URLs use the trusted public origin');
  assert.deepEqual(textLinks, expectedLinks, 'plain text carries the same usable URLs as HTML');
}

test('requestless reminder emails use the canonical public origin when APP_URL is missing', async () => {
  await withEnv({}, async () => assertRenderedLinks('https://thingtime.com'));
});

test('configured APP_URL overrides deployment metadata and trims trailing slashes', async () => {
  await withEnv({ APP_URL: ' https://notifications.example.invalid/// ', VERCEL_ENV: 'production',
    VERCEL_URL: 'synthetic-deployment.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'thingtime.com' },
  async () => assertRenderedLinks('https://notifications.example.invalid'));
});

test('production reminder emails use the platform production domain without APP_URL', async () => {
  await withEnv({ APP_URL: ' ', VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'production',
    VERCEL_PROJECT_PRODUCTION_URL: 'https://thingtime.com/', VERCEL_BRANCH_URL: 'synthetic-main.vercel.app',
    VERCEL_URL: 'synthetic-deployment.vercel.app' }, async () => assertRenderedLinks('https://thingtime.com'));
});

test('preview reminder emails prefer the stable branch URL over the deployment and production URLs', async () => {
  await withEnv({ VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'thingtime.com',
    VERCEL_BRANCH_URL: 'synthetic-preview.vercel.app', VERCEL_URL: 'synthetic-deployment.vercel.app' },
  async () => assertRenderedLinks('https://synthetic-preview.vercel.app'));
});

test('preview reminder emails use the platform deployment URL when no branch URL exists', async () => {
  await withEnv({ VERCEL_ENV: 'preview', VERCEL_URL: 'synthetic-deployment.vercel.app' },
    async () => assertRenderedLinks('https://synthetic-deployment.vercel.app'));
});

test('explicit local development APP_URL remains supported', async () => {
  await withEnv({ APP_URL: 'http://localhost:9999/' }, async () => assertRenderedLinks('http://localhost:9999'));
});

test('the origin change preserves recipient email preferences and verified-address gating', async () => {
  await withEnv({}, async () => {
    target.notificationPrefs.masters.email = false;
    await maybeEmailNotification(notification);
    target = makeTarget(); target.notificationPrefs.email['lopu-reminder'] = false;
    await maybeEmailNotification(notification);
    target = makeTarget(); target.emailVerified = false;
    await maybeEmailNotification(notification);
    assert.deepEqual(sent, []);
  });
});
