import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayPolicy, gatewayMetadata, gatewayDeploymentIssue, gatewayRuntimeEnvironment, gatewayPublisherEnvironment, gatewayRuntimeArgs, gatewaySecretConfigured, reconcileGatewayAliases } from './environment-gateway-policy.mjs';

test('trusted owners and followers preserve the three environment boundaries', () => {
  const production = gatewayPolicy({ branch: 'main', target: { slug: 'production' } });
  const develop = gatewayPolicy({ branch: 'develop', target: { slug: 'develop' } });
  const master = gatewayPolicy({ branch: 'main', target: { slug: 'preview' }, owner: true });
  for (const [policy, environment, origin] of [[production, 'production', 'https://thingtime.com'], [develop, 'develop', 'https://dev.thingtime.com'], [master, 'preview', 'https://master.previews.thingtime.com']]) {
    assert.equal(policy.environment, environment);
    assert.equal(policy.origin, origin);
    assert.equal(gatewayRuntimeEnvironment(policy).THINGTIME_MONGODB_CONNECTION_MODE, 'proxy');
  }
  for (const slug of ['preview', 'develop']) {
    const follower = gatewayPolicy({ branch: 'feature/backend', target: { slug }, follower: true });
    assert.equal(follower.owner, false);
    assert.equal(gatewayRuntimeEnvironment(follower).THINGTIME_MONGODB_CONNECTION_MODE, undefined);
  }
  assert.equal(gatewayPolicy({ branch: 'develop', target: { slug: 'develop' }, follower: true }).owner, false);
  assert.throws(() => gatewayPolicy({ branch: 'feature/x', target: { slug: 'preview' }, owner: true }), /trusted main/);
  assert.throws(() => gatewayPolicy({ branch: 'feature/x', target: { slug: 'production' } }), /requires main/);
  assert.throws(() => gatewayPolicy({ branch: 'staging', target: { slug: 'staging' } }), /mapping missing/);
});

test('publisher secrets and inherited dedicated overrides never enter arguments', () => {
  const policy = gatewayPolicy({ branch: 'main', target: { slug: 'production' } });
  const inherited = { THINGTIME_GATEWAY_SECRET: 'synthetic-secret', THINGTIME_GATEWAY_ORIGIN: 'https://wrong.example', THINGTIME_MONGODB_CONNECTION_MODE: 'dedicated', CI: 'true' };
  const environment = gatewayPublisherEnvironment(policy, inherited);
  assert.equal(environment.THINGTIME_GATEWAY_SECRET, undefined);
  assert.equal(environment.THINGTIME_MONGODB_CONNECTION_MODE, 'proxy');
  assert.equal(environment.THINGTIME_GATEWAY_ORIGIN, policy.origin);
  assert.equal(environment.CI, 'true');
  const args = gatewayRuntimeArgs(policy);
  assert.ok(args.includes('THINGTIME_GATEWAY_ORIGIN'));
  assert.ok(!args.includes('synthetic-secret'));
  assert.ok(!args.some((value) => value.includes('=')));
  assert.equal(gatewayDeploymentIssue({ meta: gatewayMetadata(policy) }, policy), null);
  assert.equal(gatewayDeploymentIssue({ meta: {} }, policy), 'gateway-policy');
});

test('bootstrap secret must be encrypted and match the selected credential scope', () => {
  const rows = [{ key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', target: ['preview'], customEnvironmentIds: ['env_develop'] }];
  assert.equal(gatewaySecretConfigured(rows, { slug: 'preview', id: '' }), true);
  assert.equal(gatewaySecretConfigured(rows, { slug: 'develop', id: 'env_develop' }), true);
  assert.equal(gatewaySecretConfigured(rows, { slug: 'production', id: '' }), false);
  assert.equal(gatewaySecretConfigured(rows, { slug: 'develop', id: 'env_other' }), false);
  assert.equal(gatewaySecretConfigured([{ ...rows[0], type: 'plain' }], { slug: 'preview', id: '' }), false);
});

test('failed post-promotion API acceptance restores every old binding', async () => {
  const aliases = new Map([['thingtime.com', { deploymentId: 'old' }], ['www.thingtime.com', { deploymentId: 'old' }]]);
  const read = async (name) => aliases.get(name) || null;
  const assign = async (name, deploymentId) => aliases.set(name, { deploymentId });
  const remove = async (name) => aliases.delete(name);
  await assert.rejects(reconcileGatewayAliases({ names: [...aliases.keys()], deploymentId: 'new', read, assign, remove, verify: async (name) => { if (name.startsWith('www')) throw Error('API refused'); } }), /API refused/);
  assert.equal((await read('thingtime.com')).deploymentId, 'old');
  assert.equal((await read('www.thingtime.com')).deploymentId, 'old');
  await assert.rejects(reconcileGatewayAliases({ names: ['new-master.example'], deploymentId: 'new', read, assign, remove, verify: async () => { throw Error('API refused'); } }), /API refused/);
  assert.equal(await read('new-master.example'), null);
  await assert.rejects(reconcileGatewayAliases({ names: ['thingtime.com'], deploymentId: 'new', read, assign, remove, verify: async () => { aliases.set('thingtime.com', { deploymentId: 'concurrent-operator' }); throw Error('API refused'); } }), /API refused/);
  assert.equal((await read('thingtime.com')).deploymentId, 'concurrent-operator');
});


test('rollback uses the pre-upload snapshot even when the CLI already autoassigned domains', async () => {
  const before = new Map([['dev.thingtime.com', { deploymentId: 'old-develop' }]]);
  const current = new Map([['dev.thingtime.com', { deploymentId: 'cli-autoassigned-new' }]]);
  await assert.rejects(reconcileGatewayAliases({
    names: [...before.keys()], before, deploymentId: 'cli-autoassigned-new',
    read: async (name) => current.get(name) || null,
    assign: async (name, deploymentId) => current.set(name, { deploymentId }),
    remove: async (name) => current.delete(name),
    verify: async () => { throw Error('failed post-upload API acceptance'); }
  }), /API acceptance/);
  assert.equal(current.get('dev.thingtime.com').deploymentId, 'old-develop');
});
