import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { DesktopAttachmentUploadRequest } from '~/utils/electronBridge';
import { resolveDesktopFileUpload } from './desktopAttachmentUpload';

const appOrigin = 'http://127.0.0.1:54000';
const apiOrigin = 'https://thingtime.example';
const file = Buffer.alloc(600_000, 12);
const uploadId = 'att_' + 'a'.repeat(64);

function mockBridge(t: TestContext, request: (message: DesktopAttachmentUploadRequest) => Promise<void>, endpoint = apiOrigin) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        location: { origin: appOrigin },
        thingtimeDesktop: {
            attachmentUploadVersion: '1.0.0',
            attachmentUploadRequest: request,
            getInfo: async () => ({ isPackaged: true, origin: appOrigin, apiOrigin: endpoint })
        }
    } });
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'window', previous);
        else Reflect.deleteProperty(globalThis, 'window');
    });
}

test('desktop file uploader pins scope and streams a signed part in bounded chunks', async t => {
    const messages: DesktopAttachmentUploadRequest[] = [];
    mockBridge(t, async message => { messages.push(message); });
    const uploader = await resolveDesktopFileUpload('owner');
    assert.ok(uploader);
    assert.deepEqual(uploader.scope, { expectedApiOrigin: apiOrigin, expectedActor: 'owner', expectedDataPlane: 'home' });
    await uploader.put(uploadId, 1, new Blob([file]), new AbortController().signal, () => {});
    const [open] = messages;
    assert.ok(open.action === 'open');
    assert.equal(open.checksum, createHash('sha256').update(file).digest('base64'));
    assert.equal(open.length, file.length);
    assert.equal(open.origin, apiOrigin);
    const chunks = messages.filter(message => message.action === 'chunk');
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.bytes.length <= 256 * 1024));
    assert.deepEqual(Buffer.concat(chunks.map(chunk => chunk.bytes)), file);
    assert.equal(messages.at(-1)?.action, 'finish');
    assert.equal(new Set(messages.map(message => message.requestId)).size, 1);
});

test('desktop uploader sends cancel on the same request and does not finish an aborted part', async t => {
    const controller = new AbortController();
    const messages: DesktopAttachmentUploadRequest[] = [];
    mockBridge(t, async message => {
        messages.push(message);
        if (message.action === 'chunk') controller.abort();
    });
    const uploader = await resolveDesktopFileUpload('owner');
    assert.ok(uploader);
    await assert.rejects(uploader.put(uploadId, 1, new Blob([file]), controller.signal, () => {}), { name: 'AbortError' });
    assert.deepEqual(messages.map(message => message.action), ['open', 'chunk', 'cancel']);
    assert.equal(new Set(messages.map(message => message.requestId)).size, 1);
});
