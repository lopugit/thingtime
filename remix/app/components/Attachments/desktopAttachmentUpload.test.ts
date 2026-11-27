import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { compileFunction } from 'node:vm';
import type { Node as TypeScriptNode } from 'typescript';
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

// Exercise the actual selector at the hook integration boundary. This protects
// Post/Comment from silently returning to renderer-only S3 XHR while the native
// transport unit tests continue to pass independently.
async function selectHookTransport(purpose: string, ownerId: string | null, dataPlane: string | null = 'home') {
    const { readFile } = await import('node:fs/promises');
    const ts = await import('typescript');
    const source = await readFile(new URL('./useAttachmentUploads.ts', import.meta.url), 'utf8');
    const tree = ts.createSourceFile('useAttachmentUploads.ts', source, ts.ScriptTarget.Latest, true);
    let initializer: string | undefined;
    const visit = (node: TypeScriptNode) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'desktop') initializer = node.initializer?.getText(tree);
        ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.ok(initializer, 'the real upload hook must choose its transport');
    return compileFunction(`return (async () => (${initializer}))()`, ['purpose', 'ownerId', 'dataPlane', 'resolveDesktopFileUpload'])(purpose, ownerId, dataPlane, resolveDesktopFileUpload);
}

test('Post and Comment select the same scoped native transport as Files', async t => {
    const messages: DesktopAttachmentUploadRequest[] = [];
    mockBridge(t, async message => { messages.push(message); });
    for (const purpose of ['post', 'comment', 'file', 'message']) {
        const uploader = await selectHookTransport(purpose, 'owner');
        assert.ok(uploader, purpose + ' uses the installed native transport');
        await uploader.put(uploadId, 1, new Blob([file]), new AbortController().signal, () => {});
    }
    assert.equal(messages.filter(message => message.action === 'open').length, 4);
    assert.equal(await selectHookTransport('post', null), null);
    assert.equal(await selectHookTransport('post', 'owner', 'custom'), null, 'custom-plane Post never borrows home transport');
    assert.equal(await selectHookTransport('comment', 'owner', null), null, 'unknown plane never borrows home transport');
});

test('the hook retains browser transport when the native bridge is unavailable', async t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: appOrigin } } });
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
    assert.equal(await selectHookTransport('post', 'owner'), null);
});
