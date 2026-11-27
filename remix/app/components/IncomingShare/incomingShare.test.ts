import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAttachmentSourceFile, attachmentSourceLivePhoto, attachmentSourcePreview, readAttachmentSlice } from '../Attachments/attachmentFileSource';
import { dedupeSelectedFiles } from '../Attachments/attachmentUiCore';
import { incomingShareRequestId, readIncomingShare, type IncomingShareBridge } from './incomingShare';
const id = '165b6596-37e9-4f51-b589-cf90c912d54d', origin = 'https://thingtime.example', accountId = 'account';
const bytes = Buffer.alloc(600_001, 23);
function mock(overrides: Record<string, unknown> = {}) {
 const reads: Array<Record<string, any>> = [];
 const bridge: IncomingShareBridge = { version: '1.0.0', request: async body => {
  if (body.method === 'manifest') return { version: '1.0.0', origin, requestId: id, maxChunkBytes: 262144, ...overrides };
  if (body.method === 'getIncomingShare') return { id, accountId, apiOrigin: origin, text: 'Read this\nhttps://example.com', directories: ['empty'], attachments: [{ id: 'opaque-file', name: 'archive.custom', type: 'application/x-unknown', relativePath: 'folder/archive.custom', size: bytes.length }] };
  reads.push(body);
  const start = Number(body.offset), end = start + Number(body.length);
  return { base64: bytes.subarray(start, end).toString('base64'), nextOffset: end, eof: end === bytes.length };
 } };
 return { bridge, reads };
}
test('incoming share preserves text and unknown formats and reads only bounded multipart ranges', async () => {
 const { bridge, reads } = mock();
 const draft = await readIncomingShare(bridge, id, accountId, origin, new AbortController().signal);
 assert.equal(reads.length, 0);
 assert.equal(draft.text, 'Read this\nhttps://example.com'); assert.deepEqual(draft.directories, ['empty']);
 assert.equal(draft.files[0].size, bytes.length); assert.equal(draft.files[0].type, 'application/x-unknown');
 assert.equal(draft.files[0].webkitRelativePath, 'folder/archive.custom');
 const body = await readAttachmentSlice(draft.files[0], 100, bytes.length);
 assert.deepEqual(Buffer.from(await body.arrayBuffer()), bytes.subarray(100));
 assert.equal(reads.length, 3); assert.ok(reads.every(read => read.length <= 262144 && read.accountId === accountId && read.requestId === id && read.fileId === 'opaque-file'));
});
test('native origin, request and chunk refusals happen before file access', async () => {
 for (const overrides of [{ origin: 'https://elsewhere.example' }, { requestId: 'other' }, { version: '2.0.0' }, { maxChunkBytes: 0 }]) {
  const { bridge, reads } = mock(overrides);
  await assert.rejects(readIncomingShare(bridge, id, accountId, origin, new AbortController().signal)); assert.equal(reads.length, 0);
 }
});
test('account switch or cancellation prevents continuing original-file access', async () => {
 const { bridge, reads } = mock();
 await assert.rejects(readIncomingShare(bridge, id, 'other-account', origin, new AbortController().signal));
 const controller = new AbortController(), draft = await readIncomingShare(bridge, id, accountId, origin, controller.signal);
 controller.abort(); await assert.rejects(readAttachmentSlice(draft.files[0], 0, 20), { name: 'AbortError' }); assert.equal(reads.length, 0);
});
test('truncated native range is rejected rather than uploaded as a complete file', async () => {
 const { bridge } = mock(); const request = bridge.request;
 bridge.request = async body => body.method === 'read' ? { base64: 'AQ==', nextOffset: 1 } : request(body);
 const draft = await readIncomingShare(bridge, id, accountId, origin, new AbortController().signal);
 await assert.rejects(readAttachmentSlice(draft.files[0], 0, 20), /interrupted/);
});
test('browser File slicing stays exact and route admits only UUID request identities', async () => {
 const file = new File(['abcdef'], 'sample.txt'); assert.equal(await (await readAttachmentSlice(file, 1, 4)).text(), 'bcd');
 assert.equal(incomingShareRequestId(`?requestId=${id}`), id); assert.equal(incomingShareRequestId('?requestId=https://example.com/private'), null);
});

test('native thumbnails are bounded separately from original bytes', async () => {
 const { bridge, reads } = mock({ thumbnailMaxDimension: 640, thumbnailMaxBytes: 524288 });
 const invoke = bridge.request;
 bridge.request = async body => body.method === 'thumbnail' ? { type: 'image/jpeg', base64: 'AQID' } : invoke(body);
 const draft = await readIncomingShare(bridge, id.toUpperCase(), accountId, origin, new AbortController().signal);
 assert.equal((await attachmentSourcePreview(draft.files[0]))?.size, 3); assert.equal(reads.length, 0);
 bridge.request = async body => body.method === 'thumbnail' ? { type: 'text/html', base64: 'AQID' } : invoke(body);
 await assert.rejects(attachmentSourcePreview(draft.files[0]), /preview/);
});
test('same-name files in separate folders or with separate native IDs are retained', () => {
 const make = (id: string, relativePath: string) => createAttachmentSourceFile({ id, relativePath, name: 'same.bin', type: 'application/octet-stream', size: 42 }, async () => new Blob());
 const files = [make('first', 'a/same.bin'), make('second', 'b/same.bin'), make('third', 'b/same.bin')];
 assert.equal(dedupeSelectedFiles([], files).length, 3);
 assert.equal(dedupeSelectedFiles([], [files[0], files[0]]).length, 1);
});

test('explicit Live Photo parts retain one native pair through lazy file sources', async () => {
 const { bridge } = mock(); const request = bridge.request;
 const pairId = '166b6596-37e9-4f51-b589-cf90c912d54d';
 bridge.request = async body => body.method === 'getIncomingShare' ? {
  id, accountId, apiOrigin: origin, text: '', warnings: [], attachments: [
   { id: 'original', name: 'original.heic', type: 'image/heic', size: 10 },
   { id: 'photo', name: 'still.jpeg', type: 'image/jpeg', size: 10, livePhoto: { pairId, role: 'photo' } },
   { id: 'motion', name: 'motion.mov', type: 'video/quicktime', size: 10, livePhoto: { pairId, role: 'motion' } }
  ]
 } : request(body);
 const draft = await readIncomingShare(bridge, id, accountId, origin, new AbortController().signal);
 assert.deepEqual(draft.files.map(attachmentSourceLivePhoto), [undefined, { pairId, role: 'photo' }, { pairId, role: 'motion' }]);
 assert.deepEqual(draft.warnings, []);
 bridge.request = async body => body.method === 'getIncomingShare' ? {
  id, accountId, apiOrigin: origin, text: '', warnings: ['Motion was unavailable; sharing the still photo.'],
  attachments: [{ id: 'photo', name: 'still.jpeg', type: 'image/jpeg', size: 10 }]
 } : request(body);
 const fallback = await readIncomingShare(bridge, id, accountId, origin, new AbortController().signal);
 assert.equal(attachmentSourceLivePhoto(fallback.files[0]), undefined);
 assert.equal(fallback.warnings.length, 1);
});

test('malformed, mismatched, duplicate and incomplete native pair metadata is refused', async () => {
 const { bridge } = mock(); const request = bridge.request;
 const pairId = '166b6596-37e9-4f51-b589-cf90c912d54d';
 const photo = { id: 'one', name: 'still.jpeg', type: 'image/jpeg', size: 10, livePhoto: { pairId, role: 'photo' } };
 for (const attachments of [[photo], [photo, { ...photo, id: 'two' }], [{ ...photo, type: 'text/html' }], [{ ...photo, type: 'image/heic' }], [{ ...photo, livePhoto: { pairId: 'bad', role: 'photo' } }]]) {
  bridge.request = async body => body.method === 'getIncomingShare' ? { id, accountId, apiOrigin: origin, text: '', attachments } : request(body);
  await assert.rejects(readIncomingShare(bridge, id, accountId, origin, new AbortController().signal), /Live Photo/);
 }
});

test('native capability negotiation accepts compatible patch and minor upgrades', async () => {
 for (const version of ['1.0.0', '1.0.1', '1.1.0']) {
  const { bridge } = mock({ version }); bridge.version = version;
  assert.equal((await readIncomingShare(bridge, id, accountId, origin, new AbortController().signal)).id, id);
 }
 const { bridge } = mock(); bridge.version = '2.0.0';
 await assert.rejects(readIncomingShare(bridge, id, accountId, origin, new AbortController().signal), /version/);
});


test('larger advertised bridge chunks keep client reads bounded and compatible', async () => {
 const { bridge, reads } = mock({ maxChunkBytes: 1048576 });
 const draft = await readIncomingShare(bridge, id, accountId, origin, new AbortController().signal);
 await readAttachmentSlice(draft.files[0], 0, bytes.length);
 assert.equal(reads.length, 3); assert.ok(reads.every(part => part.length <= 262144));
});


test('directory-only incoming shares remain valid and malformed folders never disappear silently', async () => {
 const { bridge, reads } = mock(); const invoke = bridge.request;
 bridge.request = async body => body.method === 'getIncomingShare' ? { id, accountId, apiOrigin: origin, text: '', attachments: [], directories: ['Only folders', 'Only folders/empty'] } : invoke(body);
 const draft = await readIncomingShare(bridge, id, accountId, origin, new AbortController().signal);
 assert.deepEqual(draft.files, []); assert.equal(draft.text, ''); assert.deepEqual(draft.directories, ['Only folders', 'Only folders/empty']); assert.equal(reads.length, 0);
 bridge.request = async body => body.method === 'getIncomingShare' ? { id, accountId, apiOrigin: origin, text: '', attachments: [], directories: ['kept', 42] } : invoke(body);
 await assert.rejects(readIncomingShare(bridge, id, accountId, origin, new AbortController().signal), /folder/);
});

test('literal shared text preserves line breaks without interpreting markup or Markdown', async () => {
 const { incomingShareEditorDocument } = await import('./incomingShare');
 const { blocksToText } = await import('../Editor/editorJsValue');
 const text = 'Thingtime macOS share acceptance — line one\nLine two 🥰';
 const doc = incomingShareEditorDocument(text);
 assert.equal(doc.blocks[0].data.text, 'Thingtime macOS share acceptance — line one<br>Line two 🥰');
 assert.equal(blocksToText(doc.blocks), text);
 assert.equal(incomingShareEditorDocument('<script>& # literal\r\n\rnext').blocks[0].data.text, '&lt;script&gt;&amp; # literal<br><br>next');
});
