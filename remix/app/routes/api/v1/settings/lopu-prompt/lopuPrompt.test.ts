import assert from 'node:assert/strict';
import test from 'node:test';
import { createLopuPromptHandlers } from './_lopu-prompt';
import { LopuPromptConflictError } from '~/api/utils/lopu/promptSettingsCore';
const fixture = (user: any) => {
  const writes: any[] = [], reads: string[] = [];
  const deps: Parameters<typeof createLopuPromptHandlers>[0] = {
    getCurrentUser: async () => user,
    getLopuBasePrompt: async () => ({ basePrompt: 'Public base', revision: 'base-1' }),
    getUserLopuInstructions: async id => { reads.push(id); return { revision: 'personal-1', instructions: [{ id: 'own', text: `Private ${id}`, enabled: true }] }; },
    setLopuBasePrompt: async (basePrompt, revision, actor) => { writes.push({ basePrompt, revision, actor }); return { basePrompt: String(basePrompt), revision: 'base-2' }; },
    setUserLopuInstructions: async (id, instructions, revision) => { writes.push({ id, instructions, revision }); return { instructions: instructions as any, revision: 'personal-2' }; },
    enforceRateLimit: async () => ({ allowed: true } as any)
  };
  const request = (body?: unknown) => new Request('http://localhost/api/v1/settings/lopu-prompt', body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { deps, writes, reads, call: (body?: unknown) => createLopuPromptHandlers(deps)[body === undefined ? 'loader' : 'action']({ request: request(body) }) };
};
test('anonymous and service callers can see the base but no private instructions; neither may write', async () => {
  for (const viewer of [null, { id: 'service', accountKind: 'service', isAdmin: true }]) {
    const f = fixture(viewer); const read = await f.call();
    assert.equal(read.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual((await read.json()).personal, { revision: null, instructions: [] });
    assert.equal(f.reads.length, 0);
    assert.equal((await f.call({ scope: 'base', revision: null, basePrompt: 'Hijack' })).status, 401);
    assert.equal(f.writes.length, 0);
  }
});
test('personal writes are account-bound and base changes require an admin', async () => {
  const f = fixture({ id: 'alice', accountKind: 'user', isAdmin: false });
  assert.equal((await (await f.call()).json()).personal.instructions[0].text, 'Private alice');
  const body = { scope: 'personal', revision: 'personal-1', instructions: [{ id: 'a', text: 'Preference', enabled: false }] };
  assert.equal((await f.call({ ...body, userId: 'bob' })).status, 400);
  assert.equal((await f.call({ scope: 'base', revision: 'base-1', basePrompt: 'Hijack' })).status, 403);
  assert.equal((await f.call(body)).status, 200);
  assert.deepEqual(f.writes, [{ id: 'alice', instructions: body.instructions, revision: 'personal-1' }]);
});
test('admin base writes are validated and stale revisions return a conflict', async () => {
  const f = fixture({ id: 'admin', accountKind: 'user', isAdmin: true });
  assert.equal((await f.call({ scope: 'base', revision: 'base-1', basePrompt: 'Updated public prompt' })).status, 200);
  assert.equal(f.writes[0].actor, 'admin');
  assert.equal((await f.call({ scope: 'base', basePrompt: 'Missing revision' })).status, 400);
  f.deps.setLopuBasePrompt = async () => { throw new LopuPromptConflictError(); };
  assert.equal((await f.call({ scope: 'base', revision: 'base-1', basePrompt: 'Stale edit' })).status, 409);
});

test('personal lists exceed the old count/text caps while authentication and transport bounds remain', async () => {
  const f = fixture({ id: 'alice', accountKind: 'user', isAdmin: false });
  const instructions = Array.from({ length: 35 }, (_, i) => ({ id: String(i), text: i === 0 ? 'x'.repeat(2100) : 'Keep this instruction.', enabled: true }));
  assert.equal((await f.call({ scope: 'personal', revision: 'personal-1', instructions })).status, 200);
  assert.deepEqual(f.writes[0].instructions, instructions);
  await assert.rejects(f.call({ scope: 'personal', revision: 'personal-1', instructions: [{ id: 'large', text: 'x'.repeat(100000), enabled: true }] }), (error: unknown) => error instanceof Response && error.status === 413);
});


test('base-only reads remain public and do not touch retained personal instructions', async () => {
  for (const user of [null, { id: 'admin', accountKind: 'user', isAdmin: true }]) {
    const f = fixture(user);
    f.deps.getUserLopuInstructions = async () => { throw new Error('Personal read must not occur'); };
    const response = await createLopuPromptHandlers(f.deps).loader({ request: new Request('http://localhost/api/v1/settings/lopu-prompt?scope=base') });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, base: { basePrompt: 'Public base', revision: 'base-1' } });
  }
});
test('malformed JSON is a field-validation refusal and transport overflow remains a thrown HTTP 413 response', async () => {
  const f = fixture({ id: 'alice', accountKind: 'user' });
  const response = await createLopuPromptHandlers(f.deps).action({ request: new Request('http://localhost/api/v1/settings/lopu-prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }) });
  assert.equal(response.status, 400);
  // The canonical Nitro catch-all recognizes a thrown Response before its
  // generic error logger; this preserves that executable dispatch boundary.
  await assert.rejects(createLopuPromptHandlers(f.deps).action({ request: new Request('http://localhost/api/v1/settings/lopu-prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(96*1024+1) }) }), (error: unknown) => error instanceof Response && error.status === 413);
});
