import assert from 'node:assert/strict';
import test from 'node:test';
import { promotePreviewAlias } from './preview-alias-promotion.mjs';

function fixture(previous = 'old') {
  const state = { current: previous, writes: [], events: [], currentChecks: 0 };
  const options = {
    alias: 'pr-1000.example.test', deploymentId: 'candidate',
    read: async () => state.current ? { deploymentId: state.current } : null,
    assign: async (_name, id) => { state.writes.push(id); state.current = id; },
    remove: async () => { state.writes.push('remove'); state.current = null; },
    verifyCandidate: async () => { state.events.push('candidate'); },
    verifyAlias: async () => { state.events.push('alias'); },
    assertCurrent: async () => { state.currentChecks++; }
  };
  return { state, options };
}
const refused = promise => assert.rejects(promise, error => error.preservePreviewAttempt === true);

for (const reason of ['api-http-409', 'api-not-json', 'unreachable']) {
  test(`immutable candidate ${reason} leaves incumbent untouched`, async () => {
    const { state, options } = fixture();
    options.verifyCandidate = async () => { throw new Error(reason); };
    await refused(promotePreviewAlias(options));
    assert.equal(state.current, 'old'); assert.deepEqual(state.writes, []);
  });
}
test('healthy immutable and alias checks bracket the actual promotion', async () => {
  const { state, options } = fixture();
  const assign = options.assign;
  options.assign = async (...args) => { state.events.push('assign'); await assign(...args); };
  assert.deepEqual(await promotePreviewAlias(options), { alias: options.alias, oldDeploymentId: 'old' });
  assert.deepEqual(state.events, ['candidate', 'assign', 'alias']);
  assert.equal(state.currentChecks, 2); assert.equal(state.current, 'candidate');
});
test('post-assignment verification failure restores the captured incumbent', async () => {
  const { state, options } = fixture(); options.verifyAlias = async () => { throw new Error('api-http-409'); };
  await refused(promotePreviewAlias(options));
  assert.deepEqual(state.writes, ['candidate', 'old']); assert.equal(state.current, 'old');
});
test('a failed first publication removes only its own new alias', async () => {
  const { state, options } = fixture(null); options.verifyAlias = async () => { throw new Error('unreachable'); };
  await refused(promotePreviewAlias(options));
  assert.deepEqual(state.writes, ['candidate', 'remove']); assert.equal(state.current, null);
});
test('a concurrent successor is never overwritten during rollback', async () => {
  const { state, options } = fixture();
  options.verifyAlias = async () => { state.current = 'successor'; throw new Error('verification failed'); };
  await refused(promotePreviewAlias(options));
  assert.deepEqual(state.writes, ['candidate']); assert.equal(state.current, 'successor');
});
test('an incumbent changed before assignment is preserved without a write', async () => {
  const { state, options } = fixture(); let reads = 0; const read = options.read;
  options.read = async () => { if (++reads === 2) state.current = 'successor'; return read(); };
  await refused(promotePreviewAlias(options));
  assert.deepEqual(state.writes, []); assert.equal(state.current, 'successor');
});
test('uncertain committed assignment is reconciled without losing the true predecessor', async () => {
  const { state, options } = fixture(); const assign = options.assign;
  options.assign = async (...args) => { await assign(...args); if (args[1] === 'candidate') throw new TypeError('lost reply'); };
  options.verifyAlias = async () => { throw new Error('verification failed'); };
  await refused(promotePreviewAlias(options));
  assert.deepEqual(state.writes, ['candidate', 'old']); assert.equal(state.current, 'old');
});
test('uncertain rollback preserves the candidate and reports failure', async () => {
  const { state, options } = fixture(); const assign = options.assign;
  options.assign = async (...args) => { if (args[1] === 'old') throw new TypeError('lost rollback'); await assign(...args); };
  options.verifyAlias = async () => { throw new Error('verification failed'); };
  await refused(promotePreviewAlias(options));
  assert.deepEqual(state.writes, ['candidate']); assert.equal(state.current, 'candidate');
});
test('stale head before promotion cannot mutate an alias', async () => {
  const { state, options } = fixture(); options.assertCurrent = async () => { throw new Error('stale-head'); };
  await refused(promotePreviewAlias(options)); assert.deepEqual(state.writes, []);
});
test('stale head after verification conditionally restores the previous binding', async () => {
  const { state, options } = fixture();
  options.assertCurrent = async () => { if (++state.currentChecks === 2) throw new Error('stale-head'); };
  await refused(promotePreviewAlias(options));
  assert.deepEqual(state.writes, ['candidate', 'old']); assert.equal(state.current, 'old');
});
test('an existing candidate is checked without assignment or destructive rollback', async () => {
  const { state, options } = fixture('candidate'); options.verifyAlias = async () => { throw new Error('verification failed'); };
  await refused(promotePreviewAlias(options)); assert.deepEqual(state.writes, []); assert.equal(state.current, 'candidate');
});
test('an uncertain committed removal is independently reconciled', async () => {
  const { state, options } = fixture(null);
  options.remove = async () => { state.writes.push('remove'); state.current = null; throw new TypeError('lost removal reply'); };
  options.verifyAlias = async () => { throw new Error('verification failed'); };
  await refused(promotePreviewAlias(options)); assert.equal(state.current, null);
});
