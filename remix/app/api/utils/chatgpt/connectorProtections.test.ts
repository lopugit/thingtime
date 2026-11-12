import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectorProtectionHandler } from '~/routes/api/v1/settings/connector-protections/_connector-protections';
import { toPublicUser } from '~/api/utils/auth/users';
import {
  CONNECTOR_PROTECTIONS_PATH, connectorConfirmationsForMutation, effectiveConnectorConfirmations,
  parseConnectorConfirmations, parseConnectorConfirmationPatch, requiredConnectorConfirmations,
  type ConnectorConfirmationPatch
} from './connectorProtections';

test('only exact known booleans can change the account rules; missing or untrusted rules default to on', () => {
  const all = effectiveConnectorConfirmations();
  assert.equal(Object.values(all).length, 10);
  assert.ok(Object.values(all).every(Boolean));
  assert.deepEqual(effectiveConnectorConfirmations({ create: false, delete: 0 }), { ...all, create: false });
  assert.equal(parseConnectorConfirmationPatch({ create: false, unknown: false }), null);
  assert.equal(parseConnectorConfirmationPatch({ create: 'false' }), null);
  assert.equal(parseConnectorConfirmations({ create: false }), null);
  assert.deepEqual(requiredConnectorConfirmations({ ...all, create: false }, [
    ...connectorConfirmationsForMutation('create', { thingtime: ['comment'] }),
    ...connectorConfirmationsForMutation('update', { acl: ['tt:all'] }), 'workflow'
  ]), ['comment', 'update', 'share', 'workflow']);
});

test('settings read accepts the owning session or live Things PAT; only a matching interactive account can write', async () => {
  const accounts = new Map<string, ConnectorConfirmationPatch>();
  const route = createConnectorProtectionHandler({
    getCurrentUser: async (request: Request) => {
      switch (request.headers.get('Cookie')) {
        case 'owner': return { id: 'owner', accountKind: 'user' };
        case 'other': return { id: 'other', accountKind: 'user' };
        case 'service': return { id: 'service', accountKind: 'service' };
        case 'temporary': return { id: 'temporary', accountKind: 'user', temporary: true };
        default: return null;
      }
    },
    resolvePatIntrospection: async (request: Request) => {
      const auth = request.headers.get('Authorization');
      if (auth === 'Bearer app' || auth === 'Bearer oauth') return { ok: false, status: 401 };
      return { ok: true, user: { id: 'owner' }, token: { status: auth === 'Bearer revoked' ? 'revoked' : 'active',
        scopes: auth === 'Bearer report' ? ['agents.report'] : ['things.read'] } };
    },
    enforceRateLimit: async () => ({ allowed: true }),
    getUserConnectorConfirmations: async (id: string) => effectiveConnectorConfirmations(accounts.get(id)),
    setUserConnectorConfirmations: async (id: string, patch: ConnectorConfirmationPatch) => {
      const next = { ...effectiveConnectorConfirmations(accounts.get(id)), ...patch };
      accounts.set(id, next);
      return next;
    }
  } as unknown as Parameters<typeof createConnectorProtectionHandler>[0]);
  const origin = 'https://thingtime.test';
  const req = (headers: Record<string, string> = {}, body?: unknown) => route({ request: new Request(origin + CONNECTOR_PROTECTIONS_PATH, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  }) });
  for (const auth of [undefined, 'app', 'oauth', 'revoked', 'report']) {
    assert.equal((await req(auth ? { Authorization: 'Bearer ' + auth } : {})).status, 401);
  }
  const defaults = await req({ Authorization: 'Bearer active' });
  assert.equal(defaults.status, 200);
  assert.match(defaults.headers.get('Cache-Control') || '', /private, no-store/);
  assert.deepEqual((await defaults.json()).confirmations, effectiveConnectorConfirmations());
  const patch = { confirmations: { create: false } };
  for (const headers of [{ Authorization: 'Bearer active' }, { Cookie: 'service' }, { Cookie: 'temporary' }]) {
    assert.equal((await req(headers, patch)).status, 401);
  }
  assert.equal((await req({ Cookie: 'owner' }, patch)).status, 409);
  assert.equal((await req({ Cookie: 'other', 'X-Thingtime-Expected-Actor': 'owner' }, patch)).status, 409);
  const owner = { Cookie: 'owner', 'X-Thingtime-Expected-Actor': 'owner' };
  assert.equal((await req({ ...owner, Origin: 'https://another.test' }, patch)).status, 403);
  assert.equal((await req(owner, { ...patch, userId: 'other' })).status, 400);
  assert.equal((await req({ ...owner, Origin: 'https://app.thingtime.test', 'X-Forwarded-Host': 'app.thingtime.test', 'X-Forwarded-Proto': 'https', 'Sec-Fetch-Site': 'cross-site' }, patch)).status, 403);
  const changed = await req({ ...owner, Origin: 'https://app.thingtime.test', 'X-Forwarded-Host': 'app.thingtime.test', 'X-Forwarded-Proto': 'https', 'Sec-Fetch-Site': 'same-origin' }, patch);
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).confirmations.create, false);
  await req(owner, { confirmations: { update: false } });
  const second = (await (await req({ Authorization: 'Bearer active' })).json()).confirmations;
  assert.equal(second.create, false);
  assert.equal(second.update, false);
  assert.equal((await (await req({ Cookie: 'other' })).json()).confirmations.create, true);
  assert.doesNotMatch(JSON.stringify(toPublicUser({ _id: 'owner', createdAt: new Date(), meta: { connectorConfirmations: second } })), /connectorConfirmations/);
});
