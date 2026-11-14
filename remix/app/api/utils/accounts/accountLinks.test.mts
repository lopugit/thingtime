import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let present = true, touchWins = true, homeReads = 0;
const touches: any[] = [];
const home = {
  findOne: async () => { homeReads++; return present ? { _id: 'authority-link' } : null; },
  updateOne: async (filter: any, update: any, options: any) => { touches.push({ filter, update, options }); return { matchedCount: touchWins ? 1 : 0 }; }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
  getHomeThingsCollection: async () => home,
  getThingsCollection: async () => { throw Error('Account links must never trust the selected content plane'); }
} });
const { userCanManageApp, userOwnsLinkedAccount } = await import('./accountLinks');
const app = { shareId: 'app-root', ownerId: 'owner', crystal: { clientId: 'client' } };

beforeEach(() => { present = true; touchWins = true; homeReads = 0; touches.length = 0; });

test('app co-manager authority and account ownership are resolved on the home plane', async () => {
  assert.equal(await userCanManageApp('owner', app), true);
  assert.equal(homeReads, 0);
  assert.equal(await userCanManageApp('manager', app), true);
  assert.equal(await userOwnsLinkedAccount('manager', 'account'), true);
  assert.equal(homeReads, 2);
  assert.equal(touches.length, 0, 'ordinary read checks do not mutate authority');
});

test('transactional app changes touch the exact authority row and fail after a concurrent unlink', async () => {
  const session = { active: true };
  assert.equal(await userCanManageApp('manager', app, session), true);
  assert.equal(touches.length, 1);
  assert.equal(touches[0].filter._id, 'authority-link');
  assert.equal(touches[0].filter.thingtime, 'account-link');
  assert.equal(touches[0].options.session, session);
  assert.match(touches[0].update.$set.authorizationFence, /^[0-9a-f-]{36}$/);
  touchWins = false;
  assert.equal(await userCanManageApp('manager', app, session), false);
  present = false;
  assert.equal(await userCanManageApp('manager', app, session), false);
});
