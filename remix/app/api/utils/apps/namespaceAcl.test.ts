import assert from 'node:assert/strict';
import test from 'node:test';
import { appCanViewDoc, appNamespaceClauses, type AppNamespaceScope } from './namespace';
import { resolveInheritChain } from '../things/aclChainCore';
import { legacyAclFence, rootAcl } from '../things/relationalAcl';
const scope: AppNamespaceScope = { appId: 'app-a', ownerId: 'reader', sharedRead: true, scopes: ['app-data.shared'], username: 'reader', sandbox: null };
const relational = (baseline: string[], patch: Record<string, unknown> = {}) => ({ appId: 'app-a', ownerId: 'author', acl: legacyAclFence(baseline), aclBaseline: baseline, aclBaselineVersion: 1, aclGeneration: 'g', ...patch });
test('app namespace reads logical relational audience without weakening namespace or token fences', () => {
 assert.equal(appCanViewDoc(scope, relational(['tt:user', 'tt:app/app-a'])), true);
 assert.equal(appCanViewDoc(scope, relational(['tt:user'])), false);
 assert.equal(appCanViewDoc(scope, relational(['tt:user'], { ownerId: 'reader' })), true);
 assert.equal(appCanViewDoc({ ...scope, sharedRead: false }, relational(['tt:app/app-a'])), false);
 assert.equal(appCanViewDoc(scope, relational(['tt:app/app-a'], { appId: 'other' })), false);
 assert.equal(appCanViewDoc(scope, relational(['tt:app/app-a'], { sandboxExpiresAt: new Date() })), false);
 assert.equal(appCanViewDoc(scope, relational(['tt:inherit'])), false, 'inherit is only a coarse candidate until its real ancestor is resolved');
 const audience = appNamespaceClauses(scope)[2] as any;
 assert.deepEqual(audience.$or[1].$or[1].acl.$in, ['-tt:app/app-a', '-tt:inherit']);
 assert.deepEqual(appNamespaceClauses({ ...scope, sharedRead: false })[2], { ownerId: 'reader' });
});
test('malformed relational envelopes deny even the namespace owner', () => {
 for (const patch of [{ aclBaselineVersion: 2 }, { aclBaseline: ['tt:all'] }, { acl: ['tt:user'] }, { aclGeneration: '' }, { aclGeneration: null }])
  assert.equal(appCanViewDoc(scope, relational(['tt:user'], { ownerId: 'reader', ...patch })), false);
});

test('relational inherited app children resolve the stored terminal audience', async () => {
 const child = { ...relational(['tt:inherit']), shareId: 'child', targetId: 'parent' };
 let parent = { ...relational(['tt:app/app-a']), shareId: 'parent' };
 const verdict = async () => {
  const terminal = await resolveInheritChain(child, doc => rootAcl(doc as any).includes('tt:inherit'), async id => id === 'parent' ? parent as any : null);
  return appCanViewDoc(scope, terminal);
 };
 assert.equal(await verdict(), true);
 parent = { ...relational(['tt:user']), shareId: 'parent' };
 assert.equal(await verdict(), false);
 parent = { ...relational(['tt:app/other'], { appId: 'other' }), shareId: 'parent' };
 assert.equal(await verdict(), false);
});
