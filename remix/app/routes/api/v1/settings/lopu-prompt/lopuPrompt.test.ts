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
