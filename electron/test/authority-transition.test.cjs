'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthorityTransition } = require('../lib/authority-transition.cjs');

test('pending endpoint probes and queued runtime configurations exclude session recovery before persistence', async () => {
 for (const pendingAction of ['endpoint probe', 'runtime configuration']) {
  const guard = new AuthorityTransition(); let release; let writes = 0;
  const pending = guard.run(async () => { await new Promise(resolve => { release = resolve; }); writes++; guard.retainUntilRestart(); });
  await assert.rejects(guard.run(async () => { writes++; }), /Finish/, pendingAction);
  assert.equal(writes, 0); release(); await pending;
  assert.equal(writes, 1);
  await assert.rejects(guard.run(async () => {}), /Finish/);
 }
});
test('cancelled or failed transitions allow retry, completed recovery excludes all backend changes until restart', async () => {
 const guard = new AuthorityTransition();
 await guard.run(async () => false);
 await assert.rejects(guard.run(async () => { throw new Error('cancelled'); }), /cancelled/);
 await guard.run(async () => guard.retainUntilRestart());
 await assert.rejects(guard.run(async () => {}), /Finish/);
});
