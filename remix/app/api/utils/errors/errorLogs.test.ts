import assert from 'node:assert/strict';
import test from 'node:test';
import { Binary } from 'mongodb';
import { buildErrorLogThing, scrubErrorLogText, ERROR_LOG_RETENTION_MS } from './errorLogs';
import { isProtectedThingtime, ERROR_LOG_THINGTIME } from '../../../schemas/registry';
import { CONTROL_PLANE_STORAGE_THINGTIMES } from '../storage/storageCore';
import { canViewInherited, viewerOf } from '../things/things';
import { apiV1RouteKeys, createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { thingtimeCapabilityManifest, capabilitySatisfies } from '../capabilities/thingtimeCapabilities';

test('durable errors are protected, nonbillable, expiring Things, inaccessible even to a forged public owner', async () => {
  const now = new Date();
  const doc = buildErrorLogThing(new Error('failure'), { source: 'test' }, undefined, now);
  assert.ok(isProtectedThingtime(doc.thingtime));
  assert.ok(CONTROL_PLANE_STORAGE_THINGTIMES.includes(ERROR_LOG_THINGTIME));
  assert.equal(doc.storageClass, 'control'); assert.deepEqual(doc.acl, []);
  assert.equal(+doc.expiresAt - +doc.createdAt, ERROR_LOG_RETENTION_MS);
  assert.ok(doc.secure instanceof Binary); assert.equal('detail' in doc.crystal, false);
  for (const user of [null, { id: doc.ownerId, username: 'admin', isAdmin: true }]) {
    assert.equal(await canViewInherited({ ...doc, acl: ['tt:all'] } as any, viewerOf(user as any), async () => null), false);
  }
});
test('error snapshots retain the failure reason but remove credentials, URLs, payloads and arbitrary SDK fields', () => {
  const key = 'sk-proj-errorlogfixture123456789';
  const err = Object.assign(new Error(`Rate limit reached ${key} https://service.invalid/path?private=yes data:image/png;base64,secretimage Bearer abc.def.ghi`), { body: 'private request body', headers: { cookie: 'secretcookie' }, code: 'rate_limit_exceeded' });
  const doc = buildErrorLogThing(err, { source: 'moderation', provider: 'openai', status: 429 });
  const detail = Buffer.from(doc.secure.value()).toString();
  assert.match(detail, /Rate limit reached/); assert.match(detail, /rate_limit_exceeded/);
  for (const value of [key, 'service.invalid', 'secretimage', 'abc.def.ghi', 'private request body', 'secretcookie']) assert.ok(!detail.includes(value), value);
  assert.ok(detail.length <= 48 * 1024); assert.ok(doc.crystal.message.length <= 2048);
  assert.equal(scrubErrorLogText('a'.repeat(10000)).includes('a'.repeat(80)), false);
});
test('error log capability is published by both manifests and uses compatible minimums', () => {
  assert.ok(apiV1RouteKeys.includes('v1/admin/error-logs'));
  assert.equal(createApiCapabilitiesManifest().features['api.admin-error-logs'], '1.0.0');
  assert.equal(thingtimeCapabilityManifest('https://thingtime.test').features['api.admin-error-logs'].version, '1.0.0');
  for (const version of ['1.0.0', '1.0.1', '1.1.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), true);
  for (const version of ['', '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(version, '1.0.0'), false);
});
