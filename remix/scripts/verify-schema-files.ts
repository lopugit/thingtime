// Local integration acceptance. Uses the real HTTP API and Lopu tool executor;
// never inserts test data directly into MongoDB. Start an isolated local stack
// with local attachment storage, then pass a seed-fixture state file.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { makePng } from './seed-fixture.mjs';

async function main() {
  const fixturePath = process.argv[2];
  if (!fixturePath) throw new Error('Pass an ignored seed-fixture state file.');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const base = new URL(fixture.base);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Local API only');
  assert.match(process.env.MONGODB_CONNECTION_STRING || '', /^mongodb:\/\/(localhost|127\.0\.0\.1):/, 'Isolated local MongoDB required');
  assert.ok(process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR, 'Local file storage required');
  let cookies = '';
  const fetchApi = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(new URL(path, base), { method, headers: { 'Content-Type': 'application/json', Origin: base.origin, Cookie: cookies }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const set = response.headers.getSetCookie();
    if (set.length) cookies = set.map(value => value.split(';')[0]).join('; ');
    return response;
  };
  const json = async (path: string, body?: unknown, method?: string): Promise<any> => {
    const response = await fetchApi(path, body, method); const result: any = await response.json();
    assert.ok(response.ok && result.ok !== false, `${path}: ${result.error || response.status}`); return result;
  };
  await json('/api/v1/login', { username: fixture.username, password: fixture.password });
  const me = await json('/api/v1/auth/me'); const viewer = me.user;
  assert.ok(viewer?.id && viewer.isAdmin, 'Local fixture must be an admin');
  if (!process.argv.includes('--files-only')) {
  const migration = await json('/api/v1/admin/migrations/run', { migration: 'backfill-user-storage-accounting', dryRun: false, confirm: true });
  assert.ok(migration.report, 'Storage-fenced schema seed report');
  const { thingtimeSchemas } = await import('../app/schemas/registry');
  for (const schema of thingtimeSchemas) {
    const result = await fetch(new URL(`/api/v1/things?id=schema-${schema.id}`, base));
    const payload: any = await result.json();
    assert.equal(payload.ok, true, schema.id); assert.ok(payload.thing.acl.includes('tt:all'), schema.id);
  }
  console.log(`Public Schema Things readable anonymously: ${thingtimeSchemas.length}`);
  }
  const bytes = makePng(160, 100, 7);
  writeFileSync('/tmp/thingtime-post-attachments-qa/upload.png', bytes);
  const upload = async (purpose: string) => {
    const start = await json('/api/v1/attachments/uploads', { requestId: randomUUID(), filename: 'schema-photo.png', contentType: 'image/png', sizeBytes: bytes.length, purpose });
    const uploadId = start.upload.id;
    const parts = [];
    for (let partNumber = 1; partNumber <= start.upload.partCount; partNumber++) {
      const data = bytes.subarray((partNumber - 1) * start.upload.partSizeBytes, partNumber * start.upload.partSizeBytes);
      parts.push({ partNumber, checksumSha256: createHash('sha256').update(data).digest('base64'), data });
    }
    const signed = await json('/api/v1/attachments/uploads/parts', { uploadId, parts: parts.map(({ data, ...part }) => part) });
    for (const part of signed.parts) { const sent = await fetch(new URL(part.url, base), { method: 'PUT', headers: part.headers, body: parts.find(entry => entry.partNumber === part.partNumber)!.data }); assert.ok(sent.ok); }
    return (await json('/api/v1/attachments/uploads/complete', { uploadId })).attachment;
  };
  await json('/api/v1/admin/lopu/credits', { userId: viewer.id, credits: 5, reason: 'Isolated local acceptance test' });
  const original = await upload('message');
  const reply = await fetchApi('/api/v1/lopu/chats/reply', { requestId: randomUUID(), text: 'Describe this photo.', attachmentIds: [original.id], managementMode: 'local', accessMode: 'full' });
  assert.ok(reply.ok, await reply.clone().text());
  const events = (await reply.text()).trim().split('\n').map(line => JSON.parse(line));
  const chatId = events.find(event => event.type === 'meta')?.chatId;
  assert.ok(chatId, JSON.stringify(events));
  assert.ok(!events.some(event => event.type === 'error'), JSON.stringify(events));
  const { createLopuToolContext, runLopuTool } = await import('../app/api/utils/lopu/chatTools');
  const { getLopuChat } = await import('../app/api/utils/messenger/lopuChats');
  const { lopuAccessMode } = await import('../app/api/utils/lopu/accessMode');
  const context = createLopuToolContext(viewer, {}, () => {}, { chatId, requestScope: `file-acceptance-${randomUUID()}`, readAccessMode: async () => {
    const current = await getLopuChat(viewer.id, chatId);
    assert.ok(current.ok, 'Acceptance chat must remain available while tools run');
    return lopuAccessMode(current.settings.accessMode);
  } });
  const tool = async (name: any, input: any): Promise<any> => {
    const result = await runLopuTool({ id: randomUUID(), name, input }, context);
    if (result.ok === false) throw new Error(`${name}: ${result.error} ${JSON.stringify(result.data || {})}`); return result.data;
  };
  const saved = await tool('save_attachment', { id: original.id, folderId: fixture.folderId });
  const replay = await tool('save_attachment', { id: original.id, folderId: fixture.folderId });
  assert.equal(saved.id, replay.id); assert.notEqual(saved.id, original.id);
  const savedThing = await json(`/api/v1/things?id=${saved.id}`);
  assert.equal(savedThing.thing.folderId, fixture.folderId);
  assert.deepEqual(savedThing.thing.acl, ['tt:user']);
  const copied = await tool('create_schema', { name: `Product ${Date.now()}`, extends: 'post', fields: [{ name: 'brand', type: 'string' }] });
  const schemaId = copied.thing.id;
  const product = await tool('create_data', { schema: schemaId, values: { type: 'text', title: 'Photo product', text: 'A product with a saved chat photo.', images: [saved.url], brand: 'Local test' } });
  const created = await json(`/api/v1/things?id=${product.thing.id}`);
  assert.equal(created.thing.crystal.schemaId, schemaId); assert.equal(created.thing.crystal.images[0], saved.url);


  const file = await fetchApi(saved.url); assert.ok(file.ok);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  const anon = await fetch(new URL(saved.url, base)); assert.ok(!anon.ok);
  console.log('Chat file copied, filed, assigned to a Product, replayed without duplication, and survived chat deletion; anonymous bytes denied.');
  const action = await tool('create_action', { name: 'Save photo product', actionKey: `photo-product-${Date.now()}`, inputs: [{ name: 'photo', type: 'string', required: true }, { name: 'photoAttachmentId', type: 'string', required: true }], steps: [{ op: 'things.create', schema: schemaId, values: { type: 'text', title: 'Uploaded product', text: 'Saved from the uploader form', images: ['$input.photo'], photoAttachmentId: '$input.photoAttachmentId' } }, { op: 'return', value: '$step.1' }], capabilities: [{ capability: 'things.create', schemas: [schemaId] }] });
  const actionId = action.thing.id;
  const component = await tool('create_component', { name: 'Photo upload acceptance', componentKey: `photo-upload-${Date.now()}`, args: [], render: { tag: 'fieldset', props: { style: { padding: 24, display: 'flex', flexDirection: 'column', gap: 16 } }, children: [{ tag: 'h2', children: ['Upload a product photo'] }, { tag: 'tt-upload', props: { name: 'photo', imageOnly: true, title: 'Product photo' } }, { tag: 'button', ttAction: actionId, children: ['Save product'] }] } });
  const page = await tool('create_page', { name: 'Schema and file acceptance', blocks: [{ id: 'photo-form', type: 'component', component: component.thing.id }], open: false });
  await json('/api/v1/lopu/chats/delete', { chatId });
  const originalGone = await fetchApi(`/api/v1/attachments/content?id=${original.id}`); assert.ok(!originalGone.ok);
  const survivingFile = await fetchApi(saved.url); assert.ok(survivingFile.ok);
  assert.deepEqual(Buffer.from(await survivingFile.arrayBuffer()), bytes);
  const result = { schemaId, productId: product.thing.id, savedFileId: saved.id, componentId: component.thing.id, pageId: page.pageId, actionId };
  writeFileSync(fixturePath.replace(/\.json$/, '-acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
