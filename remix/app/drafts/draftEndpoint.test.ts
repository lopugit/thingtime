import assert from 'node:assert/strict';
import test from 'node:test';
import { createDraftHandler } from '../routes/api/v1/drafts/_drafts';

const content = { name: 'Independent template', surface: 'post', context: 'post:new:', snapshot: '{}', attachmentIds: [] };
test('draft save defaults remain compatible; template mode is explicit and validated behind account admission', async () => {
 const calls: unknown[][] = [];
 let actor: any = { kind: 'user', user: { id: 'owner' } };
 const handler = createDraftHandler({ resolveActor: async () => actor, enforceRateLimit: async () => ({ allowed: true }),
  saveDraft: async (...args: unknown[]) => { calls.push(args); return { ...content, id: 'draft', mode: args[2], revision: 1 }; }
 } as any);
 const send = (input: any) => handler({ request: new Request('http://localhost/api/v1/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, body: JSON.stringify(input) }) });
 const input = { operation: 'save', id: 'draft', writeId: 'write', revision: 0, expectedActor: 'owner', content };
 assert.equal((await send(input)).status, 200); assert.equal(calls[0][2], 'draft');
 assert.equal((await send({ ...input, mode: 'template' })).status, 200); assert.equal(calls[1][2], 'template');
 for (const mode of ['owner', null, {}, true]) assert.equal((await send({ ...input, mode })).status, 400);
 assert.equal((await send({ ...input, expectedActor: 'other' })).status, 409);
 actor = { kind: 'anonymous' };
 const refused = await send({ ...input, mode: 'template' }); assert.equal(refused.status, 401);
 assert.equal(refused.headers.get('Cache-Control'), 'private, no-store'); assert.equal(calls.length, 2);
});
