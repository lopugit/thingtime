import assert from 'node:assert/strict';
import test from 'node:test';
import { createPasswordFileOperations } from '../api/utils/passwords/files';
import { cancelledAttachmentReceipt } from '../api/utils/attachments/attachmentStore';
import { PASSWORD_ENTRY_KIND } from './model';

const parent = '725d1312-9d6f-4460-8ae0-c1c5689861b1', other = 'b1644d6c-6100-4203-9fdc-cf76d3401361';
const fileId = `att_${'a'.repeat(64)}`;
function fixture() {
  let doc: any = { shareId: fileId, ownerId: 'owner', thingtime: 'attachment', attachmentPurpose: 'password', passwordFileParent: parent,
    targetId: parent, attachmentState: 'ready', passwordFileEnvelope: 'synthetic encrypted metadata' };
  let deferred = false, live = true, calls = 0;
  const matches = (filter: any) => doc && doc.ownerId === filter.ownerId && doc.attachmentPurpose === filter.attachmentPurpose && (!filter.shareId || filter.shareId === doc.shareId) && (!filter.passwordFileParent || filter.passwordFileParent === doc.passwordFileParent);
  const { passwordFileOperation, deletePasswordFiles } = createPasswordFileOperations({
    getHomeThingsCollection: async () => ({
      async findOne(filter: any) {
        if (filter.thingtime === PASSWORD_ENTRY_KIND) return live && filter.ownerId === 'owner' && [parent, other].includes(filter.shareId) ? { shareId: filter.shareId } : null;
        return matches(filter) ? doc : null;
      },
      find(filter: any) { const rows = matches(filter) ? [doc] : []; return { async *[Symbol.asyncIterator]() { yield* rows; } }; }
    }) as any,
    withUserVaultKey: async () => { throw Error('Cleanup must not decrypt a password or file key'); },
    service: { async remove(ownerId: string, input: any, options: any) {
      calls++; assert.equal(ownerId, 'owner'); assert.equal(input.id, fileId); assert.equal(options.retainCancellation, true);
      if (deferred) return { ok: true, deferred: true };
      doc = cancelledAttachmentReceipt('owner', fileId, new Date(), doc); return { ok: true, deferred: false };
    }, async cancel() { calls++; doc = cancelledAttachmentReceipt('owner', fileId, new Date(), doc); return { ok: true, deferred: false }; } } as any
  });
  return { run: (operation: string, entryId = parent, ownerId = 'owner') => passwordFileOperation(ownerId, { operation, entryId, fileId }),
    cascade: () => deletePasswordFiles('owner', parent), get doc() { return doc; }, get calls() { return calls; },
    missing() { doc = null; }, retireParent() { live = false; }, defer(value: boolean) { deferred = value; } };
}

test('lost password-file delete and abort responses replay from a secret-free owner/parent receipt', async () => {
  for (const operation of ['file-delete', 'file-abort']) {
    const f = fixture();
    assert.deepEqual(await f.run(operation), { ok: true, deferred: false });
    assert.equal(f.doc.passwordFileEnvelope, undefined); assert.equal(f.doc.passwordFileParent, parent); assert.equal(f.doc.attachmentPurpose, 'password');
    assert.deepEqual(await f.run(operation), { ok: true, deferred: false }); assert.equal(f.calls, 1);
    await assert.rejects(f.run(operation, other), { status: 404 }); await assert.rejects(f.run(operation, parent, 'other-owner'), { status: 404 });
    for (const read of ['file-download', 'file-complete', 'file-parts']) await assert.rejects(f.run(read), { status: 404 });
    f.retireParent(); await assert.rejects(f.run(operation), { status: 404 });
  }
});

test('missing password files are not invented as successful receipts and deferred cleanup remains pending', async () => {
  const f = fixture(); f.defer(true);
  assert.deepEqual(await f.run('file-delete'), { ok: true, deferred: true }); assert.equal(f.doc.attachmentState, 'ready');
  f.defer(false); await f.run('file-delete'); assert.equal(f.doc.attachmentState, 'cancelled');
  f.missing(); await assert.rejects(f.run('file-delete'), { status: 404 }); assert.equal(f.calls, 2);
});

test('parent cleanup retains the same child cancellation fence and cannot acknowledge deferred settlement', async () => {
  const f = fixture(); f.retireParent(); f.defer(true);
  await assert.rejects(f.cascade(), { status: 409 }); assert.equal(f.doc.attachmentState, 'ready');
  f.defer(false); await f.cascade(); assert.equal(f.doc.attachmentState, 'cancelled'); assert.equal(f.doc.passwordFileParent, parent);
  await f.cascade(); assert.equal(f.doc.attachmentState, 'cancelled');
});
