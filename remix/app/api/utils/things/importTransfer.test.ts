import test from 'node:test';
import assert from 'node:assert/strict';
import { importTransfer, orderTransferImports } from './importTransfer';
import { TRANSFER_FORMAT, type ThingTransfer } from '../../../utils/thingTransfer/format';
import { rewriteTransferMedia } from './transferMediaCore';
import { resolveTemplate } from '../../../components/ComponentsLibrary/componentTemplate';
import { compositionAttachmentIds } from '../actions/compositionMediaCore';

const fixture = (): ThingTransfer => ({ format: TRANSFER_FORMAT, version: 1, roots: ['folder'], files: [], things: [
  { id: 'data', thingtime: ['data'], folderId: 'folder', crystal: { schemaId: 'schema', name: 'note', text: 'schema' }, extended: { custom: 42 } },
  { id: 'schema', thingtime: ['schema'], folderId: 'folder', crystal: { name: 'My schema' } },
  { id: 'folder', thingtime: ['folder'], crystal: { name: 'Folder' } }
] });

const harness = () => {
  const writes: any[] = [];
  const removed: string[] = [];
  let next = 0;
  return { writes, removed, deps: {
    uuid: () => `new-${++next}`,
    create: async (owner: string, input: any, viewer: any) => { writes.push({ owner, input, viewer }); return { ok: true, doc: { shareId: input.shareId } } as any; },
    remove: async (_viewer: any, id: any) => { removed.push(id); return { ok: true } as any; }
  } };
};

test('imports fresh private linked galleries in mixed attachment order through normal link writers', async () => {
  const { writes, deps } = harness();
  const manifest = fixture();
  manifest.links = [{ id: 'link', targetId: 'data', url: 'https://example.com/a.png', mediaKind: 'image', title: 'Title', description: 'Line\nTwo' }];
  manifest.files = [{ id: 'file', targetId: 'data', path: 'files/000000', name: 'a.txt', mime: 'text/plain', bytes: 4, sha256: 'a'.repeat(64) }];
  manifest.attachmentOrder = ['link', 'file'];
  let annotations: unknown;
  let bound: readonly string[] = [];
  const result = await importTransfer({ id: 'recipient' }, { manifest, files: { file: 'upload' } }, undefined, {
    ...deps,
    link: async (owner, input) => { assert.equal(owner, 'recipient'); assert.deepEqual(input, { url: manifest.links![0].url, mediaKind: 'image', purpose: 'post' }); return { ok: true, attachment: { id: 'new-link' } } as any; },
    annotate: async (_owner, input) => { annotations = input; return { ok: true } as any; },
    inspectFiles: async (_owner, ids) => { assert.deepEqual(ids, ['new-link', 'upload']); return { ok: true, hasAny: true, hasVisual: true }; },
    getFile: async (_owner, id) => id === 'new-link' ? { attachmentLinked: true, crystal: { url: manifest.links![0].url } } as any : { crystal: { size: 4 } } as any,
    bindFiles: (ids) => { bound = ids; return (async () => {}) as any; }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(bound, ['new-link', 'upload']);
  assert.deepEqual(annotations, { id: 'new-link', title: 'Title', description: 'Line\nTwo', filenamePreview: undefined });
  assert.ok(result.ok && result.linksImported === 1 && result.filesImported === 1);
  assert.ok(writes.every((write) => JSON.stringify(write.input.acl) === '["tt:user"]'));
});

test('failed link annotation cleans only the new unbound draft and reports deferred cleanup', async () => {
  for (const deferred of [false, true]) {
    const { writes, deps } = harness();
    const manifest = fixture();
    manifest.links = [{ id: 'source-link', targetId: 'data', url: 'https://example.com/a.png', mediaKind: 'image', title: 'Title' }];
    manifest.attachmentOrder = ['source-link'];
    const removed: unknown[] = [];
    const result = await importTransfer({ id: 'recipient' }, { manifest }, undefined, {
      ...deps,
      link: async () => ({ ok: true, attachment: { id: 'new-link' } }) as any,
      annotate: async () => ({ ok: false, status: 403, error: 'quota' }),
      getFile: async () => ({ targetId: null }) as any,
      removeFile: async (_owner, input) => { removed.push(input); return { ok: true, deferred }; }
    });
    assert.equal(result.ok, false); assert.equal(writes.length, 0);
    assert.deepEqual(removed, [{ id: 'new-link' }]);
    assert.equal('remainingIds' in result, deferred);
  }
});

test('imports folders and schemas before dependent data, with private fresh ownership and preserved extended content', async () => {
  const { writes, deps } = harness();
  const original = fixture();
  const result = await importTransfer({ id: 'recipient' }, { manifest: original, folderId: 'destination' }, undefined, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(writes.map((write) => write.input.thingtime[0]), ['folder', 'schema', 'data']);
  for (const write of writes) { assert.equal(write.owner, 'recipient'); assert.deepEqual(write.input.acl, ['tt:user']); assert.equal(write.viewer.id, 'recipient'); }
  assert.equal(writes[0].input.folderId, 'destination');
  assert.equal(writes[2].input.folderId, writes[0].input.shareId);
  assert.equal(writes[2].input.crystal.schemaId, writes[1].input.shareId);
  assert.equal(writes[2].input.crystal.text, 'schema');
  assert.deepEqual(writes[2].input.extended, { custom: 42 });
  assert.deepEqual(original, fixture());
});

test('rejects forged account records, caller ACL/owner fields, and unresolved structural cycles before writes', async () => {
  const { writes, deps } = harness();
  const managed = fixture(); managed.things[0].thingtime = ['user'];
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: managed }, undefined, deps)).ok, false);
  const forged = fixture(); Object.assign(forged.things[0], { ownerId: 'victim', acl: ['tt:all'] });
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: forged }, undefined, deps)).ok, false);
  const cycle = fixture(); cycle.things[0].targetId = 'schema'; cycle.things[1].targetId = 'data';
  assert.throws(() => orderTransferImports(cycle), /Circular/);
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: cycle }, undefined, deps)).ok, false);
  assert.equal(writes.length, 0);
});

test('failure cleans only newly created records in reverse order and reports failed cleanup', async () => {
  const { writes, removed, deps } = harness();
  const create = deps.create;
  deps.create = async (...args) => writes.length === 2 ? { ok: false, status: 403, error: 'quota denied' } : create(...args);
  const result = await importTransfer({ id: 'recipient' }, { manifest: fixture() }, undefined, deps);
  assert.equal(result.ok, false);
  assert.deepEqual(removed, writes.map((write) => write.input.shareId).reverse());
  const second = harness();
  const createForSecond = second.deps.create;
  second.deps.create = async (...args) => second.writes.length ? { ok: false, status: 403, error: 'quota denied' } : createForSecond(...args);
  second.deps.remove = async () => ({ ok: false, status: 503, error: 'cleanup unavailable' });
  const failed = await importTransfer({ id: 'recipient' }, { manifest: fixture() }, undefined, second.deps);
  assert.equal(failed.ok, false);
  assert.ok('remainingIds' in failed && Array.isArray(failed.remainingIds) && failed.remainingIds.length === 1);
});

test('file imports require distinct authorized ready uploads before any Thing writes', async () => {
  const { writes, deps } = harness();
  const manifest = fixture();
  manifest.files = [{ id: 'old-file', targetId: 'data', name: 'test.txt', mime: 'text/plain', path: 'files/000000', bytes: 4, sha256: 'a'.repeat(64) }];
  const absent = await importTransfer({ id: 'recipient' }, { manifest }, undefined, deps);
  assert.equal(absent.ok, false);
  const denied = await importTransfer({ id: 'recipient' }, { manifest, files: { 'old-file': 'foreign-upload' } }, undefined, {
    ...deps, inspectFiles: async () => ({ ok: false, status: 403, error: 'not your upload' })
  });
  assert.equal(denied.ok, false);
  assert.equal(writes.length, 0);
});

test('cancelled imports perform no writes and do not retry creation', async () => {
  const { writes, deps } = harness();
  const result = await importTransfer({ id: 'recipient' }, { manifest: fixture() }, AbortSignal.abort(new Error('cancelled')), deps);
  assert.equal(result.ok, false);
  assert.equal(writes.length, 0);
});

test('imported split-template media preserves saved and page-instance arguments and composes on re-import', () => {
  const things: ThingTransfer['things'] = [
    { id: 'component', thingtime: ['component'], crystal: {
      savedArgs: { prefix: 'att_', suffix: 'default' },
      render: { tag: 'img', props: { src: '/api/v1/attachments/content?id={prefix}{suffix}', title: '{prefix}{suffix}',
        _hover: { backgroundImage: 'url(/api/v1/attachments/content?id={prefix}{suffix})' } }
      }
    } },
    { id: 'page', thingtime: ['webpage'], crystal: { blocks: [
      { id: 'a', type: 'component', component: 'component', args: { prefix: 'att_', suffix: 'instance' } },
      { id: 'b', type: 'component', component: 'component', args: { prefix: 'att_', suffix: 'second' } }
    ] } }
  ];
  const original = structuredClone(things);
  const copies = new Map([['att_default', 'copy_default'], ['att_instance', 'copy_instance'], ['att_second', 'copy_second']]);
  const crystals = rewriteTransferMedia(things, copies);
  const component = crystals.get('component')!;
  for (const suffix of ['default', 'instance', 'second']) {
    const rendered = resolveTemplate(component.render, { prefix: 'att_', suffix }) as any;
    assert.equal(rendered.props.src, `/api/v1/attachments/content?id=copy_${suffix}`);
    assert.equal(rendered.props.title, `att_${suffix}`);
    assert.match(rendered.props._hover.backgroundImage, new RegExp(`copy_${suffix}`));
  }
  const pageMedia = compositionAttachmentIds(['webpage'], crystals.get('page')!, { component: () => component });
  assert.deepEqual([...pageMedia].sort(), ['copy_instance', 'copy_second']);
  const again = rewriteTransferMedia(things.map(thing => ({ ...thing, crystal: crystals.get(thing.id)! })),
    new Map([...copies.values()].map(id => [id, `again_${id}`]))).get('component')!;
  assert.equal((resolveTemplate(again.render, { prefix: 'att_', suffix: 'instance' }) as any).props.src, '/api/v1/attachments/content?id=again_copy_instance');
  assert.deepEqual(things, original);
});

test('import service persists late bindings only after normal ready-upload checks', async () => {
  const { writes, deps } = harness();
  const manifest: ThingTransfer = { format: TRANSFER_FORMAT, version: 1, roots: ['component'], things: [
    { id: 'component', thingtime: ['component'], crystal: { savedArgs: { suffix: 'source' }, render: {
      tag: 'img', props: { src: '/api/v1/attachments/content?id=att_{suffix}' }
    } } }
  ], files: [{ id: 'att_source', targetId: 'component', name: 'photo.png', mime: 'image/png', bytes: 1, path: 'files/000000', sha256: 'a'.repeat(64) }] };
  let inspected = false;
  const result = await importTransfer({ id: 'recipient' }, { manifest, files: { att_source: 'uploaded_copy' } }, undefined, {
    ...deps,
    inspectFiles: async () => { inspected = true; return { ok: true, hasAny: true, hasVisual: true } as any; },
    getFile: async () => ({ crystal: { size: 1 } } as any),
    bindFiles: () => (async () => {}) as any
  });
  assert.equal(result.ok, true); assert.equal(inspected, true); assert.equal(writes.length, 1);
  const crystal = writes[0].input.crystal;
  assert.equal((resolveTemplate(crystal.render, crystal.savedArgs) as any).props.src, '/api/v1/attachments/content?id=uploaded_copy');
});
