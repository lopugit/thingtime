import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const stored = new Map<string, any>();
const messages = new Map<string, any>();
const members = new Map<string, any>();
const coalesced = new Set<string>();
let push: any[] = [], email: any[] = [];
let activePushes = 0, peakPushes = 0, userReads = 0;
let acceptOnResolve = false;
let enabled = true, actorLive = true, deny = false, revokeAfterInsert = false;

const sender = 'watchdog-character', receiver = 'owner';
const collection = {
  findOne: async (filter: any) => messages.get(filter.shareId) || null,
  find: (filter: any) => ({ sort: () => ({ limit: (limit: number) => ({ toArray: async () =>
    [...members.values()].filter(row => row.ownerId !== sender && ['active', 'pending'].includes(row.crystal.state) && (!filter.shareId || row.shareId > filter.shareId.$gt)).slice(0, limit).map(row => ({ ...row, crystal: { ...row.crystal } }))
  }) }) })
};
const home = {
  insertOne: async (doc: any) => {
    const keys = (doc.uniqueKeys || []).map((key: any) => key.toString());
    if (stored.has(doc.shareId) || keys.some((key: string) => coalesced.has(key))) throw Object.assign(new Error('duplicate'), { code: 11000 });
    stored.set(doc.shareId, doc); keys.forEach((key: string) => coalesced.add(key));
    if (revokeAfterInsert) deny = true;
  }
};
mock.module('@vercel/functions', { namedExports: { waitUntil: () => {} } });
mock.module(new URL('../deployment/environmentGateway.ts', import.meta.url).href, { namedExports: { withGatewayWork: (run: any) => run() } });
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
  getThingsCollection: async () => collection, getHomeThingsCollection: async () => home,
  getUsersCollection: async () => ({}), withHomeMongoTransaction: async (run: any) => run({})
} });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: {
  findUsersByIds: async (ids: string[]) => { userReads++; return ids.map(id => ({ _id: id, username: id === sender ? 'watchdog' : id === receiver ? 'lopu' : id, displayName: id === sender ? 'Watchdog' : id })); },
  getUserNotificationPrefs: async () => ({ masters: { push: enabled, email: false } })
} });
mock.module(new URL('../auth/characterSession.ts', import.meta.url).href, { namedExports: { characterAccountLive: async () => actorLive } });
mock.module(new URL('../notifications/emails.ts', import.meta.url).href, { namedExports: { maybeEmailNotification: async (input: any) => { email.push(input); }, emailNotificationsBulk: async () => {} } });
mock.module(new URL('../notifications/apns.ts', import.meta.url).href, { namedExports: { sendNotificationPush: async (input: any) => { push.push(input); activePushes++; peakPushes = Math.max(peakPushes, activePushes); await new Promise(resolve => setImmediate(resolve)); activePushes--; } } });
const { notifyChatMessage } = await import('./messageNotifications.ts');
const access = async (id: string) => {
  if (acceptOnResolve && id === receiver) { members.get(receiver).crystal.state = 'active'; acceptOnResolve = false; }
  return deny ? { ok: false } : { chat: { shareId: 'chat' }, member: members.get(id) };
};
const send = (id = 'message-1') => notifyChatMessage(sender, id, access);
beforeEach(() => {
  stored.clear(); messages.clear(); members.clear(); coalesced.clear(); push = []; email = []; activePushes = 0; peakPushes = 0; userReads = 0;
  enabled = true; actorLive = true; deny = false; revokeAfterInsert = false; acceptOnResolve = false;
  members.set(sender, { shareId: 'member-sender', ownerId: sender, crystal: { state: 'active' } });
  members.set(receiver, { shareId: 'member-owner', ownerId: receiver, crystal: { state: 'active' } });
  messages.set('message-1', { shareId: 'message-1', ownerId: sender, targetId: 'chat', crystal: { text: 'PRIVATE body must stay in chat' } });
});
test('Character DM produces private actor-attributed history and deduplicates concurrent/reconciled sends', async () => {
  await Promise.all([send(), send()]); await send();
  assert.equal(stored.size, 1); assert.equal(push.length, 1);
  const row = [...stored.values()][0];
  assert.equal(row.ownerId, receiver); assert.equal(row.crystal.actorId, sender);
  assert.equal(row.crystal.type, 'chat-message'); assert.equal(row.crystal.href, '/messages?chat=chat');
  assert.equal(row.crystal.preview, undefined); assert.equal(JSON.stringify(row).includes('PRIVATE'), false);
  row.readAt = 'already read'; await send(); assert.equal(row.readAt, 'already read');
});
test('one pending request is notified, acceptance does not replay it and later active messages notify', async () => {
  members.get(receiver).crystal.state = 'pending'; await send();
  assert.equal([...stored.values()][0].crystal.type, 'chat-request');
  assert.equal([...stored.values()][0].crystal.href, '/messages?view=requests');
  messages.set('message-2', { ...messages.get('message-1'), shareId: 'message-2' });
  await send('message-2'); assert.equal(stored.size, 1);
  members.get(receiver).crystal.state = 'active'; await send(); assert.equal(stored.size, 1);
  await send('message-2'); assert.equal(stored.size, 2);
});
test('concurrent pending first-message classification cannot amplify requests', async () => {
  members.get(receiver).crystal.state = 'pending'; await send();
  messages.set('message-2', { ...messages.get('message-1'), shareId: 'message-2' });
  await send('message-2'); assert.equal(stored.size, 1); assert.equal(push.length, 1);
});
test('muted chat retains history only; disabled push still retains ordinary history', async () => {
  members.get(receiver).crystal.muted = true; await send();
  assert.equal([...stored.values()][0].historyOnly, true); assert.equal(push.length, 0); assert.equal(email.length, 0);
  stored.clear(); coalesced.clear(); members.get(receiver).crystal.muted = false; enabled = false; await send();
  assert.equal(stored.size, 1); assert.equal([...stored.values()][0].historyOnly, undefined); assert.equal(push.length, 0);
});
test('revoked access, disabled Character and deleted message refuse notification; revocation after persistence refuses fanout', async () => {
  deny = true; await send(); assert.equal(stored.size, 0);
  deny = false; actorLive = false; await send(); assert.equal(stored.size, 0);
  actorLive = true; messages.get('message-1').crystal.deletedAt = 'deleted'; await send(); assert.equal(stored.size, 0);
  messages.get('message-1').crystal.deletedAt = null; revokeAfterInsert = true; await send();
  assert.equal(stored.size, 1); assert.equal(push.length, 0); assert.equal(email.length, 0);
});
test('a failed notification insert can recover from committed-message reconciliation', async () => {
  const original = home.insertOne; let fail = true;
  home.insertOne = async (doc: any) => { if (fail) { fail = false; throw new Error('storage unavailable'); } return original(doc); };
  try { await send(); assert.equal(stored.size, 0); await send(); assert.equal(stored.size, 1); assert.equal(push.length, 1); }
  finally { home.insertOne = original; }
});


test('recipient pagination delivers every member with bounded concurrency and batched source reads', async () => {
  members.delete(receiver);
  for (let i = 0; i < 70; i++) {
    const id = `person-${String(i).padStart(3, '0')}`;
    members.set(id, { shareId: `member-${String(i).padStart(3, '0')}`, ownerId: id, crystal: { state: 'active' } });
  }
  await send();
  assert.equal(stored.size, 70); assert.equal(push.length, 70);
  assert.ok(peakPushes <= 4); assert.ok(userReads < 70, `source/user reads were not batched: ${userReads}`);
});


test('acceptance after recipient paging cannot coalesce an active message into the previous request', async () => {
  members.get(receiver).crystal.state = 'pending'; await send();
  messages.set('message-2', { ...messages.get('message-1'), shareId: 'message-2' });
  acceptOnResolve = true; await send('message-2');
  assert.equal(stored.size, 2); assert.equal(push.length, 2);
  assert.equal([...stored.values()][1].crystal.type, 'chat-message');
});
test('a fresh membership identity has an independent request notification lifecycle', async () => {
  members.get(receiver).crystal.state = 'pending'; await send();
  members.get(receiver).shareId = 'replacement-membership';
  messages.set('message-2', { ...messages.get('message-1'), shareId: 'message-2' });
  await send('message-2'); assert.equal(stored.size, 2);
});
