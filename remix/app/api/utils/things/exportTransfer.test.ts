import assert from 'node:assert/strict';
import test from 'node:test';
import { exportTransferPlan } from './exportTransfer';
import type { ThingDoc } from './things';
import type { SharedComposition } from '../actions/sharedComposition';

const doc = (id: string, kinds = ['note'], crystal: Record<string, unknown> = {}): ThingDoc => ({ shareId: id, ownerId: 'owner', thingtime: kinds, crystal, acl: ['tt:user'], extended: ['kept', { value: 3 }], tags: [] } as unknown as ThingDoc);
const project = async (docs: ThingDoc[]) => docs.map((item) => ({ id: item.shareId, thingtime: item.thingtime, crystal: item.crystal, extended: item.extended,
  tags: item.tags || [], author: { id: item.ownerId }, acl: item.acl, visibility: 'private', folderId: item.folderId || null, targetId: item.targetId || null, linkKey: 'NEVER-EXPORT', createdAt: '', updatedAt: '' })) as any;
const composition = (root: ThingDoc, children: ThingDoc[] = []): SharedComposition => ({ root, docs: new Map([root, ...children].map((item) => [item.shareId, item])), actions: new Map(), children: new Map(), data: new Map(), references: new Map(), requiredReferences: new Set(), contexts: new Map(), boundaries: new Map() });

test('export follows every folder page, preserves JSON extended values and excludes authority', async () => {
  const folder = doc('folder', ['folder']);
  const children = Array.from({ length: 102 }, (_, index) => ({ ...doc(`child-${index}`), folderId: 'folder' }));
  const docs = new Map([folder, ...children].map((item) => [item.shareId, item]));
  const result = await exportTransferPlan({ id: 'owner' }, { ids: ['folder'] }, undefined, {
    read: async (id) => docs.get(String(id)) || null, project,
    list: async (_viewer, query) => ({ ok: true, things: await project(query.cursor ? children.slice(100) : children.slice(0, 100)), nextCursor: query.cursor ? null : 'next' }),
    bound: async () => []
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.plan.things.length, 103);
  assert.deepEqual(result.plan.things[0].extended, ['kept', { value: 3 }]);
  for (const thing of result.plan.things) assert.deepEqual(Object.keys(thing).filter((key) => ['acl', 'author', 'linkKey', 'ownerId', 'secure'].includes(key)), []);
});

test('composition aliases are canonicalized and gallery targets win over embedded reuse', async () => {
  const root = doc('page', ['webpage'], { blocks: [{ type: 'component', component: 'my-card', id: 'one' }] });
  const child = doc('card-id', ['component'], { render: { tag: 'img', props: { src: '/api/v1/attachments/content?id=photo' } } });
  const graph = composition(root, [child]);
  graph.references.set('page:component:my-card', child); graph.requiredReferences.add('page:component:my-card');
  let descriptions = 0;
  const result = await exportTransferPlan({ id: 'viewer' }, { ids: ['page'] }, undefined, {
    read: async () => root, resolve: async () => graph, project,
    bound: async () => [{ id: 'photo', targetId: 'card-id' }],
    describe: async (viewer, id) => { descriptions++; assert.equal(viewer?.sharedRoot, 'page'); assert.equal(id, 'photo'); return { ok: true, linked: false, attachment: { id: 'photo', name: 'pic.png', contentType: 'image/png', size: 42, mediaKind: 'image' } }; }
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.plan.things[0].crystal.blocks as any)[0].component, 'card-id');
  assert.equal(result.plan.files[0].targetId, 'card-id');
  assert.equal(descriptions, 1);
});

test('unreadable roots and required dependencies fail without a partial export', async () => {
  const missing = await exportTransferPlan(null, { ids: ['private'] }, undefined, { read: async () => null });
  assert.equal(missing.ok, false);
  const root = doc('page', ['webpage']); const graph = composition(root); graph.requiredReferences.add('page:component:private');
  const result = await exportTransferPlan(null, { ids: ['page'] }, undefined, { read: async () => root, project, resolve: async () => graph });
  assert.equal(result.ok, false);
  assert.match((result as any).error, /unavailable/);
});

test('live file denial and unsupported linked galleries fail explicitly', async () => {
  const root = doc('note');
  const base = { read: async () => root, project, bound: async () => [{ id: 'file', targetId: 'note' }] };
  const denied = await exportTransferPlan(null, { ids: ['note'] }, undefined, { ...base, describe: async () => ({ ok: false, status: 404, error: 'Attachment not found' }) });
  assert.equal(denied.ok, false);
  const linked = await exportTransferPlan(null, { ids: ['note'] }, undefined, { ...base, describe: async () => ({ ok: true, linked: true, attachment: { id: 'file', name: 'link', contentType: 'text/plain', size: 0, mediaKind: 'file', url: 'https://example.com' } }) });
  assert.equal(linked.ok, false);
  assert.match((linked as any).error, /not truncated/);
});
